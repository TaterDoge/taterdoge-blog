---
title: "134 自建 MCP 服务端"
pubDate: 2026-05-23
description: "上一篇我们让 AI 伴侣消费别人的 MCP Server。这一篇反过来：把自己的能力发布成 MCP Server，让其他 AI 应用来消费。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/19-mcp-server/](https://aicompanion.usehook.cn/19-mcp-server/)

## 1. 为什么要自建 MCP Server

上一篇我们让 AI 伴侣消费别人的 MCP Server。这一篇反过来：把自己的能力发布成 MCP Server，让其他 AI 应用来消费。

为什么要这么做？三个理由。

能力复用。AI 伴侣项目里有「记忆检索」「关系画像」「情绪轨迹分析」这些能力。如果只锁在自己后端，用户在 Claude Desktop、Cursor 或任何 MCP-aware 客户端里就用不上。发布成 MCP 之后，用户可以在 Claude Desktop 里直接问「伴侣最近觉得我怎么样」，调用的是我们后端的同一份逻辑。

生态曝光。MCP marketplace（官方和第三方的）越来越像 App Store。一个好 MCP Server 会成为 LLM 生态里被发现你产品的入口。

多端共享。本专栏 AI 伴侣的目标是 Web + Mobile + 第三方客户端。自建 MCP 能让「第三方客户端」这条路线不用额外适配。

这一篇用 MCP SDK 从零写一个 MCP Server，托管在 Cloudflare Workers 上，被上一篇的 MCP 客户端消费。

## 2. MCP Server 的核心概念

一个 MCP Server 要声明三类能力（都是可选的，按需提供）：

| 能力 | 对应场景 | 示例 |
| --- | --- | --- |
| Tools | LLM 主动调用的函数 | search_memories / analyze_emotion |
| Resources | LLM 可以读取的内容 | memory://session/{id}/{memoryId} |
| Prompts | 可复用的 prompt 模板 | companion_intro / weekly_review |

本章只讲 Tools（最常用）。Resources 和 Prompts 的实现逻辑类似，只是协议字段不同。

## 3. 技术栈选择

自建 MCP Server 有几种技术组合：

| 组合 | 特点 | 适用 |
| --- | --- | --- |
| @modelcontextprotocol/sdk + stdio | 跑在本地，CLI 启动 | 桌面端 Demo、开发工具 |
| @modelcontextprotocol/sdk + HTTP | 跑在服务器 | 生产部署 |
| Cloudflare Workers + @cloudflare/mcp-agent | Workers 原生，自带 OAuth / Durable Objects | 本专栏推荐 |

本篇用 Cloudflare 的 `@cloudflare/mcp-agent`（也叫 workers-mcp）。原因是它和我们的 AI 伴侣后端跑在同一个 Workers 环境，可以直接复用 D1 / KV / Vectorize binding。

## 4. 实现 MCP Server

### 4.1 最小实现（stdio）

先跑通一个 Hello World 级的 MCP Server。

index.bash

```shellscript
pnpm add @modelcontextprotocol/sdk zod
```

最简版本用官方 SDK（stdio 传输）：

minimal-mcp.ts

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({
  name: 'ai-companion',
  version: '1.0.0',
})

// 声明一个工具
server.tool(
  'greet',
  '根据情绪返回一句问候',
  {
    emotion: z.enum(['happy', 'sad', 'neutral']),
  },
  async ({ emotion }) => {
    const greetings = {
      happy: '今天的你真有活力 ☀️',
      sad: '没事的，我在这里陪你 🌧️',
      neutral: '又见面啦，今天过得怎么样？',
    }
    return {
      content: [{ type: 'text', text: greetings[emotion] }],
    }
  },
)

// 启动
const transport = new StdioServerTransport()
await server.connect(transport)
```

这段代码跑起来就是一个长驻进程，通过 stdio 和 MCP 客户端通信。Claude Desktop 配置：

claude_desktop_config.json

```json
{
  "mcpServers": {
    "ai-companion": {
      "command": "tsx",
      "args": ["/path/to/minimal-mcp.ts"]
    }
  }
}
```

重启 Claude Desktop，对话里就能调用 `greet` 工具了。

### 4.2 部署到 Cloudflare Workers

生产环境要的是远程 MCP Server，用 HTTP / Streamable HTTP 协议。用 `@cloudflare/mcp-agent`：

index.bash

```shellscript
pnpm add @cloudflare/mcp-agent zod hono
```

src/index.ts

```typescript
import { Hono } from 'hono'
import { McpAgent } from '@cloudflare/mcp-agent'
import { z } from 'zod'
import type { Env } from './bindings'

// 定义 MCP Agent（就是一个 Durable Object）
export class CompanionMCP extends McpAgent<Env> {
  server = new McpServer({
    name: 'ai-companion',
    version: '1.0.0',
  })

