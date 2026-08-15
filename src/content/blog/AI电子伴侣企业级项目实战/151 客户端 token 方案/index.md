---
title: "151 客户端 token 方案"
pubDate: 2026-05-28
description: "很多新手会把 token 方案想得很乱，根源通常只有一个：把“保存凭证”“发送凭证”“续期凭证”混在了一起。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/16-client-token/](https://aicompanion.usehook.cn/16-client-token/)

## 1. 概述

这一篇只解决客户端视角的 4 个问题：

- 登录成功后，access token 放哪

- refresh token 放哪

- 发业务请求时到底该带什么

- 页面刷新、token 过期、退出登录时该怎么处理

很多新手会把 token 方案想得很乱，根源通常只有一个：把“保存凭证”“发送凭证”“续期凭证”混在了一起。

这一篇把这 3 件事拆开，再用一套能直接落地的代码串起来。

## 2. 先记住最终方案

当前这类 Web 项目，先按这套方案理解就够了：

- access token：放客户端内存

- refresh token：放 `httpOnly cookie`

- 业务接口：带 `access token`

- 刷新接口：靠浏览器自动带上 `refresh token cookie`

- 页面刷新后：客户端重新向服务端换一次新的 access token

把它翻成更口语的话就是：

- access token 给前端代码用

- refresh token 给服务端续期用

- 前端能直接碰到的，尽量只保留短命的 access token

- 活得久、风险更高的 refresh token，尽量别让前端 JS 直接拿到

## 3. 先把两个 token 的分工彻底分清

### 3.1 access token 干什么

access token 只做一件事：

**请求业务接口时，证明当前请求已经登录。**

比如这些请求：

- 获取当前用户资料

- 获取订单列表

- 修改个人设置

- 提交一条评论

这类请求都属于“办业务”，所以它们该带的是 access token。

### 3.2 refresh token 干什么

refresh token 也只做一件事：

**当 access token 过期后，去服务端换一个新的 access token。**

它不应该跟着普通业务接口到处跑。

所以客户端里这两个 token 的工作边界很清楚：

- access token：高频使用

- refresh token：低频使用，只出现在 refresh 流程

## 4. 为什么推荐 access token 放内存，refresh token 放 cookie

这一段是新手最容易问的地方。

先看一张表：

| 对象 | 前端 JS 能不能直接读 | 会不会跟着页面刷新保留 | 主要用途 | 推荐位置 |
| --- | --- | --- | --- | --- |
| access token | 能 | 不能 | 访问业务接口 | 内存 |
| refresh token | 不能 | 能 | 换新 access token | httpOnly cookie |

### 4.1 access token 放内存的好处

放内存有个直接好处：

**页面一关、标签页一丢、整块 JS 运行环境一没，access token 也就没了。**

这代表它的暴露时间更短。

access token 本来就该短命，所以放内存很符合它的角色。

### 4.2 refresh token 放 httpOnly cookie 的好处

refresh token 活得更久，也更敏感。

既然它更敏感，就别让前端代码直接 `localStorage.getItem()` 拿到它。

放进 `httpOnly cookie` 后：

- 浏览器可以保存它

- 浏览器发请求时可以自动带上它

- 前端 JS 代码读不到它

这正好符合 refresh token 的角色：

- 需要跨刷新保留

- 需要参与续期

- 但不需要被业务代码频繁读取

### 4.3 为什么不推荐把 refresh token 放 localStorage

因为 localStorage 里的值，前端 JS 可以直接读写。

一旦页面里有 XSS 漏洞，长期凭证就有被直接拿走的风险。

所以对 refresh token 这类长期敏感凭证来说，localStorage 不是一个理想位置。

## 5. 先看完整链路，别急着看代码

真正的客户端 token 流程，通常是下面这样：

- 用户登录成功

- 服务端返回 access token

- 服务端同时写入 refresh token cookie

- 客户端把 access token 存到内存

- 后续业务请求都带 access token

- access token 过期后，客户端调用 refresh 接口

- 浏览器自动带上 refresh token cookie

- 服务端校验 refresh token，签发新的 access token

- 客户端更新内存里的 access token

- 用户退出登录时，服务端清掉 refresh token，客户端清掉 access token

