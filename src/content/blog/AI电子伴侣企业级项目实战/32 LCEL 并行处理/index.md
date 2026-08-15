---
title: "32 LCEL 并行处理"
pubDate: 2026-04-22
description: "上一篇已经把 LCEL 最基础的链路搭起来了：节点怎么接、.pipe 怎么串、Runnable 为什么能统一调用。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/8-lcel-advanced/](https://aicompanion.usehook.cn/8-lcel-advanced/)

## 1. 一条输入，不一定只做一件事

上一篇已经把 LCEL 最基础的链路搭起来了：节点怎么接、`.pipe()` 怎么串、`Runnable` 为什么能统一调用。

但在真实项目里，链路通常不会只是一条直线。

拿 AI 伴侣来说，用户发来一句话以后，程序很可能要先同时做几件事：

- 判断情绪

- 提取关键词

- 做一次风险检查

这三件事经常互不依赖。

如果一个接一个串行跑，总耗时就是三段相加；如果能并行跑，耗时就只看最慢的那一段。

这一篇要讲的就是 LCEL 里处理这类问题的两个工具：

- `RunnableParallel`

- `RunnablePassthrough.assign()`

它们的区别不在“谁更高级”，而在于：

- 并行结果是不是已经够用了

- 后面的 Agent 还要不要继续读取原始输入

## 2. 先看最容易写出来的并行代码

假设你已经有三条独立子链，分别负责：

- 情绪判断

- 关键词提取

- 风险检查

最直接的写法，通常是 `Promise.all`：

parallel-manual.ts

```typescript
const input = '今天线上刚修完，脑子还是绷着的。'

const [emotion, keywords, risk] = await Promise.all([
  emotionChain.invoke({ input }),
  keywordChain.invoke({ input }),
  riskChain.invoke({ input }),
])

const result = { emotion, keywords, risk }
```

这段代码当然能跑，但它有几个问题：

- 并行结果要自己手动拼

- 结果不容易继续接进 LCEL 链

- 相同输入要重复传三次

一开始步骤少的时候还好，后面链路一长，就会越来越散。

## 3. RunnableParallel：同一份输入，同时喂给多个节点

`RunnableParallel` 做的事情很直接：

把同一份输入同时交给多个节点，再按你定义的 key 收集结果。

runnable-parallel.ts

```typescript
import { RunnableParallel } from '@langchain/core/runnables'

const parallel = RunnableParallel.from({
  emotion: emotionChain,
  keywords: keywordChain,
  risk: riskChain,
})

const result = await parallel.invoke({
  input: '今天线上刚修完，脑子还是绷着的。',
})

console.log(result)
```

返回值会长成这样：

parallel-result.json

```json
{
  "emotion": { "emotion": "anxious", "confidence": 0.88 },
  "keywords": ["线上", "修复", "紧张"],
  "risk": { "level": "medium" }
}
```

这里有三个关键点：

- 输入只传一次

- 子链同时执行

- 输出按 key 自动组装

如果后面的节点只需要这几个并行结果，不需要用户原话，那 `RunnableParallel` 已经够用了。

## 4. 一个很快会碰到的问题：原始输入不见了

`RunnableParallel` 的输出只包含你定义的那些 key。

也就是说，上面那段代码执行完以后，得到的是：

parallel-output.json

```json
{
  "emotion": { ... },
  "keywords": [...],
  "risk": { ... }
}
```

原来的 `input` 已经不在里面了。

这在普通链里不一定是问题，但一旦要接回 Agent，就很容易卡住。

因为后面的 Agent 往往既想知道：

- 用户情绪是什么

- 风险高不高

也想继续看到用户原话。

如果原始输入没了，后面还得自己手动透传回来，代码就会开始别扭。

## 5. assign()：保留原始输入，再并行补字段

这时候更常用的其实不是 `RunnableParallel`，而是 `RunnablePassthrough.assign()`。

它的作用可以直接记成一句话：

**保留当前输入对象，再把新字段补上去。**

assign-basic.ts

