---
title: "142 环境变量配置"
pubDate: 2026-05-26
description: "环境变量本质上是一组注入到运行时环境里的配置值，用来告诉应用当前该连接什么环境、运行在哪、打开什么能力。它和写死在代码里的常量不同，环境变量的配置可以随着开发、联调、生产环境切换。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/7-env-config/](https://aicompanion.usehook.cn/7-env-config/)

## 1. 概述

环境变量本质上是一组注入到运行时环境里的配置值，用来告诉应用当前该连接什么环境、运行在哪、打开什么能力。它和写死在代码里的常量不同，环境变量的配置可以随着开发、联调、生产环境切换。

这个项目里，环境变量最直接承担两类职责：

- 标记当前业务运行语义，比如 `APP_ENV`

- 提供外部依赖地址，比如 `API_BASE_URL`

当前 `web` 端直接读取 `process.env.API_BASE_URL`，并带了一个本地回退值。`api` 侧的 `wrangler.jsonc` 还没有真正的多环境变量配置，`admin` 端也还没接入任何环境变量。

所以目标很明确：

- 三端统一环境变量命名

- 同时覆盖 Next.js 服务端和客户端组件

- 显式区分 `development`、`test`、`production` 三种环境

- 去掉页面代码里的硬编码回退地址

- 让 API、Web、Admin 都真正消费同一套环境约定

- 顺带把 `zod` 收敛到工作区根级 `catalog` 管理

## 2. Next.js 如何读取环境变量

先把 Next.js 自己的规则讲清楚，不然后面项目里的配置策略很容易写偏。

NOTE

