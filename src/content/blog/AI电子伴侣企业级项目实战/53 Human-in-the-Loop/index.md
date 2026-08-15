---
title: "53 Human-in-the-Loop"
pubDate: 2026-04-28
description: "上一篇我们已经把 interrupt 跑通了，知道图可以在节点里暂停，等外部输入后再继续。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/10-human-in-the-loop/](https://aicompanion.usehook.cn/10-human-in-the-loop/)

## 1. 真正的审批流程，不是停一次就结束

上一篇我们已经把 `interrupt()` 跑通了，知道图可以在节点里暂停，等外部输入后再继续。

但真实业务里的 Human-in-the-Loop，通常不只是「停一下，点个确认」这么简单。

更常见的是这样一条链：先生成一版内容，交给编辑审核；编辑通过以后，再交给法务审核；任意一关打回，都回到修改节点重新出一版；整个过程还得留痕，后面能查是谁在什么时候给了什么意见。

如果只会把 `interrupt()` 塞进一个节点里，你能做出「人工确认」。

但如果要做「审批工作流」，还得把这些暂停点和整张图的状态流转连起来。

这一篇就把这件事完整走一遍。

## 2. 先把审批链路拆出来

先把流程拆开看，会更容易写。

这一篇用一个两级审批的例子来讲：`generateDraft` 先生成文案，`editorReview` 负责编辑审核，`legalReview` 负责法务审核，全部通过以后才进入 `publish`，只要有一关打回，就先进入 `reviseDraft`，再重新生成。

这条链里真正重要的，不是节点有几个，而是职责要分开。生成节点只管产出草稿，审核节点只管暂停、接收人工决定、更新审批状态，修改节点只管把流程切回待修改，发布节点只负责把最后结果落成已发布。这样后面你要把「编辑」换成「运营」，或者再加一个「品牌审核」，整张图都不用重写。

## 3. 状态里要放什么

审批工作流和前面那些纯自动图不一样。状态里至少要放三类东西：当前草稿本身、当前走到哪一个审批阶段、还有审批记录。

前两个字段直接覆盖就够了，审批记录不行。因为每次审核都会往里追加一条记录，最后应该保留完整历史。

approval-state.ts

```typescript
import { StateSchema, ReducedValue } from '@langchain/langgraph'
import { z } from 'zod'

const appendLogs = (
  current: Array<{
    stage: string
    reviewer: string
    approved: boolean
    comment: string
  }>,
  update: Array<{
    stage: string
    reviewer: string
    approved: boolean
    comment: string
  }>,
) => {
  return [...current, ...update]
}

const State = new StateSchema({
  topic: z.string().default(''),
  draft: z.string().default(''),
  feedback: z.string().default(''),
  version: z.number().default(0),
  status: z.string().default('drafting'),
  reviewLogs: new ReducedValue(
    z.array(
      z.object({
        stage: z.string(),
        reviewer: z.string(),
        approved: z.boolean(),
        comment: z.string(),
      }),
    ).default([]),
    { reducer: appendLogs },
  ),
})
```

这一段里最值得注意的是 `reviewLogs`。

它不是普通数组，而是用 `ReducedValue` 明确声明成「追加日志」。这样编辑审核写一条、法务审核再写一条时，结果会自然接到后面。

## 4. 审核节点真正做的事

审批节点不是只负责弹一个确认框。它还得把当前草稿和阶段信息带给调用方，接收调用方传回来的审核结果，再根据审核结果决定下一步去哪。

也正因为这样，这类节点通常都会把 `interrupt()` 和 `Command` 放在一起用。

review-node.ts

```typescript
import type { GraphNode } from '@langchain/langgraph'
import { Command, interrupt } from '@langchain/langgraph'

const editorReview: GraphNode<typeof State> = (state) => {
  // 先暂停，把当前草稿和说明带出去
  // 这里传给 interrupt 的内容最好保持可序列化，外部系统才容易接住它
  const decision = interrupt({
    stage: 'editor',
    title: '请进行编辑审核',
    draft: state.draft,
    version: state.version,
  })

  // 恢复后，decision 就是外部传回来的审核结果
  if (decision.approved) {
    return new Command({
      update: {
        status: 'editor-approved',
        reviewLogs: [{
          stage: 'editor',
          reviewer: decision.reviewer,
          approved: true,
          comment: decision.comment ?? '',
        }],
      },
      goto: 'legalReview',
    })
  }

  return new Command({
    update: {
      status: 'editor-rejected',
      feedback: decision.comment ?? '请继续修改',
      reviewLogs: [{
        stage: 'editor',
        reviewer: decision.reviewer,
        approved: false,
        comment: decision.comment ?? '',
      }],
    },
    goto: 'reviseDraft',
  })
}
```

