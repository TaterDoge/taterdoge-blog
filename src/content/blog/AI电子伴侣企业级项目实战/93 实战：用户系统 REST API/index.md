---
title: "93 实战：用户系统 REST API"
pubDate: 2026-05-11
description: "前面的章节是一个知识点一个知识点地学，这篇把它们串起来——做一个完整的用户管理系统 API。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/18-rest-api-practice/](https://aicompanion.usehook.cn/18-rest-api-practice/)

## 1. 我们要做什么

前面的章节是一个知识点一个知识点地学，这篇把它们串起来——做一个完整的用户管理系统 API。

具体来说就是：注册、登录、查看个人信息、管理员管理用户。功能不多，但前面学的路由、中间件、校验、认证、数据库操作全都会用上。单独看每个知识点都不难，关键是它们怎么配合——跑一遍就知道了。

技术栈：**Hono + Cloudflare D1 + Drizzle ORM + JWT + Zod**

## 2. 先想清楚有哪些接口

动手写代码之前，先把接口列出来。这一步很重要——先想好"要暴露哪些能力"，再去写实现。

API

```typescript
// 公开接口——不需要登录就能调
POST   /auth/register     // 注册
POST   /auth/login         // 登录，返回 JWT

// 需要登录——请求头带 JWT 才能调
GET    /users/me           // 获取当前用户信息
PUT    /users/me           // 更新个人信息

// 需要 admin 角色——不仅要登录，还得是管理员
GET    /users              // 列出所有用户
DELETE /users/:id          // 删除用户
```

为什么用 `/auth` 和 `/users` 分开？因为注册登录是"身份认证"，用户增删改查是"资源操作"，两件不同的事放在不同的路径下，后面加中间件时也方便——`/users/*` 统一加鉴权，`/auth/*` 不加。

## 3. 数据库 Schema

只有一张 users 表：

src/db/schema.ts

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('user'), // 'user' | 'admin'
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})
```

这里的 `sql`CURRENT_TIMESTAMP`` 是 Drizzle 提供的模板标签，用来写原生 SQL 表达式。`CURRENT_TIMESTAMP` 是 SQLite 内置的，意思是"插入数据时自动填入当前时间"。

`passwordHash` 存的是哈希后的密码，永远不存明文——即使数据库泄露，攻击者拿到的也不是原始密码。

## 4. 类型定义

src/types.ts

```typescript
export type Bindings = {
  DB: D1Database
  JWT_SECRET: string
}

export type Variables = {
  jwtPayload: {
    sub: number
    email: string
    role: string
    exp: number
  }
}

export type AppEnv = {
  Bindings: Bindings
  Variables: Variables
}
```

解释一下这几个东西：

- **Bindings** 是 Cloudflare Workers 的环境变量。`DB` 是 D1 数据库绑定，`JWT_SECRET` 是签发 JWT 用的密钥

- **Variables** 是 Hono 的上下文变量。JWT 中间件验证 token 后，会把解析出来的数据塞进 `c.var.jwtPayload`（也可以用 `c.get('jwtPayload')` 取），后面的路由就能拿到当前用户信息

- `sub` 是 JWT 标准字段，代表 "subject"（主体），这里存用户 ID。`exp` 是过期时间的 Unix 时间戳

把类型统一定义成 `AppEnv`，所有路由文件都用它，这样 `c.env.DB`、`c.get('jwtPayload')` 都有类型提示。

## 5. 密码哈希

Cloudflare Workers 不支持 bcrypt，但有 Web Crypto API。我们用 SHA-256 加盐来做。

先说"盐"是什么：如果两个用户的密码一样（比如都是 `123456`），直接做 SHA-256 的结果也一样。攻击者只要算一次，就能破解所有用同一密码的账户。加盐就是给每个用户的密码前面拼一段随机字符串，这样即使密码相同，哈希结果也完全不同。

src/utils/password.ts

```typescript
// 生成随机盐值
function generateSalt(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

// 用 SHA-256 对字符串做哈希
async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray, (b) => b.toString(16).padStart(2, '0')).join('')
}
```

上面两个是内部工具函数。下面是对外暴露的两个方法：

src/utils/password.ts（续）

```typescript
// 哈希密码：生成盐，把「盐+密码」做 SHA-256，用 : 拼起来存
export async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt()
  const hash = await sha256(salt + password)
  return `${salt}:${hash}`
}

// 验证密码：从存储的字符串里取出盐，对输入做同样的哈希，比较结果
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [salt, hash] = stored.split(':')
  const inputHash = await sha256(salt + password)
  return inputHash === hash
}
```

存储格式是 `salt:hash`。注册时 `hashPassword` 生成，登录时 `verifyPassword` 比对。

NOTE

**生产环境别用 SHA-256 哈希密码。** SHA-256 速度太快，攻击者暴力穷举的成本极低。正确做法是用 **PBKDF2**——Web Crypto API 原生支持（`crypto.subtle.deriveBits` + `PBKDF2` 算法），不需要额外依赖。这里用 SHA-256 纯粹是为了让你先理解"加盐哈希"的流程，概念到位后换算法只是改一个函数的事。

## 6. 注册接口

src/routes/auth.ts

```typescript
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { users } from '../db/schema'
import { hashPassword } from '../utils/password'
import type { AppEnv } from '../types'

