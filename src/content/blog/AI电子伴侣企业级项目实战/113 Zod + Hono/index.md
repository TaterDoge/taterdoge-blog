---
title: "113 Zod + Hono"
pubDate: 2026-05-17
description: "前面 11 篇学的一切——基础类型、组合结构、refine、transform、input/output、派生 schema——都不是为了让你会写 schema，而是为了让你会设计一条从请求到响应都类型安全的接口链路。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/12-zod-with-hono/](https://aicompanion.usehook.cn/12-zod-with-hono/)

## 1. 把前面 11 篇放进一个真实 API 里

前面 11 篇学的一切——基础类型、组合结构、refine、transform、input/output、派生 schema——**都不是为了让你会写 schema**，而是为了让你会设计一条**从请求到响应都类型安全的接口链路**。

这一篇我们正式把 Zod 放到 Hono 里跑起来。Hono 章节已经讲过 `zValidator` 的基础用法，这里不重复那些，我们聚焦**真实项目里更完整的实战模式**：

- **请求校验**：body / query / params / headers 四个位置全覆盖

- **响应校验**：为什么「防御自己的后端」一点都不多余

- **统一的错误格式**：把 `ZodError` 翻译成前端能直接用的结构

- **共享 schema**：前后端共用一份真相源

- **端到端类型推导**：让前端调用接口像调用本地函数一样

安装（如果上一章没装过）：

index.bash

```shellscript
yarn add hono zod @hono/zod-validator
```

## 2. 请求校验：四个位置都不能漏

HTTP 请求里会出现用户数据的位置有四个：body / query / params / headers。真实接口里**经常不止校验 body**。

`@hono/zod-validator` 通过 `zValidator('<target>', schema)` 分别处理每一个位置：

api/post.ts

```typescript
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const app = new Hono()

// 创建帖子
app.post(
  '/posts/:userId',
  // path params
  zValidator('param', z.object({
    userId: z.string().uuid(),
  })),
  // query string
  zValidator('query', z.object({
    draft: z.coerce.boolean().default(false),
  })),
  // headers
  zValidator('header', z.object({
    authorization: z.string().startsWith('Bearer '),
  })),
  // body
  zValidator('json', z.object({
    title: z.string().min(1).max(100),
    content: z.string().min(1),
  })),
  async (c) => {
    const { userId } = c.req.valid('param')
    const { draft }  = c.req.valid('query')
    const body       = c.req.valid('json')
    // 到这一行，四个来源的数据都已经**类型安全且合法**
    return c.json({ ok: true, userId, draft, title: body.title })
  }
)
```

### 2.1 注意 query 的类型

query 从 URL 里来，**所有值本质都是字符串**。所以对非字符串字段一定要用 `z.coerce.*` 或 `z.string().transform(...)`，不能用 `z.number()`：

index.ts

```typescript
// ❌ 前端传 ?page=2 会校验失败
zValidator('query', z.object({ page: z.number() }))

// ✅ 正确写法
zValidator('query', z.object({ page: z.coerce.number().int().min(1).default(1) }))
```

这是**最常见的 Hono + Zod bug**——所以第 4 篇专门留了 coerce 一节。

### 2.2 form 也有对应 target

如果前端发的是 `application/x-www-form-urlencoded` 或 `multipart/form-data`，把 target 换成 `form`：

index.ts

```typescript
zValidator('form', z.object({
  name: z.string(),
  file: z.instanceof(File),
}))
```

## 3. 响应校验：「防御自己的后端」

很多人只在**入口**校验请求，**出口**直接 `return c.json(data)` 就完事。这是一个被严重低估的坏习惯。

响应校验能在开发期抓住三类问题：

- **数据库字段改了，你忘了改响应结构**（DTO 和 Entity 不一致）

- **业务层返回了敏感字段**（密码、内部 token）

- **LLM / 外部 API 返回了和你声明结构不一致的数据**

写法很简单——用第 11 篇讲的 `PublicUserSchema` 派生 schema 做一次 `parse`：

api/user.ts

```typescript
import { UserSchema, PublicUserSchema } from '@shared/schemas/user'

app.get('/users/:id', async (c) => {
  const user = await db.user.findUnique({ where: { id: c.req.param('id') } })

  // ✅ 出口校验：只返回白名单字段，顺便挡住未来的「敏感字段泄露」
  const safe = PublicUserSchema.parse(user)

  return c.json(safe)
})
```

这一步**免费**给你三层保障：

- 不会漏字段：如果 `user` 缺字段，`parse` 直接抛错

- 不会多字段：`.pick()` 白名单只保留指定字段，`password` 永远不会被带出去

- 类型收窄：TypeScript 确定你返回的是 `PublicUser`，下游调用方得到精确类型

一句话：**请求校验防用户乱传，响应校验防自己乱写。**

## 4. 统一 ZodError 的错误格式

默认情况下 `zValidator` 在校验失败时会返回 400，但错误结构不一定符合你前端想要的格式。真实项目里通常需要**自己定义一个统一的 API 错误结构**：

