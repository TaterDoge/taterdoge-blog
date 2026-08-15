---
title: "103 单一真实来源"
pubDate: 2026-05-14
description: "Schema 是单一真实来源（Single Source of Truth），校验和类型都从它派生。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/2-single-source-of-truth/](https://aicompanion.usehook.cn/2-single-source-of-truth/)

## 1. 上一篇留下的那句话

上一篇结尾有一句话，这一篇专门把它讲透：

NOTE

**Schema 是单一真实来源（Single Source of Truth），校验和类型都从它派生。**

这句话听起来很工程师味，但它其实在回答一个非常朴素的问题：

NOTE

「同一份数据结构，到底要写几遍？」

如果你没认真思考过这个问题，项目一大就会发现：**你其实把同一个东西反反复复写了四五遍，而且每次写的版本都略微不一样。**

我们先来看看这种「到处都是同一个东西的影子」的日常长什么样。

## 2. 没有单一真实来源的典型日常

想象一下你在做一个很普通的需求：新用户注册。

一个注册对象，粗略看就是：

index.json

```json
{
  "name": "Alice",
  "email": "alice@example.com",
  "age": 18
}
```

真实项目里，同一个「注册用户」的结构，通常会在以下这些地方被**各自重写一遍**：

**1. 前端表单的类型**

index.ts

```typescript
interface RegisterForm {
  name: string
  email: string
  age: number
}
```

**2. 前端表单的校验规则（比如 react-hook-form + 自己写的 validator）**

index.ts

```typescript
const validators = {
  name: (v: string) => v.length > 0,
  email: (v: string) => v.includes('@'),
  age: (v: number) => v >= 0 && v <= 120,
}
```

**3. 后端接口的 TypeScript 类型**

index.ts

```typescript
interface RegisterBody {
  name: string
  email: string
  age: number
}
```

**4. 后端接口的运行时校验**

index.ts

```typescript
if (!body.name || typeof body.name !== 'string') throw ...
if (!body.email || !body.email.includes('@')) throw ...
if (typeof body.age !== 'number' || body.age < 0) throw ...
```

**5. 接口文档（可能是 Swagger / OpenAPI / 飞书文档）**

index.yaml

```yaml
RegisterBody:
  type: object
  properties:
    name: { type: string }
    email: { type: string, format: email }
    age: { type: integer, minimum: 0 }
```

**6. 数据库插入前的二次校验**

index.ts

```typescript
if (user.age < 0) throw new Error('age must be >= 0')
```

一个小小的「注册用户」对象，可能被写进 6 个不同的地方。每一个地方都在说**同一件事**，但说法都略有不同。

这种模式有一个听起来很专业的名字，叫「模型分裂（Model Drift）」。翻译成人话就是：

NOTE

**同一个概念在不同地方各自长大，然后它们悄悄地长得不一样了。**

## 3. 模型分裂会带来什么痛

听起来只是「多写几遍」而已，并不致命。但它真正的代价，是**修改代价**。

我们假设产品经理某天改了一条规则：

NOTE

「年龄上限从 120 改成 150 吧。」

你现在需要改哪几个地方？

- 前端表单校验里的 `v <= 120`

- 后端运行时校验里的年龄判断

- 数据库落库前的兜底校验

- Swagger 里的 `maximum: 120`

- 接口文档里对外的描述

- 可能还有测试用例里的断言

如果你漏改一个地方，就会出现非常典型的「**一半对一半错**」问题：前端放行了 149，后端拒绝；或者后端放行了 149，数据库死活不收。

这类 bug 有一个特点：**它们不一定会立刻被发现，但一旦出问题，定位非常慢。** 因为代码里没有任何一处是「错的」——只是不同地方对「什么叫合法数据」的定义已经不一致了。

所以，重复本身不是最大的罪，**重复 + 容易走形** 才是。

## 4. 单一真实来源（SSOT）的思路

软件工程里有一个原则：

NOTE

**同一份知识，应该只存在一个权威来源。** 其他所有用到它的地方，都应该是从这个来源派生出去的，而不是各自抄一遍。

这个原则叫 **Single Source of Truth**，简称 **SSOT**，中文常叫「单一真实来源」。

放在我们这个例子里，它的意思是：

- 「注册用户的数据结构」这件事，**只允许存在一份权威定义**

- 前端类型、后端类型、前端校验、后端校验、接口文档，**全部从这份定义派生**

而 Zod 刚好就特别擅长扮演这个「唯一权威定义」的角色。

## 5. Zod 怎么当这个「唯一权威」

我们把前面那 6 份重复定义，收敛到一份 Zod schema：

user-schema.ts

```typescript
import { z } from 'zod'

export const RegisterSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().min(0).max(150),
})

export type RegisterBody = z.infer<typeof RegisterSchema>
```

然后我们看看，从这一份 schema 能派生出哪些东西。

### 5.1 派生出 TypeScript 类型

index.ts

```typescript
import { RegisterSchema, type RegisterBody } from './user-schema'

function register(body: RegisterBody) {
  // body 的类型是 { name: string; email: string; age: number }
}
```

不再手写 `interface`，类型从 schema 直接推导。schema 一改，类型跟着变，不会漏。

