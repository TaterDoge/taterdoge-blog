---
title: "76 Hono 是什么"
pubDate: 2026-05-05
description: "Express 诞生于 2010 年，那时候 JavaScript 后端只有 Node.js 一个选择。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/1-what-is-hono/](https://aicompanion.usehook.cn/1-what-is-hono/)

## 1. Express 的问题不是慢，是绑死了 Node.js

Express 诞生于 2010 年，那时候 JavaScript 后端只有 Node.js 一个选择。

所以 Express 的 API 设计完全建立在 Node.js 的 `http` 模块之上：`req` 是 `IncomingMessage`，`res` 是 `ServerResponse`，中间件靠 `next()` 串联。

如果你是第一次接触后端，这里先解释一下这几个名词：

- **Node.js 的 `http` 模块**：Node 最早提供的一套服务器 API。你用它可以监听端口、接收请求、返回响应。

- **`IncomingMessage`**：Node.js 里表示“请求”的对象类型。请求头、请求体、URL 等信息都挂在上面。

- **`ServerResponse`**：Node.js 里表示“响应”的对象类型。你要往客户端返回内容，通常就是往这个对象里写。

也就是说，Express 并不是凭空发明了一套请求/响应模型，它只是把 Node.js 原生服务器 API 包装得更好用了一点。

比如不用 Express，只用 Node.js 原生 `http` 模块，代码大概会长这样：

node-http.ts

```typescript
import http from 'node:http'

const server = http.createServer((req, res) => {
  if (req.url === '/hello') {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Hello')
    return
  }

  res.statusCode = 404
  res.end('Not Found')
})

server.listen(3000)
```

Express 做的事情，本质上就是把上面这种“直接操作 Node 请求/响应对象”的写法，改造成更顺手的路由和中间件风格。

这套设计在 Node.js 里跑当然没问题。但今天后端 JavaScript 运行时不止 Node.js 一个了——Cloudflare Workers、Deno、Bun、Vercel Edge Functions 都能跑 JS。这些运行时有一个共同点：它们不实现 Node.js 的 `http` 模块，而是基于 **Web Standards API**。

这里的 **Web Standards API**，你可以先粗略理解为：浏览器和现代运行时都越来越倾向使用同一套标准对象，比如 `Request`、`Response`、`URL`、`fetch`。

这套接口最早大家在浏览器里就见过，例如：

fetch-example.ts

```typescript
const response = await fetch('/api/user')
const data = await response.json()
```

现在很多后端运行时也选择用同一套模型来处理请求和响应。这样做的好处是：**同一段代码更容易在不同环境里复用。**

Express 的代码搬不过去。不是改改配置的事，而是底层 API 就对不上。

这一点很重要。很多新手一开始会以为：

NOTE

“既然都是 JavaScript，那 Express 应该到哪都能跑吧？”

实际上不是。

问题从来不是“语法能不能执行”，而是“运行时有没有提供 Express 依赖的那套底层能力”。

如果一个环境根本没有 Node.js 的 `IncomingMessage`、`ServerResponse`、`http.createServer()`，那 Express 就失去了赖以存在的地基。

## 2. Hono 基于 Web Standards，天生跨运行时

Hono 的核心设计决策：**用 Web Standards API 替代 Node.js API。**

请求是标准的 `Request`，响应是标准的 `Response`，处理函数就是一个接收请求上下文、最后返回 `Response` 的函数。这和浏览器里的 `fetch` API 是同一套思想。

index.ts

```typescript
import { Hono } from 'hono'

const app = new Hono()

app.get('/hello', (c) => {
  return c.text('Hello Hono!')
})

export default app
```

`c` 是 Hono 的 Context 对象。你可以把它理解成一层“方便开发者使用的包装”：

- `c.req` 里封装了标准请求对象

- `c.text()` 可以快速返回文本响应

- `c.json()` 可以快速返回 JSON 响应

- `c.html()` 可以快速返回 HTML 响应

如果再翻译得更直白一点：

