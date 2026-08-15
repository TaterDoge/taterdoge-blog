---
title: "99 缓存策略"
pubDate: 2026-05-12
description: "API 变快有三条路：优化代码、加机器、加缓存。前两条有天花板，加缓存经常能直接跳一个数量级。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/24-caching/](https://aicompanion.usehook.cn/24-caching/)

## 1. 为什么缓存值得单独讲

API 变快有三条路：优化代码、加机器、加缓存。前两条有天花板，加缓存经常能直接跳一个数量级。

AI 项目里缓存的收益特别大：

- LLM 调用昂贵且慢（几百毫秒到几秒），相同 prompt 为什么要每次都问一遍？

- embedding 生成也不便宜，同一段文本的 embedding 可以复用很久

- 向量检索的结果在 TTL 内通常不需要重算

- 图片、静态资源走 CDN 是零成本的收益

Cloudflare 给了你**四层可编程缓存**（从离用户最近到离源站最近），加上 Hono 的中间件，就是下面这张图：

code.ts

```txt
                    最前面                          最后面
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ 响应头 Cache │→ │ Cache API    │→ │ Hono cache   │→ │ KV 缓存层     │
│ (浏览器+CDN) │  │ (caches.*)   │  │ (应用级)     │  │ (跨 Worker)  │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

这一篇把这四层讲清楚，最后看看 AI 场景的 **LLM 响应缓存**和**失效策略**怎么做。

## 2. 响应头：最省事的一层

`Cache-Control` 响应头告诉上游（浏览器、Cloudflare 边缘、任何中间代理）这个响应能不能缓存、缓存多久。**不改一行业务代码，只加响应头**，就能让一批请求根本到不了你的 Worker。

src/routes/public.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

app.get('/api/models', (c) => {
  // 这个接口返回支持的模型列表，几乎从不变
  c.header('Cache-Control', 'public, max-age=3600, s-maxage=86400')
  return c.json({
    models: ['claude-opus-4-6', 'claude-haiku-4-5', 'gpt-4o'],
  })
})
```

几个最常用的 Cache-Control 指令：

| 指令 | 含义 |
| --- | --- |
| public | 可以被共享缓存（CDN）缓存 |
| private | 只能被用户独享缓存（浏览器）缓存 |
| max-age=N | 新鲜期 N 秒（浏览器用） |
| s-maxage=N | 新鲜期 N 秒（CDN 用，覆盖 max-age） |
| no-cache | 可以缓存，但每次用之前都要重新验证 |
| no-store | 完全不缓存 |
| stale-while-revalidate=N | 过期后 N 秒内仍可用旧响应，后台异步刷新 |

### 2.1 用户相关数据一定要 private

`/api/users/me` 这种返回当前用户信息的接口，**绝对不能用 `public`**。一旦 CDN 缓存了你的响应，其他用户可能会看到你的数据。

src/routes/profile.ts

```typescript
app.get('/api/users/me', async (c) => {
  const user = c.get('user')
  // 浏览器可以缓存，CDN 绝对不可以
  c.header('Cache-Control', 'private, max-age=60')
  return c.json(user)
})
```

**"public + max-age" = 泄露用户数据** 是生产事故的常见配方，写响应头时务必过一遍脑子。

### 2.2 stale-while-revalidate：AI 接口的福音

AI 查询接口常常「几分钟不变就可以复用」。`stale-while-revalidate` 允许用户先拿到旧响应（0 延迟），后台同时刷新：

src/routes/search.ts

```typescript
c.header(
  'Cache-Control',
  'public, max-age=60, stale-while-revalidate=300'
)
```

含义：60 秒内直接返回缓存；60~360 秒内也返回缓存（标记为 stale），但后台异步去源站拿一份新的来更新。用户看不到延迟，源站压力也降了。

## 3. Cache API：caches.default

响应头是「声明式」的缓存。更直接的是用 Cache API 主动往 Cloudflare 的边缘缓存里读写。

src/lib/cache.ts

```typescript
// 构造一个缓存 key（就是一个 Request 对象，URL 就是 key）
const cacheKey = new Request(`https://cache.example/embed?text=${encodeURIComponent(text)}`)

// 查
const cached = await caches.default.match(cacheKey)
if (cached) return cached

// 没命中，真跑业务
const result = await doExpensiveWork()

