---
title: "61 运行时上下文"
pubDate: 2026-05-01
description: "前面这一章一路写下来，状态、子图、多 Agent、Store、容错都已经接起来了。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/18-runtime-context/](https://aicompanion.usehook.cn/18-runtime-context/)

## 1. 写到后面，总会碰到一些不该放进状态里的东西

前面这一章一路写下来，状态、子图、多 Agent、Store、容错都已经接起来了。

但只要真的开始写复杂图，很快就会碰到一类特别别扭的信息。

比如：

当前用户是谁，这次请求来自哪个团队，当前节点要不要读 `Store`，某个节点里要不要拿运行时传进来的依赖。

这些信息你当然可以硬塞进图状态里。可一旦这么做，状态就会越来越胖，而且会开始混进很多并不属于「流程数据」的东西。

这时候最值得先想清楚的问题就变成了：

什么东西应该进 `State`，什么东西更适合放在运行时上下文里。

这一篇就专门讲这件事。

## 2. 先把状态和上下文分开

最容易混的，就是把 `state` 和 `context` 当成同一个抽屉。

其实它们的角色不一样。

`state` 说的是这条图在运行过程中会被节点读写、会随着流程往下流动、也可能被 checkpoint 记住的东西。

`context` 更像这次运行时附带进来的背景信息。它可以被节点读取，但通常不是让节点一路改来改去的。

放到具体场景里就更容易看：

`messages`、`status`、`draft`、`reviewLogs` 这类东西，明显属于 `state`；`userId`、`teamId`、`requestSource`、`locale` 这类东西，则更像 `context`。

只要这条线一清楚，后面很多代码就会顺很多。你不会再一股脑把所有东西都塞进状态里，也不会在节点里到处硬编码用户信息。

## 3. 节点的第二个参数，就是运行时上下文入口

前面几篇里，其实已经零散用到过这一层了。比如 `Store` 那篇里，我们会在节点里写：

runtime-shape.ts

```typescript
const readPreference: GraphNode<typeof State> = async (state, runtime) => {
  const userId = runtime.context?.userId
  const item = await runtime.store?.get(['users', userId, 'profile'], 'preferences')

  return {
    notes: [item?.value?.tone ?? 'warm'],
  }
}
```

这里的第二个参数 `runtime`，就是节点拿运行时能力的入口。

它不是图状态的一部分，而是执行这一次节点时，LangGraph 带进来的运行时对象。你会在这里拿到：

- `runtime.context`

- `runtime.store`

有时候，图里真正应该依赖的不是状态字段，而是这些运行时信息。

也正因为这样，`runtime` 不是在图外随便都能拿到的对象，它只会在节点真正执行时作为第二个参数传进来。

## 4. contextSchema 是把上下文边界写清楚

只是在节点里随手写 `runtime.context?.userId` 还不够。更稳的做法，是在图编译时把上下文长什么样先声明清楚。

context-schema.ts

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

const State = new StateSchema({
  messages: MessagesValue,
  notes: z.array(z.string()).default([]),
})

const ContextSchema = z.object({
  userId: z.string(),
  teamId: z.string().optional(),
  locale: z.string().default('zh-CN'),
})

const respond: GraphNode<typeof State> = async (state, runtime) => {
  const userId = runtime.context.userId
  const locale = runtime.context.locale

  return {
    notes: [`当前请求来自用户 ${userId}，语言环境是 ${locale}`],
  }
}

const graph = new StateGraph(State)
  .addNode('respond', respond)
  .addEdge(START, 'respond')
  .addEdge('respond', END)
  .compile({
    contextSchema: ContextSchema,
  })
```

这一步最大的意义，不只是类型更全，而是图本身对外界依赖的运行时信息开始变清楚了。

后面谁来调用这张图、必须传什么、哪些是可选的，看 `contextSchema` 就能知道。

## 5. 调用图的时候，再把 context 带进来

图声明完上下文结构以后，真正运行时就要把这些信息传进去。

invoke-with-context.ts

```typescript
const result = await graph.invoke(
  {
    messages: [{ role: 'user', content: '帮我记一下以后回复我尽量简短。' }],
  },
  {
    // 这里传进去的是这次运行附带的背景信息，
    // 它不会像 state 那样在图里一路被节点修改
    context: {
      userId: 'user_001',
      teamId: 'team_alpha',
      locale: 'zh-CN',
    },
  },
)
```

这一步可以把它理解成：图的状态是这轮流程要处理的数据，`context` 是这次运行附带进来的背景。

两者都跟当前调用有关，但职责不同。

## 6. 为什么 userId 更适合放在 context 里

这一点在前面的 `Store` 场景里最典型。

假设你把 `userId` 塞进状态里，会发生几件事：

- 它会跟着状态一起在节点之间流动

- 它可能被 checkpoint 记住

- 你的很多节点都会开始把它当流程字段处理

可问题是，`userId` 并不是这条业务流程自己产生出来的结果，它只是这次运行的外部背景。

更自然的做法，是把它放进 `context`，节点要用的时候去读，图本身不把它当核心状态的一部分。

read-store-by-context.ts

```typescript
import { InMemoryStore } from '@langchain/langgraph'

