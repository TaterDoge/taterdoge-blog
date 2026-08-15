---
title: "163 admin 子站 refresh token 刷新"
pubDate: 2026-06-01
description: "密码登录那条线，主线很清楚：查用户、验密码、建 session、发 token。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/28-admin-token-refresh/](https://aicompanion.usehook.cn/28-admin-token-refresh/)

## 1. refresh 这条线，真正麻烦的地方在哪

密码登录那条线，主线很清楚：查用户、验密码、建 session、发 token。

refresh 就不一样了。它看起来像只是“拿旧 token 换新 token”，真写起来却比登录更容易混乱。

因为这里不只是验一张 token 对不对，还得继续确认很多事：

- 这张 refresh token 是不是真的

- 它是不是 admin 这条线发出来的

- 它对应的 session 有没有被撤销

- 它自己有没有过期、有没有被撤销

- 它是不是已经被用过

- 并发刷新时，能不能保证只有一个请求成功

- 旧 token 和新 token 的 rotation 关系有没有写完整

所以读这段 service 时，脑子里最好一直盯着两件事：

第一，旧 refresh token 是怎么被一层层验下来的。

第二，旧 token 和新 token 之间的交接顺序是怎么写的。

## 2. 完整代码

admin-token-refresh.ts

```typescript
import { AdminTokenRefreshResponseSchema, type AdminTokenRefreshRequest } from '@repo/contracts'
import type { Context } from 'hono'
import type { ApiBindings } from '@/bindings'
import { getDb } from '@/db/client'
import { getApiEnv } from '@/env'
import {
  adminRoleRequiredError,
  refreshTokenInvalidError,
  refreshTokenReplayedError,
  sessionRevokedError,
} from '@/auth/errors'
import { issueAdminTokenPair, verifyRefreshToken } from '@/auth/jwt'
import {
  findRefreshTokenForSession,
  getAdminRolesForUser,
  insertRefreshToken,
  markRefreshTokenUsed,
  revokeSession,
  updateRefreshRotation,
} from '@/auth/repository'
import { hashTokenJti } from '@/auth/token-hash'

export async function handleAdminTokenRefresh(params: {
  c: Context<{ Bindings: ApiBindings }>
  payload: AdminTokenRefreshRequest
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

  const nowMs = Date.now()
  const jtiHash = await hashTokenJti(claims.jti)
  const currentToken = await findRefreshTokenForSession({
    db: db,
    jtiHash,
    sessionId: claims.sid,
  })

  if (!currentToken || currentToken.applicationCode !== 'admin') {
    throw refreshTokenInvalidError()
  }

  if (currentToken.sessionRevokedAtMs !== null) {
    throw sessionRevokedError()
  }

  if (currentToken.revokedAtMs !== null || currentToken.expiresAtMs <= nowMs) {
    throw refreshTokenInvalidError()
  }

  if (currentToken.usedAtMs !== null) {
    await revokeSession({
      db: db,
      sessionId: currentToken.sessionId,
      revokedAtMs: nowMs,
      reason: 'refresh_token_replay',
    })

    throw refreshTokenReplayedError()
  }

  const markedUsed = await markRefreshTokenUsed({
    db: db,
    tokenId: currentToken.tokenId,
    usedAtMs: nowMs,
  })

  if (!markedUsed) {
    await revokeSession({
      db: db,
      sessionId: currentToken.sessionId,
      revokedAtMs: nowMs,
      reason: 'refresh_token_replay',
    })

    throw refreshTokenReplayedError()
  }

  const roles = await getAdminRolesForUser(db, claims.sub)

  if (roles.length === 0) {
    await revokeSession({
      db: db,
      sessionId: currentToken.sessionId,
      revokedAtMs: nowMs,
      reason: 'admin_role_missing',
    })

    throw adminRoleRequiredError()
  }

  const refreshExpiresAtMs = nowMs + env.REFRESH_TOKEN_TTL_SEC * 1000
  const session = {
    sessionId: currentToken.sessionId,
    userId: claims.sub,
    app: 'admin' as const,
    roles,
    expiresAtMs: refreshExpiresAtMs,
  }

  const tokenPair = await issueAdminTokenPair({
    session,
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtlSec: env.ACCESS_TOKEN_TTL_SEC,
    refreshTtlSec: env.REFRESH_TOKEN_TTL_SEC,
  })

  await insertRefreshToken({
    db: db,
    tokenId: tokenPair.refreshJti,
    sessionId: currentToken.sessionId,
    jtiHash: await hashTokenJti(tokenPair.refreshJti),
    parentTokenId: currentToken.tokenId,
    issuedAtMs: nowMs,
    expiresAtMs: refreshExpiresAtMs,
  })

  await updateRefreshRotation({
    db: db,
    oldTokenId: currentToken.tokenId,
    newTokenId: tokenPair.refreshJti,
    sessionId: currentToken.sessionId,
    lastSeenAtMs: nowMs,
  })

  return AdminTokenRefreshResponseSchema.parse({
    accessToken: tokenPair.accessToken,
    refreshToken: tokenPair.refreshToken,
    tokenType: 'Bearer',
    expiresInSec: env.ACCESS_TOKEN_TTL_SEC,
    refreshExpiresInSec: env.REFRESH_TOKEN_TTL_SEC,
    session,
  })
}
```

