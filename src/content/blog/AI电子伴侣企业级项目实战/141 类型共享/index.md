---
title: "141 类型共享"
pubDate: 2026-05-25
description: "接下来，我们要约定在 web 端和 api 端之间共享请求类型，并使用 Hono RPC 进行通信。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/6-type-sharing/](https://aicompanion.usehook.cn/6-type-sharing/)

## 1. 概述

接下来，我们要约定在 web 端和 api 端之间共享请求类型，并使用 Hono RPC 进行通信。

目前 API 侧现在只有一个 `GET /health`，返回的还是裸 JSON。前端侧也没有真正成型的请求层。继续往下写业务，很快就会碰到三个问题：

- 请求参数靠口头约定

- 成功和失败返回格式各写各的

- 前端拿到接口后，类型还是得自己再补一遍

这类问题一开始不明显，接口一多就会变成维护负担。你会看到同一个错误，在 web、admin、api 三处分别写一遍；同一个字段一旦改名，类型漂移会沿着整条链路扩散。

因此，我们的目标很明确：

- 将 contract 放进共享包，前后端共用同一份类型和 schema

- 统一 success / failure 返回结构

- 前端直接基于 Hono RPC 调用，拿到真实类型推导

- 用首页上的一次 `ping` 调用验证整条链路是否通顺

## 2. 定义 contract 边界

shared contract 只放跨端稳定约定，不放业务实现。放进 `packages/contracts` 的内容控制在这几类：

- 业务异常码 `BizCode`

- 统一响应元信息 `ApiMeta`

- 成功结构 `ApiSuccess<T>` 和 失败结构 `ApiFailure<E>`

- 总响应类型 `ApiResponse<T, E>`

- `ping` 这条最小链路的输入输出 schema 与类型

这里最关键的点有两个。

**第一，输入输出都要有 schema**

只写 TypeScript type 不够，因为 type 只在编译期存在，真正到接口入口时，传进来的 JSON 还是运行时数据。这里直接用 zod 定义 `PingRequestSchema` 和 `PingResponseSchema`，这样 API 可以校验入参，前端也能复用同一份 contract。

**第二，响应 envelope 也要共享**

如果每个 route 自己拼 `{ ok, data, error, meta }`，后面一多就会失控。所以直接在共享包里提供 `buildSuccess` 和 `buildFailure` 这类纯数据 helper，把结构先固定下来。

可以先把 contract 包写成这样：

packages/contracts/src/index.ts

```typescript
import { z } from 'zod'

export const BizCode = {
  COMMON_INVALID_REQUEST: 'COMMON.INVALID_REQUEST',
  COMMON_NOT_FOUND: 'COMMON.NOT_FOUND',
  AUTH_UNAUTHORIZED: 'AUTH.UNAUTHORIZED',
  AUTH_FORBIDDEN: 'AUTH.FORBIDDEN',
  BIZ_CONFLICT: 'BIZ.CONFLICT',
  BIZ_RULE_VIOLATION: 'BIZ.RULE_VIOLATION',
  SYSTEM_INTERNAL_ERROR: 'SYSTEM.INTERNAL_ERROR',
  SYSTEM_UPSTREAM_TIMEOUT: 'SYSTEM.UPSTREAM_TIMEOUT',
} as const

export type BizCode = (typeof BizCode)[keyof typeof BizCode]

export interface ApiMeta {
  requestId: string
  timestamp: string
}

export interface ApiSuccess<T> {
  ok: true
  data: T
  meta: ApiMeta
}

export interface ApiError<E = unknown> {
  code: BizCode
  message: string
  details?: E
}

export interface ApiFailure<E = unknown> {
  ok: false
  error: ApiError<E>
  meta: ApiMeta
}

export type ApiResponse<T, E = unknown> = ApiSuccess<T> | ApiFailure<E>

export const PingRequestSchema = z.object({
  name: z.string().trim().min(1),
})

export const PingResponseSchema = z.object({
  service: z.literal('api'),
  message: z.string(),
})

export type PingRequest = z.infer<typeof PingRequestSchema>
export type PingResponse = z.infer<typeof PingResponseSchema>

export function buildSuccess<T>(data: T, meta: ApiMeta): ApiSuccess<T> {
  return { ok: true, data, meta }
}

export function buildFailure<E = unknown>(
  error: ApiError<E>,
  meta: ApiMeta,
): ApiFailure<E> {
  return { ok: false, error, meta }
}
```

到这里，前后端至少已经在「说同一种语言  」。

## 3. 统一响应格式

接口返回值建议从一开始就分成两层语义：

- `HTTP status`，表示传输层结果

- `error.code`，表示业务语义

成功结构统一为：

index.json

