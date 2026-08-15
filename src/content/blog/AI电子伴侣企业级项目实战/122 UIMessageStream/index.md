---
title: "122 UIMessageStream"
pubDate: 2026-05-19
description: "streamText 是 Core 层的主干函数，AI SDK 90% 的生产代码都绕不开它。这一篇把输入、输出、消费方式、UIMessageStream 协议这四件事一次讲透。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/7-stream-text/](https://aicompanion.usehook.cn/7-stream-text/)

## 1. 这一篇做什么

`streamText` 是 Core 层的主干函数，AI SDK 90% 的生产代码都绕不开它。这一篇把输入、输出、消费方式、UIMessageStream 协议这四件事一次讲透。

读完这一篇，你应该能答得上来：

- `result.textStream` / `result.fullStream` / `result.toUIMessageStreamResponse()` 三种消费方式各自适合什么场景

- UIMessageStream 里有哪些事件、每个事件什么时候出现

- 怎么在流上加拦截、改写、注入业务 data part

- 流的生命周期：开始、步骤、文本段、工具调用、完成、错误，以及每个节点怎么挂钩子

## 2. streamText 的完整签名

先看一次完整签名（精简了部分 provider 专属选项）：

stream-text-signature.ts

```typescript
const result = streamText({
  // ── 必填
  model: LanguageModelV2,

  // ── 消息输入（三选一）
  prompt?: string,
  system?: string,
  messages?: ModelMessage[],

  // ── 工具与 Agent 循环
  tools?: Record<string, Tool>,
  toolChoice?: 'auto' | 'required' | 'none' | { type: 'tool', toolName: string },
  stopWhen?: StopCondition | StopCondition[],

  // ── 生成参数
  temperature?: number,
  maxOutputTokens?: number,
  topP?: number,
  topK?: number,
  presencePenalty?: number,
  frequencyPenalty?: number,
  seed?: number,
  stopSequences?: string[],

  // ── 运行控制
  abortSignal?: AbortSignal,
  headers?: Record<string, string>,

  // ── 可观测性
  experimental_telemetry?: TelemetrySettings,

  // ── 生命周期钩子
  onChunk?: (event: { chunk: StreamPart }) => void | Promise<void>,
  onFinish?: (event: FinishEvent) => void | Promise<void>,
  onError?: (event: { error: unknown }) => void | Promise<void>,
  onStepFinish?: (event: StepResult) => void | Promise<void>,
  onAbort?: (event: { steps: StepResult[] }) => void | Promise<void>,

  // ── Provider 专属
  providerOptions?: Record<string, unknown>,
})
```

参数看着多，实际用起来绝大多数时候只会碰到 5 到 6 个。按使用频度排一下：

| 频度 | 参数 |
| --- | --- |
| 必用 | model, messages / prompt |
| 常用 | system, tools, stopWhen |
| 偶尔 | temperature, maxOutputTokens, abortSignal |
| 工程化用 | experimental_telemetry, onFinish, onError |
| 极少 | seed, stopSequences, topK, providerOptions |

## 3. 三种消费方式

`streamText` 同步返回 `result`，真正的流挂在 result 的字段上。有三种主要的消费方式。

### 3.1 textStream —— 只要字符串

最简单的场景：后端脚本、CLI 工具，只想逐 token 打印。

text-stream.ts

```typescript
const result = streamText({ model: models.chat, prompt: '...' })

for await (const chunk of result.textStream) {
  process.stdout.write(chunk)
}
```

`textStream` 是 `AsyncIterable<string>`，每个元素就是一段文本增量（delta），拼起来就是完整回复。

它的限制也很明显：只给你文本段，工具调用、思考段、完成事件都拿不到，所以只适合纯文本场景。另外这条流消费完就耗尽了，同一个 result 只能消费一次（[第一次调用](/3-setup-first-call) 也提到过）。如果需要同时拿文本和 token 用量，用 `fullStream`，或者先消费完再 `await result.text`。

### 3.2 fullStream —— 细粒度事件

想感知流里发生的每一件事，用 `fullStream`：

full-stream.ts

```typescript
const result = streamText({
  model: models.chat,
  messages,
  tools: { searchMemory },
  stopWhen: stepCountIs(5),
})

for await (const part of result.fullStream) {
  switch (part.type) {
    case 'text-delta':
      process.stdout.write(part.delta)
      break
    case 'reasoning-delta':
      console.log('[思考]', part.delta)
      break
    case 'tool-call':
      console.log('[工具调用]', part.toolName, part.input)
      break
    case 'tool-result':
      console.log('[工具结果]', part.output)
      break
    case 'finish':
      console.log('[完成]', part.finishReason, part.usage)
      break
    case 'error':
      console.error('[错误]', part.error)
      break
  }
}
```

`fullStream` 的完整事件类型：

