---
title: "160 jwt.ts 代码详解"
pubDate: 2026-05-31
description: "所以读这份代码时，不要把注意力放在完整登录流程上，而是直接看每个方法收什么、做什么、返回什么。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/25-jwt-ts-details/](https://aicompanion.usehook.cn/25-jwt-ts-details/)

## 1. 先定性：jwt.ts 是一组令牌工具方法

我们先把 `token` 签发的功能单独封装出来

它只负责 4 件事：

- 把 secret 转成 `jose` 需要的格式

- 签 access token

- 签 refresh token

- 验 refresh token

- 顺手提供一个「一次发一对 token」的方法

所以读这份代码时，不要把注意力放在完整登录流程上，而是直接看每个方法收什么、做什么、返回什么。

## 2. 完整代码

jwt.ts

```typescript
import { SignJWT, jwtVerify } from 'jose'
import { uuidv7 } from 'uuidv7'
import type {
  AccessTokenClaims,
  RefreshTokenClaims,
  SessionContext,
} from './types'

const encoder = new TextEncoder()

function toSecret(secret: string): Uint8Array {
  return encoder.encode(secret)
}

export async function signAccessToken(params: {
  claims: AccessTokenClaims
  secret: string
  ttlSec: number
}): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000)

  // access token 只带请求链路真正需要的最小身份信息，避免把会话状态塞进无状态令牌里。
  return new SignJWT({
    sid: params.claims.sid,
    app: params.claims.app,
    roles: params.claims.roles,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(params.claims.sub)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + params.ttlSec)
    .sign(toSecret(params.secret))
}

export async function signRefreshToken(params: {
  claims: Omit<RefreshTokenClaims, 'jti'>
  secret: string
  ttlSec: number
}): Promise<{
  token: string
  jti: string
}> {
  const nowSec = Math.floor(Date.now() / 1000)
  const jti = uuidv7()

  // refresh token 额外携带 jti，是为了把每一次续签都变成可追踪、可撤销的一条状态记录。
  const token = await new SignJWT({
    sid: params.claims.sid,
    app: params.claims.app,
    jti,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(params.claims.sub)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + params.ttlSec)
    .sign(toSecret(params.secret))

  return { token, jti }
}

export async function verifyRefreshToken(params: {
  token: string
  secret: string
}): Promise<RefreshTokenClaims> {
  const { payload } = await jwtVerify(params.token, toSecret(params.secret), {
    algorithms: ['HS256'],
  })

  const sid = payload.sid
  const app = payload.app
  const jti = payload.jti
  const sub = payload.sub

  if (
    typeof sid !== 'string' ||
    typeof app !== 'string' ||
    typeof jti !== 'string' ||
    typeof sub !== 'string' ||
    app !== 'admin'
  ) {
    throw new Error('Invalid refresh token claims')
  }

  return {
    sid,
    app: 'admin',
    jti,
    sub,
  }
}

export async function issueAdminTokenPair(params: {
  session: SessionContext
  accessSecret: string
  refreshSecret: string
  accessTtlSec: number
  refreshTtlSec: number
}): Promise<{
  accessToken: string
  refreshToken: string
  refreshJti: string
}> {
  const accessToken = await signAccessToken({
    claims: {
      sub: params.session.userId,
      sid: params.session.sessionId,
      app: params.session.app,
      roles: params.session.roles,
    },
    secret: params.accessSecret,
    ttlSec: params.accessTtlSec,
  })

  const refresh = await signRefreshToken({
    claims: {
      sub: params.session.userId,
      sid: params.session.sessionId,
      app: params.session.app,
    },
    secret: params.refreshSecret,
    ttlSec: params.refreshTtlSec,
  })

  return {
    accessToken,
    refreshToken: refresh.token,
    refreshJti: refresh.jti,
  }
}
```

## 3. 先认识 jose 里用到的两个核心 API

这份代码虽然不长，但第一次看时，很多人会先被这一行卡住：

jwt.ts

```typescript
import { SignJWT, jwtVerify } from 'jose'
```

这里先不要急着往业务逻辑里钻，先把 `jose` 这两个 API 的基本用法认清楚。

### 3.1 SignJWT

`SignJWT` 是用来创建并签发 JWT 的。

它的调用方式是链式写法。也就是先 `new` 一个实例，把 payload 传进去，再一段一段补 header、subject、时间字段，最后调用 `.sign(...)`。

这份代码里的典型写法就是：

jwt.ts

