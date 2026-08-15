---
title: "123 结构化输出"
pubDate: 2026-05-20
description: "LLM 的默认输出是自然语言，但 90% 的工程场景其实不需要自然语言，需要的是结构化数据："
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/8-generate-object/](https://aicompanion.usehook.cn/8-generate-object/)

## 1. 为什么要有结构化输出

LLM 的默认输出是自然语言，但 90% 的工程场景其实不需要自然语言，需要的是结构化数据：

- 「分类用户情绪」→ 需要一个枚举值

- 「提取简历信息」→ 需要一个 JSON 对象

- 「生成评分卡」→ 需要一个带多字段的表单

- 「规划 Agent 下一步动作」→ 需要一个带参数的 action

没有结构化输出的世界里，我们只能靠 prompt 工程去凑：

badbad.txt

```text
请严格按以下 JSON 格式返回：
{"emotion": "happy|sad|angry|neutral", "intensity": 0-1}

不要加任何前后缀，不要加 markdown 代码块，不要解释...
```

然后用正则抠 JSON、用 `JSON.parse` 搏运气、失败就重试一次。这套代码每个项目都要重写一遍，还经常在某个极端样本上崩溃。

`generateObject` / `streamObject` 就是专门来干这堆脏活的：你给 Zod schema，它保证返回符合 schema 的类型安全对象。

思路上这和 [Zod + LLM](/13-zod-with-llm) 讲的「LLM Structured Output + Zod 校验」是一回事，但 AI SDK 的实现更彻底——它用的是 Provider 原生的 JSON Schema 模式（OpenAI 的 Response Format、Anthropic 的 Tool Use、Gemini 的 JSON Mode），从模型层面就约束输出。

## 2. generateObject：一次性生成

最基本的形态：给一个 Zod schema，拿到一个符合 schema 的 `object`。

generate-object.ts

```typescript
import { generateObject } from 'ai'
import { z } from 'zod'

const EmotionSchema = z.object({
  primary: z.enum(['happy', 'sad', 'angry', 'calm', 'neutral']),
  intensity: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  reason: z.string().describe('一句话解释为什么做出这个判断'),
})

const { object, usage } = await generateObject({
  model: models.structured,
  schema: EmotionSchema,
  prompt: '分析这段话的情绪：今天的夕阳真好看。',
})

// object 的类型自动推导为 EmotionSchema 的 infer 结果
console.log(object.primary)    // 'calm' | 'happy' | ...
console.log(object.intensity)  // number
```

这段代码里有几个关键点：

- `object` 的类型是完全自动推导出来的。你定义 Zod schema，TS 就知道 `object` 长什么样

- `z.describe()` 非常重要。describe 的内容会嵌进 JSON Schema 的 `description` 字段，模型靠它决定每个字段填什么

- Enum、min、max、正则这类 Zod 约束都会传给模型，能大幅降低不合格输出的概率

### 数组、枚举、带条件的 schema

`generateObject` 还支持几种专门的 output 模式：

output-modes.ts

```typescript
// 默认：output: 'object'（上面的例子）

// 数组输出
const { object } = await generateObject({
  model: models.structured,
  output: 'array',
  schema: z.object({ name: z.string(), age: z.number() }),
  prompt: '生成 3 个虚构人物。',
})
// object 的类型是 Array<{ name: string; age: number }>

// 纯枚举（返回一个字符串，在给定枚举里选）
const { object } = await generateObject({
  model: models.structured,
  output: 'enum',
  enum: ['happy', 'sad', 'angry', 'neutral'],
  prompt: '这段话是什么情绪：今天被裁员了。',
})
// object 的类型是 'happy' | 'sad' | 'angry' | 'neutral'

// 无 schema（模型自行决定结构）
const { object } = await generateObject({
  model: models.structured,
  output: 'no-schema',
  prompt: '用 JSON 返回今天的待办。',
})
// object 的类型是 unknown（结构由模型自行决定）
```

绝大多数场景用默认的 `'object'` 或 `'array'` 就行。`'enum'` 对纯分类任务更直观；`'no-schema'` 基本只在探索阶段用，生产要避免。

## 3. streamObject：流式对象

当对象比较大、字段比较多（评分卡、报告、多段分析），你会希望用户在 UI 上看到它一边流式生成一边填充。`streamObject` 就是干这个的：

stream-object.ts

```typescript
import { streamObject } from 'ai'
import { z } from 'zod'

const ReportSchema = z.object({
  title: z.string(),
  summary: z.string(),
  sections: z.array(z.object({
    heading: z.string(),
    body: z.string(),
  })),
  conclusion: z.string(),
})

const { partialObjectStream, object } = streamObject({
  model: models.structured,
  schema: ReportSchema,
  prompt: '写一份 300 字左右的 AI 伴侣产品周报。',
})

// 逐步拿到「部分完成的对象」
for await (const partial of partialObjectStream) {
  console.clear()
  console.log(JSON.stringify(partial, null, 2))
}

// 最终完整对象
const final = await object
```

`partialObjectStream` 有几个特点：

- 每个元素是部分对象（`DeepPartial<T>`），字段可能是 `undefined`，字符串可能还没写完，数组可能只有部分元素

- 每次给到的都是整个对象的新快照，不是增量。这让前端渲染特别简单，`setState(partial)` 就行

- 最后 `await object` 拿到完整校验过的对象

### 前端消费：useObject

[结构化输出流式 UI](/13-use-object) 会详细讲 `useObject`，这里先给个预览：

use-object.tsx

```tsx
'use client'
import { experimental_useObject as useObject } from '@ai-sdk/react'
import { ReportSchema } from '@/shared/schemas'

export function Report() {
  const { object, submit, isLoading } = useObject({
    api: '/api/report',
    schema: ReportSchema,
  })

  return (
    <div>
      <button onClick={() => submit('AI 伴侣产品周报')}>生成</button>

      {object?.title && <h1>{object.title}</h1>}
      {object?.summary && <p>{object.summary}</p>}
      {object?.sections?.map((s, i) => (
        <div key={i}>
          <h2>{s?.heading}</h2>
          <p>{s?.body}</p>
        </div>
      ))}
    </div>
  )
}
```

流式填充的视觉效果非常打动人——用户看着标题先出来，接着摘要、接着一段段正文逐个展开。这种体验 `generateObject` 等完再渲染是做不到的。

## 4. schema 设计的几条经验

结构化输出的质量，90% 取决于 schema 设计。下面几条经验都挺实用。

### 用 .describe() 指导模型填字段

没 describe 的 schema，模型只能猜字段含义。加上 describe 等于给每个字段写了一行小 prompt：

describe.ts

```typescript
const CandidateSchema = z.object({
  name: z.string().describe('候选人姓名，中英文都可以'),
  skills: z.array(z.string()).describe('技术栈列表，每个是一个短语，如「React」「TypeScript」'),
  yearsOfExperience: z.number().int().min(0).describe('工作总年数，整数'),
  summary: z.string().describe('一句话总结，不超过 50 字'),
})
```

实测下来，同样的 prompt 加了 describe 之后，字段填充质量能提升 30% 以上。

### enum 比 string 靠谱

凡是「应该只有几个取值」的字段，一律用 `z.enum()`：

enum-example.ts

```typescript
// ❌ 宽松
priority: z.string(),

// ✅ 严格
priority: z.enum(['low', 'medium', 'high', 'urgent']),
```

### 用 .optional() 明确「可以不填」

LLM 有「尽力填满每个字段」的倾向。如果某字段在某些情况下不该有，用 `.optional()` 让模型敢于不填：

optional.ts

```typescript
followUpAction: z.enum(['reschedule', 'escalate', 'close']).optional()
  .describe('只有在需要后续动作时才返回'),
```

### 嵌套不要太深

schema 嵌套超过 3 层，模型出错率会明显上升。超过 3 层建议拆成多次 `generateObject` 调用，或者用 `streamObject` 让模型生成得更从容。

### 数组元素 schema 越简单越好

数组里每个元素越复杂（多嵌套字段、多 enum），模型越容易失败。如果元素真的很复杂，可以拆成两步：先列出数组元素的 ID 或标题，再逐个生成详情。

## 5. 错误处理

`generateObject` / `streamObject` 的失败一般分三类。

### 生成内容不符合 schema

对应的错误类是 `NoObjectGeneratedError`。常见于模型没能严格遵守 schema，或者输入太模糊。

no-object-error.ts

```typescript
import { NoObjectGeneratedError } from 'ai'

try {
  const { object } = await generateObject({ schema, prompt })
} catch (err) {
  if (NoObjectGeneratedError.isInstance(err)) {
    console.log('原始输出：', err.text)
    console.log('原始响应：', err.response)
    console.log('错误原因：', err.cause)
  }
}
```

恢复策略：换更强的模型、加 `.describe()`、简化 schema，或者用 `streamObject` 观察部分结果找出问题所在。

### Provider 不支持结构化输出

对应 `UnsupportedFunctionalityError`。部分小模型或 Ollama 里某些本地模型没有 JSON Mode。恢复策略是换模型，或者降级到「prompt + 文本解析」方案。

### 生成超时或 Token 超限

通用的 `APICallError`，schema 太大、prompt 太长都可能触发。恢复策略是简化 schema、拆成多次调用。

## 6. 和 streamText + tool 的选择

一个容易混淆的问题：什么时候用 `generateObject`、什么时候用 `streamText` 加 tool？

简明判断：

| 需求 | 选择 |
| --- | --- |
| 纯提取一个结构 | generateObject |
| 结构 + 自由文本回复 | streamText + 一个 output tool |
| 结构还要经过多步推理（先搜索再填） | streamText + 多 tool + Agent 循环 |
| 流式填充 UI | streamObject |
| 不知道会不会调工具 | streamText |

本质上的区别是：

- `generateObject` 更像「用 AI 实现一个函数」：输入参数 → 输出 typed object。没有对话、没有工具、没有思考

- `streamText + tool` 更像「让 AI 执行一个任务」：可以对话、可以调工具、可以推理，最后用 tool 产出结构

对 AI 伴侣的情绪分类、记忆摘要这种「一步到位」的任务，`generateObject` 最合适。对话主链路则只能用 `streamText`。

## 7. 小结

- `generateObject` 用 Zod schema 约束 LLM 输出，返回类型安全对象，适合一步到位的结构化任务

- `streamObject` 流式填充 UI，`partialObjectStream` 每次拿到的是整个对象的新快照

- schema 设计五条心得：`.describe()`、用 enum、用 `.optional()`、避免深嵌套、数组元素尽量简单

- `NoObjectGeneratedError` 是最常见的错误，排查时看 `err.text` 和 `err.cause`

- 选型上：纯提取用 `generateObject`，对话或要调工具就用 `streamText`

下一篇进入 **Tool Calling**——怎么把函数暴露给 LLM、怎么用 Zod 校验参数、怎么和 LangChain 的 tool 做对比。
