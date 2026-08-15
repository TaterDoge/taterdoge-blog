---
title: "92 项目结构与环境管理"
pubDate: 2026-05-10
description: "前面几篇的示例代码，我们都是在一个 index.ts 里写完所有东西——路由、中间件、数据库操作、类型定义，全部塞在同一个文件。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/17-project-structure/](https://aicompanion.usehook.cn/17-project-structure/)

## 1. 一个文件写到底的阶段

前面几篇的示例代码，我们都是在一个 `index.ts` 里写完所有东西——路由、中间件、数据库操作、类型定义，全部塞在同一个文件。

项目小的时候这样做完全没问题。路由就那么几个，一眼就能看到全貌，拆文件反而多此一举。

但随着功能增加，你会遇到这些情况：

- `index.ts` 膨胀到三四百行，想找一个路由要上下滚很久

- 用户路由的修改和认证中间件的修改混在同一个文件里，改一个担心影响另一个

- 两个人同时改 `index.ts`，提交代码时冲突不断

到了这个阶段，就该把代码拆分到不同文件里了。

## 2. 拆成什么样

一个中等规模的 Hono 项目，我们按职责来组织目录：

index.ts入口文件，挂载路由和全局中间件types.tsBindings、Variables 等类型定义users.ts用户相关路由posts.ts文章相关路由auth.ts认证相关路由（登录、注册）auth.ts鉴权中间件logger.ts日志中间件schema.tsDrizzle 表结构定义index.tsDrizzle 实例工厂errors.ts自定义错误类response.ts统一响应格式wrangler.jsoncCloudflare Workers 配置drizzle.config.tsDrizzle ORM 配置package.json依赖和脚本

思路就一句话：**相同职责的代码放在一起**。路由放 `routes/`，中间件放 `middleware/`，数据库相关放 `db/`。入口文件 `index.ts` 只负责把它们串起来。

## 3. 入口文件：只负责组装

拆分之后，`index.ts` 变得非常简单——它不写任何业务逻辑，只做两件事：挂全局中间件、注册各个路由模块。

src/index.ts

```typescript
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import type { AppEnv } from './types'
import { usersApp } from './routes/users'
import { postsApp } from './routes/posts'
import { authApp } from './routes/auth'

const app = new Hono<AppEnv>()

// 全局中间件：所有请求都要经过
app.use('*', logger())
app.use('*', cors())
app.use('*', secureHeaders())

// 把路由模块挂载到对应的路径前缀下
app.route('/api/users', usersApp)
app.route('/api/posts', postsApp)
app.route('/api/auth', authApp)

// 健康检查接口（运维用来确认服务是否正常）
app.get('/health', (c) => c.json({ status: 'ok' }))

export default app
```

以后新增一个功能模块，只要在 `routes/` 下新建一个文件，然后在这里加一行 `app.route()` 就行。

## 4. 路由模块：各管各的

每个路由文件创建一个独立的 Hono 实例，处理一组相关的接口：

src/routes/users.ts

```typescript
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { authMiddleware } from '../middleware/auth'

export const usersApp = new Hono<AppEnv>()

// 获取所有用户
usersApp.get('/', async (c) => {
  const db = c.get('db')
  const users = await db.select().from(usersTable)
  return c.json(users)
})

// 获取单个用户
usersApp.get('/:id', async (c) => {
  const id = c.req.param('id')
  // ...
  return c.json(user)
})

// 创建用户（需要先通过鉴权中间件）
usersApp.post('/', authMiddleware, async (c) => {
  const body = await c.req.json()
  // ...
  return c.json(newUser, 201)
})
```

注意这里的路径都是 `/` 和 `/:id`，没有写 `/api/users`。因为入口文件里写了 `app.route('/api/users', usersApp)`，所以这个模块里的 `/` 实际上对应的就是 `/api/users`，`/:id` 对应 `/api/users/:id`。

这样做的好处是模块不跟路径绑死。哪天你想把用户接口从 `/api/users` 改到 `/v2/users`，只需要改入口文件那一行，路由模块的代码完全不用动。

## 5. 类型定义：集中放一个地方

前面的文章里，我们在每个文件里都写过 `type Bindings = { DB: D1Database }` 这样的类型声明。文件少的时候还行，文件一多就会出现同一个类型到处重复定义、改了一处忘了另一处的问题。

所以把所有共享的类型定义集中放到 `types.ts`：

src/types.ts

```typescript
export type AppEnv = {
  Bindings: {
    // 环境变量
    JWT_SECRET: string
    API_KEY: string

    // Cloudflare 服务绑定
    DB: D1Database
    KV: KVNamespace
    BUCKET: R2Bucket
  }
  Variables: {
    // 中间件通过 c.set() 设置的请求级变量
    user: {
      id: number
      email: string
      role: string
    }
    db: DrizzleD1Database
  }
}
```

其他文件只需要 `import type { AppEnv } from '../types'`，然后 `new Hono<AppEnv>()` 就能拿到完整的 `c.env` 和 `c.get()` 类型提示。加一个新的环境变量，改 `types.ts` 这一个地方就够了。

## 6. wrangler.jsonc 配置详解

代码结构理清了，接下来看配置。`wrangler.jsonc` 是 Cloudflare Workers 的配置文件，告诉 Cloudflare 怎么运行你的 Worker、绑定了哪些服务。

wrangler.jsonc

```jsonc
{
  "name": "my-api",
  "main": "src/index.ts",
  "compatibility_date": "2024-12-01",

  // 非敏感配置，直接写在这里
  "vars": {
    "APP_NAME": "My API",
    "MAX_PAGE_SIZE": "50"
  },

  // D1 数据库绑定
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-db",
      "database_id": "xxxx-xxxx-xxxx"
    }
  ],

  // KV 绑定
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "xxxx-xxxx-xxxx"
    }
  ],

  // R2 存储桶绑定
  "r2_buckets": [
    {
      "binding": "BUCKET",
      "bucket_name": "my-bucket"
    }
  ]
}
```