```typescript
new SignJWT({
  sid: params.claims.sid,
  app: params.claims.app,
  roles: params.claims.roles,
})
  .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
  .setSubject(params.claims.sub)
  .setIssuedAt(nowSec)
  .setExpirationTime(nowSec + params.ttlSec)
  .sign(toSecret(params.secret))
```

可以把它顺着读成这样：

- 先准备 payload

- 再设置 header

- 再设置 `sub`

- 再设置签发时间

- 再设置过期时间

- 最后用 secret 签名

最后 `.sign(...)` 返回的就是一个 JWT 字符串。

### 3.2 jwtVerify

`jwtVerify` 则是反过来的动作，用来验证一张 JWT。

这份代码里的写法是：

jwt.ts

```typescript
const { payload } = await jwtVerify(params.token, toSecret(params.secret), {
  algorithms: ['HS256'],
})
```

它做的事可以直接按参数理解：

- 第一个参数：待校验的 token

- 第二个参数：验签要用的 secret

- 第三个参数：额外的校验选项，这里限制只接受 `HS256`

如果校验通过，它会返回解析结果，这里只取了其中的 `payload`。

如果校验失败，比如签名不对、算法不匹配、token 已过期，这里就会直接抛错。

### 3.3 先把 jose 的角色记清楚

所以在这份 `jwt.ts` 里，`jose` 其实只做两类事：

- `SignJWT`：负责把数据签成 JWT

- `jwtVerify`：负责把 JWT 验证并解析回来

后面的 `toSecret`、`signAccessToken`、`signRefreshToken`、`verifyRefreshToken`，本质上都是在这两个基础 API 之上，再包一层更贴合当前项目的工具方法。

## 4. toSecret

先看最小的方法：

jwt.ts

```typescript
const encoder = new TextEncoder()

function toSecret(secret: string): Uint8Array {
  return encoder.encode(secret)
}
```

它的输入很简单：一个字符串 secret。

它的输出也很简单：`Uint8Array`。

这里的作用就是做一次格式转换。因为传进来的 secret 通常来自环境变量，本质上是字符串，而 `jose` 在签名和验签时需要的是字节序列。

所以这个方法的意义，不在业务逻辑，而在于统一适配。

后面只要看到：

jwt.ts

```typescript
.sign(toSecret(params.secret))
```

或者：

jwt.ts

```typescript
jwtVerify(params.token, toSecret(params.secret), ...)
```

就知道它是在把字符串密钥转成 `jose` 能直接使用的格式。

## 4. signAccessToken

jwt.ts

```typescript
export async function signAccessToken(params: {
  claims: AccessTokenClaims
  secret: string
  ttlSec: number
}): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000)

  return new SignJWT({
    sid: params.claims.sid,
    app: params.claims.app,
    roles: params.claims.roles,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(params.claims.sub)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + params.ttlSec)
    .sign(toSecret(params.secret))
}
```

这个方法签出来的是 access token。

先看它的入参：

- `claims`

- `secret`

- `ttlSec`

`claims` 里是这张 token 想表达的身份信息。`secret` 是签名密钥。`ttlSec` 是过期时间，单位是秒。

再往下看方法内部。

### 4.1 nowSec

jwt.ts

```typescript
const nowSec = Math.floor(Date.now() / 1000)
```

这里把当前时间转成秒。

因为后面 `.setIssuedAt(...)` 和 `.setExpirationTime(...)` 用的都是秒级时间。

### 4.2 new SignJWT(...)

jwt.ts

```typescript
new SignJWT({
  sid: params.claims.sid,
  app: params.claims.app,
  roles: params.claims.roles,
})
```

这里是在构造 JWT payload。

这份 access token 里放了 3 个自定义字段：

- `sid`

- `app`

- `roles`

这意味着后面接口在解析 access token 时，可以从 payload 里读到当前 session id、application 和角色信息。

### 4.3 .setSubject(...)

jwt.ts

```typescript
.setSubject(params.claims.sub)
```

这里单独设置了 `sub`。

也就是说，`sub` 没有放在前面的自定义 payload 对象里，而是作为 JWT 标准字段单独写入。

在这份代码里，`sub` 表示用户 id。

### 4.4 .setProtectedHeader(...)

jwt.ts

```typescript
.setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
```

这一行是在设置 JWT header。

- `alg: 'HS256'` 表示签名算法是 HS256

- `typ: 'JWT'` 表示这是一个 JWT

这里不复杂，主要就是告诉验证方：这张 token 是按什么算法签出来的。

### 4.5 .setIssuedAt(...) 和 .setExpirationTime(...)

jwt.ts

