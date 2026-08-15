---
title: "156 创建 本地 D1 数据库"
pubDate: 2026-05-30
description: "后面做登录、session、refresh token 这些流程时，本地迭代会快很多"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/21-local-d1/](https://aicompanion.usehook.cn/21-local-d1/)

## 1. 为什么先做本地 D1

前面把认证表结构和 token 设计拆清楚之后，下一步就该把数据库真正跑起来。

这里先不要急着上线上 D1，先把本地 D1 建出来更适合新手。原因如下：

- 改表结构时，能马上重建和验证

- 假如要遇到必须写 SQL 的场景，不会一上来就碰远程环境

- 调接口时，出问题更容易调试和排查

- 后面做登录、session、refresh token 这些流程时，本地迭代会快很多

本地 D1 在开发阶段非常方便，改完 schema、跑完初始化、再发一个本地请求，能立刻看到结果

## 2. 本地 D1 是什么

Cloudflare D1 底层是 SQLite 风格数据库。平时说「本地 D1」，本质上不是在本机起一个全新的数据库产品，而是通过 Wrangler 在本地开发环境里，给 Worker 提供一个 D1 绑定和对应的本地数据库文件。

所以这里有两层概念：

- **Worker 代码里的 D1 绑定**

- **本地开发环境里那份 SQLite 数据文件**

你写代码时，用的是 `env.DB` 这类绑定名。你本地执行 SQL、初始化表结构时，操作的是 Wrangler 维护的那份本地数据库。

把这两层概念想清楚，后面就不会把「D1 绑定名」「数据库名」「数据库 id」「本地文件」混在一起。

## 3. 第一步先把 Wrangler 配好

如果项目已经接了 Cloudflare Worker，通常已经有 `wrangler.jsonc` 或 `wrangler.toml`。本地 D1 的入口也在这里。

最常见的是在配置里写上 D1 绑定：

index.json

```json
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "ai-agent-local-auth",
      "database_id": "91e63d07-bee3-4c00-9349-cfde384ba6eb"
    }
  ]
}
```

这里 3 个字段别看混：

- `binding`：代码里拿来访问数据库的名字，例如 `env.DB`

- `database_name`：D1 这份数据库的别名，可读性更好

- `database_id`：Cloudflare 侧识别这份数据库的唯一标识

本地开发时，真正最常用的是 `binding`，因为代码里会一直用它

## 4. 创建

如果远程 D1 还没建，通常会先创建一份 D1 数据库，再把 `database_id` 回填到 wrangler 配置里。

命令一般是：

index.bash

```shellscript
npx wrangler d1 create ai-agent-local-auth
```

执行后，Wrangler 会返回一段结果，里面会带数据库名和 `database_id`。

拿到之后，把 `database_id` 填回 `wrangler.jsonc`。

## 5. 本地 SQL 初始化怎么跑

本地 D1 建好之后，接下来就该把表结构灌进去。

最常见的做法，是先准备一份初始化 SQL，比如：

index.sql

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
```

然后通过 Wrangler 把这份 SQL 执行到本地 D1：

index.bash

```shellscript
npx wrangler d1 execute ai-agent-local-auth --local --file=./sql/init.sql
```

- `execute`：执行 SQL

- `ai-agent-local-auth`：目标数据库名

- `--local`：明确这次打到本地数据库，不是远程

- `--file`：从文件里读 SQL

如果只是想临时跑一条 SQL，也可以直接传命令：

index.bash

```shellscript
npx wrangler d1 execute ai-agent-local-auth --local --command="SELECT name FROM sqlite_master WHERE type='table'"
```

这样可以快速确认本地表是不是已经建起来了。

## 6. 为什么初始化 SQL 要单独放文件

新手刚开始容易图省事，把建表 SQL 散在代码里到处跑。后面表一多，很快就乱。

单独放 SQL 文件有几个很直接的好处：

- 结构一眼能看清

- 初始化和业务代码分开

- 后面补 migration 更自然

- 出问题时，先查 SQL 文件，不用去翻 handler

所以本地 D1 这一步，最好顺手就把目录约定好。例如：

index.txt

```txt
apps/api/
  migrations/
    0001_init.sql
    0002_auth_sessions.sql
```

哪怕现在还没正式上 migration，先把 SQL 明确下来，后面会省很多事。

## 7. 开发阶段怎么连本地 D1

表建完之后，接下来就是在本地服务里真正连起来。

如果你本地是通过 Wrangler 跑 Worker，D1 绑定会随着本地 Worker 一起注入。你的业务代码里只需要正常使用 `env.DB`。

例如：

apps/api/src/routes/health.ts

```typescript
import { Hono } from 'hono'

// 注意，这里只是案例代码，实际项目中可能需要更复杂的绑定类型，这里只是为了示例
interface Env {
  DB: D1Database
}

const app = new Hono<{ Bindings: Env }>()

app.get('/health', async (c) => {
  const result = await c.env.DB.prepare('SELECT 1 as ok').first<{ ok: number }>()
  return c.json(result)
})

export default app
```

这段代码跑起来之后，只要本地 Worker 是通过 Wrangler 启动的，这个 `DB` 绑定就会指向本地 D1。

所以开发阶段真正的连法不是你手动 new 一个数据库连接，而是：

- 先配好 D1 binding

- 再通过 Wrangler 跑本地 Worker

- 运行时自然从 `env` 里拿到 D1

## 8. 本地 D1 最容易踩的坑

### 8.1 绑定名写错

配置里写的是 `binding: "DB"`，代码里却去拿 `env.DATABASE`，这种最常见。

### 8.2 SQL 链接到远程了

跑命令时少了 `--local`，结果以为自己在调本地，实际打的是远程库。

### 8.3 表结构已经改了，本地数据库还是旧的

你改了 `xxx.sql`，但没有重新执行，或者本地数据库文件还保留着旧状态，这时最容易以为是代码问题

### 8.4 把 D1 绑定和数据库名当成一回事

代码里用的是绑定名，Wrangler 命令里用的是数据库名，这两个不是一个东西。
