---
title: "34 LCEL 容错机制"
pubDate: 2026-04-23
description: "const primaryChain = prompt.pipeprimaryModel.pipeparser"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/10-lcel-fallback/](https://aicompanion.usehook.cn/10-lcel-fallback/)

## 1. 数据能流起来，还不够

前两篇讲了两件事：

- 同一份输入可以并行处理

- 不同输入可以走不同分支

但链路能跑起来，不等于上线以后就稳。

在真实项目里，最容易被忽略的问题其实是：

**某一段链突然失败了怎么办。**

对 AI 伴侣这类直接面向用户的产品来说，失败一般不只一种：

- 模型请求超时

- provider 限流

- 服务偶发抖动

- 输出格式不对，parser 解析失败

- 某个模型临时不可用

如果整条链没有容错层，任何一段失败都会直接把异常抛给用户。

这一篇要讲的，就是 LCEL 里最常用的两个容错工具：

- `withRetry()`

- `withFallbacks()`

但这次不只讲普通链，而是把它接回 Agent 场景里看。

## 2. withRetry() 解决的是临时性错误

`withRetry()` 适合处理这样一类问题：

- 再试一次，可能就恢复了

比如：

- 网络超时

- 429 限流

- provider 偶发 500

最简单的用法是直接加在某个 Runnable 上：

retry-basic.ts

```typescript
const safeModel = model.withRetry({
  stopAfterAttempt: 3,
})
```

这里的 `stopAfterAttempt: 3` 表示总共尝试 3 次。

第一次算 1 次，后面再补 2 次重试。

如果这 3 次都失败，错误才会真正抛出来。

在实际项目里，最常加 retry 的位置通常不是整条链，而是模型这一层。

因为最容易抖动的，往往就是外部模型调用。

## 3. withFallbacks() 解决的是这条路本身不通

有些错误不是“再试一次可能就好”，而是这条路本身暂时不适合继续走。

比如：

- 当前模型临时不可用

- 某个 provider 正在抖

- 输出格式始终不稳定

这时候更需要的不是 retry，而是切到备用链。

fallback-basic.ts

```typescript
const primaryChain = prompt.pipe(primaryModel).pipe(parser)
const backupChain = prompt.pipe(backupModel).pipe(parser)

const safeChain = primaryChain.withFallbacks([backupChain])
```

它的执行顺序很直接：

- 先跑主链

- 主链失败，再跑备用链

- 备用链也失败，才真正抛错

如果你有多个备用方案，也可以继续往后排：

fallback-multi.ts

```typescript
const safeChain = primaryChain.withFallbacks([
  backupChain,
  finalFallbackChain,
])
```

## 4. 顺序很重要：先 retry，再 fallback

这两个工具经常一起用，但顺序不能乱。

更符合预期的写法通常是：

retry-then-fallback.ts

```typescript
const safeModel = primaryModel
  .withRetry({ stopAfterAttempt: 2 })
  .withFallbacks([backupModel])
```

它表达的是：

- 主模型先重试两次

- 还是失败，再切备用模型

如果顺序反过来：

fallback-then-retry.ts

```typescript
const wrong = primaryModel
  .withFallbacks([backupModel])
  .withRetry({ stopAfterAttempt: 2 })
```

读起来就不是这个意思了。

所以大多数时候，都优先记成一句话：

**先 retry，再 fallback。**

## 5. Parser 失败，也可以单独兜底

还有一类失败，不是模型没回，而是模型回了，但格式不对。

比如你明明要求它只输出 JSON，它却前面多说了一句解释。

这时候模型调用本身是成功的，但 `JsonOutputParser` 会失败。

最简单的办法有两种：

**给 parser 所在链加 retry**

parser-retry.ts

```typescript
const chain = prompt
  .pipe(model)
  .pipe(new JsonOutputParser())
  .withRetry({ stopAfterAttempt: 2 })
```

**给 parser 准备一个更宽松的 fallback**

parser-fallback.ts

```typescript
import { AIMessage } from '@langchain/core/messages'
import { JsonOutputParser } from '@langchain/core/output_parsers'
import { RunnableLambda } from '@langchain/core/runnables'

const looseJsonParser = RunnableLambda.from((message: AIMessage | string) => {
  const text =
    typeof message === 'string'
      ? message
      : typeof message.content === 'string'
        ? message.content
        : message.content
            .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
            .join('\n')

  const match = text.match(/\{[\s\S]*\}/)
  if (match) {
    return JSON.parse(match[0])
  }

  return { emotion: 'unknown', confidence: 0 }
})

const safeParser = new JsonOutputParser().withFallbacks([looseJsonParser])
```

这种做法不是为了让结果更漂亮，而是为了让链在格式偶发不稳定时还能继续走下去。

## 6. 把它接回 Agent：三层容错

这篇真正关键的不是 retry 和 fallback 本身，而是它们在 Agent 链路里该放在哪。

更常见的做法是分三层：

- 前置链失败，要不要给默认值

- 模型失败，要不要切备用模型

- 整条回复链都失败了，要不要给用户一条保底回复

agent-resilient.ts

```typescript
import { createAgent } from 'langchain'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { JsonOutputParser, StringOutputParser } from '@langchain/core/output_parsers'
import { RunnableLambda, RunnablePassthrough } from '@langchain/core/runnables'
import { ChatOpenAI } from '@langchain/openai'

const primaryModel = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})

const backupModel = new ChatOpenAI({
  model: process.env.DEEPSEEK_MODEL_FALLBACK ?? 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})

// 模型层容错：主模型先 retry，再切到备用模型。
const safeModel = primaryModel
  .withRetry({ stopAfterAttempt: 2 })
  .withFallbacks([
    backupModel.withRetry({ stopAfterAttempt: 2 }),
  ])

// 前置分析链：负责给 Agent 补一个 emotion 字段。
const emotionChain = ChatPromptTemplate.fromMessages([
  ['system', '分析用户情绪，只返回 JSON：{"emotion":"", "confidence":0}'],
  ['user', '{input}'],
])
  .pipe(safeModel)
  .pipe(new JsonOutputParser())

// 如果情绪分析失败，就退到一个最小默认值，别让整条链直接中断。
const safeEmotionChain = emotionChain.withFallbacks([
  RunnableLambda.from(() => ({
    emotion: 'unknown',
    confidence: 0,
  })),
])

// 这条前置链负责保留原始输入，并补 emotion。
const preProcess = RunnablePassthrough.assign({
  emotion: safeEmotionChain,
})

const agent = createAgent({
  model: safeModel,
  tools: [],
  systemPrompt: [
    '你是一个前端陪伴助手。',
    '如果 emotion 显示用户情绪低落，先共情，再给一个小建议。',
    '如果 emotion 不明确，就正常交流，不要编造分析结果。',
  ].join('\n'),
})

// 整条链最后的兜底：如果 Agent 回复这一步都失败了，至少返回固定文案。
const finalFallback = RunnableLambda.from(
  () => '我现在状态不太稳定，但我还在这里。你刚刚说的内容我已经收到了，等我恢复后会继续陪你。'
)

async function runAgent(input: string) {
  // 第 1 层：先跑前置链，尽量把分析结果补齐。
  const preProcessed = await preProcess.invoke({ input })

  // 第 2 层：再把整理后的消息交给 Agent。
  const replyChain = RunnableLambda.from(async () => {
    const result = await agent.invoke({
      messages: [
        {
          role: 'user',
          content: [
            `input=${preProcessed.input}`,
            `emotion=${JSON.stringify(preProcessed.emotion)}`,
          ].join('\n'),
        },
      ],
    })

    return result.messages.at(-1)?.text ?? ''
  })

  // 第 3 层：如果回复链也失败，就落到最后一层固定文案。
  return replyChain.withFallbacks([finalFallback]).invoke({})
}

const reply = await runAgent('今天加班到很晚，有点撑不住了。')

console.log(reply)
```

这段代码里，容错层是分开的：

- `safeModel` 处理模型抖动

- `safeEmotionChain` 处理前置分析失败

- `finalFallback` 处理最后整条回复链失败

这样写的好处是：

不是所有失败都往同一层堆，而是每一层只兜自己那一类问题。

## 7. 一个简单的判断标准

如果你在想某个失败该放哪一层处理，可以直接按这个顺序判断：

**这次失败是不是偶发抖动？**

- 是，用 `withRetry()`

**这条路是不是暂时不可靠？**

- 是，用 `withFallbacks()`

**这一层失败以后，后面的链还能不能继续？**

- 能继续，就给默认值兜住

- 不能继续，就给用户一个最终保底回复

对直接面向用户的回复链来说，最后一层纯函数兜底通常都值得准备。

它不一定聪明，但至少稳定。