const auth = new Hono<AppEnv>()

// 注册校验规则
const registerSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  name: z.string().min(2, '名称至少 2 个字符'),
  password: z.string().min(6, '密码至少 6 位'),
})

auth.post(
  '/register',
  zValidator('json', registerSchema),
  async (c) => {
    const { email, name, password } = c.req.valid('json')
    const db = drizzle(c.env.DB)

    // 检查邮箱是否已注册
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .get()

    if (existing) {
      return c.json({ error: '该邮箱已注册' }, 409)
    }

    // 哈希密码并入库
    const passwordHash = await hashPassword(password)
    const newUser = await db
      .insert(users)
      .values({ email, name, passwordHash })
      .returning()
      .get()

    return c.json(
      {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
      },
      201
    )
  }
)
```

`import` 看起来多，但每个都有用途——Hono 框架、Zod 校验、Drizzle 数据库操作、密码哈希。注意这里只 import 了 `hashPassword`，`verifyPassword` 和 `sign`（签发 JWT）到下面的登录接口才会用到。

流程：Zod 校验 → 查重 → 哈希密码 → 入库 → 返回用户信息。注意返回时不包含 `passwordHash`，永远不要把密码哈希传给前端。

## 7. 登录接口

登录和注册在同一个文件 `auth.ts` 里。注册用的是 `hashPassword`，登录这边要多一个 `verifyPassword` 来比对密码：

src/routes/auth.ts（续）

```typescript
import { sign } from 'hono/jwt'
import { verifyPassword } from '../utils/password'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

auth.post(
  '/login',
  zValidator('json', loginSchema),
  async (c) => {
    const { email, password } = c.req.valid('json')
    const db = drizzle(c.env.DB)

    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .get()

    if (!user) {
      return c.json({ error: '邮箱或密码错误' }, 401)
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      return c.json({ error: '邮箱或密码错误' }, 401)
    }

    // 签发 JWT，24 小时过期
    const token = await sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      },
      c.env.JWT_SECRET
    )

    return c.json({ token })
  }
)

export default auth
```

有个安全细节：不管是邮箱不存在还是密码错了，都返回同一条"邮箱或密码错误"。如果分别提示"邮箱不存在"和"密码错误"，攻击者就能先确认哪些邮箱注册过，再集中精力猜密码。

## 8. 鉴权中间件

src/middleware/auth.ts

```typescript
import { jwt } from 'hono/jwt'
import { HTTPException } from 'hono/http-exception'
import type { Context, Next } from 'hono'
import type { AppEnv } from '../types'

// JWT 认证中间件：验证 token 是否有效
export const authMiddleware = (
  c: Context<AppEnv>,
  next: Next
) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET })
  return jwtMiddleware(c, next)
}
```

为什么不直接 `app.use('/users/*', jwt({ secret: ... }))` ？因为 `JWT_SECRET` 在 `c.env` 里，只有请求进来时才能拿到，不能在定义路由时写死。所以包了一层，在中间件执行时动态读取 secret。

src/middleware/auth.ts（续）

```typescript
// 角色鉴权中间件：检查是否有特定角色
export const requireRole = (role: string) => {
  return async (c: Context<AppEnv>, next: Next) => {
    const payload = c.get('jwtPayload')

    if (payload.role !== role) {
      throw new HTTPException(403, {
        message: '权限不足',
      })
    }

    await next()
  }
}
```

`requireRole` 必须放在 `authMiddleware` 后面用，因为它要从 context 里取 `jwtPayload`，而这个值是 JWT 中间件验证通过后塞进去的。

## 9. 用户路由

src/routes/users.ts

```typescript
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { users } from '../db/schema'
import { requireRole } from '../middleware/auth'
import type { AppEnv } from '../types'

const userRoutes = new Hono<AppEnv>()

// GET /users/me — 获取当前用户信息
userRoutes.get('/me', async (c) => {
  const payload = c.get('jwtPayload')
  const db = drizzle(c.env.DB)

  const user = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, payload.sub))
    .get()

  if (!user) {
    return c.json({ error: '用户不存在' }, 404)
  }

  return c.json(user)
})
```

注意 `select()` 里显式列出了要返回的字段——不写 `select()` 的话会返回所有列，`passwordHash` 就暴露了。

src/routes/users.ts（续）

```typescript
// PUT /users/me — 更新个人信息
const updateSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
})

userRoutes.put(
  '/me',
  zValidator('json', updateSchema),
  async (c) => {
    const payload = c.get('jwtPayload')
    const data = c.req.valid('json')
    const db = drizzle(c.env.DB)

    // 如果要改邮箱，检查新邮箱是否已被别人占用
    if (data.email) {
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.email, data.email))
        .get()

      if (existing && existing.id !== payload.sub) {
        return c.json({ error: '该邮箱已被使用' }, 409)
      }
    }

    const updated = await db
      .update(users)
      .set(data)
      .where(eq(users.id, payload.sub))
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
      })
      .get()

    return c.json(updated)
  }
)
```

下面是管理员才能用的两个接口。注意 `requireRole('admin')` 中间件——它会检查 JWT 里的 `role` 字段，不是 admin 就直接 403。

src/routes/users.ts（续）

```typescript
// GET /users — 管理员列出所有用户
userRoutes.get('/', requireRole('admin'), async (c) => {
  const db = drizzle(c.env.DB)

  const allUsers = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .all()

  return c.json(allUsers)
})

