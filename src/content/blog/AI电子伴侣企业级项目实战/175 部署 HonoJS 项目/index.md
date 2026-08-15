---
title: "175、 部署 HonoJS 项目"
pubDate: 2026-06-08
description: "讲解 HonoJS API 子站在 Cloudflare Workers 上的部署流程，包括 wrangler 配置、Secrets、D1 迁移和回调地址。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/40-honojs-cloudflare-workers-deploy/](https://aicompanion.usehook.cn/40-honojs-cloudflare-workers-deploy/)

这篇文章记录一次真实的 `apps/api` 子站部署过程。这个 API 子站使用 Hono 作为 Web 框架，最终跑在 Cloudflare Workers 上。它不是一个只有 HTTP 路由的空服务，实际运行时还会依赖几类外部资源：

index.txt

```txt
D1  数据库：保存用户、会话、角色、订阅等数据
R2  存储桶：保存用户头像
环境变量：保存 origin、模型配置、OAuth 配置
Secrets：保存 JWT 密钥、GitHub Secret、LLM API Key
```

我们要完成的事情很明确：把本地已经能跑起来的 API 子站部署到 Cloudflare，并让 `admin` / `web` 两个前端子站都能正常访问它。

## 1. 部署前准备

我们先进入 API 子站目录，后面的 Wrangler 命令都在这里执行：

index.bash

```shellscript
cd apps/api
```

然后确认 Wrangler 当前已经登录到正确的 Cloudflare 账号：

index.bash

```shellscript
pnpm wrangler whoami
```

如果登录状态正常，会看到类似这样的账号信息：

account.txt

```txt
Account ID: 629f5983e568d0d6b2439f06a93f8ca4
```

接着查看当前账号下已有的 D1 数据库：

index.bash

```shellscript
pnpm wrangler d1 list
```

这次要使用的生产数据库是：

database.txt

```txt
name: ai-agent-production-auth
uuid: ba264b43-5d69-4b40-8ba8-375be3dcaebf
```

如果你的账号里还没有这个生产 D1，可以先创建一个：

index.bash

```shellscript
pnpm wrangler d1 create ai-agent-production-auth
```

创建成功以后，Wrangler 会输出一段数据库信息。这里最重要的是 `database_id`，后面要把它写入 `wrangler.jsonc`。

头像会放在 R2 里，所以还需要准备一个生产 bucket。如果还没有创建，可以执行：

index.bash

```shellscript
pnpm wrangler r2 bucket create ai-agent-production-avatars
```

## 2. 配置 wrangler.jsonc

API 子站部署到 Cloudflare Workers 时，核心配置文件是：

path.txt

```txt
apps/api/wrangler.jsonc
```

我们把 production 环境里真正要用到的 D1、R2、环境变量都写在 `env.production` 下面。本次最终的关键配置如下：

wrangler.jsonc

```jsonc
{
  "name": "api",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-22",
  "env": {
    "production": {
      "workers_dev": true,
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "ai-agent-production-auth",
          "database_id": "ba264b43-5d69-4b40-8ba8-375be3dcaebf",
          "migrations_dir": "migrations"
        }
      ],
      "r2_buckets": [
        {
          "binding": "AVATAR_BUCKET",
          "bucket_name": "ai-agent-production-avatars"
        }
      ],
      "vars": {
        "APP_ENV": "production",
        "ADMIN_ORIGIN": "https://ai-agent-admin.pages.dev",
        "WEB_ORIGIN": "https://ai-agent-web-66e.pages.dev",
        "ACCESS_TOKEN_TTL_SEC": "900",
        "REFRESH_TOKEN_TTL_SEC": "2592000",
        "DEEPSEEK_BASE_URL": "https://api.deepseek.com/v1",
        "DEEPSEEK_MODEL": "deepseek-chat",
        "GITHUB_OAUTH_CLIENT_ID": "<github-oauth-client-id>",
        "GITHUB_OAUTH_CALLBACK_URL": ""
      }
    }
  }
}
```

这段配置里有几个地方需要特别留意，否则很容易出现本地能跑、线上绑定不到资源的问题。

### 1. env 下的 bindings 不继承顶层配置

Wrangler 的环境配置有一个容易被忽略的规则：

wrangler.txt

```txt
env.production.d1_databases
env.production.r2_buckets
```

不会自动继承顶层的：

wrangler.txt

```txt
d1_databases
r2_buckets
```

所以只在顶层写 D1 / R2 还不够。只要部署时带了 `--env production`，生产环境就必须在 `env.production` 里单独配置 D1 / R2。

### 2. binding 名要和代码一致

我们再看代码侧。项目里访问绑定资源时，用的是：

env.ts

```typescript
c.env.DB
c.env.AVATAR_BUCKET
```

因此 production 环境里的 binding 名也要保持一致：

wrangler.jsonc

```jsonc
{
  "binding": "DB"
}
```

和：

wrangler.jsonc

```jsonc
{
  "binding": "AVATAR_BUCKET"
}
```

这里不要把 binding 名改成 `ai_agent_production_auth` 或 `ai_agent_production_avatars`。资源本身可以叫生产名称，但代码里读取的是 `c.env.DB` 和 `c.env.AVATAR_BUCKET`，所以 binding 名必须和代码保持一致。

