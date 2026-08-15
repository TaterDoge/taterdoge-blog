---
title: "171、 结果逐字输出"
pubDate: 2026-06-06
description: "把模型输出和前端展示拆成后端 SSE 透传与前端逐字渲染两层，解决流式链路被缓冲时的观感问题。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/36-typewriter-output/](https://aicompanion.usehook.cn/36-typewriter-output/)

## 概述

如何实现逐字输出？这个问题面试也经常被问到

AI Assistant 的回复其实已经通过接口返回了，但在前端看起来还是像**整段内容一次性出现**。对于聊天产品来说，这种反馈会显得有点生硬，用户更熟悉的是一句话正在被慢慢写出来的感觉。这种效果是怎么实现的呢？

我们具体的实现没有只押在后端 streaming 上，而是把方案拆成了两层。后端尽量输出真正的文本流，让模型内容尽早到达浏览器；前端再增加一层 typewriter 显示状态，即使某些环境把响应缓冲成一整段，页面上仍然可以按照本地节奏逐字展示。

后端可以用上模型接口的 streaming 能力，但模型服务、本地开发服务、Worker、代理层和浏览器都有可能影响实际 chunk 到达的粒度。前端多做一层显示控制之后，视觉体验就不会完全依赖链路里每一层都按预期流式透传。

## 问题背景

最开始的 API 使用了 LangChain 的 `model.stream()`，然后把每个 chunk 写入 `text/plain` 响应：

code.ts

```typescript
const stream = await model.stream(messages)

for await (const chunk of stream) {
  controller.enqueue(encoder.encode(content))
}
```

前端这边使用的是 AI SDK 的 `TextStreamChatTransport`：

code.ts

```typescript
const transport = useMemo(
  () => new TextStreamChatTransport<UIMessage>({
    api: `${getWebClientEnv().NEXT_PUBLIC_API_BASE_URL}/rpc/chat/inbox`,
    body: {
      conversation,
    },
  }),
  [conversation],
)
```

从代码上看，这条链路已经是在做流式输出了。但实际跑起来以后，AI 回复仍然可能一下子显示出来。这里我们可以把原因梳理得更完整一点。

模型服务端返回的 chunk 粒度不一定很细，有时它本身就会攒一小段再吐出来。LangChain 这一层也可能不会按前端期待的小 token 粒度透出。再往外看，本地开发服务、Worker、代理或者浏览器都有可能缓冲响应，导致前端比较晚才拿到数据。即使网络层确实收到了流，AI SDK 写入 `messages` 的时候，也可能一次性更新一段较长的文本。

所以，后端已经 stream，并不等于用户一定能看到**视觉逐字输出**。这两个概念要分开看：一个是网络传输层的流式，一个是界面展示层的逐字。

## 后端处理 SSE

后端这次改成直接调用 DeepSeek/OpenAI 兼容的 `/chat/completions` 接口，并开启 `stream: true`。

上游接口返回的是 SSE，每一行大致是这样的格式：

code.ts

```txt
data: {"choices":[{"delta":{"content":"你"}}]}
data: {"choices":[{"delta":{"content":"好"}}]}
data: [DONE]
```

我们要做的事情并不复杂：读出每个 `delta.content`，然后立刻写入自己的 `ReadableStream`。这样前端拿到的就不是完整 JSON，也不是 SSE 原始数据，而是更适合 `TextStreamChatTransport` 消费的纯文本流。

先看请求 DeepSeek 的部分：

code.ts

```typescript
const upstream = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: env.DEEPSEEK_MODEL ?? "deepseek-chat",
    messages,
    stream: true,
  }),
  signal: c.req.raw.signal,
})
```

拿到上游响应以后，再把 SSE 转成纯文本流：

code.ts

```typescript
const textStream = new ReadableStream<Uint8Array>({
  async start(controller) {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const reader = upstream.body?.getReader()
    let buffer = ""
    let closed = false

    if (!reader) {
      controller.close()
      return
    }

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done || closed) {
          break
        }

        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          const trimmed = line.trim()

          if (!trimmed.startsWith("data:")) {
            continue
          }

          const data = trimmed.slice(5).trim()

          if (!data) {
            continue
          }

          if (data === "[DONE]") {
            closed = true
            controller.close()
            break
          }

          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: unknown } }>
          }
          const content = parsed.choices?.[0]?.delta?.content

          if (typeof content === "string" && content) {
            controller.enqueue(encoder.encode(content))
          }
        }

        if (closed) {
          break
        }
      }

      if (!closed) {
        controller.close()
      }
    } catch (error) {
      controller.error(error)
    }
  },
})
```

