---
title: "169 web 子站无感刷新"
pubDate: 2026-06-03
description: "Web 子站无感刷新是一套前后端协作机制，前端负责保存会话、请求时自动带 access token、识别认证失败、调用 refresh、保存新 token 并重试原请求，后端负责校验 refresh token、维护 rotation、识别重放风险、重新签发 token，并保证 web/admin 应用边界不混在一起。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-06-08
---
原文链接：[https://aicompanion.usehook.cn/34-token-silent-refresh/](https://aicompanion.usehook.cn/34-token-silent-refresh/)

## 1. 为什么需要无感刷新

前面我们已经学习过一次无感刷新，当时介绍的是 `admin` 子站里的做法：在 middleware 里提前试探 `access token`，必要时用 `refresh token` 续签，再把新的登录态写回 cookie。

这一篇要介绍的是 `web` 子站里的无感刷新。它的重点不再是 middleware 和 cookie，而是浏览器本地 session、统一 HTTP 请求模块、`Authorization` 请求头、refresh 接口，以及刷新成功以后自动重试刚才失败的业务请求。

Web 登录一般会同时拿到两个 token：`accessToken` 和 `refreshToken`。

`accessToken` 用来访问接口，有效期会短一些。`refreshToken` 用来续签，有效期会长一些。这样做是为了让安全和体验都能顾上。

如果 `accessToken` 有效期太长，泄露后的风险会持续很久。如果它很快过期，又没有续签机制，用户就会频繁回到登录页，体验会很差。

**无感刷新**要做的事很明确：用户发起正常请求时，如果当前 `accessToken` 过期了，前端自动用 `refreshToken` 换一组新 token，然后把刚才失败的请求重新发一遍。

用户看到的是页面继续可用，操作没有被打断。开发侧要处理的是：登录后保存会话，请求时带上 token，过期时续签，续签成功后重试，续签失败后退出登录。

## 2. 整体流程

我们可以先把这条链路梳理清楚。

用户登录成功后，浏览器保存 `accessToken`、`refreshToken` 和 session。之后需要登录态的接口，都从统一的 HTTP 模块发出。

HTTP 模块会在请求前读取本地会话，把 `accessToken` 放进 `Authorization` 请求头。接口正常返回时，业务代码直接拿数据，不需要知道 token 是怎么处理的。

当接口返回 `AUTH.UNAUTHORIZED`，前端就认为当前 `accessToken` 可能已经不可用，于是调用 `/auth/web/token/refresh`。刷新成功后，新 token 覆盖旧 token，刚才失败的请求再重新发送一次。

这套逻辑要收在 HTTP 模块里，不要散落到每个页面。页面只负责请求业务数据，刷新和重试由统一入口处理。

对应到代码文件，大致是这样的关系：

index.txt

```txt
apps/web/src/auth/login-client.ts
  登录成功后保存会话

apps/web/src/auth/client-session.ts
  管理浏览器侧 session

apps/web/src/lib/http.ts
  自动带 token、识别过期、刷新、重试

apps/web/src/components/web-dashboard-guard.tsx
  进入受保护页面时校验登录态

apps/api/src/auth/services/web-token-refresh.ts
  后端处理 refresh token 续签

apps/api/src/auth/jwt.ts
  负责 JWT 签发和校验
```

这个结构的好处是边界清楚。登录页只负责登录，页面保护只负责守页面，HTTP 模块处理请求过程，后端 refresh 服务处理续签安全。

## 3. 保存会话

登录成功以后，接口返回的是一份完整登录结果，里面包含 `accessToken`、`refreshToken` 和 session。

登录表单拿到结果后，直接交给客户端会话模块保存。它不直接操作 localStorage，也不自己拼接 token。

login-client.ts

```typescript
import type { WebPasswordLoginResponse } from '@repo/contracts'
import { saveClientSession } from '@/auth/client-session'
import { http } from '@/lib/http'

export type WebLoginInput = {
  email: string
  password: string
}

export async function loginByApi(input: WebLoginInput) {
  const response = await http.post<WebPasswordLoginResponse, WebLoginInput>(
    '/auth/web/password/login',
    input,
  )

  saveClientSession(response)
}
```

会话模块通常会同时用内存变量和 localStorage。内存变量让当前页面读取更快，localStorage 让用户刷新页面后还能恢复登录态。

client-session.ts

```typescript
const storageKey = 'web:client-session'
const sessionChangedEventName = 'web-client-session-changed'

type StoredWebSession = {
  accessToken: string
  refreshToken: string
  session: WebAuthSession
}

let currentSession: StoredWebSession | null = null
```

读取会话时，先看内存里有没有。没有的话，再从 localStorage 里恢复。

client-session.ts

```typescript
export function readClientSession(): StoredWebSession | null {
  if (currentSession) {
    return currentSession
  }

  if (!canUseStorage()) {
    return null
  }

  const rawValue = window.localStorage.getItem(storageKey)

  if (!rawValue) {
    return null
  }

  try {
    currentSession = JSON.parse(rawValue) as StoredWebSession
    return currentSession
  } catch {
    window.localStorage.removeItem(storageKey)
    return null
  }
}
```

保存会话时，内存和 localStorage 都要更新，并且要发出会话变化事件。

client-session.ts

```typescript
export function saveClientSession(input: Pick<WebPasswordLoginResponse, 'accessToken' | 'refreshToken' | 'session'>) {
  currentSession = {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    session: input.session,
  }

  if (canUseStorage()) {
    window.localStorage.setItem(storageKey, JSON.stringify(currentSession))
  }

  notifySessionChanged()
}
```

这个事件很有用。登录、刷新、登出都会改变 session。其他组件如果需要感知这件事，比如页面保护组件重新加载 profile，就可以监听它。

刷新成功后，也要保存完整的新会话，不能只替换 `accessToken`。

client-session.ts

```typescript
export function saveClientRefreshSession(input: Pick<WebTokenRefreshResponse, 'accessToken' | 'refreshToken' | 'session'>) {
  saveClientSession(input)
}
```

原因是后端一般会做 refresh token rotation。每次刷新成功后，`refreshToken` 也会换成新的。前端如果还保留旧 refresh token，下次续签就会失败。

## 4. 请求带 token

业务页面不需要每次都手动读取 token。登录态请求统一走 HTTP 模块，让它自动补 `Authorization`。

对外暴露的 `get` 和 `post` 可以保持简单：

http.ts

```typescript
export const http = {
  get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return request<T>(createRequestConfig(url, {
      ...config,
      method: 'GET',
    }))
  },
  post<TResponse, TRequest = unknown>(url: string, data?: TRequest, config?: AxiosRequestConfig): Promise<TResponse> {
    return request<TResponse>(createRequestConfig(url, {
      ...config,
      method: 'POST',
      data,
    }))
  },
}
```

真正补 token 的地方在 `createRequestConfig`。

http.ts

```typescript
function createRequestConfig(url: string, config: AxiosRequestConfig = {}): AxiosRequestConfig {
  const isFormData = typeof FormData !== 'undefined' && config.data instanceof FormData
  const headers: RawAxiosRequestHeaders = {
    ...(isFormData ? {} : { 'content-type': 'application/json' }),
    ...(config.headers as RawAxiosRequestHeaders | undefined),
  }

  if (typeof window !== 'undefined' && shouldAttachAccessToken(config.headers)) {
    const storedSession = readClientSession()

    if (storedSession) {
      headers.authorization = `Bearer ${storedSession.accessToken}`
    }
  }

  return {
    ...config,
    baseURL: config.baseURL ?? resolveBaseURL(),
    headers,
    validateStatus: () => true,
    url,
  }
}
```

这里只在浏览器环境读取 session，因为 localStorage 只存在于浏览器。

如果调用方已经传了 `authorization`，HTTP 模块不要覆盖它。这样可以给特殊请求留下空间。

http.ts

```typescript
function shouldAttachAccessToken(headers: AxiosRequestConfig['headers']) {
  if (!headers || typeof headers !== 'object') {
    return true
  }

  const normalizedHeaders = headers as Record<string, unknown>
  return !('authorization' in normalizedHeaders || 'Authorization' in normalizedHeaders)
}
```

做到这一步，业务代码正常调用 `http.get` 或 `http.post` 就行，不用关心 token 从哪里来。

## 5. 识别过期

无感刷新不是一进页面就刷新 token。我们先用当前 `accessToken` 请求接口，只有后端返回 `AUTH.UNAUTHORIZED`，才尝试续签。

http.ts

```typescript
const unauthorizedBizCodes: Set<BizCodeValue> = new Set([
  'AUTH.UNAUTHORIZED',
])
```

判断是否尝试刷新，集中在 `shouldTryRefresh`。

http.ts

```typescript
function shouldTryRefresh(config: AxiosRequestConfig, payload: ApiResponse<unknown>) {
  if (typeof window === 'undefined') {
    return false
  }

  if (config.url?.includes('/auth/web/token/refresh')) {
    return false
  }

  return !payload.ok && unauthorizedBizCodes.has(payload.error.code)
}
```

refresh 接口自己不能再触发 refresh。`/auth/web/token/refresh` 都失败了，说明 refresh token 或 session 已经不可用了，继续递归刷新只会制造死循环。

普通业务错误也不应该触发刷新。参数校验失败、业务冲突、权限不足，都不是 access token 过期。

所有接口返回都会经过 `unwrapApiResponse`。成功时返回 `data`，失败时抛出错误，并把是否需要刷新写到错误对象上。

http.ts

```typescript
function unwrapApiResponse<T>(config: AxiosRequestConfig, payload: ApiResponse<T>): T {
  if (payload.ok) {
    return payload.data
  }

  const error = new Error(payload.error.message) as Error & {
    status?: number
    code?: BizCodeValue
    shouldRefresh?: boolean
  }

  error.code = payload.error.code
  error.shouldRefresh = shouldTryRefresh(config, payload)

  throw error
}
```

这样后面的 `request` 函数不用反复分析错误码，只看 `error.shouldRefresh` 就能知道是否进入续签流程。

## 6. 刷新与重试

需要续签时，前端从本地会话里取出 `refreshToken`，请求 `/auth/web/token/refresh`。刷新成功后，把新的 `accessToken`、`refreshToken` 和 session 一起保存。

http.ts

```typescript
async function refreshClientSession() {
  const storedSession = readClientSession()

  if (!storedSession) {
    throw new Error('Session refresh failed')
  }

  const response = await axios.request<ApiResponse<WebTokenRefreshResponse>>({
    baseURL: resolveBaseURL(),
    url: '/auth/web/token/refresh',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    data: {
      refreshToken: storedSession.refreshToken,
    },
    validateStatus: () => true,
  })

  const data = unwrapApiResponse<WebTokenRefreshResponse>({
    url: '/auth/web/token/refresh',
    method: 'POST',
  }, response.data)

  saveClientRefreshSession(data)
}
```

这里没有复用当前请求的 `Authorization`。refresh 接口真正需要的是请求体里的 `refreshToken`。

页面上常常会同时发出多个请求。如果 access token 刚好过期，这些请求可能一起收到 `AUTH.UNAUTHORIZED`。

这里不能让每个请求都刷新一次。refresh token rotation 通常要求旧 refresh token 只能使用一次。第一个刷新请求成功后，旧 token 就会被标记为已使用。后面的请求如果继续拿旧 token 刷新，后端可能会把它当成重放风险。

所以前端需要一个并发锁。

http.ts

```typescript
let refreshPromise: Promise<void> | null = null

async function ensureClientRefresh() {
  if (!refreshPromise) {
    refreshPromise = refreshClientSession().finally(() => {
      refreshPromise = null
    })
  }

  return refreshPromise
}
```

第一个发现 token 过期的请求创建 `refreshPromise`，后续请求等待同一个 promise。这样同时有很多请求时，真正发到后端的 refresh 请求也只有一个。

刷新成功后，还要重试原请求。这一步做完，用户才真正感觉不到 token 过期。

http.ts

```typescript
async function request<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    const response = await axios.request<ApiResponse<T>>(config)
    return unwrapApiResponse(config, response.data)
  } catch (error) {
    const appError = error as Error & { shouldRefresh?: boolean }

    if (appError.shouldRefresh) {
      try {
        await ensureClientRefresh()
        const { authorization: _authorization, Authorization: _Authorization, ...retryHeaders } = (config.headers ?? {}) as RawAxiosRequestHeaders
        const retryConfig = createRequestConfig(config.url ?? '', {
          ...config,
          headers: retryHeaders,
        })
        const retryResponse = await axios.request<ApiResponse<T>>(retryConfig)
        return unwrapApiResponse(retryConfig, retryResponse.data)
      } catch {
        clearClientSession()
        throw new Error('Session refresh failed')
      }
    }

    if (error instanceof AxiosError) {
      throw new Error(error.message || 'Request failed')
    }

    throw error
  }
}
```

重试前要移除旧的 `Authorization`，再重新创建请求配置。否则重试请求可能仍然带着过期的 access token。

http.ts

```typescript
const { authorization: _authorization, Authorization: _Authorization, ...retryHeaders } = (config.headers ?? {}) as RawAxiosRequestHeaders
```

如果刷新失败，前端清空本地会话，回到登录流程。无效 token 留在本地，只会让页面反复失败。

## 7. 后端配合

前端能做到无感刷新，后端也要配合把 refresh 过程管住。

后端会先校验 refresh token 的 JWT，并确认它属于 web 应用。

web-token-refresh.ts

```typescript
claims = await verifyRefreshToken({
  token: payload.refreshToken,
  secret: env.JWT_REFRESH_SECRET,
  expectedApp: 'web',
})
```

JWT 校验通过后，还要查数据库，确认这枚 refresh token 是否存在，以及它是不是属于当前 session。

web-token-refresh.ts

```typescript
const currentToken = await findRefreshTokenForSession({
  db: db,
  jtiHash,
  sessionId: claims.sid,
})

if (!currentToken || currentToken.applicationCode !== 'web') {
  throw refreshTokenInvalidError()
}
```

session 已经撤销，刷新失败。

web-token-refresh.ts

```typescript
if (currentToken.sessionRevokedAtMs !== null) {
  throw sessionRevokedError()
}
```

refresh token 自己已经撤销或者过期，也要失败。

web-token-refresh.ts

```typescript
if (currentToken.revokedAtMs !== null || currentToken.expiresAtMs <= nowMs) {
  throw refreshTokenInvalidError()
}
```

旧 refresh token 已经使用过，又被拿来刷新，后端应该把它当作重放风险，并撤销整条 session。

web-token-refresh.ts

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

接着，后端会把当前 refresh token 标记为已使用。

web-token-refresh.ts

```typescript
const markedUsed = await markRefreshTokenUsed({
  db: db,
  tokenId: currentToken.tokenId,
  usedAtMs: nowMs,
})
```

然后重新查询用户的 web 角色。这样权限变化可以在下一次刷新时生效。如果用户已经没有 `web_user` 角色，就不能继续续签。

web-token-refresh.ts

```typescript
const roles = await getWebRolesForUser(db, claims.sub)

if (!roles.includes('web_user')) {
  await revokeSession({
    db: db,
    sessionId: currentToken.sessionId,
    revokedAtMs: nowMs,
    reason: 'web_role_missing',
  })

  throw adminRoleRequiredError()
}
```

最后，后端创建新的 session 视图并签发新的 token。

web-token-refresh.ts

```typescript
const session = {
  sessionId: currentToken.sessionId,
  userId: claims.sub,
  app: 'web' as const,
  roles,
  expiresAtMs: refreshExpiresAtMs,
}

const tokenPair = await issueTokenPair({
  session,
  accessSecret: env.JWT_ACCESS_SECRET,
  refreshSecret: env.JWT_REFRESH_SECRET,
  accessTtlSec: env.ACCESS_TOKEN_TTL_SEC,
  refreshTtlSec: env.REFRESH_TOKEN_TTL_SEC,
})
```

新的 refresh token 要写入数据库，并且和旧 token 串起来。

web-token-refresh.ts

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

await updateRefreshRotation({
  db: db,
  oldTokenId: currentToken.tokenId,
  newTokenId: tokenPair.refreshJti,
  sessionId: currentToken.sessionId,
  lastSeenAtMs: nowMs,
})
```

这就是 refresh token rotation。旧 token 被标记为用过，新 token 被写入，旧 token 指向新 token。这样后端既能追踪续签链路，也能识别旧 token 被重复使用的风险。

## 8. 应用隔离、页面保护与验证

web 和 admin 可以共用 JWT 签发能力，但 token 里必须带上 `app` 字段。这个字段用来防止 web token 和 admin token 混用。

access token 中会写入 `sid`、`app`、`roles`。

jwt.ts

```typescript
return new SignJWT({
  sid: params.claims.sid,
  app: params.claims.app,
  roles: params.claims.roles,
})
```

refresh token 中也会写入 `sid`、`app`、`jti`。

jwt.ts

```typescript
const token = await new SignJWT({
  sid: params.claims.sid,
  app: params.claims.app,
  jti,
})
```

校验时检查 `expectedApp`。

jwt.ts

```typescript
export async function verifyRefreshToken(params: {
  token: string
  secret: string
  expectedApp?: ExpectedApp
}): Promise<RefreshTokenClaims> {
  const expectedApp = params.expectedApp ?? 'admin'

  if (!isExpectedApp(app, expectedApp)) {
    throw new Error('Invalid refresh token claims')
  }
}
```

默认值是 `admin`，这样系统新增 web 登录后，也不会意外放宽 admin 接口。web refresh 明确传 `expectedApp: 'web'`，共享接口则可以传 `['admin', 'web']`。

无感刷新也会影响路由保护。进入受保护页面时，`web-dashboard-guard.tsx` 会先读取本地 session，然后请求 profile。

web-dashboard-guard.tsx

```tsx
async function loadProfile() {
  const storedSession = readClientSession()

  if (!storedSession) {
    setIsLoading(false)
    router.replace('/login')
    return
  }

  try {
    const nextProfile = await getWebUserProfile()
    const latestSession = readClientSession()

    if (!latestSession) {
      setIsLoading(false)
      router.replace('/login')
      return
    }

    setContext({ profile: nextProfile, session: latestSession.session, refreshProfile: loadProfile })
  } catch {
    clearClientSession()
    router.replace('/login')
  } finally {
    setIsLoading(false)
  }
}
```

`getWebUserProfile()` 同样走统一 HTTP 模块。所以用户刷新页面时，如果 access token 已经过期，profile 请求会先失败，然后 HTTP 模块自动 refresh，再重试 profile。guard 最后仍然能拿到 profile，页面就不会跳回登录页。

只有 refresh token 也失效、session 被撤销，或者用户失去了 `web_user` 角色时，guard 才会清空会话并回到 `/login`。

无感刷新不是永远不重新登录。它的边界是 refresh token 和服务端 session 仍然有效。

如果 refresh 失败，前端应该清空本地 session。

http.ts

```typescript
clearClientSession()
throw new Error('Session refresh failed')
```

常见失败原因包括 refresh token 过期、refresh token 已撤销、session 已撤销、旧 refresh token 被重复使用、用户不再拥有 `web_user` 角色。

验证时可以先做类型检查，确认前后端没有破坏编译。

index.bash

```shellscript
pnpm --filter web check-types
pnpm --filter @repo/api check-types
```

然后用 API 验证登录和刷新。

index.bash

```shellscript
curl -X POST http://127.0.0.1:8787/auth/web/password/login \
  -H 'content-type: application/json' \
  -d '{"email":"user01@example.com","password":"Admin123456!"}'
```

拿到 refresh token 后，请求刷新接口。

index.bash

```shellscript
curl -X POST http://127.0.0.1:8787/auth/web/token/refresh \
  -H 'content-type: application/json' \
  -d '{"refreshToken":"<refreshToken>"}'
```

最后用 access token 访问 profile。

index.bash

```shellscript
curl http://127.0.0.1:8787/rpc/user/profile \
  -H 'authorization: Bearer <accessToken>'
```

浏览器里可以登录后查看 localStorage 中是否存在 `web:client-session`。为了更快验证无感刷新，可以临时缩短 access token 的 TTL，等它过期后触发一次需要登录态的请求。Network 面板中应该能看到 `/auth/web/token/refresh`，并且原业务请求会在刷新成功后继续完成，页面不会跳回登录页。

## 总结

无感刷新是一套前后端协作机制，不只是一个 refresh 接口。

前端负责保存会话、请求时自动带上 access token、识别认证失败、调用 refresh、保存新 token，并重试原请求。后端负责校验 refresh token、维护 rotation、识别重放风险、重新签发 token，并保证 web/admin 应用边界不混在一起。

这样既能让 `accessToken` 保持较短有效期，降低泄露风险，也能用 `refreshToken` 完成续签，减少用户反复登录。
