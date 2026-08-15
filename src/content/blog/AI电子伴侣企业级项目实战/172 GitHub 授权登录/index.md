---
title: "172、 GitHub 授权登录"
pubDate: 2026-06-06
description: "通过 GitHub OAuth 完成授权登录、state 校验、code 换 token、ticket 换系统登录态，并在 web 端保存会话。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/37-github-oauth-login/](https://aicompanion.usehook.cn/37-github-oauth-login/)

这篇文章会用一个真实项目里的实现，带你把 Web 端接入 GitHub 授权登录的过程完整梳理一遍。

我们要完成的效果是：用户在登录页点击 **使用 GitHub 登录** 后，浏览器跳转到 GitHub 授权页；GitHub 授权成功后回调 API 子站；API 子站用 `code` 换 GitHub access token，再读取 GitHub 用户资料和邮箱，接着创建或绑定本系统用户，并生成一个短时一次性 `ticket`；Web 子站拿到 `ticket` 后，再换成本系统自己的登录态，最后把 `accessToken`、`refreshToken` 和 `session` 保存下来。

重点是：GitHub access token 不会交给浏览器长期保存，本系统 token 也不会直接塞进 URL。

## 1. 授权登录原理

在写代码之前，我们先把 GitHub 授权登录这件事本身讲清楚。

GitHub 登录不是让 GitHub 直接替我们的系统发登录态，而是让 GitHub 证明：当前浏览器里的这个用户，确实控制着某个 GitHub 账号。GitHub 能证明的是外部身份，本系统真正要保存和校验的，仍然是自己的 `user`、`session`、`accessToken` 和 `refreshToken`。

所以整个流程里会有两次身份交换。第一次发生在 API 和 GitHub 之间：GitHub callback 带回 `code`，API 拿着 `code`、`client_id`、`client_secret` 去 GitHub 换 access token，再用这个 access token 读取 GitHub 用户资料。第二次发生在 Web 和 API 之间：API 确认 GitHub 身份以后，不直接把系统 token 塞进 URL，而是生成一个短时一次性 `ticket`，让 Web 再用这个 ticket 换成本系统登录态。

这里有几个角色要分清楚。

`client_secret` 只能放在 API，因为它是 GitHub OAuth App 的敏感凭证。浏览器代码会被下载和调试，一旦把 `client_secret` 放到 Web 里，就等于把它公开了。`code` 是 GitHub callback 给 API 的临时凭证，它只能用一次，而且必须配合 `client_secret` 才能换 access token。`state` 用来防止登录 CSRF，发起登录和回调回来必须是同一个 state。`ticket` 则是我们系统自己生成的临时登录凭证，它的职责是把 API callback 处理结果安全地交给 Web。

为什么中间要多一个 ticket？因为 URL 不适合承载长期 token。URL 会进入浏览器历史记录，也可能被日志系统记录，还可能通过 Referer 泄漏。如果 callback 后直接把 `accessToken` 和 `refreshToken` 拼到 Web URL 里，风险会明显放大。短时一次性 ticket 就安全很多：它只活几分钟，用过之后立即失效，即使被复制也很难再次利用。

授权登录最终落到系统内部时，仍然要回到熟悉的登录模型：找到或创建用户，绑定 GitHub 账号，分配角色，创建 session，签发系统自己的 access token 和 refresh token。这样后续业务代码不需要关心用户是邮箱密码登录还是 GitHub 登录，只要按统一的系统 session 做鉴权就可以。

## 2. 不能只靠前端

GitHub OAuth 登录需要用到 `client_secret` 去换 access token。

`client_secret` 是敏感信息，不能放在浏览器里。因为前端代码会被用户下载、查看、调试，一旦把 secret 写到前端，就等于公开了。

所以合理分工是：

index.txt

```txt
Web 前端：负责跳转、接收 ticket、保存本系统登录态
API 后端：负责 GitHub code 换 token、读取用户信息、签发本系统 token
GitHub：负责确认用户身份并返回授权 code
```

## 3. 整体登录流程

当前项目采用的是 **API callback + 一次性 ticket** 的方案。

index.txt

