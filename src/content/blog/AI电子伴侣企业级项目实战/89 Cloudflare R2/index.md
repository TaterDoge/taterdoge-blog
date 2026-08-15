---
title: "89 Cloudflare R2"
pubDate: 2026-05-09
description: "前面我们学了两种存数据的方式：KV 存键值对，D1 存结构化的表格数据。但有一类东西它们都不擅长——文件。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/14-cloudflare-r2/](https://aicompanion.usehook.cn/14-cloudflare-r2/)

## 1. 为什么需要对象存储

前面我们学了两种存数据的方式：KV 存键值对，D1 存结构化的表格数据。但有一类东西它们都不擅长——**文件**。

用户上传的头像、文章里的配图、生成的 PDF 报告、录制的音频……这些都是文件。文件和数据库里的数据有本质区别：

- **体积大**：一张图片几百 KB 到几 MB，一个视频可能几百 MB。数据库存这些东西效率很低

- **不需要查询内部内容**：你不会"查出所有宽度大于 1920px 的图片"，你只会"按文件名取出这张图"

- **需要直接下载**：浏览器要直接拿到图片的二进制数据来渲染，不是拿一段 JSON

所以需要一种专门存文件的方案，这就是**对象存储（Object Storage）**。

## 2. 什么是对象存储

对象存储的模型很简单：每个文件就是一个"对象"，每个对象有一个唯一的 key（相当于文件路径），存储的内容就是文件本身的二进制数据。

你可以把它想象成一个巨大的网盘，但没有真正的文件夹层级。虽然 key 可以写成 `uploads/2024/avatar.png` 这种带斜杠的路径，看起来像文件夹结构，但底层其实是扁平的——`uploads/2024/avatar.png` 就是一整个 key 字符串，不存在叫 `uploads` 的文件夹。

和我们前面学过的存储做个对比：

|  | KV | D1 | 对象存储 |
| --- | --- | --- | --- |
| 存什么 | 小段文本/JSON | 结构化数据（表格） | 文件（图片、视频、文档等） |
| 怎么取 | 按 key 取 value | SQL 查询，支持筛选、关联 | 按 key 取文件 |
| 单条大小 | 最大 25MB | 行数据通常很小 | 单文件最大几 GB |
| 典型用途 | 配置、缓存、Session | 用户信息、订单、文章 | 头像、附件、静态资源 |

对象存储领域最出名的是 AWS 的 S3（Simple Storage Service），它基本定义了整个行业的 API 标准。后来的云厂商做对象存储，大多兼容 S3 的接口，这样迁移成本低。

## 3. Cloudflare R2

R2 是 Cloudflare 提供的对象存储服务，兼容 S3 的 API。和 S3 最大的区别：**R2 没有出口流量费**。

S3 每 GB 出口流量收 0.09 美元，如果你的应用有大量图片访问或文件下载，流量费很容易比存储费还贵。R2 直接免了这笔钱，只收存储费（0.015 美元/GB/月）。

免费额度对个人项目也很友好：每月 10GB 存储、100 万次写入操作、1000 万次读取操作。

## 4. 创建 R2 Bucket

用 wrangler 命令行创建：

terminal

```shellscript
wrangler r2 bucket create my-bucket
```

创建成功后，在 `wrangler.jsonc` 里绑定到 Worker：

wrangler.jsonc

```jsonc
{
  "r2_buckets": [
    {
      "binding": "BUCKET",
      "bucket_name": "my-bucket"
    }
  ]
}
```

`binding` 是你在代码里访问这个 bucket 的变量名，`bucket_name` 是实际的 bucket 名称。

然后给 Hono 加上类型声明：

index.ts

```typescript
import { Hono } from 'hono'

type Bindings = {
  BUCKET: R2Bucket
}

const app = new Hono<{ Bindings: Bindings }>()
```

这样 `c.env.BUCKET` 就有完整的类型提示了。

## 5. 核心操作

R2Bucket 提供四个核心方法，覆盖了对象存储的增删查：

index.ts

