---
title: "97 Durable Objects 与 WebSocket"
pubDate: 2026-05-12
description: "到这一步为止，我们写的 Hono + Workers 代码都是无状态的：每个请求落到哪个节点是随机的，两个相邻的请求之间没有共享内存。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/22-durable-objects-websocket/](https://aicompanion.usehook.cn/22-durable-objects-websocket/)

## 1. Workers 的「状态短板」与 Durable Objects

到这一步为止，我们写的 Hono + Workers 代码都是**无状态**的：每个请求落到哪个节点是随机的，两个相邻的请求之间没有共享内存。

这个模型简单、好扩展，但它也有明显的盲区：

- **AI 会话记忆**：多轮对话需要一个「始终保留同一份对话历史」的地方

- **WebSocket 长连接**：连接本身是有状态的，不能被随机路由

- **实时协作**：多个用户同时在线编辑文档、在同一个会议室里，需要协调

- **精确计数/限流**：按秒/毫秒级限流的计数器，KV 的最终一致性搞不定

**Durable Objects（DO）** 就是为这些场景准备的。它是 Cloudflare 提供的「有身份的 Worker」：

- 每个 Object 有一个**全局唯一的 ID**，相同 ID 一定路由到同一个实例

- 实例有**内存状态**（重启之前一直保留）

- 有**强一致的持久化存储**（`ctx.storage`），写入立即可读

- 支持 **WebSocket 长连接**，而且有专门的 Hibernation API 降低成本

普通 Worker 你可以理解成纯函数——进来一个请求，处理完就没了。DO 更像一个类的实例——有自己的 ID、有内存、有持久化存储，每次找它都是同一个。

## 2. 第一个 Durable Object：计数器

我们从一个最小的例子开始——一个按「房间 ID」分片的计数器。

### 2.1 定义 DO 类

src/rooms.ts

```typescript
// cloudflare:workers 是 Cloudflare Workers 的内置模块，不是 npm 包
import { DurableObject } from 'cloudflare:workers'

export class Counter extends DurableObject {
  async increment(): Promise<number> {
    // ctx.storage 是这个 Object 独占的强一致存储
    const current = (await this.ctx.storage.get<number>('count')) ?? 0
    const next = current + 1
    await this.ctx.storage.put('count', next)
    return next
  }

  async get(): Promise<number> {
    return (await this.ctx.storage.get<number>('count')) ?? 0
  }
}
```

几个要点：

- `DurableObject` 是 Cloudflare 提供的基类，从 `cloudflare:workers` 导入

- `this.ctx.storage` 是这个实例独占的持久化存储（不是全局共享的）

- 类上的方法可以被 Worker 远程调用（Cloudflare 把这叫 RPC，Remote Procedure Call），后面会看到调用方式

### 2.2 在 wrangler.jsonc 里配置

wrangler.jsonc

```jsonc
{
  "durable_objects": {
    "bindings": [
      {
        "name": "COUNTER",
        "class_name": "Counter"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["Counter"]
    }
  ]
}
```

- `durable_objects.bindings` 告诉 Worker 这个名字对应哪个类

- `migrations.new_sqlite_classes` 声明这是个**新的 SQLite-backed DO 类**（推荐的新格式，比旧的 KV-backed 更便宜）

### 2.3 在 Hono 里调用

src/index.ts

```typescript
import { Hono } from 'hono'
import { Counter } from './rooms'

type Bindings = {
  COUNTER: DurableObjectNamespace<Counter>  // Workers 内置类型，不需要 import
}

const app = new Hono<{ Bindings: Bindings }>()

app.post('/rooms/:roomId/click', async (c) => {
  const roomId = c.req.param('roomId')

  // 1. 从 roomId 得到一个稳定的 DO ID
  const id = c.env.COUNTER.idFromName(roomId)
  // 2. 拿到这个 DO 的 stub（可以理解成远程引用）
  const stub = c.env.COUNTER.get(id)
  // 3. 调用它的方法，和调用本地对象一样
  const count = await stub.increment()

  return c.json({ roomId, count })
})

app.get('/rooms/:roomId/count', async (c) => {
  const roomId = c.req.param('roomId')
  const stub = c.env.COUNTER.get(c.env.COUNTER.idFromName(roomId))
  const count = await stub.get()
  return c.json({ roomId, count })
})

// 必须 export DO 类，Workers 运行时才认得
export { Counter }
export default app
```

