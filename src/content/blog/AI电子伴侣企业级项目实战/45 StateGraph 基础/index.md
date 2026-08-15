---
title: "45 StateGraph 基础"
pubDate: 2026-04-26
description: "上一篇我们用一个最小的例子感受了 LangGraph 的基本流程：定义状态 → 添加节点 → 连接边 → 编译运行。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/2-stategraph-bindnode/](https://aicompanion.usehook.cn/2-stategraph-bindnode/)

## 1. 上一篇看到了全貌，这一篇开始动手

上一篇我们用一个最小的例子感受了 LangGraph 的基本流程：定义状态 → 添加节点 → 连接边 → 编译运行。

但那个例子跳过了很多细节。

这一篇把 StateGraph 的基础能力拆开来讲，目标是让你能独立构建一个包含多个节点、结构化状态、正确流转的图。

先从最核心的问题开始：**状态是什么，怎么定义。**

## 2. 状态：所有节点共享的数据容器

在 LangGraph 里，状态不是一个抽象概念，而是一个**具体的、有类型的对象**。它在所有节点之间共享——每个节点读取当前状态，执行逻辑，然后返回状态的部分更新。

用 `StateSchema` 来定义状态的结构。

### 2.1 最简单的状态：一个消息列表

绝大多数 AI 应用的状态里都有一个消息列表。LangGraph 为此提供了专门的类型 `MessagesValue`：

simple-state.ts

```typescript
import { StateSchema, MessagesValue } from '@langchain/langgraph'

const State = new StateSchema({
  messages: MessagesValue,
})
```

`MessagesValue` 不是一个普通的数组类型。它内置了一个**合并逻辑**（LangGraph 里叫 reducer）：当节点返回新消息时，新消息会**追加**到已有列表末尾，而不是替换掉整个列表。

举个例子说明这个行为：

messages-append.ts

```typescript
// 假设当前状态是：
// { messages: [{ role: 'user', content: '你好' }] }

// 节点返回：
return { messages: [{ role: 'assistant', content: '你好！有什么可以帮你的？' }] }

// 更新后的状态变成：
// {
//   messages: [
//     { role: 'user', content: '你好' },
//     { role: 'assistant', content: '你好！有什么可以帮你的？' }    ← 追加
//   ]
// }
```

如果没有这个合并逻辑，节点返回的新消息会直接**覆盖**掉之前所有的消息历史。对话就断了。

`MessagesValue` 还会自动做消息反序列化——你传入 `{ role: 'user', content: '...' }` 这样的普通对象，它会自动转换成 LangChain 的 `HumanMessage` 实例。所以你在节点里可以用 LangChain 的消息类型方法（比如 `msg.getType()`），也可以直接传普通对象，两种都行。

### 2.2 加上普通字段

除了消息列表，你通常还需要其他状态字段来跟踪业务信息。普通的 Zod schema 字段遵循最简单的更新规则：**每次赋值直接覆盖旧值。**

state-with-fields.ts

```typescript
import { StateSchema, MessagesValue } from '@langchain/langgraph'
import { z } from 'zod'

const State = new StateSchema({
  // 消息列表：追加合并
  messages: MessagesValue,

  // 普通字段：直接覆盖
  currentStep: z.string().default('init'),
  retryCount: z.number().default(0),
  userId: z.string().optional(),
})
```

这里 `.default()` 的作用是设定初始值。当你第一次调用 `graph.invoke()` 时，如果没有传入 `currentStep`，它的值就是 `'init'`。

**两种更新行为的对比：**

| 字段类型 | 节点返回值 | 更新行为 | 适合存什么 |
| --- | --- | --- | --- |
| MessagesValue | 新消息数组 | 追加到已有列表 | 对话历史 |
| 普通 Zod schema | 新值 | 直接覆盖旧值 | 当前步骤、计数器、标志位 |
NOTE

下一篇会继续往下讲 `ReducedValue`，也就是普通字段在不想直接覆盖时，应该怎么声明自己的合并方式。

## 3. 节点：读取状态、执行逻辑、返回更新

节点是图里的处理单元。每个节点就是一个函数，签名非常简单：

node-signature.ts

```typescript
// 接收当前状态，返回状态的部分更新
(state: State) => Partial<State>
```

