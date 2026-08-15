---
title: "54 子图"
pubDate: 2026-04-29
description: "前面几篇把状态、条件边、Command、interrupt 都接起来以后，已经能写出一条能跑的业务图了。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/11-subgraph/](https://aicompanion.usehook.cn/11-subgraph/)

## 1. 一张图写到后面，总会开始变长

前面几篇把状态、条件边、`Command`、`interrupt()` 都接起来以后，已经能写出一条能跑的业务图了。

但图一旦开始真的解决业务问题，很快就会遇到另一种麻烦：不是功能不够，而是整张图越来越长。

比如一条内容发布流程，前面要生成草稿，中间要做几轮审核，后面还要格式整理、发布、通知。刚开始看起来只有四五个节点，过几天再回来看，已经变成十几个节点串在一起。再往后加一个「品牌审核」或者「敏感词检查」，整张图就更难读了。

这时候问题已经不是「能不能写出来」，而是「还能不能看懂，还敢不敢复用」。

子图就是拿来处理这件事的。它做的不是引入新的控制流，而是把一段已经写清楚的流程，单独拆出来，当成别的图里可以反复使用的一块模块。

## 2. 子图到底是什么

可以把子图先理解成一句很简单的话：**图里的一个节点，背后其实跑的是另一张图。**

父图只关心这块模块的入口和出口，不去管它中间到底拆成了几步。你可以把「审核流程」拆成一张子图，也可以把「检索流程」「格式整理流程」拆成子图。对父图来说，它们都只是一个可以接入的节点。

把复杂流程拆成子图以后，最大的变化不是代码变短了，而是边界更清楚了。父图负责大的阶段顺序，子图负责自己这段内部流程。后面要改审核规则，只动审核子图就够了，不需要回头改整张发布图。

## 3. 先看最直接的用法

最直接的情况，是父图和子图用的是同一份状态。这样最好接，因为父图把状态交给子图，子图跑完以后再把更新后的状态还回来，不需要额外做字段映射。

下面用一条很小的内容流程来讲。父图先生成草稿，然后把草稿交给 `reviewPipeline` 这张子图，子图内部依次检查语气和风险，确认没问题以后再交回父图继续发布。

subgraph-shared-state.ts

```typescript
import { StateGraph, StateSchema, START, END } from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const State = new StateSchema({
  topic: z.string().default(''),
  draft: z.string().default(''),
  tonePassed: z.boolean().default(false),
  riskPassed: z.boolean().default(false),
  published: z.boolean().default(false),
})

const generateDraft: GraphNode<typeof State> = (state) => {
  return {
    draft: `【${state.topic}】LangGraph 很适合需要状态管理和人工介入的工作流。`,
  }
}

const checkTone: GraphNode<typeof State> = (state) => {
  // 这一步只管检查语气，结果直接写回同一份状态
  return {
    tonePassed: state.draft.length > 0,
  }
}

const checkRisk: GraphNode<typeof State> = (state) => {
  // 子图里的下一步节点，可以直接读取前一步刚写入的字段
  return {
    riskPassed: state.tonePassed,
  }
}

const publish: GraphNode<typeof State> = () => {
  return {
    published: true,
  }
}

// 这张子图只负责审核，不负责生成和发布
const reviewSubgraph = new StateGraph(State)
  .addNode('checkTone', checkTone)
  .addNode('checkRisk', checkRisk)
  .addEdge(START, 'checkTone')
  .addEdge('checkTone', 'checkRisk')
  .addEdge('checkRisk', END)
  .compile()

const graph = new StateGraph(State)
  .addNode('generateDraft', generateDraft)
  // 父图和子图共用同一份 State，所以这里可以直接把编译后的子图当成一个节点接进来
  .addNode('reviewPipeline', reviewSubgraph)
  .addNode('publish', publish)
  .addEdge(START, 'generateDraft')
  .addEdge('generateDraft', 'reviewPipeline')
  .addEdge('reviewPipeline', 'publish')
  .addEdge('publish', END)
  .compile()

const result = await graph.invoke({ topic: 'LangGraph 子图入门' })

console.log(result.tonePassed)
// → true

console.log(result.riskPassed)
// → true

console.log(result.published)
// → true
```

