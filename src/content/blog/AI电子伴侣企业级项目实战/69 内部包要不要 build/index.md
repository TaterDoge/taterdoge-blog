---
title: "69 内部包要不要 build"
pubDate: 2026-05-03
description: "你已经把共享代码提到 packages/ui 或 packages/shared 里了。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/8-internal-package-build-strategy/](https://aicompanion.usehook.cn/8-internal-package-build-strategy/)

## 1. 共享包抽出来以后，紧接着要回答的一个问题

你已经把共享代码提到 `packages/ui` 或 `packages/shared` 里了。

接下来，一个很实际的问题就会出现：这些内部包，需不需要先构建（build）成 JavaScript 产物，才能被其他 app 引用？

这个问题没有一个统一的答案，但它的选择会影响你之后每天的开发体验，所以值得在一开始就想清楚。

## 2. 三种主流策略

目前在 monorepo 里处理内部包有三种常见做法，各有适用场景。

### 策略一：TypeScript 源码直接导出

最简单的方式。`packages/ui` 不设置 build 步骤，直接把 `.ts`/`.tsx` 源文件作为入口导出。

code.ts

```jsonc
// packages/ui/package.json
{
  "name": "@my-app/ui",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

消费方（`apps/web`）在 `package.json` 里引用这个内部包，Next.js 或 Vite 会负责在自己的构建流程里把 TypeScript 编译掉。

code.ts

```typescript
// apps/web 里直接引用
import { Button } from '@my-app/ui'
```

**优点：**

- 改动 `packages/ui` 的代码，不需要重新 build，直接生效，HMR 也能正常工作

- 没有额外的构建步骤，仓库配置更简单

**限制：**

- 需要消费方的构建工具支持转译 TypeScript，通常通过配置 `transpilePackages` 实现（Next.js 内置支持）

- 如果内部包要对外发布到 npm，这种方式不适用

### 策略二：构建成 dist 产物

`packages/ui` 有自己的 build 脚本（通常用 `tsup` 或 `tsc`），会把 TypeScript 编译成 JavaScript 放到 `dist/` 目录，消费方引用的是编译后的产物。

code.ts

```jsonc
// packages/ui/package.json
{
  "name": "@my-app/ui",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts"
  }
}
```

**优点：**

- 消费方不需要关心内部包用的是什么语言或工具，只管用产物

- 适合对外发布到 npm 的包

- 构建边界清晰，利于 Turborepo 做增量缓存

**代价：**

- 修改内部包后，必须先重新 build 才能看到效果，开发体验有额外负担

- 需要在 Turborepo 的任务编排里声明 `ui#build` 是 `web#dev` 的前置依赖，否则启动顺序会出错

### 策略三：TypeScript paths 映射

第三种方式不走 npm 包的路，而是在根目录的 `tsconfig.json` 里用 `paths` 直接映射包名到源码路径。

code.ts

```jsonc
// tsconfig.json（根目录）
{
  "compilerOptions": {
    "paths": {
      "@my-app/ui": ["./packages/ui/src/index.ts"],
      "@my-app/ui/*": ["./packages/ui/src/*"]
    }
  }
}
```

这样 `import { Button } from '@my-app/ui'` 在 TypeScript 的类型检查层面会正确解析，构建时也能找到正确的源文件。

**优点：**

- 配置简单，改动即时可见

- 不依赖 package.json 的 `exports` 字段

**代价：**

- 只有 TypeScript 理解这个映射，运行时（Node.js、Vite 等）需要各自配置路径别名，否则会报模块找不到的错误

- 配置分散，维护成本会随包数量增加

## 3. 如何选

没有绝对正确的选择，但有一个实用的判断框架：

**这个包会不会对外发布到 npm？**

如果会：用策略二（构建产物）。对外包必须提供编译好的 JS，不能要求消费者转译你的 TypeScript。

**如果只在 monorepo 内部使用：**

- 消费方用的是 Next.js 或 Vite：优先考虑策略一（源码直接导出），配合框架的 `transpilePackages` 选项，开发体验最顺

- 消费方是 Node.js 服务（Express、Fastify 等）：Node.js 原生不理解 TypeScript，需要用策略二或者给服务加 `tsx`/`ts-node` 之类的运行时转译

**包的规模和迭代频率：**

- 频繁改动的包，策略一省去了重复 build 的摩擦

- 相对稳定的包（比如设计系统），策略二的清晰边界反而更适合

## 4. 混用是完全正常的

monorepo 里不同的包采用不同策略，是很常见的安排。

比如：

- `packages/ui`（频繁改动的 React 组件）→ 策略一，源码导出

- `packages/ai-core`（相对稳定的模型调用封装）→ 策略二，构建产物

- `packages/config`（纯配置对象）→ 策略一，源码导出

只要在包的 `package.json` 和 Turborepo 的任务依赖里把关系说清楚，混用不会带来问题。

## 5. 策略一的配置示例（Next.js + transpilePackages）

因为这是本课程示例仓库的实际用法，具体看一下配置方式：

code.ts

```typescript
// apps/web/next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@my-app/ui', '@my-app/shared'],
}

export default nextConfig
```

加上 `transpilePackages` 之后，Next.js 会把这些包的 TypeScript 源码一起编译，不再要求它们提供预编译的 JS 产物。

内部包的 `package.json` 的 `exports` 字段指向 `.ts` 文件即可：

code.ts

```jsonc
// packages/ui/package.json
{
  "name": "@my-app/ui",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"
  }
}
```

## 6. 总结

内部包要不要 build，这个决策比看起来更重要，因为它会直接影响后面每天的开发体验和 Turborepo 任务图的复杂度。

三种策略的核心区别只有一条：**谁来负责把 TypeScript 编译成 JavaScript。**

- 策略一：由消费方（Next.js/Vite 等）负责

- 策略二：由内部包自己的 build 步骤负责

- 策略三：由运行时 + TypeScript 各自的别名配置负责

对于只在 monorepo 内部使用、消费方是 Next.js 的包，策略一通常是阻力最小的选择。对于需要对外发布或消费方是 Node.js 服务的包，策略二更合适。

下一篇，我们来看怎么在 monorepo 里同时组织前端应用、后端服务和 AI 服务——不只是目录怎么摆，而是不同运行环境的代码怎么合理共存。