**「部分更新」是关键。** 节点不需要返回完整的状态对象，只需要返回你想修改的字段。没有返回的字段保持不变。

### 3.1 用 GraphNode 约束类型

LangGraph 提供了 `GraphNode` 类型，帮你把节点函数的输入输出类型和状态定义关联起来：

graphnode-type.ts

```typescript
import { StateGraph, StateSchema, MessagesValue, START, END } from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const State = new StateSchema({
  messages: MessagesValue,
  currentStep: z.string().default('init'),
})

// 用 GraphNode<typeof State> 约束节点函数的类型
const myNode: GraphNode<typeof State> = (state) => {
  // state.messages —— 类型自动推导为消息数组
  // state.currentStep —— 类型自动推导为 string
  return {
    currentStep: 'processed',
    // 没有返回 messages，所以 messages 保持不变
  }
}
```

`GraphNode<typeof State>` 做了两件事：

- `state` 参数的类型被自动推导成你定义的状态结构

- 返回值被约束为状态的部分更新——你只能返回状态里存在的字段

如果你拼错了字段名（比如写成 `currentStpe`），TypeScript 会直接报错。

### 3.2 节点可以是同步的，也可以是异步的

大多数实际场景里，节点需要调用外部服务（模型、数据库、API），所以通常是异步的：

async-node.ts

```typescript
// 异步节点：调用外部模型
// 这里假设 model 是前面创建好的 ChatOpenAI 实例
const callModel: GraphNode<typeof State> = async (state) => {
  const response = await model.invoke(state.messages)
  return {
    messages: [response],
    currentStep: 'model-called',
  }
}

// 同步节点：纯粹的数据处理
const checkResult: GraphNode<typeof State> = (state) => {
  const lastMsg = state.messages.at(-1)
  return {
    currentStep: lastMsg ? 'has-response' : 'no-response',
  }
}
```

LangGraph 会自动处理 `Promise`，你不需要做任何额外配置。

### 3.3 节点的第二个参数：config

节点函数还有一个可选的第二个参数 `config`，用来接收运行时的配置信息：

node-config.ts

```typescript
const myNode: GraphNode<typeof State> = (state, config) => {
  // config.configurable 里可以拿到调用时传入的自定义参数
  const userId = config?.configurable?.user_id
  console.log('当前用户:', userId)

  return { currentStep: 'done' }
}

// 调用时传入 configurable
await graph.invoke(
  { messages: [{ role: 'user', content: '你好' }] },
  { configurable: { user_id: 'user_2048' } },
)
```

`config` 的典型用途：传递用户 ID、会话 ID、环境标识这些**不属于状态但节点需要知道的信息**。它不会被写入状态，也不会被 checkpoint 持久化。

## 4. 边：定义节点之间的流转关系

节点定义了「做什么」，边定义了「做完以后去哪」。

### 4.1 普通边：确定性的流转

normal-edges.ts

```typescript
import { START, END } from '@langchain/langgraph'

// 假设 nodeA、nodeB、nodeC 是前面定义好的节点函数
const graph = new StateGraph(State)
  .addNode('nodeA', nodeA)
  .addNode('nodeB', nodeB)
  .addNode('nodeC', nodeC)
  // 普通边：固定的流转路径
  .addEdge(START, 'nodeA')    // 入口 → A
  .addEdge('nodeA', 'nodeB')  // A → B
  .addEdge('nodeB', 'nodeC')  // B → C
  .addEdge('nodeC', END)      // C → 结束
  .compile()
```

`START` 和 `END` 是 LangGraph 的两个特殊节点：

- **`START`**：图的入口。`addEdge(START, 'nodeA')` 表示「收到输入后，第一个执行 nodeA」

- **`END`**：图的终点。`addEdge('nodeC', END)` 表示「nodeC 执行完后，整个图结束，返回最终状态」

普通边是**无条件的**——A 执行完一定去 B，没有「如果……就……」。

### 4.2 条件边：根据状态决定走哪条路

条件边是 LangGraph 最强大的能力之一。上一篇已经展示过一个情绪路由的例子，这里用更简洁的方式回顾核心 API：

conditional-edges.ts