```typescript
import { RunnablePassthrough } from '@langchain/core/runnables'

const enriched = RunnablePassthrough.assign({
  emotion: emotionChain,
  keywords: keywordChain,
  risk: riskChain,
})

const result = await enriched.invoke({
  input: '今天开会被否了三次，我有点乱。',
})

console.log(result)
```

输出会变成：

assign-result.json

```json
{
  "input": "今天开会被否了三次，我有点乱。",
  "emotion": { "emotion": "sad", "confidence": 0.79 },
  "keywords": ["开会", "被否定", "混乱"],
  "risk": { "level": "low" }
}
```

这里最重要的区别是：

- `input` 还在

- 并行结果是追加进去的

所以如果后面还要继续接 Prompt、Agent、结构化输出链，`assign()` 往往更顺。

## 6. 把它接回 Agent：前置并行链

这篇最重要的不是“怎么并行”，而是“并行完以后怎么接回 Agent”。

更典型的写法是：

- 先用 LCEL 前置链并行补字段

- 再把补好的结果交给 Agent

agent-parallel-prefilter.ts

```typescript
import { createAgent } from 'langchain'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { JsonOutputParser } from '@langchain/core/output_parsers'
import { RunnablePassthrough } from '@langchain/core/runnables'
import { ChatOpenAI } from '@langchain/openai'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})

// 注意：模板里的 JSON 花括号必须用双花括号转义
// 否则 {emotion}、{confidence}、{level} 会被当成模板变量
const emotionChain = ChatPromptTemplate.fromMessages([
  ['system', '分析用户情绪，只返回 JSON：{{"emotion":"", "confidence":0}}'],
  ['user', '{input}'],
])
  .pipe(model)
  .pipe(new JsonOutputParser())

const keywordChain = ChatPromptTemplate.fromMessages([
  ['system', '提取这句话里的关键词，只返回 JSON 数组。'],
  ['user', '{input}'],
])
  .pipe(model)
  .pipe(new JsonOutputParser())

const riskChain = ChatPromptTemplate.fromMessages([
  ['system', '判断这句话是否需要额外安抚，只返回 JSON：{{"level":"low|medium|high"}}'],
  ['user', '{input}'],
])
  .pipe(model)
  .pipe(new JsonOutputParser())

// 前置链：保留原始输入，同时并行补 emotion / keywords / risk
const preProcess = RunnablePassthrough.assign({
  emotion: emotionChain,
  keywords: keywordChain,
  risk: riskChain,
})

const agent = createAgent({
  model,
  tools: [],
  systemPrompt: [
    '你是一个前端陪伴助手。',
    '如果 risk=high，先安抚，再给一个很小的动作建议。',
    '如果 risk=low，就正常交流，不要过度放大情绪。',
  ].join('\n'),
})

const preProcessed = await preProcess.invoke({
  input: '今天线上刚修完，脑子还是绷着的。',
})

const result = await agent.invoke({
  messages: [
    {
      role: 'user',
      content: [
        `input=${preProcessed.input}`,
        `emotion=${JSON.stringify(preProcessed.emotion)}`,
        `keywords=${JSON.stringify(preProcessed.keywords)}`,
        `risk=${JSON.stringify(preProcessed.risk)}`,
      ].join('\n'),
    },
  ],
})

console.log(result.messages.at(-1)?.text ?? '')
```

这段代码里有两个层次：

- `preProcess` 是 LCEL 前置链

- `agent` 是最终回复入口

前置链负责把上下文补全，Agent 负责拿这些上下文生成最终回复。

这就是 `assign()` 在 Agent 场景里最常见的位置。

## 7. RunnableParallel 和 assign() 怎么选

可以直接按这个标准判断：

**用 `RunnableParallel`**

- 并行结果本身就是最终结果

- 后面不需要原始输入

- 你只想收一个并行结果对象

**用 `assign()`**

- 后面还要继续接 Prompt 或 Agent

- 原始输入不能丢

- 你想在原对象上逐步补字段

在单个 Agent 应用里，`assign()` 往往更常见。

因为 Agent 几乎总还要继续读取用户原话。
