---
title: "146 引入 TanStack Query"
pubDate: 2026-05-27
description: "前面已经把 API 路由拆开，也把请求封装成统一的 http 模块了。接下来如果还要在客户端组件里直接请求接口，只靠 useEffect + useState 很快就会遇到几个重复问题："
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/11-tanstack-query/](https://aicompanion.usehook.cn/11-tanstack-query/)

1. 概述
前面已经把 API 路由拆开，也把请求封装成统一的 http 模块了。接下来如果还要在客户端组件里直接请求接口，只靠 useEffect + useState 很快就会遇到几个重复问题：
加载状态每个组件都要手写
错误状态每个组件都要手写
成功后的缓存、刷新、重试逻辑每个组件都要手写
mutation 完成后，相关 query 的重新拉取也要自己管
这类问题本质上不属于业务，而属于客户端数据管理。
所以这一步最合适的做法，就是把 TanStack Query 接进来，并把它设置成多个子站共享依赖。然后在 web 子站里写一个同时覆盖 query + mutation 的演示案例，把整个接入方式跑通。
2. 为什么这里适合引入 TanStack QueryTanStack Query 是一个专门解决服务端状态管理的库，它可以帮助我们管理客户端组件的远程数据状态，包括数据获取、缓存、失效、重拉等。TanStack Query 解决的不是「怎么发请求」，而是「客户端组件拿到远程数据之后，怎么管理它的生命周期」。当前项目里，这一点和前面的请求封装正好是上下两层关系：
http.ts 负责统一请求入口
api/*.ts 负责接口语义映射
TanStack Query 负责客户端数据状态管理
也就是说，请求是怎么发出去的，还是走你已经封装好的 http。TanStack Query 只关心：
什么时候发
当前是不是 loading
当前是不是 error
数据有没有缓存
mutation 成功后要不要让某个 query 失效重拉
这也是为什么当前场景特别适合接入它。一方面，仓库里已经有统一的接口调用函数，不需要再为 TanStack Query 重写一套 fetcher。另一方面，web 子站已经有客户端演示场景，正好适合验证 useQuery 和 useMutation。
3. 为什么要把它做成共享依赖这次不是只给 web 单独装一个包，而是把 @tanstack/react-query 放进工作区共享依赖。原因很简单：
web 用得上
admin 后面也大概率会用上
这类基础能力属于前端通用依赖，不该让每个子站各写一份版本号
所以先在 pnpm-workspace.yaml 里补 catalog：
pnpm-workspace.yaml1catalog:
2  "@tanstack/react-query": ^5.76.2
然后子站里统一通过 catalog: 引用：
apps/web/package.json1{
2  "dependencies": {
3    "@tanstack/react-query": "catalog:"
4  }
5}
apps/admin/package.json1{
2  "dependencies": {
3    "@tanstack/react-query": "catalog:"
4  }
5}
这样后面升级版本时，也只需要改一处。
4. ProviderTanStack Query 不是装完就能直接在组件里用，它需要一个 QueryClientProvider。这一步最容易做错的地方，是把 QueryClient 建在服务端组件里，或者直接建成模块级单例。当前更稳妥的做法，是单独做一个 client provider 组件，并在 provider 内部用 useState 保证实例只在客户端初始化一次。当前接入方式如下：
apps/web/src/providers/query-provider.tsx01"use client"
02
03import {
04  QueryClient,
05  QueryClientProvider,
06} from '@tanstack/react-query'
07import { useState } from 'react'
08
09// QueryClient 必须放在 client provider 中创建，避免服务端组件环境下共享同一个运行时实例。
10export function QueryProvider({ children }: { children: React.ReactNode }) {
11  const [queryClient] = useState(
12    () =>
13      new QueryClient({
14        defaultOptions: {
15          queries: {
16            retry: 1,
17            staleTime: 30_000,
18          },
19        },
20      }),
21  )
22
23  return (
24    <QueryClientProvider client={queryClient}>
25      {children}
26    </QueryClientProvider>
27  )
28}
然后把它挂到 apps/web/app/layout.tsx 根布局里：
apps/web/app/layout.tsx01import { QueryProvider } from '@/providers/query-provider'
02
03export default function RootLayout({ children }: { children: React.ReactNode }) {
04  return (
05    <html lang="en">
06      <body>
07        <QueryProvider>{children}</QueryProvider>
08      </body>
09    </html>
10  )
11}
这样 web 子站里所有客户端组件都能直接使用 useQuery 和 useMutation。
5. 演示案例同时覆盖 query 和 mutation只演示 useQuery 不够，因为你只会看到「自动读取」这一类场景。只演示 useMutation 也不够，因为你看不到 query 缓存和失效重拉的配合。当前最合适的验证方式，就是做一个 query + mutation 联动 demo：
useQuery 调 GET /health
useMutation 调 POST /rpc/system/ping
ping 成功之后，主动让 health query 失效并 refetch
这样一套下来，TanStack Query 最重要的几个能力就都验证到了：
loading / error / success 状态
query 缓存
手动 refetch
mutation 成功后的 query invalidation
6. 先补一个客户端接口文件既然 query demo 要在客户端组件里跑，那对应的请求函数也要准备好。这次新增了一个专门给客户端用的 health 请求文件：
apps/web/src/client-api/system/health.api.ts1import type { ApiResponse, HealthResponse } from '@repo/contracts'
2import { http } from '@/http'
3
4export function getClientHealth() {
5  return http.get<HealthResponse>('/health') as Promise<ApiResponse<HealthResponse>>
6}
这里沿用的还是前面封装好的 http 模块。也就是说，TanStack Query 接入之后，并没有推翻原来的请求层，而是在其上面继续叠加客户端状态管理。这点很重要，因为它说明整个结构是兼容的：
http 负责请求基础设施
client-api/* 负责客户端调用语义
TanStack Query 负责状态和缓存
7. web 子站里的 query + mutation 演示怎么写当前演示组件放在：
apps/web/src/client-api/system/client-ping-demo.tsx
改造后的核心逻辑如下：
apps/web/src/client-api/system/client-ping-demo.tsx01"use client"
02
03import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
04import { getClientHealth } from '@/client-api/system/health.api'
05import { postClientPing } from '@/client-api/system/ping.api'
06
07const HEALTH_QUERY_KEY = ['system-health']
08
09export function ClientPingDemo() {
10  const queryClient = useQueryClient()
11
12  // 获取数据
13  const { data, isLoading, isError, isSuccess, error, refetch } = useQuery({
14    queryKey: HEALTH_QUERY_KEY,
15    queryFn: getClientHealth,
16  })
17
18  // 发送请求
19  const pingMutation = useMutation({
20    mutationFn: () => postClientPing({ name: 'client-web' }),
21    onSuccess: async () => {
22      await queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
23    },
24  })
25
26  return (
27    <div>
28      {/*...UI*/}
29    </div>
30  )
31}
这里有两个点需要单独讲清。第一，health 用 useQuery。因为它属于页面进入后自动读取、可缓存、可 refetch 的读操作。第二，ping 用 useMutation。因为它属于按钮触发的写操作，请求成功后，再主动让 ['system-health'] 失效重拉。这就是 TanStack Query 最常见也最实用的搭配方式。
8. 这个演示到底验证了什么当前 demo 实际上同时验证了四件事。一是多个子站共享依赖已经成立。@tanstack/react-query 已经收进 workspace catalog，web 和 admin 都通过统一版本引用。二是 Provider 挂载位置正确。QueryProvider 已经在 web 根布局生效，客户端组件可以直接使用 hooks。三是 query 路径已经跑通。useQuery 能正常拉 GET /health，并展示：
isPending
isError
isSuccess
data
error
同时还支持手动 refetch()。四是 mutation 路径已经跑通。useMutation 能正常发 POST /rpc/system/ping，并在成功后让 health query 失效重拉。这说明当前仓库里，客户端组件的远程状态管理链路已经完整接上了。
9. 这种接入方式为什么适合当前项目当前项目适合这样接的原因，不只是「TanStack Query 很流行」，而是它刚好贴合现在的分层状态。你已经有：
contracts 负责共享协议
http 负责统一请求入口
api.ts / client-api.ts 负责接口语义映射
现在再加上 TanStack Query，分层关系就很清楚：
contract 层定义数据形状
request 层负责把请求发出去
query 层负责客户端状态管理
页面层只负责展示
这种结构后面不管是 web 还是 admin，都能沿着同一模式继续扩展。在后续的接口请求中，我们项目会大规模使用 TanStack Query 来管理客户端状态，而不是使用基础的 useEffect + useState
NOTE
tanstack query 的用法比较多，本文只是做一个简单的引导，如果你要完整的学习，可以参考我的这本付费小册，当然，你也可以直接观察后续我们在项目中的使用方式
