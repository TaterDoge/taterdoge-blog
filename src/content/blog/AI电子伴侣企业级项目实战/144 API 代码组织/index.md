---
title: "144 API 代码组织"
pubDate: 2026-05-26
description: "在 api 子站中，为了防止当接口变多之后，文件变多会不好维护，我们需要提前约定一种代码组织结构。在前面的基础知识中，我们也提到了这一点"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/9-route-structure/](https://aicompanion.usehook.cn/9-route-structure/)

1. 概述
在 api 子站中，为了防止当接口变多之后，文件变多会不好维护，我们需要提前约定一种代码组织结构。在前面的基础知识中，我们也提到了这一点
目前我们还是把接口直接堆在 apps/api/src/app.ts 里，web 侧也是在 page.tsx 里直接写 hc<AppType>() 和请求逻辑。这肯定是不合理的
如果继续这样任由其发展，后面很快会出现几个结果：
所有 api route 都挤在一个文件里
全局错误处理和具体业务实现混在一起
想找某个接口时，要在整份 app.ts 里来回滚
AppType 虽然还能导出，但维护成本会越来越高
我们可以先模拟一大堆 api route，然后看看应该怎么组织代码核心的方式就是：
API 按业务域拆 route
web 按页面和 api.ts 分层消费接口
2. api 子站应该怎么按域拆 routeapi 子站这边最合适的做法，是保留 apps/api/src/app.ts 负责 app 级职责，把具体接口拆进 routes/。也就是说，app.ts 只做这些事：
new Hono()
onError
notFound
挂载所有子路由
导出 AppType
而具体 route 则拆成这种结构：
index.ts统一挂载所有子路由
这种拆法的关键不是「为了拆而拆」，而是先按业务域把接口聚在一起。
system 放探活和系统类接口
catalog 放列表类接口
user 放用户类接口
order 放订单类接口
一旦目录按域稳定下来，后面 route 数量再多，也不会继续把所有逻辑挤回 app.ts。
3. routes/index.ts拆完 route 文件之后，还需要一个统一挂载入口，也就是 apps/api/src/routes/index.ts。它的职责很单纯：把各域路由挂到总 app 上。
apps/api/src/routes/index.ts01import { Hono } from 'hono'
02import catalogRoute from './catalog/list.route'
03import orderRoute from './order/detail.route'
04import healthRoute from './system/health.route'
05import pingRoute from './system/ping.route'
06import userRoute from './user/profile.route'
07
08type Bindings = {
09  APP_ENV: 'development' | 'test' | 'production'
10}
11
12const routes = new Hono<{ Bindings: Bindings }>()
13
14const appRoutes = routes
15  .route('/health', healthRoute)
16  .route('/rpc/system/ping', pingRoute)
17  .route('/rpc/catalog', catalogRoute)
18  .route('/rpc/user', userRoute)
19  .route('/rpc/order', orderRoute)
20
21export type RoutesType = typeof appRoutes
22
23export default appRoutes
这里有两个好处。第一，挂载关系集中可见。要看整个 API 暴露了哪些入口，不需要翻所有 route 文件，看 routes/index.ts 就够了。第二，app.ts 会非常干净。app.ts 不再堆积每条 route 的实现，只保留全局初始化和导出。例如：
apps/api/src/app.ts01import { Hono } from 'hono'
02import routes from './routes'
03
04type AppErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500 | 504
05
06type Bindings = {
07  APP_ENV: 'development' | 'test' | 'production'
08}
09
10const app = new Hono<{ Bindings: Bindings }>()
11
12app.onError((error, c) => {
13  ...
14})
15
16app.notFound((c) => {
17  ...
18})
19
20app.route('/', routes)
21
22export type AppType = typeof routes
23
24export default app
这里最重要的一点是：export type AppType = typeof routes 必须发生在所有子路由挂载完成之后。原因很直接。hc<AppType>() 的嵌套路由类型，是从这个最终 routes 实例推导出来的。如果你在挂载前就导出，web 侧的类型链会丢。
4. 共享 contract 也要按域拆分如果 route 已经按域拆了，packages/contracts 继续全塞在一个 index.ts 里，就又会形成新的堆积点。当前更合理的结构是这样：
index.ts统一聚合导出biz-code.ts业务错误码response.ts统一响应 envelopeping.contract.ts系统 ping 协议list.contract.ts列表协议profile.contract.ts用户资料协议detail.contract.ts订单详情协议
这里的分层思路也很清楚。
common/ 放所有域都会复用的公共约定
各业务域目录只放自己的 request / response contract
index.ts 继续聚合导出，对外保持统一入口
例如：
packages/contracts/src/common/response.ts01import type { BizCode } from './biz-code'
02
03// meta 放请求级别的信息，data/error 放业务结果本身。
04export type ApiMeta = {
05  requestId: string
06  timestamp: string
07}
08
09export type ApiSuccess<T> = {
10  ok: true
11  data: T
12  meta: ApiMeta
13}
14
15export type ApiError = {
16  code: BizCode
17  message: string
18  details?: unknown
19}
20
21export type ApiFailure = {
22  ok: false
23  error: ApiError
24  meta: ApiMeta
25}
26
27// 所有接口最终都落在 success 或 failure 这两个分支里。
28export type ApiResponse<T> = ApiSuccess<T> | ApiFailure
29
30// 这两个 helper 只是统一拼装响应结构，调用方不用每次手写 ok/data/meta。
31export function buildSuccess<T>(data: T, meta: ApiMeta): ApiSuccess<T> {
32  return {
33    ok: true,
34    data,
35    meta,
36  }
37}
38
39export function buildFailure(
40  error: ApiError,
41  meta: ApiMeta,
42): ApiFailure {
43  return {
44    ok: false,
45    error,
46    meta,
47  }
48}
然后每个域只关心自己的 contract：
packages/contracts/src/catalog/list.contract.ts01import { z } from 'zod'
02
03export const CatalogListResponseSchema = z.object({
04  items: z.array(
05    z.object({
06      id: z.string(),
07      name: z.string(),
08      category: z.string(),
09    }),
10  ),
11})
12
13export type CatalogListResponse = z.infer<typeof CatalogListResponseSchema>
这样 route 和 contract 的目录结构基本一一对应，后面找接口会非常容易。
5. web 侧页面和请求文件也要拆开web 这边同样不能继续把所有请求直接写在页面里。更合理的结构是两层：
页面只负责展示
请求文件只负责调接口
首页 apps/web/app/page.tsx 可以退回成一个入口页，只列出验证链接：
apps/web/app/page.tsx01import Link from 'next/link'
02
03const links = [
04  '/verify/system/health',
05  '/verify/system/ping',
06  '/verify/catalog/list',
07  '/verify/user/profile',
08  '/verify/order/detail',
09]
10
11export default function Home() {
12  return (
13    <main>
14      {links.map((href) => (
15        <Link key={href} href={href}>
16          {href}
17        </Link>
18      ))}
19    </main>
20  )
21}
然后每个页面单独负责验证一个接口：
page.tsx验证探活接口page.tsx验证 ping 接口page.tsx验证列表接口page.tsx验证用户资料接口page.tsx验证订单详情接口
每个页面只做三件事：
调对应的 api.ts
展示 request / response
展示成功态或错误码
页面里不再直接写 hc() 和具体请求细节。
6. 每个接口单独一个 api.ts请求逻辑应该单独放到 apps/web/src/api/。建议结构：
client.ts集中创建 Hono clienthealth.api.ts探活请求ping.api.tsping 请求list.api.ts列表请求profile.api.ts用户资料请求detail.api.ts订单详情请求
其中 client.ts 负责集中创建 Hono client：
apps/web/src/api/client.ts01import { getWebServerEnv } from '@/env.server'
02
03const env = getWebServerEnv()
04
05export function serverURL(path: string) {
06  return new URL(path, env.API_BASE_URL).toString()
07}
08
09export function createJsonRequestInit(body?: unknown): RequestInit {
10  if (body === undefined) {
11    return {
12      method: 'GET',
13    }
14  }
15
16  return {
17    method: 'POST',
18    headers: {
19      'content-type': 'application/json',
20    },
21    body: JSON.stringify(body),
22  }
23}
每个 api.ts 文件只做一件事：调用一个接口。例如：
apps/web/src/api/system/ping.api.ts01import type {
02  ApiResponse,
03  PingRequest,
04  PingResponse,
05} from '@repo/contracts'
06import { BizCode } from '@repo/contracts'
07import { createJsonRequestInit, serverURL } from '@/api/client'
08
09export async function postPing(
10  payload: PingRequest,
11): Promise<ApiResponse<PingResponse>> {
12  try {
13    const response = await fetch(
14      serverURL('/rpc/system/ping'),
15      createJsonRequestInit(payload),
16    )
17
18    return await response.json()
19  } catch (error) {
20    return {
21      ok: false,
22      error: {
23        code: BizCode.SYSTEM_UPSTREAM_TIMEOUT,
24        message: error instanceof Error ? error.message : 'API request failed',
25      },
26      meta: {
27        requestId: 'unavailable',
28        timestamp: new Date().toISOString(),
29      },
30    }
31  }
32}
7. 页面和接口文件要一一对应这一点在当前模拟场景里很重要。页面和 API 文件的对应关系应该固定下来：
verify/system/health/page.tsx ↔ src/api/system/health.api.ts
verify/system/ping/page.tsx ↔ src/api/system/ping.api.ts
verify/catalog/list/page.tsx ↔ src/api/catalog/list.api.ts
verify/user/profile/page.tsx ↔ src/api/user/profile.api.ts
verify/order/detail/page.tsx ↔ src/api/order/detail.api.ts
这样做的好处是，每个验证页的来源都很清楚。想查某个页面为什么请求失败，不需要在整个项目里全局搜索，直接看对应的 api.ts 就能定位。同时，这也满足了这次模拟的核心要求：
每个接口请求单独管理
每个页面分别验证
页面与请求文件职责分离
NOTE
注意，本文中的内容仅用于接口测试，不用于实际业务开发，在后续的实践开发中，代码会逐渐发生变化
