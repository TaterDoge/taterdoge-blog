---
title: "111 类型推导"
pubDate: 2026-05-16
description: "一个 Zod schema 本质上是一个 input → output 的函数。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/10-infer-and-input-output/](https://aicompanion.usehook.cn/10-infer-and-input-output/)

## 1. 承接上一篇：schema 其实是一个函数

上一篇末尾提到一个很重要的观念：

NOTE

**一个 Zod schema 本质上是一个 `input → output` 的函数。**

这不是比喻，是字面意义上的函数。

index.ts

```typescript
const schema = z.string().transform(s => s.length)

// 你传进去的是 string，拿出来的是 number
schema.parse('hello')  // 5

// 等价于一个函数：
// (input: string) => number
```

一旦你把 schema 当成函数去想，就很容易理解 Zod 的三个类型工具为什么要拆成三个：

index.ts

```typescript
z.input<typeof schema>    // 函数的参数类型（parse 之前）
z.output<typeof schema>   // 函数的返回类型（parse 之后）
z.infer<typeof schema>    // z.output 的别名（日常用这个）
```

这一篇我们就把这三个工具的关系彻底讲透，并给出在真实项目里的最佳导出和使用模式。**读完这一篇，你从「能写 schema」正式推进到「能设计 schema 架构」。**

## 2. z.infer / z.output / z.input 的关系

这三者的关系一句话就能说清：

text

```text
z.infer<T>  ===  z.output<T>

           input                 output
input ─→ ┌─────────┐  校验/变形  ┌─────────┐
         │ z.input │ ─────────→ │ z.output│
         └─────────┘            └─────────┘
                                = z.infer
```

在**绝大多数「普通 schema」** 里，input 和 output 是一样的：

index.ts

```typescript
const A = z.string()

type AIn  = z.input<typeof A>   // string
type AOut = z.output<typeof A>  // string
type AI   = z.infer<typeof A>   // string
```

所以日常 90% 的场景你只用 `z.infer`，根本不会意识到还有另外两个类型工具。但**只要 schema 里出现了某些「异步换型」的方法**，这两个类型就会立刻分叉。

## 3. 什么时候 input 和 output 会不一样

一张清单，把 Zod 里会让 input ≠ output 的方法全部列出来：

| 方法 | input 类型 | output 类型 |
| --- | --- | --- |
| .default(v) | T \| undefined | T |
| .catch(v) | unknown | T |
| .transform(fn) | T | 函数返回类型 |
| .preprocess(fn, schema) | unknown | schema 的 output |
| z.coerce.* | unknown | 目标类型 |
| .pipe(next) | 上一段的 input | 下一段的 output |

看几个具体例子：

index.ts

```typescript
const A = z.string().default('anon')
// input:  string | undefined
// output: string

const B = z.coerce.number()
// input:  unknown
// output: number

const C = z.string().transform(s => s.split(','))
// input:  string
// output: string[]

const D = z.preprocess(
  v => JSON.parse(v as string),
  z.array(z.string())
)
// input:  unknown
// output: string[]
```

一旦你看到 schema 里用了上面表格里的方法，就要警觉：**不要再无脑用 `z.infer`**，先想清楚你现在拿到的是 input 还是 output。

## 4. 接口场景的经典用法

最容易混淆这两个类型的场景，是**定义 API 请求体**。

看一个非常典型的聊天接口 schema：

chat-schema.ts

```typescript
import { z } from 'zod'

export const ChatRequestSchema = z.object({
  model: z.string().default('claude-opus-4-6'),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.coerce.number().int().positive().default(4000),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  })).min(1),
})
```

这份 schema 里既有 `.default()` 又有 `z.coerce.*`，input 和 output 会**完全不一样**：

index.ts

```typescript
type ChatRequestIn  = z.input<typeof ChatRequestSchema>
// {
//   model?: string | undefined
//   temperature?: number | undefined
//   maxTokens?: unknown
//   messages: { role: ...; content: string }[]
// }

type ChatRequestOut = z.output<typeof ChatRequestSchema>
// {
//   model: string
//   temperature: number
//   maxTokens: number
//   messages: { role: ...; content: string }[]
// }
```

注意它们的语义完全不同：

- **`ChatRequestIn`** 描述的是「**前端 HTTP 请求能发的 JSON 结构**」——可以省略 `model`、可以把 `maxTokens` 写成字符串

