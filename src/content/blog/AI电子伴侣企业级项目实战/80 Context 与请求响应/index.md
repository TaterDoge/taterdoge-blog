---
title: "80 Context 与请求响应"
pubDate: 2026-05-07
description: "不像 Express 把请求和响应拆成 req 和 res 两个对象，Hono 把所有东西收敛到一个 c 里。API 表面积更小，用起来更直觉。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/5-context-and-response/](https://aicompanion.usehook.cn/5-context-and-response/)

## 1. Context 对象：路由处理的唯一入口

Hono 的每个路由处理函数都接收一个参数 `c`，这就是 Context 对象。

所有请求信息的读取、响应的构造，都通过它完成。

src/index.ts

```typescript
app.get('/hello', (c) => {
  // c.req — 请求信息
  // c.json() / c.text() / c.html() — 构造响应
  // c.header() — 设置响应头
  // c.status() — 设置状态码
  return c.text('Hello!')
})
```

不像 Express 把请求和响应拆成 `req` 和 `res` 两个对象，Hono 把所有东西收敛到一个 `c` 里。API 表面积更小，用起来更直觉。

## 2. 读取请求信息

### 查询参数

URL 里 `?key=value` 的部分：

src/index.ts

```typescript
// GET /search?q=hono&page=2
app.get('/search', (c) => {
  const q = c.req.query('q')       // 'hono'
  const page = c.req.query('page') // '2'（注意是字符串）
  return c.json({ q, page })
})
```

### 路由参数

路径中 `:param` 定义的动态段：

src/index.ts

```typescript
// GET /users/42
app.get('/users/:id', (c) => {
  const id = c.req.param('id') // '42'
  return c.json({ id })
})
```

### 请求头

src/index.ts

```typescript
app.get('/profile', (c) => {
  const token = c.req.header('Authorization')
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return c.json({ token })
})
```

### 请求体 — JSON

POST/PUT 请求发送的 JSON 数据，需要 `await`：

src/index.ts

```typescript
app.post('/users', async (c) => {
  const body = await c.req.json()
  // body: { name: 'Alice', email: 'alice@example.com' }
  return c.json({ created: body }, 201)
})
```

这里有一个很重要的注意点：**请求体通常只能读取一次**。也就是说，你不能先 `await c.req.text()` 看一眼原始内容，再接着 `await c.req.json()` 重新解析。同一个 body 被消费后，后面通常就不能再读了。

所以实战里要先想清楚：这次请求你到底要按 JSON 读、按文本读，还是按表单读，然后只选一种方式。

### 请求体 — 纯文本

src/index.ts

```typescript
app.post('/webhook', async (c) => {
  const text = await c.req.text()
  console.log('Received:', text)
  return c.text('OK')
})
```

### 请求体 — 表单数据

src/index.ts

```typescript
app.post('/upload', async (c) => {
  const formData = await c.req.formData()
  const name = formData.get('name')
  const file = formData.get('file') // File 对象
  return c.json({ name, fileSize: file?.size })
})
```

### 基本信息

src/index.ts

```typescript
app.get('/debug', (c) => {
  return c.json({
    url: c.req.url,       // 'http://localhost:8787/debug?a=1'
    method: c.req.method, // 'GET'
    path: c.req.path,     // '/debug'
  })
})
```

## 3. 构造响应

### c.json() — 返回 JSON

最常用的响应方式，自动设置 `Content-Type: application/json`：

src/index.ts

```typescript
app.get('/api/users', (c) => {
  return c.json({
    users: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]
  })
})
```

第二个参数可以传状态码：

src/index.ts

```typescript
app.post('/api/users', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 3, ...body }, 201) // 201 Created
})
```

### c.text() — 返回纯文本

src/index.ts

```typescript
app.get('/health', (c) => {
  return c.text('OK')
})
```

### c.html() — 返回 HTML

src/index.ts

```typescript
app.get('/page', (c) => {
  return c.html('<h1>Hello</h1><p>This is HTML</p>')
})
```

### c.redirect() — 重定向

src/index.ts

```typescript
app.get('/old-path', (c) => {
  return c.redirect('/new-path')       // 默认 302 临时重定向
})

app.get('/moved', (c) => {
  return c.redirect('/new-home', 301)  // 301 永久重定向
})
```

