---
title: "137 创建项目"
pubDate: 2026-05-24
description: "做法也很直接：先用 createturbo 把 monorepo 框架搭建出来，再把三个子应用都放进 apps/ 中去"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/1-create-project/](https://aicompanion.usehook.cn/1-create-project/)

## 1. 概述

我们先把三个应用的骨架搭起来，后面再慢慢添加功能，最基础的全栈应用通常包括：

- `web`：用户端站点

- `admin`：管理后台

- `api`：独立 API 服务

做法也很直接：先用 `create-turbo` 把 monorepo 框架搭建出来，再把三个子应用都放进 `apps/` 中去

这样一开始就把「多应用」「共享代码」「统一任务入口」放进同一个仓库里，后面继续扩展功能时就会非常自然

## 2. create-turbo

`create-turbo` 负责的是仓库级能力：workspace、`turbo.json`、根级脚本，以及 Turborepo 的任务编排方式。

它解决的是「这个多应用仓库怎么协同」，不是「你的业务应用默认长什么样」，试用如下的指令进行创建：

index.bash

```shellscript
pnpm create turbo@latest ai-agent --package-manager pnpm
cd ai-agent
```

当前默认脚手架通常会先给你一套可运行的示例内容，但具体有哪些目录，可能会随版本变化。

第一次创建之后，先执行完脚手架，再打开 `apps/` 和 `packages/` 看一眼当前生成结果

执行如下指令，把 `react` `next` 升级到最新，并更新 `pnpm-lock.yaml`

index.bash

```shellscript
pnpm up -r next react react-dom @types/react @types/react-dom --latest
```

然后把 `docs` 文件夹修改为 `admin`，并修改 `docs` 文件夹中的 `package.json` 文件，将 `name` 修改为 `admin`

docs/package.json

```json
{
  "name": "admin",
  "version": "0.1.0",
  "private": true
}
```

接下来，我们可以通过 `catalog` 来统一所有子站的依赖版本

检查你的 `pnpm` 版本是否是最新的，我们需要 `pnpm@10` 以上的版本，如果低于这个版本，可以利用如下的方式进行升级：

index.bash

```shellscript
# 启用 Node 自带的包管理器代理
corepack enable

# 下载最新 pnpm，并把当前项目的 packageManager 改成最新版本
corepack use pnpm@latest
# 查看 pnpm 版本
pnpm -v
```

完了之后，我们需要针对多个子站中，使用的 `React` 等依赖包进行统一管理

我们可以直接使用 AI 编程工具来调整，输入如下提示词：

prompt.md

```txt
调整 pnpm-workspace.yaml 文件，使用 catalog 将所有子站的共同依赖版本统一管理
```

也可以手动修改，在项目根目录中的 `pnpm-workspace.yaml` 中，新增如下内容：

pnpm-workspace.yaml

```yaml
 packages:
   - "apps/*"
   - "packages/*"

+catalog:
+  next: 16.2.4
+  react: ^19.2.5
+  react-dom: ^19.2.5
+  "@types/node": ^22.15.3
+  "@types/react": 19.2.14
+  "@types/react-dom": 19.2.3
+  eslint: ^9.39.1
+  typescript: 5.9.2
```

然后在子站和共享包的 `package.json` 中，通过如下的方式引用依赖：

apps/web/package.json

```json
{
  "dependencies": {
    "react": "catalog:"
  }
}
```

这样，基础的前端项目就准备好了

## 3. 创建 api 这个 Hono 子应用

我们最初的项目设计中，至少包含 `web`、`admin`、`api` 三个真正要继续开发的子应用，其中 `web` 和 `admin` 已经准备好了，`api` 这里直接用 `create-hono` 创建

index.bash

```shellscript
pnpm create hono apps/api --template cloudflare-workers --pm pnpm
```

创建完以后，先把 `apps/api/src/index.ts` 改成一个最小健康检查接口：

apps/api/src/index.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

app.get('/health', (c) => {
  return c.json({ ok: true, service: 'api' })
})

export default app
```

这时候 `api` 的目标很单纯：先证明「独立服务已经能在 monorepo 里运行」，业务接口后面再继续加

## 4. 让三套应用更容易同时运行

现在最容易遇到的第一个小问题，是端口冲突

`web` 和 `admin` 都是 Next.js，默认都会占 `3000`。所以先把 `admin` 的开发端口改掉：

apps/admin/package.json

```json
{
  "scripts": {
    "dev": "next dev --turbopack --port 3006"
  }
}
```

实际改动时，打开 `apps/admin/package.json`，找到 `scripts.dev` 那一项，把端口改成 `3006` 就行。

这里只展示需要改的那一行。改完以后：

- `web` 默认跑在 `3005`

- `admin` 跑在 `3006`

- `api` 的 `wrangler dev` 默认跑在 `8787`

根目录通常会有一份 `package.json` 和 `turbo.json`。至于默认脚本里具体带哪些命令，先看生成结果，再决定要不要补自己的脚本。

如果想更方便地单独启动某个应用，可以再补几个过滤脚本：

package.json

```json
{
  "scripts": {
    "dev": "turbo run dev",
    "dev:web": "turbo run dev --filter=web",
    "dev:admin": "turbo run dev --filter=admin",
    "dev:api": "turbo run dev --filter=api",
    "build": "turbo run build"
  }
}
```

这里的 `--filter` 可以先把它理解成「只跑某一个 workspace」。

比如只想盯着后台开发，就跑 `pnpm dev:admin`；只想看接口服务，就跑 `pnpm dev:api`。

## 5. 跑起来验证一下

第一次验证，建议分开开三个终端，这样最清楚：

index.bash

```shellscript
# 终端 1
pnpm dev:web

# 终端 2
pnpm dev:admin

# 终端 3
pnpm dev:api
```

预期结果是：

- `http://localhost:3000` 打开后看到「web 前台站」

- `http://localhost:3001` 打开后看到「admin 管理台」

- `http://localhost:8787/health` 返回 API 的 JSON

可以顺手再测一下接口：

index.bash

```shellscript
curl http://localhost:8787/health
```

正常返回：

index.json

```json
{
  "ok": true,
  "service": "api"
}
```

到这一步，项目底盘就已经立住了：一个 monorepo 根，三个独立子应用，一套统一的任务入口

然后，我们可以执行如下指令，把三个子应用都跑起来

index.bash

```shellscript
pnpm dev
```

## 8. 总结

刚开始就做三件事：

- 用 `create-turbo` 起 monorepo

- 用 `create-next-app` 建 `web` 和 `admin`

- 用 `create-hono` 建 `api`
