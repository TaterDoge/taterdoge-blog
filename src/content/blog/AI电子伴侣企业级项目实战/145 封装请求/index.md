---
title: "145 封装请求"
pubDate: 2026-05-26
description: "前面已经把 API 路由按域拆开，也把 web 子站里的请求按 api.ts 文件拆开了。但当前还有一个问题没有解决：web 子站这边，服务端组件和客户端组件的请求方式还没有统一"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/10-http-wrapper/](https://aicompanion.usehook.cn/10-http-wrapper/)

1. 概述
前面已经把 API 路由按域拆开，也把 web 子站里的请求按 api.ts 文件拆开了。但当前还有一个问题没有解决：web 子站这边，服务端组件和客户端组件的请求方式还没有统一
我们想要的方式是，封装一个方法：可以直接通过如下方式调用接口
index.tsx1import type { PingRequest, PingResponse } from '@repo/contracts'
2import { http } from '@/http'
3
4export function postPing(payload: PingRequest) {
5  return http.post<PingRequest, PingResponse>('/rpc/system/ping', payload)
6}
如果不提前封装，请求代码很快就会出现两种分裂：
服务端组件里自己拼 fetch(url, init)
客户端组件里再写一套 baseURL、query、JSON body 和错误兜底
所以这篇文章要做的事情很明确：封装一个单入口的 http 模块，让 web/admin 子站里的服务端组件和客户端组件都走同一套请求方式。
2. 为什么这里不能继续让页面直接写请求当前如果页面自己写请求，问题通常集中在四个地方：
每个页面都要自己拼 baseURL
每个页面都要自己处理 query string
每个页面都要自己序列化 POST body
每个页面都要自己兜底网络异常，手动拼 ApiResponse
这些逻辑单看都不大，但它们本质上属于「请求基础设施」，不该散落在页面里。页面真正该关心的是：
调哪个接口
传什么 payload
怎么展示结果
而不是每次都重新处理 fetch 的公共细节。所以当前最合理的方式，是把这些底层细节收进一个统一的 http 模块，让调用方只关心接口语义。
3. 统一 http 模块要解决哪几件事这个模块要解决的，不只是「把 fetch 包起来」这么简单。它至少要统一处理下面几件事：
当前运行在服务端还是客户端
当前该从哪里拿 baseURL
GET 请求怎么拼 query
POST 请求怎么序列化 JSON body
网络失败时怎么返回统一的 ApiResponse
也就是说，调用方不应该关心当前是不是在浏览器，也不应该自己判断该读 getWebServerEnv() 还是 getWebClientEnv()。这些判断都应该放到 http 模块内部。
4. 单入口 http 模块怎么写当前封装出来的结果如下：
apps/web/src/http.ts001import type { ApiResponse } from '@repo/contracts'
002import { BizCode } from '@repo/contracts'
003import { getWebClientEnv } from '@/env.client'
004import { getWebServerEnv } from '@/env.server'
005
006export type HttpQuery = Record<
007  string,
008  string | number | boolean | undefined
009>
010
011export type HttpGetOptions = {
012  query?: HttpQuery
013  init?: RequestInit
014}
015
016export type HttpPostOptions = {
017  init?: RequestInit
018}
019
020// 单入口 http 模块。调用方不需要关心当前运行在服务端还是客户端。
021function resolveBaseURL() {
022  // 浏览器里只能读取 NEXT_PUBLIC_*，服务端则读取私有 API_BASE_URL。
023  if (typeof window === 'undefined') {
024    return getWebServerEnv().API_BASE_URL
025  }
026
027  return getWebClientEnv().NEXT_PUBLIC_API_BASE_URL
028}
029
030function buildSearchParams(query?: HttpQuery) {
031  if (!query) {
032    return ''
033  }
034
035  const params = new URLSearchParams()
036
037  for (const [key, value] of Object.entries(query)) {
038    if (value === undefined) {
039      continue
040    }
041
042    params.set(key, String(value))
043  }
044
045  const search = params.toString()
046
047  return search ? `?${search}` : ''
048}
049
050function createRequestInit(
051  method: 'GET' | 'POST',
052  payload: unknown,
053  init?: RequestInit,
054): RequestInit {
055  if (method === 'GET') {
056    return {
057      method,
058      ...init,
059    }
060  }
061
062  return {
063    method,
064    headers: {
065      'content-type': 'application/json',
066      ...(init?.headers ?? {}),
067    },
068    body: JSON.stringify(payload),
069    ...init,
070  }
071}
072
073// 所有 GET/POST 都会收敛到这里：拼 URL、序列化 JSON、调用 fetch、统一异常结构。
074async function request<TData>(
075  method: 'GET' | 'POST',
076  path: string,
077  options?: {
078    payload?: unknown
079    query?: HttpQuery
080    init?: RequestInit
081  },
082): Promise<ApiResponse<TData>> {
083  try {
084    const url = new URL(
085      `${path}${buildSearchParams(options?.query)}`,
086      resolveBaseURL(),
087    ).toString()
088
089    const response = await fetch(
090      url,
091      createRequestInit(method, options?.payload, options?.init),
092    )
093
094    return await response.json()
095  } catch (error) {
096    return {
097      ok: false,
098      error: {
099        code: BizCode.SYSTEM_UPSTREAM_TIMEOUT,
100        message: error instanceof Error ? error.message : 'API request failed',
101      },
102      meta: {
103        requestId: 'unavailable',
104        timestamp: new Date().toISOString(),
105      },
106    }
107  }
108}
109
110export const http = {
111  get<TData>(path: string, options?: HttpGetOptions) {
112    return request<TData>('GET', path, {
113      query: options?.query,
114      init: options?.init,
115    })
116  },
117  post<TReq, TData>(
118    path: string,
119    payload: TReq,
120    options?: HttpPostOptions,
121  ) {
122    return request<TData>('POST', path, {
123      payload,
124      init: options?.init,
125    })
126  },
127}
5. resolveBaseURL()这份封装里最重要的一个地方，其实不是 fetch，而是 resolveBaseURL()。因为当前项目的运行环境有两套：
服务端组件运行在 Node/Next 服务端
客户端组件运行在浏览器
这两边读取环境变量的方式不同：
服务端读 getWebServerEnv().API_BASE_URL
客户端读 getWebClientEnv().NEXT_PUBLIC_API_BASE_URL
如果让每个调用方自己判断 typeof window === 'undefined'，请求逻辑会很乱。现在把它集中到 resolveBaseURL() 里，调用方就不需要再知道自己当前跑在哪。这正是这次封装最重要的价值：把运行时差异藏在底层，而不是分散到页面和每个 api.ts 里。
6. query、body 和异常的处理只统一 baseURL 还不够。如果 query string、POST body、异常结构还散在外面，页面一样会越来越臃肿。这份封装里，buildSearchParams() 负责把 GET 请求参数统一转成 query string，顺手处理掉 undefined 值。createRequestInit() 则把 GET 和 POST 的差异收口了：
GET 不带 body
POST 自动补 content-type: application/json
POST 自动 JSON.stringify(payload)
这样后面页面和 api.ts 文件都不需要再重复写：
new URLSearchParams(...)
headers: { 'content-type': 'application/json' }
body: JSON.stringify(payload)
异常处理同样值得单独收口。现在约定的是：一旦 fetch 抛错，不把异常继续抛给页面，而是直接返回统一的 ApiResponse<TData> 失败结构：
ok: false
error.code = BizCode.SYSTEM_UPSTREAM_TIMEOUT
error.message 放原始错误信息
meta 填一份兜底值
这样页面层始终拿到的是同一种 envelope，不需要一边处理 try/catch，一边处理业务错误码。
7. 如何使用以订单详情接口为例：
apps/web/src/api/order/detail.api.ts1import type { OrderDetailRequest, OrderDetailResponse } from '@repo/contracts'
2import { http } from '@/http'
3
4export function postOrderDetail(payload: OrderDetailRequest) {
5  return http.post<OrderDetailRequest, OrderDetailResponse>(
6    '/rpc/order/detail',
7    payload,
8  )
9}
这里非常简洁，只需要把具体接口和具体类型对接起来它不再关心：
baseURL 怎么拿
body 怎么序列化
fetch 异常怎么兜底
返回值外层结构怎么统一
这些都已经在 http 里解决了。这就是理想的分层状态：
http.ts 负责请求基础设施
api/*.api.ts 负责接口语义映射
页面负责展示
8. 页面里的使用组件里的调用方式可以简化成这样：
apps/web/app/verify/order/detail/page.tsx01import { postOrderDetail } from '@/api/order/detail.api'
02
03export default async function OrderDetailPage() {
04  const payload = { id: 'order-001' }
05  const result = await postOrderDetail(payload)
06
07  return (
08    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-6 py-12 md:px-10">
09      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Order / detail</h1>
10      <pre className="rounded-[var(--radius-card)] border border-border bg-muted/40 p-5 text-sm leading-6 text-muted-foreground">
11        {JSON.stringify({ payload, result }, null, 2)}
12      </pre>
13    </main>
14  )
15}
这就是这套封装真正想要的结果：页面只保留接口调用和结果展示，不碰请求底座。
9. 后续的扩展这次的封装得到的收益至少有五个：
服务端和客户端请求入口统一了
baseURL 解析只保留一份
query / body / JSON 序列化逻辑只保留一份
fetch 异常统一转换成 ApiResponse 失败结构
每个接口文件和页面都变得更简洁
更重要的是，后面不管 web 和 admin 再加多少接口，请求方式都不会发生变化我们后面还需要根据需求继续增加：
http.put
http.delete
统一鉴权 header
统一超时控制
统一埋点
这些能力都可以继续加在同一个入口上，而不是回到每个页面各写一套