这里最核心的点是：

审核节点自己就知道下一步该去哪，所以不需要再额外挂一条条件边。通过就往下走，打回就回修改节点，这个决定直接留在节点内部就够了。

## 5. 把整条审批工作流接起来

下面把完整流程连起来。

approval-workflow.ts

```typescript
import {
  StateGraph,
  StateSchema,
  ReducedValue,
  Command,
  interrupt,
  MemorySaver,
  START,
  END,
} from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const appendLogs = (
  current: Array<{
    stage: string
    reviewer: string
    approved: boolean
    comment: string
  }>,
  update: Array<{
    stage: string
    reviewer: string
    approved: boolean
    comment: string
  }>,
) => {
  return [...current, ...update]
}

const State = new StateSchema({
  topic: z.string().default(''),
  draft: z.string().default(''),
  feedback: z.string().default(''),
  version: z.number().default(0),
  status: z.string().default('drafting'),
  reviewLogs: new ReducedValue(
    z.array(
      z.object({
        stage: z.string(),
        reviewer: z.string(),
        approved: z.boolean(),
        comment: z.string(),
      }),
    ).default([]),
    { reducer: appendLogs },
  ),
})

// 生成节点：第一次生成，或者根据 feedback 重新出一版
const generateDraft: GraphNode<typeof State> = (state) => {
  const nextVersion = state.version + 1

  if (!state.feedback) {
    return {
      draft: `【${state.topic}】LangGraph 让复杂 Agent 的流程控制、状态管理和持久化都回到代码里。`,
      feedback: '',
      version: nextVersion,
      status: 'waiting-editor-review',
    }
  }

  return {
    draft: `【${state.topic}】LangGraph 让复杂 Agent 的流程控制、状态管理和持久化都回到代码里。它适合那些需要分支、暂停、恢复和审批的工作流。（本版根据反馈修改：${state.feedback}）`,
    feedback: '',
    version: nextVersion,
    status: 'waiting-editor-review',
  }
}

// 修改节点：这里只做状态切换，真正的改稿还是回 generateDraft
const reviseDraft: GraphNode<typeof State> = () => {
  return {
    status: 'revising',
  }
}

// 编辑审核：通过后去法务，打回后去修改
const editorReview: GraphNode<typeof State> = (state) => {
  const decision = interrupt({
    stage: 'editor',
    title: '请进行编辑审核',
    draft: state.draft,
    version: state.version,
    instruction: '回复 { approved: true, reviewer, comment } 或 { approved: false, reviewer, comment }',
  })

  if (decision.approved) {
    return new Command({
      update: {
        status: 'waiting-legal-review',
        reviewLogs: [{
          stage: 'editor',
          reviewer: decision.reviewer,
          approved: true,
          comment: decision.comment ?? '',
        }],
      },
      goto: 'legalReview',
    })
  }

  return new Command({
    update: {
      status: 'editor-rejected',
      feedback: decision.comment ?? '请继续修改',
      reviewLogs: [{
        stage: 'editor',
        reviewer: decision.reviewer,
        approved: false,
        comment: decision.comment ?? '',
      }],
    },
    goto: 'reviseDraft',
  })
}

// 法务审核：通过后发布，打回后也回修改
const legalReview: GraphNode<typeof State> = (state) => {
  const decision = interrupt({
    stage: 'legal',
    title: '请进行法务审核',
    draft: state.draft,
    version: state.version,
    instruction: '回复 { approved: true, reviewer, comment } 或 { approved: false, reviewer, comment }',
  })

  if (decision.approved) {
    return new Command({
      update: {
        status: 'approved',
        reviewLogs: [{
          stage: 'legal',
          reviewer: decision.reviewer,
          approved: true,
          comment: decision.comment ?? '',
        }],
      },
      goto: 'publish',
    })
  }

  return new Command({
    update: {
      status: 'legal-rejected',
      feedback: decision.comment ?? '请继续修改',
      reviewLogs: [{
        stage: 'legal',
        reviewer: decision.reviewer,
        approved: false,
        comment: decision.comment ?? '',
      }],
    },
    goto: 'reviseDraft',
  })
}

const publish: GraphNode<typeof State> = (state) => {
  return {
    status: 'published',
    draft: `[已发布 V${state.version}] ${state.draft}`,
  }
}

const graph = new StateGraph(State)
  .addNode('generateDraft', generateDraft)
  .addNode('reviseDraft', reviseDraft)
  .addNode('editorReview', editorReview, { ends: ['legalReview', 'reviseDraft'] })
  .addNode('legalReview', legalReview, { ends: ['publish', 'reviseDraft'] })
  .addNode('publish', publish)
  .addEdge(START, 'generateDraft')
  .addEdge('generateDraft', 'editorReview')
  .addEdge('reviseDraft', 'generateDraft')
  .addEdge('publish', END)
  .compile({ checkpointer: new MemorySaver() })
```