// 把响应写进缓存（必须是 Response 对象）
const response = Response.json(result, {
  headers: { 'Cache-Control': 'public, max-age=3600' },
})
await caches.default.put(cacheKey, response.clone())
return response
```

三个要点：

- **cache key 是一个 Request 对象**，不是字符串。这是 Web 标准 Cache API 的设计——它本来就是给 HTTP 缓存用的，所以 key 就是 Request。实际上你只需要关心 URL 部分

- **必须有 `Cache-Control` 响应头**，且 `max-age > 0`，不然 `put` 会被静默忽略（缓存层看到"不让缓存"就不存了）

- **一定要 `response.clone()`**，因为 Response 的 body 是流，只能读一次。`put` 会读一次，你还要返回给用户，所以要 clone 一份

### 3.1 AI 场景：embedding 缓存

同一段文本的 embedding 几乎永远不变，缓存 TTL 可以设得很长：

src/lib/embed.ts

```typescript
export async function embedWithCache(
  env: { AI: Ai },
  text: string
): Promise<number[]> {
  const hash = await sha256(text)
  const cacheKey = new Request(`https://cache.example/embed/${hash}`)

  const cached = await caches.default.match(cacheKey)
  if (cached) {
    const data = (await cached.json()) as { values: number[] }
    return data.values
  }

  const { data } = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: [text],
  })
  const values = data[0]

  const response = Response.json(
    { values },
    { headers: { 'Cache-Control': 'public, max-age=2592000' } } // 30 天
  )
  await caches.default.put(cacheKey, response.clone())

  return values
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
```

文档 RAG 系统的 embedding 命中率通常很高——文档内容不变，同一段文本的 embedding 也不变，没必要算两次。

### 3.2 Cache API 的作用域

Cache API 的缓存是**节点级别**的。你在东京节点写进去的 key，只有后续落在东京的请求能读到。大阪节点再进来就是 miss。

这个特性对「读多写少、可容忍一段时间不一致」的场景完全够用。如果需要**全球一致**的缓存，往下看 KV 层。

## 4. Hono 的 cache 中间件

写「查缓存 → miss 就真跑 → 写缓存」这套模板代码太频繁，Hono 内置了 `cache` 中间件把它封装好：

src/routes/models.ts

```typescript
import { Hono } from 'hono'
import { cache } from 'hono/cache'

const app = new Hono()

