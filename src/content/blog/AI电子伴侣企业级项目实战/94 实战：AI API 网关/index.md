---
title: "94 实战：AI API 网关"
pubDate: 2026-05-11
description: "上一篇做了用户管理系统，这篇换个方向——做一个 AI API 网关，部署在 Cloudflare Workers 上。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/19-ai-api-practice/](https://aicompanion.usehook.cn/19-ai-api-practice/)

## 1. 要做什么

上一篇做了用户管理系统，这篇换个方向——做一个 **AI API 网关**，部署在 Cloudflare Workers 上。

场景很常见：你做了个 AI 应用，前端需要调大模型 API。但你不能把大模型的 API Key 直接放到前端代码里（谁都能打开浏览器控制台抄走），也不想让每个客户端直连大模型（没法做访问控制和计费）。

所以中间需要一层代理：客户端拿自己的 API Key 请求你的网关，网关用服务端的大模型 Key 去调 OpenAI / Claude，把结果流式转发回来。中间顺便加上鉴权、限流、用量统计。

功能清单：

| 功能 | 说明 |
| --- | --- |
| API Key 鉴权 | 客户端带自己的 key，网关验证后用服务端 key 调大模型 |
| 流式代理 | SSE 流式响应透传，打字机效果 |
| 请求限流 | 固定窗口，每分钟 N 次 |
| 用量统计 | 每次请求记录 token 消耗 |

技术栈：**Hono + Cloudflare Workers + KV + SSE**，全是前面讲过的东西。

## 2. 项目结构

index.ts主入口，组装路由和中间件types.ts类型定义和 Bindingsauth.tsAPI Key 鉴权rate-limit.ts请求限流chat.ts流式代理usage.ts用量查询usage.ts用量记录工具函数wrangler.jsoncpackage.json

## 3. 类型定义和 Bindings

先把所有类型理清楚。网关需要四个 Cloudflare 绑定：一个环境变量存大模型 Key，三个 KV 分别做 API Key 存储、限流和用量统计。

src/types.ts

```typescript
export type Bindings = {
  // 服务端大模型 API Key
  OPENAI_API_KEY: string
  // 限流用的 KV
  RATE_LIMIT_KV: KVNamespace
  // 用量统计用的 KV
  USAGE_KV: KVNamespace
  // API Key 信息存储
  API_KEYS_KV: KVNamespace
}

// 存在 KV 里的 API Key 信息
export interface ApiKeyInfo {
  id: string
  name: string
  rateLimit: number  // 每分钟最大请求数
  createdAt: number
}

// 中间件往 context 里塞的变量
export type Variables = {
  apiKeyId: string
  apiKeyInfo: ApiKeyInfo
}

// Hono app 的完整类型
export type AppEnv = {
  Bindings: Bindings
  Variables: Variables
}

// 聊天请求体
export interface ChatRequest {
  model?: string
  messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }>
  stream?: boolean
  temperature?: number
  max_tokens?: number
}

// 用量记录
export interface UsageRecord {
  totalRequests: number
  totalPromptTokens: number
  totalCompletionTokens: number
  lastUsedAt: number
}
```

对应的 `wrangler.jsonc`：

wrangler.jsonc

```jsonc
{
  "name": "ai-api-gateway",
  "main": "src/index.ts",
  "compatibility_date": "2024-12-01",
  "vars": {
    // 实际部署用 wrangler secret put OPENAI_API_KEY 设置
    "OPENAI_API_KEY": "sk-xxx"
  },
  "kv_namespaces": [
    { "binding": "RATE_LIMIT_KV", "id": "your-rate-limit-kv-id" },
    { "binding": "USAGE_KV", "id": "your-usage-kv-id" },
    { "binding": "API_KEYS_KV", "id": "your-api-keys-kv-id" }
  ]
}
```

## 4. API Key 鉴权中间件

客户端在请求头里带 `Authorization: Bearer gw-xxxx`，中间件去 KV 里查这个 key 是否有效。

这里用到了 `createMiddleware`，它跟前面直接写 `async (c, next) => {...}` 效果一样，区别是 `createMiddleware` 可以传泛型参数，这样中间件内部访问 `c.env` 和 `c.get()` 时就有类型提示了。

src/middleware/auth.ts

