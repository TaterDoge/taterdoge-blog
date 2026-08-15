---
title: "115 实战：端到端 AI Chat"
pubDate: 2026-05-17
description: "专栏最后一篇，我们把前面 13 篇学过的东西整合进一个完整可部署的 AI Chat demo。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/14-end-to-end-ai-chat/](https://aicompanion.usehook.cn/14-end-to-end-ai-chat/)

## 1. 实战目标：一条类型一以贯之的 AI Chat 链路

专栏最后一篇，我们把前面 13 篇学过的东西整合进一个**完整可部署的 AI Chat demo**。

这个 demo 要跑通的链路是这样的：

text

```text
前端表单
   │ z.input<ChatRequestSchema>
   ▼
Hono RPC Client（$post）
   │
   ▼
Hono API 入口
   │ validate('json', ChatRequestSchema)
   ▼
业务层：调 LLM
   │ Structured Output schema
   ▼
LLM 原始输出
   │ LLMJsonSchema(AIReplySchema).parse
   ▼
响应出口
   │ ChatResponseSchema.parse
   ▼
前端收到响应
   │ await res.json() 类型精确
```

**整条链路上，Zod schema 是唯一的真相源。** 一处改动，其他地方全部同步。

目录结构我们按 monorepo 组织：

text

```text
packages/
├── shared/src/schemas/
│   ├── chat.ts         ← 本篇重点
│   ├── analysis.ts
│   └── common.ts
├── server/
│   ├── lib/validator.ts
│   ├── lib/llm.ts
│   └── routes/chat.ts
└── web/
    ├── api.ts
    └── chat-form.tsx
```

下面我们一块一块搭起来。

## 2. 第一步：定义共享 schema

所有 schema 放在 `packages/shared/src/schemas/`，前后端共用。这是整个项目的**契约层**。

packages/shared/src/schemas/common.ts

```typescript
import { z } from 'zod'

export const ApiErrorSchema = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string().optional(),
  errors: z.array(z.object({
    field: z.string(),
    message: z.string(),
  })).optional(),
})

export const ApiOkSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    ok: z.literal(true),
    data,
  })
```

packages/shared/src/schemas/chat.ts

```typescript
import { z } from 'zod'
import { ApiOkSchema } from './common'

// ========== 消息 ==========
export const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1).max(8000),
})

// ========== 请求 ==========
export const ChatRequestSchema = z.object({
  model: z.enum(['claude-opus-4-6', 'claude-haiku-4-5']).default('claude-opus-4-6'),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.coerce.number().int().positive().max(8000).default(2048),
  messages: z.array(MessageSchema).min(1).max(30),
}).refine(
  data => {
    const first = data.messages[0].role
    return first === 'system' || first === 'user'
  },
  { message: '对话必须以 system 或 user 消息开头', path: ['messages', 0] }
)

export type ChatRequest = z.infer<typeof ChatRequestSchema>
export type ChatRequestInput = z.input<typeof ChatRequestSchema>

// ========== LLM 结构化输出的骨架 ==========
export const AIReplySchema = z.object({
  content: z.string().min(1).describe('要回复用户的正文'),
  topics: z.array(z.string().min(1).max(30)).max(5).describe('本次回答涉及的 1~5 个主题'),
  sentiment: z.enum(['warm', 'neutral', 'cautious']).describe('回答的语气倾向'),
})
export type AIReply = z.infer<typeof AIReplySchema>

// ========== 响应 ==========
export const ChatResponseSchema = ApiOkSchema(z.object({
  id: z.string(),
  model: z.string(),
  reply: AIReplySchema,
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
}))
export type ChatResponse = z.infer<typeof ChatResponseSchema>
```

这里一份 schema 吃的角色就很多了：

- `ChatRequestSchema` — 前端表单校验 + 后端入口校验 + Hono RPC 客户端入参类型

- `AIReplySchema` — 喂给 LLM 的 Structured Output 指令 + 解析 LLM 输出

- `ChatResponseSchema` — 后端出口校验 + 前端收到响应后再校验

## 3. 第二步：Hono 的通用工具

校验封装 + LLM 工具抽出来，避免每个路由重写一遍。

packages/server/lib/validator.ts

```typescript
import { zValidator as zv } from '@hono/zod-validator'
import type { ZodSchema } from 'zod'
import type { ValidationTargets } from 'hono'

export const validate = <T extends ZodSchema>(
  target: keyof ValidationTargets,
  schema: T,
) => zv(target, schema, (result, c) => {
  if (!result.success) {
    return c.json({
      ok: false as const,
      code: 'VALIDATION_ERROR',
      errors: result.error.issues.map(i => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    }, 400)
  }
})
```

