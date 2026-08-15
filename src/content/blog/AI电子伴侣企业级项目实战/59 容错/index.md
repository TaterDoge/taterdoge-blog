---
title: "59 容错"
pubDate: 2026-04-30
description: "前面这一章一路写下来，图已经能分支、暂停、恢复、拆子图，也能组织多 Agent 协作。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/16-error-handling/](https://aicompanion.usehook.cn/16-error-handling/)

## 1. 图一旦真的跑业务，失败就是日常

前面这一章一路写下来，图已经能分支、暂停、恢复、拆子图，也能组织多 Agent 协作。

但只要开始接真实业务，另一个问题就会立刻冒出来：

图不会一直顺着你的理想路径往下跑。

模型可能超时，工具可能报错，外部接口可能返回空值，人工审批可能迟迟不回来，某个并行节点也可能只成功了一半。开发阶段最容易忽略这一点，因为示例里的流程通常都很干净。可一旦放进真实系统，失败不是例外，而是常态。

所以这一篇要处理的，不是怎么把图写出来，而是图出问题以后，怎么别一下子整条断掉。

## 2. 先把“错误”分成几类看

这件事最好别一上来就想成一个大词。图里的失败来源，其实经常是不同层的。

有些失败来自节点内部。比如工具调用报错、模型返回异常、数据解析失败。

有些失败来自图的流程设计。比如本来应该等两个并行节点都回来，结果汇总节点过早开始执行；或者某个字段本来应该追加，结果写成了覆盖。

还有些失败来自外部系统。比如恢复时 thread 配错了、审批结果迟迟不回来、长期记忆没读到。

把这些都叫“错误”当然没问题，但处理方式不一样。

有的要在节点里兜住，有的要在状态里留痕，有的要给图留一条备用路径。

所以这一篇不会只讲 try/catch，而是把几种最常见的容错位置都走一遍。

## 3. 第一层兜底，通常就在节点里

最直接的失败，通常就发生在节点内部。比如某个节点里调了外部工具，结果工具超时了。

这时候最稳的第一步，往往不是急着改整张图，而是先让节点自己别炸掉。

safe-node.ts

```typescript
import type { GraphNode } from '@langchain/langgraph'

const callSearchApi: GraphNode<typeof State> = async (state) => {
  try {
    // 这里模拟一个可能失败的外部调用
    const result = await fetchSearchResult(state.query)

    return {
      searchResult: result,
      status: 'search-success',
      lastError: '',
    }
  } catch (error) {
    // 节点先把失败写回状态，而不是直接把整条图打崩
    return {
      searchResult: '',
      status: 'search-failed',
      lastError: error instanceof Error ? error.message : '搜索接口调用失败',
    }
  }
}
```

这一层的关键，不是把错误吞掉，而是把错误留在状态里。

只要状态里还有 `status` 和 `lastError` 这些字段，后面的节点、条件边或者汇总节点就还有机会决定：是重试、降级，还是结束。

## 4. 只会 try/catch 还不够，后面还得知道怎么走

如果节点里只是 catch 住错误，但后面的图根本不知道失败了，那这层兜底就只做了一半。

更完整的写法，通常是：

先让节点把成功或失败写进状态，再让下一步根据状态决定往哪走。

error-routing.ts

```typescript
import {
  StateGraph,
  StateSchema,
  START,
  END,
} from '@langchain/langgraph'
import type { GraphNode, ConditionalEdgeRouter } from '@langchain/langgraph'
import { z } from 'zod'

const State = new StateSchema({
  query: z.string().default(''),
  searchResult: z.string().default(''),
  status: z.string().default('idle'),
  lastError: z.string().default(''),
})

const callSearchApi: GraphNode<typeof State> = async (state) => {
  try {
    const result = await fetchSearchResult(state.query)

    return {
      searchResult: result,
      status: 'search-success',
      lastError: '',
    }
  } catch (error) {
    return {
      searchResult: '',
      status: 'search-failed',
      lastError: error instanceof Error ? error.message : '搜索接口调用失败',
    }
  }
}

const fallbackAnswer: GraphNode<typeof State> = (state) => {
  return {
    searchResult: `降级回答：当前外部搜索暂时不可用，错误信息是 ${state.lastError}`,
  }
}

const shouldContinue: ConditionalEdgeRouter<typeof State, 'fallbackAnswer'> = (state) => {
  if (state.status === 'search-failed') return 'fallbackAnswer'
  return END
}

const graph = new StateGraph(State)
  .addNode('callSearchApi', callSearchApi)
  .addNode('fallbackAnswer', fallbackAnswer)
  .addEdge(START, 'callSearchApi')
  .addConditionalEdges('callSearchApi', shouldContinue, ['fallbackAnswer'])
  .addEdge('fallbackAnswer', END)
  .compile()
```

这里的变化很重要。错误不再只是节点内部的一次异常，而是变成了图可以继续读取的一种状态。

一旦图能读到它，就可以把失败也纳入流程控制里。

## 5. 如果可以重试，就把重试写进图里

有些失败不是立刻就该降级，而是值得再试一次。

比如模型超时、搜索接口临时抖一下、外部服务偶发返回空。碰到这种情况，最常见的做法就是在状态里加一个计数器，再留一条回边。