这里最关键的一点是：

**业务请求和 refresh 请求，是两条不同的请求链路。**

- 业务请求看 access token

- refresh 请求看 refresh token

## 6. 代码实践：登录成功时，服务端返回什么

先看一眼登录成功后的典型结果。

response.txt

```txt
HTTP/1.1 200 OK
Set-Cookie: refresh_token=rt_xxxxx; HttpOnly; Secure; SameSite=Lax; Path=/auth/web/token/refresh
Content-Type: application/json

{
  "accessToken": "at_xxxxx",
  "user": {
    "id": "user_123",
    "name": "keepzml"
  }
}
```

这里有两个动作同时发生：

- 响应体里返回 `accessToken`

- 响应头里通过 `Set-Cookie` 写入 `refresh_token`

前端代码真正能直接拿到的，只有响应体里的 `accessToken`。

`refresh_token` 这个 cookie 会由浏览器保存，但前端 JS 读不到。

## 7. 代码实践：客户端怎么保存 access token

最简单的做法，就是单独做一个内存 token store。

apps/web/src/auth/token-store.ts

```typescript
let accessToken: string | null = null

export const tokenStore = {
  getAccessToken() {
    return accessToken
  },
  setAccessToken(token: string | null) {
    accessToken = token
  },
  clear() {
    accessToken = null
  },
}
```

这个文件非常朴素，但它刚好够用。

它表达的是一个很重要的事实：

- access token 只是运行期状态

- 它不一定要进 localStorage

- 它也不一定非得进 Zustand

如果你的 UI 不需要拿它做响应式展示，一个简单的模块级变量就够了。

## 8. 代码实践：登录后把 access token 放进内存

apps/web/src/auth/auth-api.ts

```typescript
import { tokenStore } from './token-store'

interface LoginResponse {
  accessToken: string
  user: {
    id: string
    name: string
  }
}

interface RefreshResponse {
  accessToken: string
}

export const loginByPassword = async (email: string, password: string) => {
  const response = await fetch('/auth/web/password/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) {
    throw new Error('登录失败')
  }

  const data = (await response.json()) as LoginResponse
  tokenStore.setAccessToken(data.accessToken)
  return data
}

export const refreshAccessToken = async () => {
  const response = await fetch('/auth/web/token/refresh', {
    method: 'POST',
    credentials: 'include',
  })

  if (!response.ok) {
    tokenStore.clear()
    throw new Error('刷新 access token 失败')
  }

  const data = (await response.json()) as RefreshResponse
  tokenStore.setAccessToken(data.accessToken)
  return data.accessToken
}
```

这里有两个初学者必须看懂的点：

- 登录接口返回的是 `accessToken`

- refresh 接口不需要前端手动传 `refreshToken`

为什么不需要手动传？

因为 refresh token 已经在 `httpOnly cookie` 里了，浏览器会按规则自动带上。

## 9. 代码实践：业务请求怎么自动带 access token

真正访问业务接口时，通常会封装一个统一请求函数。

apps/web/src/lib/http-client.ts

```typescript
import { refreshAccessToken } from '@/auth/auth-api'
import { tokenStore } from '@/auth/token-store'

const createHeaders = (headers: HeadersInit | undefined, token: string | null) => {
  const nextHeaders = new Headers(headers)

  if (token) {
    nextHeaders.set('Authorization', `Bearer ${token}`)
  }

  return nextHeaders
}

let refreshPromise: Promise<string> | null = null

const refreshOnce = async () => {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null
    })
  }

  return refreshPromise
}

export const authFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const accessToken = tokenStore.getAccessToken()

  const response = await fetch(input, {
    ...init,
    credentials: 'include',
    headers: createHeaders(init.headers, accessToken),
  })

  if (response.status !== 401) {
    return response
  }

  const nextAccessToken = await refreshOnce()

  return fetch(input, {
    ...init,
    credentials: 'include',
    headers: createHeaders(init.headers, nextAccessToken),
  })
}
```

这段代码对应的真实流程是：

- 先拿当前内存里的 access token 发请求

- 如果接口直接成功，流程结束

- 如果返回 `401`，说明 access token 可能过期了

- 这时走一次 refresh