### c.body() — 无内容响应

某些操作完成后不需要返回数据，比如 DELETE：

src/index.ts

```typescript
app.delete('/api/users/:id', (c) => {
  const id = c.req.param('id')
  // ... 执行删除逻辑
  return c.body(null, 204) // 204 No Content
})
```

### c.newResponse() — 完全自定义

当上面的快捷方法不够用时，可以用 `c.newResponse()` 完全控制响应：

src/index.ts

```typescript
app.get('/custom', (c) => {
  return c.newResponse('custom body', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      'X-Custom-Header': 'my-value',
      'Cache-Control': 'max-age=3600',
    },
  })
})
```

## 4. 设置响应头和状态码

除了在 `c.json()` 等方法里直接传状态码，还可以单独设置：

src/index.ts

```typescript
app.get('/api/data', (c) => {
  c.status(200)
  c.header('X-Request-Id', crypto.randomUUID())
  c.header('Cache-Control', 'no-cache')
  return c.json({ data: 'hello' })
})
```

`c.header()` 可以链式调用多次，每次设置一个响应头。注意 `c.status()` 和 `c.header()` 要在返回响应之前调用。

对新手来说，可以先记一个简单规则：

- 只是返回一个普通 JSON，并顺手带状态码：优先用 `c.json(data, 201)` 这种写法

- 如果你还要额外设置多个响应头，或者想把"设置状态码"和"返回响应体"分开写清楚，再用 `c.status()` + `c.header()`

前者更短，后者更适合逻辑稍复杂的场景。

## 5. c.set / c.get — 中间件与路由之间传数据

Hono 提供了 `c.set()` 和 `c.get()` 来在同一个请求的生命周期内传递数据。最典型的用法：中间件解析出用户信息，路由处理函数直接取用。

src/index.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

// 中间件：解析用户身份
app.use('/api/*', async (c, next) => {
  const token = c.req.header('Authorization')
  // 假设 verifyToken 是你的验证函数
  const user = { id: 1, name: 'Alice' } // 实际从 token 解析
  c.set('user', user) // 存数据
  await next()
})

// 路由：直接拿中间件存的数据
app.get('/api/profile', (c) => {
  const user = c.get('user') // 取数据
  return c.json(user)
})
```

`c.set()` / `c.get()` 的作用域是单次请求，不同请求之间互不影响。这个机制会在下一篇中间件文章里详细展开。

上面这个例子为了先讲清概念，省略了类型声明。真实项目里，像 `user` 这种你在中间件里写入、在路由里读取的数据，最好补上类型，这样编辑器才能正确提示字段，避免把 `user.name` 写错。

## 6. Context 和 Web Standards 的关系

`c.req` 不是凭空造出来的 API，它是对浏览器标准 `Request` 对象的包装。你可以随时访问原始的 Request：

src/index.ts

```typescript
app.get('/raw', (c) => {
  const rawRequest = c.req.raw // 标准的 Request 对象
  console.log(rawRequest instanceof Request) // true
  return c.text('OK')
})
```

而 `c.json()`、`c.text()` 等方法返回的都是标准的 `Response` 对象。所以 Hono 的处理函数本质上就是：**接收一个 Request，返回一个 Response**——这和 Web 标准的 Fetch Handler 完全一致。

你可以把前后端的关系想成这样：

- 浏览器里 `fetch('/api/users')` 发出去的是一个标准 `Request`

- Hono 在服务端通过 `c.req` 读取这个请求

- 你的路由处理函数返回一个标准 `Response`

- 浏览器最终收到这个 `Response`

这意味着你在 Hono 里学到的东西不是框架私有知识。`Request`、`Response`、`Headers`、`FormData` 这些 API，在浏览器的 `fetch()`、Workers、Hono 里其实是一套相通的模型。

## 7. 总结

Context 对象 `c` 是 Hono 里做事情的唯一入口：`c.req` 读请求，`c.json()` / `c.text()` 写响应，`c.set()` / `c.get()` 传数据。API 设计很薄，基本不用查文档就能猜到方法名。

下一篇讲中间件——Hono 用洋葱模型组织请求处理流程，`c.set()` / `c.get()` 会在那里真正派上用场。