这里有两个细节值得注意。第一，`buffer` 不能省，因为上游返回的二进制块不一定刚好按行切开；我们需要把最后一截不完整的行留下来，等下一次读取后再继续解析。第二，遇到 `[DONE]` 后要主动关闭 `controller`，这样前端能明确知道这次回复已经结束。

响应头也要配合一下，尽量告诉中间层不要缓存这段流：

code.ts

```typescript
return new Response(textStream, {
  headers: {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-cache",
    "x-accel-buffering": "no",
  },
})
```

做到这里，后端的目标就比较清晰了：尽可能早地把模型文本片段写出去，让前端有机会更快开始展示。

## 前端显示层

只做后端流式仍然不够保险，所以前端又补了一层显示状态。

真实消息仍然保存在 AI SDK 的 `messages` 中，这部分不要破坏。我们额外维护一个 `visibleAssistantTextById`，渲染时不直接展示完整的 assistant 文本，而是展示一个逐步增长的 `visibleMessageText`。这样即使 `messages` 里某条回复一下子变成了完整内容，页面也会按照 typewriter 的节奏慢慢显示。

### 1. 逐字输出配置

code.ts

```typescript
const TYPEWRITER_INTERVAL_MS = 18
const TYPEWRITER_CHARS_PER_STEP = 1
```

这里设置成每 18ms 显示 1 个字符。中文阅读里，这个速度会比较接近**正在回复**的观感。如果后面发现长文本显得太慢，也可以再把步长调大。

### 2. 字符处理

这里不要直接用 `text.slice(0, length)`。普通字符串切片在大多数中文场景里能跑，但遇到 emoji 或一些 Unicode 字符时，可能会把一个完整字符切坏。

所以我们用 `Array.from` 先按字符拆开，再做长度计算和切片：

code.ts

```typescript
function getTextLength(text: string) {
  return Array.from(text).length
}

function sliceText(text: string, length: number) {
  return Array.from(text).slice(0, length).join("")
}
```

### 3. 提取 assistant 文本

这里要处理的是模型生成出来的 assistant 回复。我们可以从 `messages` 里提取每条 assistant 消息的完整文本，再交给后面的显示状态一点点推进。

code.ts

```typescript
const [visibleAssistantTextById, setVisibleAssistantTextById] =
  useState<Record<string, string>>({})

const assistantFullTextById = useMemo(() => {
  const textById: Record<string, string> = {}

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue
    }

    const text = getMessageText(message)

    if (text) {
      textById[message.id] = text
    }
  }

  return textById
}, [assistantTextSignature, messages])
```

这里会得到一个以消息 `id` 为 key 的完整文本映射。后面的显示状态，就是围绕这份完整文本一点点推进。

### 4. 初始化新消息

当新的 assistant 消息出现时，我们不马上把完整内容放进可见文本里，而是先展示第一个字符。这样就算 AI SDK 已经一次性给了完整内容，用户看到的也仍然是逐字开始。

code.ts

```typescript
useEffect(() => {
  setVisibleAssistantTextById((current) => {
    const next: Record<string, string> = {}
    let changed = false

    for (const [id, fullText] of Object.entries(assistantFullTextById)) {
      const visibleText = current[id]

      if (visibleText === undefined || !fullText.startsWith(visibleText)) {
        next[id] = sliceText(fullText, TYPEWRITER_CHARS_PER_STEP)
        changed = true
        continue
      }

      next[id] = visibleText
    }

    if (Object.keys(current).length !== Object.keys(next).length) {
      changed = true
    }

    return changed ? next : current
  })
}, [assistantFullTextById])
```

这里的 `!fullText.startsWith(visibleText)` 是一个兜底判断。比如某条消息内容被替换、重试或者重新生成，旧的可见文本已经不是新完整文本的前缀，就需要从头重新开始显示。

### 5. 推进可见字符

只要还有没有展示完的字符，就用 `setTimeout` 往前推进一格。

code.ts