```typescript
import { Hono } from 'hono'

type Bindings = {
  BUCKET: R2Bucket
}

const app = new Hono<{ Bindings: Bindings }>()

// 上传文件
app.put('/objects/:key', async (c) => {
  const key = c.req.param('key')
  const body = await c.req.arrayBuffer()

  await c.env.BUCKET.put(key, body, {
    httpMetadata: {
      contentType: c.req.header('Content-Type') || 'application/octet-stream',
    },
  })

  return c.json({ key, message: 'Uploaded' })
})

// 获取文件
app.get('/objects/:key', async (c) => {
  const key = c.req.param('key')
  const object = await c.env.BUCKET.get(key)

  if (!object) {
    return c.json({ error: 'Not found' }, 404)
  }

  c.header('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream')
  return c.body(object.body)
})

// 删除文件
app.delete('/objects/:key', async (c) => {
  const key = c.req.param('key')
  await c.env.BUCKET.delete(key)
  return c.json({ message: 'Deleted' })
})

// 列出文件
app.get('/objects', async (c) => {
  const prefix = c.req.query('prefix') || ''
  const limit = Number(c.req.query('limit')) || 20
  const cursor = c.req.query('cursor')

  const listed = await c.env.BUCKET.list({
    prefix,
    limit,
    cursor: cursor || undefined,
  })

  return c.json({
    objects: listed.objects.map((obj) => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded,
    })),
    truncated: listed.truncated,
    cursor: listed.truncated ? listed.cursor : undefined,
  })
})

export default app
```

几个要点：

- `put(key, body, options)` 的 body 可以是 `ArrayBuffer`、`ReadableStream`、`string` 等

- `get(key)` 返回 `R2ObjectBody | null`，注意判空

- `list()` 支持分页，`truncated` 为 `true` 时用 `cursor` 获取下一页

## 6. 文件上传 API

实际项目中，前端一般用 `multipart/form-data` 上传文件。来写一个完整的上传接口：

index.ts

```typescript
import { Hono } from 'hono'

type Bindings = {
  BUCKET: R2Bucket
}

const app = new Hono<{ Bindings: Bindings }>()

app.post('/upload', async (c) => {
  const formData = await c.req.formData()
  const file = formData.get('file') as File

  if (!file) {
    return c.json({ error: 'No file provided' }, 400)
  }

  // 用时间戳 + 原始文件名作为 key，避免重名覆盖
  const key = `uploads/${Date.now()}-${file.name}`

  await c.env.BUCKET.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type,
    },
  })

  return c.json({ key, size: file.size })
})

export default app
```

前端调用：

client.ts

```typescript
const formData = new FormData()
formData.append('file', fileInput.files[0])

const res = await fetch('https://your-worker.dev/upload', {
  method: 'POST',
  body: formData,
})

const { key } = await res.json()
console.log('文件已上传，key:', key)
```

注意 `file.stream()` 是流式传输，不会把整个文件加载到内存，适合大文件。

## 7. 文件下载与图片服务

上传了文件，还需要一个下载/访问接口。可以做一个简单的图片服务：

index.ts

```typescript
import { Hono } from 'hono'

type Bindings = {
  BUCKET: R2Bucket
}

const app = new Hono<{ Bindings: Bindings }>()

// 通过路径访问文件，如 /files/uploads/1234-avatar.png
app.get('/files/*', async (c) => {
  const key = c.req.path.replace('/files/', '')
  const object = await c.env.BUCKET.get(key)

  if (!object) {
    return c.notFound()
  }

  // 设置响应头
  c.header('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream')
  c.header('Content-Length', String(object.size))
  c.header('ETag', object.httpEtag)

  // 缓存 1 小时
  c.header('Cache-Control', 'public, max-age=3600')

  return c.body(object.body)
})

export default app
```

加上 `Cache-Control` 后，图片会被 Cloudflare CDN 缓存，后续请求不用再读 R2，响应更快。

## 8. 预签名 URL

有时候你不想让文件流量经过 Worker，想让客户端直接从 R2 读写。这时候可以用预签名 URL。