app.get(
  '/api/models',
  cache({
    cacheName: 'models',
    cacheControl: 'max-age=3600',
  }),
  async (c) => {
    // 实际 handler，只有 miss 时才会进来
    const models = await loadModelList(c.env)
    return c.json(models)
  }
)
```

中间件里做的事等价于前面手写的 Cache API 代码，但你什么都不用想——只要 GET 请求、URL 相同，就自动命中。

### 4.1 按 query/header 分片 cache key

默认 cache key 只看 URL。实际场景里经常需要按查询参数或 header 分片：

src/routes/search.ts

```typescript
app.get(
  '/api/search',
  cache({
    cacheName: 'search',
    cacheControl: 'max-age=300',
    vary: ['Accept-Language'],  // 按 Accept-Language 分片
  }),
  async (c) => { /* ... */ }
)
```

`vary` 对应的是 HTTP 的 `Vary` 响应头——告诉缓存层「这个 header 值不同，当成不同的缓存条目」。

### 4.2 Hono cache 的限制

`hono/cache` 中间件只缓存 **GET/HEAD 请求的成功响应（2xx）**。POST 请求（典型的 AI 推理接口）用不了它——因为 POST 请求体不是 URL 的一部分，自动缓存会很危险。POST 场景下自己写 Cache API 逻辑（用请求体 hash 做 key）更稳妥。

## 5. KV 作为应用级缓存

Cache API 的「节点级」有时不够用。如果你需要**全球一致、跨节点共享的缓存**，KV 就是自然的选择：

src/lib/llm-cache.ts

```typescript
export async function callLLMCached(
  env: { AI: Ai; LLM_CACHE: KVNamespace },
  prompt: string
): Promise<string> {
  const key = `llm:${await sha256(prompt)}`

  // 1. 先查 KV
  const cached = await env.LLM_CACHE.get(key)
  if (cached) return cached

  // 2. miss 就调模型
  const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [{ role: 'user', content: prompt }],
  })
  const answer = (result as { response: string }).response

  // 3. 写回 KV，30 分钟 TTL
  await env.LLM_CACHE.put(key, answer, { expirationTtl: 1800 })

  return answer
}
```

KV 的特点我们在第 10 篇讲过——读取极快、最终一致、写入有几秒的全球传播延迟。**它不适合做「写完立即精准读取」**，但做缓存完美契合：缓存本来就允许「稍微旧一点」。

### 5.1 Cache API vs KV：怎么选

| 维度 | Cache API | KV |
| --- | --- | --- |
| 一致性 | 节点级 | 全球最终一致 |
| 读延迟 | 极低（本地内存） | 低（边缘） |
| 写入传播 | 节点内立即 | 几秒传播 |
| 成本 | 免费（包含在 Workers 里） | 按读/写计费 |
| 适合 | 热点 URL、SWR | 跨地域共享的业务缓存 |

一条实用建议：**两者叠着用**。Cache API 放在前面（命中率最高、最便宜），KV 放在后面（作为 L2，防止冷节点击穿）。L1 miss 再查 L2，L2 miss 才真跑业务。

## 6. AI 场景的三类缓存策略

把前面的工具组合起来看看真实 AI 项目怎么落：

### 6.1 确定性响应缓存

**场景**：prompt 完全相同 → 答案也应该相同（比如用户问「什么是 Cloudflare」）。

**实现**：以 prompt hash 为 key，Cache API 或 KV 都可以。注意 temperature 高时模型输出随机，这种缓存会把多样性抹掉——看业务要不要。

src/routes/chat.ts

```typescript
const cacheKey = new Request(`https://cache/chat/${await sha256(JSON.stringify({
  model: body.model,
  messages: body.messages,
  temperature: body.temperature,
}))}`)
```

### 6.2 语义缓存

**场景**：prompt 字面上不一样但意思相同（「什么是 Cloudflare」vs「介绍一下 Cloudflare」）。

**实现**：把 prompt embedding 存进 Vectorize（第 20 篇），每次新请求先向量查询，相似度超过阈值（比如 0.95）就直接返回缓存的答案。这套东西叫「语义缓存」（Semantic Cache），AI Gateway（第 19 篇）自带。

自己实现的思路：

src/lib/semantic-cache.ts

```typescript
export async function semanticLookup(
  env: { AI: Ai; CACHE_INDEX: Vectorize; CACHE_KV: KVNamespace },
  prompt: string
): Promise<string | null> {
  const { data } = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: [prompt],
  })

  const result = await env.CACHE_INDEX.query(data[0], { topK: 1 })
  if (result.matches.length === 0) return null
  if (result.matches[0].score < 0.95) return null  // 相似度阈值

  return env.CACHE_KV.get(`ans:${result.matches[0].id}`)
}
```

### 6.3 流式响应要不要缓存？

**答案：看情况**。

- **缓存完整响应**：把流全部读完拼成字符串写进 KV，下次命中时一次性返回（失去打字机效果）

- **缓存每个 chunk**：太细，实现复杂、收益小

- **不缓存**：流式本来就是追求「低延迟首字」的场景，缓存价值被稀释

一个折中办法：**对流式响应缓存「完整文本」**，下次命中时**假装再流一遍**（分 chunk 写回 SSE）。前端看到的体验几乎一样，后端完全不花 token。

## 7. 失效：缓存的另一半

加缓存的每一个地方都要想：**这份缓存什么时候失效？**

三种失效策略，由简到繁：

- **TTL（Time-to-Live）**：最朴素，过 N 秒自动过期。几乎所有前面的示例都是这个

- **主动删除**：数据源有变化时，调用 `caches.default.delete(key)` 或 `kv.delete(key)`

- **基于版本**：缓存 key 里带一个版本号，版本变了旧缓存自然没人访问（Cloudflare 自己的 purge 机制常这么用）

### 7.1 主动失效的典型场景

用户更新了自己的 profile：

src/routes/profile.ts

```typescript
app.put('/api/users/me', async (c) => {
  const data = await c.req.valid('json')
  await updateUser(c.env.DB, c.get('user').id, data)

  // 立即失效对应的缓存
  await c.env.USER_CACHE.delete(`user:${c.get('user').id}`)

  return c.json({ ok: true })
})
```

### 7.2 基于版本的失效

给缓存 key 加前缀是一个模式。比如 `v3:user:123`，当你的数据结构发生不兼容变更时，把所有前缀从 `v3` 改成 `v4`——旧缓存还在，但没人读到，慢慢自然过期。

src/lib/cache-keys.ts

```typescript
const CACHE_VERSION = 'v3'

export const userCacheKey = (id: number) => `${CACHE_VERSION}:user:${id}`
```

改 schema 时只改这一处，所有使用者瞬间切到新版本，不需要主动清理。

## 8. 小结

Cloudflare 生态的缓存分四层：`Cache-Control` 响应头让浏览器和 CDN 自动缓存；`caches.default`（Cache API）是节点级的可编程缓存；Hono `cache` 中间件封装了 GET 响应缓存的模板代码；KV 做全球一致的应用级缓存。

AI 项目里最值得缓存的三个东西：embedding（Cache API，TTL 设长）、确定性 LLM 响应（KV，按 prompt hash）、语义缓存（Vectorize + KV，相似度阈值 0.95）。加缓存时同时想好失效策略——TTL、主动删除、版本号，根据场景选。