| 事件 type | 含义 |
| --- | --- |
| start | 整个流开始 |
| start-step | 一次 LLM 调用开始（一次 step） |
| text-start / text-delta / text-end | 文本段开始 / 增量 / 结束 |
| reasoning-start / reasoning-delta / reasoning-end | 思考段开始 / 增量 / 结束 |
| tool-call | 工具调用完成（参数已就绪） |
| tool-call-input-start / tool-call-input-delta | 工具参数流式构造（参数也是流式的） |
| tool-result | 工具执行结果 |
| source | 引用来源（RAG / Web Search） |
| file | 文件输出（图像 / 音频） |
| finish-step | 一次 step 结束 |
| finish | 整个流结束（含总 token、finishReason） |
| error | 错误 |
| abort | 用户中止 |

一般用在后端内部监控、埋点，或者把流转发到其他协议。

### 3.3 toUIMessageStreamResponse —— 给前端用

生产环境最常见的消费方式：把流直接返回给前端。

to-response.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

app.post('/api/chat', async (c) => {
  const { messages } = await c.req.json()

  const result = streamText({
    model: models.chat,
    messages: convertToModelMessages(messages),
    tools: { searchMemory, updateEmotion },
  })

  return result.toUIMessageStreamResponse()
})
```

`toUIMessageStreamResponse()` 干了三件事：

- 把 `fullStream` 按 UIMessageStream 协议序列化成 SSE 格式

- 设置正确的 `Content-Type: text/event-stream` 和 CORS 头

- 返回一个标准 `Response` 对象，Hono / Next.js Route Handler 直接 `return` 就行

前端用 `useChat` 消费时，内部协议就是这个。换句话说，后端只要调 `toUIMessageStreamResponse()`，前端 `useChat` 就能直接用。

## 4. UIMessageStream 协议完整对照

把 UIMessageStream 协议拆开来看。下面是一条典型的 SSE 流：

uimessage-stream-raw.txt

```text
data: {"type":"start"}

data: {"type":"start-step"}

data: {"type":"reasoning-start","id":"r_0"}

data: {"type":"reasoning-delta","id":"r_0","delta":"用户问"}

data: {"type":"reasoning-delta","id":"r_0","delta":"了过去"}

data: {"type":"reasoning-end","id":"r_0"}

data: {"type":"tool-input-start","toolCallId":"c_1","toolName":"searchMemory"}

data: {"type":"tool-input-delta","toolCallId":"c_1","inputTextDelta":"{\"query\":"}

data: {"type":"tool-input-delta","toolCallId":"c_1","inputTextDelta":"\"周五\"}"}

data: {"type":"tool-input-available","toolCallId":"c_1","toolName":"searchMemory","input":{"query":"周五"}}

data: {"type":"tool-output-available","toolCallId":"c_1","output":[{"content":"..."}]}

data: {"type":"finish-step"}

data: {"type":"start-step"}

data: {"type":"text-start","id":"t_1"}

data: {"type":"text-delta","id":"t_1","delta":"我记得"}

data: {"type":"text-delta","id":"t_1","delta":"你周五"}

data: {"type":"text-end","id":"t_1"}

data: {"type":"finish-step"}

data: {"type":"finish"}

data: [DONE]
```

这条流讲了一个故事：

- 流开始

- 第一次 step：思考 → 调用 `searchMemory` → 拿到结果

- 第二次 step：生成文本回复

- 流结束

## 5. 注入业务数据：Data Parts

业务层经常要给前端发一些非文本信息：情绪分值、亲密度变化、检索命中条数等等。UIMessageStream 用 data part 承载这些：

data-part-server.ts

```typescript
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'

const stream = createUIMessageStream({
  execute: async ({ writer }) => {
    // 先发一个业务数据：当前情绪
    writer.write({
      type: 'data-emotion',
      data: { primary: 'calm', intensity: 0.6 },
    })

    // 再调 LLM，把流合并进来
    const result = streamText({ model: models.chat, messages })
    writer.merge(result.toUIMessageStream())

    // 最后再发一个业务数据：本次用到的记忆条数
    writer.write({
      type: 'data-memories-used',
      data: { count: 3 },
    })
  },
})

return createUIMessageStreamResponse({ stream })
```

前端消费：

data-part-client.tsx

```tsx
const { messages } = useChat()