const store = new InMemoryStore()

await store.put(['users', 'user_001', 'profile'], 'preferences', {
  tone: 'short',
  language: 'zh-CN',
})

const readUserPreference: GraphNode<typeof State> = async (state, runtime) => {
  const namespace = ['users', runtime.context.userId, 'profile']
  const item = await runtime.store?.get(namespace, 'preferences')

  return {
    notes: [
      `当前用户偏好语气：${item?.value?.tone ?? 'warm'}`,
    ],
  }
}

const graph = new StateGraph(State)
  .addNode('readUserPreference', readUserPreference)
  .addEdge(START, 'readUserPreference')
  .addEdge('readUserPreference', END)
  .compile({
    store,
    contextSchema: ContextSchema,
  })
```

这里如果没有 `runtime.context.userId`，图根本不知道该去哪一段 namespace 找资料。

所以这类信息最适合放在运行时上下文里，而不是塞进流程状态。

## 7. Store 也是运行时能力的一部分

前面那篇已经单独讲过 `Store`，这里再把它放回运行时上下文里看一遍，会更容易理解。

`store` 不是状态字段，也不是节点自己创建出来的。它更像图运行时额外附带进来的一个长期记忆能力。

compile-with-store.ts

```typescript
const graph = new StateGraph(State)
  .addNode('readUserPreference', readUserPreference)
  .addEdge(START, 'readUserPreference')
  .addEdge('readUserPreference', END)
  .compile({
    // 只有在编译时把 store 传进去，
    // 节点里才会真的拿到 runtime.store
    store,
    contextSchema: ContextSchema,
  })
```

这段代码里有两件事同时发生了：

`contextSchema` 说明这张图运行时需要哪些背景信息，`store` 则说明这张图运行时还能拿到一套长期记忆能力。

也就是说，运行时上下文不只是 `context` 这一个对象，`runtime` 其实承载的是整张图运行时能拿到的外部能力。

## 8. 什么时候不该放进 context

讲到这里，很容易反过来把很多东西都塞进 `context`。

这也不对。

如果某个值会随着图的推进不断被修改、会影响后续节点、也应该随着 checkpoint 一起记住，那它就更像状态，而不是运行时上下文。

比如：

- 当前草稿内容

- 当前审批状态

- 当前已经调用过哪些工具

- 当前这轮的失败信息

这些都应该留在 `state` 里。

所以一个很实用的判断标准是：

如果这个值更像这条流程自己跑出来的数据，就放进 `state`。

如果它更像这次运行附带进来的背景条件，就优先放进 `context`。

## 9. 放回完整系统里，它的位置就很清楚了

把这一篇和前面的几篇放回一起看，会发现这层其实正好卡在中间。

状态负责流动的数据，`checkpointer` 负责把线程继续接上，`Store` 负责跨线程长期记忆，而 `runtime context` 则负责把这次运行的背景条件交给图。

这样一来，前面几篇里出现过的很多东西就都各回各位了：

`messages`、`status`、`draft` 这些在 `state`，`thread_id` 在配置里控制线程延续，`userId`、`teamId`、`locale` 在 `context`，长期偏好资料通过 `runtime.store` 读写。

图一旦按这种边界来写，结构会比把所有东西全塞进状态里清楚很多。

## 10. 总结

这一篇看起来讲的是一个小问题，实际上它把很多容易写乱的边界重新摆正了。

前面几篇已经把状态、Store、多 Agent 和实战管线都铺开了，但如果不把运行时上下文单独拎出来，读者很容易把 `userId`、长期记忆入口、线程配置这些东西全混进状态里。写小图时还感觉不到，一到复杂系统里就会越来越乱。

所以补上这一篇以后，LangGraph 这一章关于「图在运行时到底靠什么工作」这件事，也就更完整了。