```typescript
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv, ApiKeyInfo } from '../types'

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    throw new HTTPException(401, {
      message: 'Missing or invalid Authorization header',
    })
  }

  const apiKey = authHeader.slice(7) // 去掉 "Bearer "

  // 从 KV 读取 key 信息
  const keyInfo = await c.env.API_KEYS_KV.get<ApiKeyInfo>(
    `key:${apiKey}`,
    'json'
  )

  if (!keyInfo) {
    throw new HTTPException(401, { message: 'Invalid API key' })
  }

  // 把 key 信息存到 context 里，后续中间件和路由可以用
  c.set('apiKeyId', keyInfo.id)
  c.set('apiKeyInfo', keyInfo)

  await next()
})
```

这里用 KV 存 API Key 信息，key 的格式是 `key:gw-xxxx`，value 是一个 JSON 对象。注册新 key 的逻辑可以单独做一个管理接口，这里不展开。

## 5. 限流中间件

限流是什么意思？就是限制每个 API Key 在一段时间内能请求多少次。比如每分钟最多 60 次，超了就拒绝。防止有人刷接口把你的大模型额度刷爆。

我们用 KV 做固定窗口限流。思路：以分钟为单位，每个 API Key 每分钟一个计数器。请求来了就 +1，超过阈值就返回 429。

src/middleware/rate-limit.ts

```typescript
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../types'

export const rateLimitMiddleware = createMiddleware<AppEnv>(
  async (c, next) => {
    const apiKeyId = c.get('apiKeyId')
    const apiKeyInfo = c.get('apiKeyInfo')
    const limit = apiKeyInfo.rateLimit || 60

    // 当前分钟的时间窗口 key
    const windowKey = `rate:${apiKeyId}:${Math.floor(Date.now() / 60000)}`

    const count = parseInt(
      (await c.env.RATE_LIMIT_KV.get(windowKey)) || '0'
    )

    if (count >= limit) {
      throw new HTTPException(429, {
        message: `Rate limit exceeded. Max ${limit} requests per minute.`,
      })
    }

    // 计数 +1，设置 120 秒过期（确保过了这分钟后自动清理）
    await c.env.RATE_LIMIT_KV.put(windowKey, String(count + 1), {
      expirationTtl: 120,
    })

    // 在响应头里告诉客户端限流状态
    c.header('X-RateLimit-Limit', String(limit))
    c.header('X-RateLimit-Remaining', String(limit - count - 1))

    await next()
  }
)
```

几个细节：

- 时间窗口 key 用 `Math.floor(Date.now() / 60000)` 生成，每分钟一个值

- `expirationTtl: 120` 让 key 在 2 分钟后自动过期，不用手动清理

- 响应头返回限流信息，方便客户端做自适应

## 6. 用量记录工具函数

每次请求完成后，把 token 消耗累加到 KV。

src/lib/usage.ts

```typescript
import type { UsageRecord } from '../types'

export async function recordUsage(
  kv: KVNamespace,
  apiKeyId: string,
  promptTokens: number,
  completionTokens: number
) {
  const key = `usage:${apiKeyId}`
  const existing = await kv.get<UsageRecord>(key, 'json')

  const record: UsageRecord = {
    totalRequests: (existing?.totalRequests || 0) + 1,
    totalPromptTokens: (existing?.totalPromptTokens || 0) + promptTokens,
    totalCompletionTokens:
      (existing?.totalCompletionTokens || 0) + completionTokens,
    lastUsedAt: Date.now(),
  }

  await kv.put(key, JSON.stringify(record))
}

// 按天记录，方便查看趋势
export async function recordDailyUsage(
  kv: KVNamespace,
  apiKeyId: string,
  promptTokens: number,
  completionTokens: number
) {
  const today = new Date().toISOString().slice(0, 10) // "2024-12-01"
  const key = `usage:${apiKeyId}:${today}`
  const existing = await kv.get<UsageRecord>(key, 'json')

  const record: UsageRecord = {
    totalRequests: (existing?.totalRequests || 0) + 1,
    totalPromptTokens: (existing?.totalPromptTokens || 0) + promptTokens,
    totalCompletionTokens:
      (existing?.totalCompletionTokens || 0) + completionTokens,
    lastUsedAt: Date.now(),
  }

  // 每日记录保留 90 天
  await kv.put(key, JSON.stringify(record), { expirationTtl: 86400 * 90 })
}
```

这里做了两层记录：总量和每日。总量用于计费，每日用于看趋势。

## 7. 流式代理：核心逻辑

这是整个网关最核心的部分。接收客户端请求，用服务端 key 调 OpenAI，把 SSE 流逐 chunk 转发。

src/routes/chat.ts

