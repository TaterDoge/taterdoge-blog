---
title: "33 LCEL 分支路由"
pubDate: 2026-04-22
description: "上一篇讲的是并行：同一份输入可以同时做几件事。这一篇刚好相反，要处理的是另一类很常见的问题："
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/9-lcel-branch/](https://aicompanion.usehook.cn/9-lcel-branch/)

## 1. 不是所有输入都该走同一条链

上一篇讲的是并行：同一份输入可以同时做几件事。这一篇刚好相反，要处理的是另一类很常见的问题：

**不同的输入，要走不同的链。**

拿 AI 伴侣来说，用户发来一句话以后，程序通常要先判断它属于哪一类：

- 普通聊天

- 技术问题

- 情绪倾诉

这三类输入如果都走同一个 Prompt，结果往往会很别扭：

- 技术问题会被回得太陪聊

- 情绪倾诉会被回得太像 FAQ

- 普通闲聊又可能被回得太正式

这就是 `RunnableBranch` 最适合出现的地方。

它负责做路由：先判断输入属于哪一类，再把它送进对应的处理链。

## 2. 为什么不直接写 if else

最直接的写法，通常是这样：

if-else.ts

```typescript
async function handleMessage(input: string) {
  if (input.includes('React') || input.includes('Next.js')) {
    return techChain.invoke({ input })
  }

  if (input.includes('难过') || input.includes('焦虑')) {
    return emotionalChain.invoke({ input })
  }

  return casualChain.invoke({ input })
}
```

代码能跑，但有三个问题：

- 路由逻辑跑到了链外

- 后面不容易继续接 `.pipe()`、`assign()`、fallback

- 调用入口变成了一个普通函数，不再是 Runnable

如果你前几篇已经把 LCEL 当成一条稳定管线在用，这里再突然切回 `if else`，整条链就断开了。

## 3. RunnableBranch 怎么读

`RunnableBranch` 的结构很像 `if / else if / else`。

前面是一组 `[条件, 处理链]`，最后放一个兜底链：

branch-basic.ts

```typescript
import { RunnableBranch } from '@langchain/core/runnables'

const routeByIntent = RunnableBranch.from([
  [
    ({ intent }: { intent: string }) => intent === 'tech',
    techChain,
  ],
  [
    ({ intent }: { intent: string }) => intent === 'emotional',
    emotionalChain,
  ],
  casualChain,
])
```

执行顺序也和 `if / else if / else` 一样：

- 从上到下检查条件

- 命中第一个 `true` 就立刻进入对应链

- 后面的条件不再继续检查

- 全都不满足时，走最后一个兜底链

顺序很重要。

如果两条条件都有可能命中，写在前面的那条会优先拿到机会。

## 4. 最常见的写法：先分类，再路由

在实际项目里，最常见的不是直接靠关键词判断，而是先让模型做一次轻量分类，再根据分类结果路由。

这套写法比较顺，因为它和前一篇的 `assign()` 能自然接起来：

classify-then-branch.ts

```typescript
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import {
  RunnableBranch,
  RunnablePassthrough,
} from '@langchain/core/runnables'
import { ChatOpenAI } from '@langchain/openai'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})

const classifyChain = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      '判断用户消息意图，只输出以下三个类别之一：',
      '- tech',
      '- emotional',
      '- casual',
    ].join('\n'),
  ],
  ['user', '{input}'],
])
  .pipe(model)
  .pipe(new StringOutputParser())

const routeByIntent = RunnableBranch.from([
  [
    ({ intent }: { intent: string }) => intent.trim() === 'tech',
    techChain,
  ],
  [
    ({ intent }: { intent: string }) => intent.trim() === 'emotional',
    emotionalChain,
  ],
  casualChain,
])

const chain = RunnablePassthrough
  .assign({ intent: classifyChain })
  .pipe(routeByIntent)
```

这条链可以直接按步骤理解：

- 输入先进来

- `assign()` 先补一个 `intent`

- `RunnableBranch` 再根据 `intent` 选链

这比纯关键词匹配稳很多，因为分类不是在匹配几个单词，而是在理解整句话的大意。

## 5. 把它接回 Agent：前置路由链

这篇真正要讲的重点，不是“怎么分支”，而是“怎么把分支接回 Agent”。

更典型的结构是：

- LCEL 先做意图分类和路由

- 不同分支负责补自己的上下文

- 最后再把整理好的结果交给 Agent

agent-branch.ts

```typescript
import { createAgent } from 'langchain'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import {
  RunnableBranch,
  RunnablePassthrough,
} from '@langchain/core/runnables'
import { ChatOpenAI } from '@langchain/openai'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})

// 先用一个轻量分类链，判断这条输入属于哪一类。
const classifyChain = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      '判断用户消息意图，只输出以下三个类别之一：',
      '- tech',
      '- emotional',
      '- casual',
    ].join('\n'),
  ],
  ['user', '{input}'],
])
  .pipe(model)
  .pipe(new StringOutputParser())

// 三条前置链分别给不同场景补一个 scene 字段。
const techPrefilter = RunnablePassthrough.assign({
  scene: () => 'tech',
})

const emotionalPrefilter = RunnablePassthrough.assign({
  scene: () => 'emotional',
})

const casualPrefilter = RunnablePassthrough.assign({
  scene: () => 'casual',
})

// 根据 classifyChain 的结果选择不同前置链。
const routeByIntent = RunnableBranch.from([
  [
    ({ intent }: { intent: string }) => intent.trim() === 'tech',
    techPrefilter,
  ],
  [
    ({ intent }: { intent: string }) => intent.trim() === 'emotional',
    emotionalPrefilter,
  ],
  casualPrefilter,
])

// 这一段还是 LCEL 前置链：先分类，再分支。
const preProcess = RunnablePassthrough
  .assign({ intent: classifyChain })
  .pipe(routeByIntent)

// Agent 负责拿到整理后的结果，生成最终回复。
const agent = createAgent({
  model,
  tools: [],
  systemPrompt: [
    '你是一个前端陪伴助手。',
    'scene=tech 时，优先回答技术问题。',
    'scene=emotional 时，先共情，再给一个小建议。',
    'scene=casual 时，就正常闲聊。',
  ].join('\n'),
})

// 先跑前置链，拿到 intent / scene / input。
const preProcessed = await preProcess.invoke({
  input: '今天开会被否了三次，心里有点堵。',
})

// 再把路由后的结果整理成消息，交给 Agent。
const result = await agent.invoke({
  messages: [
    {
      role: 'user',
      content: [
        `scene=${preProcessed.scene}`,
        `intent=${preProcessed.intent}`,
        `input=${preProcessed.input}`,
      ].join('\n'),
    },
  ],
})

// 最后一条消息就是这一轮的最终回复。
console.log(result.messages.at(-1)?.text ?? '')
```

这段代码里，分工是清楚的：

- `classifyChain` 负责意图分类

- `RunnableBranch` 负责把不同输入送进不同前置链

- `preProcess` 负责把路由结果整理好

- `agent` 负责最终回复

所以这里的 `RunnableBranch` 不是在替代 Agent，

而是在 **Agent 前面做路由**。

## 6. 什么时候用 RunnableBranch，什么时候用 RunnableLambda

这两个都能做路由，但适合的场景不一样。

**优先用 `RunnableBranch`**

- 分支数量固定

- 条件规则清楚

- 你希望结构一眼就能看懂

**再考虑 `RunnableLambda`**

- 分支来自配置、数据库或别的外部来源

- 不是简单的布尔条件，而是更动态的计算

- 你能接受把一部分控制逻辑拿回函数里

简单说：

- 分支固定，用 `RunnableBranch`

- 路由特别动态，再考虑 `RunnableLambda`

如果只是普通的意图路由，`RunnableBranch` 通常已经够用了。

## 7. 一个判断标准

看到这里，可以直接记一个很实用的判断标准：

如果你的问题是：

- 同一份输入，要不要同时做几件事

那通常是上一篇讲的 `assign()` / `RunnableParallel`。

如果你的问题是：

- 不同输入，要不要走不同链路

那通常就是这篇的 `RunnableBranch`。
