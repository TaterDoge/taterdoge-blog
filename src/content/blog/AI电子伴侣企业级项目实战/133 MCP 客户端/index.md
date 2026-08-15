---
title: "133 MCP 客户端"
pubDate: 2026-05-23
description: "MCP（Model Context Protocol）是 Anthropic 在 2024 年底推出的一个开放协议，到 2026 年已经成为工具生态的事实标准。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/18-mcp-client/](https://aicompanion.usehook.cn/18-mcp-client/)

## 1. MCP 是什么，为什么它重要

MCP（Model Context Protocol）是 Anthropic 在 2024 年底推出的一个开放协议，到 2026 年已经成为工具生态的事实标准。

一句话定义：

NOTE

MCP 让「工具」像 REST API 一样有标准接入协议，任何 LLM 应用都能消费任何 MCP Server 的工具，无需为每种集成写胶水。

在 MCP 之前，把一个工具接入 LLM 应用是这样的：

- Claude Desktop 要 Google Drive 工具 → Anthropic 得写一份

- Cursor 要 Google Drive 工具 → Cursor 再另写一份

- 你自己的 AI 伴侣要 Google Drive 工具 → 你又要写一份

每个上游都在重复发明同一个轮子。

MCP 把「工具」标准化了：

mcp-ecosystem.txt

```text
[工具供应商发布一个 MCP Server]
  │
  ├─ Claude Desktop 消费
  ├─ Cursor 消费
  ├─ Codex 消费
  ├─ 本专栏的 AI 伴侣消费
  └─ 任何支持 MCP 的应用消费
```

到 2026 年 4 月，已经有数千个 MCP Server 可用：GitHub、Slack、Google Drive、Notion、PostgreSQL、Stripe、Figma、Cloudflare 自家的 MCP，还有无数社区的。

AI SDK 内置了 MCP 客户端（`experimental_createMCPClient`），让你的 AI 伴侣可以直接把任意 MCP Server 的工具当作自己的 `tool()` 用。这一篇把客户端接入讲透，下一篇讲怎么自建 MCP Server。

## 2. MCP 协议速览

MCP 基于 JSON-RPC 2.0，有三种主要传输通道：

| 传输 | 使用场景 | AI SDK 支持 |
| --- | --- | --- |
| stdio | 本地工具（命令行启动的子进程） | ✅ |
| SSE（Server-Sent Events） | 远程部署的 MCP Server | ✅（已被 Streamable HTTP 替代） |
| Streamable HTTP | 推荐的远程方式 | ✅ |

协议定义了几种能力：

- Tools：LLM 可以调用的函数

- Resources：LLM 可以读取的数据源（文件、数据库表）

- Prompts：可复用的 prompt 模板

AI SDK 目前主要消费 Tools。Resources 和 Prompts 在 MCP 更复杂的用法里用到，本章不展开。

## 3. 连接 MCP Server

### 3.1 本地 MCP Server（stdio）

最快上手的方式是连一个随手能跑的本地 MCP Server，比如 filesystem。

index.bash

```shellscript
pnpm add ai @modelcontextprotocol/sdk
```

用官方的 `filesystem` MCP Server（能读写指定目录）：

mcp-stdio.ts

```typescript
import { experimental_createMCPClient as createMCPClient } from 'ai'
import { Experimental_StdioMCPTransport as StdioMCPTransport } from 'ai/mcp-stdio'
import { streamText } from 'ai'

const client = await createMCPClient({
  transport: new StdioMCPTransport({
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/mcp-sandbox'],
  }),
})

// 把 MCP 的 tools 取出来，传给 streamText
const tools = await client.tools()

const result = streamText({
  model: models.chat,
  messages: [{ role: 'user', content: '创建一个 hello.txt，内容是 hi MCP' }],
  tools,
  stopWhen: stepCountIs(5),
})

for await (const part of result.textStream) {
  process.stdout.write(part)
}

// 记得关闭
await client.close()
```

跑起来之后，LLM 会调 `write_file` 工具，在 `/tmp/mcp-sandbox/hello.txt` 里写入内容。

### 3.2 远程 MCP Server（Streamable HTTP）

远程 MCP Server 越来越多。比如 Cloudflare、GitHub、Notion 都有官方远程 MCP Server。用 `StreamableHTTPClientTransport`：

