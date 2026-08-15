---
title: "90 RPC 客户端"
pubDate: 2026-05-10
description: "前面几篇我们写了不少 API：用户 CRUD、文件上传、JWT 认证。后端写好了，接下来前端怎么调？"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/15-hono-client-rpc/](https://aicompanion.usehook.cn/15-hono-client-rpc/)

## 1. 前后端协作的老问题

前面几篇我们写了不少 API：用户 CRUD、文件上传、JWT 认证。后端写好了，接下来前端怎么调？

最常见的做法就是 `fetch`：

api.ts

```typescript
const res = await fetch('http://localhost:8787/api/users?page=1&limit=10')
const data = await res.json()
// data 是 any，你不知道里面有什么字段
```

`data` 是 `any`，TypeScript 完全帮不上忙。所以你得自己写一套类型：

api.ts

```typescript
interface User {
  id: number
  name: string
  email: string
}

const data = (await res.json()) as { users: User[] }
```

问题来了——这个 `User` 类型是你对着后端代码手抄的。后端哪天把 `name` 改成了 `username`，你这边编译照样通过，上线才发现页面空白。

这个问题不止 `fetch` 有。即便你用 axios 封装了一层，本质也一样：**前端的类型和后端的实现之间没有任何约束关系**，全靠人肉保持同步。

团队协作里常见的解决方案是写 API 文档（Swagger/OpenAPI），然后用工具生成前端的类型定义。但这引入了额外的流程：后端改了接口要记得更新文档，前端要重新生成代码，中间任何一步忘了就又不同步了。

## 2. 什么是 RPC

在讲 Hono 的方案之前，先说清楚 RPC 这个词。

RPC 全称是 Remote Procedure Call（远程过程调用）。名字听起来吓人，意思很简单：**像调用本地函数一样调用远程服务器上的接口**。

用 `fetch` 调接口，你要关心的东西很多：URL 怎么拼、用 GET 还是 POST、参数放 body 还是 query、响应怎么解析。你时刻都在跟 HTTP 协议打交道。

RPC 的理想状态是把这些 HTTP 细节藏起来。你在前端写 `getUsers()`，它背后帮你发了一个 HTTP 请求，拿到结果直接返回给你。你不用关心 URL 是什么、用的什么 HTTP 方法，就像调用一个本地函数。

传统的 RPC 框架（gRPC、tRPC 等）需要额外的协议定义或者代码生成。Hono 的 RPC 客户端走了一条更轻的路：**利用 TypeScript 的类型系统，直接从后端路由定义中推导出前端的调用接口**。底层仍然是普通的 HTTP 请求，但前端写起来就像在调用函数。

## 3. Hono 的方案：共享路由类型

具体怎么做？分两步：

- 后端定义路由时，把路由对象的类型导出

- 前端引入这个类型，Hono 的客户端工具会根据类型自动生成带提示的调用方法

不需要手写 interface，不需要 Swagger，不需要代码生成。后端改了字段名，前端 TypeScript 编译直接报错——在你写代码的时候就能发现，而不是上线以后。

这种方式特别适合**前后端代码在同一个仓库**的项目（monorepo）。前端直接 `import type` 后端的路由类型，零成本同步，改一处全局生效。

## 4. 后端侧：链式路由定义

要让类型共享生效，后端的路由写法有一个要求：**必须用链式调用**。

先看代码，再解释为什么：

server.ts

```typescript
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

const app = new Hono()

// 链式写法：.get().post().get() 串在一起
const route = app
  .get('/users', async (c) => {
    const users = [
      { id: 1, name: 'Alice', email: 'alice@test.com' },
    ]
    return c.json({ users })
  })
  .post('/users', zValidator('json', createUserSchema), async (c) => {
    const data = c.req.valid('json')
    return c.json({ user: { id: 2, ...data } }, 201)
  })
  .get('/users/:id', async (c) => {
    const id = c.req.param('id')
    return c.json({ user: { id, name: 'Alice' } })
  })

// 导出路由类型，前端会用到
export type AppType = typeof route

export default app
```

这段代码有两个关键点，我们一个一个说。

### 为什么必须链式写法

你可能会问，之前写路由不是这样的吗：

code.ts

```typescript
app.get('/users', handler1)
app.post('/users', handler2)
```

分开写也能正常运行，但 TypeScript 推导不出路由信息。原因是这样的：

`app.get()` 返回的是 `Hono` 实例本身（方便你继续链式调用），但如果你不接住这个返回值，TypeScript 只知道 `app` 是一个 `Hono` 实例，不知道上面挂了哪些路由。

链式写法 `app.get(...).post(...).get(...)` 每一步调用都会返回一个带有"我注册了这些路由"信息的新类型。最终 `route` 变量的类型里就包含了所有路由的完整信息：每个路由的 URL、HTTP 方法、请求参数类型、响应类型。

### typeof route 导出了什么

`typeof` 是 TypeScript 的操作符，它的作用是"提取一个值的类型"。

code.ts

```typescript
const num = 42
type N = typeof num  // N 的类型是 number
```

同理，`typeof route` 提取的就是 `route` 变量的类型。因为链式写法让 `route` 的类型里包含了所有路由信息，所以 `AppType` 就像一份完整的"接口清单"——记录了每个路由的 URL、方法、参数和响应结构。

注意 `export type` 只导出类型，不导出运行时代码。前端引入 `AppType` 后不会把后端代码打包进去，它只在 TypeScript 编译期起作用。

## 5. 前端侧：hc 创建客户端

前端用 `hc` 函数创建客户端。`hc` 接收一个泛型参数——就是后端导出的 `AppType`：

client.ts

```typescript
import { hc } from 'hono/client'
import type { AppType } from './server'

// 创建客户端，传入后端的路由类型和服务器地址
const client = hc<AppType>('http://localhost:8787')
```

`hc` 拿到 `AppType` 之后，就知道后端有哪些路由、每个路由接收什么参数、返回什么数据。它会自动生成一个"镜像对象"，你通过这个对象的属性和方法来调用接口。

### URL 到属性的映射规则

后端的 URL 路径会被转换成对象的属性访问。规则很简单：

| 后端路由 | 前端调用 |
| --- | --- |
| GET /users | client.users.$get() |
| POST /users | client.users.$post() |
| GET /users/:id | client.users[':id'].$get() |
| GET /api/v1/posts | client.api.v1.posts.$get() |

总结就三条：

- URL 里的 `/` 变成 `.`（属性访问），`/users` → `client.users`

- HTTP 方法加 `$` 前缀变成方法调用，GET → `.$get()`，POST → `.$post()`

- 动态路由参数用方括号，`/users/:id` → `client.users[':id']`

来看实际使用：

client.ts

```typescript
// GET /users —— 获取用户列表
const res = await client.users.$get()
const data = await res.json()
// data 的类型自动推导为 { users: { id: number; name: string; email: string }[] }
// 不用手写 interface，TypeScript 已经知道 data 里有什么

// POST /users —— 创建用户
const res2 = await client.users.$post({
  json: { name: 'Bob', email: 'bob@test.com' },
})
const data2 = await res2.json()
// data2 的类型自动推导为 { user: { id: number; name: string; email: string } }
```

请求体通过 `{ json: ... }` 传入，不需要手动 `JSON.stringify`，也不需要设置 `Content-Type`，`hc` 都帮你处理了。

和用 `fetch` 写法对比一下：

code.ts

```typescript
// fetch 写法：URL 是字符串，响应是 any
const res = await fetch('http://localhost:8787/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Bob', email: 'bob@test.com' }),
})
const data = await res.json() // any

// hc 写法：URL 有提示，请求体有类型检查，响应有类型推导
const res2 = await client.users.$post({
  json: { name: 'Bob', email: 'bob@test.com' },
})
const data2 = await res2.json() // { user: { id: number; name: string; email: string } }
```

两种写法底层做的事一模一样，都是发 HTTP 请求。区别只在于 `hc` 帮你加了类型约束，写错了 IDE 立刻标红。

## 6. 各种参数的类型推导

上一节展示了基本的 GET 和 POST 调用。实际开发中，接口的参数不止是请求体，还有路由参数（`/users/:id`）、查询参数（`?page=1`）等。这些参数在 `hc` 里全都有类型保护。

### 路由参数

client.ts

```typescript
// GET /users/:id
const res = await client.users[':id'].$get({
  param: { id: '1' },
})
const data = await res.json()
// data: { user: { id: string; name: string } }
```

路径参数通过 `param` 传入，key 必须和后端定义的 `:id` 匹配，TypeScript 会检查。

### 查询参数

后端加上查询参数校验：

server.ts

```typescript
const querySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
})

const route = app
  .get('/users', zValidator('query', querySchema), async (c) => {
    const { page, limit } = c.req.valid('query')
    return c.json({ users: [], page, limit })
  })
```

前端调用时自动提示查询参数：

client.ts

```typescript
const res = await client.users.$get({
  query: { page: '1', limit: '10' },
})
```

`query` 对象的类型由后端的 `querySchema` 自动推导，多传、少传、类型错误都会报错。

### 请求体

如果后端用了 `zValidator('json', schema)`，前端的 `json` 参数类型就是 schema 推导出来的：

client.ts

```typescript
const res = await client.users.$post({
  json: {
    name: 'Alice',
    email: 'alice@test.com',
    // 如果多传一个 schema 里没有的字段，TypeScript 会报错
  },
})
```

## 7. 与 React Query 配合

`hc` 客户端返回的是标准的 `Response` 对象，所以和 React Query / SWR 配合毫无障碍：

users.tsx

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hc } from 'hono/client'
import type { AppType } from './server'

