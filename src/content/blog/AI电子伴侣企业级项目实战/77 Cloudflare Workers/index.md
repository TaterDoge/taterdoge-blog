---
title: "77 Cloudflare Workers"
pubDate: 2026-05-06
description: "一个请求从浏览器出发，跨越太平洋，到达机房，处理完再原路返回。光速有限，物理距离摆在那里，一来一回就是 200ms 以上的延迟。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/2-cloudflare-workers/](https://aicompanion.usehook.cn/2-cloudflare-workers/)

## 1. 传统服务器的问题：距离

用户在深圳，服务器在美国弗吉尼亚。

一个请求从浏览器出发，跨越太平洋，到达机房，处理完再原路返回。光速有限，物理距离摆在那里，一来一回就是 200ms 以上的延迟。

这还只是网络传输。加上 DNS 解析、TLS 握手、排队等待，实际体感往往在 300-500ms。

传统方案的应对方式是 CDN——把静态资源缓存到全球节点。但 CDN 只解决了静态文件的问题。API 请求、动态逻辑、数据库查询，这些还是得回到源站。

Cloudflare Workers 换了一个思路：**不是把数据缓存到边缘，而是把代码部署到边缘。**

## 2. 边缘计算：代码跟着用户走

Cloudflare 在全球有大量边缘节点。当你把代码部署到 Workers，这份代码会被分发到它的全球网络中。

用户在东京，请求通常会优先由离东京更近的节点处理。用户在法兰克福，也会优先命中欧洲附近的节点。代码在离用户更近的地方执行，所以整体延迟通常会明显下降。

这就是"边缘计算"的含义——计算发生在网络的边缘，而不是某个中心机房。

这里有一个新手很容易误解的点：**边缘计算不等于所有东西都在边缘**。更准确地说，是"请求处理逻辑"被放到了边缘。至于数据库、对象存储、消息队列是否也在离用户最近的位置，要看你具体使用的是哪一种服务。

## 3. V8 isolates：不是容器，不是虚拟机

传统 Serverless 平台（比如 AWS Lambda）用容器运行代码。每个请求分配一个容器，容器里跑一个完整的 Node.js 运行时。容器启动需要时间，这就是所谓的"冷启动"——第一次请求可能要等几百毫秒甚至几秒。

Workers 用的是完全不同的技术：**V8 isolates**。

V8 就是 Chrome 浏览器里的 JavaScript 引擎。isolate 是 V8 提供的轻量级隔离环境，多个 isolate 可以跑在同一个进程里，彼此内存隔离，但共享同一个 V8 实例。

如果你之前只接触过 Node.js 服务器，可以先把 isolate 理解成一个**比容器更轻的 JavaScript 沙箱**：它也能隔离不同请求的执行环境，但不需要像容器那样启动一整套完整运行时。

index.ts

```typescript
// Workers 代码长这样，和写普通 Web API 没区别
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/hello') {
      return new Response(JSON.stringify({ message: 'Hello from the edge!' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not Found', { status: 404 })
  },
}
```

在实际体验里，isolate 的启动通常会比容器快很多，因此冷启动问题会轻不少。但这里不要把它理解成"永远没有冷启动"。代码体积、依赖数量、全局初始化逻辑，都会影响真实启动表现。

## 4. 和 AWS Lambda 的核心区别

Lambda 和 Workers 都是 Serverless，但底层机制差别很大：

| 维度 | AWS Lambda | Cloudflare Workers |
| --- | --- | --- |
| 运行时 | 容器（完整 Node.js/Python 等） | V8 isolate |
| 冷启动 | 几百 ms 到几秒 | < 5ms |
| 部署位置 | 选定的 Region（如 us-east-1） | 全球边缘网络自动分发 |
| 运行时长上限 | 15 分钟 | 免费 10ms CPU / 付费默认 30s CPU，可提高到 5 分钟 |
| 编程语言 | 多语言 | JavaScript / TypeScript / Wasm |

Lambda 的优势在灵活性：你可以跑任意语言、任意二进制文件，运行时间长达 15 分钟，适合重计算任务。

Workers 的优势在速度和分布：启动快、延迟低、天然全球部署，适合 API 网关、请求路由、轻量级后端服务。

两者不是替代关系，而是适用场景不同。

