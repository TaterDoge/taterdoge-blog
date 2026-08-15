---
title: "120 消息协议"
pubDate: 2026-05-19
description: "UIMessage——前端世界的消息。useChat 拿到的、组件渲染的、要在 React 里 useState 的那种"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/5-message-protocol/](https://aicompanion.usehook.cn/5-message-protocol/)

## 1. 为什么有两套消息模型

AI SDK 里有两套长得很像、但职责完全不同的消息类型：

- **`UIMessage`**——前端世界的消息。`useChat` 拿到的、组件渲染的、要在 React 里 `useState` 的那种

- **`ModelMessage`**——后端世界的消息。`streamText` / `generateText` 接收的、喂给 LLM Provider 的那种

第一次看到这两套模型时，大多数人第一反应都是：为什么不用一套？

因为这两套模型要解决的问题完全不同：

- UIMessage 解决的是「如何在界面上把一条消息按段渲染出来」——文本段、思考段、工具调用段、引用来源段、文件段，每种都要单独的 UI

- ModelMessage 解决的是「如何把对话历史精确喂给 LLM」——LLM 不在乎你 UI 里怎么渲染，它只在乎谁说了什么、什么类型、附带什么工具结果

强行合并只会得到两头都别扭的结构。AI SDK 的做法很直接：前端用 UIMessage，后端用 ModelMessage，中间靠 `convertToModelMessages` 做转换。

这一篇我们把两者的字段、转换关系、以及在 AI 伴侣项目里怎么用，一次讲清楚。

## 2. UIMessage：前端的消息

UIMessage 的核心结构：

ui-message.ts

```typescript
interface UIMessage<METADATA = unknown, DATA_PARTS extends UIDataTypes = UIDataTypes> {
  id: string
  role: 'system' | 'user' | 'assistant'
  metadata?: METADATA
  parts: UIMessagePart<DATA_PARTS>[]
}
```

几个关键字段：

- `id`：消息唯一标识。`useChat` 内部会自动生成，你可以直接用它当 React 的 `key`

- `role`：`system` / `user` / `assistant`，和 Chat API 的三种角色对应

- `parts`：消息主体，是一个**数组**。这是 UIMessage 和 ModelMessage 最大的结构差异

- `metadata`：可选的业务元数据（比如「这条消息的情绪分值」）。后端 `streamText` 时可以注入，前端渲染时可以读

`parts` 数组里放的是一个个 `UIMessagePart`，常见类型如下：

| type | 载荷 | 用途 |
| --- | --- | --- |
| text | { type: 'text', text: string, state?: 'streaming' \| 'done' } | 普通文本段 |
| reasoning | { type: 'reasoning', text: string, state?: ... } | 思考过程（Claude thinking / o1 reasoning） |
| tool-{name} | { type: 'tool-searchMemory', toolCallId, input, output, state } | 工具调用（类型名是动态的） |
| source-url | { type: 'source-url', sourceId, url, title? } | RAG 引用（URL） |
| source-document | { type: 'source-document', sourceId, mediaType, title } | RAG 引用（文档） |
| file | { type: 'file', mediaType, url } | 附件输出 |
| data-{name} | { type: 'data-custom', data: ... } | 自定义数据 part |
| step-start | 标记一次 step 的开始 | 用于多步 Agent 的 UI 分隔 |

看一个典型的 `UIMessage` 实例（来自 AI 伴侣的一次对话）：

ui-message-example.ts

```typescript
const message: UIMessage = {
  id: 'msg_1a2b',
  role: 'assistant',
  parts: [
    {
      type: 'reasoning',
      text: '用户提到了上次周五说的难过的事，我应该先检索记忆。',
      state: 'done',
    },
    {
      type: 'tool-searchMemory',
      toolCallId: 'call_1',
      state: 'output-available',
      input: { query: '周五 难过' },
      output: [
        { content: '上周五用户说 ...', intimacy: 0.7 },
      ],
    },
    {
      type: 'text',
      text: '我记得你上周五说到工作的压力很大，今天感觉好一些了吗？',
      state: 'done',
    },
  ],
}
```

前端组件按 part 类型分别渲染：

render-parts.tsx

```tsx
function AssistantMessage({ message }: { message: UIMessage }) {
  return (
    <div>
      {message.parts.map((part, i) => {
        if (part.type === 'reasoning')
          return <ThinkingBubble key={i} text={part.text} />

        if (part.type === 'text')
          return <TextSegment key={i} text={part.text} streaming={part.state === 'streaming'} />

        if (part.type.startsWith('tool-'))
          return <ToolCard key={i} part={part} />

        if (part.type === 'source-url')
          return <SourceLink key={i} url={part.url} title={part.title} />

        return null
      })}
    </div>
  )
}
```

这种「按 part 分片渲染」的模式，[UI Message Parts](/12-ui-message-parts) 会完整展开。

## 3. ModelMessage：后端的消息

ModelMessage 的结构更接近 OpenAI 原生 Chat API：

model-message.ts

```typescript
type ModelMessage =
  | SystemModelMessage
  | UserModelMessage
  | AssistantModelMessage
  | ToolModelMessage
```

各自的形态：

model-message-shapes.ts

```typescript
interface SystemModelMessage {
  role: 'system'
  content: string
}

interface UserModelMessage {
  role: 'user'
  content: string | Array<TextPart | ImagePart | FilePart>
}

interface AssistantModelMessage {
  role: 'assistant'
  content: string | Array<TextPart | ReasoningPart | FilePart | ToolCallPart>
}

interface ToolModelMessage {
  role: 'tool'
  content: Array<ToolResultPart>
}
```

和 UIMessage 的主要差异整理成表：

| 维度 | UIMessage | ModelMessage |
| --- | --- | --- |
| 消息数组？ | parts 数组 | content 是字符串或数组 |
| 角色数量 | 3 种（system/user/assistant） | 4 种（多了 tool） |
| 工具调用的表达 | 嵌在 assistant.parts 里的 tool-xxx | assistant 发 tool-call，后续独立一条 tool 消息带结果 |
| state / streaming 字段 | 有 | 无 |
| 元数据 | 有 metadata | 无 |
| 用于 | UI 渲染、useChat state | LLM 调用、streamText({ messages }) |

一句话总结：UIMessage 关心怎么展示，ModelMessage 关心怎么准确表达对话语义。

工具调用最能体现这个差异。在 UIMessage 里，一条 assistant 消息就能包含完整的工具调用链（思考 → 调用 → 结果 → 文本）；但在 ModelMessage 里，这会被拆成两条独立的消息：

model-message-tool.ts

```typescript
const modelMessages: ModelMessage[] = [
  {
    role: 'user',
    content: '查一下上周五我们聊了什么。',
  },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: '好的，让我回忆一下。' },
      {
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'searchMemory',
        input: { query: '周五' },
      },
    ],
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'call_1',
        toolName: 'searchMemory',
        output: { type: 'json', value: [{ content: '...' }] },
      },
    ],
  },
  {
    role: 'assistant',
    content: '我记得你上周五说到...',
  },
]
```

这四条 ModelMessage，对应前端看到的 1 条 assistant UIMessage（里面装着 reasoning + tool part + text）加上一条 user UIMessage。

## 4. convertToModelMessages：两者之间的桥

前端 `useChat` 给后端发请求时，默认会把当前 `messages: UIMessage[]` 直接作为请求体发过去。后端 `streamText` 不能直接吃 UIMessage，得先转换——这个转换函数就是 `convertToModelMessages`：

server-route.ts

```typescript
import { streamText, convertToModelMessages, UIMessage } from 'ai'
import { models } from '@/shared/models'

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const result = streamText({
    model: models.chat,
    messages: convertToModelMessages(messages),
    tools: { /* ... */ },
  })

  return result.toUIMessageStreamResponse()
}
```

`convertToModelMessages` 做三件事：

- **展平 parts**：把一条 `UIMessage` 里的 text / tool-xxx part 拆成多条 ModelMessage

- **丢弃 UI-only 字段**：`id` / `state` / `metadata` 对 LLM 没意义，一律移除

- **合并相邻段**：连续的 text part 合并成单个 text content，少浪费点 token

反过来，后端生成流式响应后，AI SDK 的 `toUIMessageStreamResponse` 会把 ModelMessage 风格的事件流翻译成 UIMessageStream 协议，前端 `useChat` 再把流重新组装成 `UIMessage[]`。这个往返闭环是 AI SDK 最核心的价值之一。

### 什么时候可能要手写转换

大部分场景下默认 `convertToModelMessages` 够用。偶尔会遇到下面这些情况。

**只想保留最近 N 条消息**

trim-messages.ts

```typescript
const recentUI = messages.slice(-20)
const modelMsgs = convertToModelMessages(recentUI)
```

**注入系统消息**

inject-system.ts

```typescript
const modelMsgs: ModelMessage[] = [
  { role: 'system', content: buildSystemPrompt(userContext) },
  ...convertToModelMessages(messages),
]
```

**压缩历史对话**

超长历史要摘要化。先自己把旧消息摘要成一条 system 消息，再拼上最近 K 条 UIMessage 转换后的结果。

**前端 part 不想喂给模型**

比如一个 `data-emotion` part 是业务数据，LLM 不需要看。默认 `convertToModelMessages` 会忽略 `data-*` part，所以一般不用管。但如果你想把它注入到 system prompt 里，就得自己写一层转换。

## 5. Transport：前端发给后端的是什么

`useChat` 默认通过 `DefaultChatTransport` 把 UIMessage 数组 POST 给后端。HTTP 请求体长这样：

index.json

```json
{
  "id": "chat_abc",
  "messages": [
    { "id": "msg_1", "role": "user", "parts": [{ "type": "text", "text": "hi" }] },
    { "id": "msg_2", "role": "assistant", "parts": [{ "type": "text", "text": "hello" }] },
    { "id": "msg_3", "role": "user", "parts": [{ "type": "text", "text": "今天过得怎么样？" }] }
  ]
}
```

每次请求，前端都把**整个会话历史**发过去。短会话没问题，长会话会越来越重。常见两种解法。

### 解法 A：后端持久化，前端只发最新一条

Transport 可以自定义请求转换：

transport.ts

```typescript
import { DefaultChatTransport } from 'ai'

const transport = new DefaultChatTransport({
  api: '/api/chat',
  prepareSendMessagesRequest: ({ id, messages }) => {
    return {
      body: {
        id,
        // 只发最新一条
        message: messages[messages.length - 1],
      },
    }
  },
})
```

后端根据 `id` 从 D1 / KV 加载历史，拼上新消息再调模型。适合长期会话、多用户、需要持久化的产品——比如 AI 伴侣。

### 解法 B：前端压缩上下文

前端维护一个「最近 N 条 + 摘要」的滑动窗口，只发窗口内的消息。实现更简单，但会话连续性会弱一些。

## 7. 给 AI 伴侣项目定一个消息约定

把前面讲的内容落地到 AI 伴侣项目里。

前端消息结构（UIMessage 的 parts 组合）：

companion-message.ts

```typescript
type CompanionAssistantParts = [
  // 可选：情绪判定（data part，UI 展示为小标签）
  { type: 'data-emotion', data: { primary: string; intensity: number } }?,
  // 可选：检索记忆（tool part，UI 展示为卡片）
  { type: 'tool-searchMemory', ... }?,
  // 主体：文字回复
  { type: 'text', text: string },
]
```

元数据（UIMessage.metadata）用来放业务追踪数据：

companion-metadata.ts

```typescript
interface CompanionMetadata {
  sessionId: string
  intimacy: number          // 亲密度当前分值
  emotionTransition?: {     // 情绪是否发生变化
    from: string
    to: string
  }
}
```

后端入口统一结构：

companion-route.ts

```typescript
export async function POST(req: Request) {
  const { id, messages } = await req.json()

  // 注入 system prompt（从用户画像动态生成）
  const userProfile = await loadUserProfile(id)
  const modelMsgs: ModelMessage[] = [
    { role: 'system', content: buildSystemPrompt(userProfile) },
    ...convertToModelMessages(messages),
  ]

  const result = streamText({
    model: models.chat,
    messages: modelMsgs,
    tools: { searchMemory, updateEmotion },
  })

  return result.toUIMessageStreamResponse({
    messageMetadata: ({ part }) => {
      if (part.type === 'finish') {
        return {
          sessionId: id,
          intimacy: userProfile.intimacy,
        }
      }
    },
  })
}
```

`messageMetadata` 这个回调让我们能在流的不同阶段往 UIMessage 的 metadata 里注入数据，后续前端实战里还会复用它。

## 8. 小结

- UIMessage 服务前端渲染，`parts` 数组支持多段分片（text / reasoning / tool / source / file / data）

- ModelMessage 服务 LLM 调用，结构贴近 OpenAI Chat API，多了一个 `tool` 角色

- `convertToModelMessages` 是两者之间的桥，常规场景够用，特殊场景手写

- Transport 负责前端怎么把消息发给后端，可以自定义 `prepareSendMessagesRequest` 实现「只发最新一条」

- AI 伴侣项目约定：前端用 UIMessage + metadata，后端拼 system prompt + `convertToModelMessages`，返回时通过 `messageMetadata` 注入业务数据

下一篇进入核心能力区——**Prompt 工程 × AI SDK**：`prompt` vs `messages` 两个参数的区别、system prompt 的位置、多模态 prompt、prompt 管理策略。
