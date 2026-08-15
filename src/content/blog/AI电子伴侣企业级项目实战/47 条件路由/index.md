---
title: "47 条件路由"
pubDate: 2026-04-27
description: "前两篇已经展示过条件边的基本用法：addConditionalEdges 接一个路由函数，根据当前状态返回下一个节点名称。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/4-conditional-edges/](https://aicompanion.usehook.cn/4-conditional-edges/)

## 1. 条件边不只是分叉，还能构建循环

前两篇已经展示过条件边的基本用法：`addConditionalEdges` 接一个路由函数，根据当前状态返回下一个节点名称。

情绪路由的例子里，`happy` 走 `happyReply`、`sad` 走 `sadReply`——这是条件边最直观的用法：**单次分叉**。

但条件边真正的威力不在分叉，而在于它能指向「前面」的节点，形成**循环**。

循环是 LangGraph 区别于简单 DAG 的核心能力。重试、自我修正、ReAct 工具调用——这些关键模式全靠循环实现。

这篇文章从条件边的 API 补全开始，重点讲循环的构建方法和常见模式。

## 2. 条件边 API 补全

第二篇讲了 `addConditionalEdges` 的三个参数和 `ConditionalEdgeRouter` 的类型签名。这里补两个之前没展开的能力。

先记住一个边界：**条件边只负责决定下一步往哪走，不负责更新状态。**

状态更新应该放在节点里完成。条件边读取节点已经写进 state 的结果，然后返回下一个目标节点，或者返回 `END` 结束图。

如果你既想更新状态，又想顺手改变控制流，那已经不是条件边的职责了，后面讲 `Command` 时再展开。

**路由到 END：提前终止**

路由函数可以返回 `END`，让图直接结束：

route-to-end.ts

```typescript
import { END } from '@langchain/langgraph'
import type { ConditionalEdgeRouter } from '@langchain/langgraph'

const router: ConditionalEdgeRouter<typeof State, 'retry'> = (state) => {
  if (state.retryCount >= 3) {
    return END  // 超过 3 次，直接结束
  }
  return 'retry'
}
```

不需要在目标列表里声明 `END`——LangGraph 自动支持。当返回 `END` 时，图立即停止，返回当前状态作为最终结果。

**路由函数可以是异步的**

如果路由决策需要异步操作（查数据库、调 API），路由函数可以写成 `async`：

async-router.ts

```typescript
const router: ConditionalEdgeRouter<typeof State, 'premium' | 'basic'> = async (state) => {
  const user = await getUserFromDB(state.userId)
  return user.tier === 'premium' ? 'premium' : 'basic'
}
```

不过要注意：路由函数在每次经过这条边时都会执行。如果逻辑复杂，建议把计算放在节点里，把结果写入状态字段，路由函数只做简单的字段判断。

### 2.3 返回多个目标时会并行执行

条件边不一定只能返回一个节点名。

如果路由函数返回多个目标，这些目标会在下一次 super-step 里并行执行。

multi-target-router.ts

```typescript
const router: ConditionalEdgeRouter<typeof State, 'saveLog' | 'sendEmail'> = (state) => {
  if (state.shouldNotify) {
    return ['saveLog', 'sendEmail']
  }
  return ['saveLog']
}
```

这和普通的 `if...else` 有点不一样。

很多人第一次学条件边，会自然把它理解成“只选一条路”。但在 LangGraph 里，路由函数也可以一次返回多条路，让多个节点并行往下走。

### 2.4 第三个参数是候选目标，不是运行时映射表

你会经常看到这种写法：

code.ts

```typescript
.addConditionalEdges('validate', checkResult, ['generate'])
```

这里第三个参数的意思更接近“这条条件边可能会走到哪些节点”，主要是给图结构和类型约束用的。

它不是说“LangGraph 会自动按这个数组下标去做映射”。

真正决定下一步去哪的，还是前面的路由函数返回值。

所以读这类代码时，注意把这两件事分开：

- 路由函数：运行时到底返回什么

- 第三个参数：这条边允许走到哪些候选节点

## 3. 构建循环：条件边的真正威力

### 3.1 条件边可以指回「前面」的节点

