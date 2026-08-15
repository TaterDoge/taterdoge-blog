---
title: "114 Zod + LLM"
pubDate: 2026-05-17
description: "在 AI 项目里用 LLM 做 Structured Output（结构化输出）时，你会立刻意识到一个现实："
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/13-zod-with-llm/](https://aicompanion.usehook.cn/13-zod-with-llm/)

## 1. LLM 的 JSON 永远不会「完全守规矩」

在 AI 项目里用 LLM 做 Structured Output（结构化输出）时，你会立刻意识到一个现实：

**模型返回的 JSON 永远不会完全守规矩。**

即使你在 prompt 里写了详尽的 schema 描述、给了例子、甚至用上了 OpenAI 和 Anthropic 的 Structured Output API，仍然会遇到这些情况：

- 把 JSON 包在 ````json ... ```` 围栏里返回

- 数字字段偶尔返回字符串 `"42"`

- 多一个字段或少一个字段

- 枚举值大小写不对（`"User"` 而不是 `"user"`）

- 空值有时候是 `null`，有时候是空串，有时候是 `"N/A"`

- 数组里偶尔混进一个不符合结构的元素

这些问题如果等到业务层再处理，会让代码充满 `if (typeof x === 'string')`、`x ?? []`、各种 defensive 判断。Zod 在这里的定位很清晰：

NOTE

**把「模型输出整理成合法业务数据」这一层，从业务代码里彻底剥离出来。**

这一篇我们把前面学的所有能力——schema / refine / transform / preprocess / pipe / `z.input` vs `z.output`——都用到一个真实的场景里：**让 LLM 的任何返回都能被安全地塞进你的业务对象**。

## 2. 最基础的模式：parse 模型输出

最朴素的写法：告诉模型返回某种 JSON，然后直接用 schema `parse`：

llm-analyze.ts

```typescript
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'

const AnalysisSchema = z.object({
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  keywords: z.array(z.string()).min(1).max(10),
  summary: z.string().min(1).max(200),
})
type Analysis = z.infer<typeof AnalysisSchema>

async function analyze(text: string): Promise<Analysis> {
  const client = new Anthropic()
  const msg = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `分析以下文本，返回 JSON（字段：sentiment、keywords、summary）：\n\n${text}`,
    }],
  })
  const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''

  return AnalysisSchema.parse(JSON.parse(raw))
}
```

这段代码能跑，但它**特别脆**。任何一个小问题——比如模型多写了一句 `「这是分析结果：」`、把 JSON 包在代码围栏里——它就会直接抛错。

下一节我们把这些典型问题一个个用 Zod 的能力补上。

## 3. 用 transform + preprocess 让校验更棒

第 9 篇讲过的 `transform` / `preprocess` / `pipe` 在这里会大放异彩。我们给 schema 加上一层**预处理器**：

llm-utils.ts

```typescript
import { z } from 'zod'

// 剥代码围栏
const stripCodeFence = (s: string) =>
  s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

// 从混合文本里抠出第一段看起来像 JSON 的内容
const extractJson = (s: string) => {
  const cleaned = stripCodeFence(s)
  const first = cleaned.indexOf('{')
  const last  = cleaned.lastIndexOf('}')
  if (first === -1 || last === -1) throw new Error('no JSON object found')
  return cleaned.slice(first, last + 1)
}

// 通用工厂：任意 Zod schema → 能解析 LLM 原始输出的 schema
export const LLMJsonSchema = <T extends z.ZodTypeAny>(shape: T) =>
  z.string()
    .transform(s => extractJson(s))
    .transform(s => JSON.parse(s))
    .pipe(shape)
```

有了这个工厂，刚才那段脆弱的代码瞬间变鲁棒：

index.ts

```typescript
const AnalysisSchema = z.object({
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  keywords: z.array(z.string()).min(1).max(10),
  summary: z.string().min(1).max(200),
})

const RobustAnalysis = LLMJsonSchema(AnalysisSchema)

const raw = `这是分析结果：
\`\`\`json
{ "sentiment": "positive", "keywords": ["AI", "Zod"], "summary": "..." }
\`\`\``

const analysis = RobustAnalysis.parse(raw)
// ✅ 无论模型怎么包装，只要 JSON 对就能过
```

关键之处是**最后 `.pipe(shape)`**——第 9 篇讲过，它让变形后的数据**继续走严格校验**。这个模式是 LLM 工程化的核心武器。

## 4. 容忍模型的常见「脏输出」

光剥围栏还不够。模型经常在**字段值**层面出错，我们在单个字段的 schema 上加容错。

### 4.1 容忍数字字符串

index.ts

```typescript
// 模型有时候把数字返回成字符串
const FlexibleNumber = z.coerce.number().int()

FlexibleNumber.parse(42)     // 42
FlexibleNumber.parse('42')   // 42
```

### 4.2 容忍大小写不对的枚举

index.ts

```typescript
const FlexibleSentiment = z.string()
  .transform(s => s.toLowerCase().trim())
  .pipe(z.enum(['positive', 'neutral', 'negative']))

FlexibleSentiment.parse('Positive')  // 'positive'
FlexibleSentiment.parse(' NEUTRAL ') // 'neutral'
```

### 4.3 容忍 null / 'N/A' / 空串

模型表达「没有」的方式五花八门，我们用 preprocess 统一成 `null`：

index.ts

```typescript
const nullable = <T extends z.ZodTypeAny>(shape: T) =>
  z.preprocess(
    v => (v === null || v === '' || v === 'N/A' || v === 'null') ? null : v,
    shape.nullable(),
  )

const BirthYear = nullable(z.coerce.number().int())

BirthYear.parse(1995)     // 1995
BirthYear.parse('1995')   // 1995
BirthYear.parse('N/A')    // null
BirthYear.parse('')       // null
```

### 4.4 过滤数组里的脏元素

如果不想因为数组里一个元素坏了就整组失败，用 `safeParse` + filter：

index.ts

```typescript
const Keyword = z.string().min(1).max(30)

const CleanKeywords = z.array(z.unknown())
  .transform(arr =>
    arr.map(v => Keyword.safeParse(v))
       .filter(r => r.success)
       .map(r => r.data!)
  )

CleanKeywords.parse(['AI', '', 123, 'Zod'])
// ['AI', 'Zod']
```

这些小工具合起来就是你的「LLM 脏输出防御层」。**越是生产环境，越要舍得在 schema 层多加这种鲁棒性。**

## 5. z.describe()：让 schema 同时作为 prompt 的一部分

这是 Zod 在 LLM 场景里一个特别好用但常被忽视的方法：`.describe(s)`。

index.ts

```typescript
const AnalysisSchema = z.object({
  sentiment: z.enum(['positive', 'neutral', 'negative'])
    .describe('文本的整体情绪倾向'),
  keywords: z.array(z.string())
    .min(1).max(10)
    .describe('最能代表文本主旨的 1~10 个关键词'),
  summary: z.string().min(1).max(200)
    .describe('不超过 200 字的摘要'),
})
```

`.describe()` 不会影响校验，但这些描述会在你把 schema 转成 **JSON Schema** 时保留下来——这正是喂给模型的那种结构。

prompt.ts

```typescript
import { zodToJsonSchema } from 'zod-to-json-schema'

const jsonSchema = zodToJsonSchema(AnalysisSchema)
// 直接拼进 prompt：
const prompt = `请按以下 JSON Schema 返回：\n${JSON.stringify(jsonSchema, null, 2)}`
```

**一份 schema 同时描述了：**

- 运行时校验规则

- TypeScript 类型

- 给 LLM 看的字段说明

这正是第 2 篇讲的 SSOT 在 AI 场景里最极致的体现——**连 prompt 都不用手写**。

## 6. Structured Output / Tool Use：从 schema 到 API 参数

OpenAI 的 Structured Output 和 Anthropic 的 Tool Use，底层都要求你传一份 **JSON Schema**。Zod + 一个转换工具，一行代码搞定。

### 6.1 OpenAI Structured Output

openai-demo.ts

```typescript
import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import { z } from 'zod'

const AnalysisSchema = z.object({
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  keywords: z.array(z.string()).min(1).max(10),
  summary: z.string().min(1).max(200),
})

const client = new OpenAI()
const completion = await client.chat.completions.parse({
  model: 'gpt-4o-2024-08-06',
  messages: [{ role: 'user', content: '分析这段文本：...' }],
  response_format: zodResponseFormat(AnalysisSchema, 'analysis'),
})

const analysis = completion.choices[0].message.parsed
// analysis 的类型已经是 z.infer<typeof AnalysisSchema>
```

### 6.2 Anthropic Tool Use

Anthropic 走 `tools` 字段传 JSON Schema，配 `zod-to-json-schema`：

anthropic-demo.ts

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { z } from 'zod'

const SearchArgs = z.object({
  query: z.string().min(1).describe('搜索关键词'),
  topK: z.number().int().min(1).max(20).default(5).describe('返回多少条'),
})

const client = new Anthropic()
const msg = await client.messages.create({
  model: 'claude-opus-4-6',
  max_tokens: 1024,
  tools: [{
    name: 'search',
    description: '在知识库中检索',
    input_schema: zodToJsonSchema(SearchArgs) as any,
  }],
  messages: [{ role: 'user', content: '帮我搜一下 zod 的用法' }],
})

// 模型返回的 tool_use 参数也用同一份 schema 校验
for (const block of msg.content) {
  if (block.type === 'tool_use' && block.name === 'search') {
    const args = SearchArgs.parse(block.input)
    // args 的类型是 z.infer<typeof SearchArgs>，可以放心用
  }
}
```

这里 `SearchArgs` 被用了**三次**：

- 转成 JSON Schema 传给 Anthropic API

- 校验模型返回的工具调用参数

- 给 TypeScript 推导类型

**一份 schema 管三件事**——这是第 8 篇结尾埋的工具调用伏笔在真实项目里的样子。

## 7. 失败时怎么办：重试、降级、日志

LLM 场景下 `parse` 失败是家常便饭，你的代码必须**把失败当作一个正常的业务分支**来处理。

### 7.1 重试一次再放弃

一个常见模式：第一次失败时，把错误信息**塞回 prompt**，让模型修正：

index.ts

```typescript
async function callWithRetry<T extends z.ZodTypeAny>(
  schema: T,
  ask: (hint?: string) => Promise<string>,
  maxRetry = 1,
): Promise<z.infer<T>> {
  let lastError: unknown
  for (let i = 0; i <= maxRetry; i++) {
    const raw = await ask(
      lastError
        ? `你上一次的输出不符合 schema，错误：${(lastError as Error).message}。请重新返回合法的 JSON。`
        : undefined
    )
    const result = LLMJsonSchema(schema).safeParse(raw)
    if (result.success) return result.data
    lastError = result.error
  }
  throw lastError
}
```

### 7.2 失败时降级到「部分结果」

用第 6 篇讲过的 `.catch()` 给单个字段兜底：

index.ts

```typescript
const SafeAnalysis = z.object({
  sentiment: z.enum(['positive', 'neutral', 'negative']).catch('neutral'),
  keywords: z.array(z.string()).catch([]),
  summary: z.string().catch(''),
})
```

这样即使某个字段坏掉，其他字段仍然可用。**视业务场景谨慎使用**——有些接口宁可整体失败，也不能返回「一半假数据」。

### 7.3 一定要打日志

LLM 场景下最危险的是「错误被悄悄吃掉」。**每一次 parse 失败都必须记录**：

index.ts

```typescript
const result = AnalysisSchema.safeParse(JSON.parse(raw))
if (!result.success) {
  logger.error('llm.output.invalid', {
    raw,
    issues: result.error.issues,
    model: 'claude-opus-4-6',
  })
  throw new LLMOutputError('模型返回格式不符合预期')
}
```

日志里**一定要带 raw**——没有原始字符串，事后排查模型漂移问题基本没戏。

## 8. 总结

这一篇把 Zod 的能力全部用在了「驯服 LLM 输出」这件事上：

| 能力 | 用在哪里 |
| --- | --- |
| 基础 schema（第 4–7 篇） | 声明目标结构 |
| .refine()（第 8 篇） | 表达跨字段业务规则 |
| .transform/.preprocess/.pipe（第 9 篇） | 剥围栏、兜 null、统一大小写 |
| z.input/z.output（第 10 篇） | 区分「模型输出」vs「业务对象」 |
| 派生 schema（第 11 篇） | 接口响应 vs LLM 工具参数共用一套 |
| .describe() | 一份 schema 同时作 prompt 指令 |
| .catch()（第 6 篇） | 关键字段降级兜底 |

三条专栏级别的最佳实践：

- **永远把 LLM 输出走一次 schema**——无论模型 SDK 是否号称「structured」

- **一份 schema 贯穿：Prompt + 模型 API + 业务对象 + 前后端类型**，这是 AI 项目里 SSOT 的终极形态

- **parse 失败不是异常，是业务分支**——配日志 + 重试 + 降级

一句话带走：

NOTE

**LLM 是一个「概率性最终」的组件，Zod 是你把它接回「确定性系统」的那座桥。**

下一篇是本章的终极实战——**构建一个完整的 AI Chat 接口，端到端类型安全**。把前面 13 篇讲过的东西全部整合进一个真实可部署的 demo，从 schema 定义、Hono 路由、LLM 调用、响应校验、前端表单、RPC 客户端一条链路跑通。
