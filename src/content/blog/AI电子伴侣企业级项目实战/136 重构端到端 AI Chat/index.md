---
title: "136 重构端到端 AI Chat"
pubDate: 2026-05-24
description: "业务层调 LLM（手写 fetch、手写 SSE 解析、手写 JSON schema 校验）"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/21-practice-end-to-end/](https://aicompanion.usehook.cn/21-practice-end-to-end/)

## 1. 本篇目标

前面我们做过一个端到端 AI Chat demo：

- 共享 Zod schema 作为契约

- Hono RPC Client 发请求

- Hono API 入口 validate

- 业务层调 LLM（手写 fetch、手写 SSE 解析、手写 JSON schema 校验）

- 响应层 schema 解析返回

那份代码证明了「Zod 作为唯一真相源」的威力。但它的流式链路是手搓的，前端也没有 `useChat` 的体验。

这一篇要做的事：用 AI SDK + 前面所有能力，把同一个 demo 重构一遍。最终成果是一个生产级别的、类型安全的、流式渲染的、带工具调用可视化的、能部署到 Cloudflare Workers 的端到端 AI Chat。

完整代码在 monorepo 里，本文展示关键片段和架构决策。

## 2. 项目结构

延续 4.monorepo 章的组织方式：

chat.ts请求/响应 schemacompanion.ts业务 schema（情绪、记忆）common.ts通用类型companion.tsPrompt 构造（Prompt 工程 × AI SDK）providers.tsProvider 抽象（模型 Provider 生态）index.tsHono app 入口bindings.tsEnv 类型chat.ts/chat 接口search-memory.tsupdate-emotion.tsindex.tscache.ts缓存、限流、Fallbackrate-limit.tsfallback.tslangfuse.ts可观测性：Telemetrypage.tsxchat.tsxuseChatmessage.tsxUI Parts 分发text-part.tsxMarkdown + 光标reasoning-part.tsxmemory-card.tsxemotion-badge.tsxemotion-badge.tsx

## 3. 共享 schema（契约层）

核心契约继续用 Zod 写，和前几章完全一致：

shared/schemas/chat.ts

```typescript
import { z } from 'zod'

export const ChatRequestSchema = z.object({
  sessionId: z.string().min(1),
  messages: z.array(z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant', 'system']),
    parts: z.array(z.unknown()),
  })).min(1),
})

export type ChatRequest = z.infer<typeof ChatRequestSchema>
```

shared/schemas/companion.ts

```typescript
import { z } from 'zod'

export const EmotionSchema = z.object({
  primary: z.enum(['happy', 'sad', 'angry', 'calm', 'neutral']),
  intensity: z.number().min(0).max(1),
})
export type Emotion = z.infer<typeof EmotionSchema>

export const MemorySchema = z.object({
  id: z.string(),
  content: z.string(),
  relevance: z.number(),
  tags: z.array(z.string()),
})
export type Memory = z.infer<typeof MemorySchema>
```

data part 的泛型类型：

shared/schemas/data-parts.ts

```typescript
import type { Emotion } from './companion'

export type CompanionDataParts = {
  emotion: Emotion
  'memories-used': { count: number }
}
```

这些 schema 前后端都 import。

## 4. 后端：Hono + AI SDK 主接口

### 4.1 入口

api/src/index.ts

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import chatRoute from './routes/chat'
import type { AppBindings } from './bindings'

const app = new Hono<AppBindings>()

app.use('*', cors({ origin: ['https://companion.yourdomain.com'] }))
app.route('/api', chatRoute)

export default app
```

### 4.2 /chat 路由

api/src/routes/chat.ts

```typescript
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { streamText, convertToModelMessages } from 'ai'
import { ChatRequestSchema } from '@shared/schemas/chat'
import { buildCompanionModel } from '../models'
import { buildCompanionTools } from '../tools'
import { buildSystemPrompt } from '@shared/prompts/companion'
import type { AppBindings } from '../bindings'

const chatRoute = new Hono<AppBindings>()

chatRoute.post('/chat', zValidator('json', ChatRequestSchema), async (c) => {
  const { sessionId, messages } = c.req.valid('json')

  // 1. 加载上下文
  const profile = await loadUserProfile(c.env.DB, sessionId)
  const memories = await searchMemories(c.env, sessionId, messages)

  // 2. 构造 system prompt
  const system = buildSystemPrompt({
    userNickname: profile.nickname,
    personalityTags: profile.tags,
    intimacy: profile.intimacy,
    recentEmotions: profile.recentEmotions,
    memories,
    currentTime: new Date().toISOString(),
  })

  // 3. 构造带中间件的 model
  const model = buildCompanionModel(c.env, sessionId, profile.userId)

  // 4. streamText 驱动
  const result = streamText({
    model,
    system,
    messages: convertToModelMessages(messages as any),
    tools: buildCompanionTools(c.env, sessionId),
    stopWhen: stepCountIs(5),
    abortSignal: c.req.raw.signal,

    experimental_telemetry: {
      isEnabled: true,
      functionId: 'companion-chat',
      metadata: {
        sessionId,
        userId: profile.userId,
        'prompt.version': 'companion@v1.3',
      },
    },

    onFinish: ({ text, usage }) => {
      c.executionCtx.waitUntil(
        Promise.all([
          saveAssistantMessage(c.env.DB, sessionId, text),
          updateIntimacy(c.env.DB, sessionId, usage),
          extractAndStoreMemories(c.env, sessionId, text),
        ]),
      )
    },

    onAbort: ({ steps }) => {
      c.executionCtx.waitUntil(
        saveAssistantMessage(c.env.DB, sessionId, {
          text: steps.map((s) => s.text).join(''),
          status: 'aborted',
        }),
      )
    },
  })

  return result.toUIMessageStreamResponse({
    // 往 UIMessage.metadata 注入业务数据
    messageMetadata: ({ part }) => {
      if (part.type === 'finish') {
        return {
          sessionId,
          intimacy: profile.intimacy,
        }
      }
    },
  })
})

export default chatRoute
```

### 4.3 tools

api/src/tools/search-memory.ts

```typescript
import { tool } from 'ai'
import { z } from 'zod'

export function searchMemoryTool(env: Env, sessionId: string) {
  return tool({
    description: '从长期记忆库检索相关回忆，每条包含内容、相似度和标签。',
    inputSchema: z.object({
      query: z.string().describe('检索关键词'),
      topK: z.number().int().min(1).max(10).default(3),
    }),
    execute: async ({ query, topK }, { abortSignal }) => {
      const embedding = await env.AI.run('@cf/baai/bge-m3', { text: [query] })
      const { matches } = await env.VECTORIZE.query(embedding.data[0], {
        topK,
        filter: { sessionId },
        returnMetadata: true,
      })
      return matches.map((m) => ({
        id: m.id,
        content: m.metadata?.content,
        relevance: m.score,
        tags: m.metadata?.tags ?? [],
      }))
    },
  })
}
```

api/src/tools/update-emotion.ts

```typescript
import { tool } from 'ai'
import { EmotionSchema } from '@shared/schemas/companion'

export function updateEmotionTool(env: Env, sessionId: string) {
  return tool({
    description: '记录用户当前情绪到数据库。',
    inputSchema: EmotionSchema,
    execute: async ({ primary, intensity }) => {
      await env.DB.prepare(
        'INSERT INTO emotion_logs (session_id, emotion, intensity, created_at) VALUES (?,?,?,?)',
      ).bind(sessionId, primary, intensity, Date.now()).run()
      return { success: true, emotion: primary }
    },
  })
}
```

api/src/tools/index.ts

```typescript
export function buildCompanionTools(env: Env, sessionId: string) {
  return {
    searchMemory: searchMemoryTool(env, sessionId),
    updateEmotion: updateEmotionTool(env, sessionId),
  }
}
```

### 4.4 带中间件的 model

api/src/models.ts

```typescript
import { wrapLanguageModel } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import { createOpenAI } from '@ai-sdk/openai'
import { rateLimitMiddleware } from './middleware/rate-limit'
import { fallbackMiddleware } from './middleware/fallback'

export function buildCompanionModel(env: Env, sessionId: string, userId: string) {
  const workersai = createWorkersAI({ binding: env.AI })
  const primary = workersai('@cf/meta/llama-3.3-70b-instruct-fp8-fast')

  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY })
  const fallback = openai('gpt-4o-mini')

  return wrapLanguageModel({
    model: primary,
    middleware: [
      rateLimitMiddleware({
        kv: env.KV,
        keyFn: () => userId,
        limit: 120,
        windowSec: 60,
      }),
      fallbackMiddleware(fallback),
    ],
  })
}
```

## 5. 前端：Next.js + useChat

### 5.1 页面

web/src/app/chat/page.tsx

```tsx
import { ChatClient } from '@/components/chat'