**关键机制**：`idFromName(roomId)` 对同一个字符串永远返回同一个 ID，也就永远路由到同一个实例。所以 `rooms/abc/click` 和 `rooms/abc/count` 一定落到同一个 Counter 实例，计数不会错乱。

`stub.increment()` 底层是一次跨节点的远程调用，但写法和调本地对象一样——你不需要关心这个 Counter 实例跑在全球哪个节点上。

## 3. WebSocket：AI 聊天的长连接

WebSocket 是 DO 最有代入感的用法。流式响应用 SSE 已经够用，但有些场景离不开双向通信：

- 语音对话（前端流式上传音频，后端流式推送识别结果 + 回答）

- 多端同步（用户在手机上发的消息，桌面同时更新）

- 协作式 AI（多个用户一起和 AI 对话）

Workers 的普通 fetch handler 不处理 WebSocket，必须用 DO。

### 3.1 Hibernatable WebSocket：一定要用的 API

Cloudflare 对 WebSocket 有两种 API：传统的 `accept()` 和 **Hibernatable 版本** `acceptWebSocket()`。两者的关键差别：

- **传统版**：连接期间 DO 实例必须常驻内存，**空闲也按时间计费**

- **Hibernatable**：DO 可以在没消息时进入休眠，**休眠期间不计费**，有消息到来时自动唤醒

对于「用户打开着一个聊天页面但 20 分钟没说话」这种场景，Hibernatable 每月能省掉绝大部分费用。新项目直接用 Hibernatable 就行。

### 3.2 最小的聊天 DO

src/chat-room.ts

```typescript
import { DurableObject } from 'cloudflare:workers'

type Env = { AI: Ai }

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export class ChatRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    // 1. 必须是 WebSocket upgrade 请求
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    // 2. 创建一对 WebSocket
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // 3. Hibernatable 模式接收服务端一侧
    this.ctx.acceptWebSocket(server)

    // 4. 返回客户端一侧给上游
    return new Response(null, { status: 101, webSocket: client })
  }

  // Hibernatable 版本的消息处理器（注意不是 addEventListener）
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return

    const userMsg: ChatMessage = { role: 'user', content: message }

    // 取出历史消息
    const history = (await this.ctx.storage.get<ChatMessage[]>('history')) ?? []
    history.push(userMsg)

    // 调 LLM
    const result = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: history,
    })

    // Workers AI 文本生成返回 { response: string }，类型声明比较宽泛所以要断言一下
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: (result as { response: string }).response,
    }
    history.push(assistantMsg)

    // 保存历史
    await this.ctx.storage.put('history', history)

    // 把回答推给客户端
    ws.send(JSON.stringify(assistantMsg))
  }

  async webSocketClose(ws: WebSocket, code: number) {
    // 连接关闭时的清理逻辑
    console.log(`WebSocket closed with code ${code}`)
  }
}
```

这个 DO 做到了三件事：

- 接受 WebSocket 连接（Hibernatable 模式）

- 每条消息都存进持久化的历史

- 每条消息都触发一次 LLM 调用，把回答发回去

**没有内存里的事件监听器**——Hibernatable 模式下 Cloudflare 运行时帮你处理，实例可以随时被换出内存。

### 3.3 Hono 侧的 upgrade 入口

src/index.ts

```typescript
import { Hono } from 'hono'
import { ChatRoom } from './chat-room'

type Bindings = {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>
  AI: Ai
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/chat/:userId', async (c) => {
  // 每个用户一个独立的 ChatRoom
  const userId = c.req.param('userId')
  const id = c.env.CHAT_ROOM.idFromName(userId)
  const stub = c.env.CHAT_ROOM.get(id)

  // 把 upgrade 请求直接转给 DO，DO 自己处理 101 响应
  return stub.fetch(c.req.raw)
})

export { ChatRoom }
export default app
```

前端用标准的 `WebSocket` API 就能连：

client.ts

