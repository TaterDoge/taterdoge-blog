---
title: "44 概述"
pubDate: 2026-04-26
description: "前面整个 LangChain 章节，我们从消息协议一路讲到了单 Agent 多工具、Middleware、Tracing。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/1-langgraph-overview/](https://aicompanion.usehook.cn/1-langgraph-overview/)

## 1. LangChain 的 Agent 走到这里，哪些事变得吃力了

前面整个 LangChain 章节，我们从消息协议一路讲到了单 Agent 多工具、Middleware、Tracing。

一个 Agent 已经能连续调多个工具、根据中间结果决定下一步做什么、自动记录完整的调用链路。

这套方案在很多场景下完全够用。但如果你继续往深了做，会碰到几个越来越棘手的问题。

### 1.1 执行流程只能往前走，不能回头

LangChain 的 `createAgent` 本质上是一个单向循环：调模型 → 判断要不要调工具 → 调工具 → 回到模型。这个循环是线性的，只有「继续」和「结束」两种选择。

但真实的业务场景经常需要回退。比如 AI 伴侣收到一条消息：

backtrack-scene.txt

```txt
帮我订明天下午三点的会议室，如果 A 会议室没空就换 B。
```

Agent 查完发现 A 没空，换 B 又发现 B 也没空。这时候你希望它回到用户确认：「A 和 B 都没空，要不要试试 C？」

在 `createAgent` 的循环里，你没有地方可以「跳回到某一步」。你只能在工具返回值里想办法塞提示词，引导模型自己做出类似回退的行为——但这本质上是在用自然语言模拟控制流，不可靠。

### 1.2 状态管理靠消息列表硬撑

LangChain Agent 的状态就是消息列表。所有上下文、中间结果、决策依据，全部塞在 messages 数组里。

这在简单场景下没问题。但当你的管线开始变复杂——比如需要同时跟踪「当前查询进度」「已经试过哪些会议室」「用户偏好」「审批状态」——把这些东西全部编码成消息文本，既不直观，也很难精确读取。

你本质上需要的是一个结构化的状态对象，每个字段有明确类型，能直接读写。而不是从一堆消息文本里用自然语言去「猜」当前状态。

### 1.3 没有持久化，断了就没了

`createAgent` 跑完一轮就结束了。中间状态全在内存里，进程一退出就没了。

如果你的 Agent 需要跑很长时间（比如一个审批流程，用户可能隔几个小时才回复），或者需要在崩溃后从断点恢复，靠内存里的消息列表是撑不住的。

### 1.4 多步骤之间没有显式的流转关系

`createAgent` 内部的执行顺序完全由模型推理决定。模型觉得该调什么工具就调什么工具，觉得该结束就结束。

但在很多业务场景里，你需要**显式定义**步骤之间的流转关系。比如「安全检查必须在 LLM 生成之前」「用户审批通过后才能执行操作」。这些是业务规则，不应该交给模型去猜。

这四个问题指向同一个结论：**你需要一个能显式定义执行流程、管理结构化状态、支持持久化和回退的编排框架。**

这就是 LangGraph 要做的事。

## 2. LangGraph 的核心心智模型：节点 + 边 + 状态

LangGraph 用**图（Graph）** 来描述 Agent 的执行流程。

如果你有前端开发背景，可以把它类比成一个状态机：

- **节点（Node）**：图里的每个节点是一个处理步骤。它接收当前状态，执行一段逻辑，返回状态更新

- **边（Edge）**：节点之间的连线，定义「执行完 A 之后去 B」的流转关系

- **状态（State）**：一个在所有节点之间共享的结构化对象。每个节点读取状态、修改状态，下一个节点拿到的是更新后的状态

和 LangChain 的 `createAgent` 对比：

| 维度 | createAgent（LangChain） | StateGraph（LangGraph） |
| --- | --- | --- |
| 执行流程 | 隐式循环，由模型推理决定 | 显式定义节点和边，开发者控制流转 |
| 状态 | 消息列表 | 结构化对象，每个字段有类型和更新规则 |
| 回退 | 不支持 | 通过条件边和中断机制实现 |
| 持久化 | 不支持 | 内置 Checkpointer，自动保存和恢复 |
| 人工介入 | 不支持 | 内置 interrupt()，支持暂停等待用户输入 |