几个要点：

- `name`：部署后的 Worker 名称，也是默认的子域名前缀

- `main`：入口文件路径

- `compatibility_date`：运行时兼容日期，决定了可用的 API 版本

- `vars`：非敏感的环境变量，会被提交到 Git

- 绑定（`d1_databases`、`kv_namespaces`、`r2_buckets`）：把 Cloudflare 的服务挂到 Worker 上

## 7. 环境变量：哪些能提交，哪些不能

环境变量按敏感程度分两种处理方式。

**不怕被看到的配置** — 直接写在 `wrangler.jsonc` 的 `vars` 里，跟代码一起提交到 Git：

wrangler.jsonc

```jsonc
{
  "vars": {
    "APP_NAME": "My API",
    "ALLOWED_ORIGINS": "https://example.com"
  }
}
```

**不能泄露的密钥** — 用 `wrangler secret` 命令单独设置，不会出现在任何文件里：

terminal

```shellscript
wrangler secret put JWT_SECRET
wrangler secret put API_KEY
```

执行后会提示你输入值。这些密钥加密存储在 Cloudflare 的服务器上，你在控制台也只能看到"已设置"，看不到具体内容。

不管是哪种方式设置的环境变量，代码里的用法完全一样，都是 `c.env.变量名`：

code.ts

```typescript
app.get('/api/config', (c) => {
  const appName = c.env.APP_NAME    // 来自 vars
  const secret = c.env.JWT_SECRET   // 来自 wrangler secret
  // 用法完全一样
})
```

## 8. 本地开发的密钥怎么办

`wrangler secret` 设置的密钥存在 Cloudflare 的云端。但本地 `wrangler dev` 的时候，请求不走云端，拿不到这些密钥。

解决办法是在项目根目录创建一个 `.dev.vars` 文件，把本地开发需要的密钥写在里面：

.dev.vars

```txt
JWT_SECRET=local-dev-secret-key
API_KEY=local-dev-api-key
DATABASE_URL=http://localhost:8787
```

`wrangler dev` 启动时会自动读取这个文件。

这个文件里有密钥，**一定不能提交到 Git**，把它加到 `.gitignore`：

.gitignore

```txt
.dev.vars
.wrangler/
node_modules/
```

## 9. 多环境部署：不要在线上直接试

真实项目通常至少需要两套环境：一套用来测试验证（staging），一套对外提供服务（production）。两套环境跑同样的代码，但连接不同的数据库，互不干扰。这样你可以在 staging 上放心折腾，确认没问题了再部署到 production。

在 `wrangler.jsonc` 里用 `env` 字段来定义不同环境的配置：

wrangler.jsonc

```jsonc
{
  "name": "my-api",
  "main": "src/index.ts",
  "compatibility_date": "2024-12-01",

  // 默认配置（开发环境）
  "vars": {
    "APP_NAME": "My API (dev)"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-db-dev",
      "database_id": "dev-xxxx-xxxx"
    }
  ],

  "env": {
    // ---- Staging 环境 ----
    "staging": {
      "name": "my-api-staging",
      "vars": {
        "APP_NAME": "My API (staging)"
      },
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "my-db-staging",
          "database_id": "staging-xxxx-xxxx"
        }
      ]
    },

    // ---- Production 环境 ----
    "production": {
      "name": "my-api-production",
      "vars": {
        "APP_NAME": "My API"
      },
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "my-db-prod",
          "database_id": "prod-xxxx-xxxx"
        }
      ]
    }
  }
}
```

部署时指定环境：

terminal

```shellscript
# 部署到 staging
wrangler deploy --env staging

# 部署到 production
wrangler deploy --env production
```

每个环境绑定独立的数据库和存储，数据完全隔离。staging 的数据库里插了一万条垃圾测试数据，也不会影响 production。

密钥也是按环境独立设置的：

terminal

```shellscript
wrangler secret put JWT_SECRET --env staging
wrangler secret put JWT_SECRET --env production
```

## 10. 把常用命令整理到 scripts 里

`wrangler d1 migrations apply my-db --env production --remote` 这种命令又长又容易打错。把它们放到 `package.json` 的 `scripts` 里，起一个短名字：

package.json

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy --env production",
    "deploy:staging": "wrangler deploy --env staging",
    "db:migrate:local": "wrangler d1 migrations apply my-db --local",
    "db:migrate:staging": "wrangler d1 migrations apply my-db --env staging --remote",
    "db:migrate:prod": "wrangler d1 migrations apply my-db --env production --remote",
    "db:studio": "drizzle-kit studio",
    "generate": "drizzle-kit generate"
  }
}
```

这样日常开发只需要记这几个短命令：

- `yarn dev` — 启动本地开发服务器

- `yarn db:migrate:local` — 本地数据库跑迁移

- `yarn deploy:staging` — 部署到测试环境验证

- `yarn db:migrate:prod` — 线上数据库跑迁移

- `yarn deploy` — 确认没问题后部署到正式环境

## 11. 总结

回顾一下这篇的要点：

- 代码按职责拆分：路由放 `routes/`，中间件放 `middleware/`，入口文件只负责组装

- 类型定义集中到 `types.ts`，改一处全局生效

- 不怕泄露的配置写 `wrangler.jsonc` 的 `vars`，密钥用 `wrangler secret` 单独设置

- 本地开发用 `.dev.vars` 提供密钥，记得加到 `.gitignore`

- 多环境用 `env` 字段配置，数据完全隔离

下一篇我们进入实战，用这套结构搭一个完整的 REST API。