这张图里最值得看的，是两个审核节点和那条回退边。

`editorReview` 和 `legalReview` 都在节点内部完成了暂停、接收人工结果、决定下一步路由这三件事。`reviseDraft -> generateDraft` 这条普通边则把「打回以后重走一版」这件事接了起来，所以流程不会停在打回那里，而是会重新进入下一轮审批。

## 6. 外部怎么驱动这条图

图写完以后，外部驱动的节奏其实很固定：先启动工作流，让它跑到第一个审批点；再通过 `getState()` 看当前停在哪个节点、带出来了什么审核信息；最后用 `Command({ resume })` 把人工审核结果传回去。

approval-run.ts

```typescript
// 整条审批链都要沿用同一个 thread_id，这样恢复时才能接回原来的流程
const config = { configurable: { thread_id: 'approval-001' } }

// ① 启动：先生成第一版，然后暂停在编辑审核
const initial = await graph.invoke({ topic: 'LangGraph 审批流入门' }, config)

let snapshot = await graph.getState(config)
console.log(snapshot.next)
// → ['editorReview']

// 第一次 invoke 返回的 __interrupt__ 就是外部界面最适合直接读取的审批信息
console.log(initial.__interrupt__)
// → {
//     stage: 'editor',
//     title: '请进行编辑审核',
//     draft: '【LangGraph 审批流入门】...',
//     version: 1,
//   }

// ② 编辑通过，继续往法务走
await graph.invoke(
  new Command({
    resume: {
      approved: true,
      reviewer: '编辑 Alice',
      comment: '内容没问题，可以继续',
    },
  }),
  config,
)

snapshot = await graph.getState(config)
console.log(snapshot.next)
// → ['legalReview']

// ③ 法务通过，图走到发布节点并结束
const result = await graph.invoke(
  new Command({
    resume: {
      approved: true,
      reviewer: '法务 Bob',
      comment: '可以发布',
    },
  }),
  config,
)

console.log(result.status)
// → published

console.log(result.reviewLogs)
// → [
//   { stage: 'editor', reviewer: '编辑 Alice', approved: true, comment: '内容没问题，可以继续' },
//   { stage: 'legal', reviewer: '法务 Bob', approved: true, comment: '可以发布' },
// ]
```

如果其中任意一关打回，恢复时把 `approved` 设成 `false` 就行。

图会自己回到 `reviseDraft -> generateDraft` 这条链，然后再重新停到下一轮审批节点。

## 7. 这种工作流里最容易踩的坑

最容易出问题的，往往不是 `interrupt()` 本身，而是审批状态怎么设计。

如果把所有审核信息都塞进一段文本里，短期看着省事，后面一旦要查「第几版是谁打回的」或者统计某一关的通过率，马上就会变得很难处理。审批记录最好像前面的 `reviewLogs` 一样，用结构化字段存。

另外一个常见问题是恢复时换了 `thread_id`。审批流暂停以后，外部系统再回来恢复时，必须把同一条线程重新接上。只要线程换了，恢复就不是沿着原来的审批流继续跑。

还有一个坑是把副作用放在 `interrupt()` 前面。比如节点一进来先发通知、写数据库、调第三方接口，然后才 `interrupt()`。恢复时节点会从头再跑一遍，这些动作就会重复发生。所以审批节点前半段尽量只做准备数据，真正的副作用放到拿到审核结果以后。

## 8. 总结

到了这里，`interrupt()` 就不再只是一个「暂停函数」了。它和 `Command`、Checkpointer 放在一起以后，已经能落成一条完整的人工审批工作流。

前面几篇讲的状态、路由、持久化和控制流，这一篇都真正放进了一个能工作的业务流程里。现在这条链已经不只是能暂停，还能打回、重走、留痕、再继续往下发布。

下一篇讲 **子图**。到那时，问题会从「怎么把审批流跑起来」变成「这条审批流能不能拆出来，变成别的图也能复用的一块模块」。