  async init() {
    // 工具：检索记忆
    this.server.tool(
      'search_memories',
      '检索指定用户的记忆，支持语义相似度查询',
      {
        userId: z.string().describe('用户 ID'),
        query: z.string().describe('检索关键词'),
        topK: z.number().int().min(1).max(10).default(5),
      },
      async ({ userId, query, topK }) => {
        const embedding = await embed(this.env, query)
        const results = await this.env.VECTORIZE.query(embedding, {
          topK,
          filter: { userId },
        })
        return {
          content: [
            { type: 'text', text: JSON.stringify(results.matches, null, 2) },
          ],
        }
      },
    )

    // 工具：分析情绪轨迹
    this.server.tool(
      'emotion_trend',
      '分析指定时间范围内用户的情绪变化趋势',
      {
        userId: z.string(),
        days: z.number().int().min(1).max(30).default(7),
      },
      async ({ userId, days }) => {
        const since = Date.now() - days * 86400_000
        const rows = await this.env.DB.prepare(
          'SELECT emotion, intensity, created_at FROM emotion_logs WHERE user_id=? AND created_at>? ORDER BY created_at',
        ).bind(userId, since).all()

        return {
          content: [
            { type: 'text', text: JSON.stringify(rows.results, null, 2) },
          ],
        }
      },
    )

    // 工具：关系画像
    this.server.tool(
      'relationship_profile',
      '获取用户和伴侣的关系画像：亲密度、话题偏好、性格标签',
      {
        userId: z.string(),
      },
      async ({ userId }) => {
        const profile = await this.env.DB.prepare(
          'SELECT intimacy, tags, topic_preferences FROM user_profiles WHERE id=?',
        ).bind(userId).first()
        return {
          content: [
            { type: 'text', text: JSON.stringify(profile, null, 2) },
          ],
        }
      },
    )
  }
}

// HTTP 入口
const app = new Hono<{ Bindings: Env }>()

app.route('/mcp', CompanionMCP.serve('/mcp'))

export default app
```

`wrangler.toml` 里注册 Durable Object：

wrangler.toml

```toml
name = "companion-mcp"
main = "src/index.ts"
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat"]

[[durable_objects.bindings]]
name = "MCP_AGENT"
class_name = "CompanionMCP"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["CompanionMCP"]

[[d1_databases]]
binding = "DB"
database_name = "companion"
database_id = "..."

[[vectorize]]
binding = "VECTORIZE"
index_name = "companion-memories"
```

部署：

index.bash

```shellscript
wrangler deploy
```

部署好后，MCP Server 的地址就是 `https://companion-mcp.your-domain.workers.dev/mcp`。

## 5. 添加认证

到这一步，任何人只要知道 URL 都能调用你的 MCP Server，包括调你的记忆数据。必须加认证。

最朴素的 API Key 方式：

auth-middleware.ts

```typescript
app.use('/mcp/*', async (c, next) => {
  const auth = c.req.header('authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const token = auth.slice(7)
  const tokenInfo = await c.env.KV.get(`mcp-token:${token}`, 'json')
  if (!tokenInfo) {
    return c.json({ error: 'invalid token' }, 401)
  }

  c.set('userId', tokenInfo.userId)
  await next()
})
```

然后在工具里用 `this.ctx` 拿 userId：

tool-with-auth.ts

```typescript
this.server.tool('search_memories',
  '检索当前用户的记忆',
  {
    query: z.string(),
    topK: z.number().int().min(1).max(10).default(5),
  },
  async ({ query, topK }) => {
    const userId = this.ctx.userId  // 从认证上下文拿
    // ...
  },
)
```

注意 `userId` 不再是工具参数——它由认证系统决定，LLM 无法伪造。

### 生产推荐：OAuth

API Key 适合内部使用。对外公开的 MCP Server，业界推荐用 OAuth（用户授权 Claude Desktop 或 Cursor 访问他的伴侣数据）。Cloudflare 的 MCP Agent 自带 OAuth 2.1 支持：

oauth-sample.ts

```typescript
export class CompanionMCP extends McpAgent<Env> {
  static oAuth = {
    authorizeEndpoint: '/oauth/authorize',
    tokenEndpoint: '/oauth/token',
    scopes: ['memories:read', 'emotions:read'],
  }
  // ...
}
```

完整的 OAuth 流程涉及前端同意页、授权码交换等步骤，超出本章范围。建议生产前参考 Cloudflare 官方的 Remote MCP Server 示例。

## 6. 客户端接入

上一篇的客户端代码稍微改一下：

client-connect.ts

```typescript
import { experimental_createMCPClient as createMCPClient } from 'ai'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const client = await createMCPClient({
  transport: new StreamableHTTPClientTransport(
    new URL('https://companion-mcp.yourdomain.com/mcp'),
    {
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          headers: {
            ...init?.headers,
            Authorization: `Bearer ${COMPANION_MCP_TOKEN}`,
          },
        }),
    },
  ),
})

const tools = await client.tools()
// tools 里有 search_memories / emotion_trend / relationship_profile
```

从这一步开始，任何 AI 应用都能通过 MCP 消费 AI 伴侣的能力。

## 7. 设计 MCP 工具的原则

不是把后端 API 直接包一层就叫 MCP Server。好的 MCP 工具有六条原则。

