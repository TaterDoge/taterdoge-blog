---
title: "91 流式响应与 SSE"
pubDate: 2026-05-10
description: "我们之前写的所有接口，都遵循同一个模式：前端发请求 → 后端处理 → 后端把结果一次性返回。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/16-streaming-and-sse/](https://aicompanion.usehook.cn/16-streaming-and-sse/)

## 1. 普通请求的问题

我们之前写的所有接口，都遵循同一个模式：前端发请求 → 后端处理 → 后端把结果一次性返回。

这个模式在大多数场景下没问题。查一个用户信息，后端几十毫秒就查完了，一次性返回一个 JSON，前端拿到直接渲染。

但有些场景不适用。最典型的就是 AI 大模型。

你在 ChatGPT 上输入一个问题，回答不是"啪"一下全部出现的，而是一个字一个字地往外蹦，像打字一样。这背后的原因是：大模型生成文本是逐 token 进行的（token 大致可以理解为一个字或词），一段 500 字的回复可能要花 5-10 秒才能全部生成完。

如果等全部生成完再一次性返回，用户就得盯着空白页面干等好几秒，体验很差。更好的做法是：**生成一个 token 就发一个 token**，让用户立刻看到内容逐步出现。

这就是"流式响应"——服务端不是攒够了所有数据再发，而是边生成边发，数据像水流一样持续地从服务端流向客户端。

除了 AI 对话，还有一些场景也需要流式响应：

- 大文件下载（不可能把几百 MB 的文件全部加载到内存再发）

- 实时数据推送（股票行情、日志监控、通知提醒）

- 长时间运行的任务汇报进度

## 2. Hono 的三种流式 API

Hono 提供了三种流式响应方式，适用于不同场景：

| API | 用途 | Content-Type |
| --- | --- | --- |
| streamText | 文本流（逐段发送文本） | text/plain |
| stream | 二进制流（文件下载、转发） | 自定义 |
| streamSSE | Server-Sent Events（结构化事件流） | text/event-stream |

我们从最简单的 `streamText` 开始，逐步讲到最常用的 `streamSSE`。

## 3. streamText：最简单的文本流

`streamText` 用于逐段发送纯文本。先看后端怎么写：

src/index.ts

```typescript
import { Hono } from 'hono'
import { streamText } from 'hono/streaming'

const app = new Hono()

app.get('/stream', (c) => {
  return streamText(c, async (stream) => {
    for (const chunk of ['Hello', ' ', 'World', '!']) {
      await stream.write(chunk)
      await stream.sleep(100)
    }
  })
})

export default app
```

跟普通接口用 `return c.json(...)` 一次性返回不同，这里用 `streamText` 开启了一个流式响应。回调函数里的 `stream` 对象就是你的"出水口"：

- `stream.write('Hello')` —— 立刻把 `'Hello'` 发给客户端，不等后面的内容

- `stream.sleep(100)` —— 等 100 毫秒再继续（模拟逐步生成的效果）

所以客户端收到的数据是分四次到达的：先收到 `Hello`，100ms 后收到一个空格，再 100ms 后收到 `World`，最后收到 `!`。

### 前端怎么消费流

普通接口用 `await res.json()` 就能拿到数据，但流式响应不行——因为数据是分批到达的，没办法一次性解析。

前端需要用 `ReadableStream` 来逐块读取。你可以把它想象成一个水龙头：你不知道总共有多少水，只能一直接，直到水龙头关了。

client.ts

```typescript
async function consumeStream() {
  const response = await fetch('/stream')

  // 1. 从 response.body 获取一个 reader（读取器）
  const reader = response.body!.getReader()

  // 2. TextDecoder 用于把二进制数据转成字符串
  const decoder = new TextDecoder()

  // 3. 循环读取，每次拿到一块数据
  while (true) {
    const { done, value } = await reader.read()

    // done 为 true 表示流结束了（水龙头关了）
    if (done) break

    // value 是 Uint8Array（二进制），需要解码成字符串
    const text = decoder.decode(value, { stream: true })

    // 把拿到的文本追加到页面上
    document.getElementById('output')!.textContent += text
  }
}
```

这个模式第一次见会觉得陌生，但核心就三步：**拿 reader → 循环 read → 处理每一块数据**。后面的 SSE 也是类似的套路。

## 4. stream：二进制流

`stream` 是更底层的 API，适合文件下载、大文件转发等场景。

src/index.ts