```json
{
  "ok": true,
  "data": {
    "service": "api",
    "message": "pong, web"
  },
  "meta": {
    "requestId": "d7c4f4ef-67c3-4f48-90b2-0cb6c6f7ea4f",
    "timestamp": "2026-04-28T08:00:00.000Z"
  }
}
```

失败结构统一成：

index.json

```json
{
  "ok": false,
  "error": {
    "code": "COMMON.INVALID_REQUEST",
    "message": "Invalid request payload",
    "details": {
      "fieldErrors": {
        "name": ["String must contain at least 1 character(s)"]
      }
    }
  },
  "meta": {
    "requestId": "8c9b0b52-ef80-44d8-b2e1-d40c6b90a40d",
    "timestamp": "2026-04-28T08:00:01.000Z"
  }
}
```

这里的 `meta` 不只是为了好看。

`requestId` 让日志串联有锚点，`timestamp` 让排查时能快速定位请求时间。后面真接日志平台、链路追踪或者 Sentry，这两个字段都能直接复用。

配套的业务异常码可以先收一组通用常量：

- `COMMON.INVALID_REQUEST`

- `COMMON.NOT_FOUND`

- `AUTH.UNAUTHORIZED`

- `AUTH.FORBIDDEN`

- `BIZ.CONFLICT`

- `BIZ.RULE_VIOLATION`

- `SYSTEM.INTERNAL_ERROR`

- `SYSTEM.UPSTREAM_TIMEOUT`

这组常量先别追求全面，关键是命名风格和职责边界要稳定。后面新增业务 route 时，直接在这个集合里继续扩展。

## 4. RPC 与异常处理

这里做一个很实用的拆分：

- `apps/api/src/app.ts` 负责定义路由、错误处理、导出 `AppType`

- `apps/api/src/index.ts` 只负责 `export default app`

这样做的目的可以让前端 type-only 导入 `AppType`，拿到 Hono route 的真实类型推导。

先看 `app.ts` 的最小形态：

apps/api/src/app.ts

```typescript
import {
  BizCode,
  PingRequestSchema,
  buildFailure,
  buildSuccess,
  type ApiMeta,
} from '@repo/contracts'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { validator } from 'hono/validator'

type AppErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500 | 504

class AppError extends Error {
  constructor(
    readonly code: BizCode,
    message: string,
    readonly status: AppErrorStatus,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

const app = new Hono()

function createMeta(): ApiMeta {
  return {
    requestId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  }
}

app.onError((error, c) => {
  const meta = createMeta()

  if (error instanceof AppError) {
    const errorMsg = { code: error.code, message: error.message, details: error.details }
    const res = buildFailure(errorMsg, meta);
    return c.json(res, error.status);
  }

  if (error instanceof HTTPException) {
    const errorMsg = { code: BizCode.COMMON_INVALID_REQUEST, message: error.message }
    const res = buildFailure(errorMsg, meta);
    return c.json(res, error.status);
  }

  console.error(error)

  const errorMsg = { code: BizCode.SYSTEM_INTERNAL_ERROR, message: 'Internal server error' }
  const res = buildFailure(errorMsg, meta);
  return c.json(res, 500);
})

app.notFound((c) => {
  const errorMsg = { code: BizCode.COMMON_NOT_FOUND, message: 'Not found' }
  const res = buildFailure(errorMsg, createMeta());
  return c.json(res, 404);
})

const routes = app
  .get('/health', (c) => {
    const res = buildSuccess({ service: 'api' }, createMeta());
    return c.json(res);
  })
  .post('/rpc/system/ping', validator('json', (value, c) => {
      const parsed = PingRequestSchema.safeParse(value)

      if (!parsed.success) {
        const errorMsg = {
          code: BizCode.COMMON_INVALID_REQUEST,
          message: 'Invalid request payload',
          details: parsed.error.flatten(),
        }
        return c.json(buildFailure(errorMsg, createMeta()), 400);
      }

      return parsed.data
    }),
    (c) => {
      const payload = c.req.valid('json')
      const successMsg = { service: 'api', message: `pong, ${payload.name}` }
      const res = buildSuccess(successMsg, createMeta());
    return c.json(res);
  });

export type AppType = typeof routes;

export default app;
```

入口文件就保持极简：

apps/api/src/index.ts

```typescript
import app from './app'

export default app
```

这一步的价值在于，route 结构、入参校验、返回值 envelope、异常码映射，已经统一到一个地方。

## 5. 前端直接走 typed RPC

后端 contract 定好了，接下来就该让前端真正共享这份类型收益。

这里不额外包一层请求 SDK，先在 `web` 首页直接走一次最小调用，目的就是验证链路，而不是过早抽象。