### 5.2 派生出后端运行时校验

index.ts

```typescript
app.post('/register', async (c) => {
  const body = RegisterSchema.parse(await c.req.json())
  // body 已经是合法的 RegisterBody
})
```

不再手写一堆 `if`，规则就写在 schema 里。

### 5.3 派生出前端表单校验

register-form.tsx

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { RegisterSchema, type RegisterBody } from './user-schema'

export function RegisterForm() {
  const form = useForm<RegisterBody>({
    resolver: zodResolver(RegisterSchema),
  })
  // ...
}
```

前后端校验现在共用同一份规则——因为共用同一份 schema。

### 5.4 派生出接口文档（OpenAPI）

通过 `@hono/zod-openapi` 或 `zod-to-json-schema` 这类工具，可以直接把 schema 转成 OpenAPI 的 JSON Schema：

index.ts

```typescript
import { zodToJsonSchema } from 'zod-to-json-schema'
import { RegisterSchema } from './user-schema'

const jsonSchema = zodToJsonSchema(RegisterSchema)
// { type: 'object', properties: { name: {...}, email: {...}, age: {...} }, ... }
```

也就是说：**文档自动和代码同步**，不再出现「代码改了，文档忘了改」。

### 5.5 全链路效果

现在回到之前那个「年龄上限从 120 改成 150」的需求：

user-schema.ts

```typescript
age: z.number().int().min(0).max(150),  // 改这一行
```

改完之后：

- 前端表单的校验规则自动跟着变

- 后端的 `parse` 自动用新规则

- TypeScript 类型不变（因为类型还是 `number`，但运行时上限已经是 150）

- 接口文档重新生成，`maximum` 自动变成 150

**一处修改，全链路同步。** 这就是 SSOT 在 Zod 里最直观的体现。

## 6. 在 AI 项目里，SSOT 的价值会再放大一层

普通后端里，SSOT 能省时间、减 bug。到了 AI 项目里，它会变成「救命的东西」。原因是 AI 项目里**数据边界非常多**：

- 前端 → 后端：用户 prompt、对话上下文

- 后端 → LLM：prompt 模板、工具参数定义

- LLM → 后端：结构化输出、函数调用参数

- 后端 → 向量库：检索 payload、metadata filter

- 外部 API → 后端：第三方模型返回、插件响应

每一个箭头都是一个「数据必须长成某个样子」的约定。

如果每一个约定都**手写类型 + 手写校验**，那就不是 6 份重复，而是 6 × N 份重复。一个中等规模的 AI 项目，动辄几十个 schema 在空中飞。

Zod 在这里的角色是：**把每一个数据边界的契约，都收敛成一份 schema。**

举个典型例子，LLM 的 function calling（工具调用）需要你声明工具参数的结构：

index.ts

```typescript
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

// 唯一权威：搜索工具的参数结构
export const SearchToolInput = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).max(20).default(5),
})

// 派生 1：喂给 LLM 的 function definition
const toolDef = {
  name: 'search',
  parameters: zodToJsonSchema(SearchToolInput),
}

// 派生 2：LLM 返回参数后，运行时校验
function runSearch(rawArgs: unknown) {
  const args = SearchToolInput.parse(rawArgs)
  // args.query 和 args.topK 一定合法
}

// 派生 3：TS 类型
type SearchArgs = z.infer<typeof SearchToolInput>
```

一份 schema，同时服务了三个角色：**告诉 LLM 参数是什么**、**校验 LLM 给的参数**、**让 TS 知道参数是什么**。

如果你把这三个角色各自写一份，LLM 永远会有办法找到你定义不一致的缝隙，然后把一个看起来像对、其实不对的 JSON 塞给你。这种 bug 在 AI 项目里特别常见，也特别难查。

## 7. 一个简单的心法

最后给你一个判断标准，帮你之后写代码时自问：

NOTE

**「这份数据结构的描述，在我的项目里一共出现了几次？如果超过一次，它们是派生的，还是各自手写的？」**

- 如果是派生的 → 你在做对的事

- 如果是各自手写的 → 你正在种一颗未来会发芽的 bug

这不是说「绝对不能重复定义」，而是说：**只要你发现有两个地方在描述同一件事，就应该下意识地问自己——能不能让它们共享一份 schema？**

Zod 的存在，就是为了让「共享一份 schema」这件事足够便宜、足够顺手，以至于你根本不会想再回到「每个地方各写一份」的老路。

## 8. 总结

这一篇没有讲任何新的 API，但它是**理解 Zod 的心智底座**。

核心观点只有三条：

- **模型分裂是项目里最常见、最不易察觉的坑**：同一份数据结构被写在很多地方，然后慢慢不一致

- **SSOT 是解法**：只定义一份，其他全部派生

- **Zod 的核心价值就是当这个「唯一权威」**：一份 schema 同时派生出 TS 类型、运行时校验、前端表单校验、接口文档、甚至 LLM 工具定义

如果让你用一句话记住这一篇，可以是这样：

NOTE

**不要重复描述同一件事——先写 schema，再从它派生一切。**

从下一篇开始，我们进入实操：用 `parse` 和 `safeParse` 跑通你写的第一个 Zod schema。
