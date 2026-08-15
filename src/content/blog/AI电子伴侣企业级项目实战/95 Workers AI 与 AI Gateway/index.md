---
title: "95 Workers AI 与 AI Gateway"
pubDate: 2026-05-11
description: "上一篇我们自己写了限流、用量统计、流式转发来搭 AI 网关。其实 Cloudflare 自己也提供了两套 AI 产品，直接长在 Workers 旁边，不用额外部署。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/20-workers-ai-gateway/](https://aicompanion.usehook.cn/20-workers-ai-gateway/)

## 1. Cloudflare 的两条 AI 路线

上一篇我们自己写了限流、用量统计、流式转发来搭 AI 网关。其实 Cloudflare 自己也提供了两套 AI 产品，直接长在 Workers 旁边，不用额外部署。

先区分它们：

| 产品 | 你要做的事 |
| --- | --- |
| Workers AI | 在 Cloudflare 自己的 GPU 节点上直接跑开源模型（Llama、Mistral、Qwen、Whisper、Flux……） |
| AI Gateway | 代理你调用第三方 LLM（OpenAI / Anthropic / Gemini / Workers AI / Replicate），顺手做缓存、限流、分析 |

前者是「让 Cloudflare 帮你跑模型」；后者是「让 Cloudflare 在你和模型之间加一层」。两件事不冲突，真实项目里经常一起用。

这一篇分别讲清楚它们怎么用，最后把上一篇的网关改造一遍，看看 AI Gateway 能省掉多少代码。

## 2. Workers AI：在边缘跑开源模型

Workers AI 提供 50+ 开源模型，覆盖文本生成、文本嵌入（把文字变成向量，后面 RAG 章节会详细讲）、语音识别、图像生成等。用 binding 的方式挂到 Worker 上，像调函数一样调用。

几个常用的模型 ID：

| 任务 | 模型 ID |
| --- | --- |
| 文本生成（中等） | @cf/meta/llama-3.1-8b-instruct |
| 文本生成（大） | @cf/meta/llama-3.1-70b-instruct |
| 推理能力 | @cf/qwen/qwen3-30b-a3b-fp8 |
| 文本嵌入（768 维） | @cf/baai/bge-base-en-v1.5 |
| 文本嵌入（1024 维） | @cf/baai/bge-large-en-v1.5 |
| 语音转文字 | @cf/openai/whisper |
| 图像生成 | @cf/black-forest-labs/flux-1-schnell |

模型 ID 的命名规律很清晰：`@cf/<提供方>/<模型名>`。

### 2.1 绑定 AI

在 `wrangler.jsonc` 里加上：

wrangler.jsonc

```jsonc
{
  "ai": {
    "binding": "AI"
  }
}
```

只需要一个 `binding` 名称，不需要 ID。Workers AI 不像 KV/D1 那样一个账号下可以开多个实例——它是账号级的统一服务，一个 binding 就够了。

### 2.2 在 Hono 里调用

src/index.ts

```typescript
import { Hono } from 'hono'

type Bindings = {
  AI: Ai  // Cloudflare Workers 内置的全局类型，不需要额外 import
}

const app = new Hono<{ Bindings: Bindings }>()

// 文本生成
app.post('/generate', async (c) => {
  const { prompt } = await c.req.json()

  const result = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      { role: 'system', content: '你是一个中文技术写作助手。' },
      { role: 'user', content: prompt },
    ],
  })

  return c.json(result)
})

export default app
```

`c.env.AI.run(modelId, input)` 就是 Workers AI 的核心调用方式。input 的结构取决于模型类型：文本模型传 `{ messages: [...] }`（和 OpenAI 很像），嵌入模型传 `{ text: ['要嵌入的文本'] }`，图像生成传 `{ prompt: '一只猫' }`。

### 2.3 流式输出

文本模型支持 SSE 流式，加一个 `stream: true` 就行。Workers AI 返回的流本身就是标准 SSE 格式，用 Hono 的 `streamText` 原样透传即可：

src/index.ts

```typescript
import { streamText } from 'hono/streaming'

app.post('/generate-stream', async (c) => {
  const { prompt } = await c.req.json()

  const stream = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  })

  return streamText(c, async (textStream) => {
    const reader = (stream as ReadableStream).getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      // Workers AI 流式输出就是标准的 SSE 格式，原样写回去就行
      await textStream.write(decoder.decode(value, { stream: true }))
    }
  })
})
```

