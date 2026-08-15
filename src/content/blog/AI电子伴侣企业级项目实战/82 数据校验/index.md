---
title: "82 数据校验"
pubDate: 2026-05-07
description: "用户提交的数据永远不可信。少一个字段、类型不对、格式错误，这些情况每天都在发生。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/7-validation/](https://aicompanion.usehook.cn/7-validation/)

## 1. 为什么需要数据校验

用户提交的数据永远不可信。少一个字段、类型不对、格式错误，这些情况每天都在发生。

手动校验长这样：

index.ts

```typescript
app.post('/users', async (c) => {
  const body = await c.req.json()

  if (!body.name || typeof body.name !== 'string') {
    return c.json({ error: 'name is required' }, 400)
  }
  if (!body.email || typeof body.email !== 'string') {
    return c.json({ error: 'email is required' }, 400)
  }
  if (!body.email.includes('@')) {
    return c.json({ error: 'invalid email' }, 400)
  }

  // 终于可以写业务逻辑了...
})
```

问题很明显：又丑又容易漏，字段一多就失控。而且校验完之后，TypeScript 依然不知道 `body` 的类型是什么，你还得手动断言。

Hono + Zod 的方案：用 schema 声明数据结构，校验和类型推导一步到位。

什么是 **schema**

如果你第一次接触后端校验，可以先把 schema 理解成一份**数据规则说明书**。它不是实际的数据，而是用来描述「什么样的数据才算合法」

比如下面这段数据：

data.json

```json
{
  "name": "Alice",
  "email": "alice@example.com"
}
```

它对应的 schema 想表达的是：

- `name` 这个字段必须存在

- `name` 必须是字符串

- `email` 这个字段必须存在

- `email` 必须是合法邮箱格式

也就是说，schema 回答的不是「数据是什么」，而是「数据应该长什么样」

在没有 schema 的时候，这些规则通常散落在很多 `if` 判断里；有了 schema，这些规则就被集中写到一个地方，代码会更清楚。

用 Zod 写出来就是这样：

index.ts

```typescript
const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})
```

这段 schema 可以直接读成自然语言：

- 整体是一个对象 `z.object({...})`

- `name` 是字符串，而且不能为空

- `email` 是字符串，而且必须符合邮箱格式

所以后面你看到 `schema` 这个词时，不要把它想得太玄。你就把它当成一份「输入数据的规则定义」就行

## 2. 安装依赖

terminal

```shellscript
npm install zod @hono/zod-validator
```

- **zod**：TypeScript-first 的数据校验库，定义 schema 的同时自动生成类型

- **@hono/zod-validator**：Hono 官方的 Zod 集成，把 Zod schema 变成路由中间件

## 3. 基础用法

index.ts

```typescript
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const app = new Hono()

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

app.post('/users', zValidator('json', createUserSchema), (c) => {
  const data = c.req.valid('json')
  // data 的类型自动推导为 { name: string; email: string }
  return c.json({ id: 1, ...data }, 201)
})

export default app
```

`zValidator('json', schema)` 做了两件事：

- **校验**：请求体不符合 schema 时，中间件会直接拦截请求，默认返回一份 400 错误响应，请求根本不会进入你的处理函数

- **类型推导**：`c.req.valid('json')` 的返回类型由 schema 自动推导，不需要手写 interface

校验不通过时，默认返回的错误格式：

response.json

```json
{
  "success": false,
  "error": {
    "issues": [
      {
        "code": "too_small",
        "minimum": 1,
        "message": "String must contain at least 1 character(s)",
        "path": ["name"]
      }
    ]
  }
}
```

## 4. 校验不同位置的数据

HTTP 请求的数据可能出现在不同位置，`zValidator` 的第一个参数指定校验哪里的数据：

### 校验请求体（JSON）

index.ts

```typescript
const bodySchema = z.object({
  title: z.string().min(1),
  content: z.string(),
})

app.post('/posts', zValidator('json', bodySchema), (c) => {
  const body = c.req.valid('json')
  return c.json(body, 201)
})
```

这里有一个很容易踩的坑：如果你要校验 JSON，请求头里要正确带上 `Content-Type: application/json`。否则服务端可能根本不会按 JSON 的方式去解析请求体，最后你会觉得“明明传了数据，怎么校验不对”。

### 校验查询参数

index.ts

```typescript
const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().default(10),
})

app.get('/posts', zValidator('query', querySchema), (c) => {
  const { page, limit } = c.req.valid('query')
  // page 和 limit 已经是 number 类型
  return c.json({ page, limit })
})
```

