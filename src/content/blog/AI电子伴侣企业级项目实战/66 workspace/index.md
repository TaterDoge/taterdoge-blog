---
title: "66 workspace"
pubDate: 2026-05-02
description: "目录摆好以后，下一步自然就是：apps/web 想用 packages/shared 里的类型和工具函数，这件事怎么成立？"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/5-workspace-local-packages/](https://aicompanion.usehook.cn/5-workspace-local-packages/)

## 1. 本地包能互相引用，靠的不是目录碰巧在一起

目录摆好以后，下一步自然就是：`apps/web` 想用 `packages/shared` 里的类型和工具函数，这件事怎么成立？

index.ts

```typescript
import { buildPrompt } from '@acme/shared'
```

看起来只是一行普通的 import，但关键问题是：包管理器凭什么把 `@acme/shared` 认成本地目录，而不是去 npm 上找？

这就是 workspace 做的事。

## 2. workspace 做的事：把本地目录认成包

workspace 告诉包管理器：这个仓库里有一批目录，它们本身就是要一起管理的包。安装依赖时，不要只盯着远端 registry，也要把这些本地目录算进去。

**workspace 解决的是「识别」问题。** 先认出哪些目录是包，后面才谈得上谁依赖谁、能不能直接引用。

## 3. 最小例子：三层信息把包连起来

package.json依赖本地共享包package.json声明包名src/index.ts对外导出pnpm-workspace.yaml声明 workspace 范围

**第一层：根目录声明 workspace 范围。**

pnpm-workspace.yaml

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**第二层：共享包声明自己的包名。**

package.json

```json
{
  "name": "@acme/shared",
  "version": "0.0.0",
  "main": "./src/index.ts"
}
```

**第三层：应用把共享包写进依赖。**

package.json

```json
{
  "name": "@acme/web",
  "dependencies": {
    "@acme/shared": "workspace:*"
  }
}
```

三层对上以后，`apps/web` 里 `import { buildPrompt } from '@acme/shared'` 就不是"碰巧能跑"，而是仓库结构正式把这层引用关系建立起来了。

## 4. 背后的机制：发现 → 命名 → 链接

再往里看一步，workspace 做了三件事：

- **发现**——根据 `pnpm-workspace.yaml` 找到哪些目录属于 workspace

- **命名**——每个包通过 `package.json` 的 `name` 字段告诉包管理器自己叫什么

- **链接**——安装依赖时，包管理器不去远端下载 `@acme/shared`，而是直接和 `packages/shared` 建立本地链接

所以你在 `apps/web` 里引入 `@acme/shared`，看起来像在用一个 npm 包，背后已经是本地目录在工作了。

## 5. 不再需要手动 npm link

以前多仓库调试共享包，要自己 `npm link`，还要担心别人拉下来环境不一样。

workspace 把这件事变成了仓库层的默认规则：包在 workspace 里，依赖写在 `package.json` 里，`install` 一次，引用关系就自然成立。不需要手动链接，不需要每次都重新对齐。

## 6. workspace 和 Turborepo 的边界

workspace 解决的是**包和包之间能不能互相引用**。

Turborepo 解决的是**这些包的任务怎么一起跑**。

就算没有 `turbo.json`，只要 workspace 配好了，本地包之间照样可以互相引用。Turborepo 是在这层关系之上，再加一层任务调度和缓存。

判断 workspace 是否已经工作，看三件事：`packages/shared` 有自己的 `name`，根目录已经把它纳入 workspace，`apps/web` 已经把它写进依赖。三层都对上，引用关系就成立了。

## 7. 总结

workspace 做的事很具体：**把仓库里的本地目录正式认成包，让应用和共享包之间的引用关系随仓库一起存在。**

不靠手动链接，不靠目录碰巧在一起，而是通过 workspace 声明 + 包名 + 依赖声明，三层信息把关系固定下来。

下一篇看依赖管理——workspace 装好了，但 hoisting、版本一致性、幽灵依赖这些问题还在等着。