## 3. 开头先把上下文准备好

和密码登录那条 service 很像，这段函数一开始也先把后面一定会反复用到的东西准备好：

admin-token-refresh.ts

```typescript
const { c, payload } = params
const db = getDb(c.env.DB)
const env = getApiEnv(c.env)
```

这里没什么花活。

- `payload` 里装的是前端传上来的 refresh token

- `db` 是后面 repository 方法要用的数据库客户端

- `env` 里装的是 refresh secret、access secret 和两类 token 的 TTL

这一步做完之后，后面整条 refresh 流程就能一直顺着往下走。

## 4. 第一层：先验这张 refresh token 本身对不对

真正的 refresh 流程，是从这里开始的：

admin-token-refresh.ts

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

这里的意思很直接。

前端先把 refresh token 带上来，service 先交给 `verifyRefreshToken(...)` 去验。验的内容包括签名、过期时间、claims 结构这些基础合法性。

如果这一步就过不去，后面根本没必要再去查数据库了，直接收口成：

admin-token-refresh.ts

```typescript
throw refreshTokenInvalidError()
```

也就是说，到这里为止，系统回答的问题只是：**这张 token 在 JWT 这一层是不是一张像样的 refresh token。**

## 5. 第二层：把 token 里的 jti 变成数据库能查的键

JWT 验通过之后，函数立刻做了两件事：

admin-token-refresh.ts

```typescript
const nowMs = Date.now()
const jtiHash = await hashTokenJti(claims.jti)
```

`nowMs` 很好理解，后面一连串状态判断都要用当前时间。

`jtiHash` 更关键。

refresh token 里带着 `jti`，但后面查数据库时，不是直接拿原始 `jti` 去查，而是先做了一次 hash。这样数据库里真正匹配的是 hash 之后的值。

接着就把这个 hash 和 session id 一起拿去查当前 token 记录：

admin-token-refresh.ts

```typescript
const currentToken = await findRefreshTokenForSession({
  db: db,
  jtiHash,
  sessionId: claims.sid,
})
```

到这里，refresh 流程就从“验 JWT”进入了“验数据库状态”这一步。

## 6. 第三层：先确认数据库里真的有这张 token

查完数据库之后，第一道判断是：

admin-token-refresh.ts

```typescript
if (!currentToken || currentToken.applicationCode !== 'admin') {
  throw refreshTokenInvalidError()
}
```

这一步其实在做两件事。

第一件事，确认数据库里真的能找到这张 refresh token 的记录。

第二件事，确认它属于 `admin` 这条线，而不是别的 application。

只要其中一条不满足，还是直接收口成 `refreshTokenInvalidError()`。

这说明 service 对外并不想暴露太细的内部状态差异。找不到、类型不对、application 不对，在这里都统一算无效 token。

## 7. 第四层：session 有没有被撤销

接下来单独看 session 状态：

admin-token-refresh.ts

```typescript
if (currentToken.sessionRevokedAtMs !== null) {
  throw sessionRevokedError()
}
```

这一句说明 refresh 不只是看 token 自己，还要看它挂在哪个 session 上。

如果整个 session 已经被撤销了，那这张 refresh token 就算自己没过期、没标记 used，也不该继续发新 token。

