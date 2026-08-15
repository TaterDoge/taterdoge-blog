---
title: "98 Queues 与 Cron 定时任务"
pubDate: 2026-05-12
description: "前面所有章节讲的都是「用户请求 → Worker 处理 → 返回响应」。但真实 AI 项目里有一类工作不由用户请求触发："
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/23-queues-and-cron/](https://aicompanion.usehook.cn/23-queues-and-cron/)

## 1. AI 项目里的「不由用户触发」的工作

前面所有章节讲的都是「用户请求 → Worker 处理 → 返回响应」。但真实 AI 项目里有一类工作**不由用户请求触发**：

- **后台异步任务**：用户上传了 100 份文档，你不能让他在浏览器里等 10 分钟 embedding 跑完

- **定时任务**：每小时把过去一小时的 token 用量汇总到日表，每天凌晨清理过期 session

- **解耦重活**：用户请求立即返回「已接收」，真正的 LLM 调用、R2 归档、向量索引在后台慢慢做

- **失败可重试**：第三方 API 偶发 429/500，直接返回给用户就是用户承担，扔进队列系统自动重试更友好

Cloudflare 在 Workers 生态里提供了两个互补的工具：

| 工具 | 触发方式 | 典型用途 |
| --- | --- | --- |
| Cron Triggers | 按 cron 表达式定时触发 | 汇总、清理、定时同步 |
| Queues | Worker 往里塞消息，另一个 Worker 异步消费 | 耗时任务解耦、重试、批量处理 |

这一篇讲怎么在 Hono + Workers 里用这两个工具。

## 2. Cron Triggers：最简单的定时任务

Cron Triggers 就是给你的 Worker 加一个「时间驱动」的入口。你在 `wrangler.jsonc` 里写 cron 表达式，Cloudflare 按时调用你 Worker 的 `scheduled()` 方法。

### 2.1 配置

wrangler.jsonc

```jsonc
{
  "triggers": {
    "crons": [
      // 每小时 07 分跑一次（避开整点峰值）
      "7 * * * *",
      // 每天 UTC 03:30 跑一次
      "30 3 * * *"
    ]
  }
}
```

注意：**Cron Triggers 用的是 UTC 时间**，不是你本地时间。中国用户写定时任务记得先减 8 小时。

### 2.2 Hono + Cron：写 scheduled 入口

Hono 的 `app` 对象本身只处理 `fetch`。要加 cron 入口，需要包一层自定义的默认导出：

src/index.ts

```typescript
import { Hono } from 'hono'
import { dailyUsageRollup, cleanupExpiredSessions } from './cron/jobs'

type Bindings = {
  DB: D1Database
  USAGE_KV: KVNamespace
}

const app = new Hono<{ Bindings: Bindings }>()

// 正常的 HTTP 路由
app.get('/', (c) => c.text('OK'))

// 包装默认导出，把 fetch 和 scheduled 放在一起
export default {
  fetch: app.fetch,
  // scheduled 不经过 Hono，所以没有 c（Context）
  // env 和 ctx 从函数参数直接拿
  async scheduled(
    controller: ScheduledController,  // Workers 内置类型
    env: Bindings,
    ctx: ExecutionContext              // Workers 内置类型
  ) {
    // 根据 cron 表达式分发到不同任务
    switch (controller.cron) {
      case '7 * * * *':
        ctx.waitUntil(dailyUsageRollup(env))
        break
      case '30 3 * * *':
        ctx.waitUntil(cleanupExpiredSessions(env))
        break
    }
  },
}
```

几个关键点：

- **`controller.cron`**：触发时的 cron 字符串，用来分发

- **`ctx.waitUntil()`**：和前面 AI Gateway 里用的一样——"先返回，但后台等这个 Promise 跑完再关"。多个任务可以并发 `waitUntil`，不必串行 `await`

- **为什么 env 从参数拿**：`scheduled` 不走 Hono 的路由系统，没有 `c`（Hono Context），所以 `env` 要从函数参数拿，不是从 `c.env` 拿

### 2.3 一个真实的定时任务：token 用量每小时汇总

第 18 篇的 AI 网关把每次请求的 token 消耗写进 KV，每小时聚合一次到 D1 日表（用 `onConflictDoUpdate` 反复刷新当天这一行）就是典型的 cron 场景：

src/cron/jobs.ts

```typescript
import { drizzle } from 'drizzle-orm/d1'
import { usageDaily } from '../db/schema'

export async function dailyUsageRollup(env: {
  DB: D1Database
  USAGE_KV: KVNamespace
}) {
  const db = drizzle(env.DB)
  const today = new Date().toISOString().slice(0, 10)

  // 列出所有用户的当天用量（KV 里按前缀扫）
  const list = await env.USAGE_KV.list({ prefix: `usage:` })

  for (const key of list.keys) {
    // key 格式：usage:<apiKeyId>:<date>
    const parts = key.name.split(':')
    if (parts.length !== 3 || parts[2] !== today) continue

    const apiKeyId = parts[1]
    const record = await env.USAGE_KV.get<{
      totalRequests: number
      totalPromptTokens: number
      totalCompletionTokens: number
    }>(key.name, 'json')

    if (!record) continue

    // 写进 D1 的日表
    await db.insert(usageDaily).values({
      apiKeyId,
      date: today,
      requests: record.totalRequests,
      promptTokens: record.totalPromptTokens,
      completionTokens: record.totalCompletionTokens,
    }).onConflictDoUpdate({
      target: [usageDaily.apiKeyId, usageDaily.date],
      set: {
        requests: record.totalRequests,
        promptTokens: record.totalPromptTokens,
        completionTokens: record.totalCompletionTokens,
      },
    })
  }
}
```

cron 跑完之后，你在 D1 里就有一张「每用户每日用量」表，做报表、算账单都很方便。KV 依然保留用于实时查询，D1 是历史的「真相源」。

### 2.4 本地触发 cron

Cron 在 `wrangler dev` 里不会自动触发。用这个端点手动触发一次：

terminal

```shellscript
curl "http://localhost:8787/__scheduled?cron=7+*+*+*+*"
```

`cron=` 参数用 `+` 代替空格，告诉 wrangler 触发哪条规则。

## 3. Queues：异步任务队列

Cron 解决的是「什么时候做」。Queues 解决的是「怎么把做事情本身从用户请求里剥离出去」。

### 3.1 生产者 / 消费者模型

Queues 是经典的发布-订阅：

- **Producer**（生产者）：通常是处理用户请求的 Worker，调用 `queue.send(msg)` 往队列塞消息

- **Consumer**（消费者）：另一个 Worker（或同一个），通过 `queue()` handler 批量接收消息

两个 Worker 之间不直接调用——生产者只需要「把事情扔出去」，消费者慢慢吃就行。失败可以自动重试，队列里的消息不会丢。

### 3.2 创建队列和配置

terminal

```shellscript
npx wrangler queues create rag-ingest
```

配置（可以生产者和消费者在同一个 Worker，也可以分开）：

wrangler.jsonc

```jsonc
{
  "queues": {
    "producers": [
      {
        "queue": "rag-ingest",
        "binding": "INGEST_QUEUE"
      }
    ],
    "consumers": [
      {
        "queue": "rag-ingest",
        "max_batch_size": 10,       // 一次最多攒 10 条
        "max_batch_timeout": 5,     // 或者等 5 秒就发一批
        "max_retries": 3,           // 失败重试 3 次
        "dead_letter_queue": "rag-ingest-dlq"
      }
    ]
  }
}
```

`dead_letter_queue`（DLQ，死信队列）是处理失败超过 `max_retries` 次后的兜底。比如一条消息重试了 3 次都失败，它不会直接丢掉，而是被转到 DLQ 里。你可以之后排查原因、手动重跑。建议配上，不然失败的消息就真丢了。

### 3.3 生产者：从请求里分离重活

以 RAG 系统为例。用户上传一批文档，你不想让他等 embedding 跑完才回 200：

src/routes/upload.ts

```typescript
import { Hono } from 'hono'

type Bindings = {
  INGEST_QUEUE: Queue<IngestJob>
}

interface IngestJob {
  docId: string
  text: string
  tenantId: string
}

const upload = new Hono<{ Bindings: Bindings }>()

upload.post('/documents', async (c) => {
  const { docs, tenantId } = await c.req.json<{
    docs: Array<{ id: string; text: string }>
    tenantId: string
  }>()

  // 不在这里做 embedding（可能要几秒到几十秒）
  // 只是把「要做的事」塞进队列，立即返回
  for (const doc of docs) {
    await c.env.INGEST_QUEUE.send({
      docId: doc.id,
      text: doc.text,
      tenantId,
    })
  }

  return c.json({
    accepted: docs.length,
    message: '已接收，正在后台处理',
  }, 202)
})

export default upload
```

注意 HTTP 状态码 `202 Accepted`——「我收到了，但还没做完」。这是异步任务接口的标准语义。

### 3.4 消费者：真正干活

消费者的 handler 接收的是一个 `batch`，里面有若干条消息：

src/consumers/ingest.ts

```typescript
interface IngestJob {
  docId: string
  text: string
  tenantId: string
}

type Env = {
  AI: Ai
  DOCS_INDEX: Vectorize
}

export async function ingestConsumer(
  batch: MessageBatch<IngestJob>,
  env: Env
) {
  // 1. 批量生成 embedding（一次调用比一条一条调便宜很多）
  const texts = batch.messages.map((m) => m.body.text)
  const { data: embeddings } = await env.AI.run(
    '@cf/baai/bge-base-en-v1.5',
    { text: texts }
  )

  // 2. 组装写入向量数据库
  const vectors = batch.messages.map((m, i) => ({
    id: m.body.docId,
    values: embeddings[i],
    namespace: m.body.tenantId,
    metadata: {
      text: m.body.text,
    },
  }))

  try {
    await env.DOCS_INDEX.upsert(vectors)
    // 批量 ack：告诉 Queue 这一批都成功了
    for (const msg of batch.messages) msg.ack()
  } catch (err) {
    // 整批重试。也可以逐条 retry() 做更精细的控制
    for (const msg of batch.messages) msg.retry({ delaySeconds: 30 })
  }
}
```

几个关键 API：

- **`msg.ack()`**：确认这条消息已处理，从队列里删除

- **`msg.retry({ delaySeconds })`**：扔回队列稍后重试（可以指定延迟）

- **默认行为**：handler 正常返回就算全部成功；抛异常就整批重试

### 3.5 把消费者挂到 Worker 入口

Queue 消费者通过 `queue()` handler 挂到 Worker 默认导出：

src/index.ts

```typescript
import { Hono } from 'hono'
import { ingestConsumer } from './consumers/ingest'
import upload from './routes/upload'

const app = new Hono()
app.route('/upload', upload)

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch, env: any, ctx: ExecutionContext) {
    // 通过 queue 名字分发到不同 consumer
    if (batch.queue === 'rag-ingest') {
      return ingestConsumer(batch, env)
    }
  },
}
```

一个 Worker 可以同时是多个队列的消费者，根据 `batch.queue` 分发就行。

## 4. Cron 还是 Queue？

两个工具的定位差别清晰：

| 用 Cron | 用 Queue |
| --- | --- |
| 定时、周期性、和用户请求无关的事 | 由某次用户请求触发、但不想让用户等的事 |
| 没有状态（每次从头扫一遍数据） | 有状态（每条消息是独立任务） |
| 失败就等下次再跑 | 失败要重试、要 DLQ |
| 汇总、清理、同步 | 处理上传、调外部 API、批量计算 |

一条经验：**如果数据量可能变大，Cron 里扫全表的写法迟早超时**（Cron 单次最多 30 秒 CPU）。这时候 Cron 只负责「把待处理的任务塞进 Queue」，真正处理交给 Queue 消费者——这是一个常见的组合模式。

### 4.1 Cron + Queue 的组合实战

用户表有 100 万条，每天要检查他们的订阅是否过期。单次 Cron 扫不完：

src/cron/jobs.ts

```typescript
export async function checkSubscriptions(env: {
  DB: D1Database
  CHECK_QUEUE: Queue<{ userId: number }>
}) {
  const db = drizzle(env.DB)

  // Cron 只做「分发」，每 1000 条用户推一批到队列
  let lastId = 0
  while (true) {
    const batch = await db
      .select({ id: users.id })
      .from(users)
      .where(gt(users.id, lastId))
      .limit(1000)
      .all()

    if (batch.length === 0) break

    // 批量 send（一次 API 调用塞多条）
    await env.CHECK_QUEUE.sendBatch(
      batch.map((u) => ({ body: { userId: u.id } }))
    )
    lastId = batch[batch.length - 1].id
  }
}
```

Queue 消费者再慢慢跑——100 万条可以花几小时处理，用户无感知。

## 5. 常用姿势与陷阱

### 5.1 消息去重（幂等）

Queue 的交付语义是 **at-least-once（至少投递一次）**——同一条消息可能被投递多次（网络抖动、消费者超时都可能导致）。所以消费者逻辑必须是**幂等的**：同一条消息处理两次，结果和处理一次一样，不会产生副作用。

最常见的做法：消息体里带一个业务唯一 ID，消费前先查「这个 ID 处理过了吗」：

src/consumers/ingest.ts

```typescript
const seen = await env.KV.get(`processed:${msg.body.docId}`)
if (seen) {
  msg.ack()
  continue
}
// ... 实际处理 ...
await env.KV.put(`processed:${msg.body.docId}`, '1', { expirationTtl: 86400 })
msg.ack()
```

### 5.2 按条 retry vs 整批 retry

`msg.retry()` 针对单条，`throw` 会让整批都重试。规则很简单：

- **部分失败**：只 retry 失败的那几条，ack 成功的

- **系统性失败**（DB 连不上、模型全挂）：直接抛异常，整批重试更合理

### 5.3 Delay：延迟任务

`msg.retry({ delaySeconds })` 和 `queue.send(body, { delaySeconds })` 都支持延迟，单位秒。「30 分钟后再检查订单支付状态」这种场景直接用它：

src/routes/order.ts

```typescript
await c.env.CHECK_PAYMENT_QUEUE.send(
  { orderId: '123' },
  { delaySeconds: 30 * 60 }
)
```

## 6. 小结

Cron Triggers 按时间触发 `scheduled()` handler，适合汇总、清理这类周期性的事。Queues 是消息队列，生产者发、消费者收，支持批量处理、自动重试、DLQ。

两个经常配合用：Cron 负责把大任务切成小任务扔进 Queue，Queue 慢慢消费。用户请求里但凡不需要立即返回结果的重活（embedding、归档、调外部 API），都可以扔给 Queue，先回 202 再说。