mcp-http.ts

```typescript
import { experimental_createMCPClient as createMCPClient } from 'ai'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const transport = new StreamableHTTPClientTransport(
  new URL('https://api.example.com/mcp'),
  {
    // 自定义 fetch（比如加 auth header）
    fetch: async (url, init) => {
      return fetch(url, {
        ...init,
        headers: {
          ...init?.headers,
          Authorization: `Bearer ${process.env.MCP_TOKEN}`,
        },
      })
    },
  },
)

const client = await createMCPClient({ transport })
const tools = await client.tools()
```

很多远程 MCP Server 需要 OAuth。AI SDK 的客户端支持 OAuth，只是接入要花点工夫，超出本章范围。建议先从 token-based 的 MCP Server 入手熟悉协议。

## 4. 工具 schema 与合并

`client.tools()` 返回的是一组标准的 AI SDK `tool()`，可以直接合并进你自己的工具集：

merge-tools.ts

```typescript
const companionTools = createCompanionTools(env, sessionId)
const mcpTools = await client.tools()

const result = streamText({
  model: models.chat,
  messages,
  tools: {
    ...companionTools,
    ...mcpTools,
  },
  stopWhen: stepCountIs(8),
})
```

注意命名冲突：你自己的 `searchMemory` 和某个 MCP Server 的 `searchMemory` 同名时，后面的会覆盖前面的。建议给 MCP tools 加前缀：

prefixed-tools.ts

```typescript
function prefixTools(tools: Record<string, Tool>, prefix: string) {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [`${prefix}_${name}`, tool]),
  )
}

const tools = {
  ...companionTools,
  ...prefixTools(await client.tools(), 'fs'),     // fs_read_file / fs_write_file
  ...prefixTools(await ghClient.tools(), 'gh'),   // gh_create_issue ...
}
```

## 5. 动态工具：LLM 见到的是 dynamic-tool

从 MCP 来的工具在 UIMessageStream 里的 part type 是 `dynamic-tool`，而不是普通的 `tool-{name}`。因为工具列表是在运行时决定的，前端不能在编译时就知道所有 toolName。

前端处理：

dynamic-tool-render.tsx

```tsx
function Part({ part }: { part: UIMessage['parts'][number] }) {
  if (part.type === 'dynamic-tool') {
    return (
      <div className="tool-card">
        <strong>工具：{part.toolName}</strong>
        {part.state === 'output-available' && (
          <pre>{JSON.stringify(part.output, null, 2)}</pre>
        )}
      </div>
    )
  }
  if (part.type.startsWith('tool-')) {
    return <TypedToolCard part={part} />
  }
  return null
}
```

实际项目里的分工很清楚：自家工具（有确定 type）做专门的定制 UI（`ToolMemoryCard` / `ToolEmotionCard`），MCP 工具（都是 `dynamic-tool`）走通用 JSON 展示，或者按 toolName 做个映射表。

## 6. MCP Server 的生命周期管理

MCP 客户端本质上是一个连接，要正确管理生命周期。

### 6.1 Node 脚本：try/finally

lifecycle-node.ts

```typescript
async function runChat() {
  const client = await createMCPClient({ transport: ... })
  try {
    const tools = await client.tools()
    const result = await generateText({ model, messages, tools })
    return result
  } finally {
    await client.close()
  }
}
```

### 6.2 Web 服务（Hono）：每个请求独立连接

不要全局共享一个 client。Workers 每个请求可能是不同的 Isolate，共享 client 容易出 bug。

lifecycle-workers.ts

```typescript
app.post('/chat', async (c) => {
  const client = await createMCPClient({ transport: ... })

  try {
    const mcpTools = await client.tools()
    const result = streamText({
      model,
      messages,
      tools: { ...companionTools, ...mcpTools },
      onFinish: () => {
        // 流结束后再关，不能太早
        c.executionCtx.waitUntil(client.close())
      },
    })
    return result.toUIMessageStreamResponse()
  } catch (err) {
    await client.close()
    throw err
  }
})
```

这里一个关键点：`client.close()` 必须在流结束之后调用，中间就关掉会导致 tool 执行失败。放进 `onFinish` + `ctx.waitUntil` 是最安全的。