- refresh 成功后，拿新的 access token 重试原请求

### 9.1 refreshOnce 为什么很重要

很多新手第一次写到这里，会漏掉一个问题：

**多个请求同时 401 怎么办？**

例如页面刚打开时，用户资料、订单列表、通知列表 3 个接口一起发了出去。它们发现 access token 过期，于是都去调 refresh。

这时就可能出现：

- 同时发出多个 refresh 请求

- 同一个旧 refresh token 被并发消费

- 客户端本地状态互相覆盖

`refreshOnce` 的作用，就是把同一时刻的 refresh 合并成一次。

前面的请求等同一个 `Promise`，等它成功后再继续重试。

这个处理在真实项目里非常常见，也非常实用。

## 10. 代码实践：页面刷新后怎么恢复登录态

access token 放在内存里，页面刷新后它自然就没了。

这不是 bug，这就是设计的一部分。

页面刷新后，客户端该做的是：

- 发现内存里没有 access token

- 主动调用一次 refresh 接口

- 如果 refresh 成功，拿回新的 access token

- 如果 refresh 失败，说明登录态已经失效

可以写一个启动函数：

apps/web/src/auth/bootstrap-session.ts

```typescript
import { refreshAccessToken } from './auth-api'

export const bootstrapSession = async () => {
  try {
    await refreshAccessToken()
    return true
  } catch {
    return false
  }
}
```

如果你在 Next.js 客户端入口里调用它，页面一刷新，登录态就能自动恢复。

它依赖的核心前提就是：refresh token 还在 cookie 里。

## 11. 代码实践：请求业务接口时怎么用

apps/web/src/api/account/get-current-user.ts

```typescript
import { authFetch } from '@/lib/http-client'

interface CurrentUser {
  id: string
  name: string
  email: string
}

export const getCurrentUser = async () => {
  const response = await authFetch('/api/account/me')

  if (!response.ok) {
    throw new Error('获取当前用户失败')
  }

  return (await response.json()) as CurrentUser
}
```

这里就已经不需要手动关心：

- token 从哪拿

- 401 后怎么 refresh

- refresh 后怎么重试

这些逻辑都被收口到 `authFetch` 里了。

业务代码就只管调接口。

## 12. 代码实践：退出登录怎么处理

退出登录也要分成客户端和服务端两个动作。

客户端要做的是：

- 清掉内存里的 access token

服务端要做的是：

- 撤销当前 session

- 撤销相关 refresh token

- 清除 refresh token cookie

前端调用可以写成这样：

apps/web/src/auth/logout.ts

```typescript
import { tokenStore } from './token-store'

export const logout = async () => {
  await fetch('/auth/web/logout', {
    method: 'POST',
    credentials: 'include',
  })

  tokenStore.clear()
}
```

这里要记住一个边界：

- 清掉前端内存，只是清掉当前页面里的 access token

- 真正结束这次登录态，还得靠服务端撤销 session 和 refresh token

## 13. 新手最容易写错的地方

### 13.1 把 refresh token 也放进 Authorization 头

普通业务接口只该看 access token。

refresh token 应该只出现在 refresh 链路里。

### 13.2 把 access token 和 refresh token 都塞进 localStorage

这样做看起来省事，但长期敏感凭证暴露面会更大。

### 13.3 页面刷新后发现 access token 丢了，就以为方案错了

这恰恰是 access token 放内存的自然结果。

正确动作是走一次 `bootstrapSession`。

### 13.4 每个 401 都各自发一次 refresh

这样很容易在并发下把 refresh 流程打乱。

至少要做一次 refresh 合并。

### 13.5 退出登录只清前端，不撤销服务端 session

这样页面表面看起来退出了，服务端那边的长期凭证可能还活着。

## 14. 这一篇真正该记住什么

把整篇文章压缩成最小结论，就是下面 6 句：

- access token 给业务请求用

- refresh token 给续期用

- access token 放内存

- refresh token 放 `httpOnly cookie`

- 页面刷新后靠 refresh 恢复 access token

- 401 续期时要做 refresh 合并

这 6 句记住以后，再去看 session、JWT、refresh rotation、登出、会话撤销，整条链路就会清楚很多。