```txt
1. Web 登录页
   GET /auth/web/github/authorize

2. API 返回
   {
     url: "https://github.com/login/oauth/authorize?...",
     state: "..."
   }

3. Web 把 state 存到 sessionStorage，然后跳转 GitHub

4. GitHub 授权成功后回调 API
   GET /auth/web/github/callback?code=xxx&state=xxx

5. API 校验 state，用 code 换 GitHub access token

6. API 请求 GitHub 用户资料和邮箱
   GET https://api.github.com/user
   GET https://api.github.com/user/emails

7. API 创建或绑定本系统用户，并生成短时 ticket

8. API 重定向回 Web
   /login/github/callback?ticket=xxx&state=xxx

9. Web 校验 state，用 ticket 换本系统登录态
   POST /auth/web/github/ticket/login

10. Web 保存本系统 session，跳转首页
```

这里最容易误解的是 callback URL。

GitHub OAuth App 的 callback URL 应该填 API 地址，不是 Web 地址：

callback-url.txt

```txt
http://127.0.0.1:8787/auth/web/github/callback
```

线上也是一样：

callback-url.txt

```txt
https://api.ai-agent.workers.dev/auth/web/github/callback
```

## 4. 环境变量

API 子站需要配置 GitHub OAuth 信息。

本地 `apps/api/.dev.vars`：

apps/api/.dev.vars

```txt
GITHUB_OAUTH_CLIENT_ID=你的 GitHub OAuth Client ID
GITHUB_OAUTH_CLIENT_SECRET=你的 GitHub OAuth Client Secret
GITHUB_OAUTH_CALLBACK_URL=http://127.0.0.1:8787/auth/web/github/callback
```

生产环境建议把 `GITHUB_OAUTH_CLIENT_SECRET` 配成 Cloudflare secret，不要写进仓库文件：

index.bash

```shellscript
cd apps/api
pnpm wrangler secret put GITHUB_OAUTH_CLIENT_SECRET --env production
```

可提交的 production vars 里只放非敏感配置：

wrangler.jsonc

```jsonc
{
  "vars": {
    "APP_ENV": "production",
    "WEB_ORIGIN": "https://ai-agent-web.pages.dev",
    "ADMIN_ORIGIN": "https://ai-agent-admin.pages.dev",
    "GITHUB_OAUTH_CLIENT_ID": "你的 GitHub OAuth Client ID",
    "GITHUB_OAUTH_CALLBACK_URL": "https://api.ai-agent.workers.dev/auth/web/github/callback"
  }
}
```

Web 子站只需要知道 API 地址：

apps/web/.env

```txt
API_BASE_URL=https://api.ai-agent.workers.dev
NEXT_PUBLIC_API_BASE_URL=https://api.ai-agent.workers.dev
```

## 5. 数据库设计

GitHub 登录不是简单地把邮箱密码换成 GitHub。

系统里需要多记录两类信息：一类是 GitHub 账号和本系统用户的绑定关系，另一类是 OAuth callback 后临时生成的一次性登录 ticket。

迁移文件：`apps/api/migrations/0008_web_github_oauth.sql`

0008_web_github_oauth.sql

```sql
INSERT OR IGNORE INTO application_auth_methods (id, application_id, provider, enabled, created_at_ms, updated_at_ms)
SELECT '019e0d00-85c9-7c13-a83c-2e3000000002', applications.id, 'github', 1, 1746816000000, 1746816000000
FROM applications
WHERE applications.code = 'web';

UPDATE application_auth_methods
SET enabled = 1, updated_at_ms = 1746816000000
WHERE provider = 'github'
  AND application_id IN (
    SELECT id
    FROM applications
    WHERE code = 'web'
  );
```

这段是登录方式开关。

如果没有 `web + github + enabled = 1`，API 会直接返回：

error.txt

```txt
GitHub login is disabled
```

绑定表：

0008_web_github_oauth.sql

```sql
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  provider_user_id TEXT NOT NULL,
  provider_login TEXT,
  email_id TEXT REFERENCES user_emails(id) ON DELETE SET NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_accounts_provider_user_unique
ON oauth_accounts(provider, provider_user_id);
```

`provider_user_id` 是 GitHub 返回的用户 ID。它比 GitHub 用户名更适合做绑定，因为用户名可能改，用户 ID 不会变。

一次性 ticket 表：

0008_web_github_oauth.sql

```sql
CREATE TABLE IF NOT EXISTS oauth_login_tickets (
  id TEXT PRIMARY KEY,
  ticket_hash TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  used_at_ms INTEGER
);
```

