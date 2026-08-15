---
title: "164 token 无感刷新自动续签"
pubDate: 2026-06-01
description: "用户登录成功之后，服务端一般不会只发一种凭证，而是会同时发 access token 和 refresh token。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/29-token-silent-refresh/](https://aicompanion.usehook.cn/29-token-silent-refresh/)

## 1. 无感刷新原理

我们可以先把最基础的关系讲清楚。

用户登录成功之后，服务端一般不会只发一种凭证，而是会同时发 `access token` 和 `refresh token`。

`access token` 平时真正拿去请求接口。你打开后台首页，请求 profile，请求列表，这些动作带的通常都是它。

但它不会给太长寿命。因为它用得太频繁，寿命越长，风险面就越大。所以很多系统都会把它设得比较短，十几分钟左右就过期。

问题也正是从这里开始的。

如果 `access token` 一过期，系统就立刻把用户踢回登录页，那体验会很差。用户明明刚刚还在正常操作，只是 token 到点失效了，却被迫重新登录一次，这种中断感会很强。

于是系统又会再发第二张凭证，也就是 `refresh token`。

这张 token 平时不拿去请求业务接口，它主要就干一件事：等 `access token` 失效时，用它去换一张新的 `access token`。

这样一来，整套登录态其实就分成了两层。前面那层是短期工作的 `access token`，负责日常请求；后面那层是寿命更长的 `refresh token`，专门负责在前面那层失效时，把它续上。

理解了这两层之后，再看**无感刷新**就非常清晰了。

所谓**无感**，并不是 token 永不过期，也不是浏览器自己会魔法续签。它真正的意思是，当前请求进来时，系统先试一下现有 `access token` 还能不能正常用。还能用，就继续走；已经失效，但 `refresh token` 还有效，那就先在背后换一张新的 `access token`，再把新的登录态写回去，然后继续完成当前请求。

所以用户最后的体感才会是**没发生什么**。页面没有突然断掉，请求还能继续走，自己也没有被送回登录页。真正无感的，不是没有刷新，而是刷新这件事先在背后做掉了。

把逻辑再补充完整一点，这套机制通常还会和 cookie 一起配合。因为 token 不只是要拿来请求接口，还要在续签成功之后，立刻把新的值写回浏览器。浏览器里的登录态只有同步更新了，后面的页面请求、server render、接口调用，才能继续读到新的 token。

所以无感刷新真正要同时接住两件事。第一件事，是当前请求不能断。第二件事，是浏览器本地登录态也得跟着一起更新。少做一件，用户就会感觉**续签没接上**。

## 2. 项目里的落法

原理讲清楚之后，我们再来看项目里的落法。

现在这套 token 无感刷新，不是在页面组件里做的，而是在 middleware 里做的。

原因也不复杂。自动续签一旦成功，不只是要拿到新的 access token，还得立刻把新的 `admin_access_token`、`admin_refresh_token`、`admin_session` 一起写回响应。

页面组件虽然能读 cookie，但它并不是最适合稳定改写 cookie 的位置。尤其这里不是只改一个值，而是要在同一个时刻把三份登录态一起覆盖回去。

middleware 就很适合做这件事。因为它本来就在请求进入页面之前，正好卡在**请求还没继续往后走**和**响应还没真正回到浏览器**之间。

所以现在真正的入口就是 `apps/admin/middleware.ts`。

## 3. middleware 代码

middleware.ts

