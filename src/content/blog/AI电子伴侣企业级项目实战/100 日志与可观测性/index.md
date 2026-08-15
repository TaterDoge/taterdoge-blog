---
title: "100 日志与可观测性"
pubDate: 2026-05-13
description: "传统服务器有 /var/log，有 pm2 /systemd /docker logs，出问题 SSH 上去看日志。Workers 没有这些——代码跑在全球几百个节点上，一次请求可能落到东京、法兰克福、圣保罗里的任意一个。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/25-logging-observability/](https://aicompanion.usehook.cn/25-logging-observability/)

## 1. Workers 的可观测性为什么「不一样」

传统服务器有 `/var/log`，有 pm2 /systemd /docker logs，出问题 SSH 上去看日志。Workers 没有这些——代码跑在全球几百个节点上，一次请求可能落到东京、法兰克福、圣保罗里的任意一个。

这带来两个现实：

- **你看不见单个节点**。你要的是「全球汇总的视角」

- **日志不会自己持久化**。Worker 跑完了，`console.log` 就飘走了，除非你主动收集

不过 Cloudflare 在这方面的工具已经比较全了，目前可用的：

| 工具 | 用途 |
| --- | --- |
| wrangler tail | 实时在终端里看日志，开发期最常用 |
| Workers Observability（新功能） | Dashboard 上自动存日志、trace、metrics |
| Logpush | 把日志推送到 R2/S3/第三方（Datadog、Axiom 等） |
| Analytics Engine | 超便宜的自定义指标写入 |
| Tail Workers | 用一个 Worker 处理另一个 Worker 的日志（过滤、转发） |
| Sentry / 第三方 SDK | 业务级错误追踪 |

这一篇把这些工具过一遍，最后给 AI 网关补上完整的可观测性。

## 2. wrangler tail：开发期的救命稻草

最直接的调试方式：

terminal

```shellscript
# 跟踪生产 Worker 的实时日志
npx wrangler tail

# 跟踪特定 Worker
npx wrangler tail my-api-gateway

# 只看错误
npx wrangler tail --status=error

# 只看某个 IP 的请求
npx wrangler tail --ip-address=203.0.113.42
```

终端里会看到每次请求的 method/path/status、以及你在代码里 `console.log` 的东西。生产环境临时查问题，这个命令足以解决 80% 场景。

它的两个局限：

- **必须开着终端**：关了就丢

- **历史不可回查**：你看到的是「从这一刻起」的日志

要长期可见 + 可回查的日志，需要下一节的 Workers Observability。

## 3. Workers Observability：Cloudflare 自己的日志平台

在 `wrangler.jsonc` 里打开这一项，Cloudflare 就会自动把日志存进 Dashboard：

wrangler.jsonc

```jsonc
{
  "observability": {
    "logs": {
      "enabled": true,
      "head_sampling_rate": 1  // 采样率 1 = 全部记录
    }
  }
}
```

启用后：

- Cloudflare Dashboard → Workers → 你的 Worker → Logs 可以看到完整历史

- **默认保留 7 天**（付费版可延长）

- 支持按 status code / duration / path / 自定义字段过滤

- **Query Builder** 可以像 SQL 一样查日志

中小项目用这个基本够了，不一定需要接第三方日志平台。

### 3.1 采样率怎么选

`head_sampling_rate` 是采样率，0~1 的浮点数，代表记录多大比例的请求。比如 0.1 就是只记录 10% 的请求——流量大了之后全量记录太贵，只采样一部分就够看趋势了：

- `1`：全量（开发环境、刚上线）

- `0.1`：10%（流量大后的默认推荐）

- `0.01`：1%（超大流量、只看趋势）

**错误日志不受采样影响**——Workers Observability 会**额外自动记录所有 5xx**，你不会因为采样而漏掉错误。

## 4. 结构化日志：console.log 怎么写

`console.log('error happened')` 这种日志字符串在 Dashboard 里很难过滤。改成 JSON 对象：

src/lib/logger.ts

```typescript
export const log = {
  info: (event: string, data?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: 'info', event, ...data, ts: Date.now() }))
  },
  warn: (event: string, data?: Record<string, unknown>) => {
    console.warn(JSON.stringify({ level: 'warn', event, ...data, ts: Date.now() }))
  },
  error: (event: string, data?: Record<string, unknown>) => {
    console.error(JSON.stringify({ level: 'error', event, ...data, ts: Date.now() }))
  },
}
```

Workers Observability 会自动识别 JSON 结构，你在 Query Builder 里可以直接按字段过滤：

src/routes/chat.ts