index.json

```json
{
  "ok": false,
  "code": "VALIDATION_ERROR",
  "errors": [
    { "field": "email", "message": "Invalid email" },
    { "field": "password", "message": "String must contain at least 8 character(s)" }
  ]
}
```

### 4.1 zValidator 的第三参数

`zValidator` 的第三参数是一个回调，能拦截校验结果自定义响应：

lib/validator.ts

```typescript
import { zValidator as zv } from '@hono/zod-validator'
import type { ZodSchema } from 'zod'
import type { ValidationTargets } from 'hono'

// 封装：所有接口用同一个错误格式
export const validate = <T extends ZodSchema>(
  target: keyof ValidationTargets,
  schema: T,
) => zv(target, schema, (result, c) => {
  if (!result.success) {
    return c.json({
      ok: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    }, 400)
  }
})
```

然后项目里所有路由都用这个封装：

index.ts

```typescript
import { validate } from './lib/validator'

app.post('/register',
  validate('json', RegisterBodySchema),
  async (c) => {
    const body = c.req.valid('json')
    // ...
  }
)
```

一旦统一格式，前端就可以写一个**通用的错误处理工具**，把 `errors` 数组直接塞进 react-hook-form 的 `setError`——UI 层几乎不用写逻辑。

### 4.2 全局错误兜底

除了 `zValidator`，业务代码里也可能直接抛 `ZodError`（比如你用 `schema.parse(externalData)` 校验 LLM 返回）。统一兜底用 Hono 的 `app.onError`：

index.ts

```typescript
import { ZodError } from 'zod'

app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json({
      ok: false,
      code: 'VALIDATION_ERROR',
      errors: err.issues.map(i => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    }, 400)
  }
  return c.json({ ok: false, code: 'INTERNAL', message: err.message }, 500)
})
```

**这两层错误处理一起用**，你整个后端只需要一套错误格式，前端也永远知道该期待什么。

## 5. 共享 schema：前后端一份真相源

真实项目里，schema 不应该只存在于后端。在 monorepo 里我们把它放到一个共享包：

text

```text
packages/
├── shared/
│   └── src/schemas/       ← 所有 schema 都在这
│       ├── user.ts
│       ├── chat.ts
│       └── index.ts
├── server/                ← Hono 后端，导入 shared
└── web/                   ← 前端，也导入 shared
```

然后：

packages/shared/src/schemas/user.ts

```typescript
import { z } from 'zod'

export const RegisterBodySchema = z.object({
  name: z.string().min(1).max(50),
  email: z.string().email(),
  password: z.string().min(8),
})
export type RegisterBody = z.infer<typeof RegisterBodySchema>
export type RegisterBodyInput = z.input<typeof RegisterBodySchema>
```

**后端用它做服务端校验：**

packages/server/routes/auth.ts

```typescript
import { RegisterBodySchema } from '@shared/schemas/user'
import { validate } from '../lib/validator'

app.post('/register', validate('json', RegisterBodySchema), async (c) => {
  const body = c.req.valid('json')
  // ...
})
```

**前端用它做表单校验：**

packages/web/register.tsx

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { RegisterBodySchema, type RegisterBodyInput } from '@shared/schemas/user'

export function RegisterForm() {
  const form = useForm<RegisterBodyInput>({
    resolver: zodResolver(RegisterBodySchema),
  })
  // 前后端校验规则完全一致，任意一端改 schema，另一端立刻报类型错
}
```

这是第 2 篇讲的 SSOT 原则在项目里最完整的落地形态。以后你改一个字段的校验规则，**前端和后端会同时被迫跟上**，不会再出现「前端放行，后端拒绝」的经典 bug。

## 6. RPC 式客户端：让调接口像调函数

Hono 有一个让人上瘾的能力叫 **RPC client**：它能把你的路由定义**直接推导成客户端的类型**。配合 Zod，端到端类型推导一步到位。

server/app.ts

```typescript
import { Hono } from 'hono'
import { validate } from './lib/validator'
import { RegisterBodySchema, PublicUserSchema } from '@shared/schemas/user'

const app = new Hono()
  .post('/register',
    validate('json', RegisterBodySchema),
    async (c) => {
      const body = c.req.valid('json')
      const user = await createUser(body)
      return c.json(PublicUserSchema.parse(user))
    }
  )

// 把整个 app 的类型导出
export type AppType = typeof app
export default app
```

前端：

web/api.ts

```typescript
import { hc } from 'hono/client'
import type { AppType } from '@shared/server-types'

export const api = hc<AppType>('http://localhost:8787')

// 调用
const res = await api.register.$post({
  json: {
    name: 'Alice',
    email: 'alice@example.com',
    password: 'password123',
  },
})