```typescript
const ws = new WebSocket('wss://your-worker.workers.dev/chat/alice')

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  console.log('AI:', msg.content)
}

ws.send('你好，介绍一下 Cloudflare Workers')
```

## 4. 实战：多人聊天室

单用户的场景其实用不上「多连接」。真正发挥 DO 价值的是「多个人在同一个房间里」——比如几个人一起和一个 AI Agent 开会。

src/meeting-room.ts

```typescript
import { DurableObject } from 'cloudflare:workers'

type Env = { AI: Ai }

export class MeetingRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const username = url.searchParams.get('user') ?? 'anon'

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // serializeAttachment 把数据附加到这个连接上
    // DO 休眠再唤醒后，用 deserializeAttachment 能拿回来
    server.serializeAttachment({ username })

    this.ctx.acceptWebSocket(server)

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return

    const { username } = ws.deserializeAttachment() as { username: string }
    const payload = JSON.stringify({ from: username, text: message })

    // 广播给房间里所有其他连接
    for (const client of this.ctx.getWebSockets()) {
      if (client === ws) continue
      try {
        client.send(payload)
      } catch {
        // 客户端掉线时可能报错，忽略即可
      }
    }
  }
}
```

关键 API：

- **`serializeAttachment` / `deserializeAttachment`**：给每个连接挂自定义数据。因为 DO 可能休眠再唤醒，内存变量会丢失，但 attachment 会被序列化保留

- **`ctx.getWebSockets()`**：拿到这个 DO 当前所有活跃的 WebSocket 连接，遍历一下就能做广播

## 5. Alarms：给 DO 加定时器

DO 还有一个相当实用的功能：**Alarms**。它允许你给这个实例设一个「几分钟/几小时后叫醒我」的闹钟，到点了 Cloudflare 会调用 `alarm()` 方法。

典型用途：AI 会话的「不活跃自动归档」。

src/chat-room.ts

```typescript
export class ChatRoom extends DurableObject<Env> {
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // ... 处理消息 ...

    // 每次有消息，就把「闹钟」推到 30 分钟后
    await this.ctx.storage.setAlarm(Date.now() + 30 * 60 * 1000)
  }

  async alarm() {
    // 30 分钟没消息了，归档历史并重置
    const history = await this.ctx.storage.get('history')
    if (history) {
      await archiveToR2(history)  // 保存到 R2
      await this.ctx.storage.delete('history')
    }
  }
}
```

Alarms 可以替代很多 cron 的小场景——它精确到单个 DO 实例，比全局定时任务更灵活。

## 6. 计费和注意事项

DO 的计费模型和普通 Worker 不同：

- **请求费**：每百万请求 $0.15（付费版），和 Worker 一个量级

- **Duration（时长）**：DO 在内存里活跃时按 **GB-s** 计费。Hibernatable WebSocket 在休眠期间**不计时长**

- **Storage（存储）**：SQLite-backed DO 按行和字节计费，比老的 KV-backed 便宜一个量级

新建 DO 一律用 SQLite-backed 类（`new_sqlite_classes`），原因：便宜 + 未来迁移友好 + 支持 SQL 查询（`ctx.storage.sql`）。

### 6.1 什么时候不要用 DO

DO 不是什么都适合做，有几个明显不该用的场景：

- **全局单例计数器**：DO 同一时间只能有一个实例，一个 Object 每秒几千请求就会变成瓶颈。要做「全站访客统计」用 Analytics Engine，不是 DO

- **任意键值缓存**：用 KV 或 Cache API，DO 比它们贵

- **大规模数据存储**：单个 DO 的 storage 有上限（10 GB），大库用 D1

怎么判断用不用 DO？看你的数据有没有自然的分片键。房间 ID、用户 ID、会话 ID、文档 ID——这些都适合。没有自然分片键的场景（比如全站汇总统计）通常不适合。

## 7. 小结

DO 的核心就三件事：

- `idFromName(string)` 让相同名字永远路由到同一个实例

- 实例有内存状态 + 强一致的持久化存储（`ctx.storage`）

- Hibernatable WebSocket 让长连接在空闲时不花钱

对 AI 应用来说，最常见的用法是：每个用户或每个房间一个 DO 实例，存对话历史，用 WebSocket 做双向通信，用 Alarms 做会话超时归档。
