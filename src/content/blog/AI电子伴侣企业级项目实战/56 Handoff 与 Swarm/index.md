---
title: "56 Handoff 与 Swarm"
pubDate: 2026-04-29
description: "用户只面对一个入口，总控 Agent 在后面找日程 Agent、邮件 Agent 这些专门角色来做事。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/13-handoff-swarm/](https://aicompanion.usehook.cn/13-handoff-swarm/)

## 1. 总控模式写顺以后，新的问题就来了

上一篇我们把 `Supervisor` 跑起来了。

用户只面对一个入口，总控 Agent 在后面找日程 Agent、邮件 Agent 这些专门角色来做事。

这种方式很稳，尤其适合「我希望所有事最后都回到一个总控来收口」的场景。

但业务再往前走一步，你会碰到另一类需求。用户并不总是想一直和总控对话。有些时候，他其实更希望直接进入某个角色的上下文里，把接下来的几轮话都交给这个角色处理。

比如用户先说：

「我想请你帮我做旅行规划。」

总控当然可以理解这句话，然后去问旅行 Agent，拿回结果再转述给用户。可一旦用户接着追问：

「预算控制在五千以内。」

「别安排太早的航班。」

「我比较想住在地铁附近。」

如果这几轮都还要先经过总控，再转给旅行 Agent，就会显得有点绕。这个时候，更自然的办法往往不是继续让总控代理一切，而是直接把当前对话交给旅行 Agent。

这就是 `handoff` 想解决的事。

## 2. Handoff 说白了，就是把控制权交出去

先把名字放轻一点看。`handoff` 不是一种神秘的新框架能力，它说的就是一件很直白的事：

当前这个角色不继续处理了，把后面的对话交给另一个角色。

和上一篇的 `Supervisor` 放在一起看，差别会很清楚：

- `Supervisor` 更像总控派活，结果还会收回来

- `Handoff` 更像把用户带进另一个角色的工作台，让那个角色继续往下聊

所以这两种模式不是谁替代谁，而是适合的场景不一样。

如果你要的是集中收口、统一对外回复，`Supervisor` 会更顺。

如果你要的是让用户直接进入某个领域角色的上下文里连续对话，`handoff` 会更自然。

## 3. 先看一个最简单的 handoff 场景

先用一个生活化的例子来讲。系统里有两个角色：

- `generalAgent` 负责接第一句话

- `travelAgent` 负责旅行规划

一开始用户先和 `generalAgent` 对话。只要问题还比较泛，它自己就能接住。但当它判断用户已经明确进入「旅行规划」这个领域以后，就不继续硬接，而是把对话交给 `travelAgent`。

handoff-scene.ts

```typescript
type AgentName = 'general' | 'travel'

type ChatState = {
  activeAgent: AgentName
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

const initialState: ChatState = {
  activeAgent: 'general',
  messages: [],
}
```

这里真正重要的字段是 `activeAgent`。

只要这个字段从 `general` 变成了 `travel`，后面的消息就不再交给总控，而是直接交给旅行角色。

这件事本身不复杂，关键在于你愿不愿意承认：有些对话本来就该换角色继续。

## 4. 用状态切换把 handoff 落下来

这一类模式最常见的做法，不是把所有角色都揉成一个大 Agent，而是明确在状态里保留「当前谁在接管」。

下面用一张很小的图，把这件事落成代码。

handoff-graph.ts

```typescript
import {
  StateGraph,
  StateSchema,
  ReducedValue,
  START,
  END,
  Command,
} from '@langchain/langgraph'
import type { GraphNode, ConditionalEdgeRouter } from '@langchain/langgraph'
import { z } from 'zod'

const appendMessages = (
  current: Array<{ role: 'user' | 'assistant'; content: string }>,
  update: Array<{ role: 'user' | 'assistant'; content: string }>,
) => {
  return [...current, ...update]
}

const State = new StateSchema({
  activeAgent: z.enum(['general', 'travel']).default('general'),
  messages: new ReducedValue(
    z.array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    ).default([]),
    { reducer: appendMessages },
  ),
})

const generalAgent: GraphNode<typeof State> = (state) => {
  const lastMessage = state.messages.at(-1)?.content ?? ''

  // 如果用户已经明确在聊旅行，这里就不继续硬接了
  if (lastMessage.includes('旅行') || lastMessage.includes('机票') || lastMessage.includes('酒店')) {
    return new Command({
      update: {
        activeAgent: 'travel',
        messages: [{
          role: 'assistant',
          content: '接下来由旅行助理继续帮你安排行程。',
        }],
      },
      goto: 'travelAgent',
    })
  }

  return {
    messages: [{
      role: 'assistant',
      content: '我先帮你判断一下需求方向，如果是旅行规划，我会把对话切给旅行助理。',
    }],
  }
}

const travelAgent: GraphNode<typeof State> = (state) => {
  const lastMessage = state.messages.at(-1)?.content ?? ''

  // 这里假设控制权已经切到了旅行角色，
  // 所以后面的回复会直接站在旅行助理的视角继续往下接
  return {
    messages: [{
      role: 'assistant',
      content: `旅行助理已接手，当前收到的新要求是：${lastMessage}`,
    }],
  }
}

const shouldContinue: ConditionalEdgeRouter<typeof State> = (state) => {
  if (state.activeAgent === 'travel') return 'travelAgent'
  return END
}

const graph = new StateGraph(State)
  .addNode('generalAgent', generalAgent, { ends: ['travelAgent'] })
  .addNode('travelAgent', travelAgent)
  .addEdge(START, 'generalAgent')
  .addConditionalEdges('generalAgent', shouldContinue, ['travelAgent'])
  .addEdge('travelAgent', END)
  .compile()
```