### 3. database_id 必须是真实 ID

如果执行迁移过程中看到这个报错：

error.txt

```txt
The database 33333333-3333-4333-8333-333333333333 could not be found [code: 7404]
```

问题出在 `env.production.d1_databases[0].database_id` 还停留在占位符：

database-id.txt

```txt
33333333-3333-4333-8333-333333333333
```

正确做法是通过 `wrangler d1 list` 或 `wrangler d1 create` 拿到真实 ID，再写回 production 环境配置。

本次真实生产 ID 是：

database-id.txt

```txt
ba264b43-5d69-4b40-8ba8-375be3dcaebf
```

### 4. workers_dev 用于启用默认 workers.dev 域名

wrangler.jsonc

```jsonc
"workers_dev": true
```

打开 `workers_dev` 以后，部署成功时 Cloudflare 会给 Worker 分配一个默认的 `workers.dev` 访问域名。

本次部署后的 API 地址是：

api-url.txt

```txt
https://api-production.1832064870.workers.dev
```

## 3. 配置 Secrets

`wrangler.jsonc` 适合放非敏感配置，但不适合放密钥。

像下面这些值，都应该通过 Cloudflare Worker Secret 来保存：

secrets.txt

```txt
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
DEEPSEEK_API_KEY
GITHUB_OAUTH_CLIENT_SECRET
```

我们在 production 环境里逐个设置 secret：

index.bash

```shellscript
cd apps/api

pnpm wrangler secret put JWT_ACCESS_SECRET --env production
pnpm wrangler secret put JWT_REFRESH_SECRET --env production
pnpm wrangler secret put DEEPSEEK_API_KEY --env production
pnpm wrangler secret put GITHUB_OAUTH_CLIENT_SECRET --env production
```

每条命令执行后，Wrangler 都会提示输入对应的值。

这里要多提醒一句：secret 不要写进 Markdown、Git、聊天记录或日志里。部署文档里只记录变量名就够了，真实值应该只交给 Cloudflare 保存。

## 4. 执行 D1 迁移

D1 的迁移文件放在：

path.txt

```txt
apps/api/migrations
```

我们要操作的是 Cloudflare 上的远程生产数据库，所以迁移命令要带上 `--env production` 和 `--remote`：

index.bash

```shellscript
cd apps/api
pnpm wrangler d1 migrations apply ai-agent-production-auth --env production --remote
```

这几个参数可以这样理解：

migration-params.txt

```txt
ai-agent-production-auth  D1 数据库名称
--env production          使用 wrangler.jsonc 里的 env.production
--remote                  操作 Cloudflare 远程资源，不是本地模拟 D1
```

如果你看到类似 warning：

warning.txt

```txt
There is a d1_databases binding at the top level, but not on env.production
```

这个 warning 的意思是：顶层虽然配置了 D1，但 production 环境没有单独配置 D1 binding。遇到这种情况，要回到 `wrangler.jsonc`，确认 `env.production.d1_databases` 确实存在。

如果你看到：

error.txt

```txt
database could not be found [code: 7404]
```

这时我们可以按几个方向排查：先看 `database_id` 是否还停留在占位符，再确认数据库名称有没有写错；如果这两项都没问题，就继续确认当前 Wrangler 登录的是不是正确的 Cloudflare 账号，以及命令里有没有带 `--env production`。

## 5. 部署前 dry-run

正式部署之前，我们可以先做一次 dry-run：

index.bash

```shellscript
cd apps/api
pnpm wrangler deploy --env production --dry-run
```

dry-run 不会真正发布 Worker，但会帮我们检查配置、入口文件、构建产物和绑定资源。

如果配置没有问题，输出里会出现 bindings 列表，例如：

bindings.txt

```txt
env.DB (ai-agent-production-auth)                  D1 Database
env.AVATAR_BUCKET (ai-agent-production-avatars)    R2 Bucket
env.APP_ENV ("production")                         Environment Variable
env.ADMIN_ORIGIN ("https://ai-agent-admin.pages.dev")
env.WEB_ORIGIN ("https://ai-agent-web-66e.pages.dev")
```

这段输出很有价值。它能直接告诉我们：线上 Worker 最终拿到的 D1、R2 和环境变量，是否就是我们期望的那一组资源。

## 6. 正式部署 API

dry-run 通过以后，就可以正式部署 API：

index.bash

```shellscript
cd apps/api
pnpm wrangler deploy --env production --minify
```

部署成功后，会看到类似这样的输出：

deploy-output.txt

```txt
Uploaded api-production
Deployed api-production triggers
https://api-production.1832064870.workers.dev
Current Version ID: bb6a160e-4f37-4736-8932-1a4ea8278a38
```

这里有两个信息需要记下来：

deploy-result.txt

```txt
API URL
Current Version ID
```

其中 API URL 后续要写入 `admin` / `web` 的生产环境变量：

.env.production

```txt
NEXT_PUBLIC_API_BASE_URL=https://api-production.1832064870.workers.dev
```

## 7. GitHub OAuth 回调配置