export default function ChatPage() {
  return (
    <main className="mx-auto max-w-180 py-8">
      <ChatClient />
    </main>
  )
}
```

### 5.2 Chat 组件

web/src/components/chat.tsx

```tsx
'use client'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useState } from 'react'
import { Message } from './message'
import type { CompanionDataParts } from '@shared/schemas/data-parts'
import type { UIMessage } from 'ai'

type CompanionMessage = UIMessage<{ sessionId: string; intimacy: number }, CompanionDataParts>

export function ChatClient() {
  const [input, setInput] = useState('')
  const sessionId = useSessionId()

  const { messages, sendMessage, status, stop, regenerate, error } =
    useChat<CompanionMessage>({
      transport: new DefaultChatTransport({
        api: '/api/chat',
        prepareSendMessagesRequest: ({ messages, id }) => ({
          body: { sessionId, messages },
        }),
      }),
    })

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {messages.map((m) => <Message key={m.id} message={m} />)}
      </ul>

      {status === 'streaming' && (
        <button onClick={stop} className="text-xs text-gray-500">
          停止生成
        </button>
      )}

      {error && (
        <div className="text-red-500">
          出错：{error.message}
          <button onClick={() => regenerate()} className="ml-2 underline">
            重试
          </button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!input.trim()) return
          sendMessage({ text: input })
          setInput('')
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="说点什么..."
          className="flex-1 rounded-md border px-3 py-2"
          disabled={status !== 'ready'}
        />
        <button
          type="submit"
          disabled={status !== 'ready'}
          className="rounded-md bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          发送
        </button>
      </form>
    </div>
  )
}
```

### 5.3 Message 组件（UI Parts 分发）

web/src/components/message.tsx

```tsx
import type { UIMessage } from 'ai'
import { TextPart } from './text-part'
import { ReasoningPart } from './reasoning-part'
import { MemoryCard } from './tool-parts/memory-card'
import { EmotionBadge } from './data-parts/emotion-badge'

export function Message({ message }: { message: UIMessage }) {
  return (
    <li className={`message message--${message.role}`}>
      <div className="role-label">{message.role === 'user' ? '你' : '小舟'}</div>
      <div className="body">
        {message.parts.map((p, i) => {
          if (p.type === 'text')      return <TextPart key={i} part={p} />
          if (p.type === 'reasoning') return <ReasoningPart key={i} part={p} />
          if (p.type === 'data-emotion')
            return <EmotionBadge key={i} data={p.data} />
          if (p.type === 'tool-searchMemory' && p.state === 'output-available')
            return <MemoryCard key={i} memories={p.output} />
          return null
        })}
      </div>
    </li>
  )
}
```

其他 part 组件按之前的模式实现，不一一展开。
