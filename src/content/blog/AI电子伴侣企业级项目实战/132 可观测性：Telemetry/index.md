---
title: "132 可观测性：Telemetry"
pubDate: 2026-05-23
description: "Latency breakdown：queue 时间 / prompt 传输 / 首字节 / 总时长"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/17-observability/](https://aicompanion.usehook.cn/17-observability/)

## 1. 为什么 AI 应用的可观测性特殊

传统应用的可观测性关注的是：CPU、内存、QPS、延迟、错误率。

AI 应用多出来的维度是：

- Token 用量：成本的直接来源

- Prompt 版本：每次调用用的是哪一版

- 模型：主 Provider 还是 Fallback Provider

- Latency breakdown：queue 时间 / prompt 传输 / 首字节 / 总时长

- 工具调用链：调了几个 tool、每个耗时多少

- 步数：Agent 循环跑了几 step

- 错误分类：超时 / Provider 错 / schema 不匹配 / 工具失败

- 回答质量：用户有没有点赞或点踩、有没有继续追问

没有这些维度，你无法回答几个关键问题：「为什么本周成本涨了 30%？」「为什么部分用户投诉卡顿？」「为什么 Claude 的回复比 OpenAI 多 40% 的失败？」

AI SDK 内置了 OpenTelemetry 支持，配合 Langfuse / Helicone / 自建 OTel collector，就能把这些维度打通。

## 2. experimental_telemetry：最小接入

给每个 `streamText` / `generateText` / `generateObject` 调用传一个 `experimental_telemetry`：

telemetry-basic.ts

```typescript
const result = streamText({
  model: models.chat,
  messages,
  tools,
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'companion-chat',          // 这次调用的语义标签
    metadata: {
      sessionId: 'sess_123',
      userId: 'user_456',
      intimacy: 0.7,
      'prompt.version': 'v1.3',
      'prompt.name': 'companion',
    },
  },
})
```

`experimental_telemetry` 打开后，AI SDK 会为这次调用产出一条 OpenTelemetry trace，里面包含：

- `ai.operationId`：`ai.generateText` / `ai.streamText` 等

- `ai.model.provider` / `ai.model.id`

- `ai.usage.inputTokens` / `ai.usage.outputTokens`

- `ai.response.finishReason`

- `ai.prompt.messages`（完整消息，隐私要求严的话可以关掉）

- `ai.response.text` 或 `ai.response.object`

- `ai.toolCalls[]`：每个工具调用的名称、参数、结果

- 你传进去的 `metadata` 全部附带

## 3. 接入 OpenTelemetry

接 OpenTelemetry 需要一个 provider 加一个 exporter。

### 3.1 Node 环境

index.bash

```shellscript
pnpm add @vercel/otel @opentelemetry/sdk-trace-node \
  @opentelemetry/exporter-trace-otlp-http
```

otel-node.ts

```typescript
import { registerOTel } from '@vercel/otel'

registerOTel({
  serviceName: 'ai-companion-api',
  traceExporter: {
    url: process.env.OTEL_ENDPOINT!,
    headers: { Authorization: `Bearer ${process.env.OTEL_TOKEN}` },
  },
})
```

这是 Vercel 官方推荐的最简接法，一次 `registerOTel` 就把 SDK 装好了。

### 3.2 Cloudflare Workers 环境

Workers 上的 OTel 支持不如 Node 成熟。几种主流方案：

- 手写一段 fetch 把 span 批量 POST 到 collector

- 用 `@cloudflare/otel` 或社区包（生态还在发展，用之前看最新状态）

- 或者干脆不用 OTel，直接接 Langfuse SDK（下一节讲）

Workers 上折中的推荐就是用 Langfuse。它有轻量 JS SDK，Workers 环境里原生跑得顺。

## 4. 接入 Langfuse

Langfuse 是对 AI SDK 最友好的可观测性平台之一，它天生理解 AI SDK 的 telemetry 事件。

### 4.1 安装

index.bash

```shellscript
pnpm add langfuse-vercel
```

### 4.2 接入

langfuse-setup.ts

```typescript
import { LangfuseExporter } from 'langfuse-vercel'
import { registerOTel } from '@vercel/otel'

registerOTel({
  serviceName: 'ai-companion',
  traceExporter: new LangfuseExporter({
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
    baseUrl: 'https://cloud.langfuse.com',
  }),
})
```

然后业务里所有 `streamText` 继续按第 2 节传 `experimental_telemetry` 就行。Langfuse 面板上会自动出现一条条 trace，包含：

- 完整 prompt / response / tool calls

- Token 用量和成本

- Latency 分布

- 你自定义的 `metadata` 可以做维度切分

### 4.3 Workers 上的 Langfuse

Langfuse 在 Workers 上可以直接用 `langfuse` 纯 JS SDK（绕开 OTel）：

langfuse-workers.ts

```typescript
import { Langfuse } from 'langfuse'

function getLangfuse(env: Env) {
  return new Langfuse({
    secretKey: env.LANGFUSE_SECRET_KEY,
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    baseUrl: 'https://cloud.langfuse.com',
  })
}

// 在 handler 里
app.post('/chat', async (c) => {
  const langfuse = getLangfuse(c.env)
  const trace = langfuse.trace({
    name: 'companion-chat',
    userId: 'user_456',
    sessionId: 'sess_123',
  })

  const generation = trace.generation({
    name: 'main-reply',
    model: 'gpt-4o',
    input: messages,
  })

  const result = streamText({
    model: models.chat,
    messages,
    onFinish: ({ text, usage }) => {
      generation.end({
        output: text,
        usage: {
          input: usage.inputTokens,
          output: usage.outputTokens,
        },
      })
      c.executionCtx.waitUntil(langfuse.flushAsync())
    },
  })

  return result.toUIMessageStreamResponse()
})
```

一个关键点：Workers 生命周期短，`langfuse.flushAsync()` 必须放在 `ctx.waitUntil` 里跑，否则事件可能还没发出去就被回收了。

## 5. 关键的可观测指标

不是所有指标都值得盯。AI 伴侣项目实际会看的几个维度列在下面，先读一遍全貌，再按自己项目挑重点：

| 维度 | 指标 | 说明 |
| --- | --- | --- |
| 成本 | 每日/每小时 token 消耗 | 分 input / output |
| 成本 | 每用户 token 消耗 | 识别滥用 |
| 成本 | 每 prompt 版本 token 消耗 | 版本变化带来的涨跌 |
| 成本 | 每 Provider token 消耗 | 主 / Fallback 比例 |
| 延迟 | TTFT（Time-to-first-token） | 用户按发送到看到第一个字，看 50th / 95th / 99th |
| 延迟 | 总响应时长 | TTFT + stream 时长 |
| 延迟 | Tool 调用耗时 | 每个 tool 的分布 |
| 延迟 | Step 数分布 | Agent 跑了几步 |
| 稳定性 | 错误率 | 按类型分：APICallError / NoObjectGeneratedError / ToolExecutionError |
| 稳定性 | Fallback 触发率 | Fallback 被调用的比例 |
| 稳定性 | Retry 次数分布 | 重试 2 次以上的调用占比 |
| 稳定性 | Abort 率 | 用户主动停止的比例 |
| 质量 | 回复长度分布 | 异常长 / 异常短 |
| 质量 | Tool 调用成功率 | 调了工具但最后回复没用到的比例 |
| 质量 | 用户反馈 | 点赞 / 点踩 / 追问（需要前端埋点） |
| 质量 | 重生成比例 | 回复被编辑 / 重新生成 |

## 6. Prompt 版本打通

[Prompt 工程 × AI SDK](/6-prompts-in-ai-sdk) 我们给 Prompt 管理定了规则：独立包、版本号、纯函数。把版本号接到 telemetry：

prompt-version.ts

```typescript
import { buildCompanionPrompt, COMPANION_PROMPT_VERSION } from '@/prompts/companion'

const system = buildCompanionPrompt(ctx)

const result = streamText({
  model,
  system,
  messages,
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'companion-chat',
    metadata: {
      'prompt.name': 'companion',
      'prompt.version': COMPANION_PROMPT_VERSION,
      // 加上 ctx 里的几个关键业务维度
      'prompt.context.intimacy': ctx.intimacy,
      'prompt.context.memoriesCount': ctx.memories.length,
    },
  },
})
```

这样在 Langfuse 或自建 BI 里就能按 prompt 版本切分指标，看清「我改了 v1.2 → v1.3 之后 token 涨了 20%，满意度降了 10%」这种问题。

## 7. 扩展追踪：自定义 span 与前端埋点

### 7.1 Tool 内部的细粒度追踪

AI SDK 自动记录 tool 调用，但 tool 内部的执行细节需要你自己加 span。

OpenTelemetry 风格：

tool-span.ts

```typescript
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('ai-companion-tools')

const searchMemory = tool({
  description: '...',
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    return await tracer.startActiveSpan('searchMemory', async (span) => {
      span.setAttribute('query.length', query.length)

      try {
        const embedding = await embed(query)
        span.addEvent('embed.done')

        const results = await env.VECTORIZE.query(embedding, { topK: 3 })
        span.setAttribute('results.count', results.matches.length)

        return results.matches.map((m) => m.metadata)
      } finally {
        span.end()
      }
    })
  },
})
```

`embed.done` 这种 event 让你在 trace 视图里看到「embed 走了 120ms、vector 查询走了 60ms」的分段。

### 7.2 前端埋点

用户在 UI 里的行为，后端没法主动知道。前端埋点把这些信号打进同一个 session ID：

feedback-track.tsx

```tsx
'use client'
import { useChat } from '@ai-sdk/react'

function Chat() {
  const { messages } = useChat({ ... })

  function handleThumbsUp(messageId: string) {
    fetch('/api/track', {
      method: 'POST',
      body: JSON.stringify({
        type: 'feedback',
        messageId,
        value: 'up',
        sessionId: getSessionId(),
      }),
    })
  }

  // ... UI 里挂按钮 onClick={() => handleThumbsUp(m.id)}
}
```

后端 `/api/track` 把事件写进 Langfuse 的 `trace.score()` 或自建数据库。在分析视图里就能把「用户满意度」挂到具体的 session 和 prompt 版本上。

## 8. 仪表盘与成本控制

### 8.1 最小可用看板

适合 AI 伴侣项目的一个「三维看板」：

成本看板：

- 本日 token 消耗（总 / 分 input、output / 分 Provider）

- 本日 token 消耗同比（vs 上周同一天）

- Top 10 高消耗用户（识别滥用）

- 按 prompt 版本的消耗分布

稳定性看板：

- 错误率（整体 + 分 Provider）

- Fallback 触发次数 / 小时

- 平均重试次数

- TTFT 95 分位曲线（24 小时）

质量看板：

- 回复点赞 / 点踩比例

- 平均对话轮数

- Tool 调用成功率

- Agent 平均 step 数

Langfuse 提供了大部分开箱即用的视图；更定制的指标用 `trace.score()` + 自建 Dashboard（比如 Grafana）。

### 8.2 成本控制的实战心得

几条来自生产环境的教训。

不可观测就不可控。刚上线没埋点，一周后月账单爆炸是常态。哪怕是最粗糙的 Langfuse 接入，也比不接强一百倍。

Fallback 不是免费的。主 Provider 挂了切 Fallback，Fallback 可能更贵。监控 Fallback 触发率，超过 5% 就要排查。

Tool 的失败同样要盯。Tool 失败后 LLM 经常会「反复重试同样工具」，消耗几倍 token。在 telemetry 里看到 tool 调用 > 3 次的 trace 就该报警。

长尾消耗者决定成本。99% 的用户 token 消耗很低，1% 的超重度用户能占掉 50% 成本。对这些用户要么限流要么差异化计费。

Prompt 改动必须小步验证。不要一次同时改 prompt + 模型 + 工具。改动多了出问题只能整体回滚，定位不到是哪一步。

## 9. 小结

- AI 应用的可观测性多出「token / prompt 版本 / 工具链 / 步数 / 质量」等维度

- `experimental_telemetry` 是每个 AI SDK 调用的标准埋点入口

- Node 环境用 OTel + `@vercel/otel`；Workers 用 Langfuse SDK + `ctx.waitUntil`

- Langfuse 对 AI SDK 最友好，用 `LangfuseExporter` 自动处理；也可以用纯 JS SDK 在 Workers 里手动打点

- Tool 内部加自定义 span 追踪细粒度延迟

- 前端埋点把用户反馈接回同一个 trace

- 仪表盘三维：成本 / 稳定性 / 质量

- 实战教训：尽早接入、关注 Fallback 成本、警报长尾消耗者

后端三连到此结束。下一篇进入**协同三连**——[**MCP 客户端**](/18-mcp-client)。把 Model Context Protocol 工具接进 AI SDK 的 `tool()`。
