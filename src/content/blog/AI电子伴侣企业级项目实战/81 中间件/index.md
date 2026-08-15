---
title: "81 中间件"
pubDate: 2026-05-07
description: "核心就是 await next。它把中间件分成两半：next 之前处理请求，next 之后处理下游中间件或路由返回后的阶段。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/6-middleware/](https://aicompanion.usehook.cn/6-middleware/)

## 1. 中间件的基本形式

Hono 的中间件长这样：

index.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

app.use('*', async (c, next) => {
  // 请求到达路由之前，做点事情
  console.log('请求进来了')

  await next() // 把请求交给下一个中间件或路由处理

  // 路由处理完了，响应出去之前，做点事情
  console.log('响应出去了')
})

app.get('/', (c) => {
  return c.text('Hello!')
})

export default app
```

核心就是 `await next()`。它把中间件分成两半：`next()` 之前处理请求，`next()` 之后处理下游中间件或路由返回后的阶段。

你也可以把它理解成一个分叉点：

- 调用 `await next()`：请求继续往后走，交给下一个中间件或最终路由

- 直接 `return c.json(...)` / `return c.text(...)`：当前中间件就把请求结束掉，后面的逻辑不再执行

鉴权、权限判断、参数拦截，本质上都是在这里决定"放行"还是"拦截"。

## 2. 洋葱模型

如果你用过 Koa，这个概念不陌生。多个中间件的执行顺序像剥洋葱：

index.ts

```typescript
app.use('*', async (c, next) => {
  console.log('中间件 A - 进')
  await next()
  console.log('中间件 A - 出')
})

app.use('*', async (c, next) => {
  console.log('中间件 B - 进')
  await next()
  console.log('中间件 B - 出')
})

app.get('/', (c) => {
  console.log('路由处理')
  return c.text('Hello!')
})
```

控制台输出：

output.txt

```txt
中间件 A - 进
中间件 B - 进
路由处理
中间件 B - 出
中间件 A - 出
```

请求从外到内穿过中间件，响应从内到外返回。先注册的中间件最先接触请求、最后接触返回阶段。

## 3. 自定义中间件：请求计时

一个实用的中间件——记录每个请求花了多长时间：

index.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

// 请求计时中间件
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  const duration = Date.now() - start
  console.log(`${c.req.method} ${c.req.path} - ${duration}ms`)
})

app.get('/', (c) => {
  return c.text('Hello!')
})

export default app
```

`await next()` 前记录开始时间，`await next()` 后计算耗时。洋葱模型的经典用法。

## 4. 自定义中间件：简单鉴权

检查请求头里有没有合法的 API Key：

index.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

