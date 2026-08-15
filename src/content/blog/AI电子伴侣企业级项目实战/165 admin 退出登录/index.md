---
title: "165 admin 退出登录"
pubDate: 2026-06-02
description: "很多人刚开始写退出登录，第一反应都差不多：把本地 token 删掉，跳回登录页，这件事也就结束了。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/30-admin-logout/](https://aicompanion.usehook.cn/30-admin-logout/)

## 1. 退出登录

我们可以先把这件事想得朴素一点。

很多人刚开始写退出登录，第一反应都差不多：把本地 token 删掉，跳回登录页，这件事也就结束了。

放在前端里，这样想很自然。可一旦站到服务端这一边，事情就没有这么轻了。

因为服务端真正关心的，从来不是浏览器里那串字符串删没删，而是这次登录建立起来的那条会话状态，到底有没有真的失效。

所以退出登录这件事，最后落到服务端时，核心动作不会是单纯删 token，而是撤销 session。只要 session 被撤销了，它下面那条 refresh token 链也就跟着一起失效了。

这也是这段 admin logout service 的意思。它很短，但要做的事情很集中：先验 refresh token，再找到它属于哪条 session，最后把整条 session 一次性撤销。

## 2. 完整代码

admin-logout.ts

```typescript
import type { AdminLogoutRequest } from '@repo/contracts'
import type { Context } from 'hono'
import type { ApiBindings } from '@/bindings'
import { getDb } from '@/db/client'
import { getApiEnv } from '@/env'
import { refreshTokenInvalidError } from '@/auth/errors'
import { verifyRefreshToken } from '@/auth/jwt'
import { findRefreshTokenForSession, revokeSession } from '@/auth/repository'
import { hashTokenJti } from '@/auth/token-hash'

export async function handleAdminLogout(params: {
  c: Context<{ Bindings: ApiBindings }>
  payload: AdminLogoutRequest
}) {
  const { c, payload } = params
  const db = getDb(c.env.DB)
  const env = getApiEnv(c.env)

  let claims

  try {
    claims = await verifyRefreshToken({
      token: payload.refreshToken,
      secret: env.JWT_REFRESH_SECRET,
    })
  } catch {
    throw refreshTokenInvalidError()
  }

  const currentToken = await findRefreshTokenForSession({
    db: db,
    jtiHash: await hashTokenJti(claims.jti),
    sessionId: claims.sid,
  })

  if (!currentToken) {
    throw refreshTokenInvalidError()
  }

  await revokeSession({
    db: db,
    sessionId: currentToken.sessionId,
    revokedAtMs: Date.now(),
    reason: 'logout',
  })

  return {
    success: true as const,
  }
}
```

## 3. 这段代码用到了什么

这段代码不长，所以 import 区已经把结构说得很清楚了。

`getDb` 和 `getApiEnv` 负责把数据库连接和环境配置准备出来。

`verifyRefreshToken` 来自 JWT 模块，负责先把前端带来的 refresh token 验一遍。

`findRefreshTokenForSession` 和 `revokeSession` 来自 repository，说明这段 service 自己不直接写 SQL，而是把数据库读写交给 repository。

`hashTokenJti` 用来把 token 里的 `jti` 变成数据库里要查的 hash 值。

`refreshTokenInvalidError` 则把失败情况统一收成一类错误。

所以这段 service 的位置也就很清楚了。它不做底层细节，而是把几层能力顺着退出登录这条逻辑串起来。

## 4. 先把上下文准备好

函数开头还是熟悉的写法：

admin-logout.ts

```typescript
const { c, payload } = params
const db = getDb(c.env.DB)
const env = getApiEnv(c.env)
```

先把参数拆开，再把后面会用到的两个东西准备好。

`payload` 里装的是前端传上来的 refresh token。

`db` 是后面 repository 查询和更新要用的数据库客户端。

`env` 则把 JWT refresh secret 拿出来，后面验 token 时会直接用到。

到这里为止，service 还没有真正进入退出逻辑，它只是先把这条逻辑要用的上下文摆好。

## 5. 先验 refresh token

真正的动作是从这里开始的：

admin-logout.ts

```typescript
let claims

try {
  claims = await verifyRefreshToken({
    token: payload.refreshToken,
    secret: env.JWT_REFRESH_SECRET,
  })
} catch {
  throw refreshTokenInvalidError()
}
```

这一段和 refresh token 刷新那条线有些相似。

