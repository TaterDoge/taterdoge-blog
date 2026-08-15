---
title: "79 路由系统"
pubDate: 2026-05-06
description: "app.post'/users', c = c.json{ message: 'created' }, 201"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/4-routing/](https://aicompanion.usehook.cn/4-routing/)

## 1. 基础路由方法

Hono 提供了与 HTTP 方法对应的路由注册方法。

每个方法接收路径和处理函数两个参数。

index.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

// GET 请求 - 获取资源
app.get('/users', (c) => c.json({ users: [] }))

// POST 请求 - 创建资源
app.post('/users', (c) => c.json({ message: 'created' }, 201))

// PUT 请求 - 更新资源
app.put('/users/:id', (c) => c.json({ message: 'updated' }))

// DELETE 请求 - 删除资源
app.delete('/users/:id', (c) => c.json({ message: 'deleted' }))

// all - 匹配所有 HTTP 方法
app.all('/health', (c) => c.text('ok'))

export default app
```

`app.all()` 会匹配任何 HTTP 方法，适合健康检查、CORS preflight 等不区分方法的场景。

## 2. 路由参数

用 `:参数名` 定义动态路径段，通过 `c.req.param()` 获取。

index.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

// 单个参数
app.get('/users/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ id })
})

// 多个参数
app.get('/posts/:postId/comments/:commentId', (c) => {
  const postId = c.req.param('postId')
  const commentId = c.req.param('commentId')
  return c.json({ postId, commentId })
})

// 一次取出所有参数
app.get('/orgs/:orgId/teams/:teamId', (c) => {
  const params = c.req.param()
  // params: { orgId: '...', teamId: '...' }
  return c.json(params)
})

export default app
```

请求 `GET /posts/42/comments/7` 会返回 `{ postId: "42", commentId: "7" }`。注意参数值始终是字符串，需要数字的话自己转换。

这里顺手区分一个新手常混淆的概念：

- `/users/42` 里的 `42` 是**路径参数**，用 `c.req.param('id')` 取

- `/users?id=42` 里的 `42` 是**查询参数**，要用 `c.req.query('id')` 取

这一篇先把路由路径本身讲清楚，下一篇讲 `Context` 时再系统看请求数据的获取方式。

## 3. 可选参数与通配符

通配符 `*` 匹配路径中的剩余部分，适合文件路径、代理转发等场景。

index.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

// 通配符 - 匹配 /files/ 后面的所有内容
// 用 :path{.+} 这种带命名的正则通配符，可以通过 c.req.param('path') 取到匹配的内容
app.get('/files/:path{.+}', (c) => {
  const path = c.req.param('path')
  // 请求 /files/docs/readme.md → path = 'docs/readme.md'
  return c.json({ path })
})

// 可选参数 - 用 ? 标记
app.get('/articles/:slug?', (c) => {
  const slug = c.req.param('slug')
  if (slug) {
    return c.json({ article: slug })
  }
  return c.json({ articles: [] })
})

export default app
```

`/files/:path{.+}` 会匹配 `/files/a`、`/files/a/b/c` 等任意深度的路径，`param('path')` 取到的值不包含前缀 `/files/`。如果只是"挡住一段路径"不需要取值，直接用 `app.get('/files/*', ...)` 也可以，只是没法通过 `param` 拿到通配符的匹配内容。

## 4. 分组路由 app.route()

真实项目不会把几十个路由全写在一个文件里。Hono 用 `app.route()` 把子路由挂载到主 app 上，每个模块独立管理自己的路由。

先定义各模块的路由：

users.ts

```typescript
import { Hono } from 'hono'

const users = new Hono()

users.get('/', (c) => c.json({ users: [] }))
users.get('/:id', (c) => c.json({ id: c.req.param('id') }))
users.post('/', (c) => c.json({ message: 'user created' }, 201))

export default users
```

posts.ts

```typescript
import { Hono } from 'hono'

const posts = new Hono()

posts.get('/', (c) => c.json({ posts: [] }))
posts.get('/:id', (c) => c.json({ id: c.req.param('id') }))

export default posts
```

然后在主入口挂载：

index.ts

```typescript
import { Hono } from 'hono'
import users from './users'
import posts from './posts'

const app = new Hono()

app.route('/users', users)
app.route('/posts', posts)

export default app
```

挂载后，`users` 里的 `GET /` 变成了 `GET /users/`，`GET /:id` 变成了 `GET /users/:id`。每个模块不需要知道自己最终挂在哪个前缀下。

这里有一个很重要的顺序问题：**先把子模块里的路由定义完，再 `app.route()` 挂载到主 app 上。**

也就是说，下面这种顺序是安全的：

- 在 `users.ts` 里把 `users.get()`、`users.post()` 都写完

- 回到主入口执行 `app.route('/users', users)`

不要反过来写成“先挂载，再继续往 `users` 里追加路由”。对新手来说，这个坑很常见，一旦顺序写反，最后很可能会遇到明明写了路由却返回 `404` 的情况。

## 5. basePath 全局前缀

`basePath()` 给整个 app 的所有路由加上统一前缀，常用于 API 版本管理。

index.ts

```typescript
import { Hono } from 'hono'

const app = new Hono().basePath('/api/v1')

app.get('/users', (c) => c.json({ users: [] }))
app.get('/posts', (c) => c.json({ posts: [] }))

export default app
// 实际路由：
// GET /api/v1/users
// GET /api/v1/posts
```

`basePath` 和 `app.route()` 可以组合使用：

index.ts

```typescript
import { Hono } from 'hono'
import users from './users'

const app = new Hono().basePath('/api/v1')
app.route('/users', users)

// users 模块的 GET / → GET /api/v1/users/
// users 模块的 GET /:id → GET /api/v1/users/:id
export default app
```

## 6. 路由优先级

Hono 的路由匹配遵循两条规则：

**1. 精确路由优先于参数路由。**

index.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

app.get('/users/me', (c) => c.json({ name: '当前用户' }))
app.get('/users/:id', (c) => c.json({ id: c.req.param('id') }))

export default app
```

请求 `GET /users/me` 命中第一个路由，不会被 `:id` 捕获。请求 `GET /users/42` 命中第二个。

**2. 同类型路由，先注册的优先。**

index.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

app.get('/users/:id', (c) => c.json({ handler: 'first' }))
app.get('/users/:userId', (c) => c.json({ handler: 'second' }))

// GET /users/42 → 命中第一个
export default app
```

这种写法没有意义，但说明了规则：两个参数路由结构相同时，先注册的赢。

不过在真实项目里，更常见的不是这个例子，而是**兜底路由写得太早**：

index.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

app.get('/users/*', (c) => c.json({ handler: 'fallback' }))
app.get('/users/me', (c) => c.json({ handler: 'me' }))

export default app
```

如果你把更宽泛的匹配规则放在前面，后面的具体路由就可能没有机会执行。所以实战里的经验很简单：

- 越具体的路由，越靠前

- 越宽泛的兜底规则，越靠后

## 7. 实际项目的路由组织

一个典型的 Hono 项目按模块拆分路由文件，主入口只负责创建 app、挂载路由和全局中间件：

index.ts

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import users from './routes/users'
import posts from './routes/posts'
import auth from './routes/auth'

const app = new Hono().basePath('/api/v1')

// 全局中间件
app.use('*', cors())
app.use('*', logger())

// 挂载路由模块
app.route('/users', users)
app.route('/posts', posts)
app.route('/auth', auth)

export default app
```

routes/users.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => c.json({ users: [] }))
app.get('/:id', (c) => c.json({ id: c.req.param('id') }))
app.post('/', (c) => c.json({ message: 'created' }, 201))
app.put('/:id', (c) => c.json({ message: 'updated' }))
app.delete('/:id', (c) => c.json({ message: 'deleted' }))

export default app
```

这个结构的好处：

- 每个模块文件只关心自己的业务路由，不关心前缀和全局中间件

- 主入口一目了然：用了什么中间件、挂了哪些模块、API 版本是什么

- 新增模块就是加一个文件 + 一行 `app.route()`

## 8. 总结

Hono 的路由系统和 Express 思路一致，但类型推导更完整。核心就这几件事：HTTP 方法对应 `app.get/post/put/delete`，动态参数用 `:name`，通配符用 `*`，模块拆分用 `app.route()`，全局前缀用 `basePath()`。

下一篇讲 Context 与请求响应——`c` 这个对象到底能干什么，怎么拿请求数据、怎么构造响应。