这里存的是 `ticket_hash`，不是 ticket 原文。即使数据库泄露，也不能直接拿 ticket 去登录。

## 6. 接口合约

合约文件：`packages/contracts/src/auth/web-github-login.contract.ts`

web-github-login.contract.ts

```typescript
import { z } from 'zod'
import { WebPasswordLoginResponseSchema } from './web-password-login.contract'

export const WebGithubAuthUrlResponseSchema = z.object({
  url: z.string().url(),
  state: z.string().min(1),
})

export type WebGithubAuthUrlResponse = z.infer<
  typeof WebGithubAuthUrlResponseSchema
>

export const WebGithubTicketLoginRequestSchema = z.object({
  ticket: z.string().min(1),
})

export type WebGithubTicketLoginRequest = z.infer<
  typeof WebGithubTicketLoginRequestSchema
>

export const WebGithubTicketLoginResponseSchema = WebPasswordLoginResponseSchema
```

这里我们可以看到两个关键点。`authorize` 接口返回的是 `url` 和 `state`；ticket 换登录态时，响应结构直接复用邮箱密码登录的响应。

也就是说，无论用户用邮箱密码登录，还是 GitHub 登录，前端最终拿到的都是同一套本系统登录态：

index.txt

```txt
accessToken
refreshToken
tokenType
expiresInSec
refreshExpiresInSec
session
```

## 7. API 路由

路由文件：`apps/api/src/routes/auth/web.route.ts`

web.route.ts

```typescript
webAuthRoute.get('/github/authorize', async (c) => {
  const res = await buildWebGithubAuthUrl(c)

  return c.json(buildSuccess(res, createApiMeta()))
})

webAuthRoute.get('/github/callback', async (c) => {
  return handleWebGithubCallback(c)
})

webAuthRoute.post(
  '/github/ticket/login',
  zValidator(
    'json',
    WebGithubTicketLoginRequestSchema,
    buildValidationErrorHandler('Invalid GitHub login payload'),
  ),
  async (c) => {
    const payload = c.req.valid('json')
    const res = await handleWebGithubTicketLogin({
      c,
      ticket: payload.ticket,
    })

    return c.json(buildSuccess(res, createApiMeta()))
  },
)
```

我们可以把这三个接口按职责理解成这样：

index.txt

```txt
/github/authorize      生成 GitHub 授权 URL
/github/callback       接 GitHub 回调，处理 code
/github/ticket/login   Web 用 ticket 换本系统 token
```

## 8. 生成授权 URL

核心代码在 `buildWebGithubAuthUrl`。

github-oauth.service.ts

```typescript
export async function buildWebGithubAuthUrl(c: Context<{ Bindings: ApiBindings }>) {
  const db = getDb(c.env.DB)

  if (!(await isGithubLoginEnabledForWeb(db))) {
    throw authMethodDisabledError('GitHub login is disabled')
  }

  const { env, clientId, callbackUrl } = getGithubOAuthConfig(c)
  const state = await createOAuthState(env.JWT_REFRESH_SECRET)
  const url = new URL('https://github.com/login/oauth/authorize')

  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', callbackUrl)
  url.searchParams.set('scope', 'read:user user:email')
  url.searchParams.set('state', state)
  url.searchParams.set('allow_signup', 'true')

  return WebGithubAuthUrlResponseSchema.parse({
    url: url.toString(),
    state,
  })
}
```

这里先检查数据库开关。

如果你本地点击 GitHub 登录时报：

error.txt

```txt
GitHub login is disabled
```

通常就是迁移没执行：

index.bash

```shellscript
cd apps/api
pnpm db:migrate:local
```

`scope` 里使用：

index.txt

```txt
read:user user:email
```

这里之所以要带上 `user:email`，是因为 GitHub 用户不一定公开邮箱。我们需要通过 `/user/emails` 再取一次已验证邮箱，后面才能和系统用户建立稳定关联。

## 9. state 的作用

OAuth 里的 `state` 用来防止登录 CSRF。

简单理解：

index.txt

```txt
发起登录时生成一个随机 state
GitHub 回调时必须带回同一个 state
前后不一致，就拒绝登录
```

当前实现里，API 会生成一个带签名的 state：

github-oauth.service.ts

```typescript
async function createOAuthState(secret: string) {
  const nonce = uuidv7()
  const issuedAtMs = Date.now()
  const payload = `${nonce}.${issuedAtMs}`
  const signature = await signStatePayload(payload, secret)

  return `${payload}.${signature}`
}
```

