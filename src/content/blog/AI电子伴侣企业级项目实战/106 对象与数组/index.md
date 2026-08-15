---
title: "106 对象与数组"
pubDate: 2026-05-15
description: "基础类型学完之后，你并不会急着写 z.string 独立校验一个字段——因为真实项目里几乎不存在「只有一个字段」的数据结构。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/5-object-and-array/](https://aicompanion.usehook.cn/5-object-and-array/)

## 1. object 和 array 为什么最重要

基础类型学完之后，你并不会急着写 `z.string()` 独立校验一个字段——因为真实项目里几乎不存在「只有一个字段」的数据结构。

真实数据长什么样？随便翻一个 AI 聊天接口就能看到：

index.json

```json
{
  "model": "claude-opus-4-6",
  "temperature": 0.7,
  "messages": [
    { "role": "user", "content": "你好" },
    { "role": "assistant", "content": "你好，请问有什么可以帮你？" }
  ]
}
```

这段数据由两个结构撑起来：

- **`z.object()`** — 把一堆字段打包成对象

- **`z.array()`** — 把同一类东西变成一个列表

真实项目里 80% 以上的 schema 都是这两个的组合。把它们吃透，你后面写任何复杂结构都只是排列组合。

## 2. z.object()：你写得最多的 schema

`z.object()` 接收一个对象字面量，key 是字段名，value 是对应字段的 schema：

index.ts

```typescript
import { z } from 'zod'

const UserSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().min(0),
  email: z.string().email(),
})
```

这份 schema 要求校验对象**必须**包含 `name / age / email` 三个字段，且每个字段都满足对应规则。

### 2.1 访问字段 schema：.shape

有时候你会想从 object schema 里把某个字段的 schema 单独拿出来复用：

index.ts

```typescript
const EmailSchema = UserSchema.shape.email
// 等价于：z.string().email()

EmailSchema.parse('alice@example.com')
```

`.shape` 是一个对象，key 是字段名，value 是该字段的 schema。写大型项目时你会经常用到。

### 2.2 把 key 拿出来做枚举：.keyof()

index.ts

```typescript
const UserKey = UserSchema.keyof()
// z.enum(['name', 'age', 'email'])

UserKey.parse('name')   // ✅
UserKey.parse('foo')    // 💥
```

这个方法在做「按字段排序」「按字段筛选」这类接口时特别顺手——你永远不需要手写一份 key 的枚举。

## 3. object 的默认行为：未知字段会被悄悄丢掉

这是新手最容易误会的一点，单独开一节讲清楚。

Zod 的 object 有**三种**处理未知字段的模式：

| 模式 | 未知字段的行为 | 怎么开 |
| --- | --- | --- |
| strip（默认） | 悄悄丢掉 | 不需要，这是默认行为 |
| strict | 报错 | .strict() |
| passthrough | 原样保留 | .passthrough() |

来看具体区别：

index.ts

```typescript
const schema = z.object({ name: z.string() })

// strip（默认）：foo 被默默丢掉
schema.parse({ name: 'Alice', foo: 123 })
// { name: 'Alice' }

// strict：foo 会让整个校验失败
z.object({ name: z.string() })
  .strict()
  .parse({ name: 'Alice', foo: 123 })
// 💥 Unrecognized key(s) in object: 'foo'

// passthrough：foo 原样保留
z.object({ name: z.string() })
  .passthrough()
  .parse({ name: 'Alice', foo: 123 })
// { name: 'Alice', foo: 123 }
```

### 3.1 什么时候选哪个

| 场景 | 建议 |
| --- | --- |
| 接外部 API / LLM 输出 | strip（默认），多出来的字段忽略掉就行 |
| 严格契约接口（版本化 API） | .strict()，多余字段提示客户端用错 |
| 透传中间层（网关、转发服务） | .passthrough()，不懂的字段也别丢 |

默认的 `strip` 行为对大多数场景是合理的，但请**务必知道它是 strip**——否则你会在日志里找不到被丢掉的字段，然后花一下午怀疑人生。

### 3.2 进阶：.catchall()

对未知字段还想做统一校验时，用 `.catchall()`：

index.ts

```typescript
const Flexible = z.object({
  name: z.string(),
}).catchall(z.number())

Flexible.parse({ name: 'Alice', age: 18, score: 90 })
// ✅ 除了 name 之外，所有未知字段都必须是 number
```

这个方法不常用，但在某些「已知字段 + 任意动态字段」的场景里（比如特性开关配置、A/B 测试参数）偶尔会救命。

## 4. z.array()：数组校验

`z.array()` 接收一个 schema 作为元素类型：

index.ts

```typescript
const Tags = z.array(z.string())

Tags.parse(['ai', 'zod', 'hono'])  // ✅
Tags.parse([1, 2, 3])              // 💥
Tags.parse([])                     // ✅ 空数组是允许的
```

注意最后一条——**空数组默认是合法的**。要禁止空数组，有两种写法：

index.ts

```typescript
z.array(z.string()).min(1)
z.array(z.string()).nonempty()
```

两者校验效果一样，但推导出的 TS 类型**有区别**：

index.ts

```typescript
const SchemaA = z.array(z.string()).min(1)
type A = z.infer<typeof SchemaA>
// string[]

const SchemaB = z.array(z.string()).nonempty()
type B = z.infer<typeof SchemaB>
// [string, ...string[]]  ← 元组形式，类型更精确
```

推荐：**只在真的需要「至少一个」作为类型保证时用 `.nonempty()`**，其他时候用 `.min(1)` 就够。

### 4.1 常用方法

index.ts

