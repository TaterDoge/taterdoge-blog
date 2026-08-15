---
title: "48 Checkpointer"
pubDate: 2026-04-27
description: "前面四篇我们构建的所有图都有一个共同的问题：状态只存在于单次 invoke 的执行过程中"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/5-checkpointer/](https://aicompanion.usehook.cn/5-checkpointer/)

## 1. 没有持久化，图跑完就什么都没了

前面四篇我们构建的所有图都有一个共同的问题：**状态只存在于单次 `invoke` 的执行过程中**

图跑完，状态就没了。下一次 `invoke` 是全新的开始，不知道之前发生过什么。

no-memory.ts

```typescript
// 假设 graph 是前面编译好的图（没有启用 checkpointer）

const result1 = await graph.invoke({
  messages: [{ role: 'user', content: '我叫小明' }],
})
// → AI: 你好，小明！

const result2 = await graph.invoke({
  messages: [{ role: 'user', content: '我叫什么？' }],
})
// → AI: 我不知道你叫什么。
// 两次 invoke 之间没有任何关联，第二次调用完全不知道第一次发生过什么
```

这在简单的单次问答场景里无所谓。但只要你的应用需要以下任何一种能力，就必须有持久化：

- **多轮对话**：用户连续发多条消息，Agent 需要记住上下文

- **中断恢复**：长时间运行的工作流，进程重启后能从断点继续

- **调试回溯**：出了问题，能回到之前的某一步看当时的状态

- **状态分叉**：从历史某一步开始，走一条不同的路

LangGraph 用 **Checkpointer** 解决这些问题。

## 2. Checkpointer：在每一步自动保存状态

### 2.1 核心概念

Checkpointer 做的事情很简单：**在图执行的每一个 super-step 之后，自动保存一份完整的状态快照。**

Super-step 是 LangGraph 的执行单位——每当一批节点（一个或多个并行节点）执行完毕，就是一个 super-step。Checkpointer 在每个 super-step 结束时把当前状态序列化并存储起来。

checkpoint-timeline.txt

```txt
invoke() 开始
    │
    ▼
┌─────────┐     ┌──────────────┐
│ nodeA   │ ──► │ checkpoint 1 │  ← 保存 nodeA 执行后的状态
└─────────┘     └──────────────┘
    │
    ▼
┌─────────┐     ┌──────────────┐
│ nodeB   │ ──► │ checkpoint 2 │  ← 保存 nodeB 执行后的状态
└─────────┘     └──────────────┘
    │
    ▼
┌─────────┐     ┌──────────────┐
│ nodeC   │ ──► │ checkpoint 3 │  ← 保存 nodeC 执行后的状态
└─────────┘     └──────────────┘
    │
    ▼
  END（返回最终状态）
```

这些快照组成了一条**时间线**。你可以查看任意一步的状态（调试），从任意一步重新开始（回溯），或者在同一个 `thread_id` 下多次 `invoke` 让状态自动累积（多轮对话）。

### 2.2 启用 Checkpointer

启用只需两步：创建一个 Checkpointer 实例，传给 `compile()`。

enable-checkpointer.ts

```typescript
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  START,
  END,
} from '@langchain/langgraph'
import { InMemorySaver } from '@langchain/langgraph'

const State = new StateSchema({
  messages: MessagesValue,
})

// 先照常定义图结构
const builder = new StateGraph(State)
  .addNode('myNode', myNode)
  .addEdge(START, 'myNode')
  .addEdge('myNode', END)

// 关键：编译时传入 checkpointer
const graph = builder.compile({
  checkpointer: new InMemorySaver(),
})
```

`InMemorySaver` 是最简单的 checkpointer——把状态存在内存里。开发和测试够用，生产环境需要换成持久化的方案（后面会讲）。

后面的例子都会显式传 `thread_id`。因为只要你希望多次调用落到同一条会话时间线上，就需要给这条时间线一个稳定的标识：

thread-id.ts

```typescript
// thread_id 放在 configurable 对象里
// configurable 是 LangGraph 统一的「运行时配置」入口
// 除了 thread_id，后续的 checkpoint_id 等参数也放在这里
const config = { configurable: { thread_id: 'conversation-1' } }

const result = await graph.invoke(
  { messages: [{ role: 'user', content: '你好' }] },
  config,  // 第二个参数传入配置
)
```

`thread_id` 是区分不同会话的标识。相同 `thread_id` 共享同一条状态时间线，不同 `thread_id` 完全隔离。

## 3. 用 Checkpointer 实现多轮对话

这是 Checkpointer 最直接的应用：**让 Agent 记住之前的对话。**

原理很简单：同一个 `thread_id` 下，每次 `invoke` 时 checkpointer 会先加载上一次保存的状态，然后把新输入合并进去。对于消息列表（`MessagesValue`），新消息会追加到已有消息的后面。

multi-turn.ts

```typescript
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  START,
  END,
} from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { InMemorySaver } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'

const State = new StateSchema({
  messages: MessagesValue,
})

const model = new ChatOpenAI({ model: 'gpt-4.1-mini' })

const callModel: GraphNode<typeof State> = async (state) => {
  const response = await model.invoke(state.messages)
  return { messages: [response] }
}

const graph = new StateGraph(State)
  .addNode('callModel', callModel)
  .addEdge(START, 'callModel')
  .addEdge('callModel', END)
  .compile({ checkpointer: new InMemorySaver() })

// 同一个 thread_id
const config = { configurable: { thread_id: 'chat-001' } }

// 第一轮
const r1 = await graph.invoke(
  { messages: [{ role: 'user', content: '我叫小明，我是前端工程师' }] },
  config,
)
console.log(r1.messages.at(-1)?.content)
// → 你好小明！很高兴认识你...

// 第二轮（同一个 thread_id，上下文自动累积）
const r2 = await graph.invoke(
  { messages: [{ role: 'user', content: '我叫什么？我做什么工作？' }] },
  config,
)
console.log(r2.messages.at(-1)?.content)
// → 你叫小明，你是一名前端工程师。 ← 记住了！

// 换一个 thread_id = 全新的对话
const r3 = await graph.invoke(
  { messages: [{ role: 'user', content: '我叫什么？' }] },
  { configurable: { thread_id: 'chat-002' } },
)
console.log(r3.messages.at(-1)?.content)
// → 我不知道你叫什么。 ← 不同 thread，互不影响
```

**关键理解**：

- `thread_id` 相同 → 状态累积，对话连续

- `thread_id` 不同 → 状态隔离，互不干扰

- 消息列表的累积依赖 `MessagesValue` 的追加合并逻辑——这就是第三篇讲的 Reducer 在这里发挥的作用

- 不需要在调用时手动传入历史消息，Checkpointer 自动帮你加载，你只需要传**本轮新增的消息**

## 4. 时间旅行：查看和回溯历史状态

Checkpointer 不只是让多轮对话能跑起来。它保存的状态快照还可以被查看和回溯。

### 4.1 查看状态快照

**`getState`：获取当前状态**

get-state.ts

```typescript
const config = { configurable: { thread_id: 'chat-001' } }

const snapshot = await graph.getState(config)

// snapshot.values —— 当前完整的状态对象
console.log(snapshot.values.messages.length)

// snapshot.next —— 下一步将要执行的节点（空数组表示图已结束）
console.log(snapshot.next)  // []

// snapshot.config —— 这个快照的配置信息（包含 checkpoint_id）
console.log(snapshot.config.configurable?.checkpoint_id)
```

**`getStateHistory`：查看完整时间线**

get-state-history.ts

```typescript
const config = { configurable: { thread_id: 'chat-001' } }

for await (const snapshot of graph.getStateHistory(config)) {
  console.log('---')
  console.log('checkpoint_id:', snapshot.config.configurable?.checkpoint_id)
  console.log('消息数量:', snapshot.values.messages?.length ?? 0)
  console.log('下一步:', snapshot.next)
}
```

输出类似：

history-output.txt

```txt
---
checkpoint_id: 1ef7a8b2-...
消息数量: 4    ← 第二轮对话结束后
下一步: []
---
checkpoint_id: 1ef7a8b1-...
消息数量: 3    ← 第二轮模型回复前
下一步: ['callModel']
---
checkpoint_id: 1ef7a8a9-...
消息数量: 2    ← 第一轮对话结束后
下一步: []
---
checkpoint_id: 1ef7a8a8-...
消息数量: 1    ← 第一轮模型回复前
下一步: ['callModel']
```

每个 checkpoint 都有一个唯一的 `checkpoint_id`。通过这个 ID，你可以回到任意历史状态。

### 4.2 从历史状态重新开始

这是「时间旅行」的核心操作：**用历史 checkpoint 的 config 调用 `invoke`，从那个时间点重新执行。**

这里要注意一个细节：`snapshot.config` 里已经带着这次快照对应的运行配置，其中就包含了定位历史状态所需的信息。把它再传回 `graph.invoke(...)`，图就会从那个历史点继续往下走。

time-travel.ts

```typescript
const config = { configurable: { thread_id: 'chat-001' } }

// 找到第一轮对话结束时的 checkpoint
// getStateHistory 按时间倒序返回，最新的在前面
let targetConfig
for await (const snapshot of graph.getStateHistory(config)) {
  if (snapshot.values.messages?.length === 2) {
    // 2 条消息 = 第一轮的 user + ai
    targetConfig = snapshot.config
    break
  }
}

if (!targetConfig) {
  throw new Error('找不到目标 checkpoint')
}

// 从那个时间点重新开始，走一条不同的路
const result = await graph.invoke(
  { messages: [{ role: 'user', content: '换个话题，聊聊天气吧' }] },
  targetConfig,
)
```

这就像 git 的 checkout：你回到了第一轮对话结束的状态，然后从那里开始一段新的对话。第二轮原本的消息不会出现在这条新的分支里。

一个实际应用——**给对话加「撤回」功能**：

undo-example.ts

```typescript
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  START,
  END,
} from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { InMemorySaver } from '@langchain/langgraph'

const State = new StateSchema({
  messages: MessagesValue,
})

const echo: GraphNode<typeof State> = (state) => {
  const last = state.messages.at(-1)?.content?.toString() ?? ''
  return {
    messages: [{ role: 'assistant', content: `你说的是：${last}` }],
  }
}

const checkpointer = new InMemorySaver()
const graph = new StateGraph(State)
  .addNode('echo', echo)
  .addEdge(START, 'echo')
  .addEdge('echo', END)
  .compile({ checkpointer })

const config = { configurable: { thread_id: 'undo-demo' } }

// 第一轮
await graph.invoke(
  { messages: [{ role: 'user', content: '第一条消息' }] },
  config,
)

// 第二轮
await graph.invoke(
  { messages: [{ role: 'user', content: '第二条消息' }] },
  config,
)

// 此时有 4 条消息：user1, ai1, user2, ai2

// 「撤回」第二轮：找到第一轮结束时的 checkpoint
let firstRoundConfig
for await (const snapshot of graph.getStateHistory(config)) {
  if (snapshot.values.messages?.length === 2) {
    firstRoundConfig = snapshot.config
    break
  }
}

// 如果没找到目标 checkpoint，说明历史数据有问题
if (!firstRoundConfig) {
  throw new Error('找不到第一轮结束的 checkpoint')
}

// 从第一轮的状态重新发一条不同的消息
const result = await graph.invoke(
  { messages: [{ role: 'user', content: '换一条消息' }] },
  firstRoundConfig,
)

console.log(result.messages.length)
// → 4（user1, ai1, user-new, ai-new）
// 原来的第二轮历史仍然存在；
// 这里只是从第一轮结束的状态出发，又分出了一条新的后续分支
```

## 5. 生产环境：选择合适的 Checkpointer

`InMemorySaver` 的数据存在进程内存里，进程一退出就没了。生产环境需要持久化的存储方案。

LangGraph 官方提供了几种选择：

| Checkpointer | 包名 | 适用场景 |
| --- | --- | --- |
| InMemorySaver | @langchain/langgraph | 开发调试、单元测试 |
| PostgresSaver | @langchain/langgraph-checkpoint-postgres | 生产环境，需要持久化 |
| MongoDBSaver | @langchain/langgraph-checkpoint-mongodb | 已有 MongoDB 基础设施 |

**PostgreSQL 示例**：

postgres-saver.ts

```typescript
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'

// 连接数据库
const checkpointer = PostgresSaver.fromConnString(
  'postgresql://user:pass@localhost:5432/mydb',
)

// 初始化表结构（首次使用时执行）
await checkpointer.setup()

// 传给 compile，用法和 InMemorySaver 完全一致
const graph = builder.compile({ checkpointer })
```

切换 Checkpointer 不需要改任何业务代码——`compile` 接收的接口是统一的，底层存储方案可以随时替换。

NOTE

如果你的应用目前只在开发阶段，用 `InMemorySaver` 就够了。等需要部署时再换成 PostgreSQL 或 MongoDB，迁移成本很低。

## 6. 总结

Checkpointer 解决的核心问题：**让图的状态可以跨越单次 `invoke` 的生命周期。**

三个关键概念：

- **`thread_id`**——区分不同会话的标识。相同 ID 共享状态时间线，不同 ID 完全隔离

- **Super-step 保存**——每个 super-step 结束后自动保存一份状态快照，不需要手动触发

- **时间旅行**——通过 `getStateHistory` 查看历史快照，通过 `checkpoint_id` 回到任意历史状态重新执行

使用速查：

| 步骤 | 代码 |
| --- | --- |
| 创建 checkpointer | new InMemorySaver() |
| 传给 compile | builder.compile({ checkpointer }) |
| 调用时传 thread_id | graph.invoke(input, { configurable: { thread_id: '...' } }) |
| 查看当前状态 | graph.getState(config) |
| 查看历史 | graph.getStateHistory(config) |
| 时间旅行 | 用历史 checkpoint 的 config 调用 invoke |

下一篇是 **用 LangGraph 构建 ReAct Agent**——LangGraph 基础阶段的「回报点」。把前五篇学到的 StateGraph、Reducer、条件边、Checkpointer 全部串起来，构建一个完整的、有工具调用能力的、支持多轮对话的 Agent。