```typescript
import { type NextRequest, NextResponse } from 'next/server'
import type { ApiResponse, AdminTokenRefreshResponse } from '@repo/contracts'
import { getAdminServerEnv } from '@/env.server'

const ACCESS_TOKEN_COOKIE = 'admin_access_token'
const REFRESH_TOKEN_COOKIE = 'admin_refresh_token'
const SESSION_COOKIE = 'admin_session'

const PROTECTED_PATHS = ['/', '/profile']

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

function shouldTryRefresh(payload: ApiResponse<unknown> | null, status: number): boolean {
  return (
    status === 401 &&
    payload !== null &&
    !payload.ok &&
    payload.error.code === 'AUTH.UNAUTHORIZED' &&
    payload.error.message === 'Access token is invalid'
  )
}

function buildCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: false,
    path: '/',
    maxAge,
  }
}

async function fetchUserProfileStatus(accessToken: string, apiBaseUrl: string) {
  const response = await fetch(`${apiBaseUrl}/rpc/user/profile`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  })

  let payload: ApiResponse<unknown> | null = null

  try {
    payload = (await response.json()) as ApiResponse<unknown>
  } catch {
    payload = null
  }

  return {
    status: response.status,
    payload,
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (!isProtectedPath(pathname)) {
    return NextResponse.next()
  }

  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value
  const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value

  if (!accessToken || !refreshToken || !sessionCookie) {
    return NextResponse.next()
  }

  const env = getAdminServerEnv()
  const initial = await fetchUserProfileStatus(accessToken, env.API_BASE_URL)

  if (!shouldTryRefresh(initial.payload, initial.status)) {
    return NextResponse.next()
  }

  const refreshResponse = await fetch(`${env.API_BASE_URL}/auth/admin/token/refresh`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  })

  let refreshPayload: ApiResponse<AdminTokenRefreshResponse> | null = null

  try {
    refreshPayload = (await refreshResponse.json()) as ApiResponse<AdminTokenRefreshResponse>
  } catch {
    refreshPayload = null
  }

  if (!refreshPayload?.ok) {
    const response = NextResponse.next()
    response.cookies.delete(ACCESS_TOKEN_COOKIE)
    response.cookies.delete(REFRESH_TOKEN_COOKIE)
    response.cookies.delete(SESSION_COOKIE)
    return response
  }

  const refreshed = refreshPayload.data
  const response = NextResponse.next()

  response.cookies.set(ACCESS_TOKEN_COOKIE, refreshed.accessToken, buildCookieOptions(60 * 15))
  response.cookies.set(REFRESH_TOKEN_COOKIE, refreshed.refreshToken, buildCookieOptions(60 * 60 * 24 * 30))
  response.cookies.set(SESSION_COOKIE, JSON.stringify(refreshed.session), buildCookieOptions(60 * 60 * 24 * 30))

  return response
}

export const config = {
  matcher: ['/', '/profile'],
}
```

整段代码不算短，但顺着请求从上往下看，主线其实很清楚。

## 4. 受保护页面

一进 middleware，先看的是路径：

middleware.ts

```typescript
const PROTECTED_PATHS = ['/', '/profile']

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}
```

这里的意思很简单。

当前这套自动续签不是全站统一拦截，而是只对受保护页面做判断。现在实际拦的是首页和 `/profile`。

后面在 middleware 入口又立刻用了一次：

middleware.ts

```typescript
if (!isProtectedPath(pathname)) {
  return NextResponse.next()
}
```

如果当前请求根本不是受保护页面，那就什么都不做，直接放行。

所以这套无感刷新不是**每个请求都去刷一次 token**，而是只在真正需要登录态的页面前面先看一眼。

## 5. 三个 cookie

路径过关之后，下一步不是立刻去刷 token，而是先把 3 个 cookie 读出来：

middleware.ts

```typescript
const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value
const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value
const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value

if (!accessToken || !refreshToken || !sessionCookie) {
  return NextResponse.next()
}
```

这里的意思也很明确。

如果这 3 个东西不齐，middleware 就不尝试自动续签，直接放行。后面真正进入页面渲染时，页面自己再去读 session，如果发现没登录，再重定向去登录页。

所以这里不是**没 cookie 就当场拦截**，而是 middleware 只负责自动续签，不在这里硬做登录判断。

## 6. 试探 access token

这是整条逻辑里很关键的一步。

很多人会写成：只要进受保护页面，就拿 refresh token 去刷一次。

现在这套不是这么做的。它会先拿当前 access token 去试探性请求一次 profile 接口：

middleware.ts

```typescript
async function fetchUserProfileStatus(accessToken: string, apiBaseUrl: string) {
  const response = await fetch(`${apiBaseUrl}/rpc/user/profile`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  })

  let payload: ApiResponse<unknown> | null = null

  try {
    payload = (await response.json()) as ApiResponse<unknown>
  } catch {
    payload = null
  }

  return {
    status: response.status,
    payload,
  }
}
```

然后在 middleware 里先执行它：

middleware.ts

```typescript
const env = getAdminServerEnv()
const initial = await fetchUserProfileStatus(accessToken, env.API_BASE_URL)
```

也就是说，现在不是**先刷新，再看能不能用**，而是**先试一下当前 token 还能不能正常访问 profile**。

如果它还能用，就没必要刷新。

## 7. refresh 时机

试探请求回来之后，并不是只看 HTTP 401 就开始刷新，还多做了一层收窄：

middleware.ts

```typescript
function shouldTryRefresh(payload: ApiResponse<unknown> | null, status: number): boolean {
  return (
    status === 401 &&
    payload !== null &&
    !payload.ok &&
    payload.error.code === 'AUTH.UNAUTHORIZED' &&
    payload.error.message === 'Access token is invalid'
  )
}
```

然后在 middleware 里这样用：

middleware.ts

```typescript
if (!shouldTryRefresh(initial.payload, initial.status)) {
  return NextResponse.next()
}
```

这一步特别重要。

它意味着 access token 正常就不刷新；只有明确是**access token 失效**这类 401，才去刷新；不是这类错误，就不要误刷。

