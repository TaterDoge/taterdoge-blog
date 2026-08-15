---
title: "72 turbo.json 进阶"
pubDate: 2026-05-04
description: "前面一篇已经把 Turborepo 的核心机制讲清楚了：dependsOn 管顺序，outputs 管产物，cache 管要不要缓存。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/12-turbo-config-deep-dive/](https://aicompanion.usehook.cn/12-turbo-config-deep-dive/)

## 1. 基础配置能跑以后，缓存是不是真的可信，取决于接下来这几个字段

前面一篇已经把 Turborepo 的核心机制讲清楚了：`dependsOn` 管顺序，`outputs` 管产物，`cache` 管要不要缓存。

但只有这些，缓存还不够精确。

你会碰到这样的情况：改了 `README.md`，build 的缓存居然失效了；换了一个环境变量，缓存却没有失效，导致产物里还是旧值。

这些问题的根源都在同一个地方：Turborepo 在计算缓存 key 时，不知道哪些输入是真正重要的。这一篇讲的就是怎么把这件事告诉它。

## 2. inputs：只有这些文件变了，才算"真的变了"

`inputs` 告诉 Turborepo：当这些文件发生变化时，才认为任务需要重新执行。

code.ts

```jsonc
"build": {
  "dependsOn": ["^build"],
  "inputs": ["src/**", "package.json", "tsconfig.json"],
  "outputs": [".next/**"]
}
```

**如果不配置 `inputs`**，Turborepo 默认会把所有被 git 跟踪的文件都纳入计算范围。这通常比你需要的范围宽很多——改了 `README.md` 或者 `.github/workflows/ci.yml`，build 的缓存也会失效。

精确配置 `inputs` 的好处是缓存命中率更高：

code.ts

```jsonc
// lint 任务只关心源码和 lint 配置
"lint": {
  "inputs": ["src/**/*.ts", "src/**/*.tsx", ".eslintrc.cjs"],
  "outputs": []
}

// test 任务关心源码和测试文件
"test": {
  "inputs": ["src/**", "test/**", "vitest.config.ts"],
  "outputs": ["coverage/**"]
}
```

一个实用的判断标准：**如果这个文件变了，任务的结果不会变，那就不应该放进 `inputs`。**

## 3. env：环境变量的变化也要纳入缓存

这是最容易被遗漏的字段，也是最常导致"缓存命中但结果不对"的原因。

假设你的构建过程会读取 `NEXT_PUBLIC_API_URL`。如果不在 `env` 里声明它，Turborepo 不知道这个值变了，仍然使用旧的缓存产物——而旧产物里硬编码的是上次构建时的 URL。

code.ts

```jsonc
"build": {
  "dependsOn": ["^build"],
  "inputs": ["src/**"],
  "outputs": [".next/**"],
  "env": ["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_APP_ENV"]
}
```

声明在 `env` 里的环境变量，会和 `inputs` 里的文件内容一起参与缓存 key 计算。只要这些变量的值改变，缓存就会失效。

**实践规则：任何在构建时会被打包进产物的环境变量（`NEXT_PUBLIC_*`、`VITE_*`），都必须加进 `env` 里。** 否则不同环境之间的缓存可能互相污染——staging 的构建缓存被 production 命中，产物里还是 staging 的 API 地址。

## 4. globalDependencies 和 globalEnv

如果有一些文件或环境变量需要在**所有任务**里都纳入计算，可以在顶层配置：

code.ts

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["tsconfig.json", ".env"],
  "globalEnv": ["NODE_ENV", "CI"],
  "tasks": {
    // ...
  }
}
```

`globalDependencies` 里的文件一旦变化，所有任务的缓存都会失效。`globalEnv` 同理。

适合放在这里的是影响整个仓库行为的基础配置，比如根目录的 `tsconfig.json` 或 `NODE_ENV`。不要把太多东西放进来，否则全局失效会让缓存形同虚设。

## 5. --filter：只跑受影响的包

当 monorepo 里有很多 app 时，每次跑全量任务往往没必要。`--filter` 可以限定只处理特定范围的包。

几种常用写法：

code.ts

```shellscript
# 只构建某个包
turbo run build --filter=@acme/web

# 只构建某个包及其所有上游依赖
turbo run build --filter=@acme/web...

# 只构建相对于 main 分支有变化的包（CI 里最常用）
turbo run build --filter="...[origin/main]"
```

最后一种写法的意思是：找出从 `origin/main` 到当前提交，所有有文件变化的包，以及依赖它们的包。在 PR 构建里特别实用——如果这次 PR 只改了 `packages/ui`，Turborepo 会自动发现 `apps/web` 依赖了 `packages/ui`，把这两个一起构建，跳过不相关的包。

## 6. 调试缓存：为什么没有命中

当缓存没有按预期工作时，用 `--summarize` 查看详情：

code.ts

```shellscript
turbo run build --summarize
```

这会在 `.turbo/runs/` 目录下生成一份 JSON 报告，包含：

- 每个任务的 cache hash 是怎么算出来的

- 哪些文件参与了 hash 计算

- 为什么缓存没有命中（文件变了 / env 变了 / 从来没跑过）

另一个实用命令是 `--dry`，它只显示任务图但不真正执行：

code.ts

```shellscript
turbo run build --dry
```

这在排查"为什么这个包被拉进来了"或"为什么某个任务没有执行"时非常有用。

## 7. 一个完整的 turbo.json 示例

把前面讲的字段放在一起，一个配置准确的 `turbo.json` 通常长这样：

code.ts

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["tsconfig.json"],
  "globalEnv": ["NODE_ENV"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "package.json", "tsconfig.json"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"],
      "env": ["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_APP_ENV"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "inputs": ["src/**/*.ts", "src/**/*.tsx", ".eslintrc*"],
      "outputs": []
    },
    "test": {
      "dependsOn": ["build"],
      "inputs": ["src/**", "test/**", "vitest.config.ts"],
      "outputs": ["coverage/**"]
    }
  }
}
```

## 8. 总结

让 Turborepo 缓存真正可信的四个字段：

| 字段 | 作用 |
| --- | --- |
| inputs | 哪些文件变化会让缓存失效（不配则默认所有 git 文件） |
| env | 哪些环境变量变化会让缓存失效 |
| globalDependencies | 全局文件变化让所有任务失效 |
| globalEnv | 全局环境变量变化让所有任务失效 |

这些字段配准确，缓存才真正可信。配得太宽，缓存命中率低；漏掉关键的 env 或 inputs，缓存命中但结果是错的。

下一篇看构建缓存和远程缓存——当缓存从本地扩展到团队时，它的价值才真正放大。
