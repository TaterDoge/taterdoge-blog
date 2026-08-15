---
title: "87 Cloudflare D1"
pubDate: 2026-05-09
description: "上一篇我们用 KV 存数据，体验很简单：给一个 key，存一个 value，取的时候再用 key 把 value 拿出来。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/12-cloudflare-d1/](https://aicompanion.usehook.cn/12-cloudflare-d1/)

## 1. 从 KV 的局限说起

上一篇我们用 KV 存数据，体验很简单：给一个 key，存一个 value，取的时候再用 key 把 value 拿出来。

但你很快就会遇到 KV 干不了的事。比如你要做一个用户系统：

- "查出所有注册时间在上个月的用户" —— KV 做不到，它只能按 key 取值，不能按字段筛选

- "找出所有下过订单但没付款的用户" —— 这需要把用户表和订单表关联起来查，KV 连"表"的概念都没有

- "把用户的邮箱从 [a@test.com](mailto:a@test.com) 改成 [b@test.com](mailto:b@test.com)，但得先确认没有别人用了 [b@test.com](mailto:b@test.com)" —— 这涉及唯一性约束，KV 也管不了

这些需求指向同一个东西：**关系型数据库**。

## 2. 关系型数据库 vs 非关系型数据库

数据库大的方向分两类，在学 D1 之前先把这两个概念理清楚。

### 关系型数据库

关系型数据库把数据组织成一张张**表（Table）**，就像 Excel 表格：每一行是一条记录，每一列是一个字段。

比如一张用户表：

| id | name | email | created_at |
| --- | --- | --- | --- |
| 1 | Alice | alice@example.com | 2024-01-15 |
| 2 | Bob | bob@example.com | 2024-02-20 |

再来一张订单表：

| id | user_id | product | amount |
| --- | --- | --- | --- |
| 1 | 1 | T恤 | 99 |
| 2 | 1 | 帽子 | 59 |
| 3 | 2 | 背包 | 199 |

注意订单表里有个 `user_id` 字段，指向用户表的 `id`。这就是"关系"——表和表之间通过字段关联起来。你可以写一条 SQL 把两张表联查：

code.ts

```sql
-- 查出 Alice 的所有订单
SELECT orders.product, orders.amount
FROM orders
JOIN users ON orders.user_id = users.id
WHERE users.name = 'Alice'
```

关系型数据库的核心能力就是这些：

- **结构化**：每张表有固定的列，每条数据都遵循同样的结构

- **SQL 查询**：可以按任意字段筛选、排序、聚合、分组

- **表关联**：通过外键把多张表串起来，联合查询

- **约束**：唯一性、非空、外键约束，数据库帮你守规矩

常见的关系型数据库有 MySQL、PostgreSQL、SQLite。

### 非关系型数据库

非关系型数据库（NoSQL）不按表格来组织数据，根据存储方式的不同又分好几类。上一篇学的 KV 就是其中一种：

- **键值存储（Key-Value）**：一个 key 对应一个 value，就像一个巨大的 `Map`。Cloudflare KV、Redis 都属于这类

- **文档数据库（Document）**：存的是 JSON 文档，每条数据的结构可以不一样。MongoDB 是典型代表

- **列族存储、图数据库**……还有其他类型，这里不展开

非关系型数据库的共同特点是：**灵活，但查询能力有限**。不能写 SQL，不能跨表联查，很多事情得靠应用层代码自己实现。

### 怎么选

简单判断：

- 数据之间有关联、需要复杂查询 → 关系型数据库

- 数据结构简单、按 key 存取就够用 → 非关系型数据库

在 Cloudflare 的生态里，KV 是非关系型的键值存储，而 **D1 就是关系型数据库**。

## 3. Cloudflare D1

D1 是 Cloudflare 提供的边缘 SQLite 数据库。前面讲了一堆概念，落到实际就是这几件事：

- 基于 SQLite，支持标准 SQL 查询

- 部署在 Cloudflare 边缘网络，读取速度快

- 适合读多写少的场景（用户信息、博客内容、配置数据等）

- 免费额度够个人项目用

上一篇用 KV 存简单的键值对，这一篇用 D1 来做需要建表、查询、关联的正经数据操作。

## 4. 创建数据库

terminal

```shellscript
wrangler d1 create my-db
```

执行后会输出数据库 ID，把它配到 `wrangler.jsonc`：

wrangler.jsonc

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-db",
      "database_id": "xxxx-xxxx-xxxx-xxxx"
    }
  ]
}
```

`binding = "DB"` 表示在代码里通过 `c.env.DB` 访问这个数据库。

## 5. 类型声明

在 Hono 里使用 D1，需要声明 Bindings 类型：

index.ts

```typescript
import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()
```

这样 `c.env.DB` 就有完整的类型提示了。

## 6. 数据库迁移

D1 用迁移文件管理表结构，不要手动建表。

**创建迁移文件：**

terminal

```shellscript
wrangler d1 migrations create my-db init
```

这会在项目根目录生成 `migrations/0001_init.sql` 文件。写入建表语句：

migrations/0001_init.sql

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**本地执行迁移：**

terminal

```shellscript
wrangler d1 migrations apply my-db --local
```

**远程执行迁移（部署到线上）：**

terminal

```shellscript
wrangler d1 migrations apply my-db --remote
```

本地和远程是两套独立的数据库，互不影响。开发时用 `--local`，上线前用 `--remote`。

## 7. 原生 SQL 操作

D1 的 API 很直接，就是写 SQL。

**查询所有记录：**

code.ts

```typescript
const { results } = await c.env.DB
  .prepare('SELECT * FROM users')
  .all()
