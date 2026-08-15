---
title: "117 三层架构"
pubDate: 2026-05-18
description: "上一篇我们给 Vercel AI SDK 下了一个定义：面向 TypeScript/React 生态的 AI 应用工具链，提供从模型调用到前端 UI 的整条链路。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/2-three-layer-architecture/](https://aicompanion.usehook.cn/2-three-layer-architecture/)

## 1. 为什么要先看架构

上一篇我们给 Vercel AI SDK 下了一个定义：**面向 TypeScript/React 生态的 AI 应用工具链，提供从模型调用到前端 UI 的整条链路**。

但「一条链路」只是使用者的感受。真正决定它好不好用的，是这条链路在内部是怎么切的。

Vercel AI SDK 把整条链路切成了三段，每一段只管自己的事：

- **Provider 层**——负责和具体的大模型说话，比如 OpenAI、Anthropic、Google

- **Core 层**——屏蔽底层差异，对外提供统一的调用方式

- **UI 层**——把后端产出的流，变成 React 组件里好用的 Hook

三层之间不是随便拼在一起的，它们靠两个协议对接：

- **LanguageModelV2 协议**（Provider ↔ Core）：每个 Provider 都要实现的接口，Core 不关心你用的是哪家模型

- **UIMessageStream 协议**（Core ↔ UI）：后端通过 HTTP/SSE 往前端推事件，`useChat` 按这个协议消费

你往后读的每一篇文章，都能在这张地图上找到位置——哪一篇在讲 Provider、哪一篇在讲 Core、哪一篇在讲 UI。先有了这张地图，学习顺序和查文档的效率会完全不同。

## 2. Provider 层：把每家模型的差异抹平

Provider 层只做一件事：**把每一家 LLM 的 API 包装成 `LanguageModelV2` 接口**。

你平时写代码接触 Provider，就是下面这几行：

providers.ts

```typescript
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'

const model1 = openai('gpt-4o')
const model2 = anthropic('claude-opus-4-6')
const model3 = google('gemini-2.5-pro')
```

`openai()` 和 `anthropic()` 返回的是什么？不是什么神秘对象，就是一个**实现了 `LanguageModelV2` 接口的对象**。接口里规定了这些东西：

- `doGenerate(options)`——非流式生成，一次性返回 `{ text, toolCalls, usage, ... }`

- `doStream(options)`——流式生成，返回一个 `ReadableStream` 加一些元数据

- `specificationVersion`——协议版本号，现在是 `'v2'`

- `provider` / `modelId`——告诉 Core 这是哪家哪个模型

- `supportedUrls`——这家 Provider 支持哪些 URL 作为输入（影响图片、文件输入）

Provider 内部要处理三件麻烦事：

**协议翻译。** 各家 API 的格式差得很远。OpenAI 的 messages 里 system 是一个 role，Anthropic 的 system 是单独的字段，Google 干脆连字段名都不叫 messages 而叫 contents。Provider 的任务就是把 Core 给它的统一格式，翻译成各家私有的格式。

**鉴权和网络。** 读 `OPENAI_API_KEY`、拼请求头、处理 base URL、把各家五花八门的错误码映射成 Core 能理解的错误类型。

**流式解码。** 各家的流格式也不一样：OpenAI 是 SSE + `data: {...}`，Anthropic 是 SSE + `event: ...`，Google 是一行一个 JSON。Provider 把它们全部解析成 Core 层能消费的统一事件流。

### 为什么这一层必须独立出来

假设没有 Provider 层，`streamText` 内部就会变成一坨 `if/else`：

code.ts

```typescript
if (model === 'openai') {
  // OpenAI 的调用逻辑
} else if (model === 'anthropic') {
  // Anthropic 的调用逻辑
}
```

每新增一家模型都要改 Core 代码，生态根本扩展不起来。

独立出来之后，Provider 就可以按来源分成三类：

- **官方 Provider**——Vercel 维护，比如 `@ai-sdk/openai`、`@ai-sdk/anthropic`、`@ai-sdk/google`、`@ai-sdk/mistral`、`@ai-sdk/xai`

- **社区 Provider**——任何人都可以写，比如 `@openrouter/ai-sdk-provider`、`workers-ai-provider`（Cloudflare Workers AI）、`ollama-ai-provider`（跑本地大模型）

- **自定义 Provider**——如果公司有内部私有 LLM，也可以自己包一层

只要一家新模型实现了 `LanguageModelV2`，`streamText`、`generateText` 这些函数就全部可用，Core 层一行不用动。本章 [模型 Provider 生态](/4-model-providers) 会专门讲 Provider 生态。

## 3. Core 层：提供统一的调用能力

Core 层是 AI SDK 的主干。当你写 `import { streamText, generateText, generateObject, streamObject, tool } from 'ai'` 时，拿到的就是这一层的东西。

Core 层提供五个核心能力，**不管你底下接的是哪家模型，用法都完全一样**：