这一段最关键的不是字符串判断，而是那句：

handoff-core.ts

```typescript
activeAgent: 'travel'
```

`handoff` 的本质，就是把当前活跃角色切过去。这里我们用的是一个最容易看懂的版本：状态切换以后，后面的处理节点直接换成 `travelAgent`。

## 5. 连续对话时，handoff 的感觉会更明显

只跑一轮的时候，`handoff` 和 `Supervisor` 的差别还不算特别大。真正到了多轮对话里，这种差别就很明显了。

下面这段先演示最小版本，只保留当前接管角色，再继续往下走。这样最容易看清 `handoff` 的核心是「控制权已经切过去了」。

handoff-turns.ts

```typescript
let state = await graph.invoke({
  messages: [{ role: 'user', content: '我想做一个日本旅行规划。' }],
})

console.log(state.activeAgent)
// → travel

state = await graph.invoke({
  // 这里把当前活跃角色继续传回去，
  // 所以下一轮不会再回到 generalAgent 重新判断
  activeAgent: state.activeAgent,
  messages: [{ role: 'user', content: '预算尽量控制在五千以内。' }],
})

console.log(state.messages.at(-1)?.content)
// → 旅行助理已接手，当前收到的新要求是：预算尽量控制在五千以内。
```

到了第二轮，系统已经不需要再问「这是不是旅行问题」。因为 `activeAgent` 已经切成了 `travel`，后面就直接在旅行角色的上下文里继续走。

这也是 `handoff` 真正顺手的地方。它不是让每一轮都重新路由，而是让某个角色接手以后，能把后面的对话连续接下去。

不过这里要注意一件事：上面这段只是为了演示角色切换，所以第二轮只把 `activeAgent` 传了回去，没有把整段历史消息一起带上。如果你希望旅行角色继续看到完整对话，要么把历史消息一并传回去，要么接上前面讲过的 `checkpointer`。

## 6. 那 Swarm 又是什么

`Swarm` 可以先理解成比 `handoff` 再往前走一步。

如果说 `handoff` 还是在做「一个角色把控制权交给另一个角色」，那 `Swarm` 更像一组角色之间可以彼此转交，谁觉得下一步该找谁，就继续往下交。

它不一定总有一个固定总控站在最上面。控制权可能在多个角色之间流动。

比如还是旅行场景：

- 旅行顾问先接到需求

- 它发现预算是关键，于是把问题交给预算顾问

- 预算顾问确认预算可行以后，再把问题交回旅行顾问

- 旅行顾问再继续给出行程建议

这时候系统更像是一张角色网络，而不是一棵单向分发的树。

## 7. 什么时候适合 handoff，什么时候更像 swarm

可以把这两个模式放回使用感受里看。

如果你的系统里仍然有一个比较明确的起点角色，只是中途会把用户带进某个更专业的角色里继续聊，那通常还是 `handoff` 更贴切。

如果你的系统里，多个角色本来就可能互相接力，而且你不太想设一个永远站在最上面的总控，那它就会越来越像 `swarm`。

所以区别不在于「有没有多个 Agent」，而在于：

控制权是一次性交出去，还是可能在多个角色之间持续流动。

## 8. 写这一类模式时最容易出的问题

最常见的问题，是明明已经 handoff 了，结果历史上下文还是按总控那套思路在塞。这样角色虽然换了，实际看到的还是一锅混在一起的内容，接手的意义就会打折。

第二个问题，是没有把「当前谁在接管」这件事落成状态。写的时候好像知道现在是谁在说话，跑到第二轮、第三轮以后，系统自己却不知道了。结果就是一会儿回总控，一会儿又回专门角色，行为会很飘。

还有一个问题，是把 `swarm` 写成一堆互相乱跳的 handoff。角色越多，这种问题越明显。所以一旦开始走到 `swarm` 这种模式，角色边界、共享状态和路由条件就得比前面更清楚。

## 9. 总结

到了这里，多 Agent 这条线又往前走了一步。

上一篇的 `Supervisor`，重点是总控怎么派活。

这一篇的 `handoff` 和 `swarm`，重点开始变成控制权怎么在角色之间流动。

它们处理的其实不是同一个问题，所以也不应该放在一起比谁更高级。什么时候要统一收口，就用 `Supervisor`；什么时候希望用户直接进入某个角色的上下文里连续对话，`handoff` 会更自然；如果角色之间还会继续彼此接力，就开始接近 `swarm` 了。

下一篇讲 **层级团队与并行协作**。到那时，视角会再往前走一步，不只是角色怎么接力，而是多个角色怎么同时工作，再把结果汇回来。
