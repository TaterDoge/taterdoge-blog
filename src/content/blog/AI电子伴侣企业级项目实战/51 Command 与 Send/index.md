---
title: "51 Command 与 Send"
pubDate: 2026-04-28
description: "ReAct Agent 的工具循环、质量门控的重试循环，核心都是 addConditionalEdges。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/8-command-send/](https://aicompanion.usehook.cn/8-command-send/)

## 1. 条件边有一个不方便的地方

前面几篇用条件边完成了大量路由逻辑。

ReAct Agent 的工具循环、质量门控的重试循环，核心都是 `addConditionalEdges`。

条件边能力上没问题，但用多了会发现一个不太方便的地方：**路由逻辑和节点逻辑是分开的。**

比如前面的重试循环：

separate-logic.ts

```typescript
import type { GraphNode, ConditionalEdgeRouter } from '@langchain/langgraph'

// 验证节点：检查草稿质量，把结果写入状态
const validate: GraphNode<typeof State> = (state) => {
  if (state.draft.length >= 30) {
    return { isValid: true, feedback: '' }
  }
  return { isValid: false, feedback: '草稿太短' }
}

// 路由函数：读取验证结果，决定下一步
const checkResult: ConditionalEdgeRouter<typeof State, 'generate'> = (state) => {
  if (state.isValid) return END
  if (state.retryCount >= 3) return END
  return 'generate'
}
```

`validate` 节点已经知道草稿合不合格了，但它没法直接说「下一步去哪」。它只能先把 `isValid` 写入状态，然后等条件边的路由函数再去读这个字段。

做同一个决策，代码分散在两个地方。

当图变复杂以后，这种分离会越来越明显：

- 决策的上下文在节点里

- 但路由的执行在条件边里

- 两边要通过状态字段做间接通信

`Command` 就是用来解决这件事的：**让节点直接说「我要更新这些状态，并且下一步走到那个节点」。**

## 2. Command：在节点里直接决定下一步去哪

`Command` 是一个类。节点不再返回普通的状态对象，而是返回一个 `Command` 实例。

command-shape.ts

```typescript
import { Command } from '@langchain/langgraph'

return new Command({
  update: { isValid: true },  // 状态更新，和节点正常返回的对象一样
  goto: 'output',             // 下一步走到哪个节点
})
```

两个字段：

- `update`：状态更新，和节点正常返回的状态对象一样

- `goto`：下一步要走到的节点名

先看一个最简单的完整例子：

command-basic.ts

```typescript
import {
  StateGraph,
  StateSchema,
  START,
  END,
  Command,
} from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const State = new StateSchema({
  value: z.string().default(''),
  route: z.string().default(''),
})

// nodeA 根据输入决定下一步去哪
const nodeA: GraphNode<typeof State> = (state) => {
  if (state.value === 'urgent') {
    return new Command({
      update: { route: 'fast' },
      goto: 'fastTrack',
    })
  }
  return new Command({
    update: { route: 'normal' },
    goto: 'normalTrack',
  })
}

const fastTrack: GraphNode<typeof State> = (state) => {
  return { value: `${state.value} → 快速通道处理完成` }
}

const normalTrack: GraphNode<typeof State> = (state) => {
  return { value: `${state.value} → 普通通道处理完成` }
}

const graph = new StateGraph(State)
  // ends 声明 nodeA 可能会跳到哪些节点
  .addNode('nodeA', nodeA, { ends: ['fastTrack', 'normalTrack'] })
  .addNode('fastTrack', fastTrack)
  .addNode('normalTrack', normalTrack)
  .addEdge(START, 'nodeA')
  .addEdge('fastTrack', END)
  .addEdge('normalTrack', END)
  .compile()

const result = await graph.invoke({ value: 'urgent' })
console.log(result.value)
// → urgent → 快速通道处理完成
console.log(result.route)
// → fast
```

这里最关键的一行：

addNode-ends.ts

```typescript
.addNode('nodeA', nodeA, { ends: ['fastTrack', 'normalTrack'] })
```

当节点用 `Command` 做路由时，这篇里的写法都会通过 `ends` 告诉 LangGraph 这个节点可能会跳到哪些目标。因为 `goto` 是运行时才确定的，编译阶段先把候选目标声明出来，图才能顺利通过结构检查。

**和条件边对比**

同样的逻辑，用条件边需要三样东西：

- 节点函数——把决策结果写入状态

- 路由函数——读状态字段，返回节点名

- `addConditionalEdges`——把路由函数挂到边上

用 `Command` 只需要两样：

- 节点函数——在内部直接决定状态更新和下一步目标

- `addNode` 的 `ends` 选项——声明可能的目标

