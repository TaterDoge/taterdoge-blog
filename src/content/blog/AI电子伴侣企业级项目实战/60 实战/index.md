---
title: "60 实战"
pubDate: 2026-05-01
description: "先讲状态、节点、边，再讲 reducer、条件路由、checkpointer、interrupt、子图、多 Agent、Store 和容错。单看每一篇，它们都不难理解。但只要真的要做一个能长期演进的 AI 伴侣系统，问题很快就不再是「某个节"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/17-langgraph-practice/](https://aicompanion.usehook.cn/17-langgraph-practice/)

## 1. 到了这里，问题已经不是某一个节点怎么写

前面这一整章，其实一直在把 LangGraph 的几块能力拆开讲。

先讲状态、节点、边，再讲 reducer、条件路由、checkpointer、`interrupt()`、子图、多 Agent、Store 和容错。单看每一篇，它们都不难理解。但只要真的要做一个能长期演进的 AI 伴侣系统，问题很快就不再是「某个节点怎么写」了。

真正的问题会变成：

这套系统到底该怎么拆。

如果还用前面最早的那种做法，把提示词、工具、记忆、外部调用、人工介入全堆在一个 Agent 入口里，功能当然能继续往上加，但代码会越来越难收。记忆读写混在一起，工具调用和回复生成混在一起，异常处理也全塞在一层里。写到后面，很多问题不是不能修，而是改一个地方总会牵一大片。

所以这一篇不再单独讲某个 API，而是把前面这一章已经讲过的东西，重新放回一条完整的 AI 伴侣管线里，看看它们各自应该待在哪。

## 2. 先看没有重构之前，系统会卡在哪

先把问题讲具体一点。

一个最常见的 AI 伴侣入口，早期通常会长这样：

接收用户消息，拼系统提示词，把历史消息塞进去，需要时查记忆，需要时调工具，最后再生成回复。

刚开始这么写没有问题。可一旦需求往前走，下面这些东西就会开始互相缠住：

用户长期偏好要跨会话保留，当前这轮对话的状态还得继续接上，某些问题要交给不同角色处理，有些节点失败以后不能直接整条断掉，某些场景下还要暂停等人工确认。

这时候继续把所有逻辑挂在一个入口上，代码不会立刻坏掉，但结构已经开始吃力了。

## 3. 重构以后，这条管线更像一张图

把 AI 伴侣系统换成 LangGraph 来看，思路会不一样。

你不再把它当成「一次模型调用」，而是把它当成一条会持续流动的状态管线。用户消息进来以后，不是直接冲向一个万能 Agent，而是先经过一串明确的阶段：

- 读取长期记忆

- 判断当前意图

- 进入合适的角色或子图

- 需要时调工具或检索

- 生成回复

- 写回该留下的长期信息

- 如果中途出问题，再按失败路径处理

一旦这样拆，很多原来缠在一起的问题，就会自然落到不同层里去。

## 4. 先把状态边界划出来

这条管线里，最先要划清楚的不是节点，而是状态。

一个 AI 伴侣系统里，最容易混在一起的通常有三类东西：

当前线程里的即时对话状态，跨线程的长期资料，以及某一轮工作流临时产生的中间结果。

放到 LangGraph 里，我们可以先把线程里的状态收进一份 `StateSchema`。

companion-state.ts

```typescript
import { StateSchema, MessagesValue, ReducedValue } from '@langchain/langgraph'
import { z } from 'zod'

const appendToolNotes = (current: string[], update: string[]) => {
  return [...current, ...update]
}

const State = new StateSchema({
  messages: MessagesValue,
  intent: z.string().default('chat'),
  activeRole: z.string().default('companion'),
  retrievedMemories: new ReducedValue(
    z.array(z.string()).default([]),
    { reducer: appendToolNotes },
  ),
  toolNotes: new ReducedValue(
    z.array(z.string()).default([]),
    { reducer: appendToolNotes },
  ),
  draftReply: z.string().default(''),
  lastError: z.string().default(''),
  status: z.string().default('idle'),
})
```

这一层先只做一件事：把线程里会随着流程推进而变化的东西放好。

而长期资料，比如用户偏好、沟通风格、常用称呼，不直接塞进这份状态里。它们更适合放在 `Store` 里，按用户去取。

## 5. 第一段流程，通常先读长期记忆

AI 伴侣系统一上来最值得做的事，往往不是马上回复，而是先把这个用户该带进来的长期资料读出来。

load-long-term-memory.ts

```typescript
import type { GraphNode } from '@langchain/langgraph'

const loadLongTermMemory: GraphNode<typeof State> = async (state, runtime) => {
  const userId = runtime.context?.userId
  const namespace = ['users', userId ?? 'anonymous', 'profile']

  const preferenceItem = await runtime.store?.get(namespace, 'preferences')
  const tone = preferenceItem?.value?.tone ?? 'warm'
  const language = preferenceItem?.value?.language ?? 'zh-CN'

  return {
    toolNotes: [
      `用户长期偏好：language=${language}`,
      `用户长期偏好：tone=${tone}`,
    ],
    status: 'memory-loaded',
  }
}
```

这里的关键不是「多读了一次数据」，而是整条图后面都开始有了这个用户的背景信息。

这一步如果还像以前一样夹在提示词拼接里，就会越来越隐蔽。单独拆成节点以后，读长期记忆这件事就清楚了。

## 6. 第二段流程，判断当前这轮到底该找谁

伴侣系统并不是每一轮都只是陪聊。有时是闲聊，有时是情绪安抚，有时是日程安排，有时是写消息、改文案、查资料。

所以第二步通常不会直接回复，而是先判断当前请求属于哪类问题，再决定让谁接手。

route-intent.ts

```typescript
import type { GraphNode } from '@langchain/langgraph'
import { Command } from '@langchain/langgraph'

const routeIntent: GraphNode<typeof State> = (state) => {
  const lastMessage = state.messages.at(-1)?.text ?? ''

  if (lastMessage.includes('开会') || lastMessage.includes('日程')) {
    return new Command({
      update: {
        intent: 'schedule',
        activeRole: 'schedule-agent',
      },
      goto: 'scheduleSubgraph',
    })
  }

  if (lastMessage.includes('邮件') || lastMessage.includes('文案')) {
    return new Command({
      update: {
        intent: 'writing',
        activeRole: 'writing-agent',
      },
      goto: 'writingSubgraph',
    })
  }

  return new Command({
    update: {
      intent: 'chat',
      activeRole: 'companion',
    },
    goto: 'companionReply',
  })
}
```

这一层其实就是把前面讲过的路由、`Command` 和多角色拆分重新放回真实业务里。

## 7. 第三段流程，角色内部各走各的子图

到了这里，前面的子图和多 Agent 几篇就开始真正有用了。

日程问题不需要走写作那套逻辑，写作问题也不需要进入陪聊回复。所以在重构后的系统里，更自然的做法通常是让每类能力有自己的一块子图。

role-subgraphs.ts

```typescript
const graph = new StateGraph(State)
  .addNode('loadLongTermMemory', loadLongTermMemory)
  .addNode('routeIntent', routeIntent)
  .addNode('scheduleSubgraph', scheduleSubgraph)
  .addNode('writingSubgraph', writingSubgraph)
  .addNode('companionReply', companionReply)
  .addNode('persistLongTermMemory', persistLongTermMemory)
  .addNode('fallbackReply', fallbackReply)
  .addEdge(START, 'loadLongTermMemory')
  .addEdge('loadLongTermMemory', 'routeIntent')
  .addEdge('scheduleSubgraph', 'persistLongTermMemory')
  .addEdge('writingSubgraph', 'persistLongTermMemory')
  .addEdge('companionReply', 'persistLongTermMemory')
  .addEdge('persistLongTermMemory', END)
  .compile({
    checkpointer,
    store,
    contextSchema: ContextSchema,
  })
```

这里真正的变化，是「系统不再只有一个中央处理函数」了。

不同意图进入不同子图，子图里再各自挂工具、状态和控制流，这样功能加深以后，结构也不容易乱。

这里的 `scheduleSubgraph` 和 `writingSubgraph` 可以直接接前面子图那篇的写法。重点不是子图内部细节，而是这条总管线终于不需要自己把所有事情都做完了。

## 8. 第四段流程，最后再把该留下的东西写回去

伴侣系统和普通问答系统最大的区别之一，就是有些东西值得被长期记住。

比如用户明确表达了新的偏好，或者某个长期资料需要更新。这个时候更稳的做法，不是边回复边顺手写，而是在流程快结束时，留一个专门节点来做这件事。

persist-long-term-memory.ts

```typescript
import type { GraphNode } from '@langchain/langgraph'

const persistLongTermMemory: GraphNode<typeof State> = async (state, runtime) => {
  const userId = runtime.context?.userId
  const namespace = ['users', userId ?? 'anonymous', 'profile']
  // 走到这里时，最后一条消息有可能已经是助手回复，
  // 所以这里要回头找最近一条用户消息，再决定要不要写回长期记忆
  const lastUserMessage = [...state.messages]
    .reverse()
    .find(message => message.getType() === 'human')
    ?.text ?? ''

  // 这里只演示一种最小判断：用户明确提到语言偏好，就写回 Store
  if (lastUserMessage.includes('以后都用中文')) {
    await runtime.store?.put(namespace, 'preferences', {
      language: 'zh-CN',
      tone: 'warm',
    })
  }

  return {
    status: 'completed',
  }
}
```

把这一步单独留出来以后，长期记忆的读写边界就很清楚了：

开头读进来，中间拿来参与决策，结尾根据需要再写回去。

## 9. 容错这层，不能等出事了再补

如果只是把意图路由、子图和长期记忆接起来，这条管线已经能跑。

但真正落到业务里，最怕的还是某一层一失败，整条图跟着一起断掉。所以容错最好不是最后临时打补丁，而是从一开始就留在结构里。

error-fallback.ts

```typescript
import type { GraphNode } from '@langchain/langgraph'

const fallbackReply: GraphNode<typeof State> = (state) => {
  return {
    messages: [{
      role: 'assistant',
      content: `我这次处理时遇到了一点问题：${state.lastError || '未知错误'}。先继续陪你聊，不会影响后面的对话。`,
    }],
    status: 'fallback',
  }
}
```

这类节点看上去很普通，但放在完整系统里就会很重要。因为它意味着：

即使某个角色、某个工具、某个子图出错，系统也还能保住一条对外可用的回复路径。

## 10. 如果把整条管线串起来，大概就是这个样子

把前面几段合在一起，这条重构后的 AI 伴侣管线，大概可以概括成下面这条顺序：

用户消息先进来，系统先读取长期记忆；读完以后判断当前意图，决定该走陪聊、日程还是写作；进入对应子图以后，各自处理自己的工具和内部流程；快结束时把值得长期保存的资料写回 Store；如果中间有节点失败，再切到备用回复路径。

这时候，前面这一整章讲过的东西，基本都落到了同一条系统里：

- `StateSchema` 负责线程状态

- `checkpointer` 负责把线程继续接上

- `Store` 负责跨会话长期记忆

- `Command` 和条件边负责控制流

- 子图负责拆业务模块

- 多 Agent 负责角色分工

- 容错节点负责让系统别轻易断掉

## 11. 总结

走到这里，这一章也差不多收住了。

如果只把 LangGraph 看成一个图编排库，当然也没问题。但前面这一整章一路写下来，其实已经能看出更完整的样子了：它真正适合的，不是单次模型调用，而是那些状态会持续流动、角色会分工、流程会暂停恢复、而且系统还得长期演进的 AI 应用。

所以这一篇最后的重点也不只是「把 AI 伴侣重构了一遍」，而是把前面那些分散的能力重新落回一个系统视角里。写到这里，LangGraph 这一大章就不只是 API 笔记了，而是开始变成一套能落系统的做法。