| 能力 | 函数 | 用途 |
| --- | --- | --- |
| 非流式文本 | generateText | 一次调用拿完整回复 |
| 流式文本 | streamText | 逐 token 流式返回 |
| 非流式对象 | generateObject | 配合 Zod schema 返回结构化数据 |
| 流式对象 | streamObject | 结构化输出的流式版本 |
| 工具定义 | tool | 定义可被 LLM 调用的工具 |

还有一些辅助能力：

- `embed` / `embedMany`——生成嵌入向量

- `generateImage`——图像生成

- `transcribe`——语音转文字

- `experimental_createMCPClient`——接入 MCP 工具

- `wrapLanguageModel`——给模型加中间件

看一眼 `streamText` 的签名，你会发现所有参数都是模型无关的：

stream-text-signature.ts

```typescript
const result = streamText({
  model: LanguageModelV2,        // 任意 Provider
  messages?: ModelMessage[],      // 统一消息格式
  prompt?: string,                // 或直接传 prompt
  system?: string,                // 统一的 system prompt
  tools?: Record<string, Tool>,   // 统一的工具定义
  toolChoice?: 'auto' | 'required' | 'none' | { toolName: string },
  stopWhen?: StopCondition,       // Agent 循环的停止条件
  temperature?: number,
  maxOutputTokens?: number,
  abortSignal?: AbortSignal,
  experimental_telemetry?: TelemetrySettings,
  // ...
})
```

换任何 Provider，这套签名一行都不用改。

输出也一样统一。`streamText` 返回的 `result` 对象提供了四种消费方式，对应四种使用场景：

stream-text-consume.ts

```typescript
// 方式 1：只要逐 token 的字符串流
for await (const chunk of result.textStream) {
  console.log(chunk)
}

// 方式 2：要细粒度的事件流（token + tool + finish + 元数据）
for await (const part of result.fullStream) {
  if (part.type === 'text-delta') { /* ... */ }
  if (part.type === 'tool-call')   { /* ... */ }
  if (part.type === 'finish')      { /* ... */ }
}

// 方式 3：直接转成 HTTP Response，扔给 Hono / Next.js 返回
return result.toUIMessageStreamResponse()

// 方式 4：等所有 token 来齐再拿完整回复
const text = await result.text
```

从纯后端脚本到前端消费，这四种方式基本覆盖了所有场景。而且底层是同一个流，只是包装方式不同而已。

### Core 层还内置了 Agent 循环

`streamText` 有一个 `stopWhen` 参数，它把 Core 层从「一次调用」升级成了「多步 Agent」：

agent-loop.ts

```typescript
import { streamText, stepCountIs } from 'ai'

const result = streamText({
  model: openai('gpt-4o'),
  messages,
  tools: { searchMemory, updateEmotion },
  stopWhen: stepCountIs(10),   // 最多 10 步
})
```

当 LLM 调用了工具，Core 层会自动做这几件事：

- 执行工具、拿到结果

- 把结果拼回对话历史

- 再调一次 LLM

- 如此循环，直到 LLM 不再调用工具，或者触发 `stopWhen`

你不用自己写 while 循环，也不用写递归。这相当于一个极简版的 LangGraph ReAct Agent，[多步推理](/10-multi-step-agent) 会展开。

## 4. UI 层：React 前端的配套 Hook

UI 层是 AI SDK 相对 LangChain 最特别的部分。它放在 `@ai-sdk/react`（另有 `@ai-sdk/svelte`、`@ai-sdk/vue`），总共提供三个 Hook：

| Hook | 对应 Core 函数 | 典型场景 |
| --- | --- | --- |
| useChat | streamText | 聊天 UI、对话式 Agent |
| useCompletion | streamText（单次） | 续写、问答框 |
| useObject | streamObject | 结构化输出的流式 UI（评分卡、表单） |

配套还有一个叫 `UIMessage` 的消息模型，它和 Core 层的 `ModelMessage` 不是同一个东西（下一节会详细说）。

### UI 层在替你解决什么问题

回顾上一篇提到的四个痛点，UI 层一一给出了答案：

| 痛点 | UI 层怎么解 |
| --- | --- |
| 前端状态机每次都得重写 | useChat 直接暴露 status: 'ready' \| 'submitted' \| 'streaming' \| 'error'，状态机内置 |
| 思考态 / 工具调用 UI 全靠手搓 | UIMessage.parts 按类型分片，前端按 part.type 分别渲染 |
| 换模型牵动前端逻辑 | UI 只认 UIMessage 格式，底层换什么模型 UI 无感 |
| 结构化输出、tool、MCP 各自有一套接入方式 | Core 层已经标准化成了 UIMessageStream，UI 只消费这一套 |

最小使用示例（上一篇也贴过，这里拆得更细一点）：

chat.tsx