逻辑更集中，代码也更短。

### 用 Command 重写重试循环

把第四篇的重试循环用 `Command` 改写。对比一下哪些代码可以省掉。

command-retry.ts

```typescript
import {
  StateGraph,
  StateSchema,
  START,
  END,
  Command,
} from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const State = new StateSchema({
  draft: z.string().default(''),
  retryCount: z.number().default(0),
  feedback: z.string().default(''),
})

// generate 不需要改，它只负责生成草稿
const generate: GraphNode<typeof State> = (state) => {
  if (state.retryCount === 0) {
    return { draft: 'LangGraph 是一个框架。', retryCount: 1 }
  }
  return {
    draft: `LangGraph 是一个基于图的 AI 工作流编排框架，支持状态管理、条件路由和持久化。（第 ${state.retryCount + 1} 版）`,
    retryCount: state.retryCount + 1,
  }
}

// validate 现在直接决定下一步去哪，不需要单独的路由函数了
const validate: GraphNode<typeof State> = (state) => {
  if (state.draft.length >= 30) {
    return new Command({
      update: { feedback: '' },
      goto: 'output',
    })
  }

  if (state.retryCount >= 3) {
    return new Command({
      update: { feedback: '已达最大重试次数' },
      goto: 'output',
    })
  }

  return new Command({
    update: { feedback: `草稿太短（${state.draft.length} 字），至少需要 30 字` },
    goto: 'generate',
  })
}

const output: GraphNode<typeof State> = (state) => {
  return { draft: `最终结果：${state.draft}` }
}

const graph = new StateGraph(State)
  .addNode('generate', generate)
  // ends 声明 validate 可能跳到的所有目标
  .addNode('validate', validate, { ends: ['generate', 'output'] })
  .addNode('output', output)
  .addEdge(START, 'generate')
  .addEdge('generate', 'validate')
  .addEdge('output', END)
  .compile()

const result = await graph.invoke({})
console.log(result.draft)
// → 最终结果：LangGraph 是一个基于图的 AI 工作流编排框架...
```

和第四篇对比，省掉了：

- `isValid` 状态字段——不需要了，`validate` 内部直接判断完就跳转

- `checkResult` 路由函数——不需要了，路由逻辑在 `validate` 节点里

- `addConditionalEdges`——不需要了，换成 `addNode` 的 `ends`

注意 `generate → validate` 之间还是用的普通边。因为 `generate` 执行完一定走 `validate`，没有条件分支。只有 `validate` 的下一步不确定，所以只有它用了 `Command`。

### 什么时候用 Command，什么时候用条件边

不需要一刀切，按这个思路选：

- 路由只是简单地读一个布尔值或枚举字段 → 条件边就够了

- 路由逻辑和节点逻辑紧密绑定，「算完就知道该走哪条路」 → `Command` 更自然

- 需要在同一步里既更新状态又决定路由 → 用 `Command` 最顺手

两种方式可以在同一张图里混用。

## 3. Send：让同一个节点并行跑多份

`Command` 解决的是路由问题。`Send` 解决的是另一个问题：**一个节点需要并行跑多份，每份拿到不同的输入。**

最典型的场景是 map-reduce：

- 先把一个任务拆成 N 份（map）

- 每份并行处理

- 最后把结果汇总（reduce）

比如用户给了三个主题，你想同时为三个主题生成摘要，而不是排队生成。

`Send` 的构造函数只有两个参数：

send-shape.ts

```typescript
import { Send } from '@langchain/langgraph'

new Send('targetNode', { topics: ['React'] })
//        ↑ 目标节点名    ↑ 传给这个节点的状态
```

每个 `Send` 实例代表「调用一次目标节点，传入这份特定的状态」。返回多个 `Send`，就是并行调用多次。

### 在条件边里使用 Send

`Send` 最基础的用法是在条件边的路由函数里返回一个 `Send` 数组：

send-basic.ts