messages.map((m) => m.parts.map((p, i) => {
  if (p.type === 'data-emotion') {
    return <EmotionBadge key={i} data={p.data} />
  }
  if (p.type === 'data-memories-used') {
    return <MemoriesHint key={i} count={p.data.count} />
  }
  // ... 其他 part
}))
```

Data Parts 是 AI SDK 里做业务定制 UI 的主要手段：既不破坏协议，又保留类型安全（给 UIMessage 泛型传业务 data 类型就行），还能在 React 里自然渲染。

## 6. 生命周期钩子

除了流式消费，`streamText` 还支持一组回调钩子，用来做服务端副作用：

lifecycle-hooks.ts

```typescript
streamText({
  model: models.chat,
  messages,
  tools: { searchMemory },

  // 每次收到一个流片段（text-delta / tool-call / reasoning-delta 等）
  onChunk: async ({ chunk }) => {
    if (chunk.type === 'text-delta') {
      metrics.incrementTokens(chunk.delta.length)
    }
  },

  // 每个 step 结束（一次 LLM 调用完成）
  onStepFinish: async (step) => {
    console.log('[step]', step.finishReason, step.usage)
  },

  // 全流结束
  onFinish: async ({ text, finishReason, usage, response }) => {
    await saveMessage(sessionId, { role: 'assistant', content: text })
    await trackUsage(sessionId, usage)
  },

  // 出错
  onError: async ({ error }) => {
    logger.error('chat error', { error, sessionId })
  },

  // 用户中止
  onAbort: async ({ steps }) => {
    console.log('用户中止，已完成', steps.length, '步')
  },
})
```

`onFinish` 才是你做持久化的地方。不要在 `toUIMessageStreamResponse()` 之后 `await` 什么事——那时候流已经返回给客户端了，你的 `await` 会挂起请求但对用户没有任何意义。`onFinish` 在流真正结束之后异步触发，是写数据库、发埋点、累计计费的最佳时机。

在 Cloudflare Workers 上，`onFinish` 的 `await` 一定要放在 `ctx.waitUntil()` 里，否则 Worker 可能在回调跑完之前就终止了：

workers-wait-until.ts

```typescript
app.post('/chat', async (c) => {
  const result = streamText({
    model: models.chat,
    messages,
    onFinish: ({ text }) => {
      // ctx.waitUntil 允许 Worker 等这个异步任务完成
      c.executionCtx.waitUntil(saveMessage(sessionId, text))
    },
  })

  return result.toUIMessageStreamResponse()
})
```

## 7. Abort、中止与运行时差异

用户点「停止生成」按钮时，前端 `useChat` 会调 `stop()` 方法——底层就是 `AbortController.abort()`。后端要响应这个信号，把 `abortSignal` 传进 `streamText`：

abort.ts

```typescript
app.post('/chat', async (c) => {
  const result = streamText({
    model: models.chat,
    messages,
    // 把 HTTP 请求的 abortSignal 往下传
    abortSignal: c.req.raw.signal,
  })

  return result.toUIMessageStreamResponse()
})
```

这样浏览器或中间代理一断开连接，AbortSignal 就会触发，Provider 会立刻停止向 LLM API 读流，省下剩下的 token。

`onAbort` 回调也会被触发，方便清理或记录：

on-abort.ts

```typescript
streamText({
  model: models.chat,
  messages,
  abortSignal: c.req.raw.signal,
  onAbort: async ({ steps }) => {
    const partialText = steps.map((s) => s.text).join('')
    await saveMessage(sessionId, { role: 'assistant', content: partialText, status: 'aborted' })
  },
})
```

### Node 与 Edge 的差异

`streamText` 本身是运行时无关的，但部署到不同环境有些细节要注意。核心差异在于：Edge 类环境（Workers / Vercel Edge）的请求处理函数一旦返回 Response，运行时可能立刻回收资源，导致 `onFinish` 里的异步操作被中断。

按运行时梳理一下注意事项：

| 环境 | 注意点 |
| --- | --- |
| Node.js | 标准 fetch 可用（Node 18+），onFinish 里 await 自由使用 |
| Cloudflare Workers | onFinish 的 async 副作用必须 ctx.waitUntil()，否则可能被提前杀 |
| Vercel Edge Functions | 类似 Workers，用 event.waitUntil() |
| Next.js Route Handler（Node runtime） | 直接用，没特殊限制 |
| Next.js Route Handler（Edge runtime） | 同 Edge Functions |
| Bun / Deno | 同 Node，但某些 Provider 可能有兼容 issue（社区 issue 跟进） |

本专栏 AI 伴侣的主路径是 Cloudflare Workers，[AI SDK × Hono](/15-ai-sdk-with-hono) 会具体讲部署注意事项。

## 8. 小结

- `streamText` 是 Core 层主干，三种消费方式：`textStream`（纯字符串）、`fullStream`（细粒度事件）、`toUIMessageStreamResponse()`（给前端）

- UIMessageStream 协议把原始 SSE 升级成了结构化事件流，`text` / `reasoning` / `tool-*` / `source` / `file` / `data-*` 每种都有完整生命周期

- Data Parts 通过 `createUIMessageStream` + `writer.write()` 注入业务数据，前端按 `type` 分别渲染

- 生命周期钩子 `onFinish` / `onError` / `onStepFinish` / `onAbort` 是做持久化、埋点、清理的标准位置

- Abort 信号把 HTTP 请求的 `signal` 传进 `streamText`，就能正确处理用户中止

- 运行时差异：Workers / Edge 要用 `ctx.waitUntil()` 保护 `onFinish` 的异步副作用

下一篇进入 Core 层的另一个主力函数——**`generateObject` / `streamObject`**。Zod schema 驱动的结构化输出，对照 [Zod + LLM](/13-zod-with-llm) 做一次升级。
