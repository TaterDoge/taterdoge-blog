---
title: "25 概述"
pubDate: 2026-04-20
description: "这一章正式进入 LangChain 前面我们已经把边界说清楚了：这一章只讨论一件事，单个 Agent 怎样在一轮请求里调用多个工具，把事情做完。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-04-23
---
原文链接：[https://aicompanion.usehook.cn/1-langchain-overview/](https://aicompanion.usehook.cn/1-langchain-overview/)

## 1. 先看一个最小的 LangChain 例子

这一章正式进入 LangChain 前面我们已经把边界说清楚了：这一章只讨论一件事，**单个 Agent 怎样在一轮请求里调用多个工具，把事情做完。**

先不要急着记概念，先看一个最小例子。还是用「AI 电子伴侣」这个场景。

用户发来一句话：

NOTE

我明天下午三点要开会，帮我记一下。顺便查一下上海明天会不会下雨。

如果我们希望这个 Agent 能处理这句话，它至少要会两件事：

- 写提醒

- 查天气

用 LangChain.js v1，可以先这样写：

index.ts

```typescript
import * as z from 'zod'
import { createAgent, initChatModel, tool } from 'langchain'

const model = await initChatModel('gpt-4.1-mini', {
  modelProvider: 'openai',
})

const createReminder = tool(
  async ({ title, time }) => {
    return `提醒已创建：${time} ${title}`
  },
  {
    name: 'create_reminder',
    description: '创建提醒事项',
    schema: z.object({
      title: z.string().describe('提醒内容'),
      time: z.string().describe('提醒时间'),
    }),
  }
)

const getWeather = tool(
  async ({ city }) => {
    return `${city} 明天有小雨，出门记得带伞`
  },
  {
    name: 'get_weather',
    description: '查询城市天气',
    schema: z.object({
      city: z.string().describe('要查询天气的城市'),
    }),
  }
)

const agent = createAgent({
  model,
  tools: [createReminder, getWeather],
  systemPrompt: '你是一名细心、自然的生活助手。',
})

const result = await agent.invoke({
  messages: [
    {
      role: 'user',
      content: '我明天下午三点要开会，帮我记一下。顺便查一下上海明天会不会下雨。',
    },
  ],
})

console.log(result.messages.at(-1)?.content)
```

这段代码已经把这一章最重要的几样东西都摆出来了：

- `initChatModel()`：先把模型接进来

- `tool()`：把外部能力包装成工具

- `createAgent()`：把模型、工具和系统设定组装成一个 Agent

- `agent.invoke()`：把一轮消息交给 Agent 处理

后面整章内容，基本都会围绕这四件事展开。

## 2. langChain 的作用

刚才那句「记提醒 + 查天气」，当请求真的跑起来时，内部大致会经过这几个环节：

- 接住用户消息

- 把系统设定、历史消息、工具说明整理成模型能读懂的输入

- 把输入交给模型

- 让模型判断要不要调用工具

- 执行工具

- 再把工具结果送回模型

- 生成最终回复

如果这些步骤全都自己手写，当然也能做。但一旦功能变多，代码会很快散开：

- 模型调用是一块

- Prompt 拼接是一块

- 工具调用是一块

- 输出解析又是一块

LangChain 的作用，就是把这些东西放进一套比较统一的写法里。

后续的学习中，你会经常看到下面这几个词：

- `ChatModel`

- `Message`

- `Prompt`

- `Runnable`

- `Tool`

- `Agent`

它们不是零散的概念，而是一条线上的不同位置

## 3. 包结构

### 3.1 @langchain/core

`@langchain/core` 是基础抽象层，负责定义一套通用协议，让上层组件能按同样的方式组合起来

比如：

- 消息类型

index.ts

```typescript
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
// import { HumanMessage, SystemMessage } from 'langchain'
```

- Prompt 模板

index.ts

```typescript
import { ChatPromptTemplate } from '@langchain/core/prompts'
```

- Runnable 协议

index.ts

```typescript
import { RunnableParallel } from '@langchain/core/runnables'
```

- 输出解析器

index.ts

```typescript
import { StringOutputParser } from '@langchain/core/output_parsers'
```

你可以把它理解成一套通用接口标准。

没有这一层，上面的模型、工具、链路就很难统一起来

要注意一点：

这些基础能力在架构上属于 `@langchain/core`，但在 LangChain.js v1 里，官方也会通过 `langchain` 包重新导出一部分常用类型，方便直接使用。比如消息类型常见的写法就是：

index.ts

```typescript
import { HumanMessage, SystemMessage } from 'langchain'
```

如果你在别的示例里看到从 `@langchain/core/messages` 导入，也不是错，只是导入位置不同

### 3.2 langchain

这是应用层最常用的入口

这一层主要提供：

- `createAgent()`

- `tool()`

- `initChatModel()`

- `middleware`

- 一些常用消息类型和高层能力的 `re-export`

这一章后面大多数代码，都会直接从 `langchain` 包开始写

对单 Agent 场景来说，它基本就是主战场

### 3.3 @langchain/{provider}

这一层用来接具体模型厂商。

比如：

- `@langchain/openai`

- `@langchain/anthropic`

- `@langchain/google-genai`

如果你只是想快速开始，很多时候可以先用 `initChatModel()`

index.ts

```typescript
import { initChatModel } from 'langchain'

const model = await initChatModel('gpt-4.1-mini', {
  modelProvider: 'openai',
})
```

如果你需要更细的 provider 配置，再显式创建模型对象也可以：

index.ts

```typescript
import { ChatOpenAI } from '@langchain/openai'

const model = new ChatOpenAI({
  model: 'gpt-4.1-mini',
  temperature: 0.2,
})
```

### 3.4 @langchain/classic

这个包现在也值得知道一下。

老版本里常见的 `chains`、`memory`、`indexing` 抽象，并不是都还留在新的 `langchain` 主包里了。现在不少旧能力会放进 `@langchain/classic`

这就是为什么你在看资料时，会发现有的文章还在讲：

- `ConversationBufferMemory`

- 老的 `chain` 封装

- 早期 `retrieval` 组合方式

## 4. 用一个 Agent 来看 LangChain 的核心组成

为了不把内容讲散，我们继续盯着一个 `Agent` 看。

还是刚才那个生活助手。如果把它当成一个完整对象来看，它身上至少有下面这些部分：

- 一个大脑，也就是模型

- 一组工具

- 一段系统设定

- 一轮一轮收到的消息

- 一个对外执行任务的方法，也就是 `invoke()`

LangChain 处理的，就是这些部分怎样接到一起

### 4.1 模型：先把“大脑”接进来

模型是最底层的推理能力来源。

在 LangChain 里，模型接入之后，会尽量统一成相似的调用方式。这样做的直接好处就是：换模型时，上层代码不至于全部推倒重来。

最常见的两种写法是：

index.ts

```typescript
import { initChatModel } from 'langchain'

const model = await initChatModel('gpt-4.1-mini', {
  modelProvider: 'openai',
})
```

index.ts

```typescript
import { ChatOpenAI } from '@langchain/openai'

const model = new ChatOpenAI({
  model: 'gpt-4.1-mini',
  temperature: 0.2,
})
```

前一种更适合快速开始。

后一种适合你需要显式控制 provider 细节

### 4.2 消息：不是传一段字符串就够了

新手一开始最容易忽略的一点是：聊天模型处理的核心输入，通常不是一段字符串，而是一组带角色的消息。

比如：

- system

- user

- assistant

- tool

在 LangChain 里，消息可以写成对象字面量，也可以写成消息类。

index.ts

```typescript
const result = await agent.invoke({
  messages: [
    { role: 'system', content: '你是一个细心的生活助手。' },
    { role: 'user', content: '帮我记一下明天上午九点开会。' },
  ],
})
```

如果你只是做一次性生成，直接传字符串给模型也可以：

index.ts

```typescript
const response = await model.invoke('帮我写一句晚安留言')
```

但只要进入对话、工具调用、历史消息这些场景，消息结构会比纯字符串更自然。

### 4.3 Prompt：把零散输入整理成一份可维护的上下文

单个 Agent 真正难写的地方，通常不是调用模型，而是怎么组织输入。

在一个稍微像样一点的场景里，你要交给模型的内容往往不止用户这句话，还包括：

- 系统设定

- 角色信息

- 历史消息

- 检索结果

- 工具说明

如果这些内容都靠模板字符串硬拼，后面会越来越难维护。

LangChain 在这里提供了 Prompt 相关抽象，让你可以把输入拆成稳定的部分和动态的部分。

index.ts

```typescript
import { ChatPromptTemplate } from '@langchain/core/prompts'

const prompt = ChatPromptTemplate.fromMessages([
  ['system', '你是{name}，你的角色设定是：{persona}'],
  ['human', '{input}'],
])

const messages = await prompt.invoke({
  name: '小薇',
  persona: '说话自然、会照顾用户情绪的陪伴助手',
  input: '我今天下班特别晚，有点累',
})
```

这一块在后面的 Prompt 章节会单独展开。

### 4.4 Runnable：把多个步骤串起来

模型、Prompt、输出解析，这些组件放在一起之后，下一步就是把它们接成一条链。

LangChain 里常用的方式是 `Runnable` 协议。

只要组件遵守这套协议，就能用类似的方式去调用，也能用 `.pipe()` 串起来。

最小的链通常像这样：

index.ts

```typescript
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'

const prompt = ChatPromptTemplate.fromMessages([
  ['system', '你是一个很会安慰人的助手。'],
  ['human', '{input}'],
])

const chain = prompt.pipe(model).pipe(new StringOutputParser())

const reply = await chain.invoke({
  input: '今天工作压力有点大',
})
```

这里有个边界要记住：

- `prompt.pipe(model).pipe(parser)` 这种写法，属于普通链路

- `createAgent()` 属于 agent runtime

普通链路里，步骤怎么走，基本都由你自己安排。

Agent 则是在运行时让模型决定要不要调用工具、先调用哪个工具、拿到工具结果后要不要继续。

这一层差别，后面写多工具 Agent 时会很明显。

### 4.5 Tool：让 Agent 从“会回答”变成“会做事”

如果没有工具，模型再聪明，也只能在已有上下文里生成内容。

接上工具以后，Agent 才能开始动手。

比如在 AI 电子伴侣里，很常见的工具可能有：

- 创建提醒

- 查询天气

- 检索长期记忆

- 查询日程

LangChain 提供的 `tool()` 主要做的是标准化包装。它会把一个普通函数包装成 Agent 可识别的工具，并且给它补上描述和参数 schema。

index.ts

```typescript
import * as z from 'zod'
import { tool } from 'langchain'

const searchMemory = tool(
  async ({ query }) => {
    return `检索到和“${query}”相关的历史记录`
  },
  {
    name: 'search_memory',
    description: '检索与用户相关的长期记忆',
    schema: z.object({
      query: z.string().describe('要检索的内容'),
    }),
  }
)
```

这个工具本身还是你自己实现的。

LangChain 负责的是把它包装成模型能理解、能调用的形式。

### 4.6 Agent：把这些能力装进一个可以接任务的对象

当前这条主线的终点，就是 `createAgent()`。

你可以把它理解成：前面准备好的模型、工具、系统设定，最终都要在这里合体。

index.ts

```typescript
import { createAgent, initChatModel } from 'langchain'

const model = await initChatModel('gpt-4.1-mini', {
  modelProvider: 'openai',
})

const agent = createAgent({
  model,
  tools: [createReminder, getWeather, searchMemory],
  systemPrompt: '你是一个温和、细心、做事有条理的生活助手。',
})
```

真正处理请求时，调用的是：

index.ts

```typescript
const result = await agent.invoke({
  messages: [
    {
      role: 'user',
      content: '帮我记一下周五晚上七点和朋友吃饭，再看看北京周五晚上会不会下雨。',
    },
  ],
})
```

这时候的运行过程，已经不是简单的“Prompt 进，文本出”了。

更像是这样：

- Agent 接住消息

- 模型判断需不需要工具

- 如果需要，就发起工具调用

- 工具执行完成后，把结果回给模型

- 模型生成最终回复

这正是 LangChain 这一章后面要逐步拆开的内容
