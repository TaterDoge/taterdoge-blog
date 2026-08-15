---
title: "19 指标体系与线上排障"
pubDate: 2026-04-18
description: "TTFB（Time To First Byte，首字节时间）：从请求发出到收到第一个字节响应的耗时。在流式回复场景中，它代表用户按下发送后等待多久才看到 AI 开始\"打字\""
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-07-29
---
原文链接：[https://aicompanion.usehook.cn/16-metrics-troubleshooting/](https://aicompanion.usehook.cn/16-metrics-troubleshooting/)

## 1. Trace 与 Metrics 的分工

Trace 擅长回答单次请求为什么会出问题，但如果我们需要了解系统在一段时间内的整体变化，仅靠 Trace 还不够。例如：

- 这周整体延迟是不是变慢了

- 新模型上线之后，记忆命中率有没有下降

- 情绪系统是不是突然变得过于敏感

- Token 成本为什么这个月异常上升

这些问题需要通过 Metrics，也就是指标体系来回答。

我们可以先用一个简单的方式区分两者：

- **Trace** 看单次现场

- **Metrics** 看系统趋势

Trace 负责深入排查具体请求，Metrics 负责发现整体趋势。两者结合起来，才能为 AI 系统的日常运营提供完整依据。

## 2. 核心指标

### 2.1 延迟指标

延迟是用户最容易感知到的质量指标。在查看相关数据之前，我们先理解两个常用术语：

- **TTFB（Time To First Byte，首字节时间）**：从请求发出到收到第一个字节响应的耗时。在流式回复中，它表示用户点击发送后，需要等待多久才能看到 AI 开始输出内容

- **P50 / P95 / P99（百分位数）**：P50 表示 50% 的请求比这个值快，也就是中位数；P95 表示 95% 的请求比这个值快。P95 和 P99 越高，说明尾部慢请求越严重，也就是大部分请求正常，但仍有少数用户等待时间很长

| 指标 | 计算方式 | 关注点 |
| --- | --- | --- |
| TTFB P50 / P95 / P99 | 从请求到首个 token 发出 | P95 是否稳定 |
| 各节点耗时分布 | 从 Trace 摘要聚合 | 谁是瓶颈节点 |
| LLM 首 token 延迟 | 节点开始到首次 yield | 区分管线慢还是模型慢 |

用户反馈最近回复变慢时，可以先从这组指标入手，判断问题发生在整体管线还是模型调用阶段。

### 2.2 检索质量指标

对于 AI 伴侣，记忆系统是否有效，会直接影响用户对连续对话的感受。检索质量指标可以帮助我们判断记忆是否顺利召回，以及召回结果中是否混入了过多噪声。

| 指标 | 计算方式 | 关注点 |
| --- | --- | --- |
| 记忆命中率 | 检索到至少 1 条相关记忆的请求占比 | 低了说明召回有问题 |
| 平均召回条数 | 每次检索到的有效记忆数量 | 太少信息不足，太多噪声过大 |
| Top-1 相似度分布 | 每次检索第一条的得分分布 | 判断 embedding 质量 |

### 2.3 情绪系统指标

情绪状态机出现问题时，通常不会直接报错，更多表现为回复语气或关系状态不自然。这类变化很难通过错误日志发现，因此尤其依赖指标观察。

| 指标 | 计算方式 | 关注点 |
| --- | --- | --- |
| 情绪分类分布 | 各情绪状态占比 | 是否长期偏向某一类 |
| 状态切换频率 | 每会话切换次数 | 是否过度敏感 |
| 亲密度增长曲线 | 按天聚合平均亲密度 | 是否异常跳变 |

### 2.4 成本指标

AI 系统的调用过程会持续产生 Token 和模型费用，因此成本不只是财务统计，也会反过来影响模型选择、上下文长度和安全策略等架构决策。

| 指标 | 计算方式 | 关注点 |
| --- | --- | --- |
| Token 消耗量 | 输入加输出 token 总数 | 决定 API 账单 |
| 单次对话成本 | token 数乘模型单价 | 是否突破预算 |
| 安全拦截率 | 被安全过滤拦截的请求比例 | 过高可能误杀，过低可能漏检 |

## 3. 指标采集

指标不需要像 Trace 一样保存完整现场，只需要在请求执行过程中提取关键数值。

实现采集时，可以先处理两种基本类型：

- **计数器（Counter）**：统计某件事发生了多少次，例如请求总数和 Token 消耗量，每次采集只需要累加

- **直方图（Histogram）**：记录每次观测到的具体值，例如延迟和相似度分数，后续可以据此计算平均值与百分位数

metrics.ts

```typescript
// 以分钟为粒度生成时间 key，如 "2026-03-13T10:05"
function getMinuteKey(): string {
  return new Date().toISOString().slice(0, 16)
}

class MetricsCollector {
  private counters: Map<string, number> = new Map()
  private histograms: Map<string, number[]> = new Map()

  // 累加计数器：比如每来一个请求 increment('requests')
  increment(name: string, value: number = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value)
  }

  // 记录一个观测值：比如每次请求 observe('latency.total', 1350)
  observe(name: string, value: number) {
    const arr = this.histograms.get(name) ?? []
    arr.push(value)
    this.histograms.set(name, arr)
  }

  // 将本次请求收集的指标写入 KV
  async flush(env: { KV: KVNamespace }) {
    const minute = getMinuteKey()

    for (const [name, value] of this.counters) {
      const key = `metrics:counter:${name}:${minute}`
      const existing = Number(await env.KV.get(key) ?? '0')
      await env.KV.put(key, String(existing + value), { expirationTtl: 86400 })
    }

    for (const [name, values] of this.histograms) {
      const key = `metrics:histogram:${name}:${minute}`
      const existing = JSON.parse(await env.KV.get(key) ?? '[]') as number[]
      await env.KV.put(key, JSON.stringify([...existing, ...values]), {
        expirationTtl: 86400
      })
    }
  }
}
```

接入管线时，可以在各个节点执行结束后立即收集对应指标。下面示例中的变量来自 `trace.span()` 的返回值或管线的中间结果：

pipeline-metrics.ts

```typescript
const metrics = new MetricsCollector()

// 延迟指标：记录每个节点的耗时（单位 ms）
metrics.observe('latency.safety_check', safetyCheckDuration)
metrics.observe('latency.memory_retrieval', memoryRetrievalDuration)
metrics.observe('latency.llm_generation', llmDuration)
metrics.observe('latency.total', totalDuration)

// 检索质量指标
metrics.increment('retrieval.total_requests')
if (memories.length > 0) metrics.increment('retrieval.hit_requests')
metrics.observe('retrieval.count', memories.length)
metrics.observe('retrieval.top_score', memories[0]?.score ?? 0)

// 成本指标
metrics.increment('tokens.input', inputTokenCount)
metrics.increment('tokens.output', outputTokenCount)

// 情绪分布指标：每种情绪各自计数
metrics.increment(`emotion.${currentEmotion}`)

// 在 Hono 框架中，c 是请求上下文对象
// c.executionCtx 对应 Workers 原生的 ExecutionContext（上一篇用的 ctx）
// c.env 对应 Workers 原生的 env（绑定的 D1、KV 等资源）
c.executionCtx.waitUntil(metrics.flush(c.env))
```

NOTE

**关于 `c.executionCtx`**：上一篇使用的是 Workers 原生写法 `ctx.waitUntil()`，这里使用 Hono 框架的写法。两者功能相同，只是访问方式不同。Hono 把 Workers 的三个参数（`request`、`env`、`ctx`）统一包装进了 `c` 对象。

这里仍然沿用上一篇的约束：**指标采集需要保持轻量，不能影响请求的主要处理过程。**

与上一篇的 `storeSummary` 一样，`flush()` 对 KV 的操作也是先读后写，因此在高并发下存在竞态问题。两个请求同时读到旧值，各自累加后写回时，可能丢失其中一次计数。低流量场景可以接受这种误差，高并发场景则需要改用 Durable Objects 完成原子计数。

## 4. 固定排查流程

假设用户反馈：“我告诉过 AI 我喜欢吃辣，但它推荐了一家日料店。”面对这类问题，我们需要把排查过程固定下来，而不是每次都依赖临场经验。

### 4.1 定位对应的 Trace

query.ts

```typescript
const traces = await env.DB.prepare(
  `SELECT trace_id, total_duration, has_error, has_degraded, created_at
   FROM traces
   WHERE user_id = ? AND created_at BETWEEN ? AND ?
   ORDER BY created_at DESC`
).bind(userId, startTime, endTime).all()
```

这一步的目的不是泛泛地搜索日志，而是把用户反馈精确定位到某一次请求。

### 4.2 检查关键节点

inspect.ts

```typescript
const spans = await env.DB.prepare(
  `SELECT name, duration, status, input, output, metadata
   FROM spans WHERE trace_id = ? ORDER BY start_time`
).bind(traceId).all()
```

找到对应的 Trace 后，可以按照固定顺序检查下面几个节点：

- `query_understanding`

- `memory_retrieval`

- `prompt_assembly`

- `llm_generation`

这个顺序对应着“理解问题 → 查找上下文 → 组织输入 → 生成输出”的因果关系。沿着它逐步检查，可以更快确认错误最早出现在哪个环节。

### 4.3 映射到根因层

| 排查结果 | 根因 | 修复方向 |
| --- | --- | --- |
| 查询理解没识别偏好通道 | 查询理解层 | 调整 Prompt 或规则 |
| 检索结果为空 | 记忆检索层 | 检查写入、Embedding、Top-K |
| 检索到了但 Prompt 没带上 | Prompt 组装层 | 调整优先级和 Token 预算 |
| Prompt 正确但输出仍忽略 | LLM 生成层 | 补 few-shot、改约束或换模型 |

完成映射后，原本模糊的异常现象就能落到具体层级，后续修复也会有明确方向。

## 5. 常见故障模式

### 5.1 记忆丢失

当用户确定自己说过某件事，AI 却完全没有相关记忆时，可以按照记忆从写入、检索到进入 Prompt 的顺序排查：

- 先看当初说这件事时的 `memory_write`

- 再看本次请求的 `memory_retrieval`

- 最后确认是否在 `prompt_assembly` 被截断

### 5.2 情绪跳变

如果 AI 前一条回复还很亲近，后一条却突然变冷，需要对比相邻请求的情绪状态和更新过程：

- 对比相邻两条 Trace 的 `emotion_read`

- 看 `emotion_update` 的输入是什么

- 判断是用户输入触发，还是衰减/规则造成

### 5.3 延迟突增

当一段时间内有多位用户反馈响应变慢，可以先从整体延迟趋势入手，再逐步缩小到具体节点：

- 先看 `latency.total` 的 P95 曲线

- 再看每个节点的耗时分布

- 最后判断是模型侧变慢，还是检索侧、网络侧、数据库侧变慢

常见情况包括：

- `latency.llm_generation` 突增，说明模型提供商可能变慢

- `latency.memory_retrieval` 持续上涨，说明向量库或检索策略需要优化

## 6. 总结

指标的作用不只是生成报表，更重要的是尽早发现异常趋势。延迟、检索质量、情绪健康度和成本这四组指标，基本覆盖了 AI 伴侣日常运营时需要观察的核心方面。

发现异常后，可以根据 Trace 按照固定顺序逐层检查，而不是依靠经验反复搜索日志。这样既能把问题定位到具体节点，也能为后续修复提供清晰依据。

完成问题发现和定位之后，下一步需要考虑的是替换节点时如何控制风险。下一篇会继续介绍影子模式、A/B 分桶、渐进发布和自动回滚。
