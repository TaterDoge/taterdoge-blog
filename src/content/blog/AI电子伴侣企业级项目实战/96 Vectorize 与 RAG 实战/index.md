---
title: "96 Vectorize 与 RAG 实战"
pubDate: 2026-05-12
description: "先看一个场景：你想做一个「公司内部知识库问答」，让 AI 根据公司文档回答问题。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/21-vectorize-and-rag/](https://aicompanion.usehook.cn/21-vectorize-and-rag/)

## 1. 为什么需要向量数据库

先看一个场景：你想做一个「公司内部知识库问答」，让 AI 根据公司文档回答问题。

大模型本身不知道你公司的文档内容，你有两个选择：

- 每次问问题时，把全部文档塞进 prompt（价格爆炸、上下文塞不下）

- 先找出**和问题最相关**的那几段文档，只把这几段塞进 prompt

第二种就是 **RAG（Retrieval-Augmented Generation，检索增强生成）**。而「找出最相关的几段」靠的就是向量相似度检索——这就是为什么需要向量数据库。

这一篇的目标：用 Cloudflare Vectorize + Workers AI 搭一个最小可用的 RAG 系统。

### 1.1 Embedding 是什么

把一段文字喂给 embedding 模型，它会返回一个**固定长度的浮点数数组**（比如 768 个数）。你可以把这个数组想象成文字在一个高维空间里的坐标——**意思相近的文字，坐标距离也近**。

code.ts

```txt
"今天天气真好" → [0.12, -0.34, 0.88, ..., 0.05]     (768 个数)
"阳光很棒"      → [0.11, -0.32, 0.85, ..., 0.07]     (和上面距离很近)
"今天股票跌了" → [-0.45, 0.67, -0.12, ..., 0.33]    (和上面距离很远)
```

检索的时候，把用户问题也转成向量，在数据库里找「距离最近」的那几条就行。

## 2. Vectorize：Cloudflare 自己的向量数据库

| 项 | 数值 |
| --- | --- |
| 最大维度 | 1536 |
| 每个索引最多向量数 | 10,000,000 |
| 每个向量 metadata | 10 KiB |
| 账号索引数上限 | 免费版 100 / 付费版 50,000 |
| 最大相似度返回数 | 100（带 metadata 时 50） |

免费版 100 个索引、每个索引最多 1000 万条向量，个人项目和中小应用一般够用。

## 3. 创建索引

用 wrangler 命令行创建：

terminal

```shellscript
# 用 cosine 相似度，768 维（对应 bge-base-en-v1.5）
npx wrangler vectorize create docs-index \
  --dimensions=768 \
  --metric=cosine
```

几个概念需要搞清楚：

- **`dimensions`**：向量维度，必须和你用的 embedding 模型对得上。`bge-base-en-v1.5` 是 768，OpenAI `text-embedding-3-small` 是 1536

- **`metric`**：相似度算法，`cosine`（余弦）/`euclidean`（欧氏距离）/`dot-product`（点积）。文本场景几乎都用 `cosine`

在 `wrangler.jsonc` 里绑定：

wrangler.jsonc

```jsonc
{
  "vectorize": [
    {
      "binding": "DOCS_INDEX",
      "index_name": "docs-index"
    }
  ],
  "ai": {
    "binding": "AI"
  }
}
```

我们把 Workers AI 也挂上，因为等一下要用它生成 embedding。

## 4. 最小可用的写入 + 查询

先看最朴素的用法。Hono 里的类型声明：

src/types.ts

```typescript
export type Bindings = {
  DOCS_INDEX: Vectorize  // 和 Ai 一样，Cloudflare Workers 内置的全局类型
  AI: Ai
}

export type AppEnv = {
  Bindings: Bindings
}
```

### 4.1 生成 embedding 并写入

src/routes/ingest.ts

