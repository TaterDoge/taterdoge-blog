---
title: "15 Streaming"
pubDate: 2026-04-17
description: "第八篇文章分析管线延迟时，我们得出一个关键结论：LLM 生成占总延迟的 7080%，是整条链路的绝对瓶颈。具体数字是 5002000ms 才能拿到完整回复，这还只是中等长度的回答——如果 AI 伴侣要输出一段 200 字的安慰话，等待时间可"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-07-29
---
原文链接：[https://aicompanion.usehook.cn/13-streaming-response-architecture/](https://aicompanion.usehook.cn/13-streaming-response-architecture/)

## 1. 为什么需要流式输出

第八篇文章分析过对话管线的延迟，其中 LLM 生成通常会占总耗时的 70-80%。一段中等长度的完整回复需要等待 500-2000ms，如果 AI 伴侣要生成约 200 字的安慰内容，等待时间还可能超过 3 秒。

LLM 并不是先生成完整答案，再一次性返回。它会逐 token 生成内容，每隔几十毫秒产生一个 token，直到遇到结束标记。第一个 token 可能在 200ms 内就已经可用，如果服务端仍然等待全部内容生成完毕，用户就会额外等待 1-2 秒。

流式输出会在 token 生成后立即传给客户端，让用户从等待完整回复，变成直接看到文字逐步出现。

从首字节时间来看，两种模式存在明显差异：

| 模式 | 首字节时间 | 用户感知 |
| --- | --- | --- |
| 非流式（等完整回复） | 1500-3000ms | "它在想什么？卡了吗？" |
| 流式（逐 token 推送） | 200-500ms | "它在说话了" |

对于实时对话产品，流式输出不是额外的视觉效果，而是控制用户感知延迟的基础能力。

人的阅读速度大约是每秒 5-8 个汉字，而 LLM 通常每秒可以生成 30-80 个 token，约合 15-40 个汉字。生成速度高于阅读速度时，持续追加文字可以明显减轻等待感，也更接近自然的打字过程。

对于 AI 伴侣产品，逐字出现还有一层交互价值。它接近真人聊天时对方正在输入的状态，能够维持对话的连续感。一次性展示整段文字虽然更直接，却容易让回复显得像一条静态通知。

## 2. SSE 协议

### 2.1 为什么选 SSE

服务端向前端持续推送数据时，常见方案包括 HTTP Streaming、SSE 和 WebSocket：

| 维度 | HTTP Streaming | SSE（Server-Sent Events） | WebSocket |
| --- | --- | --- | --- |
| 方向 | 单向（服务端 → 客户端） | 单向（服务端 → 客户端） | 双向 |
| 协议 | HTTP/1.1 chunked | HTTP/1.1，text/event-stream | 独立协议（ws://） |
| 自动重连 | 无 | 浏览器内置 | 需手动实现 |
| 事件类型 | 无 | 支持 event 字段分类 | 自行约定 |
| 边缘环境兼容性 | 好 | 好 | 可用，但连接协调通常更复杂 |

AI 伴侣采用的是明确的请求与响应模式：用户发送一条消息，AI 返回一条回复。WebSocket 提供的双向通道在这个场景中没有得到充分利用，却需要额外处理连接管理、心跳和断线重连。如果后续还要在 Cloudflare Workers 上协调连接、维护房间状态或广播消息，通常还需要引入 Durable Objects，架构和成本都会随之增加。

SSE 和 HTTP Streaming 底层都可以使用 HTTP chunked transfer，但 SSE 在字节流之上定义了轻量的事件格式。服务端可以明确标记事件类型，前端也能按照协议解析数据，而不必自行约定所有边界。

### 2.2 SSE 协议格式

下面是一段完整的 SSE 响应报文：

response.txt

```txt
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

event: thinking
data: {"node": "memory_retrieval"}

event: token
data: {"content": "我"}

event: token
data: {"content": "记得"}

event: token
data: {"content": "你上次"}

event: done
data: {"emotion": "happy", "memories_used": 3}
```

理解 SSE 时，可以先记住四条基本规则。

第一，响应头必须使用 `Content-Type: text/event-stream`。浏览器据此把响应识别为持续推送的事件流，不会等待整个响应结束，而是在收到完整事件后立即交给调用方处理。

第二，每条事件由若干 `字段: 值` 行组成。常用字段包括 `event`、`data` 和 `id`，分别表示事件类型、数据负载和用于断线重连的事件 ID。字段名与冒号之间没有空格，冒号和值之间保留一个空格。

第三，事件之间使用空行，也就是 `\n\n` 分隔。解析器遇到双换行时，就可以确认一条完整事件已经结束。

第四，`data` 字段可以跨越多行。多个 `data:` 行会使用 `\n` 拼接成一个字符串，不过在本文的 LLM 流式场景中，每条事件只使用一个 `data` 行。

`event` 字段可以把思考、生成、完成和错误四种状态明确区分开。前端根据事件类型切换对应的 UI，不需要再从连续字节流中推测当前阶段。相比之下，裸 HTTP Streaming 只提供连续数据，事件分类和边界规则都需要应用自行定义。

## 3. 三层流式管线

完整的流式响应可以分为生成、传输和渲染三个层次。

**生成层**由 LangGraph 和 LLM 组成，负责逐 token 产生内容。它向外提供一个异步迭代器，每次 `yield` 一个 token 或状态事件。

**传输层**运行在 Hono 和 Workers 中，负责把生成层输出转换为 SSE 格式，并通过 HTTP 持续发送给客户端。超时、异常捕获和连接中断检测也在这一层处理。

**渲染层**位于 React 前端，负责消费 SSE 流并更新界面，包括增量文本拼接、Markdown 渲染和状态切换动画。

三层之间的数据流是单向的：

pipeline.txt

```txt
LangGraph 节点执行
    ↓ yield { type: 'node_start', node: 'memory_retrieval' }
    ↓ yield { type: 'node_end', node: 'memory_retrieval' }
    ↓ yield { type: 'node_start', node: 'llm_generate' }
    ↓ yield { type: 'token', content: '我' }
    ↓ yield { type: 'token', content: '记得' }
    ↓ ...
    ↓ yield { type: 'done', metadata: { emotion, memories_used } }
Hono SSE 中间层
    ↓ event: thinking\ndata: {...}
    ↓ event: token\ndata: {...}
    ↓ event: done\ndata: {...}
React 前端
    → 显示 "正在思考..."
    → 逐字追加文字
    → 完成，显示情绪标签
```

除了模型生成的 token，管线节点的执行状态也会进入事件流。前端不必一直展示静态 loading，而是可以根据事件提示用户当前正在检索记忆、组织语言或开始回复。

接下来从服务端开始实现这条流式管线。

## 4. Hono 流式接口

### 4.1 普通响应与流式响应

实现接口之前，我们先比较普通 HTTP 响应与流式响应的执行方式。

普通响应会先在服务端准备好全部数据，再一次性写入 Response body。浏览器拿到完整响应后才开始处理。

normal.ts

```typescript
// 普通响应：等 LLM 生成完毕，一次性返回
app.post('/chat', async (c) => {
  const { message } = await c.req.json()
  const reply = await callLLM(message)  // 阻塞 1-3 秒
  return c.json({ reply })               // 全部完成后才返回
})
```

在这种方式下，用户发送消息后需要等待 1-3 秒，随后一次性看到完整回复。

流式响应会先返回 Response Header，再持续、分块地向 body 写入数据。浏览器每收到一块内容就可以立即处理，不必等待全部生成完成。

streaming.ts

```typescript
// 流式响应：边生成边返回
app.post('/chat/stream', async (c) => {
  const { message } = await c.req.json()
  // 立即返回响应头，body 持续写入
  return streamSSE(c, async (stream) => {
    const llmStream = await callLLM(message, { stream: true })
    for await (const chunk of llmStream) {
      await stream.writeSSE({           // 每个 token 立即推送
        event: 'token',
        data: JSON.stringify({ content: chunk.text })
      })
    }
  })
})
```

用户发送消息后，大约 200ms 就可以看到文字开始出现，后续内容再随着模型生成持续追加。

两者的关键区别在于 Response 的创建时机。普通响应会等数据准备完成后再创建 Response，流式响应则先创建一个可以持续写入的 Response，再逐步向其中发送数据。`streamSSE` 创建的 body 是一个 WritableStream，服务端可以随时写入新的 SSE 事件。

### 4.2 streamSSE API

Hono 提供 `streamSSE` 函数来创建 SSE 响应。下面先看一个最小示例：

minimal.ts

```typescript
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

const app = new Hono()

app.get('/hello-stream', async (c) => {
  return streamSSE(c, async (stream) => {
    // stream 对象是你和前端之间的管道
    // 通过 writeSSE 方法往管道里写入 SSE 事件

    await stream.writeSSE({
      event: 'greeting',
      data: '你好'
    })

    // 模拟延迟
    await stream.sleep(1000)

    await stream.writeSSE({
      event: 'greeting',
      data: '世界'
    })
  })
  // 回调函数执行完毕后，流自动关闭
})

export default app
```

`streamSSE(c, callback)` 接收两个参数。

第一个参数 `c` 是 Hono Context，也就是当前请求的上下文。`streamSSE` 使用它创建 Response，并自动设置 `Content-Type: text/event-stream`、`Cache-Control: no-cache` 和 `Connection: keep-alive`。

第二个参数 `callback` 是一个接收 `stream` 对象的异步函数。服务端通过这个对象向前端写入事件，它提供三个常用方法：

| 方法 | 作用 |
| --- | --- |
| stream.writeSSE({ event, data, id }) | 写入一条 SSE 事件 |
| stream.sleep(ms) | 暂停指定时间（不阻塞 Workers） |
| stream.close() | 手动关闭流 |

`writeSSE` 接收一个对象，其中 `event` 是字符串形式的事件类型，`data` 是字符串形式的数据负载，`id` 是可选的事件 ID。`data` 必须是字符串，因此发送 JSON 时需要先调用 `JSON.stringify`。

callback 正常 return 或执行到末尾后，流会自动关闭，前端的 `reader.read()` 会返回 `{ done: true }`。如果 callback 抛出未捕获异常，连接同样会结束，但前端无法获得具体原因。因此，服务端需要在 callback 内部捕获异常，并通过 `error` 事件明确通知前端。

### 4.3 定义事件协议

实现完整接口前，需要先定义前后端共同遵守的事件协议。服务端根据管线状态发送事件，前端再依据事件类型更新 UI。

events.ts

```typescript
// 管线阶段事件：告诉前端当前执行到了哪个节点
interface ThinkingEvent {
  type: 'thinking'
  node: string       // 'safety_check' | 'memory_retrieval' | 'llm_generate' | ...
  status: 'start' | 'end'
}

// 文本生成事件：LLM 逐 token 输出
interface TokenEvent {
  type: 'token'
  content: string    // 一个或多个字符
}

// 完成事件：对话成功结束，携带元信息
interface DoneEvent {
  type: 'done'
  emotion: string
  memoriesUsed: number
  tokensConsumed: number
}

// 错误事件：出了问题，附带兜底回复
interface ErrorEvent {
  type: 'error'
  code: string       // 'safety_blocked' | 'llm_timeout' | 'internal_error'
  message?: string
  fallbackReply?: string  // 兜底话术，前端直接展示即可
}

type StreamEvent = ThinkingEvent | TokenEvent | DoneEvent | ErrorEvent
```

这里把业务决策放在服务端，前端只负责渲染。收到 `thinking` 时显示加载状态，收到 `token` 时追加文字，收到 `done` 时结束本轮生成，收到 `error` 时展示兜底回复。安全拦截、情绪路由和降级策略都不需要在前端重复判断。

`fallbackReply` 用来处理不需要用户额外操作的错误。例如发生安全拦截时，前端可以直接展示“这个话题我们换个方向聊聊吧~”，而不是弹出“您的消息违规”一类生硬的错误提示。

### 4.4 封装统一的 LLM 流式调用

DeepSeek、OpenAI 和 Claude 都支持流式输出，但响应格式并不完全一致。可以在服务层封装统一接口，让上层管线不依赖具体的模型提供商。

以 OpenAI 兼容格式为例，DeepSeek 也使用这种格式。请求设置 `stream: true` 后，API 会立即返回 SSE 响应流，并在生成 token 时逐条推送事件：

llm-response.txt

```txt
data: {"choices": [{"delta": {"content": "我"}}]}

data: {"choices": [{"delta": {"content": "记得"}}]}

data: {"choices": [{"delta": {"content": "你"}}]}

data: [DONE]
```

每个 `data:` 行都包含一段 JSON，其中 `delta.content` 是本次新增的文本片段，`data: [DONE]` 表示生成结束。

这里使用 AsyncGenerator 封装解析过程。它适合处理内容持续产生、调用方持续消费的场景，上层代码可以通过 `for await...of` 逐个读取结果：

llm.ts

```typescript
// AsyncGenerator 函数：用 async function* 声明，内部用 yield 逐个产出结果
// 调用方用 for await...of 消费
async function* callLLMStream(
  systemPrompt: string,
  userMessage: string,
  apiKey: string
): AsyncGenerator<string> {
  // 第一步：发起 HTTP 请求，开启流式模式
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      stream: true  // 关键：开启流式返回
    })
  })

  // 第二步：拿到响应体的 ReadableStream，逐块读取
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    // reader.read() 每次返回一块数据（Uint8Array）
    // done=true 表示流结束
    const { done, value } = await reader.read()
    if (done) break

    // 第三步：将二进制数据解码为文本，拼接到缓冲区
    // stream: true 告诉 decoder 后续还有数据，不要丢弃不完整的多字节字符
    buffer += decoder.decode(value, { stream: true })

    // 第四步：按行切分，解析 SSE 数据
    // LLM 返回的也是 SSE 格式，所以我们要在服务端解析它
    const lines = buffer.split('\n')
    // 最后一行可能不完整，保留到下次处理
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      // 跳过空行和非 data 行
      if (!line.startsWith('data: ')) continue
      // [DONE] 是流结束标记
      if (line === 'data: [DONE]') return

      // 第五步：解析 JSON，提取文本内容
      const json = JSON.parse(line.slice(6))  // 去掉 'data: ' 前缀
      const content = json.choices?.[0]?.delta?.content
      if (content) {
        yield content  // 产出一个文本片段，调用方立即收到
      }
    }
  }
}
```

解析过程中有两个细节需要特别注意。

首先是 buffer。网络数据按 chunk 到达，一个 chunk 可能包含多条 SSE 事件，也可能在某条事件中间结束。例如 `data: {"choices": [{"delta": {"con` 只是一段尚未完成的数据。按 `\n` 切分后，最后一段需要保留，并与下一个 chunk 拼接后再解析。

其次是 `decoder.decode(value, { stream: true })`。中文使用多字节编码，UTF-8 下一个汉字占 3 个字节，而 chunk 可能正好在字符字节中间截断。设置 `stream: true` 后，TextDecoder 会暂存不完整的字节序列，等待下一块数据，而不是直接报错或产生乱码。

完成封装后，上层代码只需要遍历生成器：

usage.ts

```typescript
// 消费方式：像遍历数组一样简单
for await (const text of callLLMStream(systemPrompt, message, apiKey)) {
  console.log(text)  // 依次输出："我"、"记得"、"你"、...
}
```

### 4.5 完整管线实现

接下来把前面的能力组合成完整接口。它会依次完成安全检查、记忆检索与情绪读取、Prompt 组装、LLM 流式生成、完成事件发送和异步后处理。

chat.ts

```typescript
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

type Bindings = {
  KV: KVNamespace
  DB: D1Database
  VECTORIZE: VectorizeIndex
  AI: Ai
  DEEPSEEK_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.post('/chat/stream', async (c) => {
  const { message, sessionId } = await c.req.json()

  return streamSSE(c, async (stream) => {
    try {
      // ========== 阶段 1：安全检查 ==========
      await stream.writeSSE({
        event: 'thinking',
        data: JSON.stringify({ node: 'safety_check', status: 'start' })
      })

      const safetyResult = await runSafetyCheck(message)

      if (!safetyResult.safe) {
        // 安全拦截：不走后续管线，直接返回兜底话术
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            code: 'safety_blocked',
            fallbackReply: '这个话题我们换一个方向聊聊吧~'
          })
        })
        return  // 直接结束，流自动关闭
      }

      await stream.writeSSE({
        event: 'thinking',
        data: JSON.stringify({ node: 'safety_check', status: 'end' })
      })

      // ========== 阶段 2：记忆检索 + 情绪读取（并行） ==========
      await stream.writeSSE({
        event: 'thinking',
        data: JSON.stringify({ node: 'memory_retrieval', status: 'start' })
      })

      // 这两个操作互不依赖，用 Promise.all 并行执行
      // 记忆检索约 50-150ms，情绪读取约 5-15ms
      // 并行后总耗时 = max(150, 15) = 150ms，而非 150+15=165ms
      const [memories, emotion] = await Promise.all([
        retrieveMemories(c.env, message, sessionId),
        readEmotion(c.env, sessionId)
      ])

      await stream.writeSSE({
        event: 'thinking',
        data: JSON.stringify({ node: 'memory_retrieval', status: 'end' })
      })

      // ========== 阶段 3：Prompt 组装 ==========
      // 把记忆、情绪、人设拼装成完整的 System Prompt
      // 这一步是纯 CPU 计算，耗时 < 1ms，不需要 thinking 事件
      const systemPrompt = assemblePrompt(memories, emotion)

      // ========== 阶段 4：LLM 流式生成 ==========
      await stream.writeSSE({
        event: 'thinking',
        data: JSON.stringify({ node: 'llm_generate', status: 'start' })
      })

      // callLLMStream 返回 AsyncGenerator，不会阻塞
      // 真正的等待发生在 for await 的第一次迭代（等待首个 token）
      const llmStream = callLLMStream(
        systemPrompt, message, c.env.DEEPSEEK_API_KEY
      )

      let fullReply = ''

      for await (const text of llmStream) {
        fullReply += text
        // 每个 token 立即推送给前端，不做缓冲
        await stream.writeSSE({
          event: 'token',
          data: JSON.stringify({ content: text })
        })
      }

      // ========== 阶段 5：发送完成事件 ==========
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          emotion: emotion.current,
          memoriesUsed: memories.length,
          tokensConsumed: fullReply.length
        })
      })

      // ========== 阶段 6：异步后处理 ==========
      // waitUntil 告诉 Workers："HTTP 响应已经发完了，
      // 但请保持进程存活，直到这个 Promise 完成"
      // 这样情绪更新、记忆写入等操作不会因为流关闭而被中断
      c.executionCtx.waitUntil(
        postProcess(c.env, sessionId, message, fullReply, emotion)
      )

    } catch (err) {
      // 兜底：任何未预期的异常都通过 error 事件通知前端
      // 前端收到后展示 fallbackReply，不会白屏
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          code: 'internal_error',
          fallbackReply: '抱歉，我刚才走神了，你再说一次好吗？'
        })
      })
    }
  })
})
```

这段代码与第八篇文章中的管线 DAG 相对应。DAG 描述节点之间的依赖关系，代码则负责落实这些关系。例如，记忆检索与情绪读取可以并行执行，在这里通过 `Promise.all` 实现。

示例采用手动编排，执行顺序和 `thinking` 事件的位置都直接写在代码中，便于观察每一步的调用过程。实际项目更适合使用 LangGraph 的 `on_chain_start`、`on_chain_end` 回调自动发送 `thinking` 事件，这样调整管线拓扑时，不必再同步修改事件推送代码。

### 4.6 waitUntil：Workers 环境下的异步后处理

`c.executionCtx.waitUntil()` 是 Cloudflare Workers 提供的异步任务 API。

普通 Node.js 服务器发送 HTTP 响应后，进程仍会继续运行，后台异步操作可以照常执行。Workers 属于 Serverless 环境，响应结束后，运行时可能开始回收当前执行环境。如果在 `streamSSE` callback 结束后才启动 `setTimeout` 或未 await 的 Promise，这些任务可能在完成前被终止。

`waitUntil(promise)` 会把后台任务交给 Workers 运行时管理。即使响应已经发送完成，执行环境也会继续保留，直到这个 Promise resolve。

waituntil.ts

```typescript
// 异步后处理函数：在响应发出后执行
async function postProcess(
  env: Bindings,
  sessionId: string,
  userMessage: string,
  aiReply: string,
  emotion: EmotionState
) {
  // 这三个操作互不依赖，并行执行
  await Promise.all([
    // 根据本轮对话更新情绪状态
    updateEmotion(env, sessionId, userMessage, aiReply),
    // 从对话中提取记忆片段，写入向量库
    extractAndWriteMemories(env, sessionId, userMessage, aiReply),
    // 更新亲密度分值
    updateIntimacy(env, sessionId, emotion)
  ])
}
```

这对应第八篇文章中的异步路径。情绪更新、记忆写入和亲密度更新会影响后续对话，但不需要阻塞当前回复，因此适合在响应发送后执行。

## 5. 前端流式渲染

### 5.1 消费 SSE 流

前端通过 `fetch` 读取 SSE 流。`EventSource` 更适合直接建立 GET 连接，而 `fetch` 支持 POST 请求、自定义 Header 和 JSON body，因此更符合当前的对话接口。

消费过程包括发起请求、逐块读取和解析事件三个步骤。

useChat.ts

```tsx
function useStreamChat() {
  const [status, setStatus] = useState<'idle' | 'thinking' | 'generating' | 'done'>('idle')
  const [thinkingNode, setThinkingNode] = useState('')
  const [reply, setReply] = useState('')
  const [metadata, setMetadata] = useState<{ emotion: string } | null>(null)

  const sendMessage = useCallback(async (message: string) => {
    setStatus('thinking')
    setReply('')
    let hasDone = false
    let partialReply = ''

    // 第一步：发起 POST 请求
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId: getSessionId() })
    })

    // 第二步：获取 ReadableStream 的 reader
    // 和服务端的 callLLMStream 一样，用 reader 逐块读取
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    // 第三步：循环读取，解析 SSE 事件
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // 解析缓冲区中所有完整的 SSE 事件
      const { parsed, remaining } = parseSSEEvents(buffer)
      buffer = remaining

      // 根据事件类型更新 UI 状态
      for (const event of parsed) {
        switch (event.type) {
          case 'thinking':
            setThinkingNode(event.data.node)
            break
          case 'token':
            setStatus('generating')
            partialReply += event.data.content
            setReply(prev => prev + event.data.content)
            break
          case 'done':
            hasDone = true
            setStatus('done')
            setMetadata(event.data)
            break
          case 'error':
            hasDone = true
            setStatus('done')
            setReply(event.data.fallbackReply ?? '出错了，请重试')
            break
        }
      }
    }

    // 流结束后，不要读取闭包里可能过期的 React state
    // 用局部变量判断是否正常收到了 done / error 事件
    if (!hasDone) {
      if (partialReply.length > 0) {
        setReply(prev => prev + '\n\n[回复未完成，点击重试]')
      } else {
        setReply('网络不太稳定，请重新发送消息')
      }
      setStatus('done')
    }
  }, [])

  return { status, thinkingNode, reply, metadata, sendMessage }
}
```

`parseSSEEvents` 负责从缓冲区中提取完整事件。它与服务端解析 LLM 响应的逻辑相似，使用双换行 `\n\n` 分隔事件，并把最后一段尚未完成的内容留到下一个 chunk。下面的实现只覆盖本文使用的单个 `data:` 行和 JSON 字符串场景，没有处理 SSE 规范中的多行 `data:` 拼接：

parser.ts

```typescript
function parseSSEEvents(buffer: string) {
  const events: Array<{ type: string; data: any }> = []
  const parts = buffer.split('\n\n')
  const remaining = parts.pop() ?? ''

  for (const part of parts) {
    if (!part.trim()) continue
    let eventType = 'message'
    let data = ''

    for (const line of part.split('\n')) {
      if (line.startsWith('event: ')) eventType = line.slice(7)
      else if (line.startsWith('data: ')) data = line.slice(6)
    }

    if (data) {
      events.push({ type: eventType, data: JSON.parse(data) })
    }
  }

  return { parsed: events, remaining }
}
```

### 5.2 UI 状态分段展示

前端根据 `status` 展示思考、生成和完成三种界面状态：

ChatBubble.tsx

```tsx
function AIBubble({ status, thinkingNode, reply, metadata }: AIBubbleProps) {
  return (
    <div className="flex gap-3 items-start">
      <Avatar emotion={metadata?.emotion} />
      <div className="flex-1 space-y-2">
        {/* 思考阶段：显示当前执行的管线节点 */}
        {status === 'thinking' && (
          <ThinkingIndicator node={thinkingNode} />
        )}

        {/* 生成阶段：逐字显示回复 + 光标闪烁 */}
        {(status === 'generating' || status === 'done') && (
          <div className="prose prose-sm">
            <MarkdownRenderer content={reply} />
            {status === 'generating' && <BlinkingCursor />}
          </div>
        )}

        {/* 完成后：显示情绪标签 */}
        {status === 'done' && metadata && (
          <EmotionTag emotion={metadata.emotion} />
        )}
      </div>
    </div>
  )
}
```

`ThinkingIndicator` 负责把内部管线节点转换成用户可以理解的提示语：

ThinkingIndicator.tsx

```tsx
const nodeLabels: Record<string, string> = {
  safety_check: '安全检查中',
  memory_retrieval: '回忆与你的过往',
  llm_generate: '组织语言中'
}

function ThinkingIndicator({ node }: { node: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-400">
      <LoadingDots />
      <span>{nodeLabels[node] ?? '思考中'}</span>
    </div>
  )
}
```

管线前置节点执行的 200-500ms 内，界面会显示“回忆与你的过往”等状态提示，而不是保持空白。LLM 开始产生 token 后，UI 再切换到逐字显示模式。

## 6. 断流与容错

与普通请求相比，流式响应还要处理传输过程中的连接中断。断流后，用户可能只收到部分回复，情绪更新等后台任务也可能处在执行过程中。

### 6.1 三类断流场景

**网络中断。** 用户网络不稳定时，连接可能提前断开。此时 `stream.writeSSE()` 会抛出异常，而 LLM 可能仍在继续生成，但已经无法把内容发送给客户端。

**LLM 超时。** 当模型提供商响应变慢或服务降级时，`for await...of` 可能长时间收不到新的 chunk，客户端看到的回复会停在半句话。

**Workers 执行受限。** Cloudflare Workers 会限制 CPU 时间、请求生命周期和流式连接时长。管线执行时间过长，或者触发当前套餐与运行时限制时，响应可能中断。具体数值会随套餐和平台策略变化，实际设计应以官方文档为准。

### 6.2 服务端：滑动超时

LLM 流适合使用**滑动超时**。它不限制整段回复的总生成时间，而是限制相邻两个 token 之间的最大等待时间。即使一段长回复持续生成 20 秒，只要 token 仍在到达，就不会触发超时；只有长时间没有新 token 时，系统才认为当前流已经停滞。

timeout.ts

```typescript
async function forwardWithTimeout(
  stream: { writeSSE: Function; close: Function },
  llmIterator: AsyncGenerator<string>,
  gapMs: number = 15000  // 两个 token 之间最多等 15 秒
) {
  let timer: ReturnType<typeof setTimeout>

  const resetTimer = () => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          code: 'llm_timeout',
          fallbackReply: '我刚才想说的太多了，脑子有点转不过来...你能再说一次吗？'
        })
      })
      stream.close()
    }, gapMs)
  }

  resetTimer()  // 启动首次计时

  try {
    for await (const text of llmIterator) {
      resetTimer()  // 每收到一个 token，重置计时器
      await stream.writeSSE({
        event: 'token',
        data: JSON.stringify({ content: text })
      })
    }
  } finally {
    clearTimeout(timer)
  }
}
```

### 6.3 前端：优雅降级

前端在 `while` 循环结束后，需要判断是否收到 `done` 或 `error` 事件。这里不直接读取 React state，因为异步函数中的 state 可能来自旧闭包。使用局部变量记录结束状态和已经收到的内容，会更加可靠。

recovery.ts

```typescript
// 在 while 循环结束后追加
if (!hasDone) {
  // 流异常终止，没有收到 done / error 事件
  if (partialReply.length > 0) {
    // 已经有部分内容：保留已显示的文字，提示可重试
    setReply(prev => prev + '\n\n[回复未完成，点击重试]')
  } else {
    // 一个字都没收到：直接提示网络问题
    setReply('网络不太稳定，请重新发送消息')
  }
  setStatus('done')
}
```

如果已经收到部分回复，应当保留现有内容，并在末尾追加重试提示。用户可能已经阅读了一部分文字，直接清空会让上下文突然消失。

### 6.4 幂等性保障

流式请求重试还可能造成重复后处理。用户收到部分回复后再次发送请求时，第一次请求注册的 `waitUntil` 任务可能已经开始执行，第二次请求又会触发相同操作，导致情绪更新和记忆写入重复执行。

可以为每条消息生成唯一的请求 ID，并把它作为异步后处理的幂等 key。后台任务开始前先检查该 ID 是否已经处理：

idempotent.ts

```typescript
async function postProcess(env: Bindings, requestId: string, /* ... */) {
  // 用 KV 做去重锁，TTL 5 分钟
  const lockKey = `post_process_lock:${requestId}`
  const existing = await env.KV.get(lockKey)
  if (existing) return  // 已经处理过，跳过

  await env.KV.put(lockKey, '1', { expirationTtl: 300 })

  await Promise.all([
    updateEmotion(env, /* ... */),
    writeMemories(env, /* ... */),
    updateIntimacy(env, /* ... */)
  ])
}
```

## 7. 总结

流式输出把首字节时间从非流式模式的 1500-3000ms 缩短到 200-500ms。SSE 使用 `event`、`data` 和空行组织事件，能够直接表达思考、生成、完成和错误状态，也适合在 Workers 环境中使用。与 WebSocket 相比，它更符合当前单向请求响应的通信方式。

服务端通过 Hono 的 `streamSSE` 先返回响应头，再持续向 body 写入事件。LLM 调用被封装为 AsyncGenerator，上层使用 `for await...of` 消费 token，并通过 `writeSSE` 立即转发。响应完成后，`waitUntil` 继续执行情绪更新和记忆写入，避免任务因连接关闭而中断。

可靠性处理需要覆盖整条链路。服务端通过滑动超时识别停滞的 token 流，前端在异常断流后保留已经收到的内容，异步后处理则依靠请求级幂等 key 避免重复写入。
