---
title: "27 消息协议"
pubDate: 2026-04-20
description: "这说明在 LangChain 里，尤其到了 Agent 这一层，真正重要的输入单位已经不是「一句话」，而是「一组带角色的上下文」。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-04-23
---
原文链接：[https://aicompanion.usehook.cn/3-chatmodel-messages/](https://aicompanion.usehook.cn/3-chatmodel-messages/)

## 1. 概述

上一篇里，我们已经把最小 Agent 跑通了。

调用代码长这样：

index.ts

```typescript
const inputMessages = {
  role: 'user',
  content: '请用一句话说明当前是 Agent 流式调用验证。',
}

const stream = await agent.stream({
  messages: [inputMessages],
}, {
  streamMode: 'messages',
})
```

这里最值得注意的地方不是 `stream()`，而是 `messages`。

传给 Agent 的不是一段字符串，而是一组消息。

这说明在 LangChain 里，尤其到了 Agent 这一层，真正重要的输入单位已经不是「一句话」，而是「一组带角色的上下文」。

这一篇就专门讲这件事。

## 2. 为什么 Agent 要吃消息数组

如果只是一次最简单的生成，模型当然可以直接吃字符串：

index.ts

```typescript
const response = await model.invoke('帮我写一句晚安问候')
```

但只要开始做 Agent，很快就会遇到这些内容：

- 系统设定

- 用户这一轮输入

- 模型上一轮说过的话

- 工具执行结果

- 多轮对话历史

如果把这些内容全都揉成一段长字符串，代码也不是不能跑，但会有两个明显问题。

**第一，角色容易混。**

你很难稳定区分哪些是系统规则，哪些是用户输入，哪些又是模型自己上一轮说的话。

**第二，上下文难维护。**

一旦后面接上工具、记忆、历史消息，这段大字符串会越来越长，也越来越难改。

所以 LangChain 会把这些内容都整理成消息。从 Agent 的角度看，这样更自然：

- Agent 接收的是一组消息

- Agent 根据消息判断下一步怎么做

- Agent 再把新的消息加回这条上下文里

## 3. 先记住四种角色

这一阶段不需要把所有消息类名都背下来，先把下面四种角色搞懂就够用了：

| 角色 | 谁发出的 | 它在对话里做什么 |
| --- | --- | --- |
| system | 开发者 / 系统 | 给 Agent 立规则、定身份 |
| user | 用户 | 表达这一轮的问题或要求 |
| assistant | 模型 / Agent | 表示 Agent 自己给出的回复 |
| tool | 工具执行层 | 把工具运行结果回给 Agent |

前面三种最常见，第四种会在后面讲工具调用时变得很重要。

你也可以先用更直白的话记它们：

- `system`：告诉 Agent 你是谁

- `user`：告诉 Agent 用户现在要什么

- `assistant`：告诉 Agent 你刚刚说过什么

- `tool`：告诉 Agent 工具刚刚做完了什么

## 4. 先用最容易上手的写法

在 `LangChain` 里，消息有两种常见写法：

- 直接写对象字面量

- 显式使用消息类

当前这个阶段，更建议你先用对象字面量，因为最短、最直观。

比如直接调模型：

index.ts

```typescript
const response = await model.invoke([
  {
    role: 'system',
    content: '你是一名说话简洁的开发助手。',
  },
  {
    role: 'user',
    content: '请解释一下为什么 Agent 要用消息数组。',
  },
])

console.log(response.text)
```

再比如上一篇里的 Agent 调用：

index.ts

```typescript
const stream = await agent.stream({
  messages: [
    {
      role: 'user',
      content: '解释一下消息协议。',
    },
  ],
}, {
  streamMode: 'messages',
})
```

这两段代码其实都在做同一件事：

把输入整理成消息，再交给模型或者 Agent。

如果后面你开始显式操作消息对象，也会看到这样的导入方式：

index.ts

```typescript
import { HumanMessage, SystemMessage } from 'langchain'
// import { HumanMessage, SystemMessage } from '@langchain/core/messages'
```

## 5. 把消息放回 Agent 运行过程里

如果只是讲消息角色，很容易停在概念层。把它放回 `Agent` 的实际运行过程里，就会清楚很多。

先看一个最小 Agent：

index.ts

```typescript
import { createAgent } from 'langchain'
import { ChatOpenAI } from '@langchain/openai'

const model = new ChatOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})

const agent = createAgent({
  model,
  tools: [],
  systemPrompt: '你是一名说话自然、简短的开发助手。',
})
```

这里的 `systemPrompt` 可以理解成 Agent 的默认设定。

真正运行时，再把当前这一轮输入通过 `messages` 传进去：

index.ts

```typescript
const stream = await agent.stream({
  messages: [
    {
      role: 'user',
      content: '解释一下消息协议。',
    },
  ],
}, {
  streamMode: 'messages',
})
```

所以在这一层，关系可以先这样理解：

- `systemPrompt`：Agent 自带的长期设定

- `messages`：当前这轮请求带进来的上下文

前期写代码时，一个很稳的做法是：

- 人设、规则、语气要求，放进 `systemPrompt`

- 用户输入、多轮上下文、工具结果，放进 `messages`

这样代码结构最清楚。

## 6. 多轮对话和工具调用，为什么都离不开消息

单轮调用时，消息的价值还不算特别明显。

一旦进入多轮对话，它就立刻变得很重要。

比如下面这组消息：

index.ts

```typescript
const messages = [
  {
    role: 'system',
    content: '你是一名温和、克制的陪伴助手。',
  },
  {
    role: 'user',
    content: '我今天被需求折腾得很烦。',
  },
  {
    role: 'assistant',
    content: '先别急，和我说说最烦的是哪一段。',
  },
  {
    role: 'user',
    content: '明明昨天定好的方案，今天又全改了。',
  },
]
```

如果没有中间这条 `assistant` 消息，模型看到的就只是两条用户输入。

带上它之后，Agent 才能更自然地接着往下说。

工具调用也是一样。

当 Agent 判断要调用工具时，流程通常会变成：

- 用户发来请求

- Agent 判断要不要调工具

- 工具执行

- 工具结果回到消息流里

- Agent 再继续生成最终回复

也就是说，工具结果并不是“额外塞回模型”的一段文本，它也是消息流的一部分。

这就是为什么后面一旦进入 `Tool` 和 `Agent`，消息协议就会变得越来越重要。

NOTE

如果你在旧资料里看到 `FunctionMessage`，先把它当成早期 `function calling` 语义里的历史概念就够了。当前这条主线里，更值得优先理解的是 `system`、`user`、`assistant`、`tool`。

## 7. 总结

读到这里，先把下面三件事记住就够了

- 对 Agent 来说，真正的输入单位是 `messages`，不是单个字符串。

- 前期最常用的四种角色就是 `system`、`user`、`assistant`、`tool`。

- 消息协议不是为了让写法更复杂，而是为了把上下文分清楚，让 Agent 能稳定继续工作。

接下来我们要考虑的问题是：既然输入已经是结构化消息了，那 `Prompt` 到底是怎么把这些消息稳定组织起来的呢？
