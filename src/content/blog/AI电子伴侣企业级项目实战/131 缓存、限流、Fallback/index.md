---
title: "131 缓存、限流、Fallback"
pubDate: 2026-05-22
description: "Hono 有中间件、Express 有中间件，AI SDK 也有中间件——只不过它挂在模型层，而不是 HTTP 层。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/16-middleware/](https://aicompanion.usehook.cn/16-middleware/)

## 1. 中间件：模型调用的「插拔层」

Hono 有中间件、Express 有中间件，AI SDK 也有中间件——只不过它挂在模型层，而不是 HTTP 层。

AI SDK 的模型中间件通过 `wrapLanguageModel` 挂载。它能在每次 LLM 调用前后插入逻辑：

- 请求改写：加日志、改参数、修改 prompt、注入 system

- 响应改写：过滤敏感词、剪裁长度、拼前缀

- 缓存：相同 prompt 直接返回上次的答

- 限流：按用户 / 按租户控制并发

- 重试：某个模型挂了自动重试

- Fallback：检测到 error 自动换 Provider

这些能力是从 Demo 走向生产的关键。这一篇把最常用的几种中间件写清楚，以及怎么把它们组合起来。

## 2. wrapLanguageModel 基础

`wrapLanguageModel` 接收一个 model 和一个 `middleware`，返回新的 model。新 model 仍然是一个标准的 `LanguageModelV2`，可以到处塞。

wrap-basic.ts

```typescript
import { wrapLanguageModel, type LanguageModelV2Middleware } from 'ai'
import { openai } from '@ai-sdk/openai'

const loggingMiddleware: LanguageModelV2Middleware = {
  wrapGenerate: async ({ doGenerate, params }) => {
    console.log('[LLM] calling', params.prompt.length, 'chars')
    const result = await doGenerate()
    console.log('[LLM] finished, tokens:', result.usage)
    return result
  },

  wrapStream: async ({ doStream, params }) => {
    console.log('[LLM] streaming start')
    return doStream()
  },
}

const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: loggingMiddleware,
})

// 使用：和普通 model 完全一样
streamText({ model, prompt: '...' })
```

Middleware 有三个 hook：

| hook | 作用 | 何时调 |
| --- | --- | --- |
| wrapGenerate | 包裹 generateText / generateObject | 非流式调用 |
| wrapStream | 包裹 streamText / streamObject | 流式调用 |
| transformParams | 只改参数不包裹执行 | 所有调用前，两个 hook 会先 transformParams 再进入自己 |

大多数中间件只要实现 `wrapGenerate` 和 `wrapStream` 就够了。

## 3. 缓存中间件：相同问答复用

LLM 调用是贵的。如果同一个 prompt + 参数反复出现（比如用户点「重新生成」），理论上可以命中缓存。

用 `wrapLanguageModel` + Cloudflare KV 实现缓存：

cache-middleware.ts

```typescript
import { type LanguageModelV2Middleware } from 'ai'
import type { KVNamespace } from '@cloudflare/workers-types'

export function cacheMiddleware(kv: KVNamespace, ttl = 3600): LanguageModelV2Middleware {
  return {
    wrapGenerate: async ({ doGenerate, params }) => {
      const key = await hashKey(params)
      const cached = await kv.get(key, 'json')
      if (cached) {
        console.log('[cache hit]', key)
        return cached as any
      }

      const result = await doGenerate()
      await kv.put(key, JSON.stringify(result), { expirationTtl: ttl })
      return result
    },

    // 流式场景一般不缓存（太复杂），或者缓存文本后再重建流
  }
}

async function hashKey(params: unknown): Promise<string> {
  const json = JSON.stringify(params)
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `llm:${hex.slice(0, 16)}`
}
```

用起来：

use-cache.ts

```typescript
import { wrapLanguageModel } from 'ai'

const cachedModel = wrapLanguageModel({
  model: openai('gpt-4o-mini'),
  middleware: cacheMiddleware(c.env.KV, 86400),
})
```

适合用的场景：

- 分类 / 摘要类 pipeline（同样输入期望同样输出）

- 内部工具（翻译、提取）

- 产品里的示例或 Demo 查询

不适合的场景：

- 对话（prompt 每次都不同）

- 对「生成多样性」有要求的场景（用户点「再来一个」期望换一种）

## 4. 限流中间件：按用户 / 按租户控制并发

保护自己也保护上游（Provider）的 API 配额。基于 Cloudflare KV 的滑动窗口：

rate-limit-middleware.ts