如果 QPS 真的很高、每请求创建 stdio 子进程太慢，可以做连接池。但复杂度很高，一般不到这个规模就不用。

## 7. MCP 工具的 typed schema

默认 `client.tools()` 返回的工具 inputSchema 会被 AI SDK 包成一个宽松的 `z.object()`，内部是从 JSON Schema 转来的。如果你想要更严格的类型（TypeScript 层面），可以手动声明：

typed-mcp.ts

```typescript
import { z } from 'zod'

const tools = await client.tools({
  schemas: {
    search_repos: {
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(50).default(10),
      }),
    },
  },
})
// 现在 search_repos 在 TypeScript 层是已知 schema，有补全
```

这一步只影响 TypeScript 提示，运行时的校验仍然按 MCP Server 自己声明的 schema 走。

## 8. 给 AI 伴侣接哪些 MCP

AI 伴侣原生能力已经够用，但接几个 MCP 工具能极大扩展场景：

| MCP Server | 作用 | 在 AI 伴侣里的用法 |
| --- | --- | --- |
| filesystem | 读写用户本地文件 | 用户在桌面版客户端里指定一个「日记目录」，伴侣能读写 |
| Google Drive / Notion | 云笔记 | 让伴侣帮用户记录心情到 Notion |
| Spotify / Apple Music | 音乐 | 根据情绪推荐并播放音乐 |
| Weather MCP | 天气 | 早安问候时带上今天天气 |
| Calendar | 日程 | 提醒用户今天的安排 |
| 自家 MCP Server（下一篇讲） | 记忆检索、关系画像 | 把自己的能力发布给其他 AI 应用用 |

## 9. 安全、权限与常见问题

### 安全红线

MCP 工具的执行等于在跑外部代码。有几条安全红线要守住。

来源可信：不要连任何用户输入的 MCP URL，容易被社工钓鱼。官方和有信誉的才连。

权限最小化：filesystem MCP 给一个单独的沙盒目录，不要给整个用户 home。

审计：用户通过 MCP 做的每次 tool 调用都要有日志（[可观测性：Telemetry](/17-observability) 的 telemetry 已经涵盖）。

别泄漏密钥：Auth token 放 secret，不要写在代码里。

HITL（人类审批）：对高风险工具（发邮件、删文件、转账）用 [Tool Calling](/9-tool-calling) 讲的「省略 `execute` + 前端确认」模式。

### 常见问题

连接建立慢：stdio 启动子进程、HTTP 建连都要时间。如果每个请求都新建连接，首次 TTFT 会慢 200-500ms。几种解法：在 Workers 上接受这点延迟（MCP 相比 LLM 延迟占比小）；高 QPS 场景做连接池；或者把 MCP 工具按需 lazy 加载，只有 LLM 决定调用时才建连。

Tool 描述太长打爆 token：有些 MCP Server 提供几十个工具，全部列出去会占掉很多 prompt token。解法：只开启你真需要的工具（通过 `schemas` 白名单）；或者先让 LLM 选「要不要用这个 Server」，再加载具体工具（两阶段）。

MCP Server 崩了：stdio 进程挂了、HTTP server 返回 500，`client.tools()` 或某次 tool 调用会抛错。解法：把 MCP 工具看成 best effort，没有就降级（catch 错误，继续用自家工具）；参考 [缓存、限流、Fallback](/16-middleware) 的 Retry middleware 思路，给 MCP 调用加重试。

## 10. 小结

- MCP 让工具生态标准化：发布一个 Server，所有支持 MCP 的应用都能用

- AI SDK 用 `experimental_createMCPClient` 消费 MCP，支持 stdio / Streamable HTTP

- `client.tools()` 直接返回 AI SDK 格式的 tools，可以和自家工具合并

- `dynamic-tool` part 是 MCP 工具在前端的呈现 type

- 生命周期：Node 用 try/finally；Workers 用 `onFinish` + `ctx.waitUntil(client.close())`

- 类型化 schema 改善 TS 体验，但不改变运行时行为

- 安全五条：可信来源、最小权限、审计、不泄密、HITL

下一篇反过来——**自建 MCP 服务端**：把 AI 伴侣的「记忆检索」「关系画像」能力发布成 MCP，让其他应用也能消费。