- 在 Express 里，你更常见的是“拿到 `res`，然后修改它”

- 在 Hono 里，你更常见的是“最后返回一个 `Response`”

这个差异看起来只是写法不一样，但它背后的兼容性完全不同。

因为 `Response` 是标准对象，很多运行时都认；而 `ServerResponse` 是 Node.js 专属对象，只有 Node.js 认。

如果你还不太熟标准 `Request/Response`，可以先把它类比成：

- `Request`：一次请求的说明书

- `Response`：你要返给客户端的结果对象

这个模型比 “在一个响应对象上不断调用方法并产生副作用” 更容易跨平台。

同样的代码，不改一行，可以跑在：

- Cloudflare Workers

- Node.js

- Deno

- Bun

- Vercel Edge Functions

- AWS Lambda

- Fastly

做到这一点不靠适配层魔法，而是因为这些运行时都在逐步靠拢同一套 Web Standards。

你可以把 Hono 理解成一种“先站在标准接口之上，再往上做轻量封装”的框架。

它的出发点不是“在 Node.js 里把 API 写得多方便”，而是“先保证这套 API 在更多运行时里都成立”。

## 3. 对比 Express：两种路线的差异

Express 和 Hono 的区别不在功能多少，而在底层路线。

|  | Express | Hono |
| --- | --- | --- |
| 请求对象 | req（Node.js IncomingMessage） | c.req（标准 Request） |
| 响应方式 | res.send() / res.json() | return c.json() / return c.text() |
| 运行时 | 仅 Node.js | Node.js / Deno / Bun / Workers / Edge |
| 体积 | ~200KB+ 依赖链 | ~14KB，零外部依赖 |
| TypeScript | 社区类型，推导有限 | 一等支持，路由到校验全链路推导 |
| 中间件 | next() 回调模式 | 洋葱模型，async/await 原生支持 |

对新手来说，Hono 这套写法往往更贴近现代 JavaScript 心智模型，因为它和你平时写异步函数的方式一致。

## 4. 边缘部署：体积和冷启动是硬指标

Cloudflare Workers 这类边缘运行时有严格的限制：

- 代码包体积上限（gzip 压缩后：Workers 免费版 3MB，付费版 10MB）

- 冷启动必须极快（用户请求来了才拉起实例）

- 没有文件系统，没有 Node.js 内置模块

这里再解释两个新手经常混淆的概念：

### 4.1 什么叫边缘部署

传统部署通常是：你的服务跑在某个中心化区域的服务器上，例如北京、新加坡、东京。

边缘部署（Edge Deployment）则是：

服务会被部署到离用户更近的全球节点，用户请求尽量在“附近节点”完成。

这样带来的最大好处是：**延迟更低。**

对于普通博客，几十毫秒差距可能不敏感；但对于 AI 产品来说，用户本来就在等待模型生成，如果网络层再多出几百毫秒，体验会明显变差。

### 4.2 什么叫冷启动

冷启动（Cold Start）指的是：某个函数或实例平时并没有常驻运行，只有请求来了才临时拉起。

如果你的代码包很大、依赖很重，启动时就更慢。

对边缘运行时来说，这种启动开销非常致命，因为它们强调的是“轻量、快速、随时在边缘节点拉起”。

Express 加上依赖链随便就超 1MB，而且依赖 `fs`、`path`、`http` 等 Node.js 模块，根本塞不进 Workers。

Hono 压缩后约 14KB，零外部依赖，不碰任何 Node.js API。冷启动时间几乎可以忽略。

这不是优化问题，是**能不能跑**的问题。

这里你要记住一句话：

NOTE

在边缘环境里，轻量不是锦上添花，而是入场资格。

## 5. TypeScript 全链路类型推导

Hono 从设计之初就用 TypeScript 写成，类型推导覆盖了路由、参数、中间件、校验的完整链路。

index.ts

