---
title: "57 层级团队与并行协作"
pubDate: 2026-04-30
description: "如果只靠一个 Agent 去做，它要自己搜资料、看资料、归纳结论、列风险、整理输出。能做，但会很累。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/14-hierarchical-parallel/](https://aicompanion.usehook.cn/14-hierarchical-parallel/)

## 1. 角色再多一点，问题就不只是交接了

上一篇我们已经把 `handoff` 和 `swarm` 接起来了。

到了那一步，系统里的角色已经不止一个，总控也不一定永远站在最上面。

但角色一旦继续变多，又会出现另一类问题。

比如你要做一个研究型助理，用户丢过来一句话：

「帮我整理一份关于 AI 浏览器的调研，给我结论、竞品情况和风险判断。」

如果只靠一个 Agent 去做，它要自己搜资料、看资料、归纳结论、列风险、整理输出。能做，但会很累。

如果拆成多个角色以后，情况会好一点。可以让一个角色查资料，一个角色整理竞品，一个角色梳理风险。

可新的问题又来了：

这些角色谁来分工，哪些任务可以同时做，做完以后又该由谁来收口。

这时候光靠 `handoff` 已经不太够了，因为这不再是「A 把对话交给 B」这么简单，而是「上层角色怎么指挥一组下层角色，并且允许其中一部分并行工作」。

这就是这一篇要处理的事。

## 2. 先把这两件事分开看

这一篇的题目里其实有两层意思。

一层是「层级团队」。这说的是角色之间有上下级关系。最上面有一个负责人，中间可能还有一层子负责人，下面才是具体执行角色。

另一层是「并行协作」。这说的是任务不是只能一条线往下走。有些工作天然可以同时做，等它们都回来以后，再统一汇总。

放到一起看，就会很像一个小团队：

上层角色负责拆任务，下层角色各自处理自己那一块，能同时做的部分就并行推进，最后再把结果汇回上层收口。

和上一篇最大的区别在于，上一篇更像接力，这一篇更像协作。

## 3. 先看最小的层级团队

先别一上来把图写复杂，先看最小结构。

这里用三个角色来讲：

- `leadAgent` 负责拆任务和收口

- `researchAgent` 负责查资料

- `riskAgent` 负责梳理风险

如果用户要的是一份完整调研，`leadAgent` 不会自己把所有事情都做完，而是先让下面两个角色各做一块，最后再把两边结果整理起来。

hierarchical-state.ts

```typescript
import { StateSchema, ReducedValue } from '@langchain/langgraph'
import { z } from 'zod'

const appendResults = (
  current: Array<{ role: string; content: string }>,
  update: Array<{ role: string; content: string }>,
) => {
  return [...current, ...update]
}

const State = new StateSchema({
  topic: z.string().default(''),
  plan: z.string().default(''),
  results: new ReducedValue(
    z.array(
      z.object({
        role: z.string(),
        content: z.string(),
      }),
    ).default([]),
    { reducer: appendResults },
  ),
  finalAnswer: z.string().default(''),
})
```

这一篇里最重要的字段是 `results`。

因为一旦开始多人协作，最后总得有个地方把不同角色的结果接回来。

## 4. 让上层角色先拆任务

先把最上面这一层写出来。这里故意不让 `leadAgent` 自己查资料，而是只做两件事：拆任务，收结果。

lead-agent.ts

```typescript
import type { GraphNode } from '@langchain/langgraph'

const leadAgent: GraphNode<typeof State> = (state) => {
  return {
    plan: `围绕「${state.topic}」拆成两部分：先收集行业资料，再单独梳理风险。`,
  }
}
```

这一层越克制越好。

如果负责人一边拆任务，一边自己也下场把细节全做了，后面所谓的层级团队就很容易又退回成「一个 Agent 忙所有事」。

## 5. 并行不是一句话，要真的让节点同时跑

下面开始接两个执行角色。

这一步最容易说得很轻飘，仿佛“并行”只是一个概念。可在图里，并行不是一句话，而是你真的要把一条状态流分成两条边，让两个节点都在下一步里工作。

parallel-workers.ts

