---
title: "159 api 别名配置"
pubDate: 2026-05-31
description: "import type { ApiBindings } from '../../bindings'"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/24-api-alias-config/](https://aicompanion.usehook.cn/24-api-alias-config/)

## 1. 为什么会想配别名

先看这样一段导入：

admin.route.ts

```typescript
import type { ApiBindings } from '../../bindings'
import { buildValidationErrorHandler } from '../../auth/http'
import { handleAdminLogout } from '../../auth/services/admin-logout'
import { handleAdminPasswordLogin } from '../../auth/services/admin-password-login'
import { handleAdminTokenRefresh } from '../../auth/services/admin-token-refresh'
import { createApiMeta } from '../../lib/api-meta'
```

这种写法能跑，但有个很明显的问题：路径全靠 `../../` 在回退。

刚开始文件少的时候，这种写法还能接受。可目录一深，或者文件一搬家，读起来就会很累。你每看到一行导入，都得先在脑子里数一遍：退了几层，现在到底指向哪。

所以很多人写到这里，都会冒出一个很自然的问题：这段代码能不能也像前端项目一样，配一个内部别名？

答案是可以。而且这次最值得讲清楚的，不只是“能不能配”，而是：**为什么在这个 Hono 项目里，只改 `tsconfig.json` 通常就够了。**

## 2. 别名要解决什么问题

别名配置解决的，不是功能问题，而是阅读和维护问题。

拿这个 `admin.route.ts` 来说，它本身已经够薄了，核心职责就是注册路由、挂校验、调 service。可如果导入区堆满了 `../../`，文件开头看起来还是会有点乱。

别名的价值在这里很直接：

- 导入路径更短

- 一眼能看出模块归属

- 目录调整时改动更少

- 路由文件更像「入口」而不是「路径体操」

所以别名不是必须品，但通常是很值得补的一层小优化。

## 3. 这个项目里已经有两个信号了

判断一个项目适不适合加别名，别急着上来就改配置，先看两个地方。

第一，看当前代码里有没有类似做法。

这段路由代码里其实已经有一个很明显的信号：

admin.route.ts

```typescript
import {
  AdminLogoutRequestSchema,
  AdminPasswordLoginRequestSchema,
  AdminTokenRefreshRequestSchema,
  buildSuccess,
} from '@repo/contracts'
```

也就是说，这个项目已经在用 workspace 级别的别名了。`@repo/contracts` 这种写法，说明团队对「用别名表达模块边界」这件事并不陌生。

第二，看这条 API 的运行链。

`apps/api/package.json` 里跑的是：

package.json

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy --minify",
    "check-types": "tsc --noEmit"
  }
}
```

`wrangler.jsonc` 里入口是：

wrangler.jsonc

```json
{
  "main": "src/index.ts"
}
```

再看 `tsconfig.json`：

tsconfig.json

```json
{
  "compilerOptions": {
    "moduleResolution": "Bundler"
  }
}
```

这 3 个信息合在一起，已经很关键了：

- 代码入口是 TypeScript 源码 `src/index.ts`

- 本地开发和部署都交给 Wrangler

- TypeScript 按 bundler 方式解析模块

这就意味着，它不是“先 `tsc` 编译一份 JS，再交给另一个工具继续处理”的老路，而是从一开始就走打包器那条链。

## 4. 修改 tsconfig 配置

在这样的前提之下，我们只需要直接修改 `tsconfig.json` 即可

像 `apps/api` 这种场景，最常见的做法是在 `compilerOptions` 里补两项：

tsconfig.json

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

这两项可以分开理解。

`baseUrl` 的意思是：后面的路径映射，从哪个根开始算。

`paths` 的意思是：当你写 `@/xxx` 时，真正去哪里找文件。

这里配成 `"@/*": ["./src/*"]`，就等于告诉 TypeScript：以后看到 `@/auth/http`，请按 `src/auth/http` 去解析。

## 5. 为什么前端项目经常要配两次

如果你是前端开发，这里很容易产生一个疑问：

平时在 React、Vue、Vite、Webpack、Next 这些项目里，路径别名经常不是只改 `tsconfig.json`。很多时候还要再配一次构建工具，或者装一个专门读 tsconfig 的插件。

这个经验没有错。

因为在很多前端项目里，其实有两套“解析模块”的人：

- TypeScript

- 真正打包运行代码的工具

TypeScript 负责的是：

- 编辑器能不能跳转

- 类型检查能不能通过

- 代码提示是否正常

但浏览器最终运行的代码，不是 TypeScript 亲自执行的，而是 Vite、Webpack、Rollup、Rspack 这类构建工具处理后的结果。

所以就会出现一个很典型的情况：

- `tsconfig.json` 已经认识 `@/components/button`

- 编辑器不报错

- 类型检查也通过

- 但构建工具根本不认识 `@/components/button`

- 一跑就报模块找不到

这就是为什么很多前端项目会变成“两边都要配”。

比如你可能会见到这样的组合：

- `tsconfig.json` 配 `paths`

- `vite.config.ts` 再配 `resolve.alias`

- 或者装 `vite-tsconfig-paths`

- `webpack.config.js` 再配 `resolve.alias`

也就是说，前端项目里常见的麻烦点不是 `paths` 本身，而是**类型系统和运行时构建链不是同一个解析器**。

## 6. 为什么这个 Hono 项目通常只配 tsconfig.json 就够了

现在回到这次的 `apps/api`。

这里和很多前端项目最不一样的地方，是它的运行链更短。

你不是把一份前端代码交给浏览器，也不是自己手动配一层 Vite / Webpack 的别名解析。你是把 TypeScript 入口直接交给 Wrangler：

package.json

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy --minify"
  }
}
```

