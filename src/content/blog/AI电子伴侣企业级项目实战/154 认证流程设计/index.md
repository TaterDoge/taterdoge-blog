---
title: "154 认证流程设计"
pubDate: 2026-05-29
description: "前面的文章已经把 token、session、refresh token rotation 这些基础打完了。这一篇直接往下思考，接口应该怎么设计。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/19-auth-flow/](https://aicompanion.usehook.cn/19-auth-flow/)

## 1. 概述

前面的文章已经把 token、session、refresh token rotation 这些基础打完了。这一篇直接往下思考，接口应该怎么设计。

- admin 和 web 要不要共用一个登录入口

- refresh 请求到底收什么

- logout 到底该清什么

- OAuth 登录和 OAuth 绑定能不能走一条路

- 会话管理该盯着 token，还是盯着 session

- 代码里哪些逻辑该放 route，哪些该放 service

## 2. 先把接口名单摆出来

当前这套需求，接口先抽象成下面这种情况：

### admin

- `POST /auth/admin/password/login`

- `POST /auth/admin/token/refresh`

- `POST /auth/admin/logout`

### web

- `POST /auth/web/password/login`

- `GET /auth/web/github/start`

- `GET /auth/web/github/callback`

- `POST /auth/web/token/refresh`

- `POST /auth/web/logout`

### account

- `GET /account/sessions`

- `POST /account/sessions/:sessionId/revoke`

- `POST /account/sessions/revoke-others`

- `GET /account/oauth/github/start`

- `GET /account/oauth/github/callback`

- `GET /account/oauth-identities`

- `POST /account/oauth-identities/:id/unlink`

`/auth/admin/*` 和 `/auth/web/*` 只管登录链路，`/account/*` 只管登录后的账号管理。前端看到路径就知道这条接口属于哪一层，后面查日志也很省事。

## 3. admin 和 web 的登录入口别揉在一起

很多人写到这里，会想偷懒做一个总入口：

index.json

```json
{
  "app": "web",
  "provider": "password",
  "email": "demo@example.com",
  "password": "123456"
}
```

这样当然能跑，但后面会越来越别扭。

因为 admin 和 web 从一开始就不是一条路。

admin 只认邮箱密码，登录成功后还得看后台角色。web 这边除了邮箱密码，后面还要接 GitHub、Google。两边的回调地址、cookie path、错误处理都可能不同。

所以接口直接分开，后面的代码会轻很多。外层路径分开，内部 service 复用，这样最顺手。

### 3.1 admin 密码登录

入口直接定成：

- `POST /auth/admin/password/login`

请求体保持很小：

index.json

```json
{
  "email": "admin@example.com",
  "password": "123456",
  "deviceName": "MacBook Pro"
}
```

响应体也别塞太多东西，够前端处理就行：

index.json

```json
{
  "accessToken": "at_xxxxx",
  "accessTokenExpiresAt": 1710000900000,
  "user": {
    "id": "user_1",
    "displayName": "keepzml"
  },
  "session": {
    "id": "session_1",
    "application": "admin"
  }
}
```

同时，服务端在响应头写 refresh token cookie。

也就是两件事一起发生：

- body 里给前端 `accessToken`

- header 里种下 refresh token cookie

这条接口后面真正做的事，大概就是：校验参数、检查 admin 是否允许 password 登录、查用户、验密码、看状态、看角色、建 session、签 access token、落 refresh token、写 cookie。

这里最容易漏掉的一步，是角色判断。

密码对了，只能说明这个人知道密码。能不能进 admin，还得继续看角色。

### 3.2 web 密码登录

web 这边单独走：

- `POST /auth/web/password/login`

这条接口内部也会查邮箱、验密码、建 session、签 token。动作差不多，外层语境不一样。web 没有 admin 那层后台角色校验，后面还要并列接 GitHub / Google。

接口既然已经拆开，后面继续扩 OAuth 登录会顺很多。

## 4. refresh 这条接口要写得很克制

refresh 是整套认证里最敏感的一条接口。

这里别搞花活，直接拆成：

- `POST /auth/admin/token/refresh`

- `POST /auth/web/token/refresh`

### 4.1 refresh 请求不要让前端手动传 token

前端只管这样发：

apps/web/src/auth/refresh-access-token.ts

```typescript
export const refreshAccessToken = async () => {
  const response = await fetch('/auth/web/token/refresh', {
    method: 'POST',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error('refresh failed')
  }

  return response.json()
}
```

这里没有手动传 refresh token。

原因很简单，refresh token 在 `httpOnly cookie` 里，浏览器会自己带上。前端代码不需要碰它。

### 4.2 refresh 成功后回什么

回一个新的 access token 就够了：

index.json

```json
{
  "accessToken": "at_new_xxxxx",
  "accessTokenExpiresAt": 1710001900000
}
```