R2 兼容 S3 的预签名 URL 机制，需要用 `@aws-sdk/s3-request-presigner`：

index.ts

```typescript
import { Hono } from 'hono'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

type Bindings = {
  R2_ACCOUNT_ID: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

const getS3Client = (env: Bindings) => {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  })
}

// 生成上传用的预签名 URL
app.post('/presign/upload', async (c) => {
  const { filename, contentType } = await c.req.json()
  const key = `uploads/${Date.now()}-${filename}`

  const client = getS3Client(c.env)
  const command = new PutObjectCommand({
    Bucket: 'my-bucket',
    Key: key,
    ContentType: contentType,
  })

  const url = await getSignedUrl(client, command, { expiresIn: 3600 })
  return c.json({ url, key })
})

// 生成下载用的预签名 URL
app.post('/presign/download', async (c) => {
  const { key } = await c.req.json()

  const client = getS3Client(c.env)
  const command = new GetObjectCommand({
    Bucket: 'my-bucket',
    Key: key,
  })

  const url = await getSignedUrl(client, command, { expiresIn: 3600 })
  return c.json({ url })
})

export default app
```

前端拿到预签名 URL 后，直接用 `fetch` PUT/GET 就行，不经过 Worker，减少延迟和带宽消耗。

## 9. R2 的限制

用之前知道几个限制：

- **单次 PUT 最大 5GB**，超过需要用 multipart upload（分片上传），最大支持 5TB

- **免费额度**：10GB 存储、100 万次写入、1000 万次读取/月

- **key 长度**：最大 1024 字节

- **metadata 大小**：自定义 metadata 最大 2KB

- **每个账号**：最多 1000 个 bucket

对于大多数中小项目来说，免费额度完全够用。

## 10. 实用场景

几个典型用途：

index.ts

```typescript
import { Hono } from 'hono'

type Bindings = {
  BUCKET: R2Bucket
}

const app = new Hono<{ Bindings: Bindings }>()

// 用户头像上传
app.post('/api/avatar', async (c) => {
  const formData = await c.req.formData()
  const file = formData.get('avatar') as File

  if (!file.type.startsWith('image/')) {
    return c.json({ error: 'Only images allowed' }, 400)
  }

  if (file.size > 2 * 1024 * 1024) {
    return c.json({ error: 'File too large, max 2MB' }, 400)
  }

  const key = `avatars/${crypto.randomUUID()}.${file.name.split('.').pop()}`
  await c.env.BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  })

  return c.json({ avatarUrl: `/files/${key}` })
})

// AI 生成图片存储
app.post('/api/ai-images', async (c) => {
  const { imageBuffer, prompt } = await c.req.json()
  const key = `ai-generated/${Date.now()}.png`

  await c.env.BUCKET.put(key, Uint8Array.from(atob(imageBuffer), (c) => c.charCodeAt(0)), {
    httpMetadata: { contentType: 'image/png' },
    customMetadata: { prompt },
  })

  return c.json({ key })
})

// 文档附件
app.post('/api/attachments', async (c) => {
  const formData = await c.req.formData()
  const file = formData.get('file') as File

  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'text/plain',
  ]

  if (!allowedTypes.includes(file.type)) {
    return c.json({ error: 'File type not allowed' }, 400)
  }

  const key = `attachments/${Date.now()}-${file.name}`
  await c.env.BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  })

  return c.json({ key, filename: file.name })
})

export default app
```

头像上传加了类型和大小校验，AI 图片用了 `customMetadata` 存储生成参数，文档附件限制了允许的文件类型。根据业务需求灵活调整就好。

## 11. 总结

R2 是 Cloudflare Workers 生态里做文件存储的首选方案。S3 兼容的 API 意味着迁移成本低，零出口流量费是最大卖点。通过 `c.env.BUCKET` 就能直接操作，`put`、`get`、`delete`、`list` 四个方法覆盖了绝大多数场景。

下一篇看 Hono RPC 客户端——怎么让前端调用后端 API 像调用本地函数一样有类型提示。