```typescript
import type { ConditionalEdgeRouter } from '@langchain/langgraph'

// 路由函数：接收当前状态，返回下一个节点的名称
const router: ConditionalEdgeRouter<typeof State, 'nodeB' | 'nodeC'> = (state) => {
  if (state.currentStep === 'need-more') {
    return 'nodeB'
  }
  return 'nodeC'
}

const graph = new StateGraph(State)
  .addNode('nodeA', nodeA)
  .addNode('nodeB', nodeB)
  .addNode('nodeC', nodeC)
  .addEdge(START, 'nodeA')
  // 条件边：nodeA 执行完后，调用 router 函数决定去哪
  .addConditionalEdges('nodeA', router, ['nodeB', 'nodeC'])
  .addEdge('nodeB', END)
  .addEdge('nodeC', END)
  .compile()
```

`addConditionalEdges` 的三个参数：

- **源节点名称**：从哪个节点出发

- **路由函数**：接收当前状态，返回目标节点名称（或 `END`）

- **可能的目标列表**：声明这条条件边可能去哪些节点（帮助 LangGraph 做图结构校验）

路由函数也可以返回 `END`，表示直接结束：

router-end.ts

```typescript
const router: ConditionalEdgeRouter<typeof State, 'retry'> = (state) => {
  if (state.retryCount >= 3) return END  // 重试超过 3 次就结束
  return 'retry'
}
```

NOTE

条件边的详细用法会在第 4 篇单独展开。这里先知道基本语法即可。

## 5. 编译与运行：从定义到执行

### 5.1 compile()：把定义转化为可运行的图

所有的 `addNode` 和 `addEdge` 都是在**定义**图的结构。调用 `compile()` 之后，LangGraph 会：

- 检查图的结构是否合法（比如有没有孤立节点、有没有从 START 到不了的节点）

- 生成一个可执行的 `CompiledGraph` 实例

compile.ts

```typescript
// 这只是定义，还不能运行
const builder = new StateGraph(State)
  .addNode('greet', greet)
  .addEdge(START, 'greet')
  .addEdge('greet', END)

// 编译后才能运行
const graph = builder.compile()
```

**你必须在调用 `invoke` 之前调用 `compile`。** 直接在 builder 上调用 `invoke` 会报错。

### 5.2 invoke()：传入初始状态，运行图

invoke.ts

```typescript
const result = await graph.invoke({
  messages: [{ role: 'user', content: '你好' }],
})
```

`invoke` 的参数就是初始状态。LangGraph 会：

- 把初始状态和 StateSchema 的默认值合并

- 从 START 开始，按边的定义依次执行节点

- 每个节点的返回值会更新状态

- 到达 END 后，返回最终状态

返回值 `result` 就是经过所有节点处理后的完整状态对象。

### 5.3 传入运行时配置

`invoke` 的第二个参数是配置对象，可以传自定义参数给节点：

invoke-config.ts

```typescript
const result = await graph.invoke(
  // 第一个参数：初始状态
  { messages: [{ role: 'user', content: '你好' }] },
  // 第二个参数：运行时配置
  {
    configurable: {
      user_id: 'user_2048',
      session_id: 'session_001',
    },
  },
)
```

节点通过 `config.configurable` 就能拿到这些值（前面 3.3 节已经展示过）。

## 6. 完整示例：一个带业务状态的对话图

把前面的知识点串起来，构建一个稍微有点业务含义的图。

场景：用户发消息 → 分析意图 → 根据意图选择不同的处理节点 → 返回结果。

complete-example.ts

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

// 1. 定义状态
const State = new StateSchema({
  messages: MessagesValue,
  intent: z.enum(['greeting', 'question', 'unknown']).default('unknown'),
  handled: z.boolean().default(false),
})

// 2. 定义节点

// 意图识别：从用户消息中判断意图
const classify: GraphNode<typeof State> = (state) => {
  const lastMsg = state.messages.at(-1)?.content?.toString() ?? ''

  let intent: 'greeting' | 'question' | 'unknown' = 'unknown'
  if (lastMsg.includes('你好') || lastMsg.includes('嗨')) {
    intent = 'greeting'
  } else if (lastMsg.includes('？') || lastMsg.includes('吗')) {
    intent = 'question'
  }

  return { intent }
}

