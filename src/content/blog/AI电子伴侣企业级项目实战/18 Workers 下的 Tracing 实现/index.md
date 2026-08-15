---
title: "18 Workers 下的 Tracing 实现"
pubDate: 2026-04-18
description: "上一篇我们已经把可观测性的核心概念讲清楚了：Trace 是一次请求的完整快照，Span 是每个节点的执行记录，degraded 状态用来标记「没有报错但效果变差」的情况。我们还对比了 LangSmith、Langfuse 和自建 Traci"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/15-workers-tracing-implementation/](https://aicompanion.usehook.cn/15-workers-tracing-implementation/)

## 1. 实现目标

上一篇介绍了可观测性的几个基本概念：Trace 是一次请求的完整快照，Span 记录每个节点的执行过程，`degraded` 用来标记没有报错、但执行效果已经变差的情况。我们也比较了 LangSmith、Langfuse 和自建 Tracing 三种方案各自适合的场景。

这一篇继续解决实现问题：如何在 Cloudflare Workers 环境中落地一套可用的 Tracing 系统。

开始设计之前，需要先了解 Cloudflare Workers 的运行环境。Workers 是边缘计算平台，代码会部署在全球数百个节点上，请求由距离用户较近的节点处理。这种模式降低了访问延迟，同时也带来了几项约束：

- **没有持久进程**：请求到达后 Worker 才开始执行，请求结束后实例可能被销毁，因此不能像传统服务器那样先在内存中积攒日志，再集中写入

- **执行时间有限**：CPU 时间存在上限，不适合在请求过程中执行大量计算

- **提供配套存储**：Cloudflare 提供 D1（关系型数据库）和 KV（键值存储）等服务，可以直接在 Worker 中访问

基于这些约束，这套 Tracing 实现需要满足四个目标：

- **每次请求生成唯一的 `traceId`**，用来把这次请求的所有信息串起来

- **每个管线节点自动记录输入、输出、耗时和状态**，减少开发者手动记录日志的工作

- **异常请求完整保留，正常请求按比例采样**，控制存储成本

- **写入过程不阻塞用户响应**，Tracing 不能拖慢业务

承担这些职责的核心对象是 `TraceContext`，它会贯穿一次请求的整个生命周期。

## 2. TraceContext 设计

### 2.1 职责边界

一次请求包含多个 Span，每个 Span 对应一个管线节点，例如安全检查、记忆检索或 LLM 生成。`TraceContext` 负责在请求执行期间收集和管理这些 Span。

它并不只是保存几条自由文本日志，而是把每个节点的执行过程转换成结构化的 Span。每当一个节点执行结束，`TraceContext` 都会追加一条记录，其中包含节点名称、耗时、输入、输出和状态。

### 2.2 Span 数据结构

我们先定义 Span 需要记录的字段。这些字段与上一篇介绍的 Span 结构保持一致：

span.ts

```typescript
interface Span {
  spanId: string            // 当前节点的唯一标识
  parentSpanId: string | null // 父节点 ID，用于构建树形结构
  name: string              // 节点名称，如 'memory_retrieval'
  startTime: number         // 开始执行的时间戳
  duration: number          // 执行耗时（毫秒）
  status: 'ok' | 'error' | 'degraded'  // 执行状态
  input: Record<string, any>   // 节点接收的输入
  output: Record<string, any>  // 节点产生的输出
  metadata: Record<string, any> // 额外的诊断信息
}
```

`parentSpanId` 用于表示 Span 之间的嵌套关系。例如，`memory_retrieval` 内部包含 `vector_search` 和 `structured_query` 两个子操作，它们可以通过 `parentSpanId` 指向父 Span。读取 Trace 时，便能据此还原完整的调用层级。

### 2.3 实现 TraceContext

定义好 Span 后，就可以实现 `TraceContext`。它提供一个 `span()` 方法，用来包装任意异步操作，并自动完成计时、状态判断和结果记录。

trace.ts

```typescript
class TraceContext {
  readonly traceId: string
  private spans: Span[] = []
  private startTime: number

  constructor(traceId?: string) {
    // 如果外部传入了 traceId 就用外部的，否则自动生成一个
    // 这在跨服务追踪时很有用：上游服务可以把 traceId 传下来
    this.traceId = traceId ?? crypto.randomUUID()
    this.startTime = Date.now()
  }

  // 核心方法：包装一个异步操作，自动记录为 Span
  // <T> 是 TypeScript 的泛型——意思是"返回类型取决于你传入的函数返回什么"
  // 比如 fn 返回 Promise<string>，那 span() 的返回值也是 Promise<string>
  async span<T>(
    name: string,
    input: Record<string, any>,
    fn: () => Promise<T>,
    parentSpanId?: string
  ): Promise<T> {
    const spanId = crypto.randomUUID()
    const start = Date.now()
    let status: Span['status'] = 'ok'
    let output: Record<string, any> = {}

    try {
      const result = await fn()
      output = { result }
      return result
    } catch (err) {
      status = 'error'
      output = { error: (err as Error).message }
      throw err  // 记录完错误后继续抛出，不吞掉异常
    } finally {
      // 无论成功还是失败，都会执行 finally 块
      // 确保这个 Span 一定会被记录下来
      this.spans.push({
        spanId,
        parentSpanId: parentSpanId ?? null,
        name,
        startTime: start,
        duration: Date.now() - start,
        status,
        input,
        output,
        metadata: {}
      })
    }
  }

  // 手动将某个已记录的 Span 标记为降级状态
  // 适用于"执行成功了，但结果不理想"的场景
  markDegraded(spanName: string, reason: string) {
    const span = this.spans.find(s => s.name === spanName)
    if (span) {
      span.status = 'degraded'
      span.metadata.degradeReason = reason
    }
  }

  // 判断是否有任何 Span 出错
  hasError(): boolean {
    return this.spans.some(s => s.status === 'error')
  }

  // 判断是否有任何 Span 降级
  hasDegraded(): boolean {
    return this.spans.some(s => s.status === 'degraded')
  }

  // 获取从创建到现在的总耗时
  get totalDuration(): number {
    return Date.now() - this.startTime
  }

  // 将整个 Trace 序列化为 JSON，方便存储和传输
  toJSON() {
    return {
      traceId: this.traceId,
      totalDuration: this.totalDuration,
      spanCount: this.spans.length,
      spans: this.spans
    }
  }
}
```

这个抽象能够降低节点接入 Tracing 的成本。开发者不必在每个节点中重复编写开始计时、结束计时、异常捕获和结构化输出等逻辑，只需要用 `trace.span()` 包装原来的函数调用。

### 2.4 接入 AI 管线

下面把 `TraceContext` 接入一条简单的 AI 管线。用户发送消息后，系统会依次执行安全检查、记忆检索和 LLM 生成：

usage.ts

```typescript
// 1. 在请求入口创建 TraceContext 实例
const trace = new TraceContext()

// 2. 用 trace.span() 包装每个管线节点
//    第一个参数是节点名称，第二个是输入数据，第三个是要执行的异步函数
const safetyResult = await trace.span(
  'input_safety_check',
  { message: userMessage },
  () => runSafetyCheck(userMessage)
)

const memories = await trace.span(
  'memory_retrieval',
  { query: userMessage, sessionId },
  () => retrieveMemories(env, userMessage, sessionId)
)

// 3. 根据执行结果，手动标记降级状态
//    记忆检索成功了（没报错），但结果为空，说明效果不理想
if (memories.length === 0) {
  trace.markDegraded('memory_retrieval', 'no_memories_found')
}

// 4. 后续节点继续用 trace.span() 包装...
const response = await trace.span(
  'llm_generation',
  { prompt: assembledPrompt },
  () => callLLM(assembledPrompt)
)
```

每次调用 `trace.span()`，都会自动记录对应节点的耗时、输入、输出和状态。原有函数本身不需要修改，业务代码只增加了一层包装。

AI 管线通常包含较多节点，而且每个节点都可能成为独立的诊断对象，因此这种包装方式很适合在管线中逐步接入。

## 3. 采样策略

### 3.1 控制存储成本

如果把所有 Trace 都完整写入数据库，存储成本会迅速增加。一条请求包含多个节点，每个节点还可能保存体积较大的 `input` 和 `output`。以 LLM 生成节点为例，`input` 是可能包含几千个 Token 的完整 Prompt，`output` 则是模型生成的完整回复。单条 Trace 可能达到几 KB，甚至几十 KB；当每天有几十万次请求时，累计开销会非常可观。

更适合实际项目的做法是：**异常请求全量保留，正常请求按比例采样**。

### 3.2 采样决策

采样函数会按照优先级判断一条 Trace 是否需要完整保存。如果不满足完整存储条件，就只保留一份轻量摘要。

sampling.ts

```typescript
// 采样配置
interface SamplingConfig {
  latencyP99Threshold: number  // 延迟阈值（毫秒），超过这个值视为异常慢
  normalSampleRate: number     // 正常请求的采样比例，如 0.05 表示 5%
}

// 采样决策结果
interface SampleDecision {
  store: 'full' | 'summary'   // 完整存储 or 仅存摘要
  destination: 'd1' | 'kv'    // 存到 D1 数据库 or KV 键值存储
}

function shouldSample(
  trace: TraceContext,
  config: SamplingConfig
): SampleDecision {
  // 规则 1：有错误的请求，必须完整保留
  // 这是最重要的数据，排查问题全靠它
  if (trace.hasError()) {
    return { store: 'full', destination: 'd1' }
  }

  // 规则 2：有降级的请求，也完整保留
  // 降级请求往往能解释"为什么回复质量变差了"
  if (trace.hasDegraded()) {
    return { store: 'full', destination: 'd1' }
  }

  // 规则 3：耗时异常高的请求，完整保留
  // 这些是性能问题的直接证据
  if (trace.totalDuration > config.latencyP99Threshold) {
    return { store: 'full', destination: 'd1' }
  }

  // 规则 4：正常请求按比例随机采样
  // 比如 normalSampleRate = 0.05，则只有 5% 的正常请求会被完整保存
  if (Math.random() < config.normalSampleRate) {
    return { store: 'full', destination: 'd1' }
  }

  // 规则 5：其余正常请求只存摘要
  return { store: 'summary', destination: 'kv' }
}
```

### 3.3 决策优先级

这套策略按照诊断价值决定数据的保留优先级：

- **错误请求必须保留**，它是排查 bug 的第一手证据

- **降级请求也要保留**，它通常能够解释回复质量为什么下降

- **超慢请求需要保留**，它可以为性能问题提供直接证据

- **正常请求只保留样本**，用于分析整体趋势

摘要通常只保留节点名称、耗时和状态，不保存详细的 `input` 与 `output`。这样可以把单条记录从 KB 级压缩到几十字节，更适合高频写入和聚合统计。

## 4. D1 与 KV 分层存储

### 4.1 存储选择

采样策略把 Trace 分为完整数据和摘要数据。两类数据的体积、查询方式和保留目的不同，因此适合使用不同的存储服务。

Cloudflare 提供的 D1 和 KV 分别具备以下特点：

- **D1** 是基于 SQLite 的关系型数据库，支持 SQL 查询，适合保存需要按条件检索的结构化数据，例如查询某个用户过去 24 小时内所有报错的 Trace

- **KV** 是全球分布式键值存储，读取速度很快，但只能通过 key 查找 value，不支持复杂查询，适合保存需要高频读写的简单数据

结合它们各自的特点，可以把存储职责划分为：

- **D1 存完整 Trace**：支持按用户、时间、状态等条件搜索，用于事后排查具体问题

- **KV 存高频摘要**：存放每分钟的请求总数、耗时分布、错误数等聚合数据，用于看系统整体健康度

### 4.2 D1 表结构

完整 Trace 写入 D1 时需要两张表。`traces` 保存一次请求的总体信息，`spans` 保存每个节点的执行细节。一个 Trace 包含多个 Span，因此这里使用典型的一对多结构。

schema.sql

```sql
-- traces 表：每条记录代表一次完整请求
CREATE TABLE traces (
  trace_id TEXT PRIMARY KEY,          -- 请求唯一标识
  user_id TEXT NOT NULL,              -- 用户 ID
  session_id TEXT NOT NULL,           -- 会话 ID
  total_duration INTEGER NOT NULL,    -- 请求总耗时（毫秒）
  has_error BOOLEAN DEFAULT FALSE,    -- 是否有节点报错
  has_degraded BOOLEAN DEFAULT FALSE, -- 是否有节点降级
  created_at TEXT NOT NULL            -- 创建时间
);

-- spans 表：每条记录代表一个管线节点的执行记录
CREATE TABLE spans (
  span_id TEXT PRIMARY KEY,           -- 节点唯一标识
  trace_id TEXT NOT NULL,             -- 关联的请求 ID
  parent_span_id TEXT,                -- 父节点 ID，用于还原树形调用层级
  name TEXT NOT NULL,                 -- 节点名称
  start_time INTEGER NOT NULL,        -- 开始时间戳，用于还原各节点的执行时序
  duration INTEGER NOT NULL,          -- 节点耗时（毫秒）
  status TEXT NOT NULL,               -- 状态：ok / error / degraded
  input TEXT,                         -- 输入数据（JSON 字符串）
  output TEXT,                        -- 输出数据（JSON 字符串）
  metadata TEXT,                      -- 诊断附加信息（JSON 字符串）
  FOREIGN KEY (trace_id) REFERENCES traces(trace_id)
);

-- 索引：加速常用的查询场景
CREATE INDEX idx_traces_user ON traces(user_id, created_at);
CREATE INDEX idx_traces_error ON traces(has_error, created_at);
CREATE INDEX idx_spans_trace ON spans(trace_id);
```

三个索引分别对应常用的查询场景：

- `idx_traces_user`：按照用户和时间查询，例如查看某个用户最近的请求

- `idx_traces_error`：按照错误状态和时间查询，例如查看最近 1 小时内所有报错的请求

- `idx_spans_trace`：按照 `trace_id` 查询所有 Span，用于展开某次请求的完整细节

### 4.3 写入完整 Trace

下面把一个 `TraceContext` 实例写入 D1。在 Workers 环境中，`env.DB` 是由 Cloudflare 绑定并注入的 D1 数据库实例，可以直接调用。

store-trace.ts

```typescript
async function storeFullTrace(
  env: { DB: D1Database },
  trace: TraceContext,
  userId: string,
  sessionId: string
) {
  const data = trace.toJSON()

  // 第一步：写入 traces 主表
  await env.DB.prepare(
    `INSERT INTO traces
      (trace_id, user_id, session_id, total_duration, has_error, has_degraded, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.traceId,
    userId,
    sessionId,
    data.totalDuration,
    data.spans.some(s => s.status === 'error'),
    data.spans.some(s => s.status === 'degraded'),
    new Date().toISOString()
  ).run()

  // 第二步：批量写入 spans 子表
  // 使用 env.DB.batch() 把多条插入合并为一次数据库操作，减少网络开销
  const stmt = env.DB.prepare(
    `INSERT INTO spans
      (span_id, trace_id, parent_span_id, name, start_time, duration, status, input, output, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  await env.DB.batch(
    data.spans.map(span =>
      stmt.bind(
        span.spanId,
        data.traceId,
        span.parentSpanId,
        span.name,
        span.startTime,
        span.duration,
        span.status,
        JSON.stringify(span.input),
        JSON.stringify(span.output),
        JSON.stringify(span.metadata)
      )
    )
  )
}
```

这里需要注意 `env.DB.batch()` 的作用：它会把多条 SQL 语句合并成一次数据库调用。如果一个 Trace 包含 8 个 Span，不使用 `batch` 就需要发起 8 次网络请求，使用后只需要 1 次。在边缘环境中，减少网络往返次数会直接改善写入性能。

### 4.4 写入摘要数据

对于不需要完整保存的正常请求，只在 KV 中更新聚合统计。`env.KV` 是 Cloudflare 绑定的 KV 存储实例。

store-summary.ts

```typescript
async function storeSummary(
  env: { KV: KVNamespace },
  trace: TraceContext
) {
  const data = trace.toJSON()
  // 以分钟为粒度生成 key，格式如 "metrics:2026-03-12T10:05"
  const minuteKey = `metrics:${new Date().toISOString().slice(0, 16)}`

  // 读取当前这一分钟已有的聚合数据
  const existing = await env.KV.get(minuteKey, 'json') as {
    requestCount: number
    errorCount: number
    degradedCount: number
    totalDuration: number
  } | null

  const current = existing ?? {
    requestCount: 0,
    errorCount: 0,
    degradedCount: 0,
    totalDuration: 0,
  }

  // 累加本次请求的统计
  current.requestCount += 1
  current.errorCount += data.spans.filter(s => s.status === 'error').length
  current.degradedCount += data.spans.filter(s => s.status === 'degraded').length
  current.totalDuration += data.totalDuration

  // 写回 KV，设置 24 小时过期（摘要数据不需要长期保留）
  await env.KV.put(minuteKey, JSON.stringify(current), {
    expirationTtl: 86400  // 24 小时后自动删除
  })
}
```

到这里，D1 和 KV 的职责就可以明确区分：

- **D1** 用于回答“某个用户的某次请求究竟发生了什么”，服务于事后排查

- **KV** 用于回答“最近 1 小时系统整体表现如何”，服务于实时监控

需要注意，上面的 `storeSummary` 采用先读后写的方式，因此存在并发竞态。如果两个请求同时读到同一份旧数据，各自累加后再写回 KV，其中一次计数就可能丢失。低流量场景下可以接受这种误差；在高并发场景中，可以改用 Cloudflare Durable Objects 这种支持单点强一致的边缘存储完成原子计数，也可以改成只写不聚合：每个请求写入独立的 KV key，再由定时任务统一汇总。

## 5. 使用 waitUntil 异步写入

### 5.1 避免阻塞主路径

Tracing 对排查问题很重要，但不应该因此增加用户的等待时间。

假设写入 D1 需要 50ms，写入 KV 需要 10ms。如果在返回响应之前完成这两次写入，每次请求都会额外增加 60ms。AI 伴侣的首字节时间本来就会受到 LLM 调用影响，通常需要 1 到 2 秒，再叠加存储写入只会让响应更慢。

### 5.2 waitUntil 的执行方式

Cloudflare Workers 提供了 `waitUntil` API。通过它可以告诉运行时：响应虽然已经返回，但当前 Worker 还有后台任务需要完成，暂时不要销毁实例。

普通的 Workers 请求按照下面的顺序执行：

- 请求到达 → 执行处理逻辑 → 返回响应 → Worker 可能被销毁

使用 `waitUntil` 后，流程会变为：

- 请求到达 → 执行处理逻辑 → 返回响应给用户

- 同时，`waitUntil` 中注册的后台任务继续执行

- 后台任务全部完成后，Worker 才会被销毁

此时，向用户返回响应和继续执行后台任务可以并行进行，用户不需要等待后台任务完成。

### 5.3 接入请求处理函数

下面把 Tracing 写入放进 `waitUntil`，接入完整的请求处理流程：

handler.ts

```typescript
// Env 类型声明了 Worker 绑定的外部资源
// 在 wrangler.toml 中配置 D1 和 KV 绑定后，Workers 运行时会自动注入这些对象
interface Env {
  DB: D1Database    // Cloudflare D1 关系型数据库
  KV: KVNamespace   // Cloudflare KV 键值存储
}

export default {
  // fetch 是 Workers 的入口函数，每次请求都会调用
  // request: 用户请求  env: 绑定的外部资源  ctx: 请求上下文（提供 waitUntil 等方法）
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // 1. 在请求入口创建 TraceContext
    const trace = new TraceContext()

    // 从请求中提取用户信息（实际项目中通常从 JWT token 或 session cookie 里解析）
    const { userId, sessionId } = await extractUserInfo(request)

    // 2. 执行 AI 管线（这是主路径，用户在等待这部分的结果）
    const response = await handleAIPipeline(request, env, trace)

    // 3. 采样决策
    const decision = shouldSample(trace, {
      latencyP99Threshold: 5000,  // 超过 5 秒视为异常
      normalSampleRate: 0.05      // 正常请求采样 5%
    })

    // 4. 把存储操作放进 waitUntil，不阻塞响应返回
    ctx.waitUntil(
      (async () => {
        try {
          if (decision.store === 'full') {
            // 完整写入 D1
            await storeFullTrace(env, trace, userId, sessionId)
          }
          // 无论是否完整存储，都更新 KV 中的聚合摘要
          await storeSummary(env, trace)
        } catch (err) {
          // Tracing 写入失败不应影响已返回的响应
          // 但需要记录下来，避免静默丢失
          console.error('Trace storage failed:', err)
        }
      })()
    )

    // 5. 立即返回响应，不等后台任务完成
    return response
  }
}
```

第 4 步中的 `ctx.waitUntil()` 接收一个 Promise。响应返回后，这个 Promise 中的代码仍会在后台继续执行。这样处理有三个直接收益：

- **不把数据库写入时间加到用户等待时间里**

- **降低可观测性系统对主链路的性能影响**

- **避免监控系统反过来拖慢业务系统**

### 5.4 后台写入风险

使用后台写入也意味着需要接受一种情况：主请求已经成功返回，但后台 Trace 仍有极小概率写入失败。例如 D1 暂时不可用，或者 Worker 在后台任务执行过程中被强制回收。

因此，示例代码使用 `try/catch` 捕获写入异常，保证失败时至少能够留下错误日志。随着系统逐步完善，还可以增加重试机制、失败计数和丢失率监控，用来观察 Tracing 系统自身的可靠性。

## 6. 总结

`TraceContext` 负责统一收集每个节点的结构化记录，`span()` 方法则自动完成计时、状态判断和结果记录，让各个节点可以用较低成本接入 Tracing。

存储层采用异常全量、正常采样的策略。错误、降级和超慢请求完整保留，普通请求只保存摘要；D1 用来保存可以检索的完整现场，KV 用来保存聚合摘要，`waitUntil` 则把这些写入操作移出用户等待的主路径。

到这里，系统已经具备捕获单次请求现场的能力。下一篇会继续补充 Metrics，观察系统的整体健康状态，并说明线上出现“回复不对”“响应变慢”或“情绪跳变”时，可以怎样逐步排查。