const client = hc<AppType>('http://localhost:8787')

function UserList() {
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await client.users.$get()
      return res.json()
    },
  })

  if (isLoading) return <div>加载中...</div>

  return (
    <ul>
      {data?.users.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  )
}
```

配合 `useMutation` 处理创建操作：

users.tsx

```tsx
function CreateUser() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (input: { name: string; email: string }) => {
      const res = await client.users.$post({ json: input })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const handleSubmit = () => {
    mutation.mutate({ name: 'Alice', email: 'alice@test.com' })
  }

  return <button onClick={handleSubmit}>创建用户</button>
}
```

`queryFn` 和 `mutationFn` 的返回类型都是自动推导的，不需要手动传泛型。

## 8. app.route 挂载的处理

实际项目中，路由通常按模块拆分，用 `app.route()` 挂载。这时候需要额外处理一下类型：

users.ts

```typescript
// 用户模块
import { Hono } from 'hono'

const users = new Hono()
  .get('/', async (c) => {
    return c.json({ users: [] })
  })
  .post('/', async (c) => {
    return c.json({ user: { id: 1 } }, 201)
  })

export default users
```

server.ts

```typescript
// 主入口
import { Hono } from 'hono'
import users from './users'

const app = new Hono()

// 挂载子路由
const route = app.route('/users', users)