画成图的话，前面那个「查天气 → 建提醒 → 发消息」的 Agent，在 LangGraph 里大概长这样：

graph-structure.txt

```txt
        ┌──────────┐
        │  START   │
        └────┬─────┘
             │
             ▼
     ┌───────────────┐
     │   调用模型     │◄──────────────┐
     └───────┬───────┘               │
             │                       │
        有工具调用？                   │
        ╱         ╲                  │
       是          否                │
       │            │                │
       ▼            ▼                │
┌────────────┐  ┌────────┐          │
│  执行工具   │  │  END   │          │
└─────┬──────┘  └────────┘          │
      │                              │
      └──────────────────────────────┘
```

这个结构和 `createAgent` 内部做的事其实一样——循环调模型和工具。但区别在于：**这些步骤和流转关系现在是显式定义的，你可以看到、可以改、可以加条件分支。**

## 3. 先跑一个最小的 Graph，感受「图」的运行方式

在深入细节之前，先用一个最简单的例子感受 LangGraph 的基本用法。这个例子不涉及 LLM 调用，纯粹是为了让你看清「定义状态 → 添加节点 → 连接边 → 编译运行」这个基本流程。

### 3.1 安装

install.sh

```shellscript
yarn add @langchain/langgraph @langchain/core
```

`@langchain/langgraph` 是 LangGraph 本体，`@langchain/core` 是 LangChain 的核心抽象层（消息类型、工具接口等），LangGraph 依赖它。

### 3.2 定义状态

LangGraph 的状态用 `StateSchema` 定义。每个字段可以是普通的 Zod schema（直接覆盖），也可以用特殊类型控制更新行为。

first-graph-state.ts

```typescript
import { StateSchema, MessagesValue } from '@langchain/langgraph'
import { z } from 'zod'

const MyState = new StateSchema({
  // MessagesValue：专门用于消息列表的特殊类型
  // 内置了合并逻辑——新消息会追加到列表末尾，而不是覆盖
  messages: MessagesValue,

  // 普通 Zod schema：每次更新直接覆盖旧值
  currentStep: z.string().default('init'),
})
```

这里有两个关键概念：

- **`MessagesValue`**：LangGraph 预置的消息列表类型。它内置了一个 reducer（合并函数），当节点返回新消息时，新消息会**追加**到已有列表里，而不是替换掉。这个行为和 LangChain 的消息列表一致

- **普通 Zod schema**：比如 `currentStep`，每次节点返回新值时直接覆盖。这是最简单的更新方式

### 3.3 定义节点和边，构建图

first-graph.ts

```typescript
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  START,
  END,
} from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

// 1. 定义状态
const MyState = new StateSchema({
  messages: MessagesValue,
  currentStep: z.string().default('init'),
})

// 2. 定义节点
// 每个节点是一个函数，接收当前状态，返回状态的部分更新
const greet: GraphNode<typeof MyState> = (state) => {
  const userName = state.messages.at(-1)?.content ?? '朋友'
  return {
    messages: [{ role: 'assistant', content: `你好，${userName}！` }],
    currentStep: 'greeted',
  }
}

const farewell: GraphNode<typeof MyState> = (state) => {
  return {
    messages: [{ role: 'assistant', content: '再见，有问题随时来找我。' }],
    currentStep: 'done',
  }
}

// 3. 构建图
const graph = new StateGraph(MyState)
  // 添加节点：名称 + 处理函数
  .addNode('greet', greet)
  .addNode('farewell', farewell)
  // 添加边：定义流转关系
  .addEdge(START, 'greet')       // 入口 → greet
  .addEdge('greet', 'farewell')  // greet → farewell
  .addEdge('farewell', END)      // farewell → 结束
  // 编译：把图定义转化为可运行的实例
  .compile()

// 4. 运行
const result = await graph.invoke({
  messages: [{ role: 'user', content: '小明' }],
})

console.log(result.currentStep)
// → 'done'

for (const msg of result.messages) {
  console.log(`[${msg.getType()}]: ${msg.content}`)
}
// → [human]: 小明
// → [ai]: 你好，小明！
// → [ai]: 再见，有问题随时来找我。
```