```typescript
.setIssuedAt(nowSec)
.setExpirationTime(nowSec + params.ttlSec)
```

这两行分别写入：

- 签发时间

- 过期时间

过期时间的计算方式也很直接：当前秒数加上 `ttlSec`。

### 4.6 .sign(...)

jwt.ts

```typescript
.sign(toSecret(params.secret))
```

最后一步是真正签名。

这里把字符串 secret 先交给 `toSecret(...)` 转成 `Uint8Array`，再交给 `jose` 完成签名。

整个方法的返回值是一个 `Promise<string>`，也就是最终签好的 access token 字符串。

## 5. signRefreshToken

jwt.ts

```typescript
export async function signRefreshToken(params: {
  claims: Omit<RefreshTokenClaims, 'jti'>
  secret: string
  ttlSec: number
}): Promise<{
  token: string
  jti: string
}> {
  const nowSec = Math.floor(Date.now() / 1000)
  const jti = uuidv7()

  const token = await new SignJWT({
    sid: params.claims.sid,
    app: params.claims.app,
    jti,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(params.claims.sub)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + params.ttlSec)
    .sign(toSecret(params.secret))

  return { token, jti }
}
```

这个方法和 `signAccessToken` 很像，但有两个明显区别。

### 5.1 入参类型不同

jwt.ts

```typescript
claims: Omit<RefreshTokenClaims, 'jti'>
```

这里的 `claims` 不是完整的 `RefreshTokenClaims`，而是去掉了 `jti`。

这说明 `jti` 不是调用方传进来的，而是方法内部自己生成。

### 5.2 方法内部会自己生成 jti

jwt.ts

```typescript
const jti = uuidv7()
```

这一行会生成一个新的唯一 id。

后面构造 payload 时，除了 `sid`、`app` 之外，又额外放进了：

- `jti`

所以 refresh token 的 payload 里会多一个唯一编号。

### 5.3 payload 长什么样

jwt.ts

```typescript
new SignJWT({
  sid: params.claims.sid,
  app: params.claims.app,
  jti,
})
  .setSubject(params.claims.sub)
```

这一段说明 refresh token 里最终会有这些关键字段：

- `sub`

- `sid`

- `app`

- `jti`

和 access token 相比，它没有放 `roles`，但多了 `jti`。

### 5.4 返回值为什么不是字符串

jwt.ts

```typescript
return { token, jti }
```

这个方法的返回值不是单独一个字符串，而是一个对象：

- `token`

- `jti`

这说明调用方后面不只需要 refresh token 本身，还需要知道这张 token 对应的唯一编号。

所以这个方法在职责上比 `signAccessToken` 多做了一件事：除了签 token，还把生成出来的编号一并交出去。

## 6. verifyRefreshToken

jwt.ts

```typescript
export async function verifyRefreshToken(params: {
  token: string
  secret: string
}): Promise<RefreshTokenClaims> {
  const { payload } = await jwtVerify(params.token, toSecret(params.secret), {
    algorithms: ['HS256'],
  })

  const sid = payload.sid
  const app = payload.app
  const jti = payload.jti
  const sub = payload.sub

  if (
    typeof sid !== 'string' ||
    typeof app !== 'string' ||
    typeof jti !== 'string' ||
    typeof sub !== 'string' ||
    app !== 'admin'
  ) {
    throw new Error('Invalid refresh token claims')
  }

  return {
    sid,
    app: 'admin',
    jti,
    sub,
  }
}
```

这个方法负责验证 refresh token，并把解析后的 claims 返回出去。

### 6.1 入参

它只收两个值：

- `token`

- `secret`

一个是待校验的 refresh token，一个是验签密钥。

### 6.2 jwtVerify(...)

jwt.ts

```typescript
const { payload } = await jwtVerify(params.token, toSecret(params.secret), {
  algorithms: ['HS256'],
})
```

这一步会做 JWT 校验。

这里有两个点值得直接看代码本身：

第一，它同样用了 `toSecret(...)`，说明验签时也要把字符串密钥转成 `Uint8Array`。

第二，它把允许的算法明确限制成了：

- `HS256`

也就是说，这个方法只接受按 HS256 签出来的 token。

### 6.3 从 payload 里拆字段

jwt.ts

```typescript
const sid = payload.sid
const app = payload.app
const jti = payload.jti
const sub = payload.sub
```

这一段没有直接把 `payload` 整包返回，而是先把需要的字段一个个取出来。

从这里就能看出，这个方法真正关心的是 refresh token 里的 4 个字段：

- `sid`

- `app`