### 2.4 为什么选 Workers AI

跟直接调 OpenAI 比，Workers AI 的优势在于：

- **延迟低**：模型跑在 Cloudflare 的边缘节点上，Worker 调模型走内网，省掉了到第三方 API 的公网往返

- **按量计费**：不需要自己维护 GPU，也没有月租，用多少算多少

- **有免费额度**：每天 10,000 个「Neurons」（Cloudflare 的推理计量单位），个人项目基本够用

限制也很明显：模型都是开源的，没有 GPT-4o / Claude Opus 这种顶级闭源模型。要用那些还是得走 AI Gateway。

## 3. AI Gateway：给第三方 LLM 调用加一层

AI Gateway 的定位更像「反向代理 + 中间件平台」。你原来怎么调 OpenAI，把请求地址换一下，自动获得：

- **缓存**：相同 prompt 在 TTL 内直接返回，不再花 token

- **限流**：按请求数或 token 数限速，防止失控的调用

- **分析**：Dashboard 里看每个请求、token 消耗、延迟、错误率

- **重试与降级**：模型超时或 429 自动重试、切换到备用模型

- **日志**：完整的 prompt + response 记录（可关，有隐私需求时）

支持的模型提供方：OpenAI、Anthropic、Google Gemini、Workers AI、Replicate、Groq、DeepSeek 等。

### 3.1 创建 Gateway

在 Cloudflare Dashboard → AI → AI Gateway 里点「Create Gateway」，给它起个名字（比如 `my-gateway`）。创建完你会拿到两个东西：

- `account_id`（账号 ID）

- `gateway_id`（你刚起的那个名字）

然后 Gateway 的访问端点就是：

code.ts

```txt
https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/
```

后面加上具体提供方路径，比如 `openai/chat/completions` 或 `anthropic/v1/messages`。

### 3.2 把现有 OpenAI 调用接进去

以 `openai` 官方 SDK 为例，改动量最小：

src/lib/openai.ts

```typescript
import OpenAI from 'openai'

export function createOpenAI(env: {
  OPENAI_API_KEY: string
  CF_ACCOUNT_ID: string
  CF_GATEWAY_ID: string
  CF_API_TOKEN: string  // Cloudflare API Token，在 Dashboard 的 My Profile → API Tokens 里创建
}) {
  return new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    // 把 baseURL 指到 Cloudflare Gateway 的 /compat 端点
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/compat`,
    // 加一个 Cloudflare 的 token 用于识别账号
    defaultHeaders: {
      'cf-aig-authorization': `Bearer ${env.CF_API_TOKEN}`,
    },
  })
}
```

只改了两行：`baseURL` 指到 gateway，`defaultHeaders` 加 `cf-aig-authorization`。你的调用代码（`client.chat.completions.create(...)`）完全不用动。

### 3.3 统一入口：同一个端点调多家

`/compat` 端点是 AI Gateway 的「OpenAI 协议兼容层」。你可以用同一套代码同时调 OpenAI、Anthropic、Gemini——只要在 `model` 字段里带上前缀：

src/routes/chat.ts

```typescript
const messages = [{ role: 'user', content: '你好' }] as const

// 走 OpenAI
await openai.chat.completions.create({
  model: 'openai/gpt-4o-mini',
  messages,
})

// 走 Anthropic，同一个 SDK
await openai.chat.completions.create({
  model: 'anthropic/claude-haiku-4-5',
  messages,
})

// 走 Workers AI
await openai.chat.completions.create({
  model: 'workers-ai/@cf/meta/llama-3.1-8b-instruct',
  messages,
})
```

对后端来说这相当实用——前端只需要告诉后端「用哪个模型」，后端完全不用管具体对接哪家 SDK。

## 4. 用 AI Gateway 改造第 18 篇的网关

回到第 18 篇那个「自己写限流 + 自己写用量统计」的网关。大部分能力 AI Gateway 自带，我们把重叠的部分卸掉。

**之前需要自己写的（第 18 篇）**：

- 限流中间件（用 KV 做固定窗口）

- 用量统计（每次请求后写 KV）

- 重试逻辑（没写）

- 缓存（没写）

- 日志（只有 `console.log`）

**改造后**：

src/routes/chat.ts

```typescript
import { Hono } from 'hono'
import OpenAI from 'openai'
import { streamSSE } from 'hono/streaming'
import type { AppEnv } from '../types'

