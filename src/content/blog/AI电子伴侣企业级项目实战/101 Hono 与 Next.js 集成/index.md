---
title: "101 Hono 与 Next.js 集成"
pubDate: 2026-05-13
description: "这一章到目前为止，Hono 都是「独立部署在 Cloudflare Workers 上的 API 层」。但这个专栏的前端主战场是 Next.js——有人会问："
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/26-hono-with-nextjs/](https://aicompanion.usehook.cn/26-hono-with-nextjs/)

## 1. Hono 和 Next.js 放一起用，合理吗

这一章到目前为止，Hono 都是「独立部署在 Cloudflare Workers 上的 API 层」。但这个专栏的前端主战场是 Next.js——有人会问：

- Next.js 自己有 API Route（App Router 里叫 Route Handler），为什么还要 Hono？

- 两套框架混在一起不会很奇怪吗？

- 类型怎么共享？

这一篇的目标是把这些疑问回答清楚，给出**两种实用集成模式**，并说清楚每种模式的权衡。

## 2. Next.js Route Handler 和 Hono 的定位差异

Next.js 15+ 的 Route Handler 已经相当能打，完全可以做 API。关键问题是：**它能做 Hono 能做的一切吗？**

| 能力 | Next.js Route Handler | Hono |
| --- | --- | --- |
| 简单 REST 接口 | ✅ 原生支持 | ✅ 原生支持 |
| 中间件链（洋葱模型） | ❌ 只有 middleware.ts（全局） | ✅ 路由级、分组级 |
| 链式路由 + RPC 类型推导 | ❌ 没有 | ✅ 这是 Hono 的招牌能力 |
| 部署到多种运行时 | 有限（Vercel / Node.js） | 十几种（Workers / Deno / Bun / ...） |
| 路径参数校验 + 自动类型 | 自己写 | zValidator 开箱即用 |
| SSR/ISR/RSC | ✅ 核心优势 | ❌ 跟它无关 |

两者不是替代关系。Next.js 专注「渲染框架」，Hono 专注「API 框架」。**前端渲染继续用 Next.js，API 层用 Hono**——这是大多数严肃项目的选择。

## 3. 两种集成模式

Hono + Next.js 的集成落地分两种：

### 模式 A：Hono 独立部署（推荐）

- Hono 部署在 Cloudflare Workers

- Next.js 部署在 Vercel/Netlify/自托管

- 前端通过 Hono RPC 客户端调 API

- 通过 monorepo **共享 schema 和路由类型**

适用：前后端希望**独立扩缩容**、API 需要被**多端（Web / iOS / Android / CLI）** 共用、想要 Workers 的边缘网络优势。

### 模式 B：Hono 嵌在 Next.js 里当 Route Handler

- Hono app 在 Next.js 的 `app/api/[[...route]]/route.ts` 里被导出

- 和 Next.js 一起部署，一份代码一份部署

- 前端可以用相对路径 `/api/...` 直接调

适用：**单体应用**、小团队、API 就是给自己的前端用的、不想维护两个部署单元。

两种模式都合理，没有哪个「更对」。选哪个看团队规模和 API 的用途。

## 4. 模式 B：Hono 作为 Next.js Route Handler

先讲简单的嵌入模式，大多数初学者适合从这里开始。

### 4.1 配置

Next.js App Router 里用 catch-all 动态路由接管所有 `/api/*`：

route.ts

双中括号 `[[...route]]` 是 Next.js 的 catch-all-optional 语法，意思是「匹配 /api 和 /api 下的任意路径」。

### 4.2 在 route.ts 里导出 Hono handler

app/api/[[...route]]/route.ts

```typescript
import { Hono } from 'hono'
import { handle } from 'hono/vercel'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

export const runtime = 'edge'  // 或者 'nodejs'

// 注意 basePath：因为所有路由会挂在 /api 下
const app = new Hono().basePath('/api')

app
  .get('/health', (c) => c.json({ status: 'ok' }))
  .post(
    '/chat',
    zValidator(
      'json',
      z.object({ message: z.string().min(1) })
    ),
    async (c) => {
      const { message } = c.req.valid('json')
      // 调用你的业务逻辑 / LLM
      return c.json({ reply: `你说了：${message}` })
    }
  )

// 把每个 HTTP 方法都导出去
export const GET = handle(app)
export const POST = handle(app)
export const PUT = handle(app)
export const DELETE = handle(app)
export const PATCH = handle(app)
```

几个要点：

- **`handle(app)` 来自 `hono/vercel`**：它是一个把 Hono app 转换成 Next.js Route Handler 格式的适配器

- **`basePath('/api')` 必须加**：不然内部路由匹配会把 `/api/chat` 当成 `/chat`

- **每个 HTTP 方法都要单独导出**：Next.js 的 Route Handler 这样要求

### 4.3 前端在 Next.js 里调

前端组件就用相对路径：

app/chat/page.tsx

```tsx
'use client'

import { useState } from 'react'

export default function ChatPage() {
  const [reply, setReply] = useState('')

  async function send() {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    })
    const data = await res.json()
    setReply(data.reply)
  }

  return (
    <div>
      <button onClick={send}>发送</button>
      <p>{reply}</p>
    </div>
  )
}
```

### 4.4 这种模式的优缺点

**优点**：

- 一份代码，一份部署

- 前端用相对路径，不用操心 CORS、baseURL

- Hono 的所有能力（中间件、校验、错误处理）都能用

**缺点**：

- 部署绑定 Vercel/Node 运行时，用不上 Cloudflare Workers 那些 binding（KV / D1 / R2 / Durable Objects）

- API 没法被别的前端独立消费

- Next.js 和 Hono 一起扩缩容

如果你不用 Cloudflare 的存储服务、也没有多端需求，模式 B 完全够用。

## 5. 模式 A：Hono 独立部署 + Next.js 通过 RPC 调

这是专栏之前的默认姿势——Hono 在 Workers 上，Next.js 独立部署。

### 5.1 Monorepo 结构

推荐用 yarn workspaces 或 pnpm workspaces：

index.tswrangler.jsoncindex.ts

`packages/shared` 里放所有跨前后端复用的东西：Zod schema、常量、TypeScript 类型。

### 5.2 后端导出 AppType

Hono app 必须用**链式写法**，最后导出 `typeof app`：

apps/api/src/index.ts

```typescript
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { ChatRequestSchema } from '@shared/schemas/chat'

const app = new Hono()
  .post('/api/chat', zValidator('json', ChatRequestSchema), async (c) => {
    const body = c.req.valid('json')
    return c.json({ reply: 'hello' })
  })
  .get('/api/usage', async (c) => {
    return c.json({ totalRequests: 123 })
  })

export type AppType = typeof app
export default app
```

`AppType` 是整个 API 的「类型合同」，等一下前端要 import 它。

### 5.3 前端用 hc 创建带类型的客户端

apps/web/lib/api.ts

```typescript
import { hc } from 'hono/client'
import type { AppType } from '@api/src/index'

// 服务端组件和客户端组件都能用
export const api = hc<AppType>(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787'
)
```

`NEXT_PUBLIC_*` 变量会被注入到浏览器侧。生产环境里填你的 Workers 域名（比如 `https://api.example.com`）。

### 5.4 在 React Server Component 里调

Server Component 里可以直接 `await`，没有额外仪式：

apps/web/app/usage/page.tsx

```tsx
import { api } from '@/lib/api'

export default async function UsagePage() {
  const res = await api.api.usage.$get()
  const data = await res.json()

  return (
    <div>
      <h1>用量统计</h1>
      <p>总请求数：{data.totalRequests}</p>
    </div>
  )
}
```

`data.totalRequests` 的类型是 Hono 后端 `c.json({...})` 自动推导出来的 `number`。**后端改字段名，前端 TypeScript 立即报错**——这是共享 AppType 的价值。

### 5.5 在 Client Component 里配合 React Query

apps/web/components/chat.tsx

```tsx
'use client'

import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function ChatForm() {
  const mutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await api.api.chat.$post({
        json: { message },
      })
      if (!res.ok) throw new Error('请求失败')
      return res.json()
    },
  })

  return (
    <div>
      <button
        onClick={() => mutation.mutate('你好')}
        disabled={mutation.isPending}
      >
        发送
      </button>
      {mutation.data && <p>{mutation.data.reply}</p>}
    </div>
  )
}
```

RPC client 返回的是标准 `Response` 对象，和 React Query 无缝配合。

## 6. 跨域：模式 A 必须处理的一件事

模式 B 里前后端同域，不用 CORS。模式 A 里两者不同域，Hono 侧必须显式配置 CORS：

apps/api/src/index.ts

```typescript
import { cors } from 'hono/cors'

const app = new Hono()
  .use(
    '*',
    cors({
      origin: [
        'http://localhost:3000',
        'https://your-nextjs-domain.com',
      ],
      credentials: true,  // 如果要带 Cookie
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      allowHeaders: ['Content-Type', 'Authorization'],
    })
  )
```

几个注意点：

- **origin 不能是通配符 `*`**：如果要带 Cookie（`credentials: true`），浏览器会拒绝 `*`

- **预检请求的顺序**：`cors` 中间件要在鉴权之前，第 6 篇中间件章节讲过

- **开发环境和生产环境的 origin 不一样**：用环境变量管理，别硬编码

## 7. 选哪种模式

决策树：

code.ts

```txt
  你想要 Cloudflare Workers 的 binding (KV/D1/R2/DO)？
    ├── 要 → 模式 A（API 必须部署到 Workers）
    └── 不要 → 继续看

  你的 API 会被多端（iOS/Android/第三方）用吗？
    ├── 会 → 模式 A（独立部署更干净）
    └── 不会 → 继续看

  你团队现在 1-3 个人吗？
    ├── 是 → 模式 B（一套代码一套部署更省心）
    └── 否 → 模式 A（大团队普遍受益于解耦）
```

一个很常见的演进路径：**先模式 B 起步，需求增长后拆出模式 A**。迁移代价不大，因为 Hono app 本身是纯函数，换一个导出方式就能跑在另一个环境。

## 8. 类型共享的小技巧

无论哪种模式，共享类型都是刚需。几个实用做法：

### 8.1 用 Zod schema 作真相源

（这和 Zod 章节讲的 SSOT 一致）

packages/shared/schemas/chat.ts

```typescript
import { z } from 'zod'

export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(8000),
  model: z.enum(['claude-opus-4-6', 'claude-haiku-4-5']).default('claude-opus-4-6'),
})

export type ChatRequest = z.infer<typeof ChatRequestSchema>
export type ChatRequestInput = z.input<typeof ChatRequestSchema>
```

- 后端用 `ChatRequestSchema` 做运行时校验

- 前端表单用 `ChatRequestInput`（带可选字段）作为类型

- 后端业务函数用 `ChatRequest`（默认值已填充）

### 8.2 把 AppType 放到 shared 包里

模式 A 下直接把 AppType 放到 shared package，前后端都从这里导：

packages/shared/api-types.ts

```typescript
export type { AppType } from '@api/src/index'
```

apps/web/lib/api.ts

```typescript
import { hc } from 'hono/client'
import type { AppType } from '@shared/api-types'

export const api = hc<AppType>(process.env.NEXT_PUBLIC_API_URL!)
```

好处：前端不需要直接依赖 `@api` 包的运行时代码，只拿类型。

### 8.3 避免「类型转悠一圈」

一个常见反模式：前端调 Hono → 拿到一个 Hono 类型 → 自己手写一个前端用的类型。**不要这么做**。Hono 自带了 `InferResponseType` 和 `InferRequestType` 两个工具，直接从 RPC client 的方法上抽出请求 / 响应的类型：

apps/web/lib/api.ts

```typescript
import type { InferResponseType, InferRequestType } from 'hono/client'
import { api } from './api'

// 响应体类型
export type ChatResponse = InferResponseType<typeof api.api.chat.$post>
// { reply: string }

// 请求入参类型（RPC client 的参数）
export type ChatRequestArgs = InferRequestType<typeof api.api.chat.$post>
// { json: { message: string; model?: ... } }
```

有了这两个工具，前端的自定义 hook、Redux slice、表单类型都可以复用后端的定义，不需要手写平行类型。

## 9. 小结

Hono 和 Next.js 的关系是**分工合作**，不是互相替代：

- **Next.js** 做渲染层（SSR / RSC / 静态站点）

- **Hono** 做 API 层（中间件链 / 类型推导 / 跨运行时部署）

两种集成模式：

| 模式 | 部署 | 适合 |
| --- | --- | --- |
| A：Hono 独立部署 | Workers + Next.js 各自独立 | 用 Cloudflare 存储、多端 API、中大型团队 |
| B：Hono 嵌在 Route Handler | 一起部署 | 单体应用、小团队、没有多端需求 |

跨模式都通用的最佳实践：

- **Zod schema 作为前后端共同真相源**

- **shared 包集中放类型和 schema**

- **模式 A 一定要处理 CORS**

- **RPC client 推导出的类型直接用**，不要手写平行定义

一句话带走：

NOTE

**Hono 不是 Next.js 的替代品，它是给 Next.js 补齐「API 层的中间件和类型安全」那一块的拼图。**

到这里，整个 Hono.js 章节完整收束。你现在已经拥有了从「一个 Workers Hello World」到「一个多服务、有状态、带可观测性、和 Next.js 前端类型链路贯通」的完整能力地图。接下来你要做的就是——真的开一个项目，把这些东西用起来。