packages/server/lib/llm.ts

```typescript
import { z } from 'zod'

// 第 13 篇讲过的脏输出防御层
const stripFence = (s: string) =>
  s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

const extractJson = (s: string) => {
  const cleaned = stripFence(s)
  const first = cleaned.indexOf('{')
  const last  = cleaned.lastIndexOf('}')
  if (first === -1 || last === -1) throw new Error('no JSON object found')
  return cleaned.slice(first, last + 1)
}

export const LLMJsonSchema = <T extends z.ZodTypeAny>(shape: T) =>
  z.string()
    .transform(extractJson)
    .transform(s => JSON.parse(s))
    .pipe(shape)
```

## 4. 第三步：Hono 路由（核心业务）

这是整个链路的心脏。**每一次数据跨边界，我们都让它过一次 schema**。

packages/server/routes/chat.ts

```typescript
import { Hono } from 'hono'
import Anthropic from '@anthropic-ai/sdk'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { validate } from '../lib/validator'
import { LLMJsonSchema } from '../lib/llm'
import {
  ChatRequestSchema,
  ChatResponseSchema,
  AIReplySchema,
} from '@shared/schemas/chat'

const client = new Anthropic()

export const chat = new Hono()
  .post('/chat',
    validate('json', ChatRequestSchema),
    async (c) => {
      const req = c.req.valid('json')
      // 到这一行，req 的类型是 ChatRequest（output），字段都已经填好默认值

      // 构造一个「告诉模型按结构化 JSON 返回」的 system 提示
      const schemaHint = JSON.stringify(zodToJsonSchema(AIReplySchema), null, 2)
      const systemHint = `你必须以下面这个 JSON Schema 格式返回，不要说任何其他话：\n${schemaHint}`

      const msg = await client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        system: systemHint,
        messages: req.messages.map(m => ({
          role: m.role === 'system' ? 'user' : m.role,
          content: m.content,
        })),
      })

      const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : ''

      // 用「脏输出防御层 + 严格 schema」解析模型输出
      const parseResult = LLMJsonSchema(AIReplySchema).safeParse(raw)
      if (!parseResult.success) {
        console.error('[llm] invalid output', {
          raw,
          issues: parseResult.error.issues,
          model: req.model,
        })
        return c.json({
          ok: false as const,
          code: 'LLM_OUTPUT_INVALID',
          message: '模型返回格式不符合预期',
        }, 502)
      }

      // 构造最终响应，再走一次出口校验
      return c.json(ChatResponseSchema.parse({
        ok: true,
        data: {
          id: msg.id,
          model: msg.model,
          reply: parseResult.data,
          usage: {
            inputTokens:  msg.usage.input_tokens,
            outputTokens: msg.usage.output_tokens,
          },
        },
      }))
    }
  )
```

细数一下这段代码里 Zod 做了多少事：

- `validate('json', ChatRequestSchema)` — 入口校验

- `zodToJsonSchema(AIReplySchema)` — 把同一份 schema 转成 prompt 里的指令

- `LLMJsonSchema(AIReplySchema).safeParse(raw)` — 脏输出防御 + 严格 schema

- `ChatResponseSchema.parse(...)` — 出口校验，保证给前端的响应合法

**整个业务函数里没有任何手写的 `if (x == null)` 或 `as any`**——所有「守门员」工作都被 Zod 接走了。

## 5. 第四步：导出 AppType 给前端

前端要拿到类型，必须能导入整个 app 的类型。

packages/server/app.ts

```typescript
import { Hono } from 'hono'
import { chat } from './routes/chat'

const app = new Hono()
  .route('/api', chat)

// 关键：把 app 的类型导出，供前端 hc<AppType> 用
export type AppType = typeof app
export default app
```

monorepo 里建议建一个单独的包 `packages/server-types`，只 re-export 这个类型，避免前端把 server 整个依赖拉进 bundle：

packages/server-types/index.ts

```typescript
export type { AppType } from '@server/app'
```

## 6. 第五步：前端 API 客户端 + 表单

前端有两种用到 schema 的地方：**调接口** 和 **校验表单**。

### 6.1 RPC 客户端

packages/web/api.ts

```typescript
import { hc } from 'hono/client'
import type { AppType } from '@server-types'
import { ChatResponseSchema } from '@shared/schemas/chat'
import type { ChatRequestInput } from '@shared/schemas/chat'

const client = hc<AppType>(import.meta.env.VITE_API_URL)

export async function chat(req: ChatRequestInput) {
  const res = await client.api.chat.$post({ json: req })
  const raw = await res.json()
  // 响应也走一次 schema——防御后端偷改字段
  return ChatResponseSchema.parse(raw)
}
```