这一段最关键的是：

add-subgraph-node.ts

```typescript
.addNode('reviewPipeline', reviewSubgraph)
```

父图这里没有再写一遍审核流程，而是直接把 `reviewSubgraph` 接成一个节点。对父图来说，它只知道自己把流程交给了 `reviewPipeline`，至于里面是先查语气还是先查风险，父图并不关心。

## 4. 子图和父图的状态不一样时怎么办

真实项目里，更常见的情况是父图和子图并不想共用整份状态。

比如父图关心的是 `topic`、`draft`、`published`，而审核子图内部还想单独维护 `issues`、`score`、`reviewSummary`。这些字段如果全塞回父图状态里，父图就会越来越臃肿。

这时候更合适的做法，是让子图维护自己的状态，然后在父图里写一个包装节点，负责把父图状态喂给子图，再把子图结果摘出来返回。

subgraph-wrapper.ts

```typescript
import { StateGraph, StateSchema, ReducedValue, START, END } from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const ParentState = new StateSchema({
  topic: z.string().default(''),
  draft: z.string().default(''),
  reviewIssues: new ReducedValue(
    z.array(z.string()).default([]),
    { reducer: (current, update) => [...current, ...update] },
  ),
  reviewPassed: z.boolean().default(false),
})

const ReviewState = new StateSchema({
  draft: z.string().default(''),
  issues: new ReducedValue(
    z.array(z.string()).default([]),
    { reducer: (current, update) => [...current, ...update] },
  ),
  passed: z.boolean().default(false),
})

const checkLength: GraphNode<typeof ReviewState> = (state) => {
  if (state.draft.length >= 20) {
    return { passed: true }
  }
  return {
    issues: ['草稿太短，还不适合进入发布流程'],
    passed: false,
  }
}

const reviewGraph = new StateGraph(ReviewState)
  .addNode('checkLength', checkLength)
  .addEdge(START, 'checkLength')
  .addEdge('checkLength', END)
  .compile()

const runReviewSubgraph: GraphNode<typeof ParentState> = async (state, config) => {
  // 先把父图里真正需要的字段传给子图
  // 这里把 config 一起往下传，是为了把同一次图运行里的配置继续带给子图
  const reviewResult = await reviewGraph.invoke(
    { draft: state.draft },
    config,
  )

  // 再把子图的结果整理回父图自己的字段
  return {
    reviewIssues: reviewResult.issues,
    reviewPassed: reviewResult.passed,
  }
}
```

这类包装节点很常见。它的价值不在于“多写了一层”，而在于父图和子图的状态边界被保住了。审核子图里以后再多加几个内部字段，不会把父图状态也一起带胖。

## 5. 什么时候值得拆成子图

不是每多两个节点就要拆子图。拆得太早，图会变成一堆小盒子，反而更难看。

通常到了这种时候，子图就比较值得了。

有时是因为这段流程本身已经有自己的完整入口和出口。像审核链、检索链、格式整理链，本来就像一块独立流程，拆出来以后会更自然。

有时是因为这段流程不止一处会用。今天是内容发布要走一次审核，明天是通知消息、活动文案也要走一次审核。这时候把审核链留在父图里重复写，就开始浪费了。

还有一种情况，是父图已经被内部细节淹没了。你明明只是想表达「生成 -> 审核 -> 发布」，结果中间审核那一段摊开以后占了整篇图的大半。遇到这种情况，子图通常比继续往下堆节点更合适。

## 6. 把它放回一条完整业务图里

下面把子图放回一条完整的内容发布流程里。父图负责大的阶段推进，审核那一段单独交给子图处理。

publish-with-subgraph.ts