```typescript
import { log } from '../lib/logger'

app.post('/chat', async (c) => {
  const body = await c.req.json()
  const startedAt = Date.now()

  try {
    const result = await callLLM(body)
    log.info('llm.success', {
      model: body.model,
      userId: c.get('apiKeyId'),
      tokens: result.usage.total_tokens,
      duration: Date.now() - startedAt,
    })
    return c.json(result)
  } catch (err) {
    log.error('llm.failed', {
      model: body.model,
      userId: c.get('apiKeyId'),
      message: (err as Error).message,
      duration: Date.now() - startedAt,
    })
    throw err
  }
})
```

之后 Dashboard 里可以查「最近 1 小时内 model=claude-opus-4-6 的所有失败请求」——这种查询在字符串日志里是做不到的。

### 4.1 一个好日志的字段清单

生产 Worker 建议每次请求都带上这几个字段：

| 字段 | 含义 |
| --- | --- |
| event | 业务事件名（如 llm.success、queue.retry） |
| level | info / warn / error |
| userId / apiKeyId | 哪个用户 |
| requestId | 请求级唯一 ID（方便跨日志串起来） |
| duration | 耗时（毫秒） |
| model / resource | 这次操作的对象 |
| error.message / error.stack | 出错时的详细信息 |

`requestId` 可以用 `crypto.randomUUID()` 在请求入口生成，通过 `c.set('requestId', ...)` 在整个请求里共享。

## 5. 错误追踪：Sentry 之类

日志好用，但它不告诉你「错误的聚合情况」。业务级错误追踪（Sentry、Bugsnag、Axiom）解决的是这类问题：

- 同一个错误在过去 1 小时发生了多少次？

- 哪个版本部署后开始的？

- 影响了多少独立用户？

- 异常栈是什么？

### 5.1 给 Hono 接 Sentry

Sentry 官方提供了 Workers SDK：

terminal

```shellscript
npm install @sentry/cloudflare
```

src/index.ts

```typescript
import * as Sentry from '@sentry/cloudflare'
import { Hono } from 'hono'

type Bindings = {
  SENTRY_DSN: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.onError((err, c) => {
  // 让 Sentry 抓到
  Sentry.captureException(err, {
    tags: { path: c.req.path, method: c.req.method },
    user: { id: c.get('userId') },
  })
  return c.json({ error: 'Internal Server Error' }, 500)
})

export default Sentry.withSentry(
  (env: Bindings) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 0.1,
  }),
  app
)
```

`Sentry.withSentry()` 包一层默认导出，它会自动捕获未处理的异常、附加 Workers 特有的运行环境信息。

### 5.2 不要把所有东西都扔给 Sentry

一个常见反模式：`console.error` 全部 `captureException` 一遍。Sentry 按事件数计费，几小时内你就会收到账单告警。

**原则**：Sentry 只收**需要人类介入修复**的异常。业务级失败（校验错误、用户权限不足）走普通日志就行。

## 6. Analytics Engine：便宜到奢侈的自定义指标

Cloudflare 的 Analytics Engine 是专门给 Workers 写指标的时序数据库。免费版每天 10 万次写入 / 1 万次读取，个人项目够用。

适用场景：

- 每次 LLM 调用的 token 数、延迟、成本

- 每次缓存命中/miss 的统计

- 每类业务事件的 counter

### 6.1 写入

wrangler.jsonc

```jsonc
{
  "analytics_engine_datasets": [
    { "binding": "ANALYTICS", "dataset": "ai_gateway_metrics" }
  ]
}
```

src/routes/chat.ts

```typescript
type Bindings = { ANALYTICS: AnalyticsEngineDataset }  // Workers 内置类型

app.post('/chat', async (c) => {
  const result = await callLLM(body)

  // writeDataPoint 的字段分三类：
  // blobs — 字符串列（最多 20 个），用来过滤和 group by
  // doubles — 数值列（最多 20 个），用来求和、求平均
  // indexes — 采样索引（最多 1 个），高基数场景下的采样键
  c.env.ANALYTICS.writeDataPoint({
    blobs: [body.model, c.get('apiKeyId'), 'success'],
    doubles: [result.usage.total_tokens, Date.now() - startedAt],
    indexes: [c.get('apiKeyId')],
  })

  return c.json(result)
})
```

### 6.2 查询

Dashboard 里有 UI，或者用 SQL API：

query.sql

```sql
SELECT
  blob1 AS model,
  SUM(_sample_interval) AS total_requests,
  SUM(double1) AS total_tokens,
  AVG(double2) AS avg_duration_ms
FROM ai_gateway_metrics
WHERE timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY blob1
ORDER BY total_requests DESC
```

