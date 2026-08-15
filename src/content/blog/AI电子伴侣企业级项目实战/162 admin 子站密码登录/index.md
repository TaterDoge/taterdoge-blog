---
title: "162 admin 子站密码登录"
pubDate: 2026-06-01
description: "用户在后台登录页输入邮箱和密码之后，后端真正要做的事，其实就是顺着这条线一段一段往下走："
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/27-admin-password-login/](https://aicompanion.usehook.cn/27-admin-password-login/)

## 1. 登录主线

接下来我们学习一下，在逻辑拆分之后，admin 的登录接口在服务端应该怎么写

用户在后台登录页输入邮箱和密码之后，后端真正要做的事，其实就是顺着这条线一段一段往下走：

先看 admin 现在还允不允许密码登录，再去查这个邮箱对应的是谁，再校验密码，再确认这个人到底能不能进后台。前面这些都通过了，后面才轮到创建 session、签 token、把 refresh token 的状态写进数据库，最后把响应结构整理好返回给前端。

## 2. 完整代码

admin-password-login.ts

```typescript
import { AdminPasswordLoginResponseSchema } from '@repo/contracts'
import type { ApiBindings } from '@/bindings'
import { getDb } from '@/db/client'
import { getApiEnv } from '@/env'
import {
  adminRoleRequiredError,
  authMethodDisabledError,
  invalidCredentialsError,
} from '@/auth/errors'
import { issueAdminTokenPair } from '@/auth/jwt'
import { verifyPasswordHash } from '@/auth/password'
import { getIp, getUserAgent, normalizeEmail } from '@/auth/request-context'
import {
  createAdminSession,
  findLoginUserByNormalizedEmail,
  getAdminApplicationId,
  getAdminRolesForUser,
  insertRefreshToken,
  isPasswordLoginEnabledForAdmin,
} from '@/auth/repository'
import { hashTokenJti } from '@/auth/token-hash'
import type { Context } from 'hono'
import type { AdminPasswordLoginRequest } from '@repo/contracts'

export async function handleAdminPasswordLogin(params: {
  c: Context<{ Bindings: ApiBindings }>
  payload: AdminPasswordLoginRequest
}) {
  const { c, payload } = params
  const db = getDb(c.env.DB)
  const env = getApiEnv(c.env)

  if (!(await isPasswordLoginEnabledForAdmin(db))) {
    throw authMethodDisabledError()
  }

  const normalizedEmail = normalizeEmail(payload.email)
  const loginUser = await findLoginUserByNormalizedEmail(db, normalizedEmail)

  if (!loginUser) {
    throw invalidCredentialsError()
  }

  const isPasswordValid = await verifyPasswordHash({
    password: payload.password,
    passwordHash: loginUser.passwordHash,
    passwordAlgo: loginUser.passwordAlgo,
  })

  if (!isPasswordValid || loginUser.userStatus !== 'active') {
    throw invalidCredentialsError()
  }

  const roles = await getAdminRolesForUser(db, loginUser.userId)

  if (roles.length === 0) {
    throw adminRoleRequiredError()
  }

  const applicationId = await getAdminApplicationId(db)
  const nowMs = Date.now()
  const refreshExpiresAtMs = nowMs + env.REFRESH_TOKEN_TTL_SEC * 1000
  const session = await createAdminSession({
    db: db,
    userId: loginUser.userId,
    applicationId,
    userAgent: getUserAgent(c),
    ip: getIp(c),
    nowMs,
    expiresAtMs: refreshExpiresAtMs,
    roles,
  })

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
    sessionId: session.sessionId,
    jtiHash: await hashTokenJti(tokenPair.refreshJti),
    parentTokenId: null,
    issuedAtMs: nowMs,
    expiresAtMs: refreshExpiresAtMs,
  })

  return AdminPasswordLoginResponseSchema.parse({
    accessToken: tokenPair.accessToken,
    refreshToken: tokenPair.refreshToken,
    tokenType: 'Bearer',
    expiresInSec: env.ACCESS_TOKEN_TTL_SEC,
    refreshExpiresInSec: env.REFRESH_TOKEN_TTL_SEC,
    session,
  })
}
```

## 3. 先准备什么

函数开头先做了两件小事：

admin-password-login.ts

```typescript
const { c, payload } = params
const db = getDb(c.env.DB)
const env = getApiEnv(c.env)
```

第一件事是把参数拆开。

`payload` 就是前端传上来的登录数据，也就是邮箱和密码。`c` 则是 Hono 的上下文对象，后面拿环境变量、拿 IP、拿 User-Agent 都要从它身上走。

第二件事是把两个后面一定会反复用到的东西先准备好：

- `db`

- `env`

`db` 代表这次请求要用的数据库连接。后面所有 repository 方法都会用到它。

`env` 则把 JWT secret、token 过期时间这些配置先拿出来。这样后面签 token 时就不用再到处从 `c.env` 里零碎地取。

这一步很轻，但很有 service 的味道：先把这条业务线要用的上下文准备好，后面就能一直顺着往下走。

## 4. 先查登录策略

接下来第一步不是查用户，也不是验密码，而是先看 admin 这条线现在还让不让用 password 登录：

admin-password-login.ts

```typescript
if (!(await isPasswordLoginEnabledForAdmin(db))) {
  throw authMethodDisabledError()
}
```

这个顺序是对的。

因为如果后台当前压根没开密码登录，那后面那些查邮箱、验密码的动作就都没有意义了。早点挡掉，既省事，也更符合这条业务线本身的边界。

这里还有一个很明显的分层感：

- 这个 service 只表达“去查一下当前策略”

- 至于具体查哪些表、怎么写条件，不在这里展开

所以你读到这里时，脑子里只需要记住一句话：**先看 admin 当前策略。**

## 5. 查登录用户

策略通过之后，才轮到真正去碰用户数据。

admin-password-login.ts

```typescript
const normalizedEmail = normalizeEmail(payload.email)
const loginUser = await findLoginUserByNormalizedEmail(db, normalizedEmail)

if (!loginUser) {
  throw invalidCredentialsError()
}
```

这里先做了一步很小但很关键的动作：

admin-password-login.ts

```typescript
const normalizedEmail = normalizeEmail(payload.email)
```

也就是说，系统不会直接拿用户原样输入的邮箱去查库，而是先标准化一遍。

这一步做完之后，才会真正去数据库里找：

admin-password-login.ts

```typescript
const loginUser = await findLoginUserByNormalizedEmail(db, normalizedEmail)
```

这个 repository 方法会把登录所需的用户信息一次查出来。service 到这里并不关心它 join 了哪些表，它只关心结果有没有拿到。

如果拿不到，直接抛：

admin-password-login.ts

```typescript
throw invalidCredentialsError()
```

到这里为止，系统只是在回答一个问题：**这个邮箱，能不能在当前系统里对应到一个可登录用户。**

## 6. 验密码

找到用户之后，下一步才轮到真正的密码校验。

admin-password-login.ts

```typescript
const isPasswordValid = await verifyPasswordHash({
  password: payload.password,
  passwordHash: loginUser.passwordHash,
  passwordAlgo: loginUser.passwordAlgo,
})
```

这里的写法很清楚。

用户输入的明文密码在 `payload.password` 里，数据库里存的 hash 和算法在 `loginUser` 里，service 把这三样东西交给 `verifyPasswordHash(...)`，剩下的不再展开。

也就是说，这里完全没有自己手动比对密码。密码怎么验，是 password 模块的事；service 只负责把验密码需要的材料准备好。

后面的判断也放得很集中：

admin-password-login.ts

```typescript
if (!isPasswordValid || loginUser.userStatus !== 'active') {
  throw invalidCredentialsError()
}
```

密码不对，或者用户状态不是 `active`，都统一落到 `invalidCredentialsError()`。

这个收口很重要。因为登录接口对外不需要把账号状态暴露得太细。对外统一成“凭证无效”，边界会更干净。

## 7. 查 admin 角色

很多系统做到密码校验通过就差不多结束了，但后台登录还要多过一道门。

admin-password-login.ts

```typescript
const roles = await getAdminRolesForUser(db, loginUser.userId)

if (roles.length === 0) {
  throw adminRoleRequiredError()
}
```

这一段其实很好理解。

前面那几步证明的是“你是谁”，这里证明的是“你能不能进后台”。

也就是说，后台登录不只是身份验证，还带着一层权限门禁。

如果这个用户根本没有 admin 角色，那即便邮箱是真的、密码也对，还是不能进入后台。这就是 `adminRoleRequiredError()` 出现的位置。

这个顺序放在这里也很顺：先把身份问题搞清楚，再看后台权限问题。

## 8. 准备 session 数据

前面几关都过了，说明这个请求终于从“尝试登录”进入了“允许登录”的阶段。后面要做的，就不再是拦截，而是开始真正创建登录状态。

先准备 3 个值：

admin-password-login.ts

```typescript
const applicationId = await getAdminApplicationId(db)
const nowMs = Date.now()
const refreshExpiresAtMs = nowMs + env.REFRESH_TOKEN_TTL_SEC * 1000
```

`applicationId` 后面写 session 要用。

`nowMs` 是当前毫秒时间戳。

`refreshExpiresAtMs` 则是按 refresh token 的 TTL 算出来的绝对过期时间。这里要乘 `1000`，因为环境变量给的是秒，但数据库里存的是毫秒。

这种时间换算放在 service 层很合理，因为它紧贴当前业务动作：马上就要创建 session，也马上就要落 refresh token 记录了。

## 9. 创建 session

admin-password-login.ts

```typescript
const session = await createAdminSession({
  db: db,
  userId: loginUser.userId,
  applicationId,
  userAgent: getUserAgent(c),
  ip: getIp(c),
  nowMs,
  expiresAtMs: refreshExpiresAtMs,
  roles,
})
```

这一步非常像“把已经确认无误的登录结果落库”。

先看传进去的东西。

- `userId`

- `applicationId`

- `roles`

- `nowMs`

- `expiresAtMs`

这些都很好理解。

更值得注意的是这两项：

- `userAgent: getUserAgent(c)`

- `ip: getIp(c)`

说明 service 在这里还顺手把请求上下文里的设备和来源信息提了出来，一起交给 session 创建逻辑。也就是说，这次 session 不是一个抽象状态，而是一条带着具体上下文的登录记录。

方法返回的 `session` 也不是数据库原始结果，而是一份后面还能继续往下传的业务对象。下一步签 token 就会直接吃它。

## 10. 发 token

admin-password-login.ts

```typescript
const tokenPair = await issueAdminTokenPair({
  session,
  accessSecret: env.JWT_ACCESS_SECRET,
  refreshSecret: env.JWT_REFRESH_SECRET,
  accessTtlSec: env.ACCESS_TOKEN_TTL_SEC,
  refreshTtlSec: env.REFRESH_TOKEN_TTL_SEC,
})
```

这里没有分别去签 access token 和 refresh token，而是直接调了一个更高层的方法：

- `issueAdminTokenPair(...)`

这说明 JWT 那一层已经把“给 admin session 发一对 token”这件事封好了。service 这里只需要把 session 和配置交进去，拿回完整的 token pair 就行。

这种写法很好，因为它让当前这条主线继续保持干净。

你读到这里，不会被 JWT payload 细节打断，脑子里只需要记住：**session 创建完了，现在开始发 token。**

## 11. 写 refresh token

很多人第一次看登录代码，看到 token 签完就会下意识觉得差不多结束了。但这里还差一步：

admin-password-login.ts

```typescript
await insertRefreshToken({
  db: db,
  tokenId: tokenPair.refreshJti,
  sessionId: session.sessionId,
  jtiHash: await hashTokenJti(tokenPair.refreshJti),
  parentTokenId: null,
  issuedAtMs: nowMs,
  expiresAtMs: refreshExpiresAtMs,
})
```

这一段是在给 refresh token 建状态记录。

重点可以看两个地方。

第一个是：

admin-password-login.ts

```typescript
tokenId: tokenPair.refreshJti
```

这里拿的是 refresh token 的 `jti`，也就是这张 refresh token 自己的唯一编号。

第二个是：

admin-password-login.ts

```typescript
jtiHash: await hashTokenJti(tokenPair.refreshJti)
```

这里没有直接把原始 `jti` 拿去存，而是先算了一次 hash，再把 hash 存进去。

`parentTokenId: null` 也很好理解，它说明当前这张 refresh token 还不是从上一张轮换出来的，所以没有父节点。

这一步做完之后，这次登录不只是“前端手里拿到 token”了，服务端自己也把 refresh token 的状态线索落到了数据库里。

## 12. 返回响应

admin-password-login.ts

```typescript
return AdminPasswordLoginResponseSchema.parse({
  accessToken: tokenPair.accessToken,
  refreshToken: tokenPair.refreshToken,
  tokenType: 'Bearer',
  expiresInSec: env.ACCESS_TOKEN_TTL_SEC,
  refreshExpiresInSec: env.REFRESH_TOKEN_TTL_SEC,
  session,
})
```

这一步很像收尾。

access token、refresh token、token type、过期时间、session，这些值前面都已经有了。这里做的事，是把它们重新整理成响应对象，然后再交给 `AdminPasswordLoginResponseSchema` 过一遍。

也就是说，service 最后不是“随手拼个对象就返回”，而是让返回结构再和契约层对齐一次。

这样一来，请求和响应这条线就闭合了：

- 请求进来，吃的是 `AdminPasswordLoginRequest`

- 响应出去，走的是 `AdminPasswordLoginResponseSchema`

前后结构都是有约束的。

## 13. 这段 service 串起了什么

整段代码顺下来之后，你会发现它其实像个调度中心，把几层东西串在了一起。

请求上下文这一层，提供的是：

- `c`

- `getUserAgent(c)`

- `getIp(c)`

- `getApiEnv(c.env)`

repository 这一层，负责的是数据库读写：

- 查策略

- 查用户

- 查角色

- 查 application

- 建 session

- 插 refresh token

密码模块负责验密码。

JWT 模块负责发 token。

token-hash 模块负责把 refresh token 的 `jti` 变成 hash。

错误模块负责把各种失败情况收成统一错误对象。

契约层负责把输入输出结构兜住。

而这个 service 自己做的，是把这些现成能力排成一条有顺序的登录主线。

## 14. 总结

如果把这段 `handleAdminPasswordLogin` 压成一句话，它做的就是：

先确认 admin 现在还允不允许密码登录，再确认这个邮箱和密码对应的是不是一个可进入后台的人；确认无误之后，创建 session、签一对 token、把 refresh token 状态记下来，最后按约定好的响应格式回给前端。

所以读这类 service 文件时，最好的方式不是盯着某个底层方法不放，而是先把整条主线顺下来。主线顺了，每个模块为什么会在这里出现，自然就都明白了。