同时刷新响应头里的 refresh token cookie。

这条接口的职责很窄：

- 校验 refresh token

- 做 rotation

- 签新的 access token

别顺手再把用户资料、角色列表、菜单权限一股脑塞回来，不然接口会越来越臃肿

### 4.3 refresh 在服务端里该怎么实现

这条链路一定要按事务去思考。

大致顺序就是：从 cookie 拿 token，查 refresh token 记录，查所属 session，看 session 还活着没有，再看 refresh token 有没有过期、有没有被用过、有没有被撤销。确认没问题，再把旧 token 标记成已使用，补一条新的 refresh token，回填 `replaced_by_token_id`，更新 session 的 `last_seen_at_ms`，最后签新的 access token，写新的 cookie。

这一步写得如果不够谨慎，后面很容易撞上并发刷新、重复消费、状态打架等问题。

### 4.4 refresh 失败时，错误码要分清

前端页面看到的，大概率都是“登录已失效，请重新登录”。但后端内部不能糊成一团。

至少把这几种情况分开：

| 状态码 | error code | 含义 |
| --- | --- | --- |
| 401 | AUTH_REFRESH_MISSING | 没带 refresh token |
| 401 | AUTH_REFRESH_EXPIRED | refresh token 过期 |
| 401 | AUTH_SESSION_REVOKED | session 已撤销 |
| 401 | AUTH_REFRESH_REUSED | 检测到旧 token 被重复使用 |
| 403 | AUTH_APP_MISMATCH | token 不属于当前子站 |

后面真出线上问题，能不能快速定位，基本就看这里有没有提前分干净。

## 5. cookie 别散落在各个路由里

refresh token cookie 很适合单独收口。

apps/api/src/modules/auth/cookie.service.ts

```typescript
interface SetRefreshTokenCookieOptions {
  value: string
  maxAge: number
  path: '/auth/web/token/refresh' | '/auth/admin/token/refresh'
}

export const setRefreshTokenCookie = (
  headers: Headers,
  options: SetRefreshTokenCookieOptions,
) => {
  headers.append(
    'Set-Cookie',
    `refresh_token=${options.value}; HttpOnly; Secure; SameSite=Lax; Path=${options.path}; Max-Age=${options.maxAge}`,
  )
}
```

这样后面要改 `SameSite`、`Max-Age`、`Path`，改一处就行。

当前这种双子站结构，refresh cookie 的 path 也可以顺手收窄：

- web：`/auth/web/token/refresh`

- admin：`/auth/admin/token/refresh`

## 6. logout 和 session 管理，盯着 session 就行

很多人一说退出登录，脑子里先想到删 token。这个视角太小了。

真正该管理的是 session。

### 6.1 当前设备退出登录

- `POST /auth/web/logout`

- `POST /auth/admin/logout`

这条接口最好做成幂等。session 本来就失效了，再调一次也没关系；cookie 已经清了，再清一次也没关系。

服务端动作也很直接：找到当前 session，写 `revoked_at_ms`，把这条 session 下面还活着的 refresh token 一起撤掉，然后清 cookie。

### 6.2 会话列表

- `GET /account/sessions`

这条接口很值。用户能看到自己在哪些设备登录过，也能顺手踢掉可疑设备。

返回体长这样就够用了：

index.json

```json
[
  {
    "id": "session_1",
    "application": "web",
    "deviceName": "MacBook Pro",
    "ip": "1.1.1.1",
    "createdAt": 1710000000000,
    "lastSeenAt": 1710000500000,
    "isCurrent": true
  }
]
```

### 6.3 撤销某个 session

- `POST /account/sessions/:sessionId/revoke`

这里围绕 `sessionId` 做就行，别把接口设计成围绕 `refreshTokenId`。

用户能理解的是“这台设备的登录态”，理解不了某一行 refresh token 记录。

### 6.4 撤销其他所有会话

- `POST /account/sessions/revoke-others`

改密码、发现异地登录、做账号安全加固时，这条接口会很常用。

## 7. OAuth 登录和 OAuth 绑定要分家

这两个流程看起来都要跳 GitHub 授权页，很容易被揉成一团。

真写代码时，还是得分开。

### 7.1 OAuth 登录

- `GET /auth/web/github/start`

- `GET /auth/web/github/callback`

这个流程面向的是“还没进系统的人”。目标很明确：拿到第三方身份后，创建或恢复一条 session。

### 7.2 OAuth 绑定

- `GET /account/oauth/github/start`

- `GET /account/oauth/github/callback`

- `POST /account/oauth-identities/:id/unlink`

这个流程面向的是“已经登录的人”。目标是给当前账号补一种登录方式。

路径一拆开，日志、审计、回调处理都会清楚很多。

### 7.3 state 里该放什么

