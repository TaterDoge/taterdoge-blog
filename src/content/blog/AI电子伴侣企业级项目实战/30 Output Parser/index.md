---
title: "30 Output Parser"
pubDate: 2026-04-21
description: "前面几篇一直在整理输入，这一篇开始看输出。在单个 Agent 应用里，输出通常只有两条路："
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/6-output-parser/](https://aicompanion.usehook.cn/6-output-parser/)

## 1. Agent 跑起来以后，输出要往哪走

前面几篇一直在整理输入，这一篇开始看输出。在单个 Agent 应用里，输出通常只有两条路：

- 直接给用户看

- 交给程序继续处理

例如同一轮请求结束后，Agent 可能回了这样一段话：

reply.txt

```txt
你今天已经被反复拉扯很多次了，烦是很正常的。先别继续追着所有问题跑，只把今天必须收尾的一件事列出来。先把节奏稳住，后面再慢慢拆。
```

如果只是显示在聊天窗口，这段话已经够用。

但如果程序下一步还要：

- 判断情绪是否已经升到焦虑

- 决定要不要触发安抚分支

- 写入结构化日志

- 给数据库存一条标准化记忆

那这段自然语言就不够用了。

Output Parser 处理的就是第二条线：把输出收成程序能继续消费的结果。

## 2. 先分清：不是所有 Agent 输出都要 parse

这里先把一个误区拎出来。

不是。

如果这一轮输出本来就是写给用户看的，自然语言往往就是最终形态。

例如：

index.ts

```typescript
const result = await agent.invoke({
  messages: [
    {
      role: 'user',
      content: '今天写了一天代码，脑子有点转不动了。',
    },
  ],
})

const finalText = result.messages.at(-1)?.text ?? ''

console.log(finalText)
```

这里最自然的处理方式就是直接拿最后一条消息的文本。

不需要为了“用了 parser”而硬把它再过一遍解析器。

后面只看一件事：什么时候直接拿文本，什么时候必须收成结构。

## 3. 给用户看的输出：文本就够了

如果当前 Agent 的结果只是继续展示给用户，最常见的做法其实很简单：

index.ts

```typescript
const result = await agent.invoke({
  messages: [
    {
      role: 'user',
      content: '今天被改了好多次需求，我现在真的有点烦。',
    },
  ],
})

const finalText = result.messages.at(-1)?.text ?? ''

console.log(finalText)
```

这条线的重点是可读性，不是结构化。

在单个 Agent 应用里，下面这些输出通常都属于这一类：

- 聊天回复

- 安抚用户的话

- 解释概念

- 总结一段内容

如果后面只是显示到页面上，或者交给下一个面向用户的节点继续改写，文本就够了。

## 4. 给程序读的输出：要单独做结构化节点

真正需要 Output Parser 的，通常不是 Agent 最后的陪聊回复，而是程序要拿去判断的那部分结果。

比如现在你希望系统在生成回复之前，先做一轮情绪分析：

- `emotion` 是什么

- `confidence` 有多少

- 要不要走安抚分支

这时候更稳的做法不是去 parse Agent 最后的自然语言，而是专门做一个“结构化分析节点”。

先看最常见的第一步：`JsonOutputParser`

index.ts

```typescript
import { JsonOutputParser } from '@langchain/core/output_parsers'
import { ChatOpenAI } from '@langchain/openai'
import { ChatPromptTemplate } from '@langchain/core/prompts'

const parser = new JsonOutputParser()

const prompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      '你负责做情绪识别。',
      '只返回 JSON，不要补充解释。',
      parser.getFormatInstructions(),
    ].join('\n'),
  ],
  ['user', '{input}'],
])

const model = new ChatOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})

const chain = prompt.pipe(model).pipe(parser)

const emotionResult = await chain.invoke({
  input: '今天一直在改 bug，越改越乱，我有点烦。',
})

console.log(emotionResult)
```

这段代码虽然不是直接调用 Agent，但它在 Agent 应用里很常见。它通常扮演的是 Agent 旁边的“判定节点”。

顺序很简单：

- 先用结构化节点做判断

- 程序根据结果决定分支

- 再把处理后的上下文交给 Agent 输出自然语言

`parser.getFormatInstructions()` 的作用是自动生成一段给 AI 的指令文本，告诉 AI 必须以什么样的 JSON 格式来输出结果。

LLM 如果不加约束，它可能在返回 JSON 的同时，加上一些废话，例如：

code.ts

```json
好的，这是你要的 JSON 结果： {...}
```

`getFormatInstructions()` 会生成一段标准化的英文指令，内容大概如下所示：

code.ts

```txt
The output should be formatted as a JSON instance that conforms to the JSON schema below. ... Return nothing but the JSON.
```

这是为了在提示词层面强制要求 AI 遵循 JSON 的语法规范，从而提高解析的成功率

## 5. 只会 JSON 还不够，还要校验

只解析成 JSON 还不够，因为 JSON 只保证“像对象”，不保证“对象一定符合业务约束”。

例如下面两段都算合法 JSON：

index.json

```json
{ "emotion": "anxious", "confidence": 0.82 }
```

index.json

```json
{ "emotion": 123, "confidence": "high" }
```

对解析器来说，这两段都能过；对业务来说，第二段完全不能用。

所以真正落到程序逻辑里，还要再加一层 schema 校验。

index.ts

```typescript
import { z } from 'zod'

const emotionSchema = z.object({
  emotion: z.enum(['calm', 'anxious', 'sad', 'angry']),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1),
})
```

这层校验的价值很直接：

- `emotion` 只能是约定枚举

- `confidence` 必须落在 0 到 1 之间

- `summary` 不能为空

这样程序拿到的结果，才真的能继续往下流。

## 6. JsonOutputParser 和 withStructuredOutput() 是两条路

这两个东西经常被混在一起。

直接分开记会更清楚：

- `JsonOutputParser`：先让模型输出文本，再把文本解析成 JSON

- `withStructuredOutput()`：让模型直接按 schema 产出结构化结果

也就是说，后者不是“另一个 parser”，而是更靠前的一种结构化输出方式。

如果当前 provider 和 model 支持结构化输出，可以直接把 schema 绑到模型上：

index.ts

```typescript
import { ChatOpenAI } from '@langchain/openai'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { z } from 'zod'

const emotionSchema = z.object({
  emotion: z.enum(['calm', 'anxious', 'sad', 'angry']),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
})

const model = new ChatOpenAI({
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY,
})

const structuredModel = model.withStructuredOutput(emotionSchema)

const prompt = ChatPromptTemplate.fromMessages([
  ['system', '判断用户情绪，并给出简短摘要。'],
  ['user', '{input}'],
])

const chain = prompt.pipe(structuredModel)

const result = await chain.invoke({
  input: '我本来想晚上学一会儿 React，结果又被线上问题打断了。',
})

console.log(result)
```

这里切到 OpenAI，只是为了给一个常见示例。

不是说前面用的 DeepSeek 就不能继续用，而是 `withStructuredOutput()` 的可用性要看具体 provider 和 model 的支持情况。

在 Agent 系统里，可以把它理解成：

- 如果模型支持，就用结构化输出直接产出程序结果

- 如果不支持，就退回到“文本 JSON + parser + schema 校验”

## 7. 解析失败时，兜底只是兜底

输出解析最怕的不是模型答错，而是“看起来差不多，但格式不完全对”。

例如：

- JSON 前面多了一句解释

- 某个字段拼错

- `confidence` 返回成字符串

- 枚举值超出约定范围

这时候最好把问题分层看：

| 层级 | 常见问题 |
| --- | --- |
| 模型生成 | 输出根本不是 JSON |
| 解析阶段 | JSON 语法不合法 |
| 校验阶段 | 字段类型不对，schema 不通过 |
| 业务阶段 | 字段合法，但不满足业务规则 |

如果要兜底，也要把它当成失败分支，不要把它当成正常结果。

index.ts

```typescript
import { z } from 'zod'

const emotionSchema = z.object({
  emotion: z.enum(['calm', 'anxious', 'sad', 'angry']),
  confidence: z.number().min(0).max(1),
})

function safeParseEmotion(input: unknown) {
  const result = emotionSchema.safeParse(input)

  if (result.success) {
    return result.data
  }

  return {
    emotion: 'calm' as const,
    confidence: 0.5,
    fallback: true,
  }
}
```

这里这个默认值只是演示失败路径，不是通用默认策略。

有些节点适合兜底，有些节点更适合直接重试或中断