这里抛的是：

- `sessionRevokedError()`

这和前面的 `refreshTokenInvalidError()` 分开了，说明“session 已撤销”在业务上被单独当成一类状态处理。

## 8. 第五层：token 自己有没有过期或被撤销

session 还活着，接着再看 token 自己：

admin-token-refresh.ts

```typescript
if (currentToken.revokedAtMs !== null || currentToken.expiresAtMs <= nowMs) {
  throw refreshTokenInvalidError()
}
```

这里看的是两件事：

- `revokedAtMs !== null`

- `expiresAtMs <= nowMs`

也就是这张 token 有没有被撤销，或者有没有过期。

这一步也很好理解。refresh token 本身如果已经失效，后面当然不能继续参与 rotation。

## 9. 第六层：如果它已经被用过，那事情就不是“普通失效”了

前面那些判断都还是“这张 token 是否还有效”。

到了这里，事情开始变得敏感：

admin-token-refresh.ts

```typescript
if (currentToken.usedAtMs !== null) {
  await revokeSession({
    db: db,
    sessionId: currentToken.sessionId,
    revokedAtMs: nowMs,
    reason: 'refresh_token_replay',
  })

  throw refreshTokenReplayedError()
}
```

`usedAtMs !== null` 的意思，就是这张 refresh token 之前已经成功用过一次了。

refresh token 一旦被设计成 rotation 模式，就不应该被重复使用。只要它已经被用过，还再次出现在这里，系统就会把它当成 replay 风险处理。

这里的处理也很干脆：

- 先撤销整个 session

- 再抛 `refreshTokenReplayedError()`

所以这一步和“过期了”“失效了”不一样。它不是单纯不给续签，而是把整条 session 直接收掉。

## 10. 第七层：真正的并发竞争点在 markRefreshTokenUsed

前面那一步拦住的是“已经明显被用过的 token”。

但并发刷新最麻烦的地方在于：两个请求可能几乎同时进来，在它们各自读 `usedAtMs` 时，看到的都还是 `null`。

这时候真正决定谁赢谁输的，是这一步：

admin-token-refresh.ts

```typescript
const markedUsed = await markRefreshTokenUsed({
  db: db,
  tokenId: currentToken.tokenId,
  usedAtMs: nowMs,
})
```

它的作用，就是去抢这张旧 token 的“used 标记”。

后面的判断非常关键：

admin-token-refresh.ts

```typescript
if (!markedUsed) {
  await revokeSession({
    db: db,
    sessionId: currentToken.sessionId,
    revokedAtMs: nowMs,
    reason: 'refresh_token_replay',
  })

  throw refreshTokenReplayedError()
}
```

也就是说，只有第一个成功把旧 token 标成 used 的请求，才有资格继续往下走。

后面那些抢输的并发请求，不会继续发新 token，而是直接把整条 session 撤掉，再抛 replay 错误。

这一步其实就是整条 refresh 链里最容易写乱、也最关键的地方。

旧 token 一定要先抢占成功，再谈后面的新 token。顺序不能反。

## 11. 第八层：refresh 时还要重新查一次角色

并发问题处理完之后，函数又回头查了一次角色：

admin-token-refresh.ts

```typescript
const roles = await getAdminRolesForUser(db, claims.sub)

if (roles.length === 0) {
  await revokeSession({
    db: db,
    sessionId: currentToken.sessionId,
    revokedAtMs: nowMs,
    reason: 'admin_role_missing',
  })

  throw adminRoleRequiredError()
}
```

这一步非常有现实意义。

因为 refresh 不是单纯复刻旧 session，而是一次新的续签动作。既然是重新发 token，就顺手再看一遍这个人现在还有没有 admin 角色。

如果角色已经没了，系统不会继续给他续签，而是：

- 先撤销 session

- 再抛 `adminRoleRequiredError()`

这就把“后台权限变更”及时收进了下一次 refresh。

## 12. 旧 token 这边都处理完了，才开始准备新 session 视角的数据

到这里，旧 refresh token 该验证的都验证完了。接下来才轮到准备新 token 要用的数据：

admin-token-refresh.ts