```typescript
import { StateGraph, StateSchema, ReducedValue, START, END } from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const ReviewState = new StateSchema({
  draft: z.string().default(''),
  issues: new ReducedValue(
    z.array(z.string()).default([]),
    { reducer: (current, update) => [...current, ...update] },
  ),
  passed: z.boolean().default(false),
})

const checkTone: GraphNode<typeof ReviewState> = (state) => {
  if (state.draft.includes('极限夸张')) {
    return {
      issues: ['语气过重，需要收一收'],
      passed: false,
    }
  }
  return { passed: true }
}

const checkFormat: GraphNode<typeof ReviewState> = (state) => {
  if (state.draft.length < 20) {
    return {
      issues: ['正文太短，发布页信息不够'],
      passed: false,
    }
  }
  return { passed: state.passed }
}

const reviewPipeline = new StateGraph(ReviewState)
  .addNode('checkTone', checkTone)
  .addNode('checkFormat', checkFormat)
  .addEdge(START, 'checkTone')
  .addEdge('checkTone', 'checkFormat')
  .addEdge('checkFormat', END)
  .compile()

const PublishState = new StateSchema({
  topic: z.string().default(''),
  draft: z.string().default(''),
  reviewIssues: new ReducedValue(
    z.array(z.string()).default([]),
    { reducer: (current, update) => [...current, ...update] },
  ),
  reviewPassed: z.boolean().default(false),
  published: z.boolean().default(false),
})

const generateDraft: GraphNode<typeof PublishState> = (state) => {
  return {
    draft: `【${state.topic}】LangGraph 可以把复杂流程拆成清楚的状态图。`,
  }
}

const runReviewPipeline: GraphNode<typeof PublishState> = async (state, config) => {
  // 父图把草稿交给审核子图，子图内部怎么拆，父图不需要知道
  // config 继续往下传，子图就还能接住同一次运行里的上下文和配置
  const reviewResult = await reviewPipeline.invoke(
    { draft: state.draft },
    config,
  )

  return {
    reviewIssues: reviewResult.issues,
    reviewPassed: reviewResult.passed && reviewResult.issues.length === 0,
  }
}

const publish: GraphNode<typeof PublishState> = (state) => {
  if (!state.reviewPassed) {
    return {
      published: false,
      draft: `[暂未发布] ${state.draft}`,
    }
  }

  return {
    published: true,
    draft: `[已发布] ${state.draft}`,
  }
}

const graph = new StateGraph(PublishState)
  .addNode('generateDraft', generateDraft)
  .addNode('runReviewPipeline', runReviewPipeline)
  .addNode('publish', publish)
  .addEdge(START, 'generateDraft')
  .addEdge('generateDraft', 'runReviewPipeline')
  .addEdge('runReviewPipeline', 'publish')
  .addEdge('publish', END)
  .compile()

const result = await graph.invoke({
  topic: '子图如何复用审核流程',
})

console.log(result.reviewIssues)
// → []

console.log(result.published)
// → true
```

这段代码里，父图真正关心的只有三件事：先生成草稿，把草稿送进审核子图，最后根据审核结果决定发布状态。审核过程内部的细节已经被折叠起来了，所以父图读起来会轻很多。

## 7. 子图不是为了炫技

子图看上去像一种更高级的写法，但它真正解决的还是最朴素的问题：一张图太长了，或者一段流程以后还要重复用。

如果你现在手上的图只有三四个节点，而且只会出现一次，那就先别拆。先把主流程写清楚，比什么都重要。

但如果你已经开始出现下面这种感觉：

「审核这段其实可以单独拿出来。」

「这段检索逻辑下一条图也要用。」

「我每次打开父图，都要先在里面翻半天才能找到真正的大阶段。」

那基本就说明，子图已经到了该上的时候。

## 8. 总结

子图做的事情并不复杂。它只是把一段已经成型的流程，包成一块可以复用的模块，再把它接回更大的父图。

写到这里，LangGraph 这一章的节奏也开始从「单张图怎么写」往「多块流程怎么组织」走了。前面几篇解决的是节点、状态、控制流和暂停恢复，这一篇开始处理模块化。再往后，问题就不只是模块复用，而是不同角色之间怎么协作了。

下一篇讲 **Supervisor 模式**。到那时，重点会从「一张图里拆出一块子图」继续往前走，变成「多个角色之间怎么分工」。
