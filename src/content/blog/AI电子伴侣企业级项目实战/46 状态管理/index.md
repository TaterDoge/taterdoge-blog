---
title: "46 状态管理"
pubDate: 2026-04-26
description: "比如第一个节点写入 draft，第二个节点再改 draft。这种时候，后面的值覆盖前面的值，通常没什么问题。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/3-reducer-state/](https://aicompanion.usehook.cn/3-reducer-state/)

## 1. 状态不是“存下来”就够了，还要知道怎么合并

上一篇我们把图跑起来了，也知道了节点返回什么、边怎么连。

但只要图稍微复杂一点，一个问题马上就会冒出来：

同一个状态字段，被不同节点更新时，到底该怎么处理？

最简单的情况，是一个节点接着一个节点顺序执行。

比如第一个节点写入 `draft`，第二个节点再改 `draft`。这种时候，后面的值覆盖前面的值，通常没什么问题。

真正麻烦的是下面两种场景：

- 你不是想覆盖，而是想追加

比如消息历史、搜索结果列表、日志列表

- 有多个节点都在写同一个字段

比如并行收集资料，最后都把结果写到 `results`

如果没有一套明确的合并规则，状态就会变得很不稳定。

有些值会被覆盖，有些值会丢，有些值又应该累加却没累加。

这一篇要讲的就是这件事：**Reducer 本质上是字段级的合并策略。**

## 2. 先看默认行为：大多数普通字段是覆盖

先从最容易看清的问题开始。

replace-default.ts

```typescript
import { StateGraph, StateSchema, START, END } from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const State = new StateSchema({
  draft: z.string().default(''),
  retryCount: z.number().default(0),
})

const writeDraft: GraphNode<typeof State> = () => {
  return {
    draft: '第一版草稿',
  }
}

const rewriteDraft: GraphNode<typeof State> = () => {
  return {
    draft: '第二版草稿',
    retryCount: 1,
  }
}

const graph = new StateGraph(State)
  .addNode('writeDraft', writeDraft)
  .addNode('rewriteDraft', rewriteDraft)
  .addEdge(START, 'writeDraft')
  .addEdge('writeDraft', 'rewriteDraft')
  .addEdge('rewriteDraft', END)
  .compile()

const result = await graph.invoke({
  draft: '',
  retryCount: 0,
})

console.log(result)
// {
//   draft: '第二版草稿',
//   retryCount: 1
// }
```

这里的 `draft` 很好理解。

第一个节点写了“第一版草稿”，第二个节点又写了“第二版草稿”，最后保留下来的是后者。

这不是 bug。

对很多普通字段来说，覆盖本来就是合理的默认行为。

所以这一篇最重要的第一句话，不是“所有字段都要 reducer”，而是：

**只有当默认覆盖不符合你的业务语义时，才需要额外声明合并策略。**

## 3. Reducer 到底是什么

Reducer 可以先不想得太大。

在 LangGraph 里，它不是“整棵状态树的总 reducer”，而是：

**某一个字段在收到新值时，应该怎么把旧值和新值合在一起。**

可以先把它理解成这样一个函数：

reducer-shape.ts

```typescript
type Reducer<T> = (current: T, update: T) => T
```

它只关心两件事：

- 这个字段当前是什么

- 这个字段这一步新来了什么

然后返回合并后的新值。

最简单的例子就是数组追加：

append-reducer.ts

```typescript
const appendReducer = (current: string[], update: string[]) => {
  return [...current, ...update]
}
```

如果原来是：

code.ts

```typescript
['A']
```

这一步新来的更新是：

code.ts

```typescript
['B', 'C']
```

那 reducer 跑完以后，字段的新值就是：

code.ts

```typescript
['A', 'B', 'C']
```

这就是 reducer 最核心的意思。

它只决定**这个字段怎么合并**，不负责别的字段。

放到 LangGraph 里看，最常见的就是这三种字段声明方式：

- 直接写 schema：按默认覆盖

- `ReducedValue`：自己声明这个字段怎么合并

- `MessagesValue`：直接使用消息字段已经内置好的合并方式

## 4. 哪些字段最常需要 reducer

实际项目里，最常见的通常是这三类：

- 消息列表

- 普通数组

- 数字计数器

它们都不适合简单覆盖。

### 4.1 普通数组：把结果接到后面

先看最容易理解的普通数组。

array-merge.ts

