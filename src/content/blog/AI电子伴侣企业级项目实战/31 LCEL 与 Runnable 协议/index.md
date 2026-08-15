---
title: "31 LCEL 与 Runnable 协议"
pubDate: 2026-04-22
description: "在真实项目里，Agent 前后往往还会挂一些额外步骤。比如一条用户消息进来以后，程序可能先做这些事："
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/7-lcel-runnable/](https://aicompanion.usehook.cn/7-lcel-runnable/)

## 1. 在 Agent 应用里，为什么还要讲 LCEL

前面几篇一直在处理单个 Agent 的输入和输出：

- 消息怎么组织

- Prompt Template 怎么写

- Few-Shot 放在哪

- 输出什么时候直接展示，什么时候收成结构

到了这里，问题会变成另一种样子。

在真实项目里，Agent 前后往往还会挂一些额外步骤。比如一条用户消息进来以后，程序可能先做这些事：

- 去掉输入里的多余空格

- 补一个 `priority` 字段

- 先做一次结构化判断

- 再把处理结果交给模型

这些步骤不一定都属于 Agent 本体，但它们又确实在同一条调用链上。

LCEL 处理的就是这种场景。

`LCEL` 是 `LangChain Expression Language` 的缩写。它不是另一个模型，也不是另一个 Agent API，而是一套把节点接成链路的写法。

节点这个词可以先记得很朴素一点：

**只要一段东西能接收输入，再产出输出，它就可以是链上的一个节点。**

比如：

- Prompt 是一个节点

- Model 是一个节点

- Parser 是一个节点

- 一小段本地函数逻辑，也可以包成一个节点

上图里这几个方块不是按“类名百科”排出来的，而是在表示一条真实链路：

- 先保留原始输入，并补一点字段

- 再插一小段本地逻辑

- 再组织成 Prompt

- 再交给模型

- 最后把输出收回来

如果这些步骤都手写成一串 `await`，当然也能跑。但链路一长，代码就会越来越散。

LCEL 的作用，就是把这条链写成一个稳定的管线。

## 2. Runnable 是这条链的统一接口

LCEL 能把这么多不同东西串起来，底层靠的是同一个概念：`Runnable`。

这个词可以先直接理解成「可调用节点」。

只要一个节点遵守 Runnable 这套接口，它就能被接到链上。最常用的三种调用方式是：

- `invoke()`：处理一条输入

- `stream()`：流式返回结果

- `batch()`：并行处理多条输入

这也是为什么下面这些东西看起来不是一类对象，却都能用 `.pipe()` 接起来：

- `ChatPromptTemplate`

- `ChatOpenAI`

- `StringOutputParser`

- `RunnablePassthrough`

- `RunnableLambda`

从 LCEL 的角度看，它们做的事其实一样：

**接收输入，再把结果交给下一个节点。**

## 3. 先看一条最短的 LCEL 链

先不要急着看 `RunnablePassthrough` 和 `RunnableLambda`。

最短的一条 LCEL 链，前面几篇其实已经间接用过了：

lcel-basic.ts

```typescript
import { ChatOpenAI } from '@langchain/openai'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'

const prompt = ChatPromptTemplate.fromMessages([
  ['system', '你是一个前端开发助手，回答简洁。'],
  ['user', '{input}'],
])

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})

const parser = new StringOutputParser()

const chain = prompt.pipe(model).pipe(parser)

const result = await chain.invoke({
  input: '解释一下 Runnable 为什么重要。',
})

console.log(result)
```

前一个节点的输出正好是后一个节点的输入，所以这三段能直接串起来。

如果不用 `.pipe()`，也能手动写成下面这样：

manual-chain.ts

```typescript
const promptValue = await prompt.invoke({
  input: '解释一下 Runnable 为什么重要。',
})

const aiMessage = await model.invoke(promptValue)
const result = await parser.invoke(aiMessage)
```

这段没有错，只是它不太适合继续往后长。

一旦链路里再塞进「本地预处理」「规则判断」「结构化分析」这些步骤，你就得手动维护越来越多的中间变量。

LCEL 的价值就在这里：把「节点之间怎么接」写成显式结构。

## 4. 两个最常用的 Runnable

在日常项目里，最常见的两个 Runnable 是：

- `RunnablePassthrough`

- `RunnableLambda`

### 4.1 RunnablePassthrough

`RunnablePassthrough` 适合做一件事：

**保留当前输入，同时补几个新字段。**

比如一条输入刚进来时，你手里可能只有：

input.json

```json
{
  "input": "  线上刚修完故障，我现在有点乱。  "
}
```

后面的节点可能还想直接拿到：

- 去掉首尾空格后的文本

- 这段话的长度

这时候就可以用 `RunnablePassthrough.assign(...)`：

passthrough.ts

```typescript
import { RunnablePassthrough } from '@langchain/core/runnables'

const enrichInput = RunnablePassthrough.assign({
  trimmedInput: ({ input }: { input: string }) => input.trim(),
  inputLength: ({ input }: { input: string }) => input.trim().length,
})

const result = await enrichInput.invoke({
  input: '  线上刚修完故障，我现在有点乱。  ',
})

console.log(result)
```

返回结果会像这样：

result.json

```json
{
  "input": "  线上刚修完故障，我现在有点乱。  ",
  "trimmedInput": "线上刚修完故障，我现在有点乱。",
  "inputLength": 14
}
```

`input` 原封不动地留着，新字段也都挂上去了。

`RunnablePassthrough` 不是“什么都不做”，而是“原样保留，再补一点派生信息”。

### 4.2 RunnableLambda

`RunnableLambda` 适合放一小段本地逻辑。

比如你想在调模型前，先根据输入内容判断优先级。这个判断不需要模型，只是一点简单规则：

runnable-lambda.ts

```typescript
import { RunnableLambda } from '@langchain/core/runnables'

const detectPriority = RunnableLambda.from(
  ({ trimmedInput }: { trimmedInput: string }) => {
    const urgentWords = ['线上', '故障', '崩溃', '来不及']
    const isUrgent = urgentWords.some((word) => trimmedInput.includes(word))

    return {
      trimmedInput,
      priority: isUrgent ? 'high' : 'normal',
    }
  }
)

const result = await detectPriority.invoke({
  trimmedInput: '线上刚修完故障，我现在有点乱。',
})

console.log(result)
```

它适合承接这些轻量逻辑：

- 输入预处理

- 本地规则判断

- 补 Prompt 所需字段

- 一小段同步或异步计算

如果一段逻辑已经开始变得很长，里面全是分支、状态和副作用，那它就不该继续塞在一个 `RunnableLambda` 里了。

## 5. 把它接回 Agent 场景里

LCEL 最常见的落点，不是替代 Agent，而是放在 Agent 前后做一些稳定的小链路。

用一个具体例子来说：用户发来一句话，程序先清洗输入，再做本地优先级判断，最后把整理好的结果交给 Agent。

agent-prefilter.ts

```typescript
import { createAgent } from 'langchain'
import { ChatOpenAI } from '@langchain/openai'
import { RunnableLambda, RunnablePassthrough } from '@langchain/core/runnables'

// 先保留原始输入，再补一个去空格后的字段。
const enrichInput = RunnablePassthrough.assign({
  trimmedInput: ({ input }: { input: string }) => input.trim(),
})

// 插入一小段本地规则，用来判断这条输入是否更紧急。
const detectPriority = RunnableLambda.from(
  ({ trimmedInput }: { trimmedInput: string }) => {
    const priority = trimmedInput.includes('线上') ? 'high' : 'normal'

    return {
      trimmedInput,
      priority,
    }
  }
)

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})

// 这条链只负责 Agent 之前的预处理。
const preProcess = enrichInput.pipe(detectPriority)

// Agent 负责拿到整理后的消息，生成最终回复。
const agent = createAgent({
  model,
  tools: [],
  systemPrompt: [
    '你是一个前端陪伴助手。',
    '如果 priority=high，先帮用户稳住情绪，再给一个动作建议。',
    '如果 priority=normal，就正常交流，不要过度放大情绪。',
  ].join('\n'),
})

// 先跑前置链，拿到清洗后的输入和优先级。
const preProcessed = await preProcess.invoke({
  input: '  线上刚出故障，今晚估计又得加班。  ',
})

// 再把前置链的结果整理成消息，交给 Agent。
const result = await agent.invoke({
  messages: [
    {
      role: 'user',
      content: [
        `priority=${preProcessed.priority}`,
        `input=${preProcessed.trimmedInput}`,
      ].join('\n'),
    },
  ],
})

// Agent 最后一条消息就是这一轮最终回复。
console.log(result.messages.at(-1)?.text ?? '')
```

这段代码里，LCEL 和 Agent 的分工是分开的：

- `enrichInput` 负责输入清洗

- `detectPriority` 负责本地规则判断

- `preProcess` 把前两步接成一条前置链

- `agent` 负责接收整理后的消息并生成最终回复

如果拆成流程看，就是：

- 用户原始输入先进入 LCEL 前置链

- 前置链补出 `trimmedInput` 和 `priority`

- 程序把这两个字段整理进一条消息

- 再交给 `agent.invoke()`

这才是更典型的「Agent 前置链」写法。

## 6. 同一条链可以直接 invoke、stream、batch

同一条链，不改任何东西，直接支持三种调用方式。

**单次调用**

invoke.ts

```typescript
const result = await chain.invoke({
  input: '把 useOptimistic 的作用讲清楚。',
})
```

**流式输出**

stream.ts

```typescript
const stream = await chain.stream({
  input: '用三句话解释一下 Actions 表单提交流程。',
})

for await (const chunk of stream) {
  process.stdout.write(chunk)
}
```

**批量处理**

batch.ts

```typescript
const results = await chain.batch([
  { input: '今天状态不错，终于把问题收住了。' },
  { input: '又改需求了，我现在有点烦。' },
  { input: '晚上想补 React 19，但脑子有点转不动。' },
])

console.log(results)
```

调用的是整条链，不是某个节点。链搭好之后，invoke、stream、batch 随时切换，不需要额外适配。