GitHub OAuth 的回调地址要填 API 子站地址：

callback-url.txt

```txt
https://api-production.1832064870.workers.dev/auth/web/github/callback
```

这里不要填 Web 子站地址。GitHub 回调回来以后，真正处理 `code`、换取 GitHub access token、创建系统登录态的地方，是 API 子站。

当前代码里，`GITHUB_OAUTH_CALLBACK_URL` 是可选的：

github-oauth.service.ts

```typescript
callbackUrl: env.GITHUB_OAUTH_CALLBACK_URL
  ?? new URL('/auth/web/github/callback', c.req.url).toString()
```

所以 production 里可以先这样写：

wrangler.jsonc

```jsonc
"GITHUB_OAUTH_CALLBACK_URL": ""
```

空字符串会被环境变量解析逻辑当成未配置。这样运行时就会使用当前 API 请求域名，自动拼出 callback URL。

不过 GitHub OAuth App 后台仍然必须配置最终回调地址：

callback-url.txt

```txt
https://api-production.1832064870.workers.dev/auth/web/github/callback
```

## 8. 部署前端后回头更新 API Origin

API 里 CORS 会检查：

cors.ts

```typescript
const allowedOrigins = new Set([env.ADMIN_ORIGIN, env.WEB_ORIGIN])
```

所以 `admin` / `web` 部署完成以后，要把真实 Pages 生产域名写回 `wrangler.jsonc`。

本次最终使用的是这两个 origin：

origins.txt

```txt
ADMIN_ORIGIN=https://ai-agent-admin.pages.dev
WEB_ORIGIN=https://ai-agent-web-66e.pages.dev
```

这里特别容易写错。Web 的实际域名不是猜出来的 `ai-agent-web.pages.dev`，而是 Cloudflare 实际分配的：

web-origin.txt

```txt
https://ai-agent-web-66e.pages.dev
```

修改 `WEB_ORIGIN` 后，需要重新部署 API：

index.bash

```shellscript
cd apps/api
pnpm wrangler deploy --env production --dry-run
pnpm wrangler deploy --env production --minify
```

如果只改配置文件但不重新部署，线上 Worker 仍然会使用旧 origin，浏览器请求时就会遇到 CORS 问题。

## 9. 推荐部署顺序

把整个过程连起来看，推荐按这个顺序部署：

deploy-order.txt

```txt
1. 创建 D1 / R2
2. 配置 apps/api/wrangler.jsonc
3. 设置 production secrets
4. 执行 D1 migrations
5. dry-run API
6. deploy API
7. 拿到 API workers.dev 域名
8. 配置 admin / web 的生产 API 地址
9. 部署 admin / web 到 Pages
10. 拿到真实 Pages 生产域名
11. 回写 API 的 ADMIN_ORIGIN / WEB_ORIGIN
12. 重新 deploy API
13. 配置 GitHub OAuth callback URL
```

这样安排会更稳一些。API 先有稳定地址，前端构建时就能写入正确的 API 地址；等前端部署完成以后，再把真实 Pages 域名同步回 API 的 CORS origin；GitHub OAuth 放在最后配置，也能避免一开始就把 callback URL 猜错。

## 10. 常用命令清单

查看当前登录账号：

index.bash

```shellscript
pnpm wrangler whoami
```

查看 D1：

index.bash

```shellscript
pnpm wrangler d1 list
```

创建 D1：

index.bash

```shellscript
pnpm wrangler d1 create ai-agent-production-auth
```

创建 R2：

index.bash

```shellscript
pnpm wrangler r2 bucket create ai-agent-production-avatars
```

设置 secret：

index.bash

```shellscript
pnpm wrangler secret put JWT_ACCESS_SECRET --env production
pnpm wrangler secret put JWT_REFRESH_SECRET --env production
pnpm wrangler secret put DEEPSEEK_API_KEY --env production
pnpm wrangler secret put GITHUB_OAUTH_CLIENT_SECRET --env production
```

执行 D1 迁移：

index.bash

```shellscript
pnpm wrangler d1 migrations apply ai-agent-production-auth --env production --remote
```

部署前检查：

index.bash

```shellscript
pnpm wrangler deploy --env production --dry-run
```

正式部署：

index.bash

```shellscript
pnpm wrangler deploy --env production --minify
```

## 总结

API 生产地址：

api-url.txt

```txt
https://api-production.1832064870.workers.dev
```

最近一次部署版本：

version.txt

```txt
bb6a160e-4f37-4736-8932-1a4ea8278a38
```

前端生产地址：

pages-url.txt

```txt
Admin: https://ai-agent-admin.pages.dev
Web:   https://ai-agent-web-66e.pages.dev
```

GitHub OAuth 回调地址：

callback-url.txt

```txt
https://api-production.1832064870.workers.dev/auth/web/github/callback
```

这次部署完成以后，`apps/api` 会作为一个独立的 Cloudflare Worker 对外提供服务；`admin` 和 `web` 仍然按静态前端子站部署到 Cloudflare Pages。两边通过明确的环境变量、API 地址和 CORS origin 连接起来，部署关系就清楚了，也方便后面继续维护。
