---
title: "130 AI SDK × Hono"
pubDate: 2026-05-22
description: "AI 伴侣的后端真实部署目标是 Cloudflare Workers。前面所有示例里 app.post'/chat', ... 写得很自然，但要把它真正跑在 Workers 上、跑稳、跑快、跑准确，有不少 Workers 特有的坑。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/15-ai-sdk-with-hono/](https://aicompanion.usehook.cn/15-ai-sdk-with-hono/)

## 1. 为什么这一篇重要

AI 伴侣的后端真实部署目标是 Cloudflare Workers。前面所有示例里 `app.post('/chat', ...)` 写得很自然，但要把它真正跑在 Workers 上、跑稳、跑快、跑准确，有不少 Workers 特有的坑。

这一篇把 AI SDK 在 Workers 上的工程细节一次打通：

- `wrangler.toml` / `wrangler.jsonc` 怎么配

- `env` 绑定怎么在 Hono 里拿到

- 流式响应在 Workers 上的 `ctx.waitUntil` 和 `fetch` 限制

- `abortSignal` 在 Workers 的注意事项

- 可恢复流（resumable stream）配合 KV 实现

- Node 适配器 vs 原生 Workers 的取舍

读完这一篇，[重构端到端 AI Chat](/21-practice-end-to-end) 才能真正把端到端跑通。

## 2. 项目骨架与 Env 类型化

### 2.1 依赖与 wrangler 配置

先把依赖列齐：

index.bash

```shellscript
pnpm add hono ai zod
pnpm add -D wrangler @cloudflare/workers-types
```

`wrangler.jsonc`：

wrangler.jsonc

```jsonc
{
  "name": "ai-companion-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "compatibility_flags": ["nodejs_compat"],
  "ai": {
    "binding": "AI"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "companion",
      "database_id": "xxx"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "xxx"
    }
  ],
  "vectorize": [
    {
      "binding": "VECTORIZE",
      "index_name": "companion-memories"
    }
  ],
  "vars": {
    "LOG_LEVEL": "info"
  }
}
```

配置里几个关键点：

- `compatibility_flags = ["nodejs_compat"]` 很重要。部分 AI SDK Provider（尤其是 `@ai-sdk/openai`）内部会用到 `node:crypto` 这类 Node API

- 所有 binding（AI、DB、KV、Vectorize）都通过 `env` 在 Hono handler 里访问

- API Key 要用 `wrangler secret put` 配置，不要提交到 git

### 2.2 Env 类型化

给 Hono 一个强类型 `env`，开发体验立刻不一样：

bindings.ts

```typescript
export interface Env {
  AI: Ai
  DB: D1Database
  KV: KVNamespace
  VECTORIZE: VectorizeIndex
  OPENAI_API_KEY: string
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error'
}

// 给 Hono 用
declare module 'hono' {
  interface ContextVariableMap {
    sessionId: string
  }
}

export type AppBindings = { Bindings: Env }
```

用起来：

app.ts

```typescript
import { Hono } from 'hono'
import type { AppBindings } from './bindings'

const app = new Hono<AppBindings>()

app.post('/chat', async (c) => {
  // c.env 是 Env 类型，有完整补全
  const db = c.env.DB
  // ...
})

export default app
```

## 3. 最简 /chat 接口

把前面所有知识点组合成一个可用的 `/chat` 接口：

routes/chat.ts

```typescript
import { Hono } from 'hono'
import { streamText, convertToModelMessages } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { AppBindings } from '../bindings'
import { createCompanionTools } from '../tools'
import { buildSystemPrompt } from '@shared/prompts/companion'

const chatRoute = new Hono<AppBindings>()

chatRoute.post('/chat', async (c) => {
  const { messages, sessionId } = await c.req.json()

  // 1. 构造 model（这里按环境选 Provider）
  const openai = createOpenAI({ apiKey: c.env.OPENAI_API_KEY })
  const model = openai('gpt-4o')

  // 2. 读会话上下文（情绪、记忆）
  const [userProfile, memories] = await Promise.all([
    loadUserProfile(c.env.DB, sessionId),
    searchMemories(c.env.VECTORIZE, sessionId, messages),
  ])

  // 3. 组装 system prompt
  const system = buildSystemPrompt({
    userNickname: userProfile.nickname,
    personalityTags: userProfile.tags,
    intimacy: userProfile.intimacy,
    recentEmotions: userProfile.recentEmotions,
    memories,
    currentTime: new Date().toISOString(),
  })

  // 4. streamText
  const result = streamText({
    model,
    system,
    messages: convertToModelMessages(messages),
    tools: createCompanionTools(c.env, sessionId),
    stopWhen: stepCountIs(5),
    abortSignal: c.req.raw.signal,

    onFinish: ({ text, usage }) => {
      // 持久化要靠 ctx.waitUntil
      c.executionCtx.waitUntil(
        Promise.all([
          saveMessage(c.env.DB, sessionId, 'assistant', text),
          trackUsage(c.env.DB, sessionId, usage),
        ]),
      )
    },

    experimental_telemetry: {
      isEnabled: true,
      metadata: { sessionId, userId: userProfile.id },
    },
  })

  return result.toUIMessageStreamResponse()
})

export default chatRoute
```

