---
title: "143 引入 zod-validator"
pubDate: 2026-05-26
description: "前面把 Hono RPC、共享 contract、统一错误响应都接起来之后，API 里其实还留着一个很明显的手工校验点：validator'json', ... 里自己调用 PingRequestSchema.safeParse，再手动返回"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/8-zod-validator/](https://aicompanion.usehook.cn/8-zod-validator/)

## 1. 概述

前面把 Hono RPC、共享 contract、统一错误响应都接起来之后，API 里其实还留着一个很明显的手工校验点：`validator('json', ...)` 里自己调用 `PingRequestSchema.safeParse()`，再手动返回失败响应。

app.ts

```typescript
validator('json', (value, c) => {
  const parsed = PingRequestSchema.safeParse(value)
  ...
})
```

当前项目里这一段还能工作，但它已经暴露出两个问题：

- schema 校验和 Hono 中间件是分开的

- 每次写 JSON 校验时，都要手动处理 `safeParse` 的成功失败分支

如果后面 route 变多，这种写法会越来越重复。既然已经在用 `zod`，又在用 Hono，最直接的做法就是把这一层换成 `@hono/zod-validator` 提供的 `zValidator`

`hono/validator` 是 Hono 内置的通用校验中间件，`@hono/zod-validator` 是 Hono 官方的 Zod 集成，把 Zod schema 变成路由中间件。替换之后的代码可以变成

app.ts

```typescript
import { zValidator } from '@hono/zod-validator'

app.post('/rpc/system/ping', zValidator('json', PingRequestSchema), (c) => {
  const payload = c.req.valid('json')
  ...
})
```

替换之后的有点：

- 少写一层 `safeParse`

- c.req.valid('json') 的类型推导更自然

- 代码更短，Zod 路由多了以后更省事儿

## 2. 详细说明

原来的 `ping` 路由大概是这种结构：

apps/api/src/app.ts

```typescript
import { validator } from 'hono/validator'

app.post('/rpc/system/ping', validator('json', (value, c) => {
  const parsed = PingRequestSchema.safeParse(value)

  if (!parsed.success) {
    const res = {
      code: BizCode.COMMON_INVALID_REQUEST,
      message: 'Invalid request payload',
      details: parsed.error.flatten(),
    }

    return c.json(buildFailure(res, createMeta()), 400)
  }

  return parsed.data
}), (c) => {
  const payload = c.req.valid('json')

  return c.json(
    buildSuccess(
      {
        service: 'api',
        message: `pong, ${payload.name}`,
        env: env.APP_ENV,
      },
      createMeta(),
    ),
  )
})
```

`validator('json', ...)` 负责接住 Hono 的 JSON 校验入口，`PingRequestSchema.safeParse()` 又在里面自己做了一次完整的 zod 校验。结果就是：虽然 schema 是 zod 写的，但路由层还得手工管理 success / error 分支。

当前项目只有这一处时，体感还不强。等到后面再加用户、任务、消息这些 route，每个地方都重复一遍 `safeParse` 和失败响应，代码很快就会变得啰嗦。

## 3. 为什么这里适合换成 zValidator

`@hono/zod-validator` 做的事情很直接：把 Hono 的请求校验入口和 zod schema 接起来，帮你完成校验，并把校验后的结果继续挂到 `c.req.valid('json')` 上。

也就是说，这一层不再需要自己手动写：

- `safeParse(value)`

- `if (!parsed.success)`

- `return parsed.data`

你只需要把 schema 交给 `zValidator`，它会帮你完成校验，并把校验后的结果继续挂到 `c.req.valid('json')` 上。

这个替换在当前项目里特别合适，原因有三点。

**第一，schema 本来就是 zod。**

`PingRequestSchema` 已经存在，没有迁移成本。

**第二，Hono 只用到一处 JSON validator。**

现在替换范围很小，改动可控，不会牵出一堆历史包袱。

**第三，现有失败响应格式已经定好了。**

这很关键。当前 API 不是接受 `zValidator` 默认报错，而是要继续返回：

- `COMMON.INVALID_REQUEST`

- `Invalid request payload`

- `flatten()` 后的错误详情

- 统一的 `buildFailure(..., createMeta())`

好在 `zValidator` 支持自定义失败处理函数，所以这一层并不会破坏现有 contract。

## 4. 具体改动

先补依赖：

apps/api/package.json

```json
{
  "dependencies": {
    "@hono/zod-validator": "^0.7.4",
    "@repo/contracts": "workspace:*",
    "hono": "^4.12.14",
    "zod": "catalog:"
  }
}
```

然后把 `app.ts` 里的 import 换掉：

apps/api/src/app.ts

```typescript
import {
  BizCode,
  PingRequestSchema,
  buildFailure,
  buildSuccess,
  type ApiMeta,
} from '@repo/contracts'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getApiEnv } from './env'
```

这里最核心的替换发生在 `POST /rpc/system/ping`：

apps/api/src/app.ts

```typescript
.post(
  '/rpc/system/ping',
  zValidator('json', PingRequestSchema, (result, c) => {
    if (result.success) {
      return
    }

    const res = {
      code: BizCode.COMMON_INVALID_REQUEST,
      message: 'Invalid request payload',
      details: result.error.flatten(),
    }

    return c.json(buildFailure(res, createMeta()), 400)
  }),
  (c) => {
    const payload = c.req.valid('json')
    const env = getApiEnv(c.env)

    return c.json(
      buildSuccess(
        {
          service: 'api',
          message: `pong, ${payload.name}`,
          env: env.APP_ENV,
        },
        createMeta(),
      ),
    )
  },
)
```