```typescript
import {
  StateGraph,
  StateSchema,
  ReducedValue,
  START,
  END,
} from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const appendResults = (
  current: Array<{ role: string; content: string }>,
  update: Array<{ role: string; content: string }>,
) => {
  return [...current, ...update]
}

const State = new StateSchema({
  topic: z.string().default(''),
  plan: z.string().default(''),
  results: new ReducedValue(
    z.array(
      z.object({
        role: z.string(),
        content: z.string(),
      }),
    ).default([]),
    { reducer: appendResults },
  ),
  finalAnswer: z.string().default(''),
})

const leadAgent: GraphNode<typeof State> = (state) => {
  return {
    plan: `围绕「${state.topic}」拆成两部分：行业信息和风险判断并行推进。`,
  }
}

const researchAgent: GraphNode<typeof State> = (state) => {
  return {
    results: [{
      role: 'research',
      content: `研究员反馈：${state.topic} 目前的核心竞品主要集中在浏览器入口和 Agent 能力整合。`,
    }],
  }
}

const riskAgent: GraphNode<typeof State> = (state) => {
  return {
    results: [{
      role: 'risk',
      content: `风险分析：${state.topic} 可能面临隐私合规、模型成本和浏览器兼容性问题。`,
    }],
  }
}

const summarize: GraphNode<typeof State> = (state) => {
  // 这里拿到的 state.results，已经是前面两个并行节点都写回后的合并结果
  return {
    finalAnswer: state.results.map(item => item.content).join('\n'),
  }
}

const graph = new StateGraph(State)
  .addNode('leadAgent', leadAgent)
  .addNode('researchAgent', researchAgent)
  .addNode('riskAgent', riskAgent)
  .addNode('summarize', summarize)
  .addEdge(START, 'leadAgent')
  // 从同一个节点分出两条边，下一步里两个执行角色会一起工作
  .addEdge('leadAgent', 'researchAgent')
  .addEdge('leadAgent', 'riskAgent')
  .addEdge('researchAgent', 'summarize')
  .addEdge('riskAgent', 'summarize')
  .addEdge('summarize', END)
  .compile()
```

这里最关键的不是 `researchAgent` 和 `riskAgent` 本身，而是：

parallel-edges.ts

```typescript
.addEdge('leadAgent', 'researchAgent')
.addEdge('leadAgent', 'riskAgent')
```

这两条边一起出现，图在后续 super-step 里就会把这两个节点都推进起来。也正因为这样，`results` 不能用普通字段，而要用 `ReducedValue` 把两边的结果接到一起。

这里还有一个容易忽略的点：`summarize` 不会在 `researchAgent` 刚返回时就提前开始工作。它会等这一步里需要汇合的结果都准备好，再拿着已经合并过的 `results` 往下走。

## 6. 如果没有 reducer，并行结果会互相覆盖

这一点很重要，因为它决定了「并行协作」到底是真的协作，还是看起来在并行，最后只剩下一份结果。

假设这里的 `results` 只是一个普通数组字段，没有 reducer。那么 `researchAgent` 和 `riskAgent` 同时写回状态时，后返回的那份结果很可能会把前一份盖掉。

这一篇里之所以一直把 `results` 写成追加数组，就是因为并行节点最常见的需求，就是把多份结果收回来，而不是只保留最后一份。

所以把「层级团队」和「并行协作」放在一起看时，会很容易发现：前者决定谁分工，后者决定结果怎么汇合。

## 7. 再往前走一步：上层也可以继续分层

如果任务再复杂一点，最上面那层负责人自己也可能不会直接面对所有执行角色。

比如一份更大的调研，不只是查资料和梳理风险，还包括用户反馈、产品策略、技术可行性。这个时候，最上面可能只有一个总负责人，下面先拆成两个小负责人：

- 一个管市场和竞品

- 一个管风险和技术

再往下，才是具体执行角色。

这时候图的感觉就会很像一个层级团队：

总负责人先拆大块，子负责人各自再拆小块，小块里能并行的继续并行，最后层层往上汇总。

你不一定非要一开始就把图写成三层，但一旦开始遇到「一个负责人也开始忙不过来」的情况，这种层级拆分就会很自然。

## 8. 写这种模式时最容易出的问题

最常见的问题，是把并行写成了串行。嘴上说「研究和风险一起做」，代码里却还是一条边接一条边地往下串，那最后只是多了两个角色，并没有真的并行起来。

第二个问题，是汇总节点写得太早。两个执行节点还没把结果都交回来，汇总节点就已经开始生成最终答案，这样出来的结果往往会缺一块。

还有一种情况，是上层角色什么都想管。明明已经拆了研究员、风险分析员、子负责人，结果最上面的负责人还是把每一层细节都握在自己手里。这样图虽然层级变多了，实际决策压力还是没被拆开。

## 9. 总结

到了这里，多 Agent 这条线又往前走了一步。

前面的 `Supervisor` 解决的是总控怎么派活，`handoff` 和 `swarm` 解决的是控制权怎么流动，这一篇开始处理团队协作：上层怎么分工，哪些任务可以并行，结果又该怎么汇回来。

下一篇讲 **Store：跨会话的长期记忆**。到那时，问题会从「多个角色怎么一起做事」转到「这些角色跨会话以后，还能不能记住之前留下来的东西」。
