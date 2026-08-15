---
title: "135 与 LangChain 协同"
pubDate: 2026-05-23
description: "Vercel AI SDKhttps://aicompanion.usehook.cn/1whatisvercelaisdk 我们讲过「为什么 AI SDK 和 LangChain 是分层互补而不是替代」，并给出了三种协作模式，C（混合模式"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/20-langchain-integration/](https://aicompanion.usehook.cn/20-langchain-integration/)

## 1. 这一篇的位置

[Vercel AI SDK](/1-what-is-vercel-ai-sdk) 我们讲过「为什么 AI SDK 和 LangChain 是分层互补而不是替代」，并给出了三种协作模式，C（混合模式）是 AI 伴侣项目的选择。

前面 19 篇把 AI SDK 各层讲透了，LangChain 第 2 章和 LangGraph 第 3 章把后端编排讲透了。这一篇把它们真正组合起来，给出 AI 伴侣主管线的完整代码骨架。

具体回答四个问题：

- LangGraph 的 `.stream()` 事件，怎么翻译成 AI SDK 的 UIMessageStream 让前端 `useChat` 消费？

- AI SDK 的 `tool()` 的 `execute` 里，怎么复用 LangChain 的 Retriever / Memory？

- 前端 `UIMessage` 历史，怎么同步成 LangGraph 的 State？

- 谁放哪里——哪些逻辑用 LangGraph、哪些用 AI SDK、哪些干脆用 Zod + generateObject？

读完这一篇，你就能在 [重构端到端 AI Chat](/21-practice-end-to-end) 里直接上手。

## 2. 明确每一层的职责

先把 AI 伴侣项目的每一层职责列清楚：

layers.txt

```text
┌─────────────────────────────────────────────┐
│ 前端（Next.js 16 / React 19）                │
│ - useChat + UI Parts                        │
│ - 思考态 / tool part / data part 渲染       │
│ - UI SDK 层                                  │
├─────────────────────────────────────────────┤
│ HTTP 层（Hono on Cloudflare Workers）        │
│ - Route: /chat, /resume, /feedback          │
│ - 认证 / 限流 / abort 传递                   │
├─────────────────────────────────────────────┤
│ 桥接层（本章重点）                            │
│ - LangGraph Event ↔ AI SDK UIMessageStream  │
│ - UIMessage ↔ LangGraph State               │
├─────────────────────────────────────────────┤
│ 管线层（LangGraph StateGraph）               │
│ 节点：                                       │
│   ├─ loadContext（D1 加载画像 / 历史）      │
│   ├─ emotionClassifier（generateObject）    │
│   ├─ memoryRetrieval（LangChain Retriever） │
│   ├─ buildPrompt（prompts 包）              │
│   ├─ llm（streamText + tools）              │
│   └─ persistState（D1 / Vectorize 异步写回）│
├─────────────────────────────────────────────┤
│ 能力层                                       │
│ - @ai-sdk/openai / workers-ai-provider      │
│ - @langchain/community Retriever / Memory   │
│ - Cloudflare D1 / KV / Vectorize            │
└─────────────────────────────────────────────┘
```

桥接层是本章的主角。它把两个生态缝合起来。

## 3. 桥接一：LangGraph Event → UIMessageStream

LangGraph 的 `.stream({ streamMode: 'messages' })` 返回一个异步迭代器，每次 yield 一个 `[chunk, metadata]` 二元组。chunk 是 `AIMessageChunk`（LangChain 自己的类型），需要翻译成 AI SDK 的 UIMessageStream 协议。

核心思路是：包装成一个 `ReadableStream`，每个 chunk 产出对应的 UIMessage part。

bridge-graph-to-ui.ts

```typescript
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import type { CompiledGraph } from '@langchain/langgraph'
import type { AIMessageChunk } from '@langchain/core/messages'

export function createGraphUIResponse(
  graph: CompiledGraph,
  initialState: CompanionState,
  config: { signal?: AbortSignal },
) {
  const uiStream = createUIMessageStream({
    execute: async ({ writer }) => {
      // 1. 跑 LangGraph 的流
      for await (const [event, metadata] of graph.stream(initialState, {
        streamMode: 'messages',
        signal: config.signal,
      })) {
        // 2. 按 LangGraph 节点分发
        const nodeName = metadata.langgraph_node

        if (nodeName === 'emotionClassifier' && 'emotion' in event) {
          // 情绪分类节点完成后，发一个 data part 到前端
          writer.write({
            type: 'data-emotion',
            data: { primary: event.emotion, intensity: event.intensity },
          })
        }

        if (nodeName === 'memoryRetrieval' && 'memories' in event) {
          // 记忆检索节点完成后
          writer.write({
            type: 'data-memories-used',
            data: { count: event.memories.length },
          })

          // 每条记忆作为 source-document part
          for (const m of event.memories) {
            writer.write({
              type: 'source-document',
              sourceId: m.id,
              mediaType: 'application/json',
              title: m.content.slice(0, 20),
            })
          }
        }

        if (nodeName === 'llm' && isAIMessageChunk(event)) {
          // LLM 节点产 text-delta
          if (event.content) {
            writer.write({
              type: 'text-delta',
              id: event.id ?? 'txt_0',
              delta: typeof event.content === 'string'
                ? event.content
                : event.content.map((c) => (c.type === 'text' ? c.text : '')).join(''),
            })
          }
        }
      }
    },
  })

  return createUIMessageStreamResponse({ stream: uiStream })
}
```

使用：

use-bridge.ts

```typescript
app.post('/chat', async (c) => {
  const { messages, sessionId } = await c.req.json()
  const graph = createCompanionGraph(c.env)

  const initialState: CompanionState = {
    sessionId,
    messages: langchainMessagesFromUI(messages),  // 见桥接三
  }

  return createGraphUIResponse(graph, initialState, {
    signal: c.req.raw.signal,
  })
})
```

前端 `useChat` 消费这个响应，就能看到完整体验：情绪 badge → 记忆 hint → source 徽章 → 文本流式吐出。

## 4. 桥接二：AI SDK tool 内部用 LangChain

AI SDK 的 `tool()` 的 `execute` 是一个 async 函数，里面想用什么都行。LangChain 的各种 Retriever / Memory / VectorStore 封装都挺成熟，直接 import 过来用：

tool-with-langchain.ts

```typescript
import { tool } from 'ai'
import { z } from 'zod'
import { CloudflareVectorizeStore } from '@langchain/cloudflare'
import { CloudflareWorkersAIEmbeddings } from '@langchain/cloudflare'

export function searchMemoryTool(env: Env, userId: string) {
  return tool({
    description: '从长期记忆库里检索与当前对话相关的回忆',
    inputSchema: z.object({
      query: z.string().describe('检索的关键词或问题'),
      topK: z.number().int().min(1).max(10).default(3),
    }),
    execute: async ({ query, topK }) => {
      // 用 LangChain 的 Embeddings 和 VectorStore
      const embeddings = new CloudflareWorkersAIEmbeddings({
        binding: env.AI,
        modelName: '@cf/baai/bge-m3',
      })

      const store = new CloudflareVectorizeStore(embeddings, {
        index: env.VECTORIZE,
      })

      const retriever = store.asRetriever({
        k: topK,
        filter: { userId },
      })

      const docs = await retriever.invoke(query)

      return docs.map((d) => ({
        content: d.pageContent,
        metadata: d.metadata,
      }))
    },
  })
}
```

关键在于：从 AI SDK 的视角看，`searchMemoryTool` 就是一个普通 tool，LLM 根本不知道里面用了 LangChain。这就是分层的价值。

同样的模式还可以这么组合：

- 用 LangChain 的 `ConversationSummaryMemory` 做历史摘要，包成 AI SDK 的 tool

- 用 LangChain 的 `MultiQueryRetriever` 做多路检索，包成 AI SDK 的 tool

- 用 LangChain 的 `WebBaseLoader` + `RecursiveCharacterTextSplitter` 处理 RAG 入库，放在定时任务里用，不走 tool

## 5. 桥接三：UIMessage ↔ LangChain BaseMessage

两套消息格式转换，两个方向。

### 5.1 UIMessage → LangChain BaseMessage

ui-to-langchain.ts

```typescript
import type { UIMessage } from 'ai'
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'

export function langchainMessagesFromUI(uiMessages: UIMessage[]): BaseMessage[] {
  const result: BaseMessage[] = []

  for (const m of uiMessages) {
    // 把 parts 里的 text 合并成一个字符串
    const text = m.parts
      .filter((p) => p.type === 'text')
      .map((p: any) => p.text)
      .join('')

    // 处理 tool part（这里只处理简单文本，复杂情况参考下面）
    if (m.role === 'user') {
      result.push(new HumanMessage(text))
    } else if (m.role === 'assistant') {
      // 检查是否有 tool-invocation
      const toolParts = m.parts.filter((p) => p.type.startsWith('tool-'))

      if (toolParts.length > 0) {
        // 一条 AIMessage 带 tool_calls
        result.push(
          new AIMessage({
            content: text,
            tool_calls: toolParts.map((p: any) => ({
              id: p.toolCallId,
              name: p.type.slice('tool-'.length),
              args: p.input,
            })),
          }),
        )
        // 再加 ToolMessage 传结果
        for (const p of toolParts) {
          if ((p as any).state === 'output-available') {
            result.push(
              new ToolMessage({
                tool_call_id: (p as any).toolCallId,
                content: JSON.stringify((p as any).output),
              }),
            )
          }
        }
      } else {
        result.push(new AIMessage(text))
      }
    } else if (m.role === 'system') {
      result.push(new SystemMessage(text))
    }
  }

  return result
}
```

### 5.2 LangChain BaseMessage → UIMessage

反向转换用得比较少（前端一般只用 `useChat` 的消息数据源，不直接读 LangChain Message）。但持久化时可能需要——比如 LangGraph checkpointer 把 State 存进 Postgres，刷新页面时要把它转回 UIMessage 喂给 `useChat`。

langchain-to-ui.ts

```typescript
import type { UIMessage } from 'ai'
import type { BaseMessage } from '@langchain/core/messages'
import { AIMessage, HumanMessage } from '@langchain/core/messages'

export function uiMessagesFromLangchain(lcMessages: BaseMessage[]): UIMessage[] {
  return lcMessages
    .filter((m) => !(m.getType() === 'system'))  // system 不给前端看
    .map((m, i) => ({
      id: `msg_${i}`,
      role: m.getType() === 'human' ? 'user' : 'assistant',
      parts: [
        {
          type: 'text',
          text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        },
      ],
    }))
}
```

## 6. 完整代码骨架：AI 伴侣主管线

把上面的桥接全拼起来，看完整的主管线结构。

### 6.1 LangGraph StateGraph（管线层）

companion-graph.ts

```typescript
import { StateGraph, Annotation } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'
import { generateObject } from 'ai'
import { z } from 'zod'

const CompanionState = Annotation.Root({
  sessionId: Annotation<string>,
  messages: Annotation<BaseMessage[]>({ reducer: (a, b) => [...a, ...b] }),
  emotion: Annotation<{ primary: string; intensity: number } | undefined>,
  memories: Annotation<Memory[]>({ default: () => [] }),
  systemPrompt: Annotation<string>,
})

export function createCompanionGraph(env: Env) {
  const workflow = new StateGraph(CompanionState)
    // 节点 1：加载上下文
    .addNode('loadContext', async (state) => {
      const profile = await loadUserProfile(env.DB, state.sessionId)
      return { /* 更新 state */ }
    })

    // 节点 2：情绪分类（用 AI SDK generateObject）
    .addNode('emotionClassifier', async (state) => {
      const lastUser = state.messages.at(-1)
      const { object } = await generateObject({
        model: models.structured,
        schema: z.object({
          primary: z.enum(['happy', 'sad', 'angry', 'calm', 'neutral']),
          intensity: z.number().min(0).max(1),
        }),
        prompt: `分类这段话的情绪：${lastUser?.content}`,
      })
      return { emotion: object }
    })

    // 节点 3：记忆检索（用 LangChain Retriever）
    .addNode('memoryRetrieval', async (state) => {
      const query = String(state.messages.at(-1)?.content ?? '')
      const retriever = buildLangchainRetriever(env)
      const docs = await retriever.invoke(query)
      return { memories: docs.map(d => ({ content: d.pageContent, ...d.metadata })) }
    })

    // 节点 4：构造 system prompt
    .addNode('buildPrompt', async (state) => {
      const prompt = buildCompanionPrompt({ /* ... */ })
      return { systemPrompt: prompt }
    })

    // 节点 5：LLM 生成（这个节点特别，交给 AI SDK 流式处理）
    .addNode('llm', async (state) => {
      // 这个节点只是占位，真正的 streamText 发生在桥接层
      // 节点返回空更新
      return {}
    })

    .addEdge('__start__', 'loadContext')
    .addEdge('loadContext', 'emotionClassifier')
    .addEdge('emotionClassifier', 'memoryRetrieval')
    .addEdge('memoryRetrieval', 'buildPrompt')
    .addEdge('buildPrompt', 'llm')
    .addEdge('llm', '__end__')

  return workflow.compile()
}
```

### 6.2 桥接层：把 LangGraph + AI SDK 合流

bridge-main.ts

```typescript
export async function runCompanionPipeline(
  env: Env,
  sessionId: string,
  uiMessages: UIMessage[],
  signal?: AbortSignal,
) {
  const graph = createCompanionGraph(env)

  const uiStream = createUIMessageStream({
    execute: async ({ writer }) => {
      let systemPrompt = ''

      // 跑到 llm 节点前的所有节点
      for await (const [event, metadata] of graph.stream(
        {
          sessionId,
          messages: langchainMessagesFromUI(uiMessages),
        },
        { streamMode: 'values', signal },
      )) {
        const node = metadata.langgraph_node

        if (node === 'emotionClassifier' && event.emotion) {
          writer.write({
            type: 'data-emotion',
            data: event.emotion,
          })
        }

        if (node === 'memoryRetrieval' && event.memories) {
          writer.write({
            type: 'data-memories-used',
            data: { count: event.memories.length },
          })
        }

        if (node === 'buildPrompt' && event.systemPrompt) {
          systemPrompt = event.systemPrompt
        }

        if (node === 'llm') {
          // 此时 graph 跑到 llm 节点，让 AI SDK 流式接管
          const result = streamText({
            model: buildCompanionModel(env, sessionId),  // 带中间件
            system: systemPrompt,
            messages: convertToModelMessages(uiMessages),
            tools: {
              searchMemory: searchMemoryTool(env, sessionId),
              updateEmotion: updateEmotionTool(env, sessionId),
            },
            stopWhen: stepCountIs(5),
            abortSignal: signal,

            onFinish: ({ text, usage }) => {
              // 异步写回 D1 / Vectorize
              writeBackAsync(env, sessionId, text, usage)
            },
          })

          // 合并 AI SDK 的流到 UIMessageStream
          writer.merge(result.toUIMessageStream())
        }
      }
    },
  })

  return createUIMessageStreamResponse({ stream: uiStream })
}
```

### 6.3 HTTP 入口（Hono）

route.ts

```typescript
import { Hono } from 'hono'

app.post('/chat', async (c) => {
  const { messages, sessionId } = await c.req.json()
  return runCompanionPipeline(c.env, sessionId, messages, c.req.raw.signal)
})
```

### 6.4 前端（useChat）

前端代码不变。就是 [聊天 UI 标准实现](/11-use-chat-hook) 的 `useChat` 标准用法，前端根本不需要知道后端是怎么组合 LangGraph 和 AI SDK 的。

## 7. 这样做值不值？

协同模式相比「纯 AI SDK」多了一些复杂度：

- 两套消息模型转换

- 桥接层代码（大约 150 行）

- 学习成本（要懂 LangGraph）

换来的收益也不小：

- 管线可视化和可调试：LangGraph Studio / LangSmith 里能看整个图的每一步

- 节点级替换：情绪节点换个实现，其他代码不动

- HITL 就位：LangGraph 的 `interrupt` 天然支持审批断点

- 时间旅行：checkpointer 可以回到任意历史状态重跑

- 多 Agent 扩展：想加个 supervisor、加个 swarm，LangGraph 生态都是现成的

判断要不要用协同模式：

- 管线节点少于 3 个，不需要 HITL 或 checkpointer，纯 AI SDK 够用

- 管线节点超过 3 个，或者需要上面任一特性，就值得用协同模式

AI 伴侣项目管线超过 5 节点，未来要加 HITL（情绪低落时的人工干预），还需要回放 debug（用户投诉某句回复时）。这种情况下协同模式的收益明显大于复杂度。

## 8. 其他组合场景

除了 AI 伴侣主管线，下面几个场景也适合协同。

### 纯 LangChain RAG + AI SDK 前端

大型知识库问答产品，后端主要是 LangChain 的 RAG 管线（Document Loader、多路 Retriever + Re-ranker、Memory + 摘要）。前端还是 `useChat` + UI Parts 享受流式体验。桥接层只需要把最终的 LangChain LLM 调用换成 AI SDK `streamText`。

### 多 Agent LangGraph Swarm + AI SDK UI

Agent 协作型产品（写代码、写报告、做研究），LangGraph Swarm 负责 agent 之间的 handoff。前端用 UI Parts 渲染每个 agent 的贡献、handoff 的过程、最终 supervisor 的决策。

### AI SDK 主管线 + LangChain 工具箱

最轻量的组合：主管线就是 `streamText + tools`，但有一两个工具（RAG、摘要）用 LangChain 实现。不需要桥接层，只是在 tool 的 `execute` 里 import LangChain。AI 伴侣的初期 MVP 其实也可以走这种组合，随着能力复杂再升级到完整协同模式。

## 9. 小结

- 协同模式 C 在 AI 伴侣项目里是最优解：LangGraph 做管线，AI SDK 做胶水和前端

- 桥接一：LangGraph event → UIMessageStream，用 `createUIMessageStream` + 按节点分发 part

- 桥接二：AI SDK `tool.execute` 内部直接 import 用 LangChain 的 Retriever / Memory / VectorStore

- 桥接三：UIMessage ↔ LangChain BaseMessage，双向转换函数

- 完整骨架：LangGraph 节点到 llm 前是 pipeline，llm 节点交给 AI SDK 的 `streamText` 流式处理，结果并回 UIMessageStream

- 取舍：3 节点以下不用协同模式；超过 3 节点或要 HITL / checkpointer，协同模式值得

下一篇是本章实战——**用 AI SDK 重构端到端 AI Chat**。对照 [实战：端到端 AI Chat](/14-end-to-end-ai-chat) 的手写版本，把本章所有内容落成一个可运行的完整 demo。