```tsx
'use client'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

export function Chat() {
  const { messages, sendMessage, status, stop, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  })

  return (
    <>
      {messages.map((m) => (
        <Message key={m.id} message={m} />
      ))}

      {status === 'streaming' && <button onClick={stop}>停止生成</button>}
      {status === 'error' && <div>出错了：{error?.message}</div>}

      <ChatInput
        onSend={(text) => sendMessage({ text })}
        disabled={status !== 'ready'}
      />
    </>
  )
}
```

`Message` 组件按 parts 分别渲染：

message.tsx

```tsx
function Message({ message }: { message: UIMessage }) {
  return (
    <div>
      <strong>{message.role}：</strong>
      {message.parts.map((part, i) => {
        switch (part.type) {
          case 'text':
            return <span key={i}>{part.text}</span>
          case 'reasoning':
            return <ThinkingBubble key={i} text={part.text} />
          case 'tool-invocation':
            return <ToolCard key={i} invocation={part.toolInvocation} />
          case 'source':
            return <SourceBadge key={i} source={part.source} />
          default:
            return null
        }
      })}
    </div>
  )
}
```

这段代码后面每一个前端章节都会见到，它是 UI 层最标准的使用姿势。

## 5. 串起三层的两个协议

三层之间靠两个协议对接。理解这两个协议，基本等于理解了 AI SDK 的骨架。

### 5.1 LanguageModelV2（Provider ↔ Core）

这是每个 Provider 必须实现的接口。你基本不会直接打交道，除非要自己写 Provider（[模型 Provider 生态](/4-model-providers) 会讲）。但知道它的存在很重要，原因有几个：

- **版本号是 `v2`**，说明之前有过 `v1`（`LanguageModelV1`）。AI SDK 从 4.x 升到 5.x，最关键的变化就是把协议从 v1 升到了 v2

- 升级的代价：部分社区 Provider 需要跟着更新才能在 5.x 下跑

- 本章所有代码都基于 **v2**，也就是 AI SDK 5.x 及以上

协议的核心契约长这样：

language-model-v2.ts

```typescript
interface LanguageModelV2 {
  readonly specificationVersion: 'v2'
  readonly provider: string
  readonly modelId: string

  doGenerate(options: LanguageModelV2CallOptions): Promise<LanguageModelV2Result>
  doStream(options: LanguageModelV2CallOptions): Promise<LanguageModelV2StreamResult>
}
```

`doStream` 返回值里最重要的是一个 `stream: ReadableStream<LanguageModelV2StreamPart>`。这个流里会有 `text-delta`、`tool-call`、`finish` 这些事件。Core 层拿到这个流之后，再加工一道，产出前端要用的 UIMessageStream。

### 5.2 UIMessageStream（Core ↔ UI）

这是 HTTP 响应里实际在跑的协议。它建立在 SSE 之上，每个事件都是一段 JSON：

uimessage-stream.txt

```text
data: {"type":"start"}

data: {"type":"start-step"}

data: {"type":"text-start","id":"txt_1"}

data: {"type":"text-delta","id":"txt_1","delta":"我"}

data: {"type":"text-delta","id":"txt_1","delta":"记得"}

data: {"type":"text-delta","id":"txt_1","delta":"你上次"}

data: {"type":"tool-input-start","toolCallId":"call_1","toolName":"searchMemory"}

data: {"type":"tool-input-delta","toolCallId":"call_1","inputTextDelta":"{\"query\":\"..."}

data: {"type":"tool-input-available","toolCallId":"call_1","input":{"query":"..."}}

data: {"type":"tool-output-available","toolCallId":"call_1","output":[...]}

data: {"type":"finish"}

data: [DONE]
```

常见事件类型一览：

| 事件 type | 作用 |
| --- | --- |
| start / finish | 整个流开始/结束 |
| start-step / finish-step | 每一步（每次 LLM 调用）开始/结束 |
| text-start / text-delta / text-end | 文本逐 token 输出 |
| reasoning-start / reasoning-delta | 思考过程（<think> 标签型，或 o1/DeepSeek R1 显式输出） |
| tool-input-start / tool-input-delta / tool-input-available | 工具调用参数的流式构造 |
| tool-output-available | 工具执行结果 |
| source-url / source-document | 引用来源（RAG、检索） |
| file | 附件输出（图片、音频） |
| data-* | 自定义 data part |
| error | 错误 |

## 6. 小结

- **Provider 层**把「调用任意 LLM」这件事，标准化成了 `LanguageModelV2` 接口。换模型，Core 不改一行

- **Core 层**提供 `streamText`、`generateText`、`generateObject`、`tool` 等能力，以及 Agent 循环、中间件、MCP 这些扩展点

- **UI 层**通过 `useChat`、`useCompletion`、`useObject` 三个 Hook 把 Core 层的产物映射成 React 状态，配合 `UIMessage.parts` 做分片渲染

- **两个协议**把三层串起来：`LanguageModelV2`（Provider ↔ Core）、`UIMessageStream`（Core ↔ UI）

- **AI SDK 5.x 协议版本是 v2**，本章所有示例都基于此

下一篇我们开始动手——从零搭一个最小项目，跑通 `generateText` 的第一次调用。
