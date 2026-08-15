---
title: "67 依赖管理"
pubDate: 2026-05-03
description: "前面一篇把 workspace的基础机制讲清楚了：本地包可以互相引用，不需要发布到 npm。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/6-dependency-management/](https://aicompanion.usehook.cn/6-dependency-management/)

## 1. workspace 装好了，但依赖这件事远没结束

前面一篇把 workspace的基础机制讲清楚了：本地包可以互相引用，不需要发布到 npm。

但你真正动手之后，很快就会发现还有另一层问题还没解决——依赖怎么装、装在哪、怎么保持一致，这些事情在 monorepo 里的行为，和单仓库里是不一样的。

这一篇就专门把这一层讲清楚。

## 2. monorepo 里的依赖，默认会往根目录提升

先从一个最常见的现象说起。

你在 `apps/web` 里安装了 `react`，在 `apps/api` 里也安装了 `react`。但实际看文件系统，你会发现两个 app 各自的 `node_modules` 里并没有 `react`，它被放到了仓库根目录的 `node_modules` 里。

这个行为叫做 **hoisting（提升）**。

package manager 在处理 monorepo 时，会把多个 workspace 里共同依赖的包提升到根目录统一存放，而不是在每个 app 里重复安装。好处是减少磁盘占用，加快安装速度。

code.ts

```txt
my-monorepo/
├── node_modules/
│   └── react/          ← 提升到根目录
├── apps/
│   ├── web/
│   │   └── node_modules/   ← 通常是空的或只有少数特殊包
│   └── api/
│       └── node_modules/
```

这个机制在大多数情况下是透明的——你感觉不到它的存在。但它带来了一类不容忽视的问题。

## 3. hoisting 会让你不小心用到没有声明的依赖

hoisting 最容易带来的麻烦叫做**幽灵依赖（phantom dependency）**。

假设你的 `apps/web` 的 `package.json` 里只声明了 `react-query`，但没有声明 `react`。在单仓库里，这会直接报错。可在 monorepo 里，因为 `react` 已经被另一个 app 安装并提升到根目录，你的代码照样能跑。

code.ts

```jsonc
// apps/web/package.json
{
  "dependencies": {
    "react-query": "^5.0.0"
    // 没有声明 react，但代码里用了 import React from 'react'
  }
}
```

这个代码能运行，是因为 `react` 恰好在根目录的 `node_modules` 里。但这是一种意外的依赖——你没有声明它，只是借用了别人装的版本。

这类问题最危险的地方在于：它在本地是隐形的，只有在某些环境下才会暴露，比如：

- 另一个 app 把 `react` 版本升级了

- 有人把那个 app 从 monorepo 里移走了

- 在 CI 里只安装了部分 workspace 的依赖

幽灵依赖最好的处理方式，是**你用到什么就声明什么**，不依赖 hoisting 带来的意外可访问性。

## 4. 跨 workspace 的版本冲突，是另一类常见麻烦

hoisting 能统一存放相同版本的包，但如果两个 app 声明了同一个包的不同版本，情况就会变复杂。

code.ts

```jsonc
// apps/web/package.json
{ "dependencies": { "lodash": "^4.17.21" } }

// apps/api/package.json
{ "dependencies": { "lodash": "^3.10.1" } }
```

这时候 package manager 无法把两个版本都提升到同一个位置，它会把其中一个版本留在 `apps/api/node_modules/lodash` 里，另一个提升到根目录。

对于工具类包，这种情况通常不会出问题。但对于有全局单例要求的包，比如 `react`，两个版本共存就会出问题——组件树里可能同时跑着两个不同版本的 React，各种行为都会变得不可预测。

**实践建议：**

在 monorepo 里，对于这类必须保持单例的包，应该把版本约束统一放到根目录的 `package.json` 里，或者借助 package manager 的 `resolutions`（yarn）/ `overrides`（npm/pnpm）强制锁定到同一版本。

code.ts

```jsonc
// 根目录 package.json（yarn 写法）
{
  "resolutions": {
    "react": "19.1.0",
    "react-dom": "19.1.0"
  }
}
```

## 5. 内部包的依赖声明，要和外部包一样认真

这一点很多人会忽略。

`packages/ui` 是一个内部包，只在这个 monorepo 里使用，不会发布到 npm。但它依然需要认真声明自己的依赖。

如果 `packages/ui` 用到了 `react`，它就应该在自己的 `package.json` 里把 `react` 声明为 `peerDependencies`：

code.ts

```jsonc
// packages/ui/package.json
{
  "name": "@my-app/ui",
  "peerDependencies": {
    "react": ">=18.0.0"
  }
}
```

为什么是 `peerDependencies` 而不是 `dependencies`？

因为 `react` 必须是单例——整个应用只能有一个 React 实例。如果 `packages/ui` 把 `react` 声明为 `dependencies`，package manager 有可能为它单独安装一份，这就可能导致两个 React 实例并存。`peerDependencies` 告诉 package manager：这个包需要 react，但我不自己带，由使用我的应用提供。

## 6. 根目录 package.json 和子包的分工

一个常见的困惑是：什么东西应该装在根目录，什么应该装在各个 app 里？

**装在根目录的通常是：**

- 开发工具：`typescript`、`eslint`、`prettier`、`turbo`、`husky`

- 构建工具：只在全仓库层面需要的脚本和工具

- 共享配置：被多个 app 或 package 引用的配置包

**装在各 app/package 里的通常是：**

- 该 app 运行时实际需要的依赖

- 框架（`next`、`react` 等）

根目录的包通常不应该包含运行时依赖。如果你发现根目录的 `package.json` 里开始出现很多业务相关的包，往往说明有东西装错了位置。

## 7. yarn 和 pnpm 的 hoisting 行为不一样

在使用 pnpm 时，hoisting 的行为和 npm/yarn 有一个显著差异。

pnpm 默认采用更严格的链接策略：每个包只能访问它在 `package.json` 里显式声明的依赖，没有声明的包在理论上不可访问，即使它们存在于 node_modules 里。这个策略从根本上杜绝了幽灵依赖。

yarn 则相对宽松，它的默认行为更接近 npm——会把大多数依赖提升到根目录，幽灵依赖可以存在但不会报错。不过 yarn 也提供了 `nmHoistingLimits` 和 `pnpMode` 等选项来收紧这个行为。

如果你使用 yarn，你需要自己保持对幽灵依赖的警惕，不能依赖工具自动拦截。

## 8. 总结

monorepo 里的依赖管理和单仓库相比，多了两件需要主动留意的事：

第一件是 **hoisting 带来的幽灵依赖**——你用到的包必须由你自己声明，不能借用别人装的版本，否则仓库会变得脆而不稳。

第二件是**版本一致性**——对于必须单例的包（react、react-dom 等），要通过 resolutions 或 overrides 主动锁定版本，防止多个版本并存导致运行时异常。

把这两件事做扎实，后面不管是共享包还是任务编排，才会有一个可靠的基础。

下一篇讲共享代码怎么拆——也就是什么时候应该把东西提到 `packages` 里，什么时候应该先留在 `apps` 里。