这是理解 LangGraph 控制流的关键：条件边的目标可以是图中**任何已添加的节点**，包括执行顺序上「靠前」的节点。指回前面的节点，就形成了循环。

loop-structure.txt

```txt
    ┌────────────┐
    │   START    │
    └─────┬──────┘
          │
          ▼
    ┌────────────┐
    │  generate  │◄──────────┐
    └─────┬──────┘           │
          │                  │
          ▼                  │
    ┌────────────┐           │
    │  validate  │           │
    └─────┬──────┘           │
          │                  │
      通过了吗？              │
       ╱     ╲               │
      是      否             │
      │        └─────────────┘  ← 条件边指回 generate
      ▼
   ┌──────┐
   │ END  │
   └──────┘
```

`generate → validate → (不通过) → generate → validate → ...`，直到验证通过或达到最大次数。

用代码实现这个结构：

retry-pattern.ts

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
  draft: z.string().default(''),
  isValid: z.boolean().default(false),
  retryCount: z.number().default(0),
  feedback: z.string().default(''),
})

// 生成节点：根据反馈改进草稿
const generate: GraphNode<typeof State> = (state) => {
  if (state.retryCount === 0) {
    return {
      draft: 'LangGraph 是一个框架。',
      retryCount: 1,
    }
  }
  // 后续根据反馈改进（实际场景调 LLM）
  return {
    draft: `LangGraph 是一个基于图的 AI 工作流编排框架，支持状态管理、条件路由和持久化。（第 ${state.retryCount + 1} 版）`,
    retryCount: state.retryCount + 1,
  }
}

// 验证节点：检查草稿质量
const validate: GraphNode<typeof State> = (state) => {
  if (state.draft.length >= 30) {
    return { isValid: true, feedback: '' }
  }
  return {
    isValid: false,
    feedback: `草稿太短（${state.draft.length} 字），至少 30 字`,
  }
}

// 路由：通过就结束，否则重试
const checkResult: ConditionalEdgeRouter<typeof State, 'generate'> = (state) => {
  if (state.isValid) return END
  if (state.retryCount >= 3) return END   // 防止无限循环
  return 'generate'
}

// 构建图
const graph = new StateGraph(State)
  .addNode('generate', generate)
  .addNode('validate', validate)
  .addEdge(START, 'generate')
  .addEdge('generate', 'validate')
  // 第三个参数这里只是声明：这条条件边可能会回到 generate。
  .addConditionalEdges('validate', checkResult, ['generate'])
  .compile()

const result = await graph.invoke({
  messages: [{ role: 'user', content: '写一段关于 LangGraph 的介绍' }],
})

console.log(`经过 ${result.retryCount} 次尝试`)
console.log(`通过验证: ${result.isValid}`)
console.log(`最终草稿: ${result.draft}`)
// → 经过 2 次尝试
// → 通过验证: true
// → 最终草稿: LangGraph 是一个基于图的 AI 工作流编排框架...
```

### 3.2 循环必须有终止条件

没有终止条件的循环会让图永远跑不完。终止条件通常有两种：

**业务条件**——验证通过、任务完成。这是「正常出口」：

normal-exit.ts

```typescript
if (state.isValid) return END
```

**保底条件**——最大重试次数、超时。这是「安全出口」：

safety-exit.ts

```typescript
if (state.retryCount >= 3) return END
```

两者缺一不可。只有业务条件，万一永远不满足就死循环了；只有保底条件，正常完成时还要白跑到上限。

## 4. ReAct 循环：工具调用的核心模式

LangGraph 里最常见的循环就是 ReAct Agent 的工具调用循环。结构很简单：

react-loop.txt

```txt
        ┌───────────────┐
        │    START      │
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │   callModel   │◄──────────────┐
        └───────┬───────┘               │
                │                       │
           有工具调用？                   │
           ╱         ╲                  │
          是          否                │
          │            │                │
          ▼            ▼                │
    ┌────────────┐  ┌────────┐          │
    │ callTools  │  │  END   │          │
    └─────┬──────┘  └────────┘          │
          │                              │
          └──────────────────────────────┘