如果你对 next 还不熟悉，可以关注我的另外一本付费小册[《NextJS 实战进阶》](https://aicompanion.usehook.cn)

### 2.1 Next.js 会按什么顺序加载 env 文件

Next.js 内置了对环境变量的支持，会把 `.env*` 文件加载到 `process.env`。

常见文件有这些：

- `.env`

- `.env.development`

- `.env.production`

- `.env.test`

- `.env.local`

- `.env.development.local`

- `.env.production.local`

- `.env.test.local`

官方的查找顺序可以概括成这样：

- 先看当前进程里已经存在的 `process.env`

- 再看 `.env.$(NODE_ENV).local`

- 再看 `.env.local`，但 `test` 环境会跳过它

- 再看 `.env.$(NODE_ENV)`

- 最后看 `.env`

这里最容易搞错两点。

**第一，`.env.local` 不是永远参与。**

当 `NODE_ENV=test` 时，Next.js 会跳过 `.env.local`，这样测试结果更稳定，不会被某台机器上的本地私有配置污染。

**第二，`NODE_ENV` 和业务环境不是一回事。**

`next dev` 对应的是 `development`，`next build` 和 `next start` 对应的是 `production`。只有测试进程自己把 `NODE_ENV` 设成 `test` 时，Next.js 才会自动走测试环境那套加载规则。

这也是为什么当前文章里的「联调环境=test」不能直接等同于 Next.js 官方语义里的 `test`。

### 2.2 服务端为什么可以直接读取 process.env

Server Component、Route Handler、Server Action 都运行在服务端，这一层直接读取的是 Node.js 进程环境。

也就是说，`process.env` 不是 Next.js 发明出来的能力，它本来就是 Node.js 提供的进程环境入口。Next.js 做的事情，是在应用启动时，先按规则把 `.env*` 文件加载进去，再去执行服务端代码。

完整链路可以理解成这样：

- 先在 `.env*` 文件、系统环境变量或部署平台里配置值

- Next.js 启动时按优先级把它们加载到当前进程

- Node.js 通过 `process.env` 暴露这些值

- Server Component / Route Handler / Server Action 在运行时直接读取

例如服务端 helper 可以这样写：

apps/web/src/env.server.ts

```typescript
import { z } from 'zod'

const webServerEnvSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']),
  API_BASE_URL: z.string().url(),
})

export type WebServerEnv = z.infer<typeof webServerEnvSchema>

export function getWebServerEnv(): WebServerEnv {
  return webServerEnvSchema.parse({
    APP_ENV: process.env.APP_ENV,
    API_BASE_URL: process.env.API_BASE_URL,
  })
}
```

这里还有一个官方文档专门提过的点：读取时直接写 `process.env.APP_ENV` 这种属性访问，不要先解构 `process.env` 再用。

本地开发时，`web` 和 `admin` 最常见的配置文件会是这些：

- `apps/web/.env.development`

- `apps/web/.env.test`

- `apps/admin/.env.development`

- `apps/admin/.env.test`

例如 `web` 侧本地开发：

apps/web/.env.development

```shellscript
APP_ENV=development
API_BASE_URL=http://127.0.0.1:8788
NEXT_PUBLIC_APP_ENV=development
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8788
```

### 2.3 客户端为什么只能用 NEXT_PUBLIC_*

客户端组件跑在浏览器里，浏览器拿不到 Node.js 的完整进程环境。为了避免把私有变量直接暴露出去，Next.js 只会把带 `NEXT_PUBLIC_` 前缀的环境变量内联到发送给浏览器的 JavaScript 里。

这意味着两件事。

**第一，客户端只能访问 `NEXT_PUBLIC_*`。**

像 `API_BASE_URL`、`APP_ENV` 这种没有公共前缀的变量，客户端组件里不应该直接依赖。

**第二，`NEXT_PUBLIC_*` 是在前端代码编译时写进去的。**

也就是说，客户端看到的是 `next dev` 或 `next build` 当时确定下来的值，不是浏览器运行时再去现查操作系统环境变量。

客户端 helper 可以这样写：

apps/web/src/env.client.ts

```typescript
import { z } from 'zod'

const webClientEnvSchema = z.object({
  NEXT_PUBLIC_APP_ENV: z.enum(['development', 'test', 'production']),
  NEXT_PUBLIC_API_BASE_URL: z.string().url(),
})

export type WebClientEnv = z.infer<typeof webClientEnvSchema>

export function getWebClientEnv(): WebClientEnv {
  return webClientEnvSchema.parse({
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  })
}
```

使用时要记住一条边界：不要把 `env.server.ts` 引进 `"use client"` 组件。

例如 `web` 首页本身还是 Server Component，所以它继续走服务端 helper：

apps/web/app/page.tsx

```tsx
import { getWebServerEnv } from '../src/env.server'
import { WebEnvBadge } from '../src/web-env-badge'

async function getPingResponse(apiBaseUrl: string): Promise<PingRpcResponse> {
  const client = hc<AppType>(apiBaseUrl)
  const response = await client.rpc.system.ping.$post({
    json: rpcPayload,
  })

  return await response.json()
}

export default async function Home() {
  const env = getWebServerEnv()
  const pingResult = await getPingResponse(env.API_BASE_URL)

  return (
    <section>
      <span>server {env.APP_ENV}</span>
      <span>{env.API_BASE_URL}</span>
      <WebEnvBadge />
    </section>
  )
}
```

而 `WebEnvBadge` 是客户端组件，它读的是公开变量：

apps/web/src/web-env-badge.tsx

```tsx
"use client"

import { getWebClientEnv } from './env.client'

export function WebEnvBadge() {
  const env = getWebClientEnv()

  return (
    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
      <span className="rounded-full border border-border px-3 py-1">
        client {env.NEXT_PUBLIC_APP_ENV}
      </span>
      <span className="rounded-full border border-border px-3 py-1">
        {env.NEXT_PUBLIC_API_BASE_URL}
      </span>
    </div>
  )
}
```

## 3. Hono API 怎么读取环境变量

Hono 本身只是路由框架，真正的环境变量入口取决于它跑在哪。

这个项目里的 API 跑在 Cloudflare Worker，所以读取入口不是 `process.env`，而是 `c.env`。

先看配置入口。`wrangler.jsonc` 负责定义默认环境和具名环境：

apps/api/wrangler.jsonc

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "api",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-22",
  "vars": {
    "APP_ENV": "development"
  },
  "env": {
    "test": {
      "vars": {
        "APP_ENV": "test"
      }
    },
    "production": {
      "vars": {
        "APP_ENV": "production"
      }
    }
  }
}
```

这里的含义是：

- 顶层 `vars` 给默认开发环境

- `env.test` 给联调环境

- `env.production` 给生产环境

本地开发还要配 `apps/api/.dev.vars`，Wrangler 启动时会把它注入 Worker 运行时。

apps/api/.dev.vars

```shellscript
APP_ENV=development
```

配置完以后，路由里不要直接散着读 `c.env.APP_ENV`，最好先集中校验一次：

apps/api/src/env.ts

```typescript
import { z } from 'zod'

const apiEnvSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']),
})

export type ApiEnv = z.infer<typeof apiEnvSchema>

export function getApiEnv(bindings: Record<string, unknown>): ApiEnv {
  return apiEnvSchema.parse({
    APP_ENV: bindings.APP_ENV,
  })
}
```

然后在 Hono 路由里通过 `c.env` 读取：

apps/api/src/app.ts

```typescript
import { getApiEnv } from './env'

const app = new Hono<{
  Bindings: {
    APP_ENV: 'development' | 'test' | 'production'
  }
}>()

const routes = app
  .get('/health', (c) => {
    const env = getApiEnv(c.env)

    return c.json(
      buildSuccess(
        {
          service: 'api',
          env: env.APP_ENV,
        },
        createMeta(),
      ),
    )
  })
  .post('/rpc/system/ping', validator('json', (value, c) => {
      const parsed = PingRequestSchema.safeParse(value)

      if (!parsed.success) {
        return c.json(
          buildFailure(
            {
              code: BizCode.COMMON_INVALID_REQUEST,
              message: 'Invalid request payload',
              details: parsed.error.flatten(),
            },
            createMeta(),
          ),
          400,
        )
      }

      return parsed.data
    }),
    (c) => {
      const payload = c.req.valid('json')
      const env = getApiEnv(c.env)

      return c.json(
        buildSuccess(
          {
            service: 'api',
            message: `pong, ${payload.name}`,
            env: env.APP_ENV,
          },
          createMeta(),
        ),
      )
    },
  )
```

Hono 这一层的结论很明确：

- Worker 环境变量来自 `wrangler.jsonc`、`.dev.vars` 和 secret

- 运行时通过 `c.env` 读取

- 最好先经过一个 `env.ts` 做校验

## 4. 回到这个项目，环境变量如何设计

把 Next.js 和 Hono 各自的读取方式讲清之后，再看这个项目的方案就顺了。

当前三端统一使用四项环境变量：

- `APP_ENV=development | test | production`

- `API_BASE_URL`

- `NEXT_PUBLIC_APP_ENV`

- `NEXT_PUBLIC_API_BASE_URL`

它们的职责分成两层：

- `APP_ENV` / `API_BASE_URL` 给服务端逻辑用

- `NEXT_PUBLIC_APP_ENV` / `NEXT_PUBLIC_API_BASE_URL` 给客户端组件用

这样设计有两个直接好处。

第一，Next.js 服务端和客户端边界很清楚，不会把私有变量误带进浏览器。

第二，`web`、`admin`、`api` 三端虽然运行时不同，但命名风格统一，后面排查问题时不容易乱。

这里不新建共享 env package，原因也很直接：

- `api` 跑在 Worker，读的是 `c.env`

- `web` 和 `admin` 跑在 Next 服务端和浏览器，读的是 `process.env`

运行时入口本来就不同，统一键名比统一读取代码更重要。

`admin` 侧也按同样方式拆成服务端和客户端两层：

apps/admin/app/page.tsx

```tsx
import { AdminEnvBadge } from '../src/admin-env-badge'
import { getAdminServerEnv } from '../src/env.server'