- **`ChatRequestOut`** 描述的是「**后端 handler 拿到的成熟对象**」——已经填了默认值，已经 coerce 成数字

所以两端用的类型不该是同一个：

server.ts

```typescript
// 后端 handler：拿到的是 parse 之后的数据
app.post('/chat', async (c) => {
  const data: ChatRequestOut = ChatRequestSchema.parse(await c.req.json())
  // data.model 一定是 string，data.maxTokens 一定是 number
})
```

client.ts

```typescript
// 前端调用方：构造 HTTP 请求体时允许省略、允许字符串
async function chat(req: ChatRequestIn) {
  await fetch('/chat', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

chat({
  messages: [{ role: 'user', content: '你好' }],
  // model / temperature / maxTokens 都可以不传
})
```

这是 Zod 在全栈项目里**端到端类型安全**的基础模式。

### 4.1 为什么不能反过来用

很多新手的第一反应是「统一用 `z.infer` 就完了」。我们看看反过来会发生什么：

client.ts

```typescript
// ❌ 前端用 output 类型
async function chat(req: ChatRequestOut) {
  // 这里要求 req.model / temperature / maxTokens 必填
  // 但它们本来是有默认值的，前端根本不该被强制传
}
```

反过来也一样不行：

server.ts

```typescript
// ❌ 后端用 input 类型
app.post('/chat', async (c) => {
  const data: ChatRequestIn = ChatRequestSchema.parse(await c.req.json())
  // parse 明明已经填了默认值，但 TS 还以为 model 可能是 undefined
  data.model.toUpperCase()  // ❌ TS 报错：model 可能是 undefined
})
```

**type 不对不会导致运行时 bug，但会逼你写大量无意义的 `?.` 或非空断言**，最后代码丑得一塌糊涂。

## 5. 导出 schema 还是导出类型：项目里的最佳实践

写一个公用 schema 模块时，应该导出什么？这里是专栏推荐的标准模式。

schemas/chat.ts

```typescript
import { z } from 'zod'

// 1. 导出 schema 本身（运行时校验、其他 schema 复用）
export const ChatRequestSchema = z.object({
  model: z.string().default('claude-opus-4-6'),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  })).min(1),
})

// 2. 导出给「业务内部」用的类型（= output）
export type ChatRequest = z.infer<typeof ChatRequestSchema>

// 3. 导出给「外部调用方」用的类型（= input）
export type ChatRequestInput = z.input<typeof ChatRequestSchema>
```

命名惯例：

| 导出 | 命名 | 给谁用 |
| --- | --- | --- |
| schema | XxxSchema | 要做 parse / 要在其他 schema 复用 |
| output 类型 | Xxx | 后端 handler、内部业务逻辑 |
| input 类型 | XxxInput | 前端 API 调用、请求构造器 |

### 5.1 什么时候可以只导出一个类型

如果 schema 里**没有任何** default / transform / coerce / catch / preprocess / pipe，那 input 和 output 是一样的，只导 `Xxx` 就够了。简单 schema 不用硬拆两个类型。

### 5.2 schema 也应该导出

新手常见的反模式是**只导出类型不导出 schema**：

index.ts

```typescript
// ❌ 只导类型
export type ChatRequest = z.infer<typeof ChatRequestSchema>
// ChatRequestSchema 是文件内私有
```

这样其他模块就没法做 `parse` 了——它们只有「编译时的类型」，没有「运行时的 schema」。**Zod 的价值就在于 schema 本身可以被别处复用**（校验、派生子 schema、生成文档）。不导它等于浪费一半能力。

## 6. 从已有 TS 类型反向对齐 schema

有时候你的 schema 需要**严格匹配一个已经存在的 TS 类型**——比如你在实现一个已有接口的客户端，接口类型来自第三方 `.d.ts`。

这时可以用 `z.ZodType<T>` 做反向约束：

index.ts

```typescript
import type { User } from 'third-party/types'

// TS 会检查这份 schema 的 output 类型是否匹配 User
const UserSchema: z.ZodType<User> = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
})

// 如果漏了字段，TS 会直接报错
```

这个用法不常见，但在下面几个场景里会救命：

- 第三方库的类型契约必须满足

- 前后端 **共享的 TS 类型定义** 来自独立 SDK

- 从一个已有类型**反向**生成校验规则

