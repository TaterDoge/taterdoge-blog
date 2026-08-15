---
title: "74 CI/CD 集成"
pubDate: 2026-05-05
description: "到这里，你的开发体验已经相当顺手：缓存命中，任务并行，只有真正改到的包才会重新构建。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/14-ci-cd-and-env-management/](https://aicompanion.usehook.cn/14-ci-cd-and-env-management/)

## 1. 在本地跑顺了，在 CI 里还要再想一遍

前面几篇把 Turborepo 的本地工作流打通了。

到这里，你的开发体验已经相当顺手：缓存命中，任务并行，只有真正改到的包才会重新构建。

但 CI 环境是另一回事。

CI 的每次运行都是全新环境，没有本地那份 `node_modules`，也没有上次构建的缓存。如果不做额外配置，Turborepo 在 CI 里就和你单独跑 `npm run build` 没有什么差别——每次都全量构建。

这一篇讲两件事：**如何在 CI 里用好 Turborepo**，以及 **monorepo 里的环境变量怎么管**。

## 2. CI 里的远程缓存：让缓存跨越机器边界

Turborepo 的远程缓存（Remote Caching）能把构建产物上传到云端，让任何机器——包括其他开发者的本地和 CI——都能共享同一份缓存。

这意味着：一个 PR 在开发者本地构建过一次，推上去以后 CI 可以直接命中缓存，几秒内完成构建，而不是重新跑几分钟。

**配置远程缓存：**

Turborepo 官方提供的远程缓存服务叫 Vercel Remote Cache（已内置，免费额度足够用）。在本地登录一次：

code.ts

```shellscript
npx turbo login
npx turbo link
```

之后本地的 `~/.turbo/config.json` 里会保存 token 和 team 信息。

在 CI 里，需要通过环境变量传入这两个值：

code.ts

```shellscript
TURBO_TOKEN=your_token_here
TURBO_TEAM=your_team_slug
```

或者也可以用 `TURBO_REMOTE_CACHE_SIGNATURE_KEY` 做产物签名验证（更安全，适合对缓存内容有安全要求的团队）。

## 3. GitHub Actions 完整配置示例

code.ts

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest

    env:
      TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
      TURBO_TEAM: ${{ secrets.TURBO_TEAM }}

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2   # Turborepo 需要对比 git diff，不能浅克隆

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'yarn'

      - run: yarn install --frozen-lockfile

      - run: turbo run build lint test
```

几个注意点：

**`fetch-depth: 2`**：Turborepo 需要通过 git diff 判断哪些包发生了变化。如果用默认的浅克隆（只取最新一次提交），它无法对比，会退化成全量构建。至少要取 2 个提交。

**`--frozen-lockfile`**：CI 里安装依赖要锁定版本，防止因为 lockfile 不一致导致构建结果不可重复。

**secrets**：TURBO_TOKEN 必须存在 GitHub 仓库的 Secrets 里（Settings → Secrets and variables → Actions），不能明文写在 yaml 里。

## 4. 只构建受影响的包：--filter

当 monorepo 里有很多 app 时，每次 CI 跑全量构建往往没必要。Turborepo 的 `--filter` 标志可以限定只处理发生变化的包。

code.ts

```shellscript
# 只构建相对于 main 分支有变化的包
turbo run build --filter="...[origin/main]"
```

这个语法的意思是：找出从 `origin/main` 到当前提交，所有有文件变化的包，以及依赖它们的包。

在 PR 构建里，这个写法特别实用：如果你这次 PR 只改了 `packages/ui`，Turborepo 会自动发现 `apps/web` 依赖了 `packages/ui`，把这两个一起构建，而跳过 `apps/api` 等不相关的包。

code.ts

```yaml
- name: Build affected packages
  run: turbo run build --filter="...[origin/${{ github.base_ref }}]"
```

## 5. 环境变量在 monorepo 里的分层管理

monorepo 里有多个 app，每个 app 需要的环境变量不同，但也有一些是共享的。`.env` 文件的组织容易变乱。

一个清晰的分层方案：

code.ts

```txt
my-monorepo/
├── .env                  ← 全仓库共享的变量（谨慎，通常为空）
├── .env.local            ← 本地覆盖，加入 .gitignore
├── apps/
│   ├── web/
│   │   ├── .env          ← web 应用的默认变量
│   │   └── .env.local    ← web 的本地覆盖
│   └── api/
│       ├── .env          ← api 服务的默认变量
│       └── .env.local    ← api 的本地覆盖
```

**分层原则：**

- **根目录 `.env`**：只放真正全局的变量，比如 `NODE_ENV`。保持极简，避免把各 app 的变量混进来

- **各 app 的 `.env`**：该 app 特有的配置，只对这个 app 生效

- **`.env.local`**：永远加入 `.gitignore`，用于存放本地开发的覆盖值和敏感 key

**CI 里的环境变量：**

在 CI 里不用 `.env` 文件，改用平台的 Secrets / Environment Variables 功能注入。这样敏感信息不会进入代码仓库，每个 app 的变量也可以分组管理。

## 6. NEXT_PUBLIC_* 变量和 Turborepo 缓存

这里有一个容易踩的坑，值得单独说一下。

`NEXT_PUBLIC_*` 变量在构建时会被打包进前端产物。如果你在 CI 里用了不同的 `NEXT_PUBLIC_API_URL`（比如 staging 环境和 production 环境用的是不同 URL），而 Turborepo 的 `turbo.json` 里没有把这个变量声明在 `env` 字段里，就可能出现这种情况：

staging 环境的构建缓存被 production 环境命中，导致 production 的产物里还是 staging 的 API URL。

这就是为什么上一篇要强调 `env` 字段的配置：

code.ts

```jsonc
"build": {
  "env": ["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_APP_ENV"]
}
```

**凡是会影响构建产物内容的环境变量，都必须在 `turbo.json` 的 `env` 里声明**，否则缓存对这些变量是盲目的。

## 7. 多环境部署的常见做法

对于需要区分 staging 和 production 的项目，一个常用的做法是用不同的 `.env` 文件：

code.ts

```shellscript
# 在 CI 里根据分支选择配置
if [[ "$GITHUB_REF" == "refs/heads/main" ]]; then
  cp apps/web/.env.production apps/web/.env
else
  cp apps/web/.env.staging apps/web/.env
fi

turbo run build
```

或者更简洁地，用 Turborepo 的 `--env-mode` 控制环境变量的处理方式（Turborepo v2 新增的功能，可以更细粒度地控制哪些变量可以从外部注入）。

## 8. 总结

在 CI 里用好 monorepo，核心是两件事：

**第一件：接入远程缓存。** 配置 `TURBO_TOKEN` 和 `TURBO_TEAM`，让 CI 和本地共享同一份构建缓存。这件事做完，CI 的构建时间通常能降低 50%-80%。

**第二件：管好环境变量。** 在 monorepo 里，`.env` 按层级分放，敏感变量走 Secrets，以及把影响构建产物的变量都声明在 `turbo.json` 的 `env` 里，防止不同环境之间的缓存污染。

把这两件事做到位，monorepo 在 CI 里才能真正发挥出它的价值，而不只是比单仓库多了一堆目录。