这里输出里的 `human` 和 `ai`，是运行时消息对象的类型名。

而我们在节点返回值里写的 `role: 'user'`、`role: 'assistant'`，是更常见的输入对象写法。两种写法描述的是同一组消息，只是处在不同层。

这个例子故意很简单，但它展示了 LangGraph 最核心的四步：

- **定义状态**（`StateSchema`）—— 声明图里有哪些数据、怎么更新

- **定义节点**（`addNode`）—— 每个节点读状态、做计算、返回更新

- **定义边**（`addEdge`）—— 节点之间怎么流转

- **编译运行**（`compile` + `invoke`）—— 把定义变成可执行的图

### 3.4 和 createAgent 的直观对比

如果用 LangChain 的 `createAgent` 来做同样的事：

langchain-way.ts

```typescript
import { createAgent } from 'langchain'

// LangChain 的方式：把逻辑全部塞进 system prompt，由模型自己决定怎么走
const agent = createAgent({
  model: 'openai:gpt-4.1-mini',
  tools: [],
  systemPrompt: '先打招呼，然后说再见。',
})
```

你会发现：模型是否真的会先打招呼再说再见，完全取决于它的推理。你没有任何显式的流程控制。

而 LangGraph 的方式，流程写在代码里：`START → greet → farewell → END`。不管模型怎么想，执行顺序就是这样。

## 4. 加上条件边：让图根据状态做决策

刚才的例子是一条直线，没有分支。现实中 Agent 的价值恰恰在于「根据情况走不同的路」。

LangGraph 用**条件边（Conditional Edge）** 来实现分支路由。

conditional-graph.ts

```typescript
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  START,
  END,
} from '@langchain/langgraph'
import type { GraphNode, ConditionalEdgeRouter } from '@langchain/langgraph'
import { z } from 'zod'

const State = new StateSchema({
  messages: MessagesValue,
  mood: z.enum(['happy', 'sad', 'neutral']).default('neutral'),
})

// 分析情绪的节点
const analyzeMood: GraphNode<typeof State> = (state) => {
  const lastMsg = state.messages.at(-1)?.content?.toString() ?? ''
  let mood: 'happy' | 'sad' | 'neutral' = 'neutral'
  if (lastMsg.includes('开心') || lastMsg.includes('高兴')) mood = 'happy'
  if (lastMsg.includes('难过') || lastMsg.includes('伤心')) mood = 'sad'
  return { mood }
}

// 不同情绪对应不同回复节点
const happyReply: GraphNode<typeof State> = () => ({
  messages: [{ role: 'assistant', content: '很高兴听到你这么开心！继续保持好心情 😊' }],
})

const sadReply: GraphNode<typeof State> = () => ({
  messages: [{ role: 'assistant', content: '别难过，有什么我能帮你的吗？' }],
})

const neutralReply: GraphNode<typeof State> = () => ({
  messages: [{ role: 'assistant', content: '你好，有什么可以帮你的？' }],
})

// 路由函数：根据状态中的 mood 字段决定走哪条边
const moodRouter: ConditionalEdgeRouter<
  typeof State,
  'happyReply' | 'sadReply' | 'neutralReply'
> = (state) => {
  switch (state.mood) {
    case 'happy': return 'happyReply'
    case 'sad': return 'sadReply'
    default: return 'neutralReply'
  }
}

const graph = new StateGraph(State)
  .addNode('analyzeMood', analyzeMood)
  .addNode('happyReply', happyReply)
  .addNode('sadReply', sadReply)
  .addNode('neutralReply', neutralReply)
  .addEdge(START, 'analyzeMood')
  // 条件边：analyzeMood 执行完后，根据 moodRouter 的返回值决定走哪个节点
  // 第三个参数列出这条边可能到达的目标，方便做结构校验和类型收窄。
  .addConditionalEdges('analyzeMood', moodRouter, [
    'happyReply', 'sadReply', 'neutralReply',
  ])
  .addEdge('happyReply', END)
  .addEdge('sadReply', END)
  .addEdge('neutralReply', END)
  .compile()

const result = await graph.invoke({
  messages: [{ role: 'user', content: '今天好开心啊' }],
})

console.log(result.messages.at(-1)?.content)
// → '很高兴听到你这么开心！继续保持好心情 😊'
```