签名使用 HMAC：

github-oauth.service.ts

```typescript
async function signStatePayload(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))

  return base64UrlEncode(new Uint8Array(signature))
}
```

回调时验证：

github-oauth.service.ts

```typescript
async function verifyOAuthState(state: string, secret: string) {
  const parts = state.split('.')

  if (parts.length !== 3) {
    throw authUnauthorizedError('GitHub state is invalid')
  }

  const nonce = parts[0]
  const issuedAtValue = parts[1]
  const signature = parts[2]
  const issuedAtMs = Number(issuedAtValue)

  if (!nonce || !signature || !Number.isFinite(issuedAtMs) || Date.now() - issuedAtMs > 10 * 60 * 1000) {
    throw authUnauthorizedError('GitHub state is expired')
  }

  const expectedSignature = await signStatePayload(`${nonce}.${issuedAtMs}`, secret)

  if (signature !== expectedSignature) {
    throw authUnauthorizedError('GitHub state is invalid')
  }
}
```

此外，Web 端也会把 state 存进 `sessionStorage`，callback 回来后再比对一次。这一步可以把 **这次浏览器发起的登录** 与 **这次回调** 绑定起来。

## 10. 处理 GitHub callback

GitHub 授权成功后，会请求：

callback-url.txt

```txt
/auth/web/github/callback?code=xxx&state=xxx
```

API 主要做几件事：

github-oauth.service.ts

```typescript
export async function handleWebGithubCallback(c: Context<{ Bindings: ApiBindings }>) {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')
  const errorDescription = c.req.query('error_description')
  const { env, clientId, clientSecret, callbackUrl } = getGithubOAuthConfig(c)
  const callbackResultUrl = new URL('/login/github/callback', env.WEB_ORIGIN)

  if (error) {
    callbackResultUrl.searchParams.set('error', errorDescription ?? error)
    return c.redirect(callbackResultUrl.toString())
  }

  if (!code || !state) {
    callbackResultUrl.searchParams.set('error', 'GitHub callback payload is invalid')
    return c.redirect(callbackResultUrl.toString())
  }

  try {
    await verifyOAuthState(state, env.JWT_REFRESH_SECRET)

    const accessToken = await fetchGithubAccessToken({
      code,
      clientId,
      clientSecret,
      redirectUri: callbackUrl,
    })

    const [githubUser, githubEmails] = await Promise.all([
      fetchGithubJson<GithubUser>(githubUserUrl, accessToken),
      fetchGithubJson<GithubEmail[]>(githubUserEmailsUrl, accessToken),
    ])

    const email = pickVerifiedGithubEmail(githubUser, githubEmails)
    const userId = await resolveGithubWebUser({ c, githubUser, email })
    const ticket = uuidv7()

    await insertOauthLoginTicket({
      db,
      id: uuidv7(),
      ticketHash: await hashTokenJti(ticket),
      userId,
      applicationId,
      provider: 'github',
      createdAtMs: nowMs,
      expiresAtMs: nowMs + oauthTicketTtlMs,
    })

    callbackResultUrl.searchParams.set('ticket', ticket)
    callbackResultUrl.searchParams.set('state', state)
  } catch (oauthError) {
    callbackResultUrl.searchParams.set(
      'error',
      oauthError instanceof Error ? oauthError.message : 'GitHub login failed',
    )
  }

  return c.redirect(callbackResultUrl.toString())
}
```

这段代码故意没有把系统 token 放进 URL。

它只把短时 ticket 放进 URL：

callback-url.txt

```txt
/login/github/callback?ticket=xxx&state=xxx
```

ticket 有两个特点：

index.txt

```txt
有效期很短：2 分钟
只能使用一次：用过后 used_at_ms 会被写入
```

## 11. code 换 access token

GitHub callback 给的是 `code`，不是 access token。

API 需要把 `code` 发给 GitHub：

github-oauth.service.ts

```typescript
async function fetchGithubAccessToken(params: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
}) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
    }),
  })

  const payload = await response.json() as {
    access_token?: string
    error?: string
    error_description?: string
  }

  if (!response.ok || !payload.access_token) {
    throw new AppError(
      BizCode.AUTH_UNAUTHORIZED,
      payload.error_description ?? 'GitHub authorization failed',
      401,
    )
  }

  return payload.access_token
}
```

