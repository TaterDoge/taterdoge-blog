---
title: "88 D1 + Drizzle ORM"
pubDate: 2026-05-09
description: "没有类型检查：result 是 any，取 result.nmae 这种拼写错误编译器不报错"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/13-d1-drizzle-orm/](https://aicompanion.usehook.cn/13-d1-drizzle-orm/)

## 1. 原生 SQL 的问题

上一篇我们用 D1 做了用户 CRUD，SQL 都是手写字符串。

回顾一下那段代码：

index.ts

```typescript
app.get('/users/:id', async (c) => {
  const id = c.req.param('id')
  const result = await c.env.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(id).first()
  // result 的类型是 any
  // 字段名拼错了？编译器不会告诉你
  return c.json({ user: result })
})
```

问题有三个：

- **没有类型检查**：`result` 是 `any`，取 `result.nmae` 这种拼写错误编译器不报错

- **SQL 拼字符串**：字段多了容易漏、容易错，IDE 帮不了你

- **表结构散落各处**：建表 SQL 在一个地方，查询在另一个地方，改了表结构你得全局搜代码

ORM 就是来解决这些问题的。它用 TypeScript 对象描述表结构，查询结果自动带类型。

## 2. 为什么选 Drizzle

市面上 Node.js ORM 主要有 Prisma 和 Drizzle 两个。

**Prisma** 的问题：它有自己的 schema 语言（`.prisma` 文件），查询语法和 SQL 差别很大，学习成本高。而且它的运行时比较重，在 Workers 这种边缘环境跑起来不太舒服。

**Drizzle** 的优势：

- **TypeScript 优先**：schema 就是 TypeScript 代码，不需要额外的语言

- **SQL-like 语法**：`select().from().where()` 和 SQL 几乎一一对应，会写 SQL 就会用 Drizzle

- **原生支持 D1**：Cloudflare 官方推荐，适配没有额外开销

- **零依赖、极轻量**：打包后很小，适合 Workers 环境

## 3. 安装

terminal

```shellscript
npm install drizzle-orm
npm install -D drizzle-kit
```

- **drizzle-orm**：运行时库，提供查询构建器

- **drizzle-kit**：开发工具，负责生成迁移 SQL 和管理数据库 schema

## 4. 定义 Schema

Schema 是一切的起点。在项目根目录创建 `src/db/schema.ts`：

src/db/schema.ts

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: text('role').default('user'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})
```

几个要点：

- D1 底层是 SQLite，所以用 `drizzle-orm/sqlite-core` 的类型

- `sqliteTable('users', {...})` 第一个参数是真实表名

- 链式调用 `.notNull()`、`.unique()`、`.default()` 定义约束

- `sql` 模板标签用于嵌入原生 SQL 表达式（比如 `CURRENT_TIMESTAMP`）

- `users` 变量既是查询时的表引用，也自动推导出了 TypeScript 类型

从 schema 中可以推导出类型，方便在其他地方使用：

src/db/schema.ts

```typescript
import { InferSelectModel, InferInsertModel } from 'drizzle-orm'

// 查询结果的类型
type User = InferSelectModel<typeof users>
// { id: number; name: string; email: string; role: string | null; createdAt: string | null }

// 插入数据的类型（id、role、createdAt 是可选的）
type NewUser = InferInsertModel<typeof users>
// { id?: number; name: string; email: string; role?: string; createdAt?: string }
```

## 5. 初始化 Drizzle 实例

在 Hono 路由中，把 D1 binding 传给 Drizzle：

src/index.ts

```typescript
import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { users } from './db/schema'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/users', async (c) => {
  const db = drizzle(c.env.DB)
  const result = await db.select().from(users).all()
  return c.json(result)
})

export default app
```

注意：**每次请求都要调用 `drizzle(c.env.DB)` 创建新实例**。Workers 是无状态的，没有持久化的数据库连接，这和传统 Node.js 服务不一样。不过别担心，`drizzle()` 只是一个轻量包装，没有性能问题。

## 6. CRUD 查询构建器

这是 Drizzle 最核心的部分。我们把每种操作和原生 SQL 对比着看。

### 查询所有

原生

```typescript
const result = await c.env.DB
  .prepare('SELECT * FROM users')
  .all()