```typescript
import {
  StateGraph,
  StateSchema,
  ReducedValue,
  Send,
  START,
  END,
} from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const appendStrings = (current: string[], update: string[]) => {
  return [...current, ...update]
}

const State = new StateSchema({
  topics: z.array(z.string()).default([]),
  // 多个并行节点都会写 summaries，所以必须用 reducer 追加
  summaries: new ReducedValue(
    z.array(z.string()).default([]),
    { reducer: appendStrings },
  ),
})

// 这个节点会被并行调用多次，每次拿到一个不同的 topic
const summarize: GraphNode<typeof State> = (state) => {
  const topic = state.topics[0]
  return {
    summaries: [`「${topic}」的摘要：这是一段关于 ${topic} 的分析...`],
  }
}

// 路由函数返回 Send 数组，触发并行扇出（fan-out）
// 这里的“扇出”是分布式系统里的常用说法，意思是把一份输入拆成多份子任务，同时分发给多个并行执行的分支
const fanOut = (state: typeof State.type) => {
  return state.topics.map(
    (topic) => new Send('summarize', { topics: [topic] })
  )
}

const graph = new StateGraph(State)
  .addNode('summarize', summarize)
  .addConditionalEdges(START, fanOut)
  .addEdge('summarize', END)
  .compile()

const result = await graph.invoke({
  topics: ['React', 'LangGraph', 'Zustand'],
})

console.log(result.summaries)
// [
//   '「React」的摘要：这是一段关于 React 的分析...',
//   '「LangGraph」的摘要：这是一段关于 LangGraph 的分析...',
//   '「Zustand」的摘要：这是一段关于 Zustand 的分析...',
// ]
```

这里有三个要点。

第一，`fanOut` 不是返回一个节点名，而是返回一个 `Send` 数组。每个 `Send` 都指向同一个 `summarize` 节点，但传入的状态不同。LangGraph 会把它们并行执行。

第二，`summaries` 字段必须声明 reducer。因为三个并行节点都在往这个字段里写，如果没有 reducer，结果会互相覆盖，只留下最后一个。

第三，`Send` 的第二个参数是传给目标节点的状态。这里传的是 `{ topics: [topic] }`，只包含一个 topic。目标节点 `summarize` 拿到的 `state.topics` 就只有一个元素。

### 在 Command 的 goto 里使用 Send

`Send` 不只能在条件边里用。它也可以放在 `Command` 的 `goto` 字段里，这样就能一步完成状态更新 + 并行扇出（fan-out，也就是把一份任务拆成多份后同时派发出去）：

command-send.ts

```typescript
import {
  StateGraph,
  StateSchema,
  ReducedValue,
  Command,
  Send,
  START,
  END,
} from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const appendStrings = (current: string[], update: string[]) => {
  return [...current, ...update]
}

const State = new StateSchema({
  topics: z.array(z.string()).default([]),
  summaries: new ReducedValue(
    z.array(z.string()).default([]),
    { reducer: appendStrings },
  ),
  status: z.string().default(''),
})

// dispatcher 既更新状态，又触发并行扇出
const dispatcher: GraphNode<typeof State> = (state) => {
  return new Command({
    update: { status: `正在处理 ${state.topics.length} 个主题` },
    goto: state.topics.map(
      (topic) => new Send('summarize', { topics: [topic] })
    ),
  })
}

const summarize: GraphNode<typeof State> = (state) => {
  const topic = state.topics[0]
  return {
    summaries: [`${topic} 分析完成`],
  }
}

const graph = new StateGraph(State)
  .addNode('dispatcher', dispatcher, { ends: ['summarize'] })
  .addNode('summarize', summarize)
  .addEdge(START, 'dispatcher')
  .addEdge('summarize', END)
  .compile()

const result = await graph.invoke({
  topics: ['性能优化', '错误处理', '状态管理'],
})

console.log(result.status)
// → 正在处理 3 个主题
console.log(result.summaries)
// → ['性能优化 分析完成', '错误处理 分析完成', '状态管理 分析完成']
```

这就是 `Command + Send` 的组合：一步完成状态更新 + 并行扇出。

## 4. 实战：多城市天气并行查询

把前面的能力综合起来，做一个更接近实际的例子。

**场景**：用户问多个城市的天气 → 解析出城市列表 → 并行查询每个城市 → 汇总回复。

parallel-weather.ts

