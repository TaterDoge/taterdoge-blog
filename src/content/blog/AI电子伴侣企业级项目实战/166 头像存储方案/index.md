---
title: "166 头像存储方案"
pubDate: 2026-06-03
description: "图片文件放 R2，数据库只存 key 和元数据，上传与读取统一通过 API 处理。这样一来，存储职责、访问职责、业务职责就是分开的。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-06-03
---
原文链接：[https://aicompanion.usehook.cn/31-avatar-storage/](https://aicompanion.usehook.cn/31-avatar-storage/)

## 1. 头像到底该怎么存

前面我们已经把认证、session、token、D1 migration 这些基础部分搭起来了。接下来我们思考如何处理头像。

先说明一下这篇的位置：它讲的是一套推荐落法，帮助我们把头像存储边界先设计清楚。当前仓库里还没有把头像上传、R2 绑定、元数据表这些实现正式接进去，所以下面的代码都按「推荐实现示例」来理解会更准确。

头像看着像个小功能，真写起来却很麻烦。因为它至少牵着 3 件事：

- 图片文件放哪

- 数据库里应该如何存储

- 上传和读取应该交给谁处理

很多人一开始都会想到一个很直接的做法：用户传完头像，系统拿到一个 URL，再把这个 URL 存回 `users.avatar_url`。

这个做法在很轻的场景里不是不能用。但只要你开始认真做上传校验、缓存、历史版本、默认头像替换，`avatar_url` 这种字段就会慢慢显得太粗。

更好的一套边界清楚的方案是：文件本体归对象存储，数据库只管记录文件标识和元数据，访问规则统一放在 API 里。

## 2. 为什么文件不要直接放进 D1

我们先来看数据库应该如何存储。

D1 适合存的是结构化数据。用户、邮箱、session、refresh token、角色关系，这些东西都有明确字段，也要经常查、改、关联。

头像文件不是这一类。

你不会写 SQL 去查某张头像的像素宽度，也不会关心图片二进制内部长什么样。你通常只会做两件事：上传一张图，再按某个标识把它取回来。

除此之外，**数据库职责会变重。**

它本来该管关系数据，现在又顺手兼了一层文件存储，边界会越来越别扭。

**数据体积会变大。**
用户表、权限表、会话表本来都比较轻，图片一进来，库的读写特征就不一样了。

**后面扩展不舒服。**
以后你要做 CDN 缓存、按 key 删除旧头像、保留版本历史，或者替换存储服务，对象存储都会比数据库顺手得多。

所以头像更稳的分工应该是这样的：R2 负责存文件，D1 负责存结构化信息。

## 3. 数据库里为什么更适合存 key

通常，我们会更推荐在 D1 数据库里存 **key**，而不是直接存公开 URL。

比如可以长这样：

index.txt

```txt
avatars/users/<userId>/<timestamp>-<uuid>.webp
```

这是因为 key 很稳定。只要对象还在，这个 key 就能唯一指向那张头像，不用担心对象移动或删除导致找不到。

key 也不绑死访问方式。今天你也许让前端通过 API 读头像，明天也许接 CDN，后天也许连 bucket 域名都换了。只要库里存的是 key，访问层怎么变都还有空间。

而且 key 天然适合表达规则。默认头像可以放 `avatars/default/`，用户头像可以放 `avatars/users/<userId>/`。以后你想查历史、批量清理、按前缀扫描，都会自然很多。

如果数据库里直接塞完整 URL，看起来像省了一步，实际上是把两层东西绑死了：一层是内部标识，一层是对外访问地址。前者应该稳定，后者以后很可能会变。

所以如果你现在表里还是 `avatar_url`，不算错。但等头像上传真的接入对象存储之后，更稳的方向通常是把它往 `avatar_key` 这类语义上迁移。

## 4. R2 绑定和 key 规则

数据库里只记 key 之后，API 就得有一个地方真正去存文件。在 Cloudflare 这套栈里，这个角色最合适的就是 R2。

先看运行时绑定。下面这段不是当前仓库已有文件，而是推荐的绑定结构：

bindings.ts

```typescript
type ApiBindings = CloudflareBindings & {
  DB: D1Database
  AVATAR_BUCKET: R2Bucket
  ADMIN_ORIGIN: string
  JWT_ACCESS_SECRET: string
  JWT_REFRESH_SECRET: string
  ACCESS_TOKEN_TTL_SEC: string | number
  REFRESH_TOKEN_TTL_SEC: string | number
}
```

这里最关键的点只有一个：头像上传和读取依赖 `AVATAR_BUCKET`，这件事要在类型层面明确下来。

对应的 Wrangler 配置也要补上：

wrangler.jsonc

```jsonc
{
  "r2_buckets": [
    {
      "binding": "AVATAR_BUCKET",
      "bucket_name": "ai-agent-local-avatars"
    }
  ]
}
```

这样开发、测试、生产各自可以配自己的 bucket，但业务代码里统一只认 `c.env.AVATAR_BUCKET`。

接着我们再看 key 规则。

avatar-storage.ts

```typescript
export function buildDefaultAvatarKey(file: File, nowMs: number) {
  const extension = assertAvatarFile(file)
  return `avatars/default/${nowMs}-${uuidv7()}.${extension}`
}

export function buildUserAvatarKey(userId: string, file: File, nowMs: number) {
  const extension = assertAvatarFile(file)
  return `avatars/users/${userId}/${nowMs}-${uuidv7()}.${extension}`
}
```

这种写法目录语义很清楚。你一眼就知道这是默认头像，还是某个用户自己的头像。

文件名也不容易撞。时间戳加 `uuidv7()`，基本就把覆盖冲突避开了。

扩展名也不是直接相信原始文件名，而是从校验过的 MIME type 里推出来。这样会稳很多。

## 5. 上传前需要先校验

头像上传这种入口，最怕的不是代码写不出来，而是边界没卡住。

所以在真正上传之前，我们最好先把文件规则写死。

avatar-storage.ts

```typescript
const avatarMaxBytes = 2 * 1024 * 1024

const avatarExtensionByMimeType: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function assertAvatarFile(file: File) {
  const extension = avatarExtensionByMimeType[file.type]

  if (!extension) {
    throw new AppError(
      BizCode.COMMON_INVALID_REQUEST,
      'Avatar must be a JPG, PNG, or WebP image',
      400,
    )
  }

  if (file.size <= 0) {
    throw new AppError(
      BizCode.COMMON_INVALID_REQUEST,
      'Avatar file is empty',
      400,
    )
  }

  if (file.size > avatarMaxBytes) {
    throw new AppError(
      BizCode.COMMON_INVALID_REQUEST,
      'Avatar file must be 2MB or smaller',
      400,
    )
  }

  return extension
}
```

这里我们主要拦的是 3 类问题。

一类是文件类型不对。头像只允许 JPEG、PNG、WebP 就够了，别把任意文件放进来。

一类是空文件。字段存在，不代表文件内容真的有效。

还有一类是体积太大。头像不是原图备份仓库，2MB 这种限制通常已经足够实用。

## 6. 上传接口

把 key 规则和文件校验都准备好之后，上传接口就很好理解了。

profile.route.ts

```typescript
userRoute.post('/default-avatar/upload', async (c) => {
  const formData = await c.req.formData()
  const avatarFile = formData.get('file')

  if (!(avatarFile instanceof File)) {
    throw new AppError(BizCode.COMMON_INVALID_REQUEST, 'Avatar file is required', 400)
  }

  const nowMs = Date.now()
  const avatarKey = buildDefaultAvatarKey(avatarFile, nowMs)
  const contentType = avatarFile.type
  const extension = assertAvatarFile(avatarFile)

  await c.env.AVATAR_BUCKET.put(avatarKey, await avatarFile.arrayBuffer(), {
    httpMetadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
      contentDisposition: `inline; filename="default-avatar.${extension}"`,
    },
  })

  await insertDefaultAvatarVersion({
    db: getDb(c.env.DB),
    id: uuidv7(),
    key: avatarKey,
    fileName: avatarFile.name,
    contentType,
    sizeBytes: avatarFile.size,
    createdByUserId: claims.sub,
    createdAtMs: nowMs,
  })

  return c.json({
    ok: true,
    data: {
      key: avatarKey,
      updatedAtMs: nowMs,
    },
  })
})
```

我们可以把这个过程拆开看一下。

先从 `multipart/form-data` 里把文件取出来，再确认拿到的真是 `File`。

然后生成头像 key。这里顺手会再次触发文件校验，所以文件类型、文件大小这些边界也一起把控住了。

接着把文件本体写进 R2。这里除了 body 本身，还顺手写了 `httpMetadata`。这一步非常值，因为浏览器以后拿到这张图时，`content-type`、`cache-control`、`content-disposition` 都会更完整。

尤其是这句：

profile.route.ts

```typescript
cacheControl: 'public, max-age=31536000, immutable'
```

它不是随手一写。前面我们已经把头像 key 设计成每次更新都会换一个新 key，所以旧 key 对应的内容天然可以长期缓存。也就是说，缓存时间能拉长，不是因为头像特殊，而是因为 key 规则已经把版本切换这件事考虑进去了。

最后再把元数据写进数据库，或者至少把 `key` 返回给上层。这里数据库记录的不是图片本体，而是和这次上传相关的结构化信息。

## 7. 读取接口

上传解决了，读取也要约定一个规则。

这里常见的做法有两种。一种是把 R2 的公网地址直接给前端，让前端自己去拿。另一种是前端始终只找 API，再由 API 去 bucket 里读对象。

头像这类资源，我更建议第二种。

profile.route.ts

```typescript
userRoute.get('/avatar', async (c) => {
  const key = c.req.query('key')?.trim()

  if (!key) {
    throw new AppError(BizCode.COMMON_INVALID_REQUEST, 'Avatar key is required', 400)
  }

  const object = await c.env.AVATAR_BUCKET.get(key)

  if (!object) {
    throw new AppError(BizCode.COMMON_NOT_FOUND, 'Avatar is not found', 404)
  }

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)

  return new Response(object.body, {
    headers,
  })
})
```

这样做的好处很实在。

访问边界是统一的。以后你要加鉴权、限流、灰度策略，或者做更细的访问控制，入口都还在 API 这一层。

底层实现也更容易替换。今天头像放在 R2，明天就算你换成别的对象存储，前端也不用跟着改一堆地址。

还有一个很容易被忽略的点：数据库里存的是 key，不是底层 bucket URL。内部标识和对外访问地址分开之后，整个系统会稳很多。

## 8. 元数据单独放数据库表中

如果头像只是用户改一张图，然后系统永远只认最后那个值，那么 `users` 表里加一个 `avatar_key` 已经够用了。

但只要你想保留上传历史、支持回滚、做审计，单一个字段就不够了。这时候就该把元数据单独放表。

schema.ts

```typescript
export const defaultAvatarVersions = sqliteTable('default_avatar_versions', {
  id: text('id').primaryKey(),
  avatarKey: text('avatar_key').notNull(),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  index('idx_default_avatar_versions_created_at_ms').on(table.createdAtMs),
])
```

这张表里保存的不是图片，而是图片旁边那层信息，比如 key、原始文件名、content type、文件大小、上传人、上传时间。

这些信息就非常适合进数据库。因为以后你查历史、做审计、按时间排序、支持回滚，依赖的都是这些结构化字段，不是图片本体。

## 9. 总结

图片文件放 R2，数据库只存 key 和元数据，上传与读取统一通过 API 处理。

这样一来，存储职责、访问职责、业务职责就是分开的。以后你继续往前做用户自定义头像、默认头像替换、历史版本、旧文件清理，都是沿着现有结构往前扩，不需要回头推翻整套方案。