export default function Home() {
  const env = getAdminServerEnv()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Environment overview</CardTitle>
        <CardDescription>
          The admin app reads private server variables and public browser variables separately.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p>APP_ENV</p>
            <p>{env.APP_ENV}</p>
          </div>
          <div>
            <p>API_BASE_URL</p>
            <p>{env.API_BASE_URL}</p>
          </div>
        </div>
        <AdminEnvBadge />
      </CardContent>
    </Card>
  )
}
```

## 5. Turbo、示例文件修改

只改页面和脚本还不够，任务调度层和示例文件层也得同步，否则后面会继续冒出隐性问题。

**第一件事，Turbo 要声明环境变量。**

`turbo.json` 里的 `build`、`build:test`、`start:test`、`dev`、`dev:test`、`lint`、`check-types` 都应该补上四项变量：

- `APP_ENV`

- `API_BASE_URL`

- `NEXT_PUBLIC_APP_ENV`

- `NEXT_PUBLIC_API_BASE_URL`

这样可以同时解决两个问题：

- `turbo/no-undeclared-env-vars` 告警

- Turbo 缓存没有感知环境变量变化

turbo.json

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": [".next/**", "!.next/cache/**"],
      "env": ["APP_ENV", "API_BASE_URL", "NEXT_PUBLIC_APP_ENV", "NEXT_PUBLIC_API_BASE_URL"]
    },
    "lint": {
      "dependsOn": ["^lint"],
      "env": ["APP_ENV", "API_BASE_URL", "NEXT_PUBLIC_APP_ENV", "NEXT_PUBLIC_API_BASE_URL"]
    },
    "check-types": {
      "dependsOn": ["^check-types"],
      "env": ["APP_ENV", "API_BASE_URL", "NEXT_PUBLIC_APP_ENV", "NEXT_PUBLIC_API_BASE_URL"]
    },
    "dev": {
      "cache": false,
      "persistent": true,
      "env": ["APP_ENV", "API_BASE_URL", "NEXT_PUBLIC_APP_ENV", "NEXT_PUBLIC_API_BASE_URL"]
    }
  }
}
```

**第二件事，示例文件和真实文件分层。**

由于环境变量有可能涉及敏感信息，因此 git 仓库里只提交示例文件，不提交真实环境文件：

- `apps/api/.dev.vars.example`

- `apps/web/.env.example`

- `apps/admin/.env.example`

前端示例文件现在要同时覆盖服务端和客户端变量：

apps/web/.env.example

```shellscript
APP_ENV=development
API_BASE_URL=http://127.0.0.1:8787
NEXT_PUBLIC_APP_ENV=development
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8787

# For pre-release / integration testing
# APP_ENV=test
# API_BASE_URL=https://test-api.example.com
# NEXT_PUBLIC_APP_ENV=test
# NEXT_PUBLIC_API_BASE_URL=https://test-api.example.com

# For production
# APP_ENV=production
# API_BASE_URL=https://api.example.com
# NEXT_PUBLIC_APP_ENV=production
# NEXT_PUBLIC_API_BASE_URL=https://api.example.com
```

真实的环境变量配置文件需要依据示例文件创建，例如：

apps/api/.dev.vars

```shellscript
APP_ENV=development
```

apps/web/.env.development

```shellscript
APP_ENV=development
API_BASE_URL=http://127.0.0.1:8788
NEXT_PUBLIC_APP_ENV=development
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8788
```

将下面的内容添加到 `.gitignore` 文件中：

- `apps/api/.dev.vars`

- `apps/web/.env.development`

- `apps/web/.env.test`

- `apps/web/.env.production`

- `apps/admin/.env.development`

- `apps/admin/.env.test`

- `apps/admin/.env.production`

NOTE

如果确认这些环境变量都不涉及敏感信息，也可以按团队约定提交，但默认还是建议把真实文件排除掉。

**第三件事，把 `zod` 收到根级版本管理。**

这次新增了 server/client 四个 env helper，又有 `contracts` 包本来就在用 `zod`。既然已经变成多个子站共享依赖，就不该继续在每个 package 里手写一遍版本号。

可以直接把它收进 `pnpm-workspace.yaml` 的 `catalog`：

pnpm-workspace.yaml

```yaml
catalog:
  zod: ^4.1.12
```

然后各包统一改成：

package.json

```json
{
  "dependencies": {
    "zod": "catalog:"
  }
}
```
