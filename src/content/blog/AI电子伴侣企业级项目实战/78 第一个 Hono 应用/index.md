---
title: "78 第一个 Hono 应用"
pubDate: 2026-05-06
description: "wrangler.jsonc：告诉 Cloudflare 怎么运行你的 Worker"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/3-first-hono-app/](https://aicompanion.usehook.cn/3-first-hono-app/)

## 1. 用 create-hono 创建项目

一条命令搞定：

terminal

```shellscript
npm create hono@latest my-api
```

运行后会让你选模板，选 **cloudflare-workers**。

选完之后：

terminal

```shellscript
cd my-api
npm install
```

项目创建完成，看一下目录结构。

## 2. 项目结构

index.ts应用入口，所有路由从这里开始wrangler.jsoncCloudflare Workers 配置文件package.json依赖和脚本tsconfig.jsonTypeScript 配置

三个关键文件：

- **`src/index.ts`**：你的 API 代码，Hono 应用的入口

- **`wrangler.jsonc`**：告诉 Cloudflare 怎么运行你的 Worker

- **`package.json`**：依赖管理，里面已经配好了 dev 和 deploy 脚本

## 3. wrangler.jsonc 基础配置

wrangler.jsonc

```jsonc
{
  "name": "my-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-15"
}
```

三个字段：

- **`name`**：Worker 的名字，部署后会出现在 Cloudflare Dashboard 里，也会成为默认域名的一部分（`my-api.<你的子域>.workers.dev`）

- **`main`**：入口文件路径

- **`compatibility_date`**：Cloudflare Workers 运行时的兼容日期。Workers 运行时会持续更新，这个日期决定了你的代码用哪个版本的 API 行为。设成一个近期日期就行

新版模板默认使用的是 `wrangler.jsonc`，不是以前常见的 `wrangler.toml`。`jsonc` 可以理解成"带注释的 JSON"，写法更接近前端项目里常见的配置文件，对新手也更直观一些。

## 4. 第一个路由

打开 `src/index.ts`，模板已经生成了一个最小的 Hono 应用：

src/index.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

export default app
```

四行代码，一个能跑的 API 就有了：

- 导入 Hono

- 创建应用实例

- 注册一个 GET 路由，访问 `/` 时返回纯文本

- 导出 app

`c` 是 Context 对象，Hono 里所有请求处理都通过它。`c.text()` 返回纯文本响应，后面还会看到 `c.json()`、`c.html()` 等方法。

## 5. 本地开发

terminal

```shellscript
npx wrangler dev
```

wrangler 会在本地启动一个模拟 Cloudflare Workers 环境的开发服务器，默认跑在 `http://localhost:8787`。

打开浏览器访问 `http://localhost:8787`，你会看到 `Hello Hono!`。

修改代码后保存，wrangler 会自动重新加载，不用手动重启。

## 6. 部署到 Cloudflare

先登录 Cloudflare 账号：

terminal

```shellscript
npx wrangler login
```

浏览器会弹出授权页面，点确认就行。

然后部署：

terminal

```shellscript
npx wrangler deploy
```

部署完成后，终端会输出你的 Worker URL，类似 `https://my-api.<你的子域>.workers.dev`。直接访问就能看到 `Hello Hono!`。

terminal

```shellscript
➜  honoapi npx wrangler deploy

 ⛅️ wrangler 4.83.0
───────────────────
Total Upload: 61.41 KiB / gzip: 15.02 KiB
Uploaded honoapi (2.88 sec)
Deployed honoapi triggers (2.27 sec)
  https://honoapi.1832064870.workers.dev
Current Version ID: 88236bb7-800a-4fc5-820a-86787d462258
```

整个过程不需要配服务器、不需要 Docker、不需要 CI/CD。一条命令，代码就跑在全球 300+ 个边缘节点上了。

## 7. 多加几个路由

一个路由太单调，加几个试试：

src/index.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

// GET - 返回纯文本
app.get('/', (c) => {
  return c.text('Hello Hono!')
})

// GET - 返回 JSON
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() })
})

// GET - 带路径参数
app.get('/api/users/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ id, name: `User ${id}` })
})

// POST - 接收 JSON body
app.post('/api/users', async (c) => {
  const body = await c.req.json()
  return c.json({ message: 'User created', data: body }, 201)
})

export default app
```

几个要点：

- `c.json()` 返回 JSON 响应，自动设置 `Content-Type: application/json`

- `c.req.param('id')` 读取路径参数，`:id` 是动态路径段

- `c.req.json()` 解析请求体的 JSON，返回 Promise 所以要 `await`

- `c.json()` 的第二个参数是 HTTP 状态码，这里用 `201` 表示资源创建成功

用 curl 测试一下：

terminal

```shellscript
# 测试 health 接口
curl http://localhost:8787/api/health

# 测试带参数的 GET
curl http://localhost:8787/api/users/42

# 测试 POST
curl -X POST http://localhost:8787/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "email": "alice@example.com"}'
```

## 8. export default app 为什么能工作

最后一行 `export default app` 看起来很普通，但它是整个应用能跑起来的关键。

Cloudflare Workers 要求你的入口文件默认导出一个对象，这个对象必须实现 `fetch` 方法：

fetch-handler.ts

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 处理请求，返回响应
  }
}
```

这是 Web 标准的 Fetch Handler 模式：接收一个 `Request`，返回一个 `Response`。

Hono 的 `app` 对象恰好实现了这个接口。当你写 `export default app` 时，Cloudflare Workers 运行时会在每次请求到来时调用 `app.fetch(request, env, ctx)`，Hono 内部完成路由匹配、中间件执行、响应生成，最后返回一个标准的 `Response` 对象。

这意味着 Hono 没有任何魔法，它就是一个标准的 fetch handler。你甚至可以手动调用它：

manual-fetch.ts

```typescript
const request = new Request('http://localhost/')
const response = await app.fetch(request)
console.log(await response.text()) // 'Hello Hono!'
```

这个设计让 Hono 可以运行在任何支持 Web 标准 Fetch API 的环境里——Cloudflare Workers、Deno、Bun、Node.js（通过适配器）。框架不绑定运行时，运行时不绑定框架。

## 9. 总结

这一篇完成了从零到部署的完整流程：创建项目、写路由、本地跑、部署上线。Hono 的 API 非常直觉——`app.get()`、`app.post()`、`c.json()`、`c.text()`，几乎不需要查文档就能猜到怎么用。

下一篇深入 Hono 的路由系统，看看路径参数、路由分组、路由优先级这些更细的玩法。