- `jti`

- `sub`

### 6.4 字段校验

jwt.ts

```typescript
if (
  typeof sid !== 'string' ||
  typeof app !== 'string' ||
  typeof jti !== 'string' ||
  typeof sub !== 'string' ||
  app !== 'admin'
) {
  throw new Error('Invalid refresh token claims')
}
```

这里做了两层检查。

一层是类型检查，要求这几个字段都必须是字符串。

另一层是值检查，要求：

- `app === 'admin'`

这说明这个验证方法不是泛用的 token 解析器，而是一个带有 admin 约束的 refresh token 验证方法。

### 6.5 返回值

jwt.ts

```typescript
return {
  sid,
  app: 'admin',
  jti,
  sub,
}
```

校验通过后，它返回一个结构明确的对象。

这里没有把原始 `payload` 直接透传，而是返回一份已经整理过、已经通过类型和业务检查的结果。

## 7. issueAdminTokenPair

jwt.ts

```typescript
export async function issueAdminTokenPair(params: {
  session: SessionContext
  accessSecret: string
  refreshSecret: string
  accessTtlSec: number
  refreshTtlSec: number
}): Promise<{
  accessToken: string
  refreshToken: string
  refreshJti: string
}> {
  const accessToken = await signAccessToken({
    claims: {
      sub: params.session.userId,
      sid: params.session.sessionId,
      app: params.session.app,
      roles: params.session.roles,
    },
    secret: params.accessSecret,
    ttlSec: params.accessTtlSec,
  })

  const refresh = await signRefreshToken({
    claims: {
      sub: params.session.userId,
      sid: params.session.sessionId,
      app: params.session.app,
    },
    secret: params.refreshSecret,
    ttlSec: params.refreshTtlSec,
  })

  return {
    accessToken,
    refreshToken: refresh.token,
    refreshJti: refresh.jti,
  }
}
```

这个方法不是底层签名方法，而是一个组合方法。

它的作用很直接：一次性生成一对 token。

### 7.1 入参

它不再直接收 `claims`，而是收一个更完整的 `session`：

- `session`

- `accessSecret`

- `refreshSecret`

- `accessTtlSec`

- `refreshTtlSec`

这意味着它不是“签单张 token”的方法，而是站在更上一层，用 session 去派生 access token 和 refresh token。

### 7.2 它怎么调用 signAccessToken

jwt.ts

```typescript
const accessToken = await signAccessToken({
  claims: {
    sub: params.session.userId,
    sid: params.session.sessionId,
    app: params.session.app,
    roles: params.session.roles,
  },
  secret: params.accessSecret,
  ttlSec: params.accessTtlSec,
})
```

这里先把 `session` 里的字段映射成 access token 需要的 claims。

可以直接对照出来：

- `userId -> sub`

- `sessionId -> sid`

- `app -> app`

- `roles -> roles`

### 7.3 它怎么调用 signRefreshToken

jwt.ts

```typescript
const refresh = await signRefreshToken({
  claims: {
    sub: params.session.userId,
    sid: params.session.sessionId,
    app: params.session.app,
  },
  secret: params.refreshSecret,
  ttlSec: params.refreshTtlSec,
})
```

这里同样也是从 `session` 里取字段，但这次没有传 `roles`。

因为 refresh token 的签发方法不需要 `roles`，它只关心：

- `sub`

- `sid`

- `app`

### 7.4 最终返回什么

jwt.ts

```typescript
return {
  accessToken,
  refreshToken: refresh.token,
  refreshJti: refresh.jti,
}
```

最后返回的是一个更适合业务层直接使用的结果：

- `accessToken`

- `refreshToken`

- `refreshJti`

这里把 `signRefreshToken` 返回的 `token` 重命名成了 `refreshToken`，把 `jti` 重命名成了 `refreshJti`，让返回值语义更清楚。

## 8. 这几个方法放在一起之后，职责就清楚了

如果只看单个方法，容易把它们当成零散工具。

放在一起看，职责其实很清楚。

`toSecret` 负责做密钥格式转换。

`signAccessToken` 负责签 access token，返回字符串。

`signRefreshToken` 负责签 refresh token，同时返回 token 和它的 `jti`。

`verifyRefreshToken` 负责验 refresh token，再把需要的 claims 整理出来。

`issueAdminTokenPair` 不自己发明新规则，只是把前面的签发方法组装起来，提供一个更顺手的上层入口。

所以这份 `jwt.ts`` 更适合当成一个小型工具模块来看：底层方法负责单点动作，上层方法负责组合。