// 鉴权中间件
// 这里为了先讲清概念，先省略 Hono 的类型声明
const authMiddleware = async (c, next) => {
  const apiKey = c.req.header('X-API-Key')

  if (apiKey !== 'my-secret-key') {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
}

// 公开接口，不需要鉴权
app.get('/', (c) => {
  return c.text('Public')
})

// 需要鉴权的接口
app.get('/api/secret', authMiddleware, (c) => {
  return c.json({ data: 'This is secret' })
})

export default app
```

注意：如果鉴权失败，直接 `return c.json(...)` 就行，不调用 `next()`，请求就不会继续往下走。

如果你在 TypeScript 严格模式里写项目，后面最好把这类中间件补上类型，或者直接使用 Hono 提供的 `createMiddleware()` 来创建中间件。教程这里先把注意力放在执行流程本身。

## 5. 内置中间件

Hono 自带了一批开箱即用的中间件，不用自己造轮子：

index.ts

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { timing } from 'hono/timing'
import { prettyJSON } from 'hono/pretty-json'
import { secureHeaders } from 'hono/secure-headers'

const app = new Hono()

// 请求日志：控制台打印每个请求的方法、路径、状态码、耗时
app.use('*', logger())

// 跨域配置：允许前端跨域访问
app.use('*', cors({
  origin: 'http://localhost:3000',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
}))

// Server-Timing 头：响应头里带上各阶段耗时，浏览器 DevTools 可以看到
app.use('*', timing())

// 美化 JSON：请求 URL 加 ?pretty 参数时，返回格式化的 JSON
app.use('*', prettyJSON())

// 安全响应头：自动设置 X-Frame-Options、X-Content-Type-Options 等
app.use('*', secureHeaders())

app.get('/api/users', (c) => {
  return c.json([
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ])
})

export default app
```

每个中间件干的事情：

- **`logger()`**：控制台打印 `<-- GET /api/users` 和 `--> GET /api/users 200 12ms`

- **`cors()`**：处理跨域预检请求（OPTIONS），设置 `Access-Control-Allow-*` 响应头

- **`timing()`**：在响应头加 `Server-Timing` 字段，方便性能分析

- **`prettyJSON()`**：访问 `/api/users?pretty` 时返回缩进后的 JSON

- **`secureHeaders()`**：一键设置安全相关的 HTTP 头，防 XSS、点击劫持等

## 6. 中间件挂载范围

中间件可以作用在不同范围：

index.ts

```typescript
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'

const app = new Hono()

// 全局中间件：所有路由都会经过
app.use('*', logger())

// 路径级中间件：只有 /api 开头的路由会经过
app.use('/api/*', cors())

// 鉴权中间件，只用在 /api 下
const auth = async (c, next) => {
  const token = c.req.header('Authorization')
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
}
app.use('/api/*', auth)

// 单个路由级别：把中间件直接写在路由参数里
const adminOnly = async (c, next) => {
  const role = c.req.header('X-Role')
  if (role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await next()
}

app.delete('/api/users/:id', adminOnly, (c) => {
  const id = c.req.param('id')
  return c.json({ message: `User ${id} deleted` })
})

// 公开路由，不受 /api/* 的中间件影响
app.get('/', (c) => {
  return c.text('Public homepage')
})

export default app
```

三种粒度：

- **`app.use('*', ...)`**：全局，所有请求都过

- **`app.use('/api/*', ...)`**：路径前缀匹配，只有 `/api/` 下的请求会过

- **`app.get('/path', middleware, handler)`**：只对这一个路由生效

## 7. 执行顺序很重要

中间件按注册顺序执行。顺序搞错了会出问题：

index.ts

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

const app = new Hono()

// 正确顺序：cors 在鉴权之前
// 因为浏览器跨域会先发 OPTIONS 预检请求
// 如果鉴权在 cors 之前，预检请求没带 token，直接被 401 了
app.use('*', logger())
app.use('*', cors())
app.use('/api/*', async (c, next) => {
  const token = c.req.header('Authorization')
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

app.get('/api/data', (c) => {
  return c.json({ message: 'Protected data' })
})

export default app
```

一般推荐的顺序：`logger` → `cors` → `secureHeaders` → 鉴权 → 业务逻辑。日志最先，这样所有请求（包括被拦截的）都能被记录到。

## 8. 用 c.set / c.get 在中间件和路由之间传数据

中间件处理完的结果，怎么传给后面的路由？用 `c.set()` 和 `c.get()`：

index.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

// 鉴权中间件：解析 token，把用户信息存到 context 里
app.use('/api/*', async (c, next) => {
  const token = c.req.header('Authorization')

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // 假设解析 token 得到了用户信息
  const user = { id: 1, name: 'Alice', role: 'admin' }

  // 把用户信息存到 context 里
  c.set('user', user)

  await next()
})

// 路由里通过 c.get() 拿到用户信息
app.get('/api/profile', (c) => {
  const user = c.get('user')
  return c.json({ user })
})

app.get('/api/admin', (c) => {
  const user = c.get('user')

  if (user.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403)
  }

  return c.json({ message: 'Welcome, admin' })
})

export default app
```

`c.set()` / `c.get()` 是中间件与路由之间的通信通道。数据只在当前请求的生命周期内有效，不同请求之间互不影响。

和前一篇一样，这里为了先理解机制，先省略了类型声明。真实项目里，像 `user` 这种在中间件里写入、在路由里读取的数据，最好补上类型，不然编辑器很难准确提示字段。

## 9. 总结

中间件是 Hono 处理横切关注点的核心机制。洋葱模型让你可以在请求前后都插入逻辑，`c.set()` / `c.get()` 解决了中间件和路由之间的数据传递。内置中间件覆盖了大部分常见需求，自定义中间件也就是一个 `async` 函数的事。

下一篇看数据校验——怎么优雅地验证请求参数和请求体。
