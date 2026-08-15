---
title: "85 鉴权"
pubDate: 2026-05-08
description: "上一篇我们讲了认证——解决\"你是谁\"的问题。用户登录后拿到 JWT，后续请求带上 token，服务端验证通过就知道你是谁。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/10-authorization/](https://aicompanion.usehook.cn/10-authorization/)

## 1. 回顾：认证 vs 鉴权

上一篇我们讲了认证——解决"你是谁"的问题。用户登录后拿到 JWT，后续请求带上 token，服务端验证通过就知道你是谁。

但知道你是谁还不够。一个普通用户和一个管理员，能做的事是不一样的。**鉴权就是在认证之后，检查"你有没有权限做这件事"。**

认证回答的是身份问题，鉴权回答的是权限问题。两者的顺序不能反——你得先知道这个人是谁，才能去查他有什么权限。

## 2. 角色鉴权

最常见的鉴权方式是基于角色。比如：普通用户能查看自己的资料，但只有管理员能删除用户。

思路很简单：写一个中间件，从 JWT 的 payload 里取出角色，判断是否匹配。

index.ts

```typescript
import { Hono } from 'hono'
import { jwt } from 'hono/jwt'
import type { JwtVariables } from 'hono/jwt'
import { HTTPException } from 'hono/http-exception'

type Variables = JwtVariables

const app = new Hono<{ Variables: Variables }>()
const SECRET = 'my-secret'

// 角色鉴权中间件
const requireRole = (role: string) => {
  // 这里为了先讲清流程，先省略 Hono 的中间件类型声明
  return async (c, next) => {
    const payload = c.get('jwtPayload')

    if (payload.role !== role) {
      throw new HTTPException(403, { message: 'Forbidden: insufficient permissions' })
    }

    await next()
  }
}

// 先认证
app.use('/api/*', jwt({ secret: SECRET, alg: 'HS256' }))

// 所有登录用户都能访问
app.get('/api/profile', (c) => {
  const payload = c.get('jwtPayload')
  return c.json(payload)
})

// 只有 admin 能删除用户
app.delete('/api/users/:id', requireRole('admin'), (c) => {
  const id = c.req.param('id')
  return c.json({ message: `User ${id} deleted` })
})

// 只有 admin 能创建用户
app.post('/api/users', requireRole('admin'), async (c) => {
  const body = await c.req.json()
  return c.json({ message: 'User created', data: body })
})

export default app
```

关键点：`requireRole` 是一个高阶函数，传入角色名，返回中间件。它必须放在 `jwt()` 之后，因为需要先解析出 `jwtPayload` 才能检查角色。

这就是认证和鉴权在代码里的落地顺序：

- `jwt()` 先确认"你是谁"

- `requireRole()` 再确认"你有没有这个权限"

如果顺序写反了，鉴权中间件根本拿不到用户身份信息。

## 3. 权限列表鉴权

角色鉴权够用的场景是：权限和角色一一对应，比如"只有 admin 能做 X"。但如果权限更细粒度，比如同样是 admin，有的能删用户但不能改配置，那就需要权限列表。

思路是在 JWT 的 payload 里带上一个 `permissions` 数组，鉴权时检查这个数组里有没有对应权限：

index.ts

```typescript
const requirePermission = (permission: string) => {
  // 这里同样先省略类型声明，重点看权限判断逻辑
  return async (c, next) => {
    const payload = c.get('jwtPayload')
    const permissions: string[] = payload.permissions || []

    if (!permissions.includes(permission)) {
      throw new HTTPException(403, { message: `Missing permission: ${permission}` })
    }

    await next()
  }
}

// 需要 users:delete 权限
app.delete('/api/users/:id', requirePermission('users:delete'), (c) => {
  const id = c.req.param('id')
  return c.json({ message: `User ${id} deleted` })
})

// 需要 config:write 权限
app.put('/api/config', requirePermission('config:write'), async (c) => {
  const body = await c.req.json()
  return c.json({ message: 'Config updated', data: body })
})
```

签发 token 时把权限写进去：

index.ts

```typescript
const token = await sign(
  {
    sub: user.id,
    email: user.email,
    role: user.role,
    permissions: ['users:read', 'users:delete', 'config:read'],
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
  },
  SECRET
)
```

角色鉴权和权限列表鉴权怎么选？

- 权限模型简单（admin/user 两种角色就够了）→ 用角色鉴权，代码最少

- 权限模型复杂（不同角色有不同的细粒度操作权限）→ 用权限列表

## 4. API Key 鉴权

不是所有场景都适合 JWT。JWT 是给"用户登录"设计的——有签发、有过期、有身份信息。但有些接口不是给用户调的，而是给**其他程序**调的，比如：

- 微服务之间互相调用

- 第三方系统接入你的 API

- 后台定时任务请求内部接口

这些场景不存在"用户登录"这个动作，用 JWT 反而多此一举。API Key 更简单直接：一个固定的字符串，请求时带上，服务端对比一下就行。

index.ts

```typescript
import { Hono } from 'hono'

type Bindings = {
  API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

// API Key 鉴权中间件
// 这里先省略中间件类型声明，先理解 API Key 的校验流程
const apiKeyAuth = async (c, next) => {
  const apiKey = c.req.header('X-API-Key')

  if (!apiKey || apiKey !== c.env.API_KEY) {
    return c.json({ error: 'Invalid API Key' }, 401)
  }

  await next()
}

// 公开接口
app.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

// 需要 API Key 的接口
app.use('/internal/*', apiKeyAuth)

app.get('/internal/stats', (c) => {
  return c.json({ totalUsers: 1000, activeToday: 200 })
})

export default app
```

## 5. JWT vs API Key 怎么选

如果你是第一次做后端，可以先记一个最实用的判断：

|  | JWT | API Key |
| --- | --- | --- |
| 适用场景 | 用户登录后的接口 | 程序调用程序的接口 |
| 身份信息 | token 自带用户 ID、角色等 | 只能证明"你有 Key"，不带身份 |
| 有效期 | 有过期时间，需要刷新 | 通常长期有效，手动轮换 |
| 传递方式 | Authorization: Bearer <token> | X-API-Key: <key> 或其他自定义头 |

简单总结：

- 面向"登录用户"的接口 → JWT

- 面向"程序调用程序"的接口 → API Key

## 6. 总结

鉴权解决的是"你能干什么"的问题。核心思路就是在认证之后加一层中间件做权限检查：

- **角色鉴权**：从 JWT payload 取 `role`，判断是否匹配。适合权限模型简单的场景

- **权限列表鉴权**：从 JWT payload 取 `permissions` 数组，检查是否包含所需权限。适合细粒度控制

- **API Key**：适合服务间调用，不走 JWT 那套流程，直接对比字符串

不管哪种方式，鉴权中间件都必须放在认证中间件之后——先知道你是谁，再检查你能做什么。