```typescript
import { Hono } from 'hono'
import type { AppEnv } from '../types'

const ingest = new Hono<AppEnv>()

ingest.post('/ingest', async (c) => {
  const { docs } = await c.req.json<{
    docs: Array<{ id: string; text: string; source?: string }>
  }>()

  // 1. 批量生成 embedding（Workers AI 一次最多 100 段文本）
  //    返回 { data: [向量1, 向量2, ...] }，每个向量是 float[]
  const texts = docs.map((d) => d.text)
  const { data: embeddings } = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: texts,
  })

  // 2. 组装成 Vectorize 的格式
  const vectors = docs.map((doc, i) => ({
    id: doc.id,
    values: embeddings[i],
    metadata: {
      text: doc.text,
      source: doc.source || 'unknown',
      insertedAt: Date.now(),
    },
  }))

  // 3. 一次批量写入
  const result = await c.env.DOCS_INDEX.upsert(vectors)

  return c.json({
    ingested: vectors.length,
    mutationId: result.mutationId,
  })
})

export default ingest
```

三步：**文本 → 向量 → 写库**。注意这里用了 `upsert` 而不是 `insert`——前者在 id 已存在时会覆盖，后者会报错。日常更新文档场景 `upsert` 更顺手。

`mutationId` 是 Vectorize 的异步写入凭证，真正可查通常要几秒。对于实时性要求高的场景要注意这一点。

### 4.2 按相似度查询

src/routes/search.ts

```typescript
import { Hono } from 'hono'
import type { AppEnv } from '../types'

const search = new Hono<AppEnv>()

search.post('/search', async (c) => {
  const { query, topK = 5 } = await c.req.json<{
    query: string
    topK?: number
  }>()

  // 1. 把问题也转成向量
  const { data: queryEmbeddings } = await c.env.AI.run(
    '@cf/baai/bge-base-en-v1.5',
    { text: [query] }
  )
  const queryVector = queryEmbeddings[0]

  // 2. 查最相似的 topK 条
  const result = await c.env.DOCS_INDEX.query(queryVector, {
    topK,
    returnMetadata: 'all',
  })

  return c.json({
    matches: result.matches.map((m) => ({
      id: m.id,
      score: m.score,  // 相似度分数，0~1 之间
      text: m.metadata?.text,
      source: m.metadata?.source,
    })),
  })
})

export default search
```

`query()` 的选项里：

- **`topK`**：返回多少条。带 metadata 时最多 50 条

- **`returnMetadata: 'all'`**：把写入时挂的 metadata 也带回来。不设的话结果只有 id 和 score

- **`returnValues: true`**：把向量本身也返回（一般不需要，浪费带宽）

## 5. 组合成一个 RAG 接口

把「检索 + 生成」串起来，就是最小的 RAG。

src/routes/rag.ts

```typescript
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { AppEnv } from '../types'

const rag = new Hono<AppEnv>()

rag.post('/rag', async (c) => {
  const { question } = await c.req.json<{ question: string }>()

  // 1. 检索相关文档
  //    只传了一段文本，所以 data 里只有一个向量，直接解构出来
  const { data: [queryVec] } = await c.env.AI.run(
    '@cf/baai/bge-base-en-v1.5',
    { text: [question] }
  )

  const { matches } = await c.env.DOCS_INDEX.query(queryVec, {
    topK: 3,
    returnMetadata: 'all',
  })

  // 2. 把检索到的片段拼进 prompt
  const context = matches
    .map((m, i) => `[${i + 1}] ${m.metadata?.text}`)
    .join('\n\n')

  const systemPrompt = `你是一个根据提供的上下文回答问题的助手。
只使用下面的上下文回答。如果上下文里没有答案，就回复"根据现有资料无法回答"。

上下文：
${context}`

  // 3. 调用大模型流式生成
  return streamSSE(c, async (stream) => {
    const llmStream = await c.env.AI.run(
      '@cf/meta/llama-3.1-8b-instruct',
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        stream: true,
      }
    )

    const reader = (llmStream as ReadableStream).getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      await stream.writeSSE({
        data: decoder.decode(value, { stream: true }),
        event: 'delta',
      })
    }

    // 顺便把引用来源也发给前端，方便展示
    await stream.writeSSE({
      data: JSON.stringify(matches.map((m) => ({ id: m.id, score: m.score }))),
      event: 'sources',
    })
  })
})

export default rag
```

整个流程就是标准的 RAG：**问题向量化 → 检索 top-K → 拼 prompt → 流式生成**，最后把引用来源也透给前端，方便展示"回答依据"。

## 6. Metadata 过滤

