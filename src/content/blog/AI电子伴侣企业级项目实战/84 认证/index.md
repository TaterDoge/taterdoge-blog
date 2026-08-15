---
title: "84 认证"
pubDate: 2026-05-08
description: "前面几篇我们写的所有接口，有一个共同的问题：谁都能调。不管是 /api/profile 还是 /api/orders，任何人拿到 URL 就能直接请求，拿到数据。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/9-authentication/](https://aicompanion.usehook.cn/9-authentication/)

## 1. 问题：谁都能调你的接口

前面几篇我们写的所有接口，有一个共同的问题：谁都能调。不管是 `/api/profile` 还是 `/api/orders`，任何人拿到 URL 就能直接请求，拿到数据。

现实中显然不行。用户的订单、个人信息、后台管理操作，这些接口必须登录之后才能访问。

所以我们需要解决一个问题：**怎么知道这个请求是谁发的？**

这就是认证（Authentication）要干的事——验证身份。你在各种网站上输入用户名密码点击登录，本质上就是在完成认证。

还有一个容易混淆的概念叫鉴权（Authorization），它解决的是"你能干什么"——比如普通用户不能删除别人的账号，只有管理员才行。认证在前，鉴权在后，先确认你是谁，再决定你能做什么。鉴权的内容放在下一篇单独讲，本篇只聚焦认证。

## 2. 传统方案：Session

最直观的认证思路就是 Session。你去银行办业务，柜员给你一个号码牌，后续叫号就靠这个牌子识别你。Session 的原理差不多：

- 用户提交用户名和密码，服务端验证通过

- 服务端生成一个随机字符串作为 Session ID，把它和用户信息的对应关系存起来（内存、数据库、Redis 都行）

- 把这个 Session ID 通过 Cookie 发给浏览器

- 之后浏览器每次请求都会自动带上这个 Cookie

- 服务端拿到 Cookie 里的 Session ID，去存储里查"这个 ID 对应的是哪个用户"

用伪代码表示一下核心逻辑：

session-example.ts

```typescript
// 服务端内存里维护一个映射表
const sessions: Record<string, { userId: number; email: string }> = {}

// 登录：生成 Session ID，存到映射表
app.post('/login', async (c) => {
  const { email, password } = await c.req.json()
  const user = await verifyUser(email, password)

  const sessionId = crypto.randomUUID()
  sessions[sessionId] = { userId: user.id, email: user.email }

  // 通过 Set-Cookie 把 Session ID 发给浏览器
  setCookie(c, 'sid', sessionId)
  return c.json({ message: 'ok' })
})

// 后续请求：从 Cookie 里取 Session ID，查映射表
app.get('/api/profile', (c) => {
  const sessionId = getCookie(c, 'sid')
  const user = sessions[sessionId]  // 查表

  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  return c.json(user)
})
```

这个方案在传统的 Node.js / Java / PHP 服务器上用了很多年，简单可靠。但它有一个前提：**服务端必须有地方存这张映射表**。

问题就出在这儿。我们用的是 Cloudflare Workers——每次请求进来，Worker 都是一个全新的实例，内存里什么都没有。没有地方存 `sessions` 这张表，自然也没法查。

另外一种思路就是，我们可以把 Session 存到 KV 或数据库里，但每次请求都要多一次查询，网络延迟就上去了。

有没有办法让服务端不用存任何东西，光看请求本身就能知道这个人是谁？

## 3. JWT：让请求自己带着身份信息

JWT（JSON Web Token）的思路跟 Session 正好反过来。

Session 是服务端存信息，给你一把钥匙。JWT 是把信息直接交给你，但我在上面盖个章——你随身带着这份信息，服务端收到后验一下章是不是自己盖的就行，不用查任何东西。

流程变成这样：

- 用户登录，服务端验证通过后，把用户信息（ID、角色等）编码成一个字符串，用密钥签名，整个发给前端——这就是 JWT

- 前端把这个 JWT 存起来，之后每次请求放到请求头里：`Authorization: Bearer <token>`

- 服务端收到请求，从请求头取出 JWT，用密钥验证签名没被篡改，直接从里面读出用户信息。**不需要查数据库，不需要存映射表**

### JWT 长什么样

一个真实的 JWT 就是一串用 `.` 分隔成三段的字符串：

JWT

```txt
eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjEsImVtYWlsIjoiYWxpY2VAZXhhbXBsZS5jb20iLCJyb2xlIjoiYWRtaW4ifQ.xxxxxxxxxxxxx
```

三段分别是：

- **Header**（头部）：声明签名算法，内容固定，你基本不需要关心

- **Payload**（载荷）：真正有用的数据——用户 ID、邮箱、角色、过期时间

- **Signature**（签名）：用服务端的密钥对前两部分做的签名，防篡改用的

把中间那段 Payload 做一次 Base64 解码，就能看到原始数据：

payload

```json
{
  "sub": 1,
  "email": "alice@example.com",
  "role": "admin"
}
```

### JWT 不是加密，是签名

很多人以为 JWT 是加密的，别人看不到里面的内容。不是。前两段只做了 Base64 编码，任何人拿到 token 都能解码看到里面的数据。

签名的作用不是"让别人看不到"，而是"让别人改不了"。服务端收到 token 后，用自己保管的 `secret` 重新算一遍签名，跟 token 里带的签名对不上，说明数据被动过手脚，直接拒绝。

所以：**不要往 JWT 的 payload 里放密码、手机号这些敏感信息。** 放用户 ID、角色这些"被别人看到也无所谓"的东西就好。

### 术语对照

后面代码里会反复出现这些词，先对应一下：