```typescript
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv, ChatRequest } from '../types'
import { recordUsage, recordDailyUsage } from '../lib/usage'

const chat = new Hono<AppEnv>()

// 流式代理
chat.post('/v1/chat/completions', async (c) => {
  const body = await c.req.json<ChatRequest>()
  const model = body.model || 'gpt-4o'
  const isStream = body.stream !== false // 默认流式

  // 用服务端 key 调 OpenAI
  const upstream = await fetch(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: body.messages,
        stream: isStream,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
        // 流式模式下要求返回 usage
        ...(isStream ? { stream_options: { include_usage: true } } : {}),
      }),
    }
  )

  if (!upstream.ok) {
    const error = await upstream.text()
    throw new HTTPException(upstream.status as any, {
      message: `Upstream error: ${error}`,
    })
  }

  // 非流式：直接转发 JSON 响应
  if (!isStream) {
    const result = await upstream.json<any>()

    // 记录用量
    const usage = result.usage
    if (usage) {
      c.executionCtx.waitUntil(
        Promise.all([
          recordUsage(
            c.env.USAGE_KV,
            c.get('apiKeyId'),
            usage.prompt_tokens,
            usage.completion_tokens
          ),
          recordDailyUsage(
            c.env.USAGE_KV,
            c.get('apiKeyId'),
            usage.prompt_tokens,
            usage.completion_tokens
          ),
        ])
      )
    }

    return c.json(result)
  }

  // 流式：SSE 转发
  return streamSSE(c, async (stream) => {
    const reader = upstream.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let promptTokens = 0
    let completionTokens = 0

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()

          if (data === '[DONE]') {
            // 流结束，发送 [DONE]
            await stream.writeSSE({ data: '[DONE]', event: 'message' })

            // 记录用量（不阻塞响应）
            c.executionCtx.waitUntil(
              Promise.all([
                recordUsage(
                  c.env.USAGE_KV,
                  c.get('apiKeyId'),
                  promptTokens,
                  completionTokens
                ),
                recordDailyUsage(
                  c.env.USAGE_KV,
                  c.get('apiKeyId'),
                  promptTokens,
                  completionTokens
                ),
              ])
            )
            return
          }

          try {
            const parsed = JSON.parse(data)

            // 提取 usage 信息（OpenAI 在最后一个 chunk 返回）
            if (parsed.usage) {
              promptTokens = parsed.usage.prompt_tokens || 0
              completionTokens = parsed.usage.completion_tokens || 0
            }

            // 原样转发给客户端
            await stream.writeSSE({
              data: JSON.stringify(parsed),
              event: 'message',
            })
          } catch {
            // 解析失败，跳过
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  })
})

export default chat
```

关键点：

- **`stream_options: { include_usage: true }`**：让 OpenAI 在流式模式下也返回 token 用量。默认情况下，流式响应不包含 usage 信息，加了这个选项后，OpenAI 会在最后一个 chunk 里附带 token 统计

- **`c.executionCtx.waitUntil()`**：这是 Cloudflare Workers 特有的。正常情况下，响应一返回，Worker 就结束了。`waitUntil` 的意思是"响应先发回去，但 Worker 先别关，等这个 Promise 执行完再关"。这样用量记录就不会拖慢响应速度

- **buffer 拼接**：SSE 数据是一行一行的，但网络传输时不一定按行断开——可能一次 `read()` 拿到半行，也可能拿到两行半。所以要用 buffer 把碎片拼起来，按 `\n` 切分，最后没切完的留给下次

## 8. 用量查询接口

让客户端查看自己的 API Key 累计消耗了多少 token。

src/routes/usage.ts

```typescript
import { Hono } from 'hono'
import type { AppEnv, UsageRecord } from '../types'

const usage = new Hono<AppEnv>()

// 查询总用量
usage.get('/usage', async (c) => {
  const apiKeyId = c.get('apiKeyId')
  const record = await c.env.USAGE_KV.get<UsageRecord>(
    `usage:${apiKeyId}`,
    'json'
  )

  if (!record) {
    return c.json({
      totalRequests: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      lastUsedAt: null,
    })
  }

  return c.json(record)
})

// 查询某天的用量
usage.get('/usage/:date', async (c) => {
  const apiKeyId = c.get('apiKeyId')
  const date = c.req.param('date') // "2024-12-01"

  const record = await c.env.USAGE_KV.get<UsageRecord>(
    `usage:${apiKeyId}:${date}`,
    'json'
  )

  if (!record) {
    return c.json({
      date,
      totalRequests: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
    })
  }

  return c.json({ date, ...record })
})

// 查询最近 N 天的用量趋势
usage.get('/usage/trend/:days', async (c) => {
  const apiKeyId = c.get('apiKeyId')
  const days = parseInt(c.req.param('days')) || 7

  const trend = []
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.now() - i * 86400000)
      .toISOString()
      .slice(0, 10)
    const record = await c.env.USAGE_KV.get<UsageRecord>(
      `usage:${apiKeyId}:${date}`,
      'json'
    )
    trend.push({
      date,
      requests: record?.totalRequests || 0,
      promptTokens: record?.totalPromptTokens || 0,
      completionTokens: record?.totalCompletionTokens || 0,
    })
  }

  return c.json({ trend: trend.reverse() })
})

export default usage
```

