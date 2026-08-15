---
title: "107 可选、默认值与空值"
pubDate: 2026-05-15
description: "这一篇我们把这 5 个方法一次讲清，不是讲 API 名字，而是讲「数据缺失」的几种状态和对应的正确姿势。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/6-optional-and-default/](https://aicompanion.usehook.cn/6-optional-and-default/)

## 1. 为什么这几个长得像的方法值得单独一篇

Zod 里有一组修饰符新手最容易搞混：

index.ts

```typescript
z.string().optional()
z.string().nullable()
z.string().nullish()
z.string().default('anon')
z.string().catch('anon')
```

它们的长相差不多，名字也只差几个字母，但**语义完全不同**。

用错一个，你的 API 可能表现得很奇怪：

- 明明字段可以不传，实际却在报「Required」

- 明明设置了默认值，实际前端传了 `null` 之后默认值没生效

- 明明只是允许空，实际却把「失败兜底」也一起开了

这一篇我们把这 5 个方法一次讲清，**不是讲 API 名字，而是讲「数据缺失」的几种状态和对应的正确姿势**。

## 2. 先搞清楚 JS 里的三种「没值」

要理解这些方法，必须先区分 JS 里表示「没值」的三种状态：

| 状态 | 含义 | 典型来源 |
| --- | --- | --- |
| undefined | 字段不存在、没传、没赋值 | 可选参数、没传的字段 |
| null | 显式声明「这里没东西」 | 数据库空列、API 明确返回 null |
| 空字符串 / 0 | 有值，只是值是空的 | 用户清空了输入框 |

新手经常把这三种混成一种叫「空」的东西，但 Zod **严格区分它们**。

举例：

index.ts

```typescript
const schema = z.string()

schema.parse(undefined)  // 💥 Required
schema.parse(null)       // 💥 Expected string, received null
schema.parse('')         // ✅ 空字符串是合法 string
```

所以你必须先问自己：

NOTE

「我到底是要允许 `undefined`，允许 `null`，还是两个都允许？」

回答完这个问题，后面用哪个方法就水到渠成了。

## 3. .optional()：允许 undefined

`.optional()` 让一个 schema 接受 `undefined`：

index.ts

```typescript
const schema = z.string().optional()

schema.parse('hello')     // ✅
schema.parse(undefined)   // ✅
schema.parse(null)        // 💥 仍然拒绝 null
```

推导出的类型是 `string | undefined`：

index.ts

```typescript
type T = z.infer<typeof schema>  // string | undefined
```

### 3.1 在 object 里：字段可缺

`.optional()` 用得最多的地方是 object 的字段：

index.ts

```typescript
const UserSchema = z.object({
  name: z.string(),
  nickname: z.string().optional(),
})

UserSchema.parse({ name: 'Alice' })                          // ✅
UserSchema.parse({ name: 'Alice', nickname: 'a' })           // ✅
UserSchema.parse({ name: 'Alice', nickname: undefined })     // ✅
UserSchema.parse({ name: 'Alice', nickname: null })          // 💥
```

记住这句话：

NOTE

**`.optional()` 的真正含义是「这个字段允许不存在或显式为 undefined」，它跟 null 没关系。**

## 4. .nullable() 和 .nullish()

`.nullable()` 是 `.optional()` 的「null 版本」：

index.ts

```typescript
const schema = z.string().nullable()

schema.parse('hello')     // ✅
schema.parse(null)        // ✅
schema.parse(undefined)   // 💥 仍然拒绝 undefined
```

类型是 `string | null`。

`.nullish()` 则是两个都允许——它本质上等价于 `.nullable().optional()`：

index.ts

```typescript
const schema = z.string().nullish()

schema.parse('hello')     // ✅
schema.parse(null)        // ✅
schema.parse(undefined)   // ✅
```

类型是 `string | null | undefined`。

### 4.1 三者的正确选型

这个地方很多人凭感觉选，其实有一个非常清晰的判断标准——**看数据的来源**：

| 数据来源 | 推荐用 |
| --- | --- |
| 前端 JSON 请求体 | .optional()（JSON 里只会有 undefined 形式的缺省） |
| 数据库空值（SQL 的 NULL） | .nullable() |
| 同一字段两种来源都可能（比如 ORM 读出来） | .nullish() |
| LLM 返回的 JSON | .optional() 优先，除非模型经常返回显式 null |

记住一条铁律：

NOTE

**不要为了「保险起见」就用 `.nullish()` 全开。能缩小范围，就缩小范围。**

否则你会在后面的业务代码里被迫到处写 `if (x == null)` 这种**两种情况都要处理**的分支。

## 5. .default()：给 undefined 一个默认值

`.default()` 的行为是：**如果输入是 `undefined`，用你给的默认值替代。**

index.ts

```typescript
const schema = z.string().default('anon')

schema.parse('Alice')     // 'Alice'
schema.parse(undefined)   // 'anon'
schema.parse(null)        // 💥 null 不会触发默认值！
```

**它只处理 `undefined`，不处理 `null`。** 这是第一个大坑。

### 5.1 default 让类型变「干净」

`.default()` 的一个很爽的效果是：**输出类型里没有 undefined。**

index.ts

```typescript
const schema = z.string().default('anon')
type T = z.infer<typeof schema>
// string （不是 string | undefined）
```

虽然输入允许 `undefined`，但 parse 之后的数据一定是 `string`。这让下游代码不用再判空。