```typescript
import { type LanguageModelV2Middleware } from 'ai'
import type { KVNamespace } from '@cloudflare/workers-types'

interface RateLimitConfig {
  kv: KVNamespace
  keyFn: () => string       // 怎么识别调用方（用户 ID、租户 ID、IP）
  limit: number             // 时间窗口内的最大调用次数
  windowSec: number         // 窗口秒数
}

export function rateLimitMiddleware(cfg: RateLimitConfig): LanguageModelV2Middleware {
  const check = async () => {
    const k = `rate:${cfg.keyFn()}`
    const now = Math.floor(Date.now() / 1000)
    const windowStart = now - cfg.windowSec

    // 读上一个窗口内的请求时间戳列表
    const raw = await cfg.kv.get(k)
    const list: number[] = raw ? JSON.parse(raw) : []
    const fresh = list.filter((t) => t > windowStart)

    if (fresh.length >= cfg.limit) {
      throw new Error(`rate limit exceeded: ${fresh.length}/${cfg.limit} per ${cfg.windowSec}s`)
    }

    fresh.push(now)
    await cfg.kv.put(k, JSON.stringify(fresh), { expirationTtl: cfg.windowSec * 2 })
  }

  return {
    wrapGenerate: async ({ doGenerate }) => {
      await check()
      return doGenerate()
    },
    wrapStream: async ({ doStream }) => {
      await check()
      return doStream()
    },
  }
}
```

使用：

use-rate-limit.ts

```typescript
const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: rateLimitMiddleware({
    kv: c.env.KV,
    keyFn: () => sessionId,
    limit: 30,           // 每分钟 30 次
    windowSec: 60,
  }),
})
```

生产上几条经验：

- 限流策略和用户等级挂钩（免费用户 30/min、会员 300/min）

- 超限后给出友好提示（返回 429 + 说明）

- 全局限流 + 用户限流两层保护，前者防止单用户打爆

## 5. Fallback 与 Retry 中间件

### 5.1 Fallback：一家挂了换下一家

场景是 OpenAI 突然 500 或 429，你希望自动切到 Anthropic，不让用户感知。

AI SDK 官方推荐的做法就是组合多个 Provider：

fallback-middleware.ts

```typescript
import { type LanguageModelV2Middleware, APICallError } from 'ai'
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'

export function fallbackMiddleware(fallback: LanguageModelV2): LanguageModelV2Middleware {
  return {
    wrapGenerate: async ({ doGenerate, params, model }) => {
      try {
        return await doGenerate()
      } catch (err) {
        if (shouldFallback(err)) {
          console.warn('[fallback] primary failed, retry on fallback', err)
          // 用 fallback model 跑一次
          return await fallback.doGenerate(params)
        }
        throw err
      }
    },

    wrapStream: async ({ doStream, params, model }) => {
      try {
        return await doStream()
      } catch (err) {
        if (shouldFallback(err)) {
          return await fallback.doStream(params)
        }
        throw err
      }
    },
  }
}

function shouldFallback(err: unknown): boolean {
  if (APICallError.isInstance(err)) {
    // 5xx 或 429 或网络错误才 fallback
    return err.isRetryable || (err.statusCode ?? 0) >= 500
  }
  return false
}
```

使用：

use-fallback.ts

```typescript
const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: fallbackMiddleware(anthropic('claude-opus-4-6')),
})
```

几条经验：

- Fallback 不应该级联超过三层，层数多了太慢

- Fallback 的模型能力要接近主 model，避免回复质量差太多

- 要打埋点：每次 fallback 发生要记录，用来监控主 Provider 稳定度

- 流式下的 Fallback 有坑：如果主 model 已经 emit 了前半段再挂，切 fallback 会重新开始，前半段就白流了。要么接受「重来」，要么检测到进入 stream 就不 fallback

### 5.2 Retry：短暂失败自动重试

和 Fallback 的区别：retry 是同一个模型重试，fallback 是换模型。

retry-middleware.ts

```typescript
export function retryMiddleware(maxRetries = 2, baseDelay = 500): LanguageModelV2Middleware {
  const doWithRetry = async <T>(fn: () => Promise<T>, retries = maxRetries): Promise<T> => {
    try {
      return await fn()
    } catch (err) {
      if (retries > 0 && isRetryable(err)) {
        const delay = baseDelay * Math.pow(2, maxRetries - retries)
        await sleep(delay + Math.random() * 200) // jitter
        return doWithRetry(fn, retries - 1)
      }
      throw err
    }
  }

  return {
    wrapGenerate: ({ doGenerate }) => doWithRetry(() => doGenerate()),
    // 流式重试也类似，但要注意部分 emit 的问题
  }
}
```