```typescript
import { StateGraph, StateSchema, ReducedValue, START } from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const appendResults = (current: string[], update: string[]) => {
  return [...current, ...update]
}

const State = new StateSchema({
  // ReducedValue 用来给这个字段显式声明 reducer。
  // 这里的字段语义是“追加到已有结果后面”。
  results: new ReducedValue(
    z.array(z.string()).default([]),
    { reducer: appendResults },
  ),
})

const searchDocs: GraphNode<typeof State> = () => {
  return {
    results: ['官方文档'],
  }
}

const searchCommunity: GraphNode<typeof State> = () => {
  return {
    results: ['社区文章'],
  }
}

const graph = new StateGraph(State)
  .addNode('searchDocs', searchDocs)
  .addNode('searchCommunity', searchCommunity)
  // 两个节点都从 START 出发，表示它们会在同一步里各自产生一份更新。
  .addEdge(START, 'searchDocs')
  .addEdge(START, 'searchCommunity')
  .compile()

const result = await graph.invoke({ results: [] })
console.log(result.results)
// ['官方文档', '社区文章']
```

这一段最重要的不是记住 API 细节，而是看懂语义：

- 如果不用 reducer，两个节点都写 `results`，后写入的会覆盖先写入的

- 加上 reducer 后，这个字段的语义变成了“把新结果追加到后面”

### 4.2 数字计数器：不是覆盖，而是累加

计数器也很常见。

比如：

- 走了多少步

- 调了多少次工具

- 用了多少 token

这种字段如果直接覆盖，往往就没意义了。

counter-merge.ts

```typescript
import { StateGraph, StateSchema, ReducedValue, START } from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const addNumber = (current: number, update: number) => {
  return current + update
}

const State = new StateSchema({
  // 计数器字段的语义不是覆盖，而是累加。
  stepCount: new ReducedValue(
    z.number().default(0),
    { reducer: addNumber },
  ),
})

const stepA: GraphNode<typeof State> = () => {
  return { stepCount: 1 }
}

const stepB: GraphNode<typeof State> = () => {
  return { stepCount: 1 }
}

const graph = new StateGraph(State)
  .addNode('stepA', stepA)
  .addNode('stepB', stepB)
  // 这里同样是两路并行写入 stepCount，所以 reducer 才有意义。
  .addEdge(START, 'stepA')
  .addEdge(START, 'stepB')
  .compile()

const result = await graph.invoke({ stepCount: 0 })
console.log(result.stepCount)
// 2
```

这里如果没有 reducer，最后你拿到的往往只是 `1`。

但这个字段真正想表达的是“总共发生了两次更新”，所以应该累加。

### 4.3 消息字段：按对话语义合并

消息字段是最特殊的一类。

因为对话图里最常见的状态，不是一个普通字符串，而是一串消息。

这时候你真正想要的，不是：

- 新消息把旧消息覆盖掉

而是：

- 用户消息、模型消息、工具消息都按顺序累积起来

在后面的篇章里，我们统一把消息字段写成 `MessagesValue`：

messages-value.ts

```typescript
import { StateGraph, StateSchema, MessagesValue, START, END } from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'

const State = new StateSchema({
  messages: MessagesValue,
})

const callModel: GraphNode<typeof State> = async () => {
  return {
    messages: [
      { role: 'assistant', content: '你好，有什么想聊的？' },
    ],
  }
}

const graph = new StateGraph(State)
  .addNode('callModel', callModel)
  .addEdge(START, 'callModel')
  .addEdge('callModel', END)
  .compile()

const result = await graph.invoke({
  messages: [{ role: 'user', content: '你好' }],
})

console.log(result.messages.length)
// 2
```

这里你可以把 `MessagesValue` 理解成：

- 这个字段不是普通数组

- 它代表“消息列表”这种特殊状态

- LangGraph 会按消息语义去处理它的合并

如果把 `ReducedValue` 看成“我自己给字段声明 reducer”，那 `MessagesValue` 就可以理解成 LangGraph 已经帮你预先配好的一种特殊字段。

所以这篇里最值得记住的是这句话：

**Reducer 的问题，本质上就是“这个字段的业务语义是什么”。**

消息字段的业务语义不是覆盖，而是形成对话历史。

普通数组的业务语义可能是追加。

计数器的业务语义可能是累加。

## 5. 自定义 reducer 时，先想清楚字段语义

当内置语义不够用时，再写自定义 reducer。

最常见的两个方向，是去重和对象合并。

