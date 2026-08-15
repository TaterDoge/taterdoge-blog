---
title: "21 从 Agent 开始"
pubDate: 2026-04-19
description: "之前我已经完整的写完了 langChain 的系列文章，但是认真复盘之后发现，之前的文章从整体架构来说，不构成完整的体系，不适合新手阅读，理解起来可能会有点抽象。因此，我决定从新梳理一遍整个 langChain/langGraph 的架构，"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/1-framework-overview/](https://aicompanion.usehook.cn/1-framework-overview/)

## 1. 概述

NOTE

之前我已经完整的写完了 langChain 的系列文章，但是认真复盘之后发现，之前的文章从整体架构来说，不构成完整的体系，不适合新手阅读，理解起来可能会有点抽象。因此，我决定从新梳理一遍整个 langChain/langGraph 的架构，换一个视角重新编排了文章结构和内容

学习 langChain/langGraph 之前，我们先来思考一个问题：什么是 Agent？

「智能体」

在 langChain 中，Agent 被定义为一个独立的个体，他有自己的大脑、自己的记忆、自己的工具、自己的独特的设定、自己的独立的行为.

我们可以使用如下方式定义一个最简单的 Agent：

index.ts

```typescript
import { createAgent } from "langchain";

const agent = createAgent({
  model: "openai:gpt-5",
  tools: []
});
```

通常情况下，我们会使用大模型来作为 Agent 的大脑，因此，在定义 Agent 时，我们可以专门定义一个模型对象来作为 Agent 的大脑

index.ts

```typescript
import { createAgent } from "langchain";
import { ChatOpenAI } from "@langchain/openai";

// 定义一个 LLM 模型对象
const model = new ChatOpenAI({
  model: "gpt-4.1",
  temperature: 0.1,
  maxTokens: 1000,
  timeout: 30
});

const agent = createAgent({
  // 这里我们使用了一个模型对象来作为 Agent 的大脑
  model,
  tools: []
});
```

我们也可以定义一些工具来作为 Agent 的工具箱，Agent 会在使用的时候使用这些工具，来增强自己的能力

index.ts

```typescript
import * as z from "zod";
import { createAgent, tool } from "langchain";

// 定义一个工具对象，用于搜索信息
const search = tool(
  ({ query }) => `Results for: ${query}`,
  {
    name: "search",
    description: "Search for information",
    schema: z.object({
      query: z.string().describe("The query to search for"),
    }),
  }
);

// 定义一个工具对象，用于获取天气信息
const getWeather = tool(
  ({ location }) => `Weather in ${location}: Sunny, 72°F`,
  {
    name: "get_weather",
    description: "Get weather information for a location",
    schema: z.object({
      location: z.string().describe("The location to get weather for"),
    }),
  }
);

const agent = createAgent({
  model,
  // 这里我们使用了一个工具对象来作为 Agent 的工具箱
  tools: [search, getWeather],
});
```

我们也可以为该智能体提前预设一些角色背景、系统设定等信息

index.ts

```typescript
const agent = createAgent({
  model,
  tools,
  systemPrompt: "你是一名专业的 AI Agent 开发工程师，....",
});
```

也可以为该智能体设定一个昵称

index.ts

```typescript
const agent = createAgent({
  model,
  tools,
  systemPrompt: "你是一名专业的 AI Agent 开发工程师，....",
  name: "xiao_wei",
});
```

如果我们理解面向对象，那么从 Agent 的定义到对其能力的扩展，是非常简单的，每一个 Agent 都是一个独立的个体，我们可以根据需求，为该智能体添加不同的能力，并根据需求让他执行不同的任务

当你需要他为你输出一个结果时，只需要调用他的 `invoke` 方法即可

index.ts

```typescript
// 接收任务，并返回结果
const result = await agent.invoke("告诉我今天天气怎么样");
console.log(result);
```

从 Agent 的角度出发，我们还需要思考的几个问题是：

- 这个个体由哪些基础接口构成 -> `@langchain/core`

- 这个个体怎样真正被组装出来并开始行动 -> `LangChain`

- 当这个个体进入更大的系统后，怎样与其他步骤或其他 Agent 协作 -> `LangGraph`

把这三层放在一起看，会更像这样：

- `@langchain/core` 定义 Agent 的基础接口

- `LangChain` 负责把单个 Agent 组装出来

- `LangGraph` 负责把 Agent 放进更复杂的系统里

## 3. 一个 Agent 内部需要哪些能力

先不谈框架，单纯从「一个个体怎样行动」来看，Agent 内部至少有五个部分。

**输入层**

Agent 要先接收到外部信息。这个输入可能来自用户，也可能来自上游系统，还可能来自别的 Agent。输入本身不只是纯文本，还可能带有角色、上下文、历史记录和任务说明。

**上下文层**

同一句输入，在不同上下文里含义完全不同。Agent 想正常工作，就必须知道：

- 当前身份是什么

- 当前任务目标是什么

- 对话历史里发生过什么

- 当前还能使用哪些工具

所以 Agent 不是拿到一句话就直接生成回复，而是需要先把上下文整理好。

**思考材料层**

Agent 并不会直接读取你的业务代码，它真正能使用的，是被整理过的材料：

- System Prompt

- 用户输入

- 检索结果

- 工具说明

- 历史对话

这些材料怎样被拼起来，决定了 Agent 最终会怎样行动。

**行动层**

真正的 Agent 不只是回答问题，还要能采取行动。这个行动可以是：

- 调模型继续推理

- 调工具查数据

- 调工具写数据

- 请求别的系统执行任务

到了这一步，Agent 才从「会生成文字」变成「能完成任务」。

**输出层**

Agent 的输出也不一定只是自然语言。它可能输出：

- 一段回复文本

- 一次工具调用请求

- 一份结构化结果

- 一条交给下游节点继续处理的数据

所以 Agent 更像一个有输入、有状态、有动作、有输出的个体，而不是单一的问答函数。

## 4. @langchain/core：定义这个个体的基础接口

当我们说 `@langchain/core` 是基础抽象层时，本质上是在说：

**它定义了这个 Agent 个体最基础的器官和接口标准**。这一层并不直接替你实现完整业务，而是先把最基础的零件统一起来。

### 3.1 消息类型：定义 Agent 怎样接收信息

Agent 首先要解决的是「信息以什么格式进入系统」。如果每家模型、每段链路、每个工具都用不同的数据结构，整个系统会非常混乱。

所以 `@langchain/core` 先定义了统一的消息协议，比如：

- `SystemMessage`

- `HumanMessage`

- `AIMessage`

- `ToolMessage`

这些类型看起来只是几个类名，但它们解决的是更深一层的问题：**让 Agent 的输入输出格式稳定下来**

只要消息协议统一了，上层就能在不同模型、不同链路、不同节点之间复用同一套对话结构

NOTE

为了使用方便，框架也支持直接从 `langchain` 包中导入 `SystemMessage`、`HumanMessage`、`AIMessage`、`ToolMessage` 等消息类型，他们本质上是定义在 `@langchain/core/messages` 模块中的，并且在使用时会更多的使用这种方式

index.ts

```typescript
import { HumanMessage } from "langchain";
```

### 3.2 Prompt 抽象：定义 Agent 怎样组织思考材料

Agent 不会直接理解你的产品需求文档，也不会自动知道「人设」「任务目标」「检索片段」应该怎样组合。它真正能读取的，是最终送进模型的 Prompt。

`@langchain/core` 在这里提供的价值是，把 Prompt 从一段随手拼接的字符串，提升成结构化模板。

像 `ChatPromptTemplate`、`MessagesPlaceholder` 这样的抽象，实际上是在做一件很重要的事：

**让 Agent 的思考材料可以像组件一样被拼装。**

这样你就能把：

- 固定系统指令

- 动态用户输入

- 历史消息

- 外部检索结果

稳定地组合进同一条输入链路，而不是每次靠字符串手工拼接。

### 3.3 Runnable 协议：定义 Agent 内部节点怎样连接

一个 Agent 内部不会只有一个步骤。哪怕是最简单的场景，也经常至少包含：

- 组织 Prompt

- 调用模型

- 解析输出

这三个步骤如果没有统一协议，就只是三个彼此独立的函数，很难形成可组合的流水线。

Runnable 的意义就在这里。它定义了一种统一的节点接口，让不同能力都可以被当成同一类组件来连接。

于是 Agent 内部的很多能力，就都能进入同一条链：

index.ts

```typescript
const chain = prompt.pipe(model).pipe(parser)
```

这行代码之所以成立，不是因为 `.pipe()` 很神奇，而是因为 `@langchain/core` 先规定了统一的接口标准。

### 3.4 Parser 和 Tool 协议：定义 Agent 怎样输出结果、怎样调用能力

Agent 的输出需要被程序消费，所以模型返回的自然语言往往还要再经过解析。Parser 抽象解决的是：

- 文本怎样提取

- JSON 怎样解析

- 结构化结果怎样进入后续链路

Tool 协议解决的是另一个问题：

- 外部能力怎样被描述

- 模型怎样知道某个工具可以做什么

- 工具参数怎样被约束

也就是说，`@langchain/core` 实际上是在给 Agent 定义一整套基础规则：

- 信息怎么进来

- 材料怎么组织

- 节点怎么连接

- 结果怎么出去

- 外部能力怎么接进来

这就是它作为基础抽象层的意义。

## 5. LangChain：把单个 Agent 真正组装出来

如果说 `@langchain/core` 是基础器官和接口标准，那 LangChain 就是在做更贴近业务的一层封装：

**把这些基础零件真正组装成一个可以行动的 Agent。**

这一层最重要的价值，不是再次定义协议，而是把开发者最常做的动作整理成高层 API。

### 4.1 它让 Agent 先能接上模型

一个 Agent 再完整，没有模型也无法真正运行。LangChain 负责把不同供应商的模型能力接进统一接口里，让 Agent 可以稳定调用它们。

这样你在应用层关注的重点会变成：

- 用哪个模型

- 这个模型支持哪些能力

- 如何把它接到现有 Prompt 和 Tool 链路里

而不是每次都重新写请求体、流式处理和响应解析。

### 4.2 它让 Agent 的上下文组织变成常规开发动作

单独看 Prompt、消息、历史上下文、检索结果，这些都只是材料。LangChain 的价值，是把这些材料收拢到一套统一开发方式里。

在 LangChain 这一层，你会自然地做这些事：

- 用模板组织 Prompt

- 用消息维护角色结构

- 把历史记录注入链路

- 把检索结果拼进输入

- 把解析器接到模型输出后面

于是 Agent 就不再像一段临时脚本，而更像一个稳定的业务单元。

### 4.3 它让 Agent 能调用多个工具

这是 LangChain 这一章最重要的落点。

因为一个真正实用的 Agent，不会只停留在「生成一句回答」。它还需要决定：

- 什么时候该查工具

- 先查哪个工具

- 拿到工具结果后要不要继续调用别的工具

- 最后怎样把多步执行结果组织成回复

只要这套能力建立起来，一个单独的 Agent 就已经可以承担很多真实工作：

- 天气查询

- 日程记录

- 信息检索

- 记忆写入

- 业务接口调用

所以从封装角度看，LangChain 最适合承载的主线就是：

**一个独立 Agent，如何在一次请求中组织上下文，并按需要调用多个工具完成任务。**

### 4.4 它把单 Agent 开发变成一套稳定范式

LangChain 这一层最终形成的是一种非常稳定的开发模式：

- 定义输入结构

- 组织 Prompt 与上下文

- 接入模型

- 接入工具

- 让 Agent 在调用模型与调用工具之间完成决策

- 输出最终结果

这就是为什么 LangChain 更像应用开发层。因为它处理的正是「把一个独立 Agent 做出来并投入业务使用」这件事。

## 6. LangGraph：让 Agent 进入更大的协作系统

当你只有一个 Agent 时，上面的结构已经足够强大。但系统继续增长后，问题会开始变化。

这时你关心的不再只是一个 Agent 怎样完成任务，而是：

- 任务当前走到哪一步

- 哪些状态要跨步骤保留

- 流程失败后从哪里恢复

- 多个 Agent 如何分工

- 哪个 Agent 负责路由，哪个 Agent 负责执行

这时进入的就不再只是「单个 Agent 组装」问题，而是「系统编排」问题。LangGraph 处理的正是这部分。

### 5.1 它关心的是 Agent 所处的流程

LangChain 更多是在组装一个个体。

LangGraph 更像是在安排这个个体进入一条完整流程。

在 LangGraph 的视角里，一个 Agent 可能只是系统中的一个节点。除了 Agent 之外，系统里还可能有：

- 分类节点

- 检索节点

- 审核节点

- 人工确认节点

- 汇总节点

所以 LangGraph 看待问题的方式，不再是「这个 Agent 怎么调用工具」，而是：

**整个流程怎样向前推进。**

### 5.2 它关心的是状态怎样持续存在

一个独立 Agent 在单轮任务里，很多信息可以放在当前上下文里临时处理。但一旦流程跨越多个阶段，状态就会成为核心问题。

比如：

- 当前任务完成到第几步了

- 哪个 Agent 已经执行过

- 哪些中间结果要保留

- 当前是否需要人工介入

LangGraph 的价值，是把这些状态问题从「零散业务代码」提升成正式的运行时能力。

### 5.3 它更适合承载多个 Agent 的协作

多个 Agent 组成系统时，每个 Agent 都可以继续被看成一个独立个体，但系统已经不再等于这些个体的简单相加。

还会多出很多新的系统问题：

- 哪个 Agent 先接任务

- 哪个 Agent 负责细分子任务

- 哪个 Agent 负责回收结果

- 公共状态和私有状态怎么分开

这些问题继续放在单 Agent 的封装里实现，会越来越吃力；放到状态流转、节点编排和运行时控制的层面来实现，就会更自然

## 7. 总结

先从一个独立 Agent 出发：

- `@langchain/core` 定义它的基础接口

- `LangChain` 把它组装成一个真正能工作的行动单元

然后当这个 Agent 被放进更复杂的任务系统中：

- `LangGraph` 继续负责流程推进、状态保存和多 Agent 协作

因此，我们的最佳学习思路，就是应该顺着一个 Agent 从「基础构成」到「独立行动」再到「进入系统」的完整路径去思考