一般只对非流式调用做 retry，流式调用让上层业务自己决定。

## 6. 组合多个中间件

`middleware` 参数支持数组，按顺序组合：

compose.ts

```typescript
const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: [
    loggingMiddleware,
    cacheMiddleware(kv),
    rateLimitMiddleware({ kv, keyFn: () => userId, limit: 30, windowSec: 60 }),
    retryMiddleware(2),
    fallbackMiddleware(anthropic('claude-opus-4-6')),
  ],
})
```

执行顺序是：数组越靠前，越靠外层。上面这个栈的执行顺序是：

order.txt

```text
request → logging → cache (hit? return) → rate limit → retry → fallback → primary model
```

不同场景的组合经验：

- 后端内部脚本：cache + retry + logging

- 用户面向的生产：rate limit + retry + fallback + logging（不 cache）

- 开发阶段：logging + 让错误透传

### defaultSettingsMiddleware

有一种特殊的中间件，只改默认参数，不改行为：

default-settings.ts

```typescript
import { defaultSettingsMiddleware } from 'ai'

const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: defaultSettingsMiddleware({
    settings: {
      temperature: 0.3,
      maxOutputTokens: 1000,
      frequencyPenalty: 0.2,
    },
  }),
})
```

业务层调用时不传这些参数，`model` 自带；但业务层显式传了也会覆盖。适合「全站默认低 temperature」「某个路由默认短输出」这类统一默认值的场景。

## 7. 真实世界的中间件栈

AI 伴侣项目的模型栈大概长这样：

real-world.ts

```typescript
import { wrapLanguageModel } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import { openai } from '@ai-sdk/openai'

export function buildCompanionModel(env: Env, sessionId: string, userId: string) {
  const workersai = createWorkersAI({ binding: env.AI })
  const primaryRaw = workersai('@cf/meta/llama-3.3-70b-instruct-fp8-fast')
  const fallbackRaw = openai('gpt-4o-mini')

  return wrapLanguageModel({
    model: primaryRaw,
    middleware: [
      telemetryMiddleware({ sessionId, userId }),       // 先埋点，拿到总量
      rateLimitMiddleware({
        kv: env.KV,
        keyFn: () => userId,
        limit: 120,
        windowSec: 60,
      }),
      retryMiddleware(2),
      fallbackMiddleware(fallbackRaw),
      defaultSettingsMiddleware({
        settings: { temperature: 0.7 },
      }),
    ],
  })
}
```

调用方只需要：

usage.ts

```typescript
const model = buildCompanionModel(c.env, sessionId, userId)
const result = streamText({ model, messages, tools })
return result.toUIMessageStreamResponse()
```

中间件栈在业务代码里是不可见的，但每次调用都有限流、重试、Fallback、埋点的保护。

## 8. 常见坑

### Middleware 顺序错导致 cache 不生效

数组靠前的是外层。cache 应该尽量靠外（尽早判断缓存命中），rate limit 也应该放在 cache 之后（命中缓存不占额度）。

### 流式 Fallback 的半截流

上面提过，流失败了切 fallback 会从头重来，用户看到的是「文字闪一下然后重新写」。解决办法：只对前几个 chunk 做 fallback（超过就算了），或者业务层做「生成失败继续，之前的文字保留」。

### Cache key 没考虑 tools

有 tools 的调用，相同 prompt 但 tools 不同，结果差很多。cache key 要把 `params.tools` 的 schema 指纹也考虑进去。

### Middleware 吞错误

中间件里用 `try/catch` 时要小心。如果你吞了错误返回一个假结果，上层完全不知情。除非是 Fallback 这种明确的降级，否则一定要让错误抛出来。

## 9. 小结

- `wrapLanguageModel` 给 model 挂上中间件，新 model 仍然是标准 `LanguageModelV2`

- 核心三个 hook：`wrapGenerate` / `wrapStream` / `transformParams`

- 常用中间件：Logging / Cache / RateLimit / Retry / Fallback / DefaultSettings

- 数组组合时越靠前越外层，顺序设计很关键

- 生产栈常见组合：telemetry → rate limit → retry → fallback → defaults

- 流式下的 Fallback 要想清楚「半截流重来」的接受度

- 中间件不要吞错误，除非是明确的降级

下一篇进入后端三连的最后一篇——**可观测性**。Telemetry / OpenTelemetry / Langfuse 怎么接，怎么在生产追踪一次 chat 的完整链路。