// DELETE /users/:id — 管理员删除用户
userRoutes.delete('/:id', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'))
  const db = drizzle(c.env.DB)

  const deleted = await db
    .delete(users)
    .where(eq(users.id, id))
    .returning()
    .get()

  if (!deleted) {
    return c.json({ error: '用户不存在' }, 404)
  }

  return c.json({ message: '已删除' })
})

export default userRoutes
```

这里有个路由顺序的坑：`/me` 必须定义在 `/:id` 前面。如果反过来，请求 `/users/me` 时，`me` 会被当成 `id` 参数去匹配，然后 `Number('me')` 变成 `NaN`，查询就乱了。

## 10. 全局错误处理

src/middleware/error.ts

```typescript
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'

export const errorHandler = (err: Error, c: Context) => {
  console.error(`[Error] ${err.message}`)

  if (err instanceof HTTPException) {
    return c.json(
      { error: err.message },
      err.status
    )
  }

  // 未知错误，不暴露内部细节
  return c.json(
    { error: 'Internal Server Error' },
    500
  )
}
```

所有 `HTTPException`（包括 JWT 验证失败、角色鉴权失败）都会走到这里，返回对应的状态码和错误信息。其他未预期的错误统一返回 500，避免把堆栈信息暴露给前端。

至于 Zod 校验错误——`zValidator` 会在中间件层直接拦截并返回 400 响应，不会抛到 `onError` 里。所以这里不需要单独处理 Zod 错误。如果你想自定义 Zod 的错误格式，回前面数据校验那章看 `zValidator` 第三个参数的用法。

## 11. 主入口

src/index.ts

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import auth from './routes/auth'
import userRoutes from './routes/users'
import { authMiddleware } from './middleware/auth'
import { errorHandler } from './middleware/error'
import type { AppEnv } from './types'

const app = new Hono<AppEnv>()

// 全局中间件
app.use('*', logger())
app.use('*', cors())

// 全局错误处理
app.onError(errorHandler)

// 公开路由——注册登录不需要 token
app.route('/auth', auth)

// 受保护路由——/users 下的所有接口都要先过 JWT 验证
app.use('/users/*', authMiddleware)
app.route('/users', userRoutes)

// 健康检查——部署后用来确认服务是否正常运行
app.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

export default app
```

看这个文件就能一眼看出整个 API 的结构：公开的挂 `/auth`，受保护的挂 `/users`。`app.use('/users/*', authMiddleware)` 这行是关键——它让 `/users` 下所有路由都必须带合法的 JWT 才能访问，不用在每个路由里单独加。

## 12. wrangler 配置

wrangler.jsonc

```jsonc
{
  "name": "user-api",
  "main": "src/index.ts",
  "compatibility_date": "2024-12-01",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "user-db",
      "database_id": "your-database-id"
    }
  ],
  "vars": {
    "JWT_SECRET": "dev-secret-change-in-production"
  }
}
```

`vars` 里的 `JWT_SECRET` 只用于本地开发。部署到生产环境时，用 `wrangler secret put JWT_SECRET` 设置一个强密钥，不要提交到代码仓库里。

## 13. 项目文件结构

最终长这样：

index.ts主入口，组装路由和中间件types.ts类型定义schema.tsDrizzle schema（users 表）auth.ts注册、登录users.ts用户 CRUDauth.tsJWT 认证 + 角色鉴权error.ts全局错误处理password.ts密码哈希和验证drizzle.config.tsDrizzle Kit 配置wrangler.jsoncCloudflare Workers 配置

按职责分目录：路由、中间件、工具函数各管各的。后面加新功能（比如文章管理），就新建 `src/routes/posts.ts`，定义路由，然后在 `index.ts` 里 `app.route('/posts', postRoutes)` 挂上去。

## 14. 测试一下

用 curl 把整个流程跑一遍：

terminal

```shellscript
# 1. 注册
curl -X POST http://localhost:8787/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","name":"Alice","password":"123456"}'

# 2. 登录，拿到 token
curl -X POST http://localhost:8787/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"123456"}'

# 3. 用 token 查看个人信息（把 <token> 换成第 2 步返回的值）
curl http://localhost:8787/users/me \
  -H "Authorization: Bearer <token>"

# 4. 更新个人信息
curl -X PUT http://localhost:8787/users/me \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Updated"}'
```

如果每一步都返回了预期的 JSON，这个 API 就跑通了。

## 总结

回头看整个过程：想清楚接口长什么样，定好数据结构，然后从底层工具函数写起，一路搭到路由和主入口。每个文件各管各的事，新增功能就是往这个骨架上加东西。
