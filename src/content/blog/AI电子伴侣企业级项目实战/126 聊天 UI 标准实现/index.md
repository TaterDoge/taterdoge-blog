---
title: "126 聊天 UI 标准实现"
pubDate: 2026-05-21
description: "在 Streaminghttps://aicompanion.usehook.cn/13streamingresponsearchitecture 里，手写了一个 useStreamChat Hook，70 多行代码干了这些事："
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/11-use-chat-hook/](https://aicompanion.usehook.cn/11-use-chat-hook/)

## 1. 从手写 Hook 到 useChat

在 [Streaming](/13-streaming-response-architecture) 里，手写了一个 `useStreamChat` Hook，70 多行代码干了这些事：

- 管理 4 种状态（`idle` / `thinking` / `generating` / `done`）

- 发 `fetch` 请求、用 `reader.read()` 消费流

- 手写 `parseSSEEvents` 切分事件

- 在 `switch` 里分发 `thinking` / `token` / `done` / `error` 事件

- 处理没收到 `done` 的容错

这一篇的目标是用 `@ai-sdk/react` 的 `useChat` 把它替换掉，把同等体验压到 10 行以内，顺便拿到一些原来没有的能力（工具调用可视化、思考态、引用来源、多段 parts）。

先装前端包：

index.bash

```shellscript
yarn add @ai-sdk/react ai
```

一个可运行的 Chat 组件：

chat-min.tsx

```tsx
'use client'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useState } from 'react'

export function Chat() {
  const [input, setInput] = useState('')

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  })

  return (
    <div>
      <ul>
        {messages.map((m) => (
          <li key={m.id}>
            <strong>{m.role}：</strong>
            {m.parts.map((p, i) =>
              p.type === 'text' ? <span key={i}>{p.text}</span> : null,
            )}
          </li>
        ))}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!input.trim()) return
          sendMessage({ text: input })
          setInput('')
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit" disabled={status !== 'ready'}>
          发送
        </button>
      </form>
    </div>
  )
}
```

后端（Hono）：

api-chat.ts

```typescript
import { streamText, convertToModelMessages } from 'ai'
import { Hono } from 'hono'

const app = new Hono()

app.post('/api/chat', async (c) => {
  const { messages } = await c.req.json()
  const result = streamText({
    model: models.chat,
    messages: convertToModelMessages(messages),
  })
  return result.toUIMessageStreamResponse()
})
```

跑起来之后：用户打字、按发送、消息进入 `messages` 数组、回复一段段流出来、完成后状态回到 `ready`。这一切都是 `useChat` 内部完成的。

## 2. useChat 的完整返回值

`useChat()` 返回的对象里有这些字段：

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| messages | UIMessage[] | 完整的消息历史，前端渲染的唯一数据源 |
| setMessages | (msgs) => void | 直接替换消息数组（编辑历史、清空、重放） |
| sendMessage | (msg) => Promise | 发送一条新消息，触发后端调用 |
| regenerate | () => Promise | 重新生成最后一条 assistant 回复 |
| stop | () => void | 中止当前流（触发 AbortSignal） |
| resumeStream | () => void | 断线重连、恢复流（需要后端配合） |
| status | 'ready' \| 'submitted' \| 'streaming' \| 'error' | 当前状态 |
| error | Error \| undefined | 最近一次错误 |
| id | string | chat 的稳定 ID（可作为后端 session 标识） |
| addToolResult | (args) => void | HITL 场景：手动提供工具执行结果 |

状态机是这样流转的：

status.txt

```text
ready      ← 初始，或上一次流结束
  ↓ sendMessage()
submitted  ← 请求已发，还没收到首字节
  ↓ 第一个 chunk 到达
streaming  ← 流在逐 token 推送
  ↓ 流结束
ready
  ↓ 异常
error
```

和手写版对照着看：

- 手写的 `status: 'idle' | 'thinking' | 'generating' | 'done'` 对应 `useChat` 的 `'ready' | 'submitted' | 'streaming' | 'error'`，语义对等，但多了正式的 `error` 状态

- 手写的 `thinkingNode` 对应 `useChat` 的 `reasoning` / `tool-invocation` part，用 parts 数组更通用

- 手写的 `reply` 字符串对应 `messages[last].parts`，多段分片

## 3. sendMessage 的几种形态

`sendMessage` 的参数是 `CreateUIMessage`，有好几种写法：

send-message.tsx

```tsx
// 最简：纯文本
sendMessage({ text: '你好' })

// 多段 parts（图片 + 文本）
sendMessage({
  parts: [
    { type: 'text', text: '描述这张图：' },
    { type: 'file', url: 'https://.../photo.jpg', mediaType: 'image/jpeg' },
  ],
})

// 带元数据（业务字段）
sendMessage({ text: '你好' }, {
  body: {
    sessionId: 'sess_123',
    mood: 'tired',
  },
})

// 第二参数 body 会合并进请求体 —— 后端可以读
```

用户上传图片 + 问题的多模态场景：

multimodal-input.tsx

```tsx
function ImageUploadChat() {
  const { messages, sendMessage } = useChat({ transport: ... })

  async function handleUpload(file: File, question: string) {
    const url = await uploadToR2(file) // [Cloudflare R2](/14-cloudflare-r2) 讲过 R2
    sendMessage({
      parts: [
        { type: 'text', text: question },
        { type: 'file', url, mediaType: file.type },
      ],
    })
  }

  // ...
}
```

后端 `convertToModelMessages(messages)` 会自动把 file part 翻译成 ModelMessage 的 `image` / `file` content，不用额外处理。

## 4. status 配合 UI

`status` 是做出好体验的关键。几个常见的 UI 模式。

根据 status 切换发送按钮的文案和可用性：

disable-send.tsx

```tsx
<button type="submit" disabled={status !== 'ready'}>
  {status === 'submitted' && '发送中...'}
  {status === 'streaming' && '生成中'}
  {status === 'ready' && '发送'}
  {status === 'error' && '重试'}
</button>
```

「停止生成」按钮只在 streaming 时显示。点击 `stop()` 后前端立刻回到 `ready`；后端如果正确传递了 `abortSignal`（[UIMessageStream](/7-stream-text) 讲过），LLM 请求也会同时被取消：

stop-button.tsx

```tsx
{status === 'streaming' && (
  <button onClick={stop}>停止生成</button>
)}
```

思考指示器用在 `submitted` 已经发出但还没收到第一个 chunk 的时候。这对应手写版的 `thinking` 状态，但语义更通用——submitted 可能是在思考，也可能是在调工具。真正的思考可视化交给 parts 里的 `reasoning` / `tool-invocation`，[UI Message Parts](/12-ui-message-parts) 会展开：

thinking-indicator.tsx

```tsx
{status === 'submitted' && <ThinkingDots />}
```

status 为 `error` 时展示错误信息和重试按钮：

error-retry.tsx

```tsx
{status === 'error' && (
  <div className="error">
    出错了：{error?.message}
    <button onClick={() => regenerate()}>重试</button>
  </div>
)}
```

## 5. Transport 与持久化

`DefaultChatTransport` 默认把整个 messages 数组作为请求体发给 `api` URL。要自定义（比如只发最新一条、加自定义 headers、走 WebSocket），用 `prepareSendMessagesRequest`：

transport-custom.ts

```typescript
import { DefaultChatTransport } from 'ai'

const transport = new DefaultChatTransport({
  api: '/api/chat',

  // 每次发请求的自定义 headers
  headers: () => ({
    'x-session-id': getSessionId(),
    'authorization': `Bearer ${getToken()}`,
  }),

  // 自定义请求体
  prepareSendMessagesRequest: ({ id, messages, body }) => {
    return {
      body: {
        chatId: id,
        // 只发最新一条
        message: messages[messages.length - 1],
        // 合并调用方传的 body
        ...body,
      },
    }
  },
})

// 使用
const chat = useChat({ transport })
```

AI 伴侣项目就是用这个能力做「只发最新一条 + 后端从 D1 加载历史」的长会话模式（[重构端到端 AI Chat](/21-practice-end-to-end) 实战会展开）。

### 本地持久化

`useChat` 默认不做持久化，刷新页面消息就没了。两种做法。

受控 messages，自己管状态：

controlled-messages.tsx

```tsx
const [persistedMessages, setPersistedMessages] = useState<UIMessage[]>(
  () => JSON.parse(localStorage.getItem('chat-history') ?? '[]'),
)

const { messages, sendMessage, setMessages } = useChat({
  messages: persistedMessages,
  transport: ...,
  onFinish: ({ message }) => {
    setPersistedMessages((prev) => [...prev, message])
    localStorage.setItem('chat-history', JSON.stringify([...persistedMessages, message]))
  },
})
```

或者后端持久化（AI 伴侣走的就是这条路）：前端不存，后端每次 `onFinish` 写 D1，下次刷新时前端通过 API 拉回来注入 `messages`。

### 断线重连：resumeStream

用户刷新、网络断了、切标签页——流就中断了。`resumeStream()` 允许恢复：

resume.ts

```typescript
import { useChat } from '@ai-sdk/react'

const { resumeStream } = useChat({
  transport: ...,
  // 触发恢复的时机由你决定
})

useEffect(() => {
  // 页面恢复时尝试续流
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      resumeStream()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => document.removeEventListener('visibilitychange', onVisibilityChange)
}, [resumeStream])
```

后端要支持恢复协议，用 `createResumableStreamContext` 把流持久化到 KV，客户端带着最后看到的事件 id 过来就能续上。完整实现放在 [AI SDK × Hono](/15-ai-sdk-with-hono)。

## 6. 受控 vs 非受控：input 的两种模式

上面的例子用 `useState` 管理输入框（受控）。这是 `useChat` 在 v5 的默认模式——`useChat` 不再管 input 状态，完全交给你。

对比早期 v4 的写法：

v4-old.tsx

```tsx
// v4 的老写法（v5 不再支持）
const { input, handleInputChange, handleSubmit } = useChat({ api: '/api/chat' })

<form onSubmit={handleSubmit}>
  <input value={input} onChange={handleInputChange} />
</form>
```

v5-new.tsx

```tsx
// v5 推荐
const [input, setInput] = useState('')
const { sendMessage } = useChat({ transport: ... })

<form onSubmit={(e) => {
  e.preventDefault()
  sendMessage({ text: input })
  setInput('')
}}>
  <input value={input} onChange={(e) => setInput(e.target.value)} />
</form>
```

v5 的设计更清晰：`useChat` 只管对话流，输入框是你自己的事。这样接入 Ant Design / shadcn/ui 的复杂输入组件也更容易（不用 hack `handleInputChange` 的类型）。

## 7. 和手写版的完整 diff

把 [Streaming](/13-streaming-response-architecture) 里的 `useStreamChat` 和 `useChat` 放一起对照：

handwritten.tsx

```tsx
// 手写版（简化）
function useStreamChat() {
  const [status, setStatus] = useState<Status>('idle')
  const [thinkingNode, setThinkingNode] = useState('')
  const [reply, setReply] = useState('')
  const [metadata, setMetadata] = useState(null)

  const sendMessage = useCallback(async (message: string) => {
    setStatus('thinking')
    setReply('')

    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId }),
    })

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const { parsed, remaining } = parseSSEEvents(buffer)
      buffer = remaining

      for (const event of parsed) {
        switch (event.type) {
          case 'thinking': setThinkingNode(event.data.node); break
          case 'token':    setStatus('generating'); setReply(p => p + event.data.content); break
          case 'done':     setStatus('done'); setMetadata(event.data); break
          case 'error':    setStatus('done'); break
        }
      }
    }
  }, [])

  return { status, thinkingNode, reply, metadata, sendMessage }
}
```

sdk-version.tsx

```tsx
// SDK 版
function useSdkChat() {
  return useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  })
}
```

代码量对比：

| 维度 | 手写版 | SDK 版 |
| --- | --- | --- |
| Hook 代码 | 70+ 行 | 3 行 |
| SSE 解析代码 | 30+ 行（parseSSEEvents） | 0 |
| 状态管理 | 自建 4 种 useState | 内置 status |
| 工具调用可视化 | 未覆盖 | 原生 parts |
| 思考态流式 | 单事件 | reasoning part 流式 |
| 断线恢复 | 未覆盖 | resumeStream() |
| 中止生成 | 要自己管理 AbortController | stop() |
| 重新生成 | 要自己重放消息 | regenerate() |

同等体验下，代码量缩减到原来的二十分之一，顺带还免费获得了一批原本要自己补的能力。

## 8. 小结

- `useChat` 就是手写 `useStreamChat` 的工业化版本，核心返回 `messages` / `sendMessage` / `status`

- 状态机四态：`ready` / `submitted` / `streaming` / `error`

- `sendMessage` 接收 UIMessage 形态，支持多段 parts、多模态、业务元数据（第二个参数 body）

- Transport 抽象了 HTTP 细节，自定义 headers、body 变形、WebSocket 接入都从这里改

- v5 不再管 input 状态，输入框交给调用方

- 持久化两种玩法：本地 localStorage，或者后端数据库；断线恢复用 `resumeStream`

- 对比手写版：代码量 1/20，能力 3 倍

下一篇——**UI Message Parts**，真正发挥 UIMessage 分片渲染的威力。思考态气泡、工具调用卡片、RAG 引用徽章、流式 Markdown，每一种怎么渲染。