```typescript
z.array(z.string()).min(1)       // 至少 1 个
z.array(z.string()).max(10)      // 最多 10 个
z.array(z.string()).length(3)    // 正好 3 个
z.array(z.string()).nonempty()   // 非空（元组类型）
```

### 4.2 访问元素 schema：.element

类似 object 的 `.shape`，array 有 `.element`：

index.ts

```typescript
const TagSchema = Tags.element  // z.string()
```

在拆大 schema、做递归定义时会用到。

## 5. 嵌套：真实世界的数据结构

真实项目里没有「扁平」的 schema。我们用一个 **AI 聊天请求** 把 object + array 串起来：

chat-schema.ts

```typescript
import { z } from 'zod'

// 单条消息
const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1),
})

// 一次完整的请求
const ChatRequestSchema = z.object({
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  messages: z.array(MessageSchema).min(1),
})

type ChatRequest = z.infer<typeof ChatRequestSchema>
```

这个 schema 能正确校验下面这个对象：

index.json

```json
{
  "model": "claude-opus-4-6",
  "temperature": 0.7,
  "messages": [
    { "role": "user", "content": "你好" }
  ]
}
```

几个值得注意的点：

- `MessageSchema` 是独立定义的——**这就是可复用 schema 的起点**

- `messages: z.array(MessageSchema)` 表示「一个数组，里面每个元素都要符合 MessageSchema」

- `z.enum([...])` 给 `role` 限制了取值范围（下一篇会讲联合与字面量）

- 整份 schema 的 TS 类型可以直接 `z.infer`，不用手写

### 5.1 再深一层：工具调用

AI 场景里经常还会有「消息里带工具调用」的结构：

chat-schema.ts

```typescript
const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),  // key 是字符串，value 任意
})

const AssistantMessage = z.object({
  role: z.literal('assistant'),
  content: z.string().nullable(),
  toolCalls: z.array(ToolCallSchema).optional(),
})
```

这里出现了 `z.record()`——它表示「对象，key 是字符串，value 符合某个 schema」。你可以把它想成 `Record<string, T>` 的运行时版本。

你会发现**复杂 schema 的本质就是这些构造器的层层嵌套**。认得出每一层是什么，就不会被吓到。

## 6. 常用的 object 变形方法（预览）

object schema 还带了一组**变形方法**，能从一份 schema 派生出一堆相关 schema。这是第 11 篇的主题，这里先给个全景：

| 方法 | 作用 | 典型用法 |
| --- | --- | --- |
| .extend({...}) | 增加字段 | 创建扩展类型 |
| .merge(other) | 合并两个 object | 组合多个小 schema |
| .partial() | 所有字段变可选 | PATCH 接口的请求体 |
| .required() | 所有字段变必填 | 从宽松 schema 派生严格版 |
| .pick({ name: true }) | 只保留指定字段 | 只返回一部分字段的接口 |
| .omit({ password: true }) | 去掉指定字段 | 隐藏敏感字段 |
| .deepPartial() | 递归把嵌套字段也变可选 | 复杂对象的 PATCH |

小小示范一下最常用的 `.pick` 和 `.omit`：

index.ts

```typescript
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  password: z.string(),
})

// 对外返回的 User（不带 password）
const PublicUser = UserSchema.omit({ password: true })

// 登录接口的请求体（只要 email + password）
const LoginBody = UserSchema.pick({ email: true, password: true })
```

看到这里你应该能感受到：**一份主 schema 可以派生出接口、响应、表单、PATCH 请求等等一整套结构**，不需要反复手写。这正是上一篇讲的 SSOT 原则在实战里的体现。

## 7. 常见陷阱清单

| 场景 | 错误预期 | 实际行为 |
| --- | --- | --- |
| 请求带了未声明的字段 | 会报错 | 默认悄悄丢掉（strip） |
| 传进来空数组 | 会报错 | 默认合法，要手动加 .min(1) |
| .partial() 后嵌套对象也变可选 | 会递归 | 不会，要用 .deepPartial() |
| 用 z.array(z.string()).min(1) | 类型是元组 | 是 string[]，需要 .nonempty() 才是元组 |
| 给 object 加 .optional() | 字段变可选 | 是整个对象变可选，不是字段 |
| 用 z.record(z.string()) | key 也被校验 | 只校验 value，key 始终是 string |

特别解释一下倒数第二条：

index.ts

```typescript
const A = z.object({ name: z.string() }).optional()
// A 允许整个对象是 undefined
A.parse(undefined)  // ✅

const B = z.object({ name: z.string().optional() })
// B 要求对象必须存在，但 name 字段可以缺
B.parse({})  // ✅
```

这两个放一起看一眼就区分清楚了。把 `.optional()` 加在外层，是「这个对象可不存在」；加在字段上，是「这个字段可不填」。

## 8. 总结

这一篇我们把构成真实 schema 的两大构造器讲完了：

- **`z.object()`** — 把字段组合成对象，默认 strip 未知字段，也可以 strict / passthrough

- **`z.array()`** — 数组校验，空数组默认合法，`.nonempty()` 能给出精确的元组类型

- **嵌套是常态** — object 套 array 套 object 才是真实世界的结构

- **object 的变形方法** — `.pick` / `.omit` / `.partial` / `.extend` 让你从一份主 schema 派生出整套相关 schema

一句话带走：

NOTE

**object 和 array 不是 Zod 的两个 API——它们是你几乎每一份 schema 的脊梁。**

下一篇进入「可选、默认值与空值」：`optional`、`nullable`、`nullish`、`default` 这几个长得很像但语义不同的修饰符，一次讲清楚什么时候该用哪个。