这里有两个关键点：

- `req: ChatRequestInput` — 用 `z.input`，前端可以省略默认字段（`model` / `temperature` / `maxTokens`）

- `ChatResponseSchema.parse(raw)` — 前端**也做一次校验**，任何一方偷改 schema 都会在开发期就被抓到

### 6.2 React 表单

packages/web/chat-form.tsx

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ChatRequestSchema, type ChatRequestInput } from '@shared/schemas/chat'
import { chat } from './api'

export function ChatForm() {
  const form = useForm<ChatRequestInput>({
    resolver: zodResolver(ChatRequestSchema),
    defaultValues: {
      messages: [{ role: 'user', content: '' }],
    },
  })

  const onSubmit = async (data: ChatRequestInput) => {
    const res = await chat(data)
    if (res.ok) {
      console.log('AI reply:', res.data.reply.content)
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <textarea {...form.register('messages.0.content')} />
      <button type="submit">发送</button>
      {form.formState.errors.messages?.[0]?.content && (
        <p>{form.formState.errors.messages[0].content?.message}</p>
      )}
    </form>
  )
}
```

前后端的校验规则**一字不差**——因为它们共用 `ChatRequestSchema`。你要调整 `content` 长度上限？改 `ChatRequestSchema` 一个地方，前端表单提示 + 后端校验 + OpenAPI 文档**同步生效**。

## 7. 改动一处，全链路跟上

给你一个让老板也能看懂的演示，感受一下 SSOT 的威力——假设产品经理说：

NOTE

「把 `maxTokens` 的上限从 8000 改成 4000。」

你唯一要改的地方是 `packages/shared/src/schemas/chat.ts` 里一行：

index.ts

```typescript
maxTokens: z.coerce.number().int().positive().max(4000).default(2048),
//                                          ^^^^ 改这里
```

保存之后发生的事：

- **前端 `chat-form.tsx` 里传大于 4000 的值** → `zodResolver` 立刻报错

- **前端调 `chat(req)` 传大于 4000** → TypeScript 层不会报错（因为类型是 `number`），但提交后会被后端 400 拒绝

- **后端 `validate('json', ChatRequestSchema)`** → 返回 400 VALIDATION_ERROR，带精确字段路径

- **OpenAPI 文档（如果用 `@hono/zod-openapi`）** → 自动同步上限为 4000

- **所有调用 `api.chat.$post` 的前端代码** → 没有触发类型错误，但运行时被保护

**代码仓库里没有一处遗漏。** 这就是专栏从第 2 篇讲到第 14 篇、重复最多次的一条原则——单一真实来源（SSOT）——在真实代码里完整落地的样子。

## 8. 总结

整个专栏到这里结束。这一篇不是「又学一个新能力」，而是**把前 13 篇学到的所有能力放进一条真实可跑的链路**，验证它们加在一起到底能产生多大的工程价值。

一张收官全景图：

| 层 | Zod 做的事 | 引用的章节 |
| --- | --- | --- |
| 共享 schema 模块 | 定义真相源、导出 input/output | 第 10、11 篇 |
| 前端表单 | zodResolver 校验用户输入 | 第 12 篇 |
| 前端 API 客户端 | 导入 XxxInput 类型 + 响应再校验 | 第 10、12 篇 |
| Hono 路由入口 | validate('json'/'query'/'param', ...) | 第 12 篇 |
| 业务层 | 不重复校验，信任入口 | — |
| LLM 工具参数 | zodToJsonSchema + schema.describe | 第 13 篇 |
| LLM 输出解析 | LLMJsonSchema(shape).safeParse | 第 9、13 篇 |
| Hono 路由出口 | XxxResponseSchema.parse | 第 11、12 篇 |
| 错误处理 | validate 统一格式 + app.onError 兼 ZodError | 第 12 篇 |
| 文档生成 | zodToJsonSchema / @hono/zod-openapi | 第 2、13 篇 |

如果要用一句话总结整个 Zod 章节：

NOTE

**Zod 的价值不在任何一个 API，而在于它让你用一份 schema，贯穿表单、请求、响应、LLM、文档——让一个真实项目的所有类型契约，收敛成一个文件夹里的几个 `.ts`。**

你从第 1 篇开始读到这里，现在已经完整掌握：

- ✅ 写任意复杂度的业务 schema

- ✅ 跨字段校验和数据变换

- ✅ 从 schema 设计到类型推导

- ✅ 派生一整套相关 schema

- ✅ 在真实 Hono API 里全链路使用

- ✅ 驯服 LLM 的脏输出

- ✅ 打通前后端类型链路

祝你在你自己的 AI 项目里用得顺手。