if (res.ok) {
  const user = await res.json()
  // user 的类型是 PublicUser（由 PublicUserSchema.parse 推导而来）
}
```

关键的地方：

- 前端 `api.register.$post` 的**入参类型**由 `RegisterBodySchema` 决定（z.input）

- 前端 `await res.json()` 的**返回类型**由 `PublicUserSchema` 决定（z.output）

- 后端改任意一端的 schema，前端的类型提示立刻变化

**一条链路三段：zod schema → hono 路由 → hono client → 前端代码，类型一以贯之。**

这也是为什么专栏里一直强调「schema 要导出本体，不只是类型」——少了 schema 本体，Hono 的类型推导就断了。

## 7. 一个完整的 User CRUD 示例

把前面所有东西放进一个小而全的例子里：

packages/shared/src/schemas/user.ts

```typescript
import { z } from 'zod'

export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(50),
  email: z.string().email(),
  password: z.string().min(8),
  createdAt: z.date(),
})
export type User = z.infer<typeof UserSchema>

// 派生（第 11 篇的模式）
export const PublicUserSchema = UserSchema.pick({
  id: true, name: true, email: true, createdAt: true,
})
export const CreateUserBodySchema = UserSchema.pick({
  name: true, email: true, password: true,
})
export const UpdateUserBodySchema = UserSchema.pick({
  name: true, email: true,
}).partial()
export const UserIdParamSchema = z.object({
  id: z.string().uuid(),
})
export const ListUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
```

packages/server/routes/users.ts

```typescript
import { Hono } from 'hono'
import { validate } from '../lib/validator'
import {
  PublicUserSchema,
  CreateUserBodySchema,
  UpdateUserBodySchema,
  UserIdParamSchema,
  ListUsersQuerySchema,
} from '@shared/schemas/user'

export const users = new Hono()
  // 列表
  .get('/',
    validate('query', ListUsersQuerySchema),
    async (c) => {
      const { page, pageSize } = c.req.valid('query')
      const list = await db.user.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      return c.json(list.map(u => PublicUserSchema.parse(u)))
    }
  )
  // 详情
  .get('/:id',
    validate('param', UserIdParamSchema),
    async (c) => {
      const user = await db.user.findUnique({ where: { id: c.req.valid('param').id } })
      if (!user) return c.json({ ok: false, code: 'NOT_FOUND' }, 404)
      return c.json(PublicUserSchema.parse(user))
    }
  )
  // 创建
  .post('/',
    validate('json', CreateUserBodySchema),
    async (c) => {
      const created = await db.user.create({ data: c.req.valid('json') })
      return c.json(PublicUserSchema.parse(created), 201)
    }
  )
  // 更新
  .patch('/:id',
    validate('param', UserIdParamSchema),
    validate('json', UpdateUserBodySchema),
    async (c) => {
      const updated = await db.user.update({
        where: { id: c.req.valid('param').id },
        data: c.req.valid('json'),
      })
      return c.json(PublicUserSchema.parse(updated))
    }
  )
  // 删除
  .delete('/:id',
    validate('param', UserIdParamSchema),
    async (c) => {
      await db.user.delete({ where: { id: c.req.valid('param').id } })
      return c.json({ ok: true })
    }
  )
```

整个 CRUD 里：

- **每个接口的每个入口都被校验了**（param / query / json）

- **每个响应都经过 `PublicUserSchema.parse`**，密码绝不会被带出

- **所有 schema 都从 `UserSchema` 派生**，不手写任何重复定义

- **前端通过 Hono RPC 客户端拿到完整的入参出参类型**，不需要额外写一行类型声明

这差不多是目前 TypeScript 生态里能做到的类型安全的天花板——而它的基础积木，就是你前面 11 篇学的东西。

## 8. 总结

这一篇把整个专栏推进到「真实可工作的 API 层」：

- **请求校验** — `zValidator` 覆盖 body / query / params / headers / form 五个位置

- **响应校验** — 用派生 schema 做出口 `.parse`，防字段漏、防敏感泄露

- **统一错误格式** — 封装 `validate` + 全局 `onError` 兼 `ZodError`

- **共享 schema** — monorepo 的 `packages/shared/schemas`，前后端同源

- **Hono RPC 客户端** — 从 schema → 路由 → 客户端 → 调用处，类型一以贯之

- **CRUD 模板** — 能直接搬到项目里用的完整例子

一张最值得收藏的原则表：

| 层级 | 用 Zod 做什么 |
| --- | --- |
| HTTP 入口 | 校验 body/query/param/header |
| 业务层 | 不重复校验，相信入口已经校验 |
| HTTP 出口 | 用派生 schema 做 parse，防御敏感字段 |
| 前端 API 客户端 | 从共享 schema 拿类型 + 响应再校验一次 |
| 前端表单 | zodResolver 用同一份 schema |

一句话带走：

NOTE

**把 schema 放到共享层——从那一刻起，你的前后端不再是两个项目，而是一条类型连通的流水线。**

下一篇进入实战篇的第二弹：**Zod + LLM：Structured Output 与 AI 响应校验**。这是 AI 项目里最有价值、也最容易踩坑的一环——模型返回的 JSON 从来不像文档承诺的那么规整，Zod 是你唯一的护栏。