// 处理问候
const handleGreeting: GraphNode<typeof State> = (_state) => {
  return {
    messages: [{ role: 'assistant', content: '你好呀！今天有什么我能帮你的？' }],
    handled: true,
  }
}

// 处理提问
const handleQuestion: GraphNode<typeof State> = (_state) => {
  return {
    messages: [{ role: 'assistant', content: '好问题！让我想想怎么回答你。' }],
    handled: true,
  }
}

// 兜底处理
const handleFallback: GraphNode<typeof State> = (_state) => {
  return {
    messages: [{ role: 'assistant', content: '我不太确定你想说什么，能再说清楚一点吗？' }],
    handled: true,
  }
}

// 3. 路由函数
const intentRouter: ConditionalEdgeRouter<
  typeof State,
  'handleGreeting' | 'handleQuestion' | 'handleFallback'
> = (state) => {
  switch (state.intent) {
    case 'greeting': return 'handleGreeting'
    case 'question': return 'handleQuestion'
    default: return 'handleFallback'
  }
}

// 4. 构建图
const graph = new StateGraph(State)
  .addNode('classify', classify)
  .addNode('handleGreeting', handleGreeting)
  .addNode('handleQuestion', handleQuestion)
  .addNode('handleFallback', handleFallback)
  .addEdge(START, 'classify')
  .addConditionalEdges('classify', intentRouter, [
    'handleGreeting', 'handleQuestion', 'handleFallback',
  ])
  .addEdge('handleGreeting', END)
  .addEdge('handleQuestion', END)
  .addEdge('handleFallback', END)
  .compile()

// 5. 运行
const result = await graph.invoke({
  messages: [{ role: 'user', content: '你好呀' }],
})

console.log('意图:', result.intent)
// → 意图: greeting

console.log('已处理:', result.handled)
// → 已处理: true

for (const msg of result.messages) {
  console.log(`[${msg.getType()}]: ${msg.content}`)
}
// → [human]: 你好呀
// → [ai]: 你好呀！今天有什么我能帮你的？
```

这个例子虽然没有接入真正的 LLM，但它展示了 LangGraph 最重要的几个能力：

**结构化的状态**——`intent` 和 `handled` 是明确的、有类型的字段，不是塞在消息文本里的模糊信息。你可以直接读取 `result.intent` 来判断意图，不需要从自然语言里去「猜」。

**显式的流程控制**——意图识别之后走哪条路，是代码里的 `switch` 决定的，不是模型推理决定的。这意味着你可以精确控制业务流程，不用担心模型「想法变了」。

**节点职责单一**——每个节点只做一件事：`classify` 只管识别意图，`handleGreeting` 只管回复问候。这让每个节点都可以独立测试和替换。

## 7. 图的执行模型：消息传递

最后补充一个理解 LangGraph 行为的关键概念。

LangGraph 的执行模型叫做**消息传递（Message Passing）**。这里的「消息」不是指聊天消息，而是指**节点之间传递的状态更新**。

执行过程是这样的：

- 所有节点初始状态为「不活跃」

- 从 START 出发，第一个节点收到初始状态，变为「活跃」

- 节点执行完毕后，把状态更新「发送」给下一个节点（通过边的定义）

- 下一个节点收到更新后变为「活跃」，开始执行

- 重复这个过程，直到到达 END

如果一个节点后面接了多条普通边，而且这些节点之间没有依赖关系，LangGraph 会在后续的超级步骤（super-step）里并行推进它们。

条件边则是另一回事。条件边不是“多条路一起走”，而是先跑路由函数，再根据返回值决定下一步只走哪一条。

## 8. 总结

这一篇覆盖了 StateGraph 的基础骨架：

- **状态**用 `StateSchema` 定义，`MessagesValue` 追加合并，普通 Zod 字段直接覆盖

- **节点**是接收状态、返回部分更新的函数，用 `GraphNode<typeof State>` 约束类型

- **边**用 `addEdge` 定义固定流转，用 `addConditionalEdges` 定义条件分支

- **`START`** 和 **`END`** 标记图的入口和出口

- **`compile()`** 把定义转化为可执行的图，**`invoke()`** 传入初始状态运行

下一篇继续往下讲 **Reducer**。到那时，状态字段不只是“直接覆盖”，还可以按追加、累加、去重这些不同语义来更新。