conditional-flow.txt

```txt
        ┌──────────┐
        │  START   │
        └────┬─────┘
             │
             ▼
     ┌───────────────┐
     │  analyzeMood  │
     └───────┬───────┘
             │
        mood 是什么？
        ╱     │     ╲
   happy  neutral   sad
      │       │       │
      ▼       ▼       ▼
  ┌──────┐ ┌──────┐ ┌──────┐
  │happy │ │neutral│ │ sad  │
  │Reply │ │Reply  │ │Reply │
  └──┬───┘ └──┬───┘ └──┬───┘
     │        │        │
     └────────┼────────┘
              │
              ▼
          ┌──────┐
          │ END  │
          └──────┘
```

注意这里的关键区别：**路由逻辑写在代码里（`moodRouter` 函数），不是交给模型去猜。** 模型的推理结果被写入状态的 `mood` 字段，然后由确定性的路由函数决定走哪条边。

这就是 LangGraph 的核心设计思想：**把 AI 的非确定性推理和系统的确定性流程控制分开。** 模型负责「理解」和「生成」，图负责「流转」和「控制」。

## 5. LangGraph 和 LangChain 的关系：不是替代，是分层

一个常见的误解是：学了 LangGraph 就不需要 LangChain 了。

实际上它们是不同层次的东西：

- **LangChain** 提供的是**组件**——ChatModel、Tool、Prompt、OutputParser、Retriever。它解决的是「怎么和模型交互」的问题

- **LangGraph** 提供的是**编排**——节点、边、状态、持久化。它解决的是「多个步骤怎么组合在一起」的问题

在 LangGraph 的节点里，你照样会用 LangChain 的 ChatModel 来调模型，用 LangChain 的 Tool 来定义工具。LangGraph 不替代这些组件，它只是给了你一种更强的方式来组织它们。

langgraph-uses-langchain.ts

```typescript
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { StateGraph, StateSchema, MessagesValue, START, END } from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

// LangChain 的组件：模型和工具
const model = new ChatOpenAI({ model: 'gpt-4.1-mini' })
const getWeather = tool(
  async ({ city }) => `${city}：明天小雨，17-22 度`,
  {
    name: 'get_weather',
    description: '查询天气',
    schema: z.object({ city: z.string() }),
  },
)

const modelWithTools = model.bindTools([getWeather])

const State = new StateSchema({
  messages: MessagesValue,
})

// LangGraph 的节点：内部使用 LangChain 组件
const callModel: GraphNode<typeof State> = async (state) => {
  const response = await modelWithTools.invoke(state.messages)
  return { messages: [response] }
}

// LangGraph 负责编排
const graph = new StateGraph(State)
  .addNode('callModel', callModel)
  .addEdge(START, 'callModel')
  .addEdge('callModel', END)
  .compile()
```

这就是它们的分工：**LangChain 管「和 AI 打交道」，LangGraph 管「把步骤串起来」。**

## 6. 收一下这一篇

这一篇先把 LangGraph 的轮廓搭起来了。

前面 LangChain 里的单 Agent，在很多场景下已经够用；但只要开始碰到明确分支、结构化状态、持久化和回退，流程就不能继续只靠提示词和消息列表硬撑。LangGraph 做的，就是把这些流程拿回代码里。

从下一篇开始，就不再停在总览上了，而是把 `StateSchema`、节点、Reducer、条件边这些部分一块一块拆开。
