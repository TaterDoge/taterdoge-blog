---
title: "86 Cloudflare KV"
pubDate: 2026-05-08
description: "Cloudflare KV 是一个全球分布式的键值存储。你可以把它理解成一个超大的、部署在全球边缘节点上的 Map。如果你第一次接触键值存储，可以先把它理解成最简单的那种数据结构："
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/11-cloudflare-kv/](https://aicompanion.usehook.cn/11-cloudflare-kv/)

## 1. KV 是什么

Cloudflare KV 是一个全球分布式的键值存储。你可以把它理解成一个超大的、部署在全球边缘节点上的 `Map`。如果你第一次接触键值存储，可以先把它理解成最简单的那种数据结构：

- 一个 `key`，比如 `user:1`

- 对应一个 `value`，比如 `{"name":"Alice"}`

你不能像 SQL 那样写复杂查询，也不能按字段筛选。你只能做四类事：

- 通过 key 写进去

- 通过 key 读出来

- 通过 key 删除

- 按前缀把一批 key 列出来

所以 KV 的思路不是「我有一张表，随便查」，而是「我已经知道 key 长什么样，然后直接按 key 拿数据」。

KV 存储的关键特性：

- **最终一致性**：写入后，全球各节点的数据同步需要一点时间。你可以先理解成「刚写进去的数据，不保证全球每个地方都立刻读到最新值」

- **读多写少**：读取非常快（从最近的边缘节点读），写入相对慢一些

- **简单**：就是 key-value，没有复杂的查询语法

适合存配置、缓存、会话信息这类数据。不适合需要强一致性或复杂查询的场景——那些用 D1。

## 2. 创建 KV namespace

用 wrangler 创建：

terminal

```shellscript
wrangler kv namespace create MY_KV
```

执行后会输出一个 `id`，把它配到 `wrangler.jsonc` 里：

wrangler.jsonc

```jsonc
{
  "name": "my-app",
  "main": "src/index.ts",
  "compatibility_date": "2024-01-01",
  "kv_namespaces": [
    {
      "binding": "MY_KV",
      "id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    }
  ]
}
```

`binding` 是你在代码里访问这个 KV 时用的名字，`id` 是 Cloudflare 分配的唯一标识。

对新手来说，这里可以这样记：

- `binding` 是你在代码里写的变量名，也就是 `c.env.MY_KV` 里的 `MY_KV`

- `id` 是 Cloudflare 后台真正识别这个 namespace 的身份证号

## 3. 在 Hono 里访问 KV

KV 通过 `c.env` 访问。先声明类型：

index.ts

```typescript
import { Hono } from 'hono'

type Bindings = {
  MY_KV: KVNamespace
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', async (c) => {
  // 通过 c.env.MY_KV 访问
  const value = await c.env.MY_KV.get('some-key')
  return c.json({ value })
})

export default app
```

`KVNamespace` 是 Cloudflare Workers 的内置类型，不需要额外安装。`Hono<{ Bindings: Bindings }>` 让 TypeScript 知道 `c.env` 上有哪些绑定。

## 4. 写入：put

index.ts

```typescript
app.post('/config/:key', async (c) => {
  const key = c.req.param('key')
  const body = await c.req.json()

  // 基本写入
  await c.env.MY_KV.put(key, JSON.stringify(body))

  return c.json({ message: 'saved' })
})
```

支持设置过期时间：

index.ts

```typescript
// expirationTtl：多少秒后过期（最少 60 秒）
await c.env.MY_KV.put('session:abc123', JSON.stringify(sessionData), {
  expirationTtl: 3600 // 1 小时后过期
})

// expiration：指定一个 Unix 时间戳过期
await c.env.MY_KV.put('token:xyz', tokenValue, {
  expiration: Math.floor(Date.now() / 1000) + 86400 // 明天过期
})
```

注意：value 本质上是按字符串存进去的。存对象要先 `JSON.stringify()`。

这也是 KV 和数据库一个很大的区别：它不会替你理解对象结构，它只负责把一段值按 key 存起来。

## 5. 读取：get

index.ts

```typescript
app.get('/config/:key', async (c) => {
  const key = c.req.param('key')

  // 返回字符串
  const value = await c.env.MY_KV.get(key)

  if (value === null) {
    return c.json({ error: 'not found' }, 404)
  }

  return c.json({ key, value })
})
```

如果存的是 JSON，可以直接让 KV 帮你解析：

index.ts

```typescript
app.get('/config/:key/json', async (c) => {
  const key = c.req.param('key')

  // 直接返回解析后的对象，省掉 JSON.parse()
  const data = await c.env.MY_KV.get(key, 'json')

  if (data === null) {
    return c.json({ error: 'not found' }, 404)
  }

  return c.json({ key, data })
})
```

这段对新手很重要：`get(key, 'json')` 并不是说 KV 里真的存了"JSON 类型"，而是说：

- 你之前存进去的是一段 JSON 字符串

- 读取时告诉 KV："帮我顺手做一次 JSON.parse()"

所以底层还是字符串，只是读取时多了一步自动解析。

## 6. 删除：delete

index.ts

```typescript
app.delete('/config/:key', async (c) => {
  const key = c.req.param('key')

  await c.env.MY_KV.delete(key)

  // 删除不存在的 key 不会报错，直接静默成功
  return c.json({ message: 'deleted' })
})
```

## 7. 列出 key：list

index.ts

```typescript
app.get('/configs', async (c) => {
  // 列出所有 key
  const allKeys = await c.env.MY_KV.list()

  // 按前缀过滤
  const prefix = c.req.query('prefix')
  if (prefix) {
    const filtered = await c.env.MY_KV.list({ prefix })
    return c.json({ keys: filtered.keys })
  }

  return c.json({ keys: allKeys.keys })
})
```

`list()` 返回的结构：

example.ts

```typescript
{
  keys: [
    { name: 'config:theme', expiration: 1234567890 },
    { name: 'config:lang' },
  ],
  list_complete: true,  // 是否已列完
  cursor: '...'         // 如果没列完，用 cursor 翻页
}
```

这里也要特别提醒一句：`list()` 列出来的是 **key 的信息**，不是每个 key 对应的 value。

如果你想拿到 value，还要像后面完整示例那样，再对每个 key 单独调用 `get()`。

翻页查询：

index.ts

```typescript
app.get('/configs/all', async (c) => {
  const allKeys = []
  let cursor: string | undefined

  // 循环翻页，直到列完
  do {
    const result = await c.env.MY_KV.list({ cursor })
    allKeys.push(...result.keys)
    cursor = result.list_complete ? undefined : result.cursor
  } while (cursor)

  return c.json({ keys: allKeys, total: allKeys.length })
})
```

## 8. 完整示例：配置管理 API

把上面的操作整合成一个简易配置管理服务：

index.ts

```typescript
import { Hono } from 'hono'
import { logger } from 'hono/logger'

type Bindings = {
  MY_KV: KVNamespace
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', logger())

// 列出所有配置
app.get('/api/configs', async (c) => {
  const prefix = c.req.query('prefix') || ''
  const result = await c.env.MY_KV.list({ prefix: `config:${prefix}` })

  // 批量读取每个 key 的值
  const configs = await Promise.all(
    result.keys.map(async (key) => ({
      name: key.name.replace('config:', ''),
      value: await c.env.MY_KV.get(key.name, 'json'),
    }))
  )

  return c.json({ configs })
})

// 读取单个配置
app.get('/api/configs/:name', async (c) => {
  const name = c.req.param('name')
  const value = await c.env.MY_KV.get(`config:${name}`, 'json')

  if (value === null) {
    return c.json({ error: 'Config not found' }, 404)
  }

  return c.json({ name, value })
})

// 写入配置
app.put('/api/configs/:name', async (c) => {
  const name = c.req.param('name')
  const body = await c.req.json()

  await c.env.MY_KV.put(`config:${name}`, JSON.stringify(body), {
    // 配置不设过期时间，永久保存
  })

  return c.json({ message: 'Config saved', name })
})

// 删除配置
app.delete('/api/configs/:name', async (c) => {
  const name = c.req.param('name')

  await c.env.MY_KV.delete(`config:${name}`)

  return c.json({ message: 'Config deleted', name })
})

export default app
```

所有 key 都加了 `config:` 前缀，方便用 `list({ prefix })` 统一管理。

这其实是 KV 最常见的设计方式之一：**用前缀模拟目录和分类**。

因为 KV 没有表结构，也没有 SQL，所以你经常会看到这种 key 设计：

- `config:theme`

- `config:lang`

- `session:user:123`

- `cache:weather:shenzhen`

也就是说，key 本身就是你的"数据组织方式"。

## 9. 本地开发

`wrangler dev` 会自动模拟 KV，不需要额外配置：

terminal

```shellscript
wrangler dev
```

本地 KV 数据是本地开发环境里的模拟数据，不会直接写到线上真实 namespace。从 wrangler v3 开始，这份本地模拟数据**默认就会自动持久化**到 `.wrangler/state/` 目录下，不再需要手动加 `--persist` 标志（该标志已被移除）。

如果想把数据存到别的位置，可以用 `--persist-to` 指定：

terminal

```shellscript
wrangler dev --persist-to ./my-local-state
```

注意：想清空本地 KV 数据，直接删 `.wrangler/state/` 目录就行。记得把它加到 `.gitignore`。

## 10. 适用场景与局限

**适合用 KV 的场景：**

- 配置存储——功能开关、主题设置、系统参数

- 会话缓存——用户登录态，配合 `expirationTtl` 自动过期

- API 响应缓存——把耗时计算的结果缓存起来

- 限流计数器——记录某个 IP 或用户的请求次数（但更适合低频、允许一定误差的限流）

**不适合用 KV 的场景：**

- 强一致性需求——刚写入的数据需要立刻在全球读到，KV 做不到

- 复杂查询——需要按条件筛选、排序、JOIN，KV 只能按 key 查

- 高频写入——每秒大量写入同一个 key，KV 的写入有速率限制

这些场景用 D1（Cloudflare 的 SQLite 数据库）更合适。

如果你还是拿不准，一个最实用的判断是：

- 你已经能设计出稳定的 key，并且主要是按 key 读数据：优先考虑 KV

- 你开始想"我能不能按时间排序、按条件筛选、查最近 10 条"：那通常就该上数据库了

## 11. 总结

KV 的 API 就四个核心方法：`put`、`get`、`delete`、`list`。在 Hono 里通过 `c.env` 访问，配合 TypeScript 泛型声明类型，开发体验很顺畅。记住它的定位：全球分布、最终一致、读多写少。

下一篇我们讲 Cloudflare D1：当你需要关系型数据库和 SQL 查询时，该怎么使用
