---
title: "35 Memory"
pubDate: 2026-04-23
description: "import { ChatOpenAI } from '@langchain/openai'"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/11-memory-conversation/](https://aicompanion.usehook.cn/11-memory-conversation/)

## 1. 多轮对话不是自动成立的

前面几篇基本都还是「单轮」视角：

用户发一条消息，链路跑完，拿到一个结果。

但 AI 伴侣真正难的地方，不在单轮，而在多轮。

用户很少会把一件事一次说完。更常见的是：

- 第一轮只说「我今天加班到很晚」

- 第二轮补一句「还是因为上次那个需求」

- 第三轮又说「我在想要不要直接找产品聊一次」

如果模型每次只看到当前这句话，它就不会知道：

- 这几句话其实在说同一件事

- 「上次那个需求」指的是前面聊过的内容

- 用户情绪是在逐步累积，不是突然冒出来的

问题不在模型“笨”，而在于：

**模型本身没有记忆。**

每次调用默认都是独立的。要想让多轮对话接得上，就必须把历史重新带回去。

## 2. 最直接的办法：手动带历史

最原始的写法，就是自己维护一个消息数组，每次都把历史一起传进去：

manual-history.ts

```typescript
import { ChatOpenAI } from '@langchain/openai'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})

const history = [
  { role: 'user', content: '我今天加班到很晚' },
  { role: 'assistant', content: '辛苦了，加班到几点？' },
]

const response = await model.invoke([
  ...history,
  { role: 'user', content: '还是因为上次那个需求' },
])

console.log(response.text)

history.push({ role: 'user', content: '还是因为上次那个需求' })
history.push(response)
```

这个方案能跑，但很快就会出现几个问题：

- 每次都要自己拼历史

- 每次都要自己写回新消息

- 历史越来越长，token 会一直涨

- 历史管理完全在链外面，后面很难继续接 LCEL

所以真正的问题不是“能不能把历史传进去”，而是：

**能不能让历史读写也进入同一条链。**

## 3. 把历史读写放回链里：RunnableWithMessageHistory

如果你现在写的是 LCEL 链，这里直接用 `RunnableWithMessageHistory`。

它做的事情很明确：

- 调用前先读取这段会话的历史消息

- 把历史消息自动注入 `MessagesPlaceholder`

- 调用结束后，再把本轮输入输出写回去

memory-lcel.ts

```typescript
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'
import { ChatOpenAI } from '@langchain/openai'
import { RunnableWithMessageHistory } from '@langchain/core/runnables'
import { ChatMessageHistory } from '@langchain/classic/stores/message/in_memory'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})

// 这里的 history 是给历史消息预留的位置。
const prompt = ChatPromptTemplate.fromMessages([
  ['system', '你是一个善于倾听的 AI 伴侣。'],
  new MessagesPlaceholder({ variableName: 'history' }),
  ['user', '{input}'],
])

const chain = prompt.pipe(model)

// 这里用内存 Map 模拟会话存储。服务一重启，数据就会丢。
const store = new Map<string, ChatMessageHistory>()

function getMessageHistory(sessionId: string) {
  if (!store.has(sessionId)) {
    store.set(sessionId, new ChatMessageHistory())
  }

  return store.get(sessionId)!
}

// 这层把“读历史”和“写历史”都包进 Runnable 体系里。
const chainWithHistory = new RunnableWithMessageHistory({
  runnable: chain,
  getMessageHistory,
  inputMessagesKey: 'input',
  historyMessagesKey: 'history',
})
```

调用时只要给同一个 `sessionId`，历史就会接上：

memory-lcel-invoke.ts

```typescript
await chainWithHistory.invoke(
  { input: '我今天加班到很晚' },
  {
    configurable: {
      sessionId: 'user-001',
    },
  },
)

await chainWithHistory.invoke(
  { input: '快 11 点了，还是因为上次那个需求' },
  {
    configurable: {
      sessionId: 'user-001',
    },
  },
)
```

这里最适合新手先记住的是：

- `sessionId` 决定这是哪一段对话

- `MessagesPlaceholder` 决定历史插到 Prompt 的哪个位置

- `RunnableWithMessageHistory` 负责自动读写

## 4. 把它接回 Agent：checkpointer + thread_id

如果继续往 Agent 这边写，短期记忆就直接接到 Agent 里，不再单独管理 `RunnableWithMessageHistory`。

核心是两样东西：

- `checkpointer`

- `thread_id`

可以先把它理解成一句话：

**同一个 `thread_id` 代表同一段会话，`checkpointer` 负责把这段会话的状态存下来。**

agent-short-term-memory.ts

```typescript
import { createAgent, summarizationMiddleware } from 'langchain'
import { MemorySaver } from '@langchain/langgraph'

// checkpointer 负责保存这条会话线程里的短期状态。
const checkpointer = new MemorySaver()

const agent = createAgent({
  model: 'gpt-4.1',
  tools: [],
  // 对话变长以后，用 middleware 帮你做摘要压缩。
  middleware: [
    summarizationMiddleware({
      model: 'gpt-4.1-mini',
      trigger: { tokens: 4000 },
      keep: { messages: 20 },
    }),
  ],
  checkpointer,
})

const config = {
  configurable: {
    // 同一个 thread_id，就会读到同一段短期记忆。
    thread_id: 'companion-user-001',
  },
}

await agent.invoke(
  {
    messages: [{ role: 'user', content: '我今天加班到快 11 点' }],
  },
  config,
)

await agent.invoke(
  {
    messages: [{ role: 'user', content: '还是上次那个需求，改了好几版了' }],
  },
  config,
)

const result = await agent.invoke(
  {
    messages: [{ role: 'user', content: '你还记得我刚才在烦什么吗？' }],
  },
  config,
)

console.log(result.messages.at(-1)?.content)
```

这段代码里可以分成三层理解：

- `checkpointer` 负责存线程状态

- `thread_id` 负责标识这是哪段会话

- `summarizationMiddleware` 负责在对话很长时压缩历史

这样写以后，短期记忆已经不再是 classic Memory 那套类自己管，而是进入了 Agent 的线程状态层。

## 5. 什么时候用哪一种

如果你现在写的是 LCEL 链，本篇最实用的选择通常是：

- `RunnableWithMessageHistory`

如果你现在写的是 Agent，更顺手的选择通常是：

- `createAgent + checkpointer + thread_id`

可以直接这样记：

**LCEL 链看 `RunnableWithMessageHistory`**

**Agent 看 `checkpointer`**

这两者解决的是同一类问题：

怎么把前面的对话重新带回这一轮。

只是接入位置不一样。

## 6. classic Memory 放在哪里理解

你前面如果看过旧教程，大概率会见过这些类：

- `BufferMemory`

- `ConversationBufferWindowMemory`

- `ConversationSummaryMemory`

- `ConversationSummaryBufferMemory`

- `ConversationChain`

这些内容今天仍然有理解价值，但更适合放在“兼容层 / 旧资料对照”这个位置，而不是正文入口。

它们分别代表的策略其实很容易概括：

- `BufferMemory`：全量保留

- `ConversationBufferWindowMemory`：只留最近几轮

- `ConversationSummaryMemory`：把早期历史压成摘要

- `ConversationSummaryBufferMemory`：最近保留原文，更早压成摘要

如果你是在读旧文章、旧项目代码，这几个名字仍然值得认识。

但如果你在写新代码，优先顺序应该反过来：

- 先学 `RunnableWithMessageHistory`

- 再学 `createAgent + checkpointer`

- 最后再把 classic Memory 当成旧体系补充理解

## 7. 一个很实用的边界

这篇讲的，其实都还是「短期会话记忆」。

也就是说，它解决的是：

- 当前这段聊天怎么接住上下文

它不解决的是：

- 三个月前你说过自己喜欢爬山

- 上周你提过要换工作

- 你长期偏好的聊天方式是什么

这些已经不是短期会话记忆，而是长期记忆或持久化存储的问题。

下一篇再接着讲这一层，会更顺。
