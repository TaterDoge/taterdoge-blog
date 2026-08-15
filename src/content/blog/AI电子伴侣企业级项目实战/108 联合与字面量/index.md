---
title: "108 联合与字面量"
pubDate: 2026-05-15
description: "到目前为止我们写的 schema 都假设字段只有一种形态：name 是 string、age 是 number。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/7-union-and-literal/](https://aicompanion.usehook.cn/7-union-and-literal/)

## 1. 为什么 AI 项目特别需要「联合」

到目前为止我们写的 schema 都假设**字段只有一种形态**：`name` 是 string、`age` 是 number。

但真实世界——尤其是 AI 项目——经常不是这样。消息可能有 4 种角色，工具调用可能有 5 种类型，模型返回的 payload 可能有 3 种形状。这些字段共同的特征是：

NOTE

「它不是**某一个**固定值，而是**有限的几种**中的一个。」

这就是联合类型（Union）。在 TypeScript 里你已经见过很多次：

index.ts

```typescript
type Role = 'system' | 'user' | 'assistant'
type Value = string | number
type Message = TextMessage | ImageMessage | ToolCallMessage
```

Zod 里一共有 5 个工具来表达这类「多选一」：

index.ts

```typescript
z.literal('user')                       // 只能是字面量 'user'
z.enum(['system', 'user', 'assistant']) // 预定义字符串集合
z.nativeEnum(MyTsEnum)                  // 用已有 TS 枚举
z.union([schemaA, schemaB])             // 任意 schema 的联合
z.discriminatedUnion('type', [...])     // 带辨识字段的联合（推荐）
```

这一篇我们按**从简单到复杂**的顺序一个个过，最后给一张选型表。

## 2. z.literal()：锁定一个具体值

`z.literal(v)` 要求数据必须**严格等于** `v`：

index.ts

```typescript
const schema = z.literal('user')

schema.parse('user')      // ✅ 'user'
schema.parse('User')      // 💥 大小写不一样也不行
schema.parse('admin')     // 💥
```

它看起来没什么用——「就一个值，有什么好校验的」？但它和别的方法组合起来会非常有用：

index.ts

```typescript
// 强制 role 必须是 'assistant'
const AssistantRole = z.literal('assistant')

// 标记某个对象的「类型字段」
const TextMessage = z.object({
  type: z.literal('text'),
  content: z.string(),
})
```

后面讲 discriminatedUnion 时你会发现，**literal 是它的核心零件**。

### 2.1 支持的字面量类型

index.ts

```typescript
z.literal('hello')    // 字符串
z.literal(42)         // 数字
z.literal(true)       // 布尔
z.literal(null)       // null
z.literal(undefined)  // undefined
```

字符串、数字、布尔、`null`、`undefined` 都行。对象和数组不行（那些用 `z.object` / `z.array` 就够）。

## 3. z.enum()：一组字符串字面量

当你有一组**字符串**候选值时，`z.enum()` 比写一堆 `z.literal()` 联合更自然：

index.ts

```typescript
const RoleSchema = z.enum(['system', 'user', 'assistant'])

RoleSchema.parse('user')      // ✅
RoleSchema.parse('admin')     // 💥
```

推导出的 TS 类型是精确的联合字面量：

index.ts

```typescript
type Role = z.infer<typeof RoleSchema>
// 'system' | 'user' | 'assistant'
```

### 3.1 从已有数组创建：as const

如果候选值定义在别的地方（比如配置文件里），记得加 `as const`：

index.ts

```typescript
const ROLES = ['system', 'user', 'assistant'] as const
const RoleSchema = z.enum(ROLES)
```

少了 `as const`，TS 会把数组类型推导成 `string[]`，Zod 就拿不到精确的字面量了。这是新手很容易踩的一个小坑。

### 3.2 访问候选值：.enum 和 .options

index.ts

```typescript
RoleSchema.enum
// { system: 'system', user: 'user', assistant: 'assistant' }
// 可以像访问对象一样用：RoleSchema.enum.user

RoleSchema.options
// ['system', 'user', 'assistant']
```

这两个属性在「动态渲染选项」的场景很有用——比如前端下拉框、接口文档生成。