这里把前面学到的能力全组合起来了：system prompt 构造（[Prompt 工程 × AI SDK](/6-prompts-in-ai-sdk)）、`convertToModelMessages`（[消息协议](/5-message-protocol)）、tools + Agent 循环（[Tool Calling](/9-tool-calling) + [多步推理](/10-multi-step-agent)）、`abortSignal` + `onFinish`（[UIMessageStream](/7-stream-text)）、telemetry（[可观测性：Telemetry](/17-observability) 会讲）。

## 4. Workers 特有的注意事项

### 4.1 ctx.waitUntil 的必要性

Workers 是 event-driven / serverless 的模型。一个请求处理完，Worker 实例可能立刻就被回收。如果你在 `onFinish` 里有异步任务（写库、发埋点），不把它们塞进 `ctx.waitUntil`，它们很可能在执行到一半就被杀掉。

正确的写法：

wait-until.ts

```typescript
onFinish: ({ text }) => {
  c.executionCtx.waitUntil(saveMessage(c.env.DB, sessionId, text))
  c.executionCtx.waitUntil(trackUsage(c.env.DB, sessionId, usage))
}
```

`waitUntil` 的作用是告诉 Workers runtime：「即使请求已经返回，也请等这个 Promise 完成再回收我。」

一个很典型的坑：`onFinish` 里写了 `await` 但没放 `waitUntil`，本地 `wrangler dev` 一切正常，线上偶发「消息没落库」——查不到原因的那种。

### 4.2 流式响应与 Workers 的单 CPU 限制

Workers 默认每次请求 50ms CPU 时间（Free plan）。流式响应期间 Worker 主要在等 LLM 的 chunk，这部分属于 IO 等待，不算 CPU 时间，所以通常撞不了限。但如果你在 `onChunk` 里做了重计算（正则、分词、大对象操作），就很容易超。

几个建议：

- `onChunk` 里只做最轻量的统计（累加 token）

- 复杂分析放 `onFinish` + `ctx.waitUntil` 异步做

- 要更宽松的 CPU 限制，升级 Workers Paid（30s）或 Workers Unbound（5m）

### 4.3 fetch 并发限制

同一个 Worker 实例最多同时 6 个 subrequest（免费）或 50 个（Paid）。AI SDK 的 LLM 调用算一个 subrequest，tools 里再 fetch 就是第二个。如果你在一个 tool 里并行查 10 个外部接口，会直接撞限。

缓解办法：tool 内的并行 fetch 自己做限流（用 `p-limit` 之类的工具）。

### 4.4 Durable Objects 才能做真正的「长连接」

如果你要做上千个用户并发的稳定 chat 服务，Workers 本身的流式模型够用。但如果要做「多人同时聊天、服务端主动推送」这种场景，就需要 Durable Objects。本专栏 Hono 的 [Durable Objects 与 WebSocket](/22-durable-objects-websocket) 有专题，本章不展开。

## 5. 可恢复流（Resumable Stream）

手机切后台、网络不稳定——浏览器断开连接，流就中断了。用户看到半截回复，再次打开又看不到完整内容。

AI SDK 提供了 `createResumableStreamContext` 配合 Redis / KV 实现「流被持久化，客户端断线重连能续上」。

实现思路：

resumable.ts

```typescript
import { createResumableStreamContext } from 'resumable-stream'

const streamContext = createResumableStreamContext({
  async loadStream(id) {
    const data = await c.env.KV.get(`stream:${id}`)
    return data ? JSON.parse(data) : null
  },
  async saveStream(id, chunks) {
    await c.env.KV.put(`stream:${id}`, JSON.stringify(chunks), {
      expirationTtl: 600, // 10 分钟
    })
  },
})

// 在 /chat 里
chatRoute.post('/chat', async (c) => {
  const streamId = crypto.randomUUID()

  const result = streamText({...})

  // 把流 pipe 进 resumable context
  const resumable = streamContext.wrap(result.toUIMessageStream(), streamId)

  return new Response(resumable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'X-Stream-Id': streamId,
    },
  })
})

// 断线重连
chatRoute.get('/chat/resume/:id', async (c) => {
  const streamId = c.req.param('id')
  const stream = await streamContext.resume(streamId)
  if (!stream) return c.text('stream expired', 410)
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
})
```