动词 + 清晰语义。工具名要像动词，像一个函数名。`search_memories` 比 `memories` 好，`analyze_emotion_trend` 比 `emotion` 好。

参数最小化。只暴露 LLM 需要知道的参数。像 `userId` 这种身份类参数交给认证层处理，不要作为工具参数暴露。

description 要详尽。工具的 description 是 LLM 决定何时调它的唯一依据。写清楚：这个工具能做什么、什么时候该用它、返回的结果是什么形状。

good-description.ts

```typescript
this.server.tool(
  'search_memories',
  [
    '检索与指定查询最相关的用户记忆。',
    '适用场景：用户提到过去的事、想知道自己之前和伴侣说过什么、做情感复盘。',
    '返回按相似度排序的前 topK 条记忆，每条包含内容、时间戳、重要性评分。',
  ].join('\n'),
  // ...
)
```

返回结构要稳定。MCP 的返回是 `{ content: [{ type: 'text', text: '...' }] }`。text 字段里放 JSON 字符串时，字段名和结构要稳定（用 schema 明文记录），否则 LLM 每次都要重新理解。

大数据量要分页。别一次返回 1000 条。提供 `limit` / `offset` / `cursor`，让 LLM 按需拉。

副作用工具要醒目。写操作（更新数据、发消息）的 description 里要明确写「这是一个写操作」，客户端据此可以弹 HITL 确认。

## 8. 可观测性

MCP Server 和普通 API 一样需要埋点。在 Worker 入口加 telemetry：

mcp-telemetry.ts

```typescript
app.use('/mcp/*', async (c, next) => {
  const start = Date.now()
  const userId = c.get('userId')

  await next()

  const duration = Date.now() - start
  c.executionCtx.waitUntil(
    logMcpCall(c.env, {
      userId,
      path: c.req.path,
      status: c.res.status,
      duration,
      timestamp: Date.now(),
    }),
  )
})
```

结合 [可观测性：Telemetry](/17-observability) 的 Langfuse，也能把 MCP 调用作为独立 event 打入同一条 trace。

## 9. 协同与分发

一个有意思的用法：AI 伴侣后端自己也用自己发布的 MCP Server，而不是直接调内部函数。

为什么？一致性：

- 线上 AI 伴侣用 MCP 路径调 `search_memories`

- Claude Desktop 的第三方用户也用 MCP 路径调 `search_memories`

- 同一份代码路径、同一份认证、同一份埋点

这种「自产自销」的模式让你不用维护「内部版」和「外部版」两套实现。

dogfood.ts

```typescript
// 伴侣主接口
app.post('/chat', async (c) => {
  const mcpClient = await createMCPClient({
    transport: new StreamableHTTPClientTransport(
      new URL('https://companion-mcp.yourdomain.com/mcp'),
      {
        fetch: (url, init) =>
          fetch(url, {
            ...init,
            headers: { ...init?.headers, Authorization: `Bearer ${internalMcpToken(c.env)}` },
          }),
      },
    ),
  })

  const mcpTools = await mcpClient.tools()

  const result = streamText({
    model: models.chat,
    messages,
    tools: mcpTools,  // 自家的 MCP 工具
    onFinish: () => c.executionCtx.waitUntil(mcpClient.close()),
  })

  return result.toUIMessageStreamResponse()
})
```

唯一代价是多了一跳 HTTP 调用（伴侣后端 → MCP Server）。对 Workers 这种低延迟环境，这一跳通常不到 10ms，可以接受。

### 发布与分发

自建 MCP Server 怎么让别人用？有几种方式。

私有使用：就自己或内部团队用，分享 URL 和 token 就行。

通过 MCP Registry：社区有几个 MCP registry（比如 `mcp.so`），提交到那里可以被索引。

通过 Claude MCP Directory：Anthropic 官方目录，能被 Claude Desktop 原生发现。

文档 + GitHub：在自己项目主页写接入文档，放 GitHub 示例。

对 AI 伴侣这种涉及个人数据的 MCP，推荐「文档 + GitHub + OAuth 认证」的组合，而不是直接发到公开 Registry 让人一看到就能用。

## 10. 小结

- 自建 MCP Server 让你的能力被整个 LLM 生态消费

- 技术栈推荐：Cloudflare Workers + `@cloudflare/mcp-agent`，和 AI 伴侣后端同一环境

- 工具设计六原则：动词命名、参数最小化、详尽 description、返回结构稳定、分页、副作用醒目

- 认证上：内部用 API Key，对外用 OAuth；`userId` 从认证层拿，不暴露给 LLM

- 可观测性：路由中间件 + Langfuse 打入同一个 trace

- Dogfooding 模式：自己用自家 MCP，保证内部和外部调用路径一致

- 分发：私有分享、MCP Registry、Claude Directory、文档 + GitHub

下一篇进入协同三连的收官——**工程实战：AI SDK × LangChain/LangGraph 代码级协同**。把本章所有能力和前面 LangChain / LangGraph 两章的能力组合起来，给出 AI 伴侣主管线的完整代码骨架。