Wrangler 会接住这个 TypeScript 入口，再走自己的打包流程。

而 `apps/api/tsconfig.json` 又明确写了：

tsconfig.json

```json
{
  "compilerOptions": {
    "moduleResolution": "Bundler",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

这套组合的意思可以翻成一句更容易懂的话：

**TypeScript 这边按 bundler 语义理解模块路径，Wrangler 这边又正好就是实际接手打包的人。**

所以这次不需要你再单独补一份 `vite.config.ts` 或 `webpack.config.js` 的别名配置。

对新手来说，可以先把它记成这个判断：

- 如果项目里“类型检查的人”和“最终打包运行的人”是两套东西，经常要配两次

- 如果项目从入口开始就直接交给一条 bundler 链来处理，很多时候 `tsconfig.json` 这一次配置就够了

`apps/api` 这次更接近后者。

## 7. 这里的 Hono 其实不是关键，关键是运行链

很多人看到这里，会以为“因为用了 Hono，所以只改 `tsconfig.json` 就够”。

这句话不准确。

Hono 只是一个 Web 框架，负责路由、上下文、请求响应这些事情。它不负责模块别名解析。

真正影响这件事的，不是 Hono，而是这条链：

- 入口是不是 TypeScript 源码

- 运行是不是交给 Wrangler

- 模块解析是不是走 bundler 语义

也就是说，这次之所以轻松，不是“Hono 有特殊魔法”，而是**Hono 恰好跑在一个已经把 TypeScript 和打包链收拢到一起的环境里**。

## 8. 配完之后，导入会变成什么样

改完之后，这段代码通常会变成这样：

admin.route.ts

```typescript
import type { ApiBindings } from '@/bindings'
import { buildValidationErrorHandler } from '@/auth/http'
import { handleAdminLogout } from '@/auth/services/admin-logout'
import { handleAdminPasswordLogin } from '@/auth/services/admin-password-login'
import { handleAdminTokenRefresh } from '@/auth/services/admin-token-refresh'
import { createApiMeta } from '@/lib/api-meta'
```

你会发现，代码逻辑完全没变，变的只是定位方式。

以前读导入时，要先数 `../../`。现在直接从 `@/` 往下看，路径会更像一个清晰的目录地址。

对新手来说，这个变化尤其友好。因为你不需要先在脑子里做路径换算，就能直接看出它依赖了哪些模块。

## 9. 最小改动

如果只想做最小改动，路径很简单。

先在 `apps/api/tsconfig.json` 里加：

tsconfig.json

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

再把像这样的相对导入：

admin.route.ts

```typescript
import { buildValidationErrorHandler } from '../../auth/http'
```

改成：

admin.route.ts

```typescript
import { buildValidationErrorHandler } from '@/auth/http'
```