这里使用 `application/x-www-form-urlencoded`，兼容性更稳。

## 12. 读取用户和邮箱

拿到 GitHub access token 后，请求两个接口：

github-oauth.service.ts

```typescript
const [githubUser, githubEmails] = await Promise.all([
  fetchGithubJson<GithubUser>('https://api.github.com/user', accessToken),
  fetchGithubJson<GithubEmail[]>('https://api.github.com/user/emails', accessToken),
])
```

请求 GitHub API 时带上：

github-oauth.service.ts

```typescript
async function fetchGithubJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${accessToken}`,
      'user-agent': 'ai-agent-web',
      'x-github-api-version': '2022-11-28',
    },
  })

  if (!response.ok) {
    throw new AppError(BizCode.AUTH_UNAUTHORIZED, 'Unable to read GitHub profile', 401)
  }

  return await response.json() as T
}
```

邮箱选择逻辑：

github-oauth.service.ts

```typescript
function pickVerifiedGithubEmail(user: GithubUser, emails: GithubEmail[]) {
  const primaryEmail = emails.find((item) => item.primary && item.verified)
  const firstVerifiedEmail = emails.find((item) => item.verified)
  const fallbackEmail = user.email ? { email: user.email, verified: true } : null
  const selectedEmail = primaryEmail ?? firstVerifiedEmail ?? fallbackEmail

  if (!selectedEmail?.email) {
    throw new AppError(BizCode.AUTH_UNAUTHORIZED, 'GitHub account has no verified email', 401)
  }

  return selectedEmail.email
}
```

邮箱选择的顺序是：

index.txt

```txt
已验证的主邮箱
任意已验证邮箱
GitHub user.email
```

如果没有可用邮箱，就不能继续登录。系统需要用邮箱建立用户身份，这个环节不能跳过去。

## 13. 创建或绑定用户

GitHub 登录后，有三种情况：

index.txt

```txt
1. GitHub 账号已经绑定过本系统用户
2. GitHub 邮箱对应的本系统用户已经存在，但还没绑定 GitHub
3. 全新 GitHub 用户，需要创建本系统用户
```

核心逻辑：

github-oauth.service.ts

```typescript
const existingGithubUser = await findWebUserByGithubAccount(db, providerUserId)

if (existingGithubUser) {
  return existingGithubUser.userId
}

const existingEmailUser = await findUserByNormalizedEmail(db, normalizedEmail)

if (existingEmailUser) {
  await linkGithubAccountToUser({
    db,
    oauthAccountId: uuidv7(),
    userId: existingEmailUser.userId,
    emailId: existingEmailUser.emailId,
    providerUserId,
    providerLogin,
    nowMs,
  })

  await ensureUserHasRole({
    db,
    bindingId: uuidv7(),
    userId: existingEmailUser.userId,
    roleId: webRoleId,
    nowMs,
  })

  return existingEmailUser.userId
}

await createGithubWebUser({
  db,
  userId,
  emailId,
  oauthAccountId: uuidv7(),
  roleBindingId: uuidv7(),
  webRoleId,
  email,
  normalizedEmail,
  displayName,
  providerUserId,
  providerLogin,
  nowMs,
})
```

这样设计之后，老用户可以用同邮箱 GitHub 登录，新用户也可以自动创建账号。GitHub ID 会被绑定起来，后续登录就不需要再依赖邮箱匹配。

## 14. ticket 换系统 token

API callback 完成后有两种常见做法：

index.txt

```txt
方案 A：直接把 accessToken / refreshToken 放到 URL
方案 B：生成一次性 ticket，让 Web 再换系统 token
```

当前实现选择方案 B。我们可以把原因再说清楚一点：URL 不适合放长期 token。

index.txt

```txt
URL 可能进入浏览器历史记录
URL 可能被日志系统记录
URL 可能通过 Referer 泄漏
```

所以 callback URL 里只放短时 ticket：

callback-url.txt

```txt
/login/github/callback?ticket=xxx&state=xxx
```

Web 再请求：

index.txt

```txt
POST /auth/web/github/ticket/login
```

请求体：

index.json

```json
{
  "ticket": "xxx"
}
```

API 消费 ticket：

github-oauth.service.ts

```typescript
const ticket = await consumeOauthLoginTicket({
  db,
  ticketHash: await hashTokenJti(params.ticket),
  provider: 'github',
  nowMs: Date.now(),
})