OAuth callback 最怕上下文掉了。

`state` 至少带上这些：

- 当前意图：`login` 或 `bind`

- 当前子站：`web`

- 回跳地址：`returnTo`

- 防 CSRF 随机值

- 绑定场景下的当前用户 id

比如：

index.json

```json
{
  "intent": "bind",
  "app": "web",
  "returnTo": "/settings/connections",
  "nonce": "random_xxx",
  "currentUserId": "user_1"
}
```

### 7.4 callback 回来后怎么分支

登录场景下，先看 `(provider, provider_subject)` 在不在。

在，就找到对应用户，建 session，签 token。

不在，但 provider 给了已验证邮箱，这里别直接看见同邮箱就合并账号。邮箱是否真的可信、当前产品要不要自动合并、要不要二次确认，这些都要先定规则。

完全没匹配上，再去创建新用户、补邮箱记录、插入 `oauth_identities`，最后建 session。

绑定场景简单很多。先确认当前请求已经登录，再检查这条第三方身份有没有被别的用户占用，没有的话就插入 `oauth_identities`，必要时补邮箱记录。

### 7.5 解绑时别把最后一条登录方式也拆掉

- `POST /account/oauth-identities/:id/unlink`

这条接口除了检查 identity 属不属于当前用户，还得再看一眼：解绑之后，这个账号还剩不剩可用登录方式。

如果一个用户没设密码，只绑了 GitHub，这时候把 GitHub 解绑掉，账号就直接失去入口了。

## 8. 代码里怎么收口，后面才不乱

认证逻辑最好别堆在一个文件里。文件一多，边界不清楚，后面改一处就会带崩别处。

目录可以先按这层来分：

apps/api/src/index.txt

```txt
routes/
  auth/
    admin.route.ts
    web.route.ts
    oauth.route.ts
  account/
    sessions.route.ts
    oauth-identities.route.ts
modules/
  auth/
    auth.service.ts
    session.service.ts
    oauth.service.ts
    token.service.ts
    cookie.service.ts
    auth.contracts.ts
repositories/
  auth-session.repository.ts
  refresh-token.repository.ts
  oauth-identity.repository.ts
  user.repository.ts
middleware/
  require-auth.ts
  require-role.ts
```

这套分法里，每层职责都很单纯：

- `route` 收参数、回响应

- `service` 串流程

- `repository` 查库写库

- `middleware` 恢复身份、检查角色

- `contracts` 管请求体、响应体、错误码

### 8.1 鉴权和权限分成两层

`requireAuth` 只做身份恢复：读 `Authorization`、验签、检查 `exp`、解析 `sub`、`sid`、`roles`，然后挂到上下文。

apps/api/src/middleware/require-auth.ts

```typescript
export interface AuthContext {
  userId: string
  sessionId: string
  application: 'web' | 'admin'
  roles: string[]
}
```

`requireRole` 再继续看权限。比如 admin 的审核接口，可以挂 `requireAuth` 再挂 `requireRole('admin_operator')`。

这样分开之后，业务 handler 会清爽很多。

### 8.2 请求体、响应体、错误码单独管

认证接口一多，最怕字段名各写各的。

apps/api/src/modules/auth/auth.contracts.ts

```typescript
import { z } from 'zod'

export const passwordLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  deviceName: z.string().trim().min(1).max(100).optional(),
})

export const accessTokenResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.number().int(),
})
```

错误码也收成一组固定常量，像这样：

- `AUTH_INVALID_CREDENTIALS`

- `AUTH_METHOD_DISABLED`

- `AUTH_USER_SUSPENDED`

- `AUTH_FORBIDDEN_APP`

- `AUTH_REFRESH_EXPIRED`

- `AUTH_REFRESH_REUSED`

- `AUTH_SESSION_REVOKED`

- `AUTH_OAUTH_IDENTITY_OCCUPIED`

前端真正该依赖的，是状态码和错误码。中文提示文案留在展示层处理。

## 9. 前端这边也要守几条规矩

后端接口分干净了，前端调用方式也要统一。

- 业务接口统一带 `Authorization: Bearer <access_token>`

- refresh 接口统一 `credentials: 'include'`

- 收到 `401` 后，只在可续期场景下触发一次 refresh

- refresh 成功后重试原请求

- refresh 失败后清空本地 access token，再回登录页

这些约定定死，前后端配合会省掉很多扯皮。

## 10. 实现顺序别贪多

落地时按这个顺序推进，是比较稳妥的：

- admin 密码登录

- web 密码登录

- refresh

- logout

- session 列表和 revoke

- GitHub 登录

- GitHub 绑定 / 解绑

- 后续再补 Google

这样推进，主干会很清楚。前面先把 session 和 token 链路跑通，后面再补 OAuth 分支，排查问题也更容易。
