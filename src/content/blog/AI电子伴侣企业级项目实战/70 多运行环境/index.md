---
title: "70 多运行环境"
pubDate: 2026-05-04
description: "当仓库里真的开始同时放前端、后端和 AI 服务以后，最先冒出来的麻烦往往不是\"目录怎么摆\"——那个问题在前面几篇已经解决了。真正开始棘手的，是这些应用跑在完全不同的运行环境里。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/8-manage-apps-services-and-config/](https://aicompanion.usehook.cn/8-manage-apps-services-and-config/)

## 1. 多个服务放在一起不难，难的是运行环境不一样

前面几篇一直在讲怎么拆代码、怎么组织共享包。

到了这里，问题会再往前推一步。

当仓库里真的开始同时放前端、后端和 AI 服务以后，最先冒出来的麻烦往往不是"目录怎么摆"——那个问题在前面几篇已经解决了。真正开始棘手的，是这些应用跑在完全不同的运行环境里。

`apps/web` 最终跑在浏览器里。

`apps/api` 跑在 Node.js 里。

`apps/ai-worker` 可能跑在 Node.js，也可能跑在一个独立的容器里。

它们可以共享类型和工具函数，但共享的边界在哪里，不是由"能不能 import"决定的，而是由运行环境决定的。

## 2. 最常见的问题：代码能 import，但运行时会炸

这是 monorepo 里最隐蔽的一类错误。

假设你在 `packages/shared` 里写了一个工具函数：

index.ts

```typescript
import fs from 'node:fs'

export function loadConfig(path: string) {
  return JSON.parse(fs.readFileSync(path, 'utf-8'))
}
```

这个函数在 `apps/api` 里用得很好。某一天 `apps/web` 也想读配置，有人顺手从 `@acme/shared` 引入了它。TypeScript 不会报错，构建可能也不会立刻失败——但一到浏览器运行时就会炸，因为浏览器里没有 `node:fs`。

这类问题最危险的地方在于：**TypeScript 和构建工具不会拦住你，只有运行时才会暴露。**

## 3. 怎么守住运行环境边界

对于这类问题，最稳的做法不是靠人脑记住"这个包只能在 Node 里用"，而是从结构上把边界摆清楚。

**方法一：按运行环境拆分共享包。**

不要把所有共享代码都往一个 `packages/shared` 里塞。当包里开始出现只属于某个运行环境的代码时，就应该拆开：

code.ts

```txt
packages/
  shared/         ← 纯类型、纯逻辑，不依赖任何运行时 API
  shared-node/    ← 依赖 Node.js API 的工具（fs、path、crypto 等）
  shared-browser/ ← 依赖浏览器 API 的工具（DOM、localStorage 等）
```

`packages/shared` 里的代码必须是环境无关的——任何地方都能安全使用。一旦某个函数需要 `fs` 或 `window`，它就不应该留在这里。

**方法二：在 package.json 里声明运行环境。**

Node.js 的条件导出（conditional exports）可以帮助声明一个包支持哪些环境：

code.ts

```jsonc
// packages/shared-node/package.json
{
  "name": "@acme/shared-node",
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "types": "./src/index.ts"
    }
  },
  "engines": {
    "node": ">=18"
  }
}
```

虽然 `engines` 字段不会强制拦截，但它至少给消费方一个明确信号：这个包预期在 Node.js 下运行。

## 4. tsconfig 怎么共享：extends 基线方案

多个应用跑在不同环境，它们的 TypeScript 配置往往需要差异化。但又不想每个 app 从头写一份完整的 `tsconfig.json`。

最常见的做法是在 `packages/config`（或根目录）维护一组基线配置，各 app 通过 `extends` 继承：

code.ts

```jsonc
// packages/config/tsconfig.base.json
{
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true
  }
}
```

code.ts

```jsonc
// packages/config/tsconfig.nextjs.json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["dom", "dom.iterable", "esnext"],
    "plugins": [{ "name": "next" }]
  }
}
```

code.ts

```jsonc
// packages/config/tsconfig.node.json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["esnext"],
    "types": ["node"]
  }
}
```

各 app 只需要继承对应的基线：

code.ts

```jsonc
// apps/web/tsconfig.json
{
  "extends": "@acme/config/tsconfig.nextjs.json",
  "include": ["src/**/*", "next-env.d.ts"],
  "exclude": ["node_modules"]
}
```

code.ts

```jsonc
// apps/api/tsconfig.json
{
  "extends": "@acme/config/tsconfig.node.json",
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

这样做的好处不只是"少写几行配置"，更重要的是：**当你需要全仓库统一升级某个 TypeScript 选项时，只改一处基线就够了。**

## 5. 不同 app 的构建工具差异

monorepo 里另一个容易让人别扭的地方，是不同 app 使用的构建工具可能完全不同。

`apps/web` 用 Next.js，构建用 `next build`。

`apps/api` 用 Express + tsup，构建用 `tsup src/index.ts`。

`apps/ai-worker` 可能用 tsx 直接运行，开发时不需要构建。

这些差异是正常的。monorepo 不要求所有 app 用同一套构建工具——每个 app 在自己的 `package.json` 里声明自己的 `build`、`dev` 脚本就好，Turborepo 只负责调度。

但有两点需要注意：

**turbo.json 的 `outputs` 要对应每个 app 的实际产物。** 如果 `apps/web` 产出 `.next/`，`apps/api` 产出 `dist/`，而 `turbo.json` 里只写了 `dist/**`，那 `apps/web` 的缓存就不会正确恢复。

遇到这种情况，可以在各 app 的 `package.json` 里用 Turborepo 的 per-package 配置覆盖：

code.ts

```jsonc
// apps/web/package.json
{
  "name": "@acme/web",
  "turbo": {
    "build": {
      "outputs": [".next/**", "!.next/cache/**"]
    }
  }
}
```

**不同 app 的 dev 启动方式也可以不同。** 有些需要端口参数，有些需要 watch 模式，有些只是 `tsx watch src/index.ts`。这些差异不需要在 Turborepo 层面统一，各自在自己的 scripts 里处理就好。

## 6. 共享配置的分层：什么该统一，什么该各自管

到这里可以总结一下，monorepo 里的配置通常分三层：

**仓库级统一配置（根目录或 packages/config）：**

- TypeScript 基线（`tsconfig.base.json`）

- ESLint / Prettier 规则

- Git hooks（husky、lint-staged）

- Turborepo 任务定义

**环境级配置（按运行环境分）：**

- `tsconfig.nextjs.json` / `tsconfig.node.json`

- 不同环境的 `.env` 约定

**应用级配置（各 app 自己管）：**

- `next.config.ts`

- 构建入口和产物路径

- 端口和启动参数

- 应用特有的环境变量

如果一份配置只属于一个 app，就让它留在那个 app 里。如果一份配置在多个 app 之间已经形成了稳定的共同约定，就提到仓库级或环境级去统一管理。不要因为"看起来可以统一"就急着往上提——前面讲共享代码拆分时的原则在这里同样适用。

## 7. 总结

多个服务放在同一个 monorepo 里，真正需要额外处理的不是"目录怎么摆"，而是三个运行时层面的问题：

- **运行环境边界**——浏览器、Node、Worker 的代码不能因为共享方便就混在一起

- **TypeScript 配置**——用 extends 基线统一公共选项，按环境差异化具体设置

- **构建工具差异**——不同 app 可以用不同工具，Turborepo 只管调度，不管实现

把这三层处理好，多服务的 monorepo 才会越长越稳，而不是越长越脆。