```

这个循环由两种边配合完成：

- **条件边**：`callModel → (有工具调用？) → callTools 或 END`

- **普通边**：`callTools → callModel`（工具执行完，回到模型继续推理）

完整实现：

react-agent.ts

```typescript
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  START,
  END,
} from '@langchain/langgraph'
import type { GraphNode, ConditionalEdgeRouter } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import * as z from 'zod'

// 定义工具
const getWeather = tool(
  async ({ city }) => `${city}：多云，18-24°C`,
  {
    name: 'get_weather',
    description: '查询城市天气',
    schema: z.object({ city: z.string() }),
  },
)

const tools = [getWeather]
const toolsByName = Object.fromEntries(tools.map(t => [t.name, t]))
const model = new ChatOpenAI({ model: 'gpt-4.1-mini' }).bindTools(tools)

const State = new StateSchema({
  messages: MessagesValue,
})

// 调用模型
const callModel: GraphNode<typeof State> = async (state) => {
  const response = await model.invoke(state.messages)
  return { messages: [response] }
}

// 执行工具
const callTools: GraphNode<typeof State> = async (state) => {
  const lastMsg = state.messages.at(-1)!
  const toolCalls = lastMsg.tool_calls ?? []

  const toolResults = await Promise.all(
    toolCalls.map(async (tc) => {
      const result = await toolsByName[tc.name].invoke(tc.args)
      return { role: 'tool' as const, content: result, tool_call_id: tc.id }
    }),
  )

  return { messages: toolResults }
}

// 路由：有工具调用就继续，没有就结束
const shouldContinue: ConditionalEdgeRouter<typeof State, 'callTools'> = (state) => {
  const lastMsg = state.messages.at(-1)!
  if (lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
    return 'callTools'
  }
  return END
}

// 构建图
const graph = new StateGraph(State)
  .addNode('callModel', callModel)
  .addNode('callTools', callTools)
  .addEdge(START, 'callModel')
  // 条件边只负责看最后一条模型消息里有没有 tool_calls，
  // 不负责执行工具，也不负责改消息。
  .addConditionalEdges('callModel', shouldContinue, ['callTools'])
  .addEdge('callTools', 'callModel')  // 工具执行完，回到模型
  .compile()

const result = await graph.invoke({
  messages: [{ role: 'user', content: '北京和上海今天天气怎么样？' }],
})

for (const msg of result.messages) {
  console.log(`[${msg.getType()}]: ${msg.content?.toString().slice(0, 80)}`)
}
```

这段代码的核心只有 5 行图定义：

graph-core.ts

```typescript
new StateGraph(State)
  .addNode('callModel', callModel)
  .addNode('callTools', callTools)
  .addEdge(START, 'callModel')                                     // 入口
  .addConditionalEdges('callModel', shouldContinue, ['callTools'])  // 条件分支
  .addEdge('callTools', 'callModel')                               // 循环回路
```

两个节点、三条边，就构成了一个完整的 ReAct Agent。模型可以连续调多个工具，每次调完都会回到模型，直到模型决定不再调用工具为止。

这和 LangChain 的 `createAgent` 做的事一样，但控制流是显式的。你可以在任意节点之间插入新的处理步骤（比如安全检查、日志记录），不需要改动模型的 prompt。

## 5. 实战：带质量门控的分析管线

把前面的模式综合起来，构建一个更贴近真实场景的例子。

**场景**：用户提一个问题 → 收集信息 → 生成分析报告 → 质量检查 → 不合格就带着反馈重新分析。

pipeline-flow.txt

```txt
  START → gather → analyze → review ──┐
                     ▲                 │
                     │         quality? │
                     │        ╱       ╲ │
                     └── fail         pass
                                       │
                                       ▼
                                    output → END