```typescript
import { stream } from 'hono/streaming'

app.get('/download', (c) => {
  return stream(c, async (stream) => {
    // 从远程拉取大文件，直接转发给客户端
    const res = await fetch('https://example.com/large-file')
    await stream.pipe(res.body!)
  })
})
```

`stream.pipe()` 把一个 `ReadableStream` 的数据直接转发到响应流。文件不需要先全部下载到内存，边收边发，内存占用很低。

你也可以手动设置响应头：

src/index.ts

```typescript
app.get('/download', (c) => {
  c.header('Content-Type', 'application/octet-stream')
  c.header('Content-Disposition', 'attachment; filename="data.zip"')

  return stream(c, async (stream) => {
    const res = await fetch('https://example.com/data.zip')
    await stream.pipe(res.body!)
  })
})
```

## 5. SSE：Server-Sent Events

前面的 `streamText` 能逐段发送文本，但它只是"一坨一坨"地发数据，客户端收到的就是原始文本片段，没有任何结构。

实际应用中，你经常需要区分不同类型的消息。比如一个 AI 聊天接口，流式返回的内容可能包括：正文文本、思考过程、工具调用结果、结束信号。前端需要知道每一块数据"是什么类型的"，才能分别处理。

SSE（Server-Sent Events）就是为这种场景设计的。它是 HTTP 协议原生支持的**结构化事件流**。

### SSE 的数据长什么样

SSE 不是什么新协议，它就是普通的 HTTP 响应，只不过 `Content-Type` 设为 `text/event-stream`，响应体按照特定的文本格式组织。

每一条消息（事件）长这样：

SSE

```txt
event: message
id: 1
data: 你好

event: message
id: 2
data: 世界

event: done
id: 3
data: [DONE]
```

格式规则很简单：

- 每个字段占一行，格式是 `字段名: 值`

- `data` 是消息内容（必填）

- `event` 是事件类型（可选，前端用它区分不同类型的消息）

- `id` 是消息编号（可选，用于断线重连）

- 消息之间用一个空行分隔

这就是 SSE 的全部协议。没有二进制编码，没有握手过程，就是纯文本。

### SSE vs WebSocket

你可能听说过 WebSocket，它也能做服务端推送。两者的区别：

|  | SSE | WebSocket |
| --- | --- | --- |
| 方向 | 单向（服务端 → 客户端） | 双向 |
| 协议 | 普通 HTTP | 独立的 ws:// 协议 |
| 自动重连 | 浏览器原生支持 | 需要自己实现 |
| 复杂度 | 非常简单 | 相对复杂 |
| 适用场景 | AI 流式输出、通知推送、实时数据展示 | 聊天室、协同编辑、游戏 |

如果你只需要服务端往客户端推数据（比如 AI 回答），SSE 就够了，简单得多。AI 大模型的流式接口（OpenAI、Claude 等）几乎全部用的 SSE 格式。

### 后端发送 SSE

Hono 用 `streamSSE` 发送 SSE 事件：

src/index.ts

```typescript
import { streamSSE } from 'hono/streaming'

app.get('/sse', (c) => {
  return streamSSE(c, async (stream) => {
    let id = 0
    while (true) {
      await stream.writeSSE({
        data: JSON.stringify({ time: Date.now() }),
        event: 'tick',
        id: String(id++),
      })
      await stream.sleep(1000)
    }
  })
})
```

`writeSSE` 会自动把你传入的对象格式化成 SSE 文本格式。上面每次调用实际发出去的内容就是：

code.ts

```txt
event: tick
id: 0
data: {"time":1714000000000}

```

### 前端消费 SSE

浏览器原生提供了 `EventSource` API，专门用来接收 SSE：

client.ts

```typescript
// 创建 SSE 连接（和 fetch 不同，EventSource 会自动保持连接）
const source = new EventSource('/sse')

// 监听 'tick' 类型的事件（对应后端 writeSSE 里的 event 字段）
source.addEventListener('tick', (e) => {
  const data = JSON.parse(e.data)
  console.log('服务端时间:', data.time)
})

// 连接建立时触发
source.addEventListener('open', () => {
  console.log('SSE 连接已建立')
})

// 连接出错时触发（浏览器会自动尝试重连，不需要你处理）
source.addEventListener('error', (e) => {
  console.log('SSE 连接出错，浏览器将自动重连')
})

// 不想接收了，手动关闭
// source.close()
```

`EventSource` 的好处：