// 导出类型
export type AppType = typeof route
```

前端调用方式不变：

client.ts

```typescript
const client = hc<AppType>('http://localhost:8787')

// /users 路径已经被 app.route 挂载了
const res = await client.users.$get()
```

关键点：`app.route()` 的返回值也要赋给变量，再用 `typeof` 导出类型。不能直接 `export type AppType = typeof app`，那样拿不到子路由的类型信息。

## 9. 限制和注意事项

`hono/client` 很好用，但有几个地方要注意：

**底层还是 HTTP fetch**

`hc` 不是真正的 RPC 框架。它底层就是 `fetch`，只是给你提供了类型安全的调用方式。返回的也是标准的 `Response` 对象，你还是要 `await res.json()` 来拿数据。

**前后端必须共享类型**

前端需要 `import type { AppType }` 才能拿到类型。这意味着前后端代码要在同一个项目里，或者至少能互相引用类型。monorepo 是最适合的场景。

**链式写法是硬性要求**

只有链式写法的路由才能被 TypeScript 推导。如果你的路由是分开写的：

server.ts

```typescript
// 这样写不行，类型会丢失
app.get('/users', handler1)
app.post('/users', handler2)
```

必须改成链式：

server.ts

```typescript
// 这样才行
const route = app
  .get('/users', handler1)
  .post('/users', handler2)
```

**类型只在编译期生效**

`hc` 的类型安全完全依赖 TypeScript 编译期检查。运行时该出错还是会出错，比如后端部署了新版本但前端没更新。

## 10. 总结

`hono/client` 解决了前后端类型不同步的问题。后端定义路由，前端 import 类型，URL、参数、响应体全部自动推导。

核心用法：

- 后端用链式写法定义路由，`export type AppType = typeof route`

- 前端用 `hc<AppType>(baseURL)` 创建客户端

- 调用时 `client.path.$method({ json, query, param })` 全部类型安全

- 和 React Query / SWR 配合，`queryFn` 里直接用 `client` 调用

下一篇讲流式响应与 SSE，看看 Hono 怎么处理需要持续推送数据的场景。