这一条在**环境变量校验**里特别好用：

env.ts

```typescript
const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TIMEOUT_MS: z.coerce.number().default(30000),
})

const env = EnvSchema.parse(process.env)
// env.PORT 类型是 number，不是 number | undefined
// env.LOG_LEVEL 类型是 'debug' | 'info' | 'warn' | 'error'
```

### 5.2 用函数形式：每次 parse 都计算

如果默认值需要**每次 parse 时重新计算**（比如当前时间、随机 ID），传一个函数：

index.ts

```typescript
const schema = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  createdAt: z.date().default(() => new Date()),
})
```

这里必须是**函数**，不是直接传 `crypto.randomUUID()`——后者会在 schema 创建时计算一次，之后所有 parse 都用同一个值。

### 5.3 .optional().default() 的顺序

index.ts

```typescript
// ✅ 正确：先 optional 接受 undefined，再用 default 替换
z.string().optional().default('anon')

// ✅ 更直接的写法
z.string().default('anon')

// ⚠️ 反过来：default 已经处理了 undefined，再套一层 optional 没意义
z.string().default('anon').optional()
```

最后一种写法不会报错，但逻辑上很怪：**`default` 已经把 `undefined` 填掉了，再叠一层 `optional` 相当于啥都没做**。遇到这种写法通常是写代码时手滑。

## 6. .catch()：校验失败时的兜底

`.catch()` 和 `.default()` 只差一个字，功能完全不同：

- `.default(v)` — 输入是 `undefined` 时用 `v`

- `.catch(v)` — **校验失败**时用 `v`

index.ts

```typescript
const schema = z.number().catch(0)

schema.parse(42)       // 42
schema.parse('nope')   // 0（失败兜底）
schema.parse(undefined)// 0（undefined 也算失败，也会走 catch）
```

`.catch()` 会**吞掉所有错误**，用兜底值顶上。它在两种场景里很有用：

- **宽松解析外部数据**（比如第三方 API 偶尔返回不规范字段）

- **配置加载**（一个配置项不合法不应该让整个服务挂掉）

但它也是**最危险的一个方法**——因为它会让数据错误悄无声息地被吃掉。用的时候请**务必加日志**：

index.ts

```typescript
const schema = z.number().catch(ctx => {
  console.warn('invalid number, using fallback', ctx.error.issues)
  return 0
})
```

### 6.1 default vs catch 的选型

| 你的意图 | 用哪个 |
| --- | --- |
| 字段可以不传，不传时给默认值 | .default() |
| 字段必须合法，否则拒绝整个请求 | 什么都不加 |
| 字段不合法时用兜底值继续跑 | .catch() + 日志 |

日常 90% 的场景用 `.default()`，只在**容错解析**的特殊场景才用 `.catch()`。

## 7. 实战：把这几个方法用对

我们把这些方法放在一个接近真实的例子里，加深印象。这是一个 LLM 聊天请求的 schema：

chat-schema.ts

```typescript
import { z } from 'zod'

const ChatRequestSchema = z.object({
  // 必填
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().min(1),
  })).min(1),

  // 可选 + 默认值：前端不传时用 server 默认
  model: z.string().default('claude-opus-4-6'),
  temperature: z.number().min(0).max(2).default(0.7),

  // 可选，不传就是不传
  userId: z.string().optional(),

  // 可能是 null 的业务字段（DB 读出来是 null，意味着「未设置」）
  systemPromptId: z.string().nullable().optional(),

  // 宽松解析：不合法时兜底为 4000
  maxTokens: z.number().int().positive().catch(4000),
})

type ChatRequest = z.infer<typeof ChatRequestSchema>
```

对应的 `ChatRequest` 类型会是这样：

index.ts

```typescript
type ChatRequest = {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  model: string                 // 有 default，类型干净
  temperature: number           // 有 default，类型干净
  userId?: string               // optional
  systemPromptId?: string | null // nullable + optional
  maxTokens: number             // catch 保证一定有值
}
```

你看，一份 schema 就把「必填 / 可选 / 有默认值 / 允许 null / 失败兜底」五种状态都表达得清清楚楚，而且**类型全部自动推导**。

## 8. 总结

这一篇的核心不是 API，而是**你必须在写 schema 时先想清楚字段的 5 种状态**：

| 字段状态 | 方法 |
| --- | --- |
| 必须有，必须合法 | 什么都不加 |
| 可以不传 | .optional() |
| 可以显式为 null | .nullable() |
| 两者都可以 | .nullish() |
| 不传时用默认值 | .default() |
| 不合法时用兜底值 | .catch() |

再总结成一个决策流程：

text

```text
这个字段必须要有吗？
├── 是 → 还会不合法吗？
│       ├── 不会 → 直接 z.xxx()
│       └── 会  → 加 .catch(v)
└── 否 → 不传时你想要什么？
        ├── 保持 undefined → .optional()
        ├── 用一个默认值  → .default(v)
        └── 允许 null     → .nullable() / .nullish()
```

一句话带走：

NOTE

**先想清楚数据有哪些「没值」的形式，再决定用哪个方法——顺序反了就会在类型和运行时之间来回拉扯。**

下一篇进入「联合与字面量」：`z.union`、`z.literal`、`z.enum` 和大杀器 `z.discriminatedUnion`，这是在 AI 项目里处理「多种形态消息」最常用的一组方法。