### 5.1 去重合并

比如标签列表，不希望重复：

unique-tags.ts

```typescript
import { StateGraph, StateSchema, ReducedValue, START } from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const mergeUniqueTags = (current: string[], update: string[]) => {
  return Array.from(new Set([...current, ...update]))
}

const State = new StateSchema({
  tags: new ReducedValue(
    z.array(z.string()).default([]),
    { reducer: mergeUniqueTags },
  ),
})

const fromText: GraphNode<typeof State> = () => {
  return { tags: ['AI', '机器学习'] }
}

const fromMeta: GraphNode<typeof State> = () => {
  return { tags: ['Python', 'AI'] }
}

const graph = new StateGraph(State)
  .addNode('fromText', fromText)
  .addNode('fromMeta', fromMeta)
  .addEdge(START, 'fromText')
  .addEdge(START, 'fromMeta')
  .compile()

const result = await graph.invoke({ tags: [] })
console.log(result.tags)
// ['AI', '机器学习', 'Python']
```

### 5.2 对象合并

比如配置对象，想保留已有字段，只覆盖这次更新的部分：

merge-object.ts

```typescript
import { StateGraph, StateSchema, ReducedValue, START } from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const mergeObject = (
  current: Record<string, unknown>,
  update: Record<string, unknown>,
) => {
  return { ...current, ...update }
}

const State = new StateSchema({
  config: new ReducedValue(
    z.record(z.string(), z.unknown()).default({}),
    { reducer: mergeObject },
  ),
})

const loadDefaults: GraphNode<typeof State> = () => {
  return {
    config: {
      model: 'gpt-4.1-mini',
      temperature: 0.7,
    },
  }
}

const applyOverride: GraphNode<typeof State> = () => {
  return {
    config: {
      temperature: 0.9,
    },
  }
}

const graph = new StateGraph(State)
  .addNode('loadDefaults', loadDefaults)
  .addNode('applyOverride', applyOverride)
  .addEdge(START, 'loadDefaults')
  .addEdge('loadDefaults', 'applyOverride')
  .compile()

const result = await graph.invoke({ config: {} })
console.log(result.config)
// { model: 'gpt-4.1-mini', temperature: 0.9 }
```

这里更重要的不是“会不会写对象合并”，而是先问自己：

这个字段到底应该：

- 覆盖

- 追加

- 累加

- 去重

- 局部合并

只有这个问题先想清楚，reducer 才不会写偏。

## 6. 一张图里，不同字段可以有不同策略

真实项目里的状态，通常不是只有一个字段。

而且不同字段往往需要不同的合并方式。

mixed-state.ts

```typescript
import { StateSchema, MessagesValue, ReducedValue } from '@langchain/langgraph'
import { z } from 'zod'

const addNumber = (current: number, update: number) => current + update
const appendStrings = (current: string[], update: string[]) => [...current, ...update]

const State = new StateSchema({
  messages: MessagesValue,
  totalTokens: new ReducedValue(
    z.number().default(0),
    { reducer: addNumber },
  ),
  intermediateResults: new ReducedValue(
    z.array(z.string()).default([]),
    { reducer: appendStrings },
  ),
  finalAnswer: z.string().default(''),
})
```

这个状态里其实有四种完全不同的语义：

- `messages`：消息历史

- `totalTokens`：累加计数

- `intermediateResults`：列表追加

- `finalAnswer`：最终结果覆盖

这也是 reducer 真正有价值的地方。

它让状态不再只是“长得像对象”，而是每个字段都能表达自己的更新规则。

## 7. 收一下这一篇

这一篇真正要解决的，其实只有一个问题：

当多个节点都在改同一个字段时，这个字段到底该怎么合并。

如果字段只是普通字符串、普通数字，直接覆盖通常就够了。

如果字段代表的是消息历史、搜索结果、步骤计数这类会不断累积的数据，就要把更新规则提前写清楚。

放到代码里，就是三种最常见的状态字段：

- 普通 schema：保持默认覆盖

- `ReducedValue`：自己声明这个字段的合并方式

- `MessagesValue`：直接使用消息列表已经配好的合并逻辑

后面再看到消息自动追加、计数器累加、结果列表逐步变长时，就不会觉得它们是额外的技巧了。

它们只是不同字段在按自己的语义更新。

下一篇讲 **条件边**。到那时，状态不只是“怎么更新”，还会开始参与“下一步往哪里走”。