对 AI 项目来说 Analytics Engine 很实用：一行代码埋点，一行 SQL 出报表。比自己在 KV 里攒数据再 cron 汇总简单多了。

## 7. Logpush：把日志送到外部平台

如果你团队已经有 Datadog、Axiom、Grafana Loki 之类的统一日志平台，可以用 Logpush 把 Workers 日志直接推过去：

terminal

```shellscript
npx wrangler logpush create \
  --dataset workers_trace_events \
  --destination "https://your-endpoint/path?token=xxx"
```

Logpush 支持的目的地：R2、S3、HTTP endpoint、Datadog、New Relic、Sumo Logic 等。配置好之后日志会被**批量推送**（通常每几分钟一批），而不是实时。

对绝大多数中小项目，Workers Observability 本身就够了，Logpush 主要给**已经用了 Datadog 的大团队**。

## 8. 实战：AI 网关的完整可观测性

回到第 18 篇的 AI 网关，我们给它补全可观测性：

src/index.ts

```typescript
import { Hono } from 'hono'
import * as Sentry from '@sentry/cloudflare'
import { log } from './lib/logger'

type Bindings = {
  SENTRY_DSN: string
  ANALYTICS: AnalyticsEngineDataset
  OPENAI_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

// 请求级 trace ID
app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID()
  c.set('requestId', requestId)
  c.header('X-Request-Id', requestId)
  await next()
})

// 全局请求日志
app.use('*', async (c, next) => {
  const startedAt = Date.now()
  await next()
  log.info('http.request', {
    requestId: c.get('requestId'),
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration: Date.now() - startedAt,
  })
})

app.post('/v1/chat/completions', async (c) => {
  const body = await c.req.json()
  const startedAt = Date.now()

  try {
    const result = await callLLM(body, c.env.OPENAI_API_KEY)

    // 结构化日志
    log.info('llm.success', {
      requestId: c.get('requestId'),
      model: body.model,
      userId: c.get('apiKeyId'),
      tokens: result.usage.total_tokens,
      duration: Date.now() - startedAt,
    })

    // Analytics Engine 埋点
    c.env.ANALYTICS.writeDataPoint({
      blobs: [body.model, c.get('apiKeyId'), 'success'],
      doubles: [result.usage.total_tokens, Date.now() - startedAt],
      indexes: [c.get('apiKeyId')],
    })

    return c.json(result)
  } catch (err) {
    log.error('llm.failed', {
      requestId: c.get('requestId'),
      model: body.model,
      userId: c.get('apiKeyId'),
      message: (err as Error).message,
    })

    // Analytics Engine 记录失败
    c.env.ANALYTICS.writeDataPoint({
      blobs: [body.model, c.get('apiKeyId'), 'error'],
      doubles: [0, Date.now() - startedAt],
      indexes: [c.get('apiKeyId')],
    })

    throw err  // 让全局 onError 接住 + Sentry 抓
  }
})

// 全局错误兜底
app.onError((err, c) => {
  Sentry.captureException(err, {
    tags: { path: c.req.path },
    extra: { requestId: c.get('requestId') },
  })
  return c.json({ error: 'Internal Server Error' }, 500)
})

export default Sentry.withSentry(
  (env: Bindings) => ({ dsn: env.SENTRY_DSN, tracesSampleRate: 0.1 }),
  app as any
)
```

这套东西给你的可观测性：

- **每个请求都有 requestId**（响应头里也返回），排查时可以串起所有日志

- **请求级日志**（method/path/status/duration）自动化到中间件

- **业务级日志**（llm.success / llm.failed）在关键分支手工写

- **Analytics Engine** 记录可查询的时序指标

- **Sentry** 捕获未处理异常，按聚合告警

- **Workers Observability** 在 Dashboard 里提供原生查询 UI

## 9. 小结

Workers 的日志默认不持久化——`console.log` 打完就丢了。加一行 `observability.logs.enabled = true` 就能在 Dashboard 里查历史日志。

根据团队规模选组合：

| 场景 | 推荐组合 |
| --- | --- |
| 个人项目 | wrangler tail + Workers Observability |
| 中小团队 | 上面 + 结构化日志 + Analytics Engine |
| 已上 Sentry 的团队 | 上面 + Sentry SDK |
| 已上 Datadog / Grafana 的团队 | 上面 + Logpush 推送到现有平台 |

三个实用原则：日志要结构化（JSON 对象比纯字符串好查得多），每个请求带 requestId（方便串起跨服务日志），只把真正需要人修的异常扔给 Sentry（业务失败走普通日志）。