注意：查询参数从 URL 解析出来本来都是字符串，这里用 `z.coerce.number()` 的意思是“先接收字符串，再自动帮你转成 number”。对新手来说，这种写法通常比 `z.string().transform(Number)` 更直观。

### 校验路由参数

index.ts

```typescript
const paramSchema = z.object({
  id: z.string().regex(/^\d+$/),
})

app.get('/users/:id', zValidator('param', paramSchema), (c) => {
  const { id } = c.req.valid('param')
  return c.json({ id })
})
```

### 校验请求头

index.ts

```typescript
const headerSchema = z.object({
  'x-api-key': z.string().min(1),
})

app.get('/admin/stats', zValidator('header', headerSchema), (c) => {
  const headers = c.req.valid('header')
  return c.json({ key: headers['x-api-key'] })
})
```

## 5. 自定义错误响应

默认的错误格式可能不符合你的 API 规范。`zValidator` 的第三个参数是一个 hook 函数，让你自定义错误响应：

index.ts

```typescript
app.post(
  '/users',
  zValidator('json', createUserSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          code: 'VALIDATION_ERROR',
          errors: result.error.flatten().fieldErrors,
        },
        400
      )
    }
  }),
  (c) => {
    const data = c.req.valid('json')
    return c.json({ id: 1, ...data }, 201)
  }
)
```

`result.error.flatten()` 会把 Zod 的错误信息整理成更易读的格式：

response.json

```json
{
  "code": "VALIDATION_ERROR",
  "errors": {
    "name": ["String must contain at least 1 character(s)"],
    "email": ["Invalid email"]
  }
}
```

如果你的每个接口都需要统一的错误格式，可以封装一个工具函数：

这一段已经属于进阶写法了。如果你刚开始学，先会直接写 `zValidator('json', schema)` 就够了。下面这个封装的重点，不是让你背泛型，而是让你知道：**同一种错误响应格式，是可以抽成工具复用的。**

index.ts

```typescript
import type { ValidationTargets } from 'hono'
import type { ZodSchema } from 'zod'

function validate<T extends keyof ValidationTargets>(target: T, schema: ZodSchema) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          code: 'VALIDATION_ERROR',
          errors: result.error.flatten().fieldErrors,
        },
        400
      )
    }
  })
}

// 使用
app.post('/users', validate('json', createUserSchema), (c) => {
  const data = c.req.valid('json')
  return c.json(data, 201)
})
```

## 6. 组合多个校验器

一个路由可以同时校验多个位置的数据，把多个 `zValidator` 当中间件依次挂上去就行：

index.ts

```typescript
const paramSchema = z.object({
  id: z.string().regex(/^\d+$/),
})

const bodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

const headerSchema = z.object({
  'x-api-key': z.string().min(1),
})

app.put(
  '/users/:id',
  zValidator('param', paramSchema),
  zValidator('json', bodySchema),
  zValidator('header', headerSchema),
  (c) => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    // 三个位置的数据都校验通过，类型都自动推导
    return c.json({ id, ...body })
  }
)
```

校验顺序就是中间件的排列顺序。第一个校验不通过，后面的不会执行。

## 7. 类型推导的价值

传统做法是手写一个 interface，然后在运行时另外写一套校验逻辑。两边要保持同步，改了一边忘了另一边就是 bug。

Zod 的方案是 **schema 即类型**。如果你需要在其他地方使用校验后的类型，用 `z.infer` 提取：

index.ts

```typescript
const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().min(0).optional(),
})

// 从 schema 推导出类型，不需要手写 interface
type CreateUserInput = z.infer<typeof createUserSchema>
// { name: string; email: string; age?: number | undefined }

function saveUser(input: CreateUserInput) {
  // ...
}

app.post('/users', zValidator('json', createUserSchema), (c) => {
  const data = c.req.valid('json')
  saveUser(data) // 类型完全匹配，不需要任何转换
  return c.json({ success: true }, 201)
})
```

一个 schema，同时解决校验和类型两个问题。改 schema 的时候 TypeScript 会自动提示所有受影响的地方。

## 8. 总结

`zValidator` 把数据校验从业务逻辑中剥离出来，变成声明式的中间件。schema 定义一次，校验和类型推导都有了。

核心用法就三个：

- `zValidator('json' | 'query' | 'param' | 'header', schema)` — 校验指定位置的数据

- 第三个参数 hook 函数 — 自定义错误响应

- `c.req.valid('json')` — 拿到校验后的数据，类型自动推导

下一篇讲错误处理，看看怎么统一处理校验错误、业务错误和未知异常。