更精细的版本 `z.ZodType<Output, Def, Input>` 可以约束三者，但日常用不到——一旦你走到这一步，通常意味着你该重新思考 schema 才是类型的源头（SSOT）。

## 7. 实战：一个类型安全的全栈 schema 模块

把这一篇所有概念放到一个真实可用的模块里：

packages/shared/src/schemas/chat.ts

```typescript
import { z } from 'zod'

// ========== 子 schema ==========
const RoleSchema = z.enum(['system', 'user', 'assistant', 'tool'])
const MessageSchema = z.object({
  role: RoleSchema,
  content: z.string().min(1),
})

// ========== 请求 ==========
export const ChatRequestSchema = z.object({
  model: z.string().default('claude-opus-4-6'),
  temperature: z.number().min(0).max(2).default(0.7),
  messages: z.array(MessageSchema).min(1),
  stream: z.coerce.boolean().default(false),
})

export type ChatRequest = z.infer<typeof ChatRequestSchema>
export type ChatRequestInput = z.input<typeof ChatRequestSchema>

// ========== 响应 ==========
export const ChatResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  message: MessageSchema,
  usage: z.object({
    promptTokens: z.number(),
    completionTokens: z.number(),
  }),
})

export type ChatResponse = z.infer<typeof ChatResponseSchema>
```

**后端（Hono handler）用 output 类型：**

server/chat.ts

```typescript
import { ChatRequestSchema, type ChatResponse } from '@shared/schemas/chat'

app.post('/chat', async (c) => {
  const req = ChatRequestSchema.parse(await c.req.json())
  // req 的类型是 ChatRequest（output），字段都是填好的
  const resp: ChatResponse = await callLLM(req)
  return c.json(resp)
})
```

**前端（API client）用 input 类型：**

client/chat.ts

```typescript
import type { ChatRequestInput, ChatResponse } from '@shared/schemas/chat'
import { ChatResponseSchema } from '@shared/schemas/chat'

export async function chat(req: ChatRequestInput): Promise<ChatResponse> {
  const r = await fetch('/chat', {
    method: 'POST',
    body: JSON.stringify(req),
  })
  // 响应也用 schema 校验一下，防止后端改字段
  return ChatResponseSchema.parse(await r.json())
}

// 用法：前端只需要传必填字段
chat({
  messages: [{ role: 'user', content: '你好' }],
})
```

这就是一个**端到端类型安全**的最小闭环：

- 一份 schema 做单一真实来源

- 前端导入 input 类型，不会被默认值和 coerce 干扰

- 后端导入 output 类型，拿到的数据已经成熟

- 前端用同一份 schema 校验响应，防止后端偷改字段

- 修改 schema 时，前后端会**同步报错**——这是你最想看到的提醒

真实的 monorepo 里，把这份 schema 放到一个共享包（如 `packages/shared`）中，全站类型一致，一劳永逸。

## 8. 总结

这一篇把 Zod 的三个类型工具讲全了：

- **`z.infer<T>`** — 最常用，等价于 `z.output<T>`，给业务内部用

- **`z.output<T>`** — parse 之后的成熟形态，给 handler / 业务层用

- **`z.input<T>`** — parse 之前的原始形态，给客户端、表单、API 调用方用

一个必须记住的识别信号：

NOTE

**只要 schema 里出现了 `.default() / .transform() / .preprocess() / .coerce() / .catch() / .pipe()`，就要立刻想起：input 和 output 不一样了。**

一张专栏级别的最佳实践：

| 工作任务 | 应该用的类型 |
| --- | --- |
| 在后端 handler 里拿 parse 结果 | z.infer / z.output |
| 前端构造 HTTP 请求体 | z.input |
| 定义前端表单值类型（带默认值） | z.input |
| 把 schema 导出给别的模块复用 | 导出 schema 本身（不是只导类型） |

整个进阶篇到这里全部结束。如果你从第 1 篇读到这里，你现在已经具备：

- 写任意复杂度的业务 schema（object + array + discriminatedUnion）

- 表达跨字段规则（refine / superRefine）

- 进行数据变换（transform / preprocess / pipe）

- 设计端到端类型安全的架构（input / output 的分工）

下一篇进入**组织篇**——一份大的主 schema 往往不会独立存在，它会被 `.pick / .omit / .partial / .extend / .merge` 派生出一堆相关 schema。如何组织这些派生关系，是大项目里的核心问题。