if (!ticket) {
  throw authUnauthorizedError('GitHub login ticket is invalid')
}
```

`consumeOauthLoginTicket` 会同时做三件事：

index.txt

```txt
ticket_hash 必须匹配
used_at_ms 必须为空
expires_at_ms 必须大于当前时间
```

匹配成功后立刻写入 `used_at_ms`，避免重复使用。

## 15. 签发系统登录态

GitHub 只负责证明 **这个用户是某个 GitHub 用户**。

真正用于系统鉴权的，仍然是我们自己的 token。

github-oauth.service.ts

```typescript
const session = await createWebSession({
  db,
  userId,
  applicationId,
  userAgent: getUserAgent(c),
  ip: getIp(c),
  nowMs,
  expiresAtMs: refreshExpiresAtMs,
  roles: nextRoles,
})

const tokenPair = await issueTokenPair({
  session,
  accessSecret: env.JWT_ACCESS_SECRET,
  refreshSecret: env.JWT_REFRESH_SECRET,
  accessTtlSec: env.ACCESS_TOKEN_TTL_SEC,
  refreshTtlSec: env.REFRESH_TOKEN_TTL_SEC,
})

await insertRefreshToken({
  db,
  tokenId: tokenPair.refreshJti,
  sessionId: session.sessionId,
  jtiHash: await hashTokenJti(tokenPair.refreshJti),
  parentTokenId: null,
  issuedAtMs: nowMs,
  expiresAtMs: refreshExpiresAtMs,
})
```

这样做的好处是登录方式可以扩展，但系统内部鉴权保持一致：

index.txt

```txt
邮箱密码登录 -> 本系统 session
GitHub 登录   -> 本系统 session
未来 Google   -> 本系统 session
```

## 16. Web 登录按钮

前端登录页里，GitHub 按钮不直接拼 URL，而是先请求 API：

github-login.ts

```typescript
export async function redirectToGithubLogin() {
  const response = await getWebGithubAuthUrl()

  window.sessionStorage.setItem(githubOAuthStateStorageKey, response.state)
  window.location.assign(response.url)
}
```

这样处理之后，GitHub client id、callback URL 和 scope 都由 API 统一生成，state 也可以先由 API 签名，再交给 Web 存储和校验。

登录按钮：

login-form.tsx

```tsx
<Button
  variant="outline"
  type="button"
  disabled={isSubmitting || isGithubSubmitting}
  onClick={loginWithGithub}
>
  使用 GitHub 登录