## 4. z.nativeEnum()：搭配 TS / JS 原生枚举

如果你在项目里本来就有 TS `enum`，不用为了 Zod 重新写一遍：

index.ts

```typescript
enum UserRole {
  Admin = 'admin',
  User = 'user',
  Guest = 'guest',
}

const RoleSchema = z.nativeEnum(UserRole)

RoleSchema.parse('admin')            // ✅
RoleSchema.parse(UserRole.Admin)     // ✅
RoleSchema.parse('root')             // 💥
```

什么时候用 `nativeEnum` vs `enum`？

| 场景 | 选择 |
| --- | --- |
| 新代码，没有历史 enum | z.enum([...]) — 更简单 |
| 项目里已经有 TS enum | z.nativeEnum(MyEnum) — 避免重复定义 |
| 数值枚举（enum 成员是 number） | 只能用 z.nativeEnum |

日常新项目 90% 用 `z.enum([...])` 就够了。

## 5. z.union()：任意 schema 的联合

前面几个方法都只能在「值」的层面联合。要联合**结构不同的对象**，就得上 `z.union()`：

index.ts

```typescript
const IdSchema = z.union([z.string(), z.number()])

IdSchema.parse('abc')    // ✅
IdSchema.parse(123)      // ✅
IdSchema.parse(true)     // 💥
```

推导类型：

index.ts

```typescript
type Id = z.infer<typeof IdSchema>  // string | number
```

### 5.1 union 的工作方式：依次尝试

`z.union([A, B, C])` 的校验逻辑是：**依次**用 A、B、C 校验输入，**任何一个通过就通过**，全部失败才算失败。

这导致两个问题：

- **性能**：schema 越多越慢，每次都要串行尝试

- **错误信息混乱**：失败时会把**所有分支的错误**都列出来，很难定位到底是哪一个 schema 最接近

举个例子：

index.ts

```typescript
const MessageSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('image'), url: z.string().url() }),
])

MessageSchema.parse({ type: 'image', url: 'not-a-url' })
// 💥 会报两段错误：
//   1. text 分支：type 不是 'text'
//   2. image 分支：url 不是合法 URL
// 你真正想看到的是第 2 条，但第 1 条会干扰
```

所以实际写**对象联合**时，**更推荐下一节的 `discriminatedUnion`**。

### 5.2 什么时候还是该用 union

`z.union()` 在下面这些场景仍然是首选：

- 联合的是**基础类型**（如 `string | number`），没有可用的辨识字段

- 联合的 schema 里**只有部分是对象**，混着基础类型

- 联合的对象之间**没有共享的字面量字段**（这种设计其实多半有问题，但有时候确实遇到）

换句话说：**只要你联合的是结构不同但有共同标识字段的对象，就别用 union，用 discriminatedUnion。**

## 6. z.discriminatedUnion()：AI 项目的大杀器

如果你写过一个稍微复杂点的 AI 应用，一定见过这类数据：

index.json

```json
[
  { "type": "text",       "text": "Hello" },
  { "type": "image",      "url": "https://..." },
  { "type": "tool_call",  "name": "search", "args": { "q": "ai" } }
]
```

这些对象的结构完全不同，但共享一个**辨识字段** `type`。这正是 `discriminatedUnion` 设计的场景：

message-schema.ts

```typescript
const MessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('image'),
    url: z.string().url(),
  }),
  z.object({
    type: z.literal('tool_call'),
    name: z.string(),
    args: z.record(z.unknown()),
  }),
])
```

第一个参数是**辨识字段名**，第二个参数是**各个分支的 schema**。每个分支都必须：

- 是 `z.object`

- 含一个**用 `z.literal` 声明的辨识字段**（或 `z.enum`）

### 6.1 它解决了 union 的两个问题

- **性能好**：只需要读一次 `input.type`，就能直接跳到对应分支，不用串行试

- **错误精准**：校验失败时，Zod 知道你**本意**是 `'image'` 分支，错误信息会直接指向该分支的具体字段

index.ts

```typescript
MessageSchema.parse({ type: 'image', url: 'not-a-url' })
// 💥 错误只报：url Invalid url
// 不会再把 text 分支的错误混进来
```

### 6.2 类型推导也更智能