前端配合 `useChat` 的 `resumeStream()` 调 `/chat/resume/:id` 就行。[重构端到端 AI Chat](/21-practice-end-to-end) 会把这段真正跑起来。

## 6. Abort Signal 的端到端传递

用户点「停止生成」→ 前端 `stop()` → HTTP 连接 abort → Workers 感知 → `streamText` 感知 → LLM 调用 abort。

链路上每一环都要把 signal 传下去：

abort-chain.ts

```typescript
chatRoute.post('/chat', async (c) => {
  const signal = c.req.raw.signal // ← 起点

  const result = streamText({
    model,
    messages,
    abortSignal: signal,          // ← 传给 SDK

    onAbort: ({ steps }) => {
      c.executionCtx.waitUntil(
        saveMessage(c.env.DB, sessionId, {
          role: 'assistant',
          content: steps.map((s) => s.text).join(''),
          status: 'aborted',
        }),
      )
    },

    // tool 里如果有 fetch，也要传 signal
    tools: {
      searchWeb: tool({
        description: '...',
        inputSchema: z.object({ q: z.string() }),
        execute: async ({ q }, { abortSignal }) => {
          const resp = await fetch(`https://search.com?q=${q}`, { signal: abortSignal })
          return await resp.json()
        },
      }),
    },
  })

  return result.toUIMessageStreamResponse()
})
```

AI SDK 会把 `streamText` 的 abortSignal 作为 `execute` 的第二个参数传给 tool，tool 内再继续往下传。这样从前端点击到 LLM 停止生成，全链路不超过 200ms。

## 7. 本地开发与部署

### 7.1 wrangler dev 的注意点

`wrangler dev` 和生产有几处细微差异：

| 维度 | wrangler dev 本地 | 生产 |
| --- | --- | --- |
| CPU 时间限制 | 默认 50ms / Paid 30s | 生产一致 |
| fetch 并发 | 宽松 | 严格 |
| ctx.waitUntil | 大多数情况生效，偶有 bug | 生效 |
| Workers AI binding | 本地实际调线上 | 调线上 |
| D1 / KV | 本地 SQLite / 文件 | 生产 |

几条经验：

- 能用真实 Workers AI 就别用 OpenAI 替身（带 fake key 会报错）

- `wrangler dev --remote` 模式完全在线上跑，性能和行为最接近生产

- 日志用 `console.log` 就行，`wrangler tail` 能看生产日志

### 7.2 部署

把 `/chat` 接口部署上线：

index.bash

```shellscript
# 设置 secret
wrangler secret put OPENAI_API_KEY

# 部署
wrangler deploy
```

部署后 Workers 会分配一个 `.workers.dev` 域名；配 Custom Domain 就能接自己的域。

CI 集成（GitHub Actions）：

.github/workflows/deploy.yml

```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: pnpm install
      - run: pnpm build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          command: deploy
```

本专栏 4.monorepo 的 [CI/CD 集成](/14-ci-cd-and-env-management) 讲过 CI/CD 配置的完整细节。

## 8. Node 适配 vs 原生 Workers：什么时候用

有时候你会看到社区代码里用 `@hono/node-server` 把 Hono 跑在 Node.js 上。什么时候这么做：

| 场景 | 选择 |
| --- | --- |
| Cloudflare Workers 部署 | 原生 Workers，不用 node-server |
| Vercel Edge Functions | 原生，和 Workers 类似 |
| 自建服务器 / VPS | Node.js + @hono/node-server |
| Serverless（AWS Lambda / 阿里云 FC） | 看平台，大部分用原生 Web API |
| 本地调试想用 Node 调试器 | @hono/node-server |

AI 伴侣项目主线走的是原生 Workers。只有在写内部脚本（数据迁移、批处理）时才会切 Node。

## 9. 小结

- `wrangler.toml` + binding 是 Workers 项目的骨架；secret 必须用 `wrangler secret put`

- Env 类型化给 Hono 体验加成很多

- `ctx.waitUntil` 是 Workers 异步副作用的命脉，`onFinish` / `onAbort` 里的 await 必须套上

- 可恢复流配合 KV / Redis + `resumable-stream` 库实现，断线重连不丢流

- AbortSignal 链路：`c.req.raw.signal` → `streamText.abortSignal` → `tool.execute(_, { abortSignal })`

- `wrangler dev --remote` 是最接近生产的本地调试

- 原生 Workers 是本专栏主线；`@hono/node-server` 只在需要 Node 环境时用

下一篇进入**中间件**，用 `wrapLanguageModel` 给模型层加上缓存、限流、Fallback Provider、retry 这些工业级能力。