retry-loop.ts

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
  query: z.string().default(''),
  result: z.string().default(''),
  retryCount: z.number().default(0),
  status: z.string().default('idle'),
  lastError: z.string().default(''),
})

const callSearchApi: GraphNode<typeof State> = async (state) => {
  try {
    const result = await fetchSearchResult(state.query)

    return {
      result,
      status: 'success',
      lastError: '',
    }
  } catch (error) {
    // 到这里说明这一次调用失败了，
    // 下面要决定的是继续重试，还是直接切到降级节点
    if (state.retryCount >= 2) {
      return new Command({
        update: {
          status: 'failed',
          lastError: error instanceof Error ? error.message : '搜索接口调用失败',
        },
        goto: 'fallbackAnswer',
      })
    }

    return new Command({
      update: {
        retryCount: state.retryCount + 1,
        status: 'retrying',
        lastError: error instanceof Error ? error.message : '搜索接口调用失败',
      },
      goto: 'callSearchApi',
    })
  }
}

const fallbackAnswer: GraphNode<typeof State> = (state) => {
  return {
    result: `最终降级：重试 ${state.retryCount} 次后仍然失败。`,
  }
}

const graph = new StateGraph(State)
  .addNode('callSearchApi', callSearchApi, { ends: ['callSearchApi', 'fallbackAnswer'] })
  .addNode('fallbackAnswer', fallbackAnswer)
  .addEdge(START, 'callSearchApi')
  .addEdge('fallbackAnswer', END)
  .compile()
```

这一段和前面的差别在于，失败以后图没有立刻结束，而是明确地沿着另一条路径再试一次。

只要重试条件和退出条件写清楚，图里的失败处理就会比散落在各处的 if/else 更稳。

这里也能顺手把边界看清楚：

- 值得重试的问题，通常是超时、抖动、偶发空结果

- 不值得重试的问题，通常是参数错误、权限错误、输入本身就不成立

## 6. 有些错误不该重试，而该直接降级

不是所有失败都值得重试。

如果是权限错误、参数不合法、用户输入本身就不完整，那你再试三次通常也不会变好。这个时候更合适的办法往往不是回边，而是直接切到降级节点。

比如：

工具不可用时，先给一个保守回答；外部搜索失败时，退回本地知识库；审批节点拿不到结果时，先把状态标记成待人工处理。

这类节点和前面的 `fallbackAnswer` 一样，真正的价值不是「回答得多聪明」，而是图没有因此直接死掉。

## 7. 并行场景里，最怕的是一边成功一边失败

前面讲层级团队和并行协作时，图里最容易被忽略的一个现实问题是：

两个并行节点，不一定会一起成功。

比如研究员拿回来了竞品信息，但风险分析接口超时了。这个时候，汇总节点就会面临一个选择：

是拿到一半结果就继续收口，还是先标记失败，还是再补一次重试。

所以并行图里最好别只存「结果」，还要存每个分支自己的状态。

parallel-status.ts

```typescript
const State = new StateSchema({
  researchResult: z.string().default(''),
  riskResult: z.string().default(''),
  researchStatus: z.string().default('idle'),
  riskStatus: z.string().default('idle'),
  finalAnswer: z.string().default(''),
})
```

这样到了汇总节点，你才能看清楚到底是哪一边出了问题，而不是只看到「最终答案怎么少了一块」。

## 8. 人工介入，其实也是一种容错方式

前面那篇审批流已经讲过，`interrupt()` 能让图暂停，等外部决定以后再继续。

把它放到这一篇里看，会发现它其实也是一种容错。

有些问题，系统不应该自己硬判断。比如：

模型打分处在灰区，检索结果彼此冲突，或者工具执行结果看起来可疑。

这时候最稳的做法往往不是再让模型自己猜，而是停下来，把当前状态交给人工确认。

所以图里的容错不一定都是自动恢复，有时候恰恰是「别自动往下跑」。

## 9. 写这类图时最容易出的问题

最常见的问题，是只在日志里记错误，不把错误写进状态。这样节点内部看起来已经兜住了，图本身却根本不知道发生了什么，后面也就没法继续做判断。

第二个问题，是重试没有出口。只要失败就往回跳，却没有最大次数、没有降级路径，最后图会一直在原地打转。

还有一种情况，是把所有失败都归成一种。模型超时、参数错误、人工审批未完成、外部工具 500，全被塞进同一个 `error` 字段里。这样后面虽然看起来「有错误状态」，但实际上你还是不知道该怎么处理。

## 10. 总结

走到这里，这一章已经不只是讲怎么把图写出来了，也开始讲怎么让图在真实环境里活下来。

前面的状态、路由、暂停、子图、多 Agent，解决的是图怎么组织；这一篇的重点是图出问题以后怎么继续工作。节点内兜底、状态留痕、重试、降级、人工介入，这几层合在一起，图才会真正有韧性。

下一篇就进入最后一篇实战：**用 LangGraph 重构 AI 伴侣管线**。到那时，前面这些状态、控制流、长期记忆、多 Agent 和容错能力，都会落到同一条完整系统里。