```typescript
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const app = new Hono()

const schema = z.object({
  name: z.string(),
  age: z.number(),
})

app.post('/users', zValidator('json', schema), (c) => {
  // data 的类型自动推导为 { name: string; age: number }
  const data = c.req.valid('json')
  return c.json({ user: data })
})
```

`zValidator` 把 Zod schema 和路由处理函数串起来，`c.req.valid('json')` 的返回类型由 schema 自动推导，不需要手动声明。

如果你刚学 TypeScript，这里可以把它理解成：

- **校验**：运行时检查“用户传进来的数据到底对不对”

- **类型推导**：编译时让编辑器和 TypeScript 知道“这个数据应该长什么样”

很多项目里这两件事是分开的：

- 你自己写一份 TypeScript 类型

- 你再手动写一份校验规则

- 两份东西一旦不一致，就容易出错

Hono 常见的配套方案是：**直接把同一份 schema 同时用于校验和类型推导**。

这对新手特别友好，因为你不需要维护两套平行定义。

Express 做类似的事也不是做不到，但通常需要自己拼装生态，校验和类型之间没有这么自然地连在一起。

对于 AI 项目，这一点尤其重要。

因为你的接口里经常会出现：

- prompt 参数

- message 列表

- tool 调用输入

- RAG 检索过滤条件

- 配置项

这些数据结构一旦错一个字段，排查成本会很高。类型和校验越统一，后期越省心。

## 6. 什么场景选 Hono，什么场景选 Express

**选 Hono 的场景：**

- 部署到 Cloudflare Workers、Vercel Edge、Deno Deploy 等边缘运行时

- Serverless API，需要极快冷启动

- BFF 层（Backend for Frontend），轻量转发和聚合

- 新项目，没有历史 Node.js 依赖包袱

- 需要跨运行时的可移植性

**仍然选 Express 的场景：**

- 项目重度依赖 Node.js 生态包（如 `sharp`、`puppeteer`、`node-canvas`）

- 需要文件系统操作、子进程、原生模块

- 团队已有大量 Express 中间件积累，迁移成本高

- 部署环境固定为 Node.js，不需要跨运行时

简单判断标准可以再翻译成更适合新手的一句话：

### 6.1 优先选 Hono 的判断法

如果你的服务主要在做这些事：

- 接 API 请求

- 做参数校验

- 调数据库 / KV / 外部接口

- 调模型 API

- 把结果组织后返回前端

那这类服务通常都非常适合 Hono。

因为它们本质上是“轻量逻辑编排层”，并不强依赖 Node.js 独占能力。

### 6.2 不要硬上 Hono 的场景

如果你的服务强依赖这些能力：

- 本地文件读写

- 图片压缩、视频处理

- 启动子进程

- 调用只能在 Node.js 里运行的原生依赖

那你就不要为了“追新”强行把它塞进边缘环境。

这时候 Express、Fastify，甚至直接用 Node.js 原生服务，都是合理选择。

所以更准确的标准是：

**如果你的代码能脱离 Node.js 内置模块运行，Hono 通常是更现代、更轻量的选择。**

**如果你的业务逻辑本来就绑定了 Node.js 特有能力，那继续用 Node.js 框架反而更自然。**

## 7. 总结

Hono 解决的核心问题是：**让后端 JavaScript 代码不再被 Node.js 运行时绑定。** 基于 Web Standards 的设计使它天然适配边缘部署和多运行时场景，同时保持了极小的体积和完整的类型推导。

如果用一句最适合新手记忆的话来总结：

NOTE

Express 更像“Node.js 世界里的经典后端框架”，

Hono 更像“面向多运行时和边缘部署时代的现代轻量框架”。

学 Hono 的意义，不只是多学一个框架，而是顺手把下面这些现代后端观念一起建立起来：

- 请求和响应应该尽量基于标准对象

- 服务逻辑要尽量减少对单一运行时的绑定

- 边缘部署下，包体积和冷启动是第一原则

- 类型、校验、路由最好串成一条链

下一篇进入 Cloudflare Workers——Hono 最常见的部署目标，也是理解边缘计算的起点。