</Button>
```

## 17. Web callback 页面

GitHub 最终会回到 Web：

callback-url.txt

```txt
/login/github/callback?ticket=xxx&state=xxx
```

Web callback 页面要把逻辑再收回来：先读取 `ticket` 和 `state`，再校验 `state` 是否等于 `sessionStorage` 里保存的值，校验通过后再用 `ticket` 换系统 session。

核心代码：

page.tsx

```tsx
useEffect(() => {
  const ticket = searchParams.get("ticket")
  const state = searchParams.get("state")
  const callbackError = searchParams.get("error")

  if (callbackError) {
    setError(callbackError)
    return
  }

  if (!ticket) {
    setError("GitHub 登录结果缺少 ticket")
    return
  }

  const loginTicket = ticket

  if (exchangedTicketRef.current === loginTicket) {
    return
  }

  const expectedState = consumeStoredGithubOAuthState()

  if (!state || !expectedState || state !== expectedState) {
    setError("GitHub 登录状态校验失败")
    return
  }

  exchangedTicketRef.current = loginTicket

  async function exchangeTicket() {
    try {
      await loginByGithubTicket({ ticket: loginTicket })
      router.replace("/")
    } catch (ticketError) {
      if (readClientSession()) {
        router.replace("/")
        return
      }

      setError(ticketError instanceof Error ? ticketError.message : "GitHub 登录失败")
    }
  }

  void exchangeTicket()
}, [router, searchParams])
```

这里有一个细节：`exchangedTicketRef` 是为了避免 React 开发模式下 effect 执行两次，导致同一个 ticket 被重复消费。

## 18. 保存登录态

ticket 换回系统 session 后，前端和邮箱密码登录一样保存：

github-login.ts

```typescript
export async function loginByGithubTicket(input: WebGithubTicketLoginRequest) {
  const response = await loginWithWebGithubTicket(input)
  saveClientSession(response)
}
```

`saveClientSession` 会把 token 写入浏览器会话层，并通知其他模块登录态变化。

后续访问受保护页面时，仍然走已有的 dashboard guard：

index.txt

```txt
读取本地 session
请求 /rpc/user/profile
access token 过期则自动 refresh
refresh 成功后继续进入页面
```

## 19. 创建 GitHub OAuth App

接入 GitHub 授权登录之前，我们需要先在 GitHub 上创建一个 OAuth App。这里说的不是创建一个新的 GitHub 用户账号，而是在当前 GitHub 账号或组织下面注册一个应用，拿到后端换 token 时要用的 `client_id` 和 `client_secret`。

可以直接打开 [settings/apps](https://github.com/settings/apps) 进入创建入口，也可以从 GitHub 右上角头像菜单进入。进入 `Settings` 后，在左侧找到 `Developer settings`，再进入 `OAuth apps`，点击 `New OAuth App`。如果这个账号以前没有创建过 OAuth App，按钮文案可能会显示为 `Register a new application`。

创建表单里有几个字段要认真填。

`Application name` 是用户授权时会看到的应用名称。建议本地和线上分开命名，比如本地叫 `AI Agent Web Local`，线上叫 `AI Agent Web Production`，这样授权页和后台列表都更容易区分。

`Homepage URL` 填 Web 子站地址。本地调试时可以填：

homepage-url.txt

```txt
http://localhost:3005
```

线上环境则填真实的 Web 访问地址：

homepage-url.txt

```txt
https://ai-agent-web.pages.dev
```

`Application description` 可以不填，也可以写一句用户能看懂的说明。这个信息可能会展示给授权用户，所以不要写内部密钥、内网地址或其它敏感内容。

最关键的是 `Authorization callback URL`。这项一定要填 API 子站的 callback 地址，而不是 Web 登录页地址。本地调试时填：

callback-url.txt

```txt
http://127.0.0.1:8787/auth/web/github/callback
```

线上环境填：

callback-url.txt

```txt
https://api.ai-agent.workers.dev/auth/web/github/callback
```

GitHub OAuth App 只能配置一个 callback URL，所以不要试图让同一个 OAuth App 同时服务本地和生产。更稳妥的做法是创建两个 OAuth App：一个专门用于本地开发，一个专门用于线上环境。这样本地的 `client_id`、`client_secret`、`callback URL` 和生产环境完全隔离，排查问题也会清晰很多。

注册完成后，GitHub 会给出 `Client ID`。然后在应用详情页里生成一个 `Client secret`。这个 secret 只会在创建时完整展示，复制后要放进本地 `.dev.vars` 或线上 secret 管理里，不要写进仓库，也不要放到前端环境变量里。

## 20. 本地调试

本地调试时，我们先在 GitHub 创建 OAuth App。

本地 callback URL：

callback-url.txt

```txt
http://127.0.0.1:8787/auth/web/github/callback
```

创建完成后，把 GitHub 给的 `Client ID` 和 `Client secret` 配到 `apps/api/.dev.vars`。本地建议把 `WEB_ORIGIN` 也写清楚，因为 API callback 处理完成后要重定向回 Web 子站：

apps/api/.dev.vars

```txt
GITHUB_OAUTH_CLIENT_ID=你的 client id
GITHUB_OAUTH_CLIENT_SECRET=你的 client secret
GITHUB_OAUTH_CALLBACK_URL=http://127.0.0.1:8787/auth/web/github/callback
WEB_ORIGIN=http://localhost:3005
```

这三个 GitHub 相关配置必须和刚才创建的本地 OAuth App 保持一致。尤其是 `GITHUB_OAUTH_CALLBACK_URL`，要和 GitHub 后台的 `Authorization callback URL` 完全一致，`localhost` 和 `127.0.0.1` 在这里不能混用。

Web 子站本地只需要知道 API 地址。可以在 Web 子站的本地环境变量里配置：

apps/web/.env

```txt
API_BASE_URL=http://127.0.0.1:8787
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8787
```

接着执行本地 D1 迁移：

index.bash

```shellscript
cd apps/api
pnpm db:migrate:local
```

迁移完成后，启动 API 和 Web：

index.bash

```shellscript
pnpm dev:api
pnpm dev:web
```

最后打开登录页：

login-url.txt

```txt
http://localhost:3005/login
```

点击 **使用 GitHub 登录**。

## 21. 线上部署

线上环境也建议单独创建一个 GitHub OAuth App，不要复用本地开发的那个。生产 OAuth App 的 `Homepage URL` 填 Web 线上地址：

homepage-url.txt

```txt
https://ai-agent-web.pages.dev
```

生产环境的 `Authorization callback URL` 填 API 线上 callback 地址：

callback-url.txt

```txt
https://api.ai-agent.workers.dev/auth/web/github/callback
```

GitHub 后台创建完成后，把线上 OAuth App 的 `Client ID` 放进 API production vars：

wrangler.vars

```txt
WEB_ORIGIN=https://ai-agent-web.pages.dev
ADMIN_ORIGIN=https://ai-agent-admin.pages.dev
GITHUB_OAUTH_CLIENT_ID=你的 client id
GITHUB_OAUTH_CALLBACK_URL=https://api.ai-agent.workers.dev/auth/web/github/callback
```

`GITHUB_OAUTH_CLIENT_SECRET` 是敏感信息，线上不要放进可提交配置文件，而是写入 Cloudflare secret：

index.bash

```shellscript
cd apps/api
pnpm wrangler secret put GITHUB_OAUTH_CLIENT_SECRET --env production
```

Web production env 只配置 API 访问地址：

apps/web/.env.production

```txt
API_BASE_URL=https://api.ai-agent.workers.dev
NEXT_PUBLIC_API_BASE_URL=https://api.ai-agent.workers.dev
```

上线前可以按这个顺序再检查一遍：GitHub OAuth App 的 callback URL 是否是 API 地址；API 里的 `GITHUB_OAUTH_CALLBACK_URL` 是否和 GitHub 后台完全一致；API 的 `WEB_ORIGIN` 是否指向 Web 线上地址；Web 的 `NEXT_PUBLIC_API_BASE_URL` 是否指向 API 线上地址；生产 secret 是否已经写入成功。

远程 D1 也要执行迁移：

index.bash

```shellscript
cd apps/api
pnpm wrangler d1 migrations apply ai-agent-production-auth --env production --remote
```

## 22. 常见问题

### 1. GitHub login is disabled

看到这个提示时，通常是数据库里还没有启用 `web + github` 登录方式。本地可以重新执行迁移：

index.bash

```shellscript
cd apps/api
pnpm db:migrate:local
```

线上环境则执行远程迁移。

### 2. GitHub login is not configured

这个错误一般说明 API 环境变量没有配完整，尤其要检查这两个值：

env.txt

```txt
GITHUB_OAUTH_CLIENT_ID
GITHUB_OAUTH_CLIENT_SECRET
```

### 3. callback URL 不匹配

GitHub OAuth App 里配置的 callback URL，必须和 API 实际传给 GitHub 的 `redirect_uri` 完全一致。

本地常见错误是一个写 `localhost`，另一个写 `127.0.0.1`。

这两个对 GitHub 来说不是同一个地址。

### 4. GitHub account has no verified email

这说明 GitHub 没有返回可用的已验证邮箱。可以让用户到 GitHub 账号设置里确认邮箱已经完成验证。

### 5. GitHub 登录状态校验失败

这个问题通常是 Web callback 收到的 `state` 和登录发起时存入 `sessionStorage` 的 state 不一致。比较常见的触发方式有这些：

index.txt

```txt
直接打开 callback 地址
跨浏览器完成授权
sessionStorage 被清空
重复使用旧 callback URL
```

## 总结

GitHub 授权登录可以拆成三层：

index.txt

```txt
GitHub OAuth 层：
  负责证明 GitHub 用户身份

系统用户层：
  负责创建用户、绑定 GitHub 账号、分配 web_user 角色

系统会话层：
  负责签发 access token、refresh token、session
```

当前实现最关键的设计是：

index.txt

```txt
client_secret 只在 API 保存
callback 先进 API，不直接进 Web
URL 里只传短时一次性 ticket
Web 用 ticket 换本系统 session
邮箱密码登录和 GitHub 登录最终复用同一套 token 机制
```

这样一来，登录方式可以继续扩展，但业务侧不需要关心用户到底是邮箱密码登录，还是 GitHub 登录。