```typescript
const hasTypewriterWork = Object.entries(assistantFullTextById).some(([id, fullText]) => {
  const visibleText = visibleAssistantTextById[id] ?? ""

  return getTextLength(visibleText) < getTextLength(fullText)
})

useEffect(() => {
  if (!hasTypewriterWork) {
    return
  }

  const timer = window.setTimeout(() => {
    setVisibleAssistantTextById((current) => {
      let changed = false
      const next = { ...current }

      for (const [id, fullText] of Object.entries(assistantFullTextById)) {
        const visibleText = current[id] ?? ""
        const visibleLength = getTextLength(visibleText)
        const fullLength = getTextLength(fullText)

        if (visibleLength >= fullLength) {
          continue
        }

        next[id] = sliceText(fullText, visibleLength + TYPEWRITER_CHARS_PER_STEP)
        changed = true
      }

      return changed ? next : current
    })
  }, TYPEWRITER_INTERVAL_MS)

  return () => window.clearTimeout(timer)
}, [assistantFullTextById, hasTypewriterWork, visibleAssistantTextById])
```

这段逻辑的关键是让完整文本和可见文本分开。完整文本负责记录真实结果，可见文本只负责页面展示。两者分开以后，渲染体验就有了可以调节的空间。

### 6. 渲染可见文本

渲染消息时，用户消息照常展示完整内容；AI 新回复则优先展示 `visibleAssistantTextById` 里的可见文本。

code.ts

```tsx
const visibleMessageText =
  !isUser
    ? visibleAssistantTextById[message.id] ?? sliceText(messageText, TYPEWRITER_CHARS_PER_STEP)
    : messageText

return (
  <MessageResponse>
    {visibleMessageText}
  </MessageResponse>
)
```

这一步接上以后，即使 `messageText` 已经是完整回复，UI 也不会立刻把整段内容摆出来，而是按照本地节奏慢慢显示。

## Loading 配合

在模型还没有开始输出正文之前，页面需要有一个普通的 loading 气泡。否则用户点完发送以后，中间会有一小段空白等待，体验上会像是按钮没有反应。

code.ts

```tsx
function TypingBubble() {
  return (
    <div className="flex w-full items-start gap-3">
      <span className="mt-6 flex size-9 shrink-0 items-center justify-center rounded-full border border-violet-200 bg-violet-50 text-violet-700">
        <Bot className="size-4" />
      </span>
      <div className="flex min-w-0 max-w-[min(34rem,82%)] flex-col gap-1.5">
        <div className="flex items-center gap-2 text-xs font-medium text-violet-700">
          <Sparkles className="size-3.5" />
          <span>AI Assistant</span>
        </div>
        <div className="rounded-xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-800">
          <div className="flex items-center gap-2.5">
            <span className="text-slate-500">正在回复</span>
            <div className="flex items-center gap-1">
              <span className="size-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-slate-400" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

显示条件可以这样判断：请求已经提交时显示；正在 streaming 但最新消息还不是 assistant 时显示；如果最新消息已经是 assistant，但还没有实际文本，也继续显示。

code.ts

```typescript
const shouldShowTypingBubble =
  status === "submitted" ||
  (status === "streaming" && latestMessage?.role !== "assistant") ||
  (status === "streaming" && latestMessage?.role === "assistant" && !latestAssistantText)
```

另外，AI SDK 有时会先插入一条空的 assistant 消息。如果这条空消息也渲染出来，页面上就会同时出现 loading 气泡和一条空的 `AI Assistant`。所以渲染消息时要把空 assistant 过滤掉：

code.ts

```typescript
if (!isUser && !messageText.trim()) {
  return null
}
```

## 方案收益

这套方案的收益主要体现在稳定性上。后端仍然是真实的流式输出，能早到达的 token 或文本片段会尽早写给前端；前端也不会被动等待链路中每一层都完美透传，而是自己控制最终展示出来的节奏。

它还有一个很实际的好处：不会依赖模型服务一定按 token 返回。哪怕某次返回的 chunk 比较大，或者某个代理层把响应攒了一下，用户看到的仍然是逐字展开的回复。配合 `Array.from` 之后，中文、emoji 这类 Unicode 字符也不容易被切坏。

loading 气泡和真实回复之间也做了过滤，不会重复出现两条 `AI Assistant`。这些细节单独看都不大，但合在一起，聊天区会自然很多。

## 总结

Web 端 AI 逐字输出，不能只看接口有没有 stream。更稳妥的做法，是把后端传输和前端显示拆开处理。

后端负责尽早把模型 token 或文本片段写出来，前端负责把最终可见内容按照合适的节奏展示出来。这样即使链路中某一层发生缓冲，用户看到的仍然是符合聊天产品预期的逐字输出体验。