index.ts

```typescript
type Message = z.infer<typeof MessageSchema>

function render(msg: Message) {
  if (msg.type === 'text') {
    msg.text     // ✅ TS 知道这里一定有 text
  } else if (msg.type === 'image') {
    msg.url      // ✅ TS 知道这里一定有 url
  }
}
```

这正是 TypeScript **可辨识联合（Discriminated Union）** 的典型用法——schema 和类型两头都能吃上。

### 6.3 访问所有分支

index.ts

```typescript
MessageSchema.options
// 返回每个分支的 schema 数组，可用于文档生成、动态 UI 等
```

## 7. 实战：一个真实的 AI 消息结构

我们把这一篇学到的东西组合起来，写一份接近真实项目的消息 schema：

chat-schema.ts

```typescript
import { z } from 'zod'

// 辨识字段：role
const SystemMessage = z.object({
  role: z.literal('system'),
  content: z.string(),
})

const UserMessage = z.object({
  role: z.literal('user'),
  content: z.union([
    z.string(),                                         // 纯文本
    z.array(z.discriminatedUnion('type', [              // 多模态内容
      z.object({ type: z.literal('text'),  text: z.string() }),
      z.object({ type: z.literal('image'), url: z.string().url() }),
    ])),
  ]),
})

const AssistantMessage = z.object({
  role: z.literal('assistant'),
  content: z.string().nullable(),
  toolCalls: z.array(z.object({
    id: z.string(),
    name: z.string(),
    args: z.record(z.unknown()),
  })).optional(),
})

const ToolMessage = z.object({
  role: z.literal('tool'),
  toolCallId: z.string(),
  content: z.string(),
})

// 顶层：按 role 辨识
export const MessageSchema = z.discriminatedUnion('role', [
  SystemMessage,
  UserMessage,
  AssistantMessage,
  ToolMessage,
])

export type Message = z.infer<typeof MessageSchema>
```

这份 schema 做到了三件事：

- 顶层用 `role` 作为辨识字段区分 4 种消息类型

- `UserMessage` 的 `content` 又是一个联合：**纯文本** 或 **多模态内容数组**

- `content` 的多模态数组内部，又是一层按 `type` 辨识的 discriminatedUnion

复杂吗？看起来挺复杂。但每一层都只是**前面学过的三块积木**的组合：object、array、discriminatedUnion。

这正是 Zod 的美感——**小积木能搭出任意复杂的真实数据结构，而且类型一路推导到底**。

## 8. 总结

这一篇我们把 Zod 里表达「多选一」的 5 个工具都过了一遍：

| 方法 | 用于 | 典型场景 |
| --- | --- | --- |
| z.literal(v) | 锁定单个字面量值 | 作为 discriminator 的零件 |
| z.enum([...]) | 一组字符串字面量 | role、status、level 这类固定集合 |
| z.nativeEnum(E) | 已有 TS / JS 枚举 | 和 enum 定义集成 |
| z.union([...]) | 通用联合（任何 schema） | 基础类型联合 / 无共享字段的对象 |
| z.discriminatedUnion(k, [...]) | 带辨识字段的对象联合 | 消息、事件、工具调用（AI 项目最常用） |

一张用于日后选型的决策图：

text

```text
要校验的是「几选一」吗？
├── 是一个字符串枚举 → z.enum([...])
├── 是已有的 TS enum → z.nativeEnum(E)
├── 是几个结构不同的对象
│    └── 它们有共享的 type/role/kind 字段吗？
│         ├── 有 → z.discriminatedUnion('type', [...]) ✅
│         └── 没有 → z.union([...])（并考虑加一个辨识字段）
└── 单个字面量 → z.literal(v)
```

一句话带走：

NOTE

**一旦你在 schema 里看到「几种对象形态之一」，反射弧应该是 discriminatedUnion，而不是 union。**

到这里，Zod 入门篇就全部完结了。你现在已经有能力写出真实项目里 90% 的业务 schema。

从下一篇开始我们进入**进阶篇**：从 `refine` / `superRefine` 开始，讲 Zod 真正让人爱上的那部分能力——**不仅描述数据形状，还描述数据之间的关系和业务规则**。