const chat = new Hono<AppEnv>()

chat.post('/v1/chat/completions', async (c) => {
  const body = await c.req.json()

  const client = new OpenAI({
    apiKey: c.env.OPENAI_API_KEY,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${c.env.CF_ACCOUNT_ID}/${c.env.CF_GATEWAY_ID}/openai`,
    defaultHeaders: {
      'cf-aig-authorization': `Bearer ${c.env.CF_API_TOKEN}`,
      // 用自定义 header 打标签，方便在 Dashboard 区分
      'cf-aig-metadata': JSON.stringify({
        userId: c.get('apiKeyId'),
      }),
    },
  })

  const stream = await client.chat.completions.create({
    ...body,
    stream: true,
  })

  return streamSSE(c, async (sseStream) => {
    for await (const chunk of stream) {
      await sseStream.writeSSE({
        data: JSON.stringify(chunk),
        event: 'message',
      })
    }
    await sseStream.writeSSE({ data: '[DONE]', event: 'message' })
  })
})

export default chat
```

比第 18 篇少了大概 80 行代码，而且**功能更全**：缓存、限流、重试、token 统计、延迟分布、错误归类，都能在 Cloudflare Dashboard 里看到。

### 4.1 在 Dashboard 里配限流和缓存

AI Gateway 的配置都在 Dashboard 点两下：

- **Caching**：打开开关，设 TTL（比如 1 小时），相同 prompt 在 TTL 内免费返回

- **Rate Limiting**：按 IP 或自定义 header 限速，可以配多条规则

- **Logs**：默认记录请求和响应，可以关（有用户隐私顾虑时）

- **Fallbacks**：主模型 5xx 时自动切到备用模型

这些不用写代码，在 Dashboard 点开关配就行。自己用 KV 写限流、用 KV 记用量完全可以，但如果 AI Gateway 自带的能力已经够用，就没必要重复造。

### 4.2 cf-aig-metadata：给每个请求打标签

上面代码里 `cf-aig-metadata` 那一行值得单独提一下。你可以往里塞任意 JSON，字段会出现在 Dashboard 的日志里，方便过滤和统计：

src/routes/chat.ts

```typescript
defaultHeaders: {
  'cf-aig-authorization': `Bearer ${c.env.CF_API_TOKEN}`,
  'cf-aig-metadata': JSON.stringify({
    userId: c.get('apiKeyId'),
    feature: 'chat',
    plan: 'pro',
  }),
}
```

后续你想查「pro 用户这一周花了多少 token」「chat 功能的 p95 延迟是多少」，都能直接在 Dashboard 过滤。

## 5. 两条路线怎么选

| 场景 | 选哪个 |
| --- | --- |
| 要跑开源模型、对成本极度敏感 | Workers AI |
| 离线/隐私场景，数据不能出 Cloudflare | Workers AI |
| 需要 GPT-4o / Claude Opus 这种顶级模型 | 第三方 SDK + AI Gateway |
| 既要顶级模型，又要缓存、限流、日志 | 第三方 SDK + AI Gateway |
| 多模型路由（根据任务切不同模型） | AI Gateway 的 /compat 端点 |
| 嵌入、语音、图像这类常规 AI 任务 | Workers AI |

更常见的其实是**两个一起用**：核心对话走第三方顶级模型（通过 AI Gateway），embedding、分类、语音这些轻量任务走 Workers AI。

## 6. 小结

两条路线各管各的：

- **Workers AI**：在边缘跑开源模型，`c.env.AI.run(modelId, input)` 一行搞定

- **AI Gateway**：给第三方 LLM 调用加代理，缓存、限流、日志在 Dashboard 里配

- 实际项目里经常一起用——重活（核心对话）走第三方顶级模型通过 Gateway，轻活（嵌入、分类）走 Workers AI

上一篇自己写了几十行的限流和用量统计，用 AI Gateway 可以直接省掉。什么时候用平台自带的能力、什么时候自己写，取决于你需要多细粒度的控制。