```

**查询单条记录：**

code.ts

```typescript
const user = await c.env.DB
  .prepare('SELECT * FROM users WHERE id = ?')
  .bind(id)
  .first()
```

**插入记录：**

code.ts

```typescript
await c.env.DB
  .prepare('INSERT INTO users (name, email) VALUES (?, ?)')
  .bind(name, email)
  .run()
```

**更新记录：**

code.ts

```typescript
await c.env.DB
  .prepare('UPDATE users SET name = ?, email = ? WHERE id = ?')
  .bind(name, email, id)
  .run()
```

**删除记录：**

code.ts

```typescript
await c.env.DB
  .prepare('DELETE FROM users WHERE id = ?')
  .bind(id)
  .run()
```

几个要点：

- `.prepare()` 写 SQL，用 `?` 做参数占位符

- `.bind()` 绑定参数，防 SQL 注入

- `.all()` 返回多条，`.first()` 返回一条，`.run()` 不返回数据

## 8. 批量执行

多条 SQL 需要一起执行时，用 `batch()`：

code.ts

```typescript
const results = await c.env.DB.batch([
  c.env.DB.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('Alice', 'alice@example.com'),
  c.env.DB.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('Bob', 'bob@example.com'),
  c.env.DB.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('Charlie', 'charlie@example.com'),
])
```

`batch()` 里的语句会在同一个事务中执行，要么全成功，要么全失败。

## 9. 完整 CRUD 示例

把上面的知识串起来，写一个用户表的增删改查 API：

index.ts

```typescript
import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

// 查询所有用户
app.get('/api/users', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT * FROM users ORDER BY created_at DESC')
    .all()
  return c.json(results)
})

// 查询单个用户
app.get('/api/users/:id', async (c) => {
  const id = c.req.param('id')
  const user = await c.env.DB
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(id)
    .first()

  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }
  return c.json(user)
})

// 创建用户
app.post('/api/users', async (c) => {
  const { name, email } = await c.req.json()

  const result = await c.env.DB
    .prepare('INSERT INTO users (name, email) VALUES (?, ?)')
    .bind(name, email)
    .run()

  return c.json({
    id: result.meta.last_row_id,
    name,
    email,
  }, 201)
})

// 更新用户
app.put('/api/users/:id', async (c) => {
  const id = c.req.param('id')
  const { name, email } = await c.req.json()

  const result = await c.env.DB
    .prepare('UPDATE users SET name = ?, email = ? WHERE id = ?')
    .bind(name, email, id)
    .run()

  if (result.meta.changes === 0) {
    return c.json({ error: 'User not found' }, 404)
  }
  return c.json({ id, name, email })
})

// 删除用户
app.delete('/api/users/:id', async (c) => {
  const id = c.req.param('id')

  const result = await c.env.DB
    .prepare('DELETE FROM users WHERE id = ?')
    .bind(id)
    .run()

  if (result.meta.changes === 0) {
    return c.json({ error: 'User not found' }, 404)
  }
  return c.json({ message: 'Deleted' })
})

export default app
```

标准的 RESTful 风格。`result.meta.changes` 可以判断有没有实际修改到数据，`result.meta.last_row_id` 拿到自增 ID。

## 10. 本地开发

`wrangler dev` 会自动创建本地 SQLite 文件，存在 `.wrangler/state/` 目录下：

terminal

```shellscript
wrangler dev
```

本地数据库和线上完全隔离。每次 `wrangler dev` 启动时会自动使用本地数据库，不需要额外配置。

如果想清空本地数据库，直接删掉 `.wrangler/state/` 目录重新跑迁移就行。

## 11. D1 的限制

用之前要知道这些限制：

- **数据库大小**：免费版单个数据库最大 500MB，账号总量 5GB；付费版单库最大 10GB，账号总量 1TB

- **写入性能**：写操作需要同步到主节点，延迟比读高。写密集场景不适合 D1

- **不支持事务嵌套**：`batch()` 是一个事务，但不能在事务里再开事务

- **SQLite 语法**：不是 MySQL 也不是 PostgreSQL，部分语法有差异（比如一些仅限于 MySQL/PostgreSQL 的特有函数和索引写法）

- **单次查询限制**：单条 SQL 最多返回 5MB 数据

对于大部分 Web 应用来说，这些限制不是问题。D1 就是为轻量级、读多写少的场景设计的。

## 12. 总结

D1 给了你一个免运维的 SQL 数据库，配合 Hono 用起来很顺手。建库、迁移、CRUD 都是标准流程，API 设计也很简洁。

但直接写 SQL 字符串终究不够优雅，也容易出错。下一篇我们引入 Drizzle ORM，用类型安全的方式操作 D1。