前端把 refresh token 带上来之后，服务端不会直接拿它去查数据库，而是先从 JWT 这一层把它验一遍。

这一步过了，后面才能继续往下走。

这一步没过，就直接统一收口成：

admin-logout.ts

```typescript
throw refreshTokenInvalidError()
```

这里的意思其实很直白。退出登录虽然动作短，但也不能拿一张格式不对、签名不对，或者根本不属于当前系统的 refresh token，继续往下做 session 撤销。

所以第一步先验 token，本身就很合理。

## 6. 再找到它属于哪条 session

JWT 验过去之后，service 手里拿到的是 `claims`。这时候它知道的还只是 token 自己带出来的内容，比如 `sid` 和 `jti`。

下一步要做的，就是把这张 token 在数据库里的记录找出来：

admin-logout.ts

```typescript
const currentToken = await findRefreshTokenForSession({
  db: db,
  jtiHash: await hashTokenJti(claims.jti),
  sessionId: claims.sid,
})
```

这里有两个地方值得注意。

第一个地方是 `claims.jti` 没有直接拿去查库，而是先走了一次：

admin-logout.ts

```typescript
await hashTokenJti(claims.jti)
```

也就是说，数据库里真正存的不是原始 `jti`，而是它的 hash。

第二个地方是查询条件不只看 `jtiHash`，还把 `sessionId` 一起带上了。

这说明服务端不是只想确认**这张 token 存不存在**，还想确认**它到底是不是挂在这条 session 下面**。

## 7. 找不到就停下

查完之后，立刻有一个判断：

admin-logout.ts

```typescript
if (!currentToken) {
  throw refreshTokenInvalidError()
}
```

这一步也很自然。

JWT 这一层验过了，只能说明这张 token 从格式和签名上看是成立的。可数据库里如果根本找不到这张 token 的记录，那服务端依旧不会继续往下做退出。

所以这里又把它收口回 `refreshTokenInvalidError()`。

这段代码没有把“JWT 验不过”和“数据库里找不到记录”拆成两种对外错误，而是统一当成 refresh token 无效来处理。这样边界会更干净一些。

## 8. 真正的退出动作

前面那些准备、验 token、查数据库，都是在为最后这个动作铺路：

admin-logout.ts

```typescript
await revokeSession({
  db: db,
  sessionId: currentToken.sessionId,
  revokedAtMs: Date.now(),
  reason: 'logout',
})
```

这里就是整段 logout service 真正的核心。

退出登录时，系统没有去做什么“把这张 JWT 字符串标记删除”的动作，而是直接去撤销这条 session。

这件事很关键。

因为 session 一旦被撤销，它下面那条 refresh token 链也会跟着一起收掉。这样才是完整的退出登录。

如果只删前端本地 token，而不撤销服务端 session，那这次登录在服务端看来其实还活着，这就不算真正退出。

这里还顺手写了一个撤销原因：

admin-logout.ts

```typescript
reason: 'logout'
```

这也很实用。以后回头看 session 为什么被撤销，就能直接知道这是用户主动退出，不是 replay，也不是别的安全原因。

## 9. 返回值

撤销动作做完之后，这段 service 的返回值非常短：

admin-logout.ts

```typescript
return {
  success: true as const,
}
```

这也很符合 logout 这件事本身。

登录和 refresh 都要带回很多信息，因为它们要给前端新的 token、新的 session、新的过期时间。

退出登录不用。它只需要告诉调用方，这次退出动作已经成功完成了。

所以这里没有再返回 token，没有再返回 session，只回了一个很轻的成功标记。

## 10. 它为什么会这么短

这段 service 看起来短，不是因为它做的事轻，而是因为前面的分层已经铺好了。

JWT 验证被放进了 `verifyRefreshToken(...)`。

数据库查询和 session 撤销被放进了 repository。

错误对象也已经提前收口好了。

所以到了 logout service 这里，剩下的工作就很纯粹：先验 refresh token，再找到它归属的 session，最后撤销这条 session。

逻辑本身没有绕来绕去，所以文件自然就短。

## 11. 总结

如果把这段 `handleAdminLogout` 压成一句话，它做的就是：前端带着 refresh token 过来，服务端先确认这张 token 是真的、数据库里也能找到它，然后不去纠结删哪一个字符串，而是直接把它所属的整条 session 撤销掉，最后回一个成功结果。

所以这篇真正值得记住的点也就一个：退出登录在服务端的核心动作，不是删 token，而是撤销 session。
