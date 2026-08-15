---
title: "116 Vercel AI SDK"
pubDate: 2026-05-18
description: "后端：Hono 的 streamText 往 SSE 通道里逐条 writeln 协议帧"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/1-what-is-vercel-ai-sdk/](https://aicompanion.usehook.cn/1-what-is-vercel-ai-sdk/)

## 1. 手写流式 Chat 之后

在前面，我们学习过如何实现流式 AI Chat：

- 后端：Hono 的 `streamText` 往 SSE 通道里逐条 `writeln` 协议帧

- 中间：自定义事件名 `thinking` / `token` / `done` / `error`

- 前端：`fetch` + `reader.read()` + 手写 `parseSSEEvents` 切分双换行

- React 侧：手写 `useStreamChat` Hook 管理 `status` / `thinkingNode` / `reply` / `metadata` 四个状态

那一套代码跑起来了，从字节层把「逐 token 到 UI」的全链路走通了。但你要是把它搬进真实项目，大概率会撞上这几个问题：

**问题一：前端状态机，每次都要重写一遍。** 思考态、生成态、结束态、出错态 —— 这 4 种状态不是只出现在 AI 伴侣项目里，几乎所有 LLM 产品都要处理。可每次开新项目还是要把 `useState` + `while(true) { reader.read() }` 再写一遍，因为上次那份代码和新项目的消息协议对不上。

**问题二：模型切换，牵一发动全身。** 项目从 OpenAI 换 Claude，从 Claude 换 Workers AI，每一次切换都要改后端调用代码、改请求体结构、改响应解析。LangChain 的 `ChatOpenAI` / `ChatAnthropic` 能抹平一部分，但前端协议层和 UI 渲染层仍然和 Provider 强绑。

**问题三：Tool Calling 的 UI 自己搓。** LLM 调用了 `search_memory` 工具 —— 前端要不要展示「正在检索记忆」？工具返回后要不要展示检索到了 3 条？这些「中间态」要序列化成什么协议从后端发出去、前端又怎么渲染？这一层没有现成的约定，每个项目都在造轮子。

**问题四：每出一个新能力都要重新接一次。** Anthropic 发了 thinking tokens，你要改协议让前端渲染思考段；OpenAI 又发了 reasoning 参数，再改一次。后面还有 MCP 工具、多模态输入等等——每一个新能力都意味着前端事件类型、后端序列化、中间协议三处同步改。

这四个问题不归 LangChain 管，也不归 Hono 管——它们都是**「前端和后端之间的 AI 胶水层」**的问题。这一层在 2024 年以前一直没有事实标准。

Vercel AI SDK 就是来填这个空的。

## 2. Vercel AI SDK 是什么

一句话定位：

NOTE

**Vercel AI SDK 是面向 TypeScript/React 生态的 AI 应用工具链，提供从模型调用到前端 UI 的整条链路，让你用少量代码就能构建生产级的 AI 产品。**

它由三个部分组成：

- **AI SDK Core**：后端能力层。模型调用 (`generateText` / `streamText`)、结构化输出 (`generateObject` / `streamObject`)、工具调用 (`tool`)、Agent 循环 (`stopWhen`)

- **AI SDK Provider**：模型适配层。`@ai-sdk/openai`、`@ai-sdk/anthropic`、`@ai-sdk/google`、社区 Provider（含 Workers AI、OpenRouter 等）

- **AI SDK UI**：前端集成层。`useChat` / `useCompletion` / `useObject` 三个 React Hook，以及 Svelte、Vue 的对应实现

关键在于：**它定义了一套从模型到 UI 的端到端协议**。后端用 `streamText` 生成的流，前端用 `useChat` 直接消费，中间的消息格式、事件类型、工具可视化，都由 SDK 约定好了。你不需要再为每个项目设计一套私有协议。

最小可用示例：

**后端**（假设跑在 Hono + Cloudflare Workers 上）：

src/routes/chat.ts

```typescript
import { Hono } from 'hono'
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'

const app = new Hono()

app.post('/chat', async (c) => {
  const { messages } = await c.req.json()

  const result = streamText({
    model: openai('gpt-4o'),
    messages,
  })

  return result.toUIMessageStreamResponse()
})

export default app
```

**前端**（Next.js 16 + React 19）：

src/components/chat.tsx

```tsx
'use client'
import { useChat } from '@ai-sdk/react'

export function Chat() {
  const { messages, sendMessage, status } = useChat({
    api: '/api/chat',
  })

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>
          <strong>{m.role}：</strong>
          {m.parts.map((p, i) =>
            p.type === 'text' ? <span key={i}>{p.text}</span> : null
          )}
        </div>
      ))}
      <ChatInput onSend={sendMessage} disabled={status !== 'ready'} />
    </div>
  )
}
```

对比 [Streaming](/13-streaming-response-architecture) 手写版本里 70+ 行的 `useStreamChat` + 80+ 行的后端 SSE 协议帧，现在前后端加起来不到 30 行。而且模型从 `openai('gpt-4o')` 改成 `anthropic('claude-opus-4-6')` 不用动任何协议代码。

## 3. 与 LangChain / LangGraph 的详细对比

SDK 有了，必然会问：**和前面学的 LangChain / LangGraph 重叠吗？能一起用吗？**

简短回答：**底层能力大量重叠，但往上走一层，两者做的事完全不同——是分层互补，不是替代。**

### 3.1 能力对照表

这张表比较长，分三块看：**重叠的底层** / **LangChain 独有的后端编排** / **AI SDK 独有的前端能力**。扫一遍有个印象就行，细节后面都会展开。

| 能力维度 | LangChain/LangGraph | Vercel AI SDK | 关系 |
| --- | --- | --- | --- |
| 模型 Provider 抽象 | ChatOpenAI / ChatAnthropic ... | @ai-sdk/openai / @ai-sdk/anthropic ... | 完全重叠 |
| 消息协议 | HumanMessage / AIMessage ... | UIMessage / ModelMessage | 完全重叠 |
| 流式输出 | .stream() / .astream() | streamText | 完全重叠 |
| 结构化输出 | withStructuredOutput(zod) | generateObject(zod) | 完全重叠 |
| Tool Calling | bindTools + tool() | tool() + toolChoice | 完全重叠 |
| 多步 Agent 循环 | createReactAgent | stopWhen + stepCountIs | 完全重叠 |
| MCP 接入 | @langchain/mcp-adapters | experimental_createMCPClient | 完全重叠 |
| 可观测性 | LangSmith 生态 | OpenTelemetry / Langfuse | 都有，生态不同 |
| Prompt 模板引擎 | ChatPromptTemplate 体系 | 无（靠字符串拼接） | LangChain 独有 |
| RAG 工具箱 | Loader / Splitter / VectorStore / Retriever | 无内置 | LangChain 独有 |
| Memory 抽象 | ConversationBufferMemory ... | 无 | LangChain 独有 |
| LCEL 管道编排 | Runnable 并行/分支/回退 | 无 | LangChain 独有 |
| Graph 编排 | LangGraph StateGraph | 无 | LangChain 独有 |
| Checkpointer / 时间旅行 | LangGraph | 无 | LangChain 独有 |
| Human-in-the-Loop | LangGraph interrupt | 无（需手搓） | LangChain 独有 |
| 多 Agent 协同 | Supervisor / Handoff / Swarm | 无 | LangChain 独有 |
| 前端 UI Hook | 无 | useChat / useCompletion / useObject | AI SDK 独有 |
| UIMessageStream 高层协议 | 无（原始 SSE） | 含 part 类型约定 | AI SDK 独有 |
| React UI Parts 规范 | 无 | reasoning / tool-invocation / source / file | AI SDK 独有 |
| RSC 流式 UI | 无 | ai/rsc + createStreamableUI | AI SDK 独有 |

表格看完，关键信息可以压成三句话：

### 3.2 一句话总结每一层

**底层（模型调用）：两者完全重叠，选一个就好。** LLM 调用、流式、结构化输出、Tool Calling、MCP——谁都绕不过去，两者都做了自己的抽象。区别只在 API 风格：AI SDK 是 `streamText({ model, messages, tools })` 一个函数搞定；LangChain 是 `model.bindTools([...]).stream(messages)`，每步都是 Runnable，可以组合进 Chain。

**往上一层（后端编排）：LangChain 的地盘。** 只要你的 Agent 不是一问一答，而是多节点、有状态、能分支、能中断——那就是 LangGraph 的活。多节点 StateGraph、条件路由、HITL（人类审批断点）、时间旅行、多 Agent 协同，这些 AI SDK 都不做。AI SDK 的 `stopWhen` 只适合直线式循环。另外 LangChain 的 RAG 工具箱（Loader / Splitter / VectorStore / Retriever）也是 AI SDK 不提供的。

**再往上一层（前端胶水）：AI SDK 的地盘。** LangChain 不管前端——它暴露给前端的就是一个朴素的流，怎么消费、怎么渲染，你自己写。AI SDK 把这块补齐了：

- `useChat` / `useCompletion` / `useObject` 三个 Hook，覆盖聊天、续写、结构化三种场景

- UIMessageStream 协议：在 SSE 之上约定了 `text-delta` / `reasoning` / `tool-result` / `source` 等事件类型

- UI Message Parts：消息不再是单一字符串，而是一个数组——文本段、思考段、工具调用段、引用段，前端按 part 类型分别渲染

- RSC 流式 UI：`createStreamableUI` 让你直接 stream 出 React 组件树

做 React/Next.js 项目，跳过这一层等于放弃了现成的 UI 基础设施。

一句话：**LangChain 想的是「怎么把 LLM 编排成复杂的 Agent 管线」，AI SDK 想的是「怎么让前端工程师少写代码就能做出 AI 产品」。** 一个做后端大脑，一个做端到端胶水。

## 4. 三种协作模式

知道了两者的分工，接下来看怎么配合。实际项目基本就三种模式：

### 4.1 模式 A：纯 AI SDK

mode-a.txt

```text
前端 useChat
    ↓  UIMessageStream
Hono / Next.js Route Handler
    ↓  streamText
LLM Provider
```

**适用：**

- 单轮或简单多轮对话

- 简单 Tool Calling（几个工具，线性调用）

- 简单 RAG（检索逻辑业务层手写几十行）

- 快速 Demo、MVP、早期产品

**放弃：**

- 多节点图编排

- HITL、时间旅行、checkpointer

- 成熟 RAG 工具箱

**典型代表：** Vercel 官方 AI Chatbot 模板、大量 Next.js AI 应用脚手架。

### 4.2 模式 B：纯 LangChain / LangGraph

mode-b.txt

```text
前端消费（useChat 或自写 SSE reader）
    ↓  UIMessageStream 或自定义协议
Hono / FastAPI / Express
    ↓
LangGraph StateGraph
    ↓
LLM Provider
```

**适用：**

- 后端编排重、前端不是 React（是 Vue / SwiftUI / Flutter 等）

- 前端侧不强调 AI 专属 UI（只渲染一段最终文本）

- 纯后端 Agent 服务（例如内部自动化、数据流水线）

**放弃：**

- `useChat` 开箱即用的 UI 体验

- 思考态 / tool part 的标准可视化协议

**典型代表：** LangGraph Studio 里直接调试的后端 Agent、很多 Python 系 AI 产品。

### 4.3 模式 C：混合模式（本专栏推荐）

mode-c.txt

```text
前端 useChat + UI Parts
    ↓  UIMessageStream
Hono / Next.js Route Handler
    ↓
LangGraph StateGraph（情绪 / 记忆 / HITL / 多 Agent）
    ↓  AI SDK streamText
LLM Provider
```

**为什么 AI 伴侣项目特别适合模式 C：**

回看第 0 章我们给 AI 伴侣定的核心能力：

- **情绪状态机**（5 态跃迁）→ LangGraph 条件边最顺手

- **混合记忆架构**（短期 / 中期 / 长期 / 情景 / 人物 / 情感 6 类）→ LangGraph Store + LangChain Retriever 成熟方案

- **多步管线**（记忆召回 → 情绪判断 → Prompt 构造 → LLM 生成 → 记忆写回）→ LangGraph StateGraph 天作之合

- **前端流式 UI + 思考态指示**（「正在回忆你上次说的话…」）→ 只有 AI SDK 有现成协议

说白了就是**每一层用最合适的工具**。

**适用：**

- 后端编排复杂（多节点图、状态机、HITL）

- 前端是 React/Next.js，有复杂 AI UI

- 需要在同一个协议下做可观测性和中间件增强

**代价：**

- 多学一套工具链

- LangGraph Stream 事件 → AI SDK UIMessageStream 需要写一个适配层（[与 LangChain 协同](/20-langchain-integration) 详细讲）

**典型代表：** 大型 AI 产品（Cursor、Perplexity、Notion AI 的部分能力），以及本专栏实战部分要构建的 AI 伴侣。

## 5. 决策框架：什么时候用谁

三步就能选出来：

decision.txt

```text
Step 1: 前端是 AI SDK 官方支持的栈吗？（React / Next.js / Svelte / Vue）
    ├─ 不是（Angular / SwiftUI / 纯原生客户端 / 无 UI） → 去模式 B
    └─ 是 → 进入 Step 2

Step 2: 后端 Agent 管线节点数 ≥ 3 个，或需要 HITL / 时间旅行 / 多 Agent？
    ├─ 不需要 → 进入 Step 3
    └─ 需要 → 去模式 C（混合）

Step 3: 需要成熟 RAG 工具箱（多路 Retriever / 复杂文档加载 / 多格式分割）？
    ├─ 需要 → 去模式 C（AI SDK 做胶水、RAG 用 LangChain）
    └─ 不需要 → 去模式 A（纯 AI SDK）
```

几个常见疑问：

**MCP 工具跟选型有关系吗？** 没有。同一个 MCP Server 可以被 AI SDK 和 LangChain 同时消费，选型和 MCP 完全解耦。

**结构化输出用谁的？** 两者都支持 Zod schema。如果只是后端内部用（情绪分类、意图识别），哪个都行。如果前端要流式渲染（逐字段展开的表单、评分卡），用 AI SDK 的 `streamObject` + `useObject`，这个组合 LangChain 没有。

**不确定将来会不会变复杂？** 从模式 A 起步就好。把模型调用和业务逻辑分清楚：LLM 调用走 AI SDK，业务状态放 Zustand 或后端 state。将来升级到模式 C，只要把 Zustand 那一层换成 LangGraph StateGraph，AI SDK 那一层不用动。**A → C 是非破坏性升级**，但 A → B 不是。

## 6. 与本专栏前面章节的衔接

到这里你可能会想：前面学的 LangChain、LangGraph、Hono、Zod 是不是白学了？

不是。前面每一章给你的是不同层的能力，AI SDK 是把它们粘起来的那一层：

| 已学章节 | 留下的能力 | 本章如何对接 |
| --- | --- | --- |
| (1.architecture) | Agent / 多 Agent 的认知框架 | 多步推理 复用这个框架，但用 AI SDK 的语法 |
| (2.langchain) | LCEL / Memory / RAG / Tool / Tracing | 与 LangChain 协同 把 Retriever / Memory 接进 AI SDK 的 tool() |
| (3.langgraph) | StateGraph / Checkpointer / 多 Agent | 与 LangChain 协同 把 LangGraph stream 桥接成 AI SDK 的 UIMessageStream |
| (4.monorepo) | 共享包 / Turborepo 缓存 | AI SDK × Hono 把 AI SDK 的 client/server 代码组织进 monorepo |
| (5.honojs) | Hono / Workers / D1 / R2 / Vectorize | AI SDK × Hono 在 Hono 上接入 AI SDK，模型 Provider 生态 讲 Workers AI Provider |
| (6.zod) | Schema / parse / Structured Output | 结构化输出 把 Zod schema 传给 generateObject 做结构化输出 |

前 6 章是各个零件，本章教你怎么把它们组装到一起。

## 7. 小结

- **Vercel AI SDK 是为 TypeScript/React 生态设计的 AI 应用工具链**，解决「前端到后端的 AI 胶水层」一直没有事实标准的问题

- **它和 LangChain 不是替代关系**：底层模型调用层重叠（选一个就好）、后端编排层 LangChain 强、前端胶水层 AI SDK 强

- **三种协作模式**：模式 A 纯 AI SDK（简单）、模式 B 纯 LangChain（非 React 后端重）、模式 C 混合（复杂 AI 产品首选）

- **AI 伴侣项目走模式 C**：LangGraph 做情绪状态机和记忆管线，AI SDK 做前端流式 UI 和最终 LLM 节点

- **决策路径**：前端栈 → 后端复杂度 → RAG 需求 三步得出选型

下一篇我们拆开 AI SDK 的**三层架构**：Provider / Core / UI 各自的职责、API 风格、以及为什么这样分层。把这三层看清楚之后，后面所有功能点都能在心智模型里找到自己的位置。