所以现在的续签逻辑不是**碰到异常就 refresh**，而是只认一类非常具体的失效信号。

## 8. refresh 请求

判断需要刷新之后，middleware 才真正调用 refresh 接口：

middleware.ts

```typescript
const refreshResponse = await fetch(`${env.API_BASE_URL}/auth/admin/token/refresh`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify({ refreshToken }),
  cache: 'no-store',
})
```

这里做的事很直接。它向 `/auth/admin/token/refresh` 发 `POST`，body 里带当前的 `refreshToken`，并且不走缓存。

然后它会继续尝试把响应解析成契约层定义过的结构：

middleware.ts

```typescript
let refreshPayload: ApiResponse<AdminTokenRefreshResponse> | null = null

try {
  refreshPayload = (await refreshResponse.json()) as ApiResponse<AdminTokenRefreshResponse>
} catch {
  refreshPayload = null
}
```

到这里为止，middleware 做的只是代浏览器做了一次续签请求。

## 9. refresh 失败

如果 refresh 接口没返回成功，接下来做的事是：

middleware.ts

```typescript
if (!refreshPayload?.ok) {
  const response = NextResponse.next()
  response.cookies.delete(ACCESS_TOKEN_COOKIE)
  response.cookies.delete(REFRESH_TOKEN_COOKIE)
  response.cookies.delete(SESSION_COOKIE)
  return response
}
```

这里有个很容易忽略的点。

它没有在 middleware 里直接 `redirect('/login')`，而是先把本地 3 个 cookie 清掉，然后继续放行当前请求。

也就是说，middleware 这一步只负责把本地失效状态收干净，不负责直接做页面跳转。

后面页面进入 server render 时，再去读 cookie，就会发现 session 已经没了。然后页面层自己的登录保护逻辑才会把用户送回登录页。

所以最终看上去是**refresh 失败后回登录页**，但中间其实分成了两步：middleware 先清 cookie，页面层再根据空 session 做重定向。

## 10. refresh 成功

如果 refresh 成功，middleware 会先拿到新的数据：

middleware.ts

```typescript
const refreshed = refreshPayload.data
const response = NextResponse.next()
```

然后立刻覆盖写回 3 份 cookie：

middleware.ts

```typescript
response.cookies.set(ACCESS_TOKEN_COOKIE, refreshed.accessToken, buildCookieOptions(60 * 15))
response.cookies.set(REFRESH_TOKEN_COOKIE, refreshed.refreshToken, buildCookieOptions(60 * 60 * 24 * 30))
response.cookies.set(SESSION_COOKIE, JSON.stringify(refreshed.session), buildCookieOptions(60 * 60 * 24 * 30))
```

这里分别对应 `admin_access_token` 15 分钟，`admin_refresh_token` 30 天，`admin_session` 也是 30 天。

这一步就是为什么这套无感刷新放在 middleware 里最顺。因为 middleware 天然就站在请求和响应中间，拿到新的 token 之后，可以立刻把新的 cookie 写回响应，再继续往后放行。

写完之后：

middleware.ts

```typescript
return response
```

当前请求继续进入页面。

## 11. 页面为什么更简单

这套逻辑前置到 middleware 之后，页面层反而轻了很多。

原因很简单：页面自己不再负责续签。

页面现在只需要做两件事，读当前 session cookie，用当前 access token 正常去请求 profile 数据。

因为如果 access token 失效，middleware 已经在页面真正执行之前先帮它试过一次，该刷的也刷过一次了。

如果刷新成功，浏览器拿到的已经是新 cookie，页面接下来读到的也是新 token。

如果刷新失败，middleware 已经把 cookie 清掉了，页面再读 session 时自然就会发现登录态不存在，然后走回登录页。

所以页面层不用再自己写**先试一下，不行就 refresh，再重试**的逻辑。它只管按正常已登录状态去读数据。

## 12. 主线梳理

把这套自动续签从头到尾重新梳理一下，其实就是这样：

先由 middleware 拦住受保护页面，再检查本地 3 个 cookie 是否齐全。齐了之后，不会立刻 refresh，而是先拿当前 access token 试探性请求一次 profile。只有当返回信号明确说明**access token 失效**时，才去调用 `/auth/admin/token/refresh`。

如果 refresh 成功，就把新的 access token、refresh token、session 全部覆盖写回 cookie，然后继续进入页面。

如果 refresh 失败，就把本地 cookie 清掉，让后面的页面渲染阶段自然发现登录态不存在，再回到登录页。

所以这套方案真正值钱的地方，不只是**能自动续签**，而是它把续签这件事前置到了页面执行之前，让页面层只保留最普通的登录态读取逻辑。