## 5. Workers 的限制

Workers 不是万能的。V8 isolate 的轻量带来了明确的约束：

**CPU 时间限制**

- 免费版：每个请求最多 10ms CPU 时间

- 付费版（$5/月）：默认每个请求最多 30 秒 CPU 时间，可进一步上调

注意是 CPU 时间，不是墙钟时间。网络 I/O 等待不算在内。一个请求花 2 秒等数据库返回，但 CPU 只用了 3ms，那就是 3ms。

**内存限制**

- 每个 Worker 最多 128MB 内存

**无持久化文件系统**

- 不能读写本地文件。需要持久化数据，用 Cloudflare 提供的存储服务。

**运行时不是完整 Node.js**

- 基于 Web Standards API（fetch、Request、Response、crypto 等）

- 大多数 Node.js 原生模块不可用（fs、net、child_process 等）

- 部分 Node.js API 通过兼容层支持

这些限制决定了 Workers 的定位：**处理快进快出的请求，不做重计算。**

## 6. Cloudflare 配套服务

光有计算没有存储，什么也干不了。Cloudflare 围绕 Workers 构建了一整套配套服务：

**KV（Key-Value Store）**
全球分布式键值存储，最终一致性。适合配置项、缓存数据、session 信息。读取极快，写入有短暂延迟传播。

**D1（SQL Database）**
基于 SQLite 的 Cloudflare 托管数据库，支持标准 SQL。它适合结构化数据存储，但你不要把它简单理解成"和 KV 一样的全球分布式缓存"。D1、KV、Durable Objects 解决的是三类不同问题，后续章节会专门展开。

**R2（Object Storage）**
兼容 S3 API 的对象存储。存图片、文件、大块数据。没有出口流量费用——这一点比 AWS S3 便宜很多。

**Queues（Message Queue）**
消息队列，用于异步任务。比如用户上传文件后触发后台处理，不阻塞主请求。

**Durable Objects**
有状态的边缘计算。每个 Object 有自己的存储和单线程执行环境，适合需要强一致性的场景：实时协作、WebSocket 连接管理、计数器。

这些服务统一通过 Workers 的 Bindings 机制访问，代码里直接调用，不需要管连接字符串和认证。

## 7. 免费额度

Workers 的免费额度对个人开发者很友好：

- **每天 10 万次请求**

- KV：每天 10 万次读取、1000 次写入

- D1：每天 500 万行读取、10 万行写入

- R2：每月 100 万次 Class A 操作（写/列出类）、1000 万次 Class B 操作（读类）、10GB 存储

个人项目和中小型服务，免费额度基本够用。超出后付费版起步 $5/月，价格在 Serverless 平台里算低的。

## 8. 开发工具：Wrangler

Wrangler 是 Cloudflare 官方的 CLI 工具，负责 Workers 项目的创建、开发、测试和部署。

terminal

```typescript
# 安装
npm install -g wrangler

# 登录 Cloudflare 账号
wrangler login

# 创建新项目
npm create cloudflare@latest my-worker

# 本地开发（启动本地模拟环境）
wrangler dev

# 部署到 Cloudflare
wrangler deploy
```

`wrangler dev` 会在本地启动一个模拟 Workers 运行时的开发服务器，支持热更新。本地开发时也能访问 KV、D1、R2 等服务的本地模拟版本。

项目配置写在 `wrangler.toml`（或 `wrangler.jsonc`）里：

wrangler.toml

```typescript
name = "my-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# 绑定 KV namespace
[[kv_namespaces]]
binding = "MY_KV"
id = "xxxxxxxxxxxxxxxxxxxx"

# 绑定 D1 数据库
[[d1_databases]]
binding = "DB"
database_name = "my-database"
database_id = "xxxxxxxxxxxxxxxxxxxx"
```

## 9. 总结

Cloudflare Workers 把请求处理逻辑部署到 Cloudflare 的全球边缘网络中，用 V8 isolate 这种更轻的运行方式替代传统容器。配合 KV、D1、R2 等存储服务，可以在边缘完成完整的请求处理链路。

免费额度足够起步，开发工具链成熟，适合 API 服务、AI 应用后端、轻量级全栈项目。

下一篇开始写代码——用 Hono 框架在 Workers 上跑起第一个应用。