```typescript
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  ReducedValue,
  Command,
  Send,
  START,
  END,
} from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const appendStrings = (current: string[], update: string[]) => {
  return [...current, ...update]
}

const State = new StateSchema({
  messages: MessagesValue,
  cities: z.array(z.string()).default([]),
  weatherResults: new ReducedValue(
    z.array(z.string()).default([]),
    { reducer: appendStrings },
  ),
})

// 1. 解析节点：从用户消息里提取城市列表，然后扇出到查询节点
const parseCities: GraphNode<typeof State> = (state) => {
  const userMsg = state.messages.at(-1)?.content?.toString() ?? ''

  // 实际项目里这里会用 LLM 做实体提取，这里简化处理
  const knownCities = ['北京', '上海', '深圳', '广州', '杭州']
  const found = knownCities.filter((c) => userMsg.includes(c))

  if (found.length === 0) {
    // 没找到城市，直接结束
    return new Command({
      update: {
        messages: [{ role: 'assistant', content: '没有识别到城市名称。' }],
      },
      goto: END,
    })
  }

  // 找到了城市，更新城市列表 + 并行扇出查询
  return new Command({
    update: { cities: found },
    goto: found.map((city) => new Send('queryWeather', { cities: [city] })),
  })
}

// 2. 查询节点：查单个城市的天气（会被并行调用多次）
const queryWeather: GraphNode<typeof State> = (state) => {
  const city = state.cities[0]
  const data: Record<string, string> = {
    北京: '晴，12-25°C',
    上海: '小雨，17-22°C',
    深圳: '多云，26-30°C',
    广州: '阵雨，24-29°C',
    杭州: '晴转多云，15-27°C',
  }
  return {
    weatherResults: [`${city}：${data[city] ?? '暂无数据'}`],
  }
}

// 3. 汇总节点：把所有天气结果组织成最终回复
const formatReport: GraphNode<typeof State> = (state) => {
  const report = state.weatherResults.join('\n')
  return {
    messages: [{
      role: 'assistant',
      content: `查询到 ${state.cities.length} 个城市的天气：\n\n${report}`,
    }],
  }
}

const graph = new StateGraph(State)
  .addNode('parseCities', parseCities, { ends: ['queryWeather'] })
  .addNode('queryWeather', queryWeather)
  .addNode('formatReport', formatReport)
  .addEdge(START, 'parseCities')
  .addEdge('queryWeather', 'formatReport')
  .addEdge('formatReport', END)
  .compile()

const result = await graph.invoke({
  messages: [{ role: 'user', content: '北京、上海和深圳今天天气怎么样？' }],
})

console.log(result.messages.at(-1)?.content)
// → 查询到 3 个城市的天气：
// →
// → 北京：晴，12-25°C
// → 上海：小雨，17-22°C
// → 深圳：多云，26-30°C
```

这张图的执行流程：

- `parseCities` 从用户消息里提取出「北京、上海、深圳」三个城市

- 用 `Command` 同时完成两件事：把城市列表写入状态 + 用 `Send` 扇出三个并行查询

- 三个 `queryWeather` 并行执行，各自查一个城市，结果通过 reducer 汇总到 `weatherResults`

- `formatReport` 拿到全部结果，拼成最终回复

如果没有 `Send`，你只能顺序查三次；如果没有 `Command`，你需要额外的条件边和状态字段来完成路由。两者组合在一起，代码更紧凑，语义也更清晰。

## 5. 使用注意

**Command 的 goto 会追加一条动态出边**

如果你同时给一个节点加了普通边和 `Command` 路由：

gotcha-edge.ts

```typescript
graph
  .addEdge('nodeA', 'nodeB')                          // 普通边
  .addNode('nodeA', nodeA, { ends: ['nodeC'] })       // nodeA 返回 Command({ goto: 'nodeC' })
```

那 `nodeB` 和 `nodeC` 都会执行。`Command` 的 `goto` 不会取消已有的普通边，它只是额外追加了一条动态边。所以，如果你打算把某个节点的出路完全交给 `Command`，就不要再给它保留普通出边。

**ends 要一起写上**

用 `Command` 做路由时，`addNode` 的 `ends` 最好和节点一起声明。这样一来，图编译时能先知道这个节点可能跳到哪些目标；二来读代码时也能一眼看清这个节点的出口范围。

`ends` 的作用是告诉 LangGraph：这个节点可能会动态跳到哪些目标。图编译时需要这个信息来验证结构完整性和生成可视化。

**Send 的并行结果需要 reducer**

多个 `Send` 并行写同一个状态字段时，必须给这个字段声明 reducer（第三篇讲过的 `ReducedValue`）。没有 reducer 的话，多个并行写入会互相覆盖，最后只留下其中一个的值。

**Command 和条件边可以混用**

一张图里可以同时有用 `Command` 路由的节点和用条件边路由的节点。选哪种取决于那个节点的具体场景，不需要全图统一。

## 6. 总结

这一篇往前多走了一步：前面的条件边，解决的是“根据状态决定下一步去哪”；这里的 `Command`，解决的是“节点自己在更新状态的同时，直接决定下一步去哪”；`Send` 则是把“一份任务拆成多份并行去跑”这件事补上。

所以它们的关系不是替代，而是分工更细：

- 简单条件分叉，条件边就够了

- 节点里已经算完了，也知道下一步去哪，用 `Command`

- 同一个节点要并行跑很多份，用 `Send`

- 既要改状态又要并行扇出，就把 `Command` 和 `Send` 组合起来

下一篇讲 **interrupt：暂停与恢复机制**。到那时，图不只是“继续往下走”，还会在运行中停下来，等外部输入后再继续。