要做的接入只有三步。

**第一步，补 workspace 依赖。**

`apps/web/package.json` 增加：

- `@repo/api`

- `@repo/contracts`

- `hono`

`apps/api/package.json` 也要补 workspace 包名和 exports，让 `AppType` 能被前端引用。

apps/api/package.json

```json
{
  "name": "@repo/api",
  "type": "module",
  "exports": {
    ".": "./src/app.ts"
  },
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy --minify",
    "cf-typegen": "wrangler types --env-interface CloudflareBindings",
    "check-types": "tsc --noEmit"
  },
  "dependencies": {
    "@repo/contracts": "workspace:*",
    "hono": "^4.12.14"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "wrangler": "^4.4.0"
  }
}
```

`apps/web/next.config.js` 也要把共享包加进 `transpilePackages`：

apps/web/next.config.js

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@repo/ui', '@repo/contracts', '@repo/api'],
}

export default nextConfig
```

**第二步，首页直接连 RPC。**

这里用 `hc<AppType>()` 建 client，前端就能拿到 route 对应的参数和返回值推导。

apps/web/app/page.tsx

```tsx
import type { AppType } from '@repo/api'
import {
  BizCode,
  type ApiResponse,
  type PingRequest,
  type PingResponse,
} from '@repo/contracts'
import { hc, type InferResponseType } from 'hono/client'

const apiBaseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:8787'
const rpcPayload: PingRequest = { name: 'web' }

type PingRpcResponse = InferResponseType<
  ReturnType<typeof hc<AppType>>['rpc']['system']['ping']['$post']
>

async function getPingResponse(): Promise<PingRpcResponse> {
  const client = hc<AppType>(apiBaseUrl)

  try {
    const response = await client.rpc.system.ping.$post({
      json: rpcPayload,
    })

    return await response.json()
  } catch (error) {
    return {
      ok: false,
      error: {
        code: BizCode.SYSTEM_UPSTREAM_TIMEOUT,
        message: error instanceof Error ? error.message : 'API request failed',
      },
      meta: {
        requestId: 'unavailable',
        timestamp: new Date().toISOString(),
      },
    } satisfies ApiResponse<PingResponse>
  }
}
```

**第三步，把调用结果直接展示在首页。**

这个展示区块不需要做花活，能看清请求体、返回值和错误码就够了。

apps/web/app/page.tsx

```tsx
const requestBody = JSON.stringify(rpcPayload, null, 2)
const responseBody = JSON.stringify(pingResult, null, 2)

<section className="py-10">
  <Card className="overflow-hidden border border-border bg-background shadow-soft">
    <CardContent className="space-y-5 p-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          RPC validation
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Shared request and response contract
        </h2>
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="rounded-full border border-border px-3 py-1">
          POST /rpc/system/ping
        </span>
        <span className="rounded-full border border-border px-3 py-1">
          {pingResult.ok ? 'ok=true' : `code=${pingResult.error.code}`}
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium text-foreground">Request</p>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all text-xs leading-6 text-muted-foreground">
            {requestBody}
          </pre>
        </div>
        <div className="rounded-2xl border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium text-foreground">Response</p>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all text-xs leading-6 text-muted-foreground">
            {responseBody}
          </pre>
        </div>
      </div>
    </CardContent>
  </Card>
</section>
```

这样，我们就可以直接在首页上验证共享请求类型和响应类型是否跑通。

## 6. 验证

做到这里，其实已经验证了四件关键的事。

**共享请求类型已经跑通。**

`PingRequestSchema` 和 `PingRequest` 来自同一个共享包，API 用它校验，前端用它约束入参。字段一旦变化，前后端会一起感知。

**共享响应类型已经跑通。**

`PingResponse` 和 `ApiResponse<T>` 让成功结构、失败结构、元信息结构都固定下来。后面新增接口，不需要每次重新发明一套返回格式。

**异常码已经有了统一出口。**

无论是 `notFound`、参数校验失败，还是运行时异常，最后都会汇总到统一的 failure envelope。前端读取错误信息时，也不再猜字段名。

**Hono RPC 的类型推导已经接上。**

前端通过 `hc<AppType>()` 直接消费 API route 类型，这意味着 route 路径、请求体、返回值三者已经串到一起。

这个阶段先别急着抽出通用 `rpcClient`、`fetcher`、`service layer`。当前目标只是验证方向，最小链路能跑通，后面的抽象才有依据。

跑通之后，后面的用户、鉴权、任务、消息这些业务 route，就都有统一入口可接了：先在 `packages/contracts` 补 schema 和类型，再在 `apps/api/src/app.ts` 补 route，最后让前端通过 `hc<AppType>()` 消费。