- **自动重连**：网络断了浏览器会自动重连，不用你写重试逻辑

- **事件分类**：后端发 `event: tick`，前端就用 `addEventListener('tick', ...)` 接收，不同类型的消息互不干扰

但 `EventSource` 有一个限制：**只支持 GET 请求**。你不能在创建连接的时候发送请求体（body）。这对于 AI 聊天场景是个问题——你需要用 POST 把用户的消息发给后端。解决办法是用 `fetch` 手动解析 SSE 格式，下面会讲到。

## 6. 实战：对接 AI 大模型

最常见的流式场景：前端发消息，后端调大模型 API，把回答逐字转发给前端。

整个数据流是这样的：

code.ts

```txt
前端 --POST 消息--> 你的 Hono 服务 --POST 消息--> OpenAI/Claude API
前端 <--SSE 转发-- 你的 Hono 服务 <--SSE 响应-- OpenAI/Claude API
```

你的 Hono 服务在中间起"转发"作用：收到大模型返回的 SSE 流，解析出文本内容，再用 `streamSSE` 转发给前端。

### 后端：转发大模型的 SSE 流

src/index.ts

```typescript
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

const app = new Hono<{ Bindings: { OPENAI_API_KEY: string } }>()

app.post('/chat', async (c) => {
  const { messages } = await c.req.json()

  // 调用 OpenAI，开启 stream 模式
  const response = await fetch(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${c.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        stream: true,  // 关键：告诉 OpenAI 用流式返回
      }),
    }
  )

  // OpenAI 返回的也是 SSE 格式的流
  // 我们需要逐行读取，提取文本内容，再转发给前端
  return streamSSE(c, async (stream) => {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let id = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // 把二进制数据解码成文本，追加到 buffer
      buffer += decoder.decode(value, { stream: true })

      // 按换行符拆分成多行
      const lines = buffer.split('\n')

      // 最后一行可能不完整（数据还没到齐），留到下一轮处理
      buffer = lines.pop() || ''

      for (const line of lines) {
        // OpenAI 的 SSE 每行以 'data: ' 开头
        if (!line.startsWith('data: ')) continue

        const data = line.slice(6) // 去掉 'data: ' 前缀
        if (data === '[DONE]') return // 结束信号

        // 解析 JSON，提取生成的文本片段
        const parsed = JSON.parse(data)
        const content = parsed.choices[0]?.delta?.content
        if (content) {
          // 转发给前端
          await stream.writeSSE({
            data: content,
            event: 'message',
            id: String(id++),
          })
        }
      }
    }
  })
})
```

这段代码看起来比较长，核心逻辑其实就两步：

- 用 `reader.read()` 循环读取 OpenAI 返回的 SSE 流

- 从每行 `data: ...` 中提取文本，用 `writeSSE` 转发给前端

中间那个 `buffer` 的处理是为了应对一个现实问题：网络传输的数据不一定是按行完整到达的，一次 `read()` 拿到的可能是半行数据，所以需要一个缓冲区来拼接。

### 前端：消费聊天流

因为要用 POST 发送用户消息，不能用 `EventSource`（它只支持 GET），所以用 `fetch` + `reader` 手动解析 SSE：

client.ts

```typescript
async function chat(messages: Array<{ role: string; content: string }>) {
  const response = await fetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })

  // 和前面 streamText 的消费方式一样：拿 reader，循环读
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let result = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const text = decoder.decode(value, { stream: true })

    // 手动解析 SSE 格式：找到 'data: ' 开头的行，提取内容
    const lines = text.split('\n')
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const content = line.slice(6)
      result += content
      // 更新页面上的文字，实现"打字机"效果
      document.getElementById('chat')!.textContent = result
    }
  }
}
```

前端的消费模式和第 3 节 `streamText` 几乎一样，只是多了一步 SSE 格式的解析（找 `data:` 开头的行）。

## 7. 三种流的选择

简单总结：

- **只是逐段发文本**，用 `streamText`，前端用 `fetch` + `reader` 消费

- **转发文件或二进制数据**，用 `stream` + `pipe`

- **需要事件类型、自动重连、或对接 AI 模型**，用 `streamSSE`

对于 AI 应用，`streamSSE` 是最常用的。它和大模型 API 的 SSE 格式天然匹配，前端消费也最方便。

下一篇我们讲**项目结构与环境管理**，看看一个正式的 Hono 项目该怎么组织代码和管理环境变量。