// result.results 是 any[]
```

Drizzle

```typescript
const db = drizzle(c.env.DB)
const result = await db.select().from(users).all()
// result 是 User[]，每个字段都有类型
```

### 条件查询

原生

```typescript
const user = await c.env.DB
  .prepare('SELECT * FROM users WHERE id = ?')
  .bind(id)
  .first()
// user 是 any
```

Drizzle

```typescript
import { eq } from 'drizzle-orm'

const user = await db.select().from(users)
  .where(eq(users.id, id))
  .get()
// user 是 User | undefined
```

`eq` 是等于比较，Drizzle 还提供了一整套条件函数：

conditions.ts

```typescript
import { eq, ne, gt, gte, lt, lte, like, and, or, isNull } from 'drizzle-orm'

// 等于 / 不等于
eq(users.role, 'admin')       // role = 'admin'
ne(users.role, 'admin')       // role != 'admin'

// 大小比较
gt(users.id, 10)              // id > 10
gte(users.id, 10)             // id >= 10

// 模糊匹配
like(users.name, '%张%')      // name LIKE '%张%'

// 组合条件
and(eq(users.role, 'admin'), gt(users.id, 5))   // role = 'admin' AND id > 5
or(eq(users.role, 'admin'), eq(users.role, 'editor'))  // role = 'admin' OR role = 'editor'

// NULL 检查
isNull(users.createdAt)       // created_at IS NULL
```

### 插入

原生

```typescript
const result = await c.env.DB
  .prepare('INSERT INTO users (name, email) VALUES (?, ?) RETURNING *')
  .bind(name, email)
  .first()
```

Drizzle

```typescript
const result = await db.insert(users)
  .values({ name, email })
  .returning()
  .get()
// result 是 User，字段带类型
// 如果 name 拼成了 nmae，TypeScript 直接报错
```

### 更新

原生

```typescript
await c.env.DB
  .prepare('UPDATE users SET name = ? WHERE id = ?')
  .bind(name, id)
  .run()
```

Drizzle

```typescript
await db.update(users)
  .set({ name })
  .where(eq(users.id, id))
  .run()
```

### 删除

原生

```typescript
await c.env.DB
  .prepare('DELETE FROM users WHERE id = ?')
  .bind(id)
  .run()
```

Drizzle

```typescript
await db.delete(users)
  .where(eq(users.id, id))
  .run()
```

对比下来，Drizzle 的语法和 SQL 几乎一一对应，但多了类型安全。写错字段名、传错类型，编译阶段就能发现。

## 7. 关联查询

假设我们有一个 posts 表，每个 post 属于一个 user：

src/db/schema.ts

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql, relations } from 'drizzle-orm'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: text('role').default('user'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const posts = sqliteTable('posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  content: text('content').notNull(),
  authorId: integer('author_id').notNull().references(() => users.id),
})

// 定义关系
export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}))

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, {
    fields: [posts.authorId],
    references: [users.id],
  }),
}))
```

使用 `db.query` 做关联查询：

index.ts

```typescript
import * as schema from './db/schema'

const db = drizzle(c.env.DB, { schema })

// 查询用户及其所有文章
const usersWithPosts = await db.query.users.findMany({
  with: {
    posts: true,
  },
})
// 类型自动推导：{ id: number; name: string; ...; posts: Post[] }[]

// 查询文章及其作者
const postsWithAuthor = await db.query.posts.findMany({
  with: {
    author: true,
  },
})
```

注意两点：

- 使用 `db.query` 需要在 `drizzle()` 初始化时传入 `{ schema }`

- `relations()` 只是告诉 Drizzle 表之间的关系，不会生成外键约束的 SQL，外键靠 `.references()` 定义

## 8. 迁移工作流

Schema 定义好了，怎么同步到数据库？这就是 drizzle-kit 的工作。

### 配置 drizzle-kit

在项目根目录创建 `drizzle.config.ts`：

drizzle.config.ts

```typescript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'sqlite',
})
```

### 生成迁移文件

terminal

```shellscript
npx drizzle-kit generate
```

这会读取你的 schema，和上一次的状态对比，生成一个 SQL 迁移文件：

code.ts