```

完整实现：

analysis-pipeline.ts

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
  report: z.string().default(''),
  quality: z.enum(['unchecked', 'pass', 'fail']).default('unchecked'),
  reviewFeedback: z.string().default(''),
  reviewCount: z.number().default(0),
})

// 1. 收集信息（简化版，实际场景会调 LLM + 工具）
const gather: GraphNode<typeof State> = (state) => {
  const question = state.messages.at(-1)?.content?.toString() ?? ''
  return {
    messages: [{ role: 'assistant', content: `已收集「${question}」的相关信息。` }],
  }
}

// 2. 生成报告
const analyze: GraphNode<typeof State> = (state) => {
  if (state.reviewCount === 0) {
    return { report: '初步分析：数据呈上升趋势。' }
  }
  // 根据反馈改进
  return {
    report: `深度分析（第 ${state.reviewCount + 1} 版）：数据呈上升趋势，主要驱动因素是用户增长（+15%）和客单价提升（+8%）。环比增速放缓，需关注获客成本变化。`,
  }
}

// 3. 质量检查
const review: GraphNode<typeof State> = (state) => {
  const count = state.reviewCount + 1

  // 报告需要包含具体数据
  if (state.report.includes('%') && state.report.length > 50) {
    return {
      quality: 'pass' as const,
      reviewFeedback: '',
      reviewCount: count,
    }
  }

  return {
    quality: 'fail' as const,
    reviewFeedback: '报告缺少具体数据支撑，请补充百分比、绝对值等量化指标',
    reviewCount: count,
  }
}

// 4. 输出最终结果
const output: GraphNode<typeof State> = (state) => {
  return {
    messages: [{
      role: 'assistant',
      content: `分析完成（经过 ${state.reviewCount} 轮审核）：\n\n${state.report}`,
    }],
  }
}

// 路由：审核后决定是重新分析还是输出
const reviewRouter: ConditionalEdgeRouter<typeof State, 'analyze' | 'output'> = (state) => {
  if (state.quality === 'pass') return 'output'
  if (state.reviewCount >= 3) return 'output'  // 保底
  return 'analyze'                              // 重新分析
}

// 构建图
const graph = new StateGraph(State)
  .addNode('gather', gather)
  .addNode('analyze', analyze)
  .addNode('review', review)
  .addNode('output', output)
  .addEdge(START, 'gather')
  .addEdge('gather', 'analyze')
  .addEdge('analyze', 'review')
  .addConditionalEdges('review', reviewRouter, ['analyze', 'output'])
  .addEdge('output', END)
  .compile()

const result = await graph.invoke({
  messages: [{ role: 'user', content: '分析上季度的营收趋势' }],
})

console.log(result.messages.at(-1)?.content)
// → 分析完成（经过 2 轮审核）：
// → 深度分析（第 2 版）：数据呈上升趋势，主要驱动因素是...
```

关键设计点：

- `gather → analyze` 是普通边：收集完信息一定进入分析

- `analyze → review` 是普通边：分析完一定要过质量检查

- `review → analyze 或 output` 是条件边：不合格就循环回分析节点

- 保底条件 `reviewCount >= 3` 防止无限循环

在实际项目中，把 `analyze` 和 `review` 里的模拟逻辑替换成真正的 LLM 调用，就是一个完整的自我修正管线。

## 6. 总结

条件边的三个核心能力：

- **分叉**——根据状态走不同路径（第二篇已覆盖）

- **循环**——条件边指回前面的节点，实现重试和自我修正

- **提前终止**——路由函数返回 `END`，跳过后续节点直接结束

常见模式速查：

| 模式 | 结构 | 终止条件 |
| --- | --- | --- |
| 单次分叉 | A → (条件) → B 或 C → END | 无循环，不需要 |
| 重试循环 | 生成 → 验证 → (条件) → 生成 或 END | 验证通过 + 最大次数 |
| ReAct 循环 | 模型 → (条件) → 工具 → 模型 或 END | 模型不再调用工具 |
| 质量门控 | 处理 → 审核 → (条件) → 处理 或 输出 | 审核通过 + 最大次数 |

三条设计原则：

- **路由函数只做判断，不做计算。** 把复杂逻辑放在节点里，路由函数只读状态字段

- **条件边负责路由，不负责改状态。** 需要改状态时，让节点先写入状态，再由条件边读取

- **每个循环都必须有终止条件。** 业务条件（正常出口）+ 保底条件（安全出口）

- **状态字段是路由的唯一依据。** 不要在路由函数里调 API 或做随机决策

下一篇讲 **Checkpointer：状态持久化与时间旅行**。有了 Checkpointer，图的执行状态可以存到数据库，支持中断恢复和历史回溯——这是构建生产级 Agent 的关键基础设施。