真实场景里你不会只对「全库」做检索，通常要按部门、按时间、按用户做过滤。Vectorize 支持**索引 metadata 字段**然后在查询时做过滤。

### 6.1 创建 metadata 索引

terminal

```shellscript
# 允许按 source 字段过滤
npx wrangler vectorize create-metadata-index docs-index \
  --property-name=source \
  --type=string
```

每个 Vectorize 索引最多 10 个 metadata index。字段类型支持 `string` / `number` / `boolean`。

### 6.2 带过滤的查询

src/routes/search.ts

```typescript
const result = await c.env.DOCS_INDEX.query(queryVector, {
  topK: 5,
  returnMetadata: 'all',
  filter: {
    source: { $eq: 'internal-wiki' },
  },
})
```

过滤语法用 `$eq`（等于）、`$ne`（不等于）、`$in`（在列表中）、`$gt`（大于）、`$lt`（小于）这种操作符写法，多字段可以组合使用。

对多租户应用，最实用的用法是按 `tenantId` 过滤——一个索引承载所有租户的数据，查询时自动隔离：

src/routes/search.ts

```typescript
const result = await c.env.DOCS_INDEX.query(queryVector, {
  topK: 5,
  returnMetadata: 'all',
  filter: {
    tenantId: { $eq: c.get('user').tenantId },
  },
})
```

## 7. Namespace：更重的隔离

如果数据之间**物理隔离**比「加条 metadata 过滤」更安全，用 namespace。每条向量写入时指定一个 namespace 字符串，查询时也带上同一个 namespace，彼此完全不可见：

src/routes/search.ts

```typescript
// 写入时
await c.env.DOCS_INDEX.upsert(vectors.map(v => ({ ...v, namespace: 'tenant-42' })))

// 查询时
const result = await c.env.DOCS_INDEX.query(queryVec, {
  namespace: 'tenant-42',
  topK: 5,
})
```

Namespace 和 metadata 过滤的区别：

- **metadata 过滤** 是查询时的软过滤，写入时不隔离，只是查询时按字段筛

- **namespace** 是物理隔离，不同 namespace 之间完全不能查到对方的数据

多租户 SaaS 通常用 namespace 做隔离，比 metadata 过滤更安全——即使代码 bug 忘了加过滤条件，不同 namespace 的数据也不会串。

## 8. 选型和成本

### 8.1 Embedding 模型选型

| 模型 | 维度 | 用法 |
| --- | --- | --- |
| @cf/baai/bge-small-en-v1.5 | 384 | 轻量、便宜、英文为主 |
| @cf/baai/bge-base-en-v1.5 | 768 | 通用首选，性价比最高 |
| @cf/baai/bge-large-en-v1.5 | 1024 | 精度要求高的场景 |
| @cf/google/embeddinggemma-300m | 768 | Google 的新选择，多语言好 |
| text-embedding-3-small（OpenAI） | 1536 | 多语言通用、质量高，但要走第三方、花钱 |

**要处理中文内容**，`bge-m3`（社区版）或 `text-embedding-3-large` 更稳。Workers AI 自带的 bge 系列对中文也凑合，但不如中文专用模型。

### 8.2 分块策略

前面写入数据时用的都是短文本，但实际场景里你的文档可能几千上万字。一整篇文档直接算一个向量不行——太长的文本做 embedding，语义会被"平均化"，检索精度很差。所以要先把文档切成小段（chunk），每段单独算向量。

一个实用的做法：

- 按 800~1200 字符切片

- 切片之间留 100~200 字符重叠（防止关键信息被切断）

- 一个切片一个向量，metadata 里放**原文、所属文档 ID、chunk 索引**

太大的切片会稀释语义，太小的切片会丢失上下文。800~1200 是经验值，不是铁律。

## 9. 小结

这一篇用到的东西：Vectorize 存向量、Workers AI 生成 embedding 和回答、Hono 把检索和生成串起来、namespace 和 metadata 过滤做数据隔离。

向量数据库本身不复杂——写入时把文本转成向量存进去，查询时把问题转成向量找最近的。搞定写入、查询、过滤这三件事，RAG 的核心就跑通了。剩下的是工程细节：分块策略、模型选型、缓存优化，这些根据实际效果调整就行。