```txt
drizzle/migrations/
  0000_create_users.sql
  0001_add_posts.sql
```

打开看看，就是标准的 SQL：

0000_create_users.sql

```sql
CREATE TABLE `users` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL,
  `role` text DEFAULT 'user',
  `created_at` text DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
```

### 应用迁移

用 wrangler 把迁移 SQL 跑到 D1 上：

terminal

```shellscript
# 本地开发环境
npx wrangler d1 migrations apply my-database --local

# 远程生产环境
npx wrangler d1 migrations apply my-database --remote
```

整个流程就是：**改 schema -> generate -> apply**，三步走。

## 9. 完整示例：用 Drizzle 重写用户 CRUD

把前面的知识点串起来，完整的代码如下：

src/db/schema.ts

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: text('role').default('user'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})
```

src/index.ts

```typescript
import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { users } from './db/schema'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

// 获取所有用户
app.get('/users', async (c) => {
  const db = drizzle(c.env.DB)
  const allUsers = await db.select().from(users).all()
  return c.json(allUsers)
})

// 获取单个用户
app.get('/users/:id', async (c) => {
  const db = drizzle(c.env.DB)
  const id = Number(c.req.param('id'))
  const user = await db.select().from(users)
    .where(eq(users.id, id))
    .get()

  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }
  return c.json(user)
})

// 创建用户
app.post('/users', async (c) => {
  const db = drizzle(c.env.DB)
  const { name, email } = await c.req.json()

  const newUser = await db.insert(users)
    .values({ name, email })
    .returning()
    .get()

  return c.json(newUser, 201)
})

// 更新用户
app.put('/users/:id', async (c) => {
  const db = drizzle(c.env.DB)
  const id = Number(c.req.param('id'))
  const { name, email } = await c.req.json()

  const updated = await db.update(users)
    .set({ name, email })
    .where(eq(users.id, id))
    .returning()
    .get()

  if (!updated) {
    return c.json({ error: 'User not found' }, 404)
  }
  return c.json(updated)
})

// 删除用户
app.delete('/users/:id', async (c) => {
  const db = drizzle(c.env.DB)
  const id = Number(c.req.param('id'))

  const deleted = await db.delete(users)
    .where(eq(users.id, id))
    .returning()
    .get()

  if (!deleted) {
    return c.json({ error: 'User not found' }, 404)
  }
  return c.json({ message: 'Deleted', user: deleted })
})

export default app
```

和上一篇的原生 SQL 版本对比，代码量差不多，但每一行都有类型保护。重构时改了 schema 的字段名，TypeScript 编译器会帮你把所有用到的地方都标红。

## 10. Workers 环境注意事项

在 Cloudflare Workers 中使用 Drizzle 有几点和传统 Node.js 不同：

- **每次请求新建实例**：`drizzle(c.env.DB)` 要在请求处理函数里调用，不能放在顶层。Workers 每次请求的 `c.env.DB` 可能不同

- **没有连接池**：D1 是 HTTP 协议访问的，不存在 TCP 连接池的概念，所以不需要配置连接数

- **事务支持有限**：D1 支持事务，但 Drizzle 的 `db.transaction()` 在 D1 驱动下有些限制，复杂事务建议用 `db.batch()` 代替

- **批量操作用 batch**：D1 支持批量执行多条 SQL，Drizzle 也暴露了这个能力

batch.ts

```typescript
const db = drizzle(c.env.DB)

// 批量执行：一次网络请求发送多条 SQL
const results = await db.batch([
  db.insert(users).values({ name: 'Alice', email: 'alice@example.com' }),
  db.insert(users).values({ name: 'Bob', email: 'bob@example.com' }),
  db.select().from(users).all(),
])
// results[0] 是第一条 insert 的结果
// results[1] 是第二条 insert 的结果
// results[2] 是 select 的结果
```

## 总结

Drizzle ORM 解决了原生 SQL 的三个痛点：类型安全、字段校验、schema 集中管理。它的 SQL-like 语法没有太多学习成本，又能享受 TypeScript 的编译时检查。

核心流程：定义 schema -> 生成迁移 -> 写查询。

下一篇我们来看 Cloudflare R2 对象存储，处理文件上传的场景。