- `token`：那一整串字符串（三段用 `.` 拼起来的）

- `payload`：token 里面编码的数据（用户 ID、角色等）

- `secret`：服务端用来签名和验签的密钥（只有服务端知道，绝不发给前端）

- `sign`：签发——把 payload + secret 生成 token

- `verify`：验签——检查 token 有没有被篡改、有没有过期

## 4. 用 Hono 内置 JWT 中间件做认证

Hono 自带了 JWT 中间件，直接用：

index.ts

```typescript
import { Hono } from 'hono'
import { jwt } from 'hono/jwt'
import type { JwtVariables } from 'hono/jwt'

type Variables = JwtVariables

const app = new Hono<{ Variables: Variables }>()

// 公开路由
app.get('/', (c) => {
  return c.text('Public homepage')
})

// /api 下的所有路由都需要 JWT 认证
app.use('/api/*', jwt({ secret: 'my-secret', alg: 'HS256' }))

// 认证通过后，从 jwtPayload 拿到用户信息
app.get('/api/profile', (c) => {
  const payload = c.get('jwtPayload')
  return c.json({
    userId: payload.sub,
    email: payload.email,
  })
})

app.get('/api/orders', (c) => {
  const payload = c.get('jwtPayload')
  return c.json({
    message: `Fetching orders for user ${payload.sub}`,
  })
})

export default app
```

`jwt()` 中间件做了这几件事：

- 从 `Authorization: Bearer <token>` 头里取出 token

- 用 `secret` 验证签名是否合法

- 把解码后的 payload 存到 `c.set('jwtPayload', ...)`

- 验证失败自动返回 401

你不需要自己写解析逻辑，一行 `jwt({ secret })` 搞定。

这里有两个新手容易混淆的点：

- `secret` 是服务端自己保管的密钥，不会发给前端

- `jwtPayload` 不是原始 token，而是 token 解码并验签通过后的内容

也就是说，前端传来的是一整串 token，Hono 帮你验证后，才把里面的数据放到 `c.get('jwtPayload')` 里。

## 5. 签发 JWT

光校验不行，还得能签发 token。用 `hono/jwt` 的 `sign` 方法：

index.ts

```typescript
import { Hono } from 'hono'
import { jwt, sign } from 'hono/jwt'
import type { JwtVariables } from 'hono/jwt'

type Variables = JwtVariables

const app = new Hono<{ Variables: Variables }>()

// 模拟用户数据
const users = [
  { id: 1, email: 'alice@example.com', password: '123456', role: 'admin' },
  { id: 2, email: 'bob@example.com', password: 'abcdef', role: 'user' },
]

const SECRET = 'my-secret'

// 登录接口：验证用户，签发 token
app.post('/login', async (c) => {
  const { email, password } = await c.req.json()

  const user = users.find(
    (u) => u.email === email && u.password === password
  )

  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  // 签发 JWT
  const token = await sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24 小时过期
    },
    SECRET
  )

  return c.json({ token })
})

// 受保护的路由
app.use('/api/*', jwt({ secret: SECRET, alg: 'HS256' }))

app.get('/api/profile', (c) => {
  const payload = c.get('jwtPayload')
  return c.json(payload)
})

export default app
```

`sign()` 接两个参数：payload 对象和 secret。payload 里的 `sub` 是标准字段，表示用户 ID；`exp` 是过期时间，Unix 时间戳。

- 登录接口负责"验证用户名密码是否正确"

- `sign()` 负责"把用户身份打包成 token"

- 后续受保护接口负责"验证这个 token 还可信不可信"

## 6. Cloudflare Workers 中的注意事项

到目前为止 secret 都是硬编码的字符串，在 Cloudflare Workers 里应该用环境变量：

index.ts

```typescript
import { Hono } from 'hono'
import { jwt, sign } from 'hono/jwt'
import type { JwtVariables } from 'hono/jwt'

// 定义 Bindings 类型
type Bindings = {
  JWT_SECRET: string
}

type Variables = JwtVariables

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// 用 c.env.JWT_SECRET 替代硬编码的 secret
app.use('/api/*', async (c, next) => {
  const middleware = jwt({ secret: c.env.JWT_SECRET, alg: 'HS256' })
  return middleware(c, next)
})

app.post('/login', async (c) => {
  const { email, password } = await c.req.json()

  // 验证用户...
  const token = await sign(
    { sub: 1, email, role: 'user' },
    c.env.JWT_SECRET // 从环境变量拿 secret
  )

  return c.json({ token })
})

app.get('/api/profile', (c) => {
  const payload = c.get('jwtPayload')
  return c.json(payload)
})

export default app
```

在 `wrangler.jsonc` 里配置：

wrangler.jsonc

```jsonc
{
  "vars": {
    "JWT_SECRET": "dev-secret"
  }
}
```

生产环境用 `wrangler secret put JWT_SECRET` 设置，不要把真实 secret 提交到代码仓库。

这里也顺手强调一句：开发环境把 secret 写进 `vars` 只是为了本地跑通流程；真正上线时，应该用 Cloudflare 的 secret 管理，而不是把生产密钥直接写进配置文件。

## 7. 总结

认证解决的是你是谁的问题。核心流程就三步：

- 用户登录，服务端用 `sign()` 签发 JWT

- 前端每次请求带上 `Authorization: Bearer <token>`

- 服务端用 `jwt()` 中间件验证 token，通过后从 `c.get('jwtPayload')` 读取用户信息

在 Cloudflare Workers 里，记得把 secret 放环境变量，不要硬编码。

知道了"你是谁"之后，下一个问题就是"你能干什么"——这就是鉴权。下一篇我们来看怎么做角色检查和权限控制