```typescript
const refreshExpiresAtMs = nowMs + env.REFRESH_TOKEN_TTL_SEC * 1000
const session = {
  sessionId: currentToken.sessionId,
  userId: claims.sub,
  app: 'admin' as const,
  roles,
  expiresAtMs: refreshExpiresAtMs,
}
```

这里没有重新创建一个全新的 session，而是沿用原来的 `sessionId`。

这很合理，因为 refresh 并不是重新登录，而是沿着当前 session 续签一轮新的 token。

不过新的 refresh 过期时间会重新按当前时间往后推，所以这里重新算了：

- `refreshExpiresAtMs`

然后把当前续签这一轮需要的 session 视角数据整理出来，交给下面的 JWT 模块继续用。

## 13. 第九层：签一对新的 token

admin-token-refresh.ts

```typescript
const tokenPair = await issueAdminTokenPair({
  session,
  accessSecret: env.JWT_ACCESS_SECRET,
  refreshSecret: env.JWT_REFRESH_SECRET,
  accessTtlSec: env.ACCESS_TOKEN_TTL_SEC,
  refreshTtlSec: env.REFRESH_TOKEN_TTL_SEC,
})
```

这里和密码登录那条线很像，都是直接调：

- `issueAdminTokenPair(...)`

也就是说，refresh 流程在真正发 token 这一层，并没有自己手写 JWT 细节，而是继续复用那套“给 admin session 发一对 token”的工具方法。

service 这一层只需要把：

- session

- secret

- TTL

这些材料准备好，然后拿回新的 access token 和 refresh token。

## 14. 第十层：先把新 token 写进去

签完新 token 之后，先做的是插入新 token 的数据库记录：

admin-token-refresh.ts

```typescript
await insertRefreshToken({
  db: db,
  tokenId: tokenPair.refreshJti,
  sessionId: currentToken.sessionId,
  jtiHash: await hashTokenJti(tokenPair.refreshJti),
  parentTokenId: currentToken.tokenId,
  issuedAtMs: nowMs,
  expiresAtMs: refreshExpiresAtMs,
})
```

这里最值得看的，是：

- `tokenId: tokenPair.refreshJti`

- `parentTokenId: currentToken.tokenId`

这说明新 token 和旧 token 的关系已经被串起来了。

新 token 不是孤零零插进去的，它会明确指向自己的父 token，也就是这次被拿来续签的那一张旧 refresh token。

到这里为止，数据库里已经有了这张新 token 自己的状态记录。

## 15. 第十一层：再回头把旧 token 指向新 token

新 token 插进去之后，才轮到更新 rotation 关系：

admin-token-refresh.ts

```typescript
await updateRefreshRotation({
  db: db,
  oldTokenId: currentToken.tokenId,
  newTokenId: tokenPair.refreshJti,
  sessionId: currentToken.sessionId,
  lastSeenAtMs: nowMs,
})
```

这一步做的事，可以直接理解成两句：

- 旧 token 现在已经被新 token 替换了

- 这个 session 刚刚又活跃了一次

所以这一步不是“创建新 token”，而是把旧 token 和新 token 之间的交接关系补完整。

这也就是 refresh 这条线最核心的 rotation 写入顺序：

- 先抢占旧 token 的 used 标记

- 再签新 token

- 再插入新 token 记录

- 最后回写 old -> new 的替换关系

顺序乱了，整条 refresh 链就容易出问题。

## 16. 最后一步：把这一轮续签结果整理成响应

admin-token-refresh.ts

```typescript
return AdminTokenRefreshResponseSchema.parse({
  accessToken: tokenPair.accessToken,
  refreshToken: tokenPair.refreshToken,
  tokenType: 'Bearer',
  expiresInSec: env.ACCESS_TOKEN_TTL_SEC,
  refreshExpiresInSec: env.REFRESH_TOKEN_TTL_SEC,
  session,
})
```

前面的工作都做完之后，最后一步才是把响应体整理好。

这里返回的内容和登录那条线很像：

- 新 access token

- 新 refresh token

- token type

- access token 过期秒数

- refresh token 过期秒数

- 当前 session 视角的数据

而且同样不是直接 return 普通对象，而是：

- `AdminTokenRefreshResponseSchema.parse(...)`

这样响应结构就继续和契约层保持一致

NOTE

退出登录的逻辑，这里就不再文章中赘述，大家可以根据源码自行阅读学习