## 9. 主入口

src/index.ts

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from './types'
import { authMiddleware } from './middleware/auth'
import { rateLimitMiddleware } from './middleware/rate-limit'
import chat from './routes/chat'
import usage from './routes/usage'

const app = new Hono<AppEnv>()

// 全局中间件
app.use('*', logger())
app.use('*', cors())

// 健康检查（不需要鉴权）
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() })
})

// API 路由（需要鉴权 + 限流）
const api = new Hono<AppEnv>()
api.use('*', authMiddleware)
api.use('*', rateLimitMiddleware)
api.route('/', chat)
api.route('/', usage)

app.route('/api', api)

// 全局错误处理
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json(
      { error: err.message },
      err.status
    )
  }

  console.error('Unexpected error:', err)
  return c.json({ error: 'Internal server error' }, 500)
})

// 404
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404)
})

export default app
```

这里有个写法值得说一下：`api.route('/', chat)` 和 `api.route('/', usage)` 都挂在 `/` 上，不会冲突吗？不会——`route('/', chat)` 的意思是"把 chat 里定义的路由原样挂过来"，chat 内部定义的是 `/v1/chat/completions`，usage 内部定义的是 `/usage` 和 `/usage/:date`。路径不同，自然不冲突。

`/health` 放在 `api` 外面，不经过鉴权和限流——这个接口是给监控系统调的，不应该需要 API Key。

最终的 API 路径：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /health | 健康检查 |
| POST | /api/v1/chat/completions | 流式/非流式代理 |
| GET | /api/usage | 查询总用量 |
| GET | /api/usage/:date | 查询某天用量 |
| GET | /api/usage/trend/:days | 查询用量趋势 |

## 10. 客户端调用示例

从客户端角度看，调这个网关和直接调 OpenAI 几乎一样，只是换了 URL 和 Key：

client.ts

```typescript
// 流式调用
async function chatStream(messages: Array<{ role: string; content: string }>) {
  const response = await fetch('https://your-gateway.workers.dev/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer gw-your-api-key',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages,
      stream: true,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error)
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') return

      const parsed = JSON.parse(data)
      const content = parsed.choices?.[0]?.delta?.content
      if (content) {
        process.stdout.write(content) // 逐字输出
      }
    }
  }
}

// 查看用量
async function getUsage() {
  const res = await fetch('https://your-gateway.workers.dev/api/usage', {
    headers: { 'Authorization': 'Bearer gw-your-api-key' },
  })
  return res.json()
}
```

## 11. 部署

terminal

```shellscript
# 设置真正的 API Key（不要写在 wrangler.jsonc 里）
wrangler secret put OPENAI_API_KEY

# 创建 KV namespace
wrangler kv namespace create RATE_LIMIT_KV
wrangler kv namespace create USAGE_KV
wrangler kv namespace create API_KEYS_KV

# 把 KV id 填到 wrangler.jsonc，然后部署
wrangler deploy
```

注册一个 API Key（用 wrangler 手动写入 KV）：

terminal

```shellscript
wrangler kv key put --binding=API_KEYS_KV \
  "key:gw-test-key-001" \
  '{"id":"user_001","name":"测试用户","rateLimit":60,"createdAt":1700000000000}'
```

## 12. 总结

这篇做了一个能实际用的 AI API 网关：鉴权用 KV 存 API Key，限流用 KV 做计数器，流式代理用 SSE 逐 chunk 转发，用量统计用 `waitUntil` 异步记录。

整个项目的套路和上一篇用户系统一样——中间件管横切逻辑，路由管业务逻辑，入口文件只管组装。区别在于这篇多了流式处理和 Workers 特有的 `waitUntil`，这两个在做 AI 相关的后端时会经常用到。
