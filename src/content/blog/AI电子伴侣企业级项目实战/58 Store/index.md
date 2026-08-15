---
title: "58 Store"
pubDate: 2026-04-30
description: "checkpointer 能把一条线程里的状态存下来，用户下一轮再回来时，图可以从原来的状态继续跑。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/15-store-memory/](https://aicompanion.usehook.cn/15-store-memory/)

## 1. 线程记忆能解决很多事，但它不是全部

前面几篇其实已经把「记住上下文」这件事做起来了。

`checkpointer` 能把一条线程里的状态存下来，用户下一轮再回来时，图可以从原来的状态继续跑。

这已经很有用了。比如审批流暂停以后回来继续、对话多轮接着聊、某一步失败以后从中间恢复，靠的都是这套线程级记忆。

但业务再往前走一步，你会很快碰到另一类信息：

它不是只属于某一条线程，而是用户跨很多次会话都应该被记住。

比如：

- 这个用户一直偏好简短语气

- 他通常只接受周末上午开会

- 他之前已经明确说过自己不用英文回复

这些信息如果只挂在线程状态里，一换线程就没了。可从产品角度看，它们又明显应该继续存在。

到了这里，`checkpointer` 就不够了。

你需要的是另一层能力：把信息放到线程之外，在后面的任意会话里再取回来。

这就是 `Store`。

## 2. Store 和 checkpointer 不是一回事

这里最容易混的一点，是把 `Store` 当成「另一个更大的 checkpointer」。

它们看起来都在存东西，但职责其实不一样。

`checkpointer` 负责的是线程里的状态。重点是「这条图现在跑到哪了」，所以它天然围绕 `thread_id` 工作。

`Store` 负责的是跨线程长期保存的数据。重点不再是某一轮流程停在哪，而是「这个用户、这个团队、这个应用上下文，有没有什么应该长期记住的信息」。

所以它们经常会一起用：

- `checkpointer` 记线程里的即时状态

- `store` 记跨线程的长期资料

这两层合在一起，系统才会真正有「会话能续上，长期偏好也不会丢」的感觉。

## 3. 先看 Store 里存的到底是什么

`Store` 这套能力，最先要建立的心智模型不是 API，而是它的数据组织方式。

在 LangGraph 里，一条长期记忆通常有三层：

- `namespace`

- `key`

- `value`

`namespace` 可以先把它理解成一个目录。它常常会把用户、团队、业务上下文这些信息放进去。

`key` 更像这一条记忆自己的名字。

`value` 才是真正存下来的内容，通常是一个 JSON 对象。

store-basic.ts

```typescript
import { InMemoryStore } from '@langchain/langgraph'

const store = new InMemoryStore()

const namespace = ['users', 'user_001', 'profile']

// put 的意思很直白：把一条 JSON 数据放进这个 namespace 下
await store.put(namespace, 'preferences', {
  tone: 'short',
  language: 'zh-CN',
  meetingPreference: 'weekend-morning',
})

const item = await store.get(namespace, 'preferences')

console.log(item?.value)
// → {
//     tone: 'short',
//     language: 'zh-CN',
//     meetingPreference: 'weekend-morning',
//   }
```

这一段里最关键的不是 `put` 和 `get` 本身，而是你开始能看见 Store 和线程状态的差别了。

这里存下来的不是「某一次图执行的中间状态」，而是一份以后很多线程都能再拿出来用的资料。

## 4. 把 Store 接进图里，才是这一篇真正要做的事

单独调 `store.put()` 和 `store.get()` 当然不难，真正重要的是：图里的节点怎么拿到这份长期记忆。

LangGraph 现在这套写法里，做法也很直接。你在 `compile()` 的时候把 `store` 传进去，节点运行时就能从 `runtime.store` 里访问它。

compile-with-store.ts

```typescript
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  START,
  END,
  InMemoryStore,
} from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const State = new StateSchema({
  messages: MessagesValue,
})

const ContextSchema = z.object({
  userId: z.string(),
})

const store = new InMemoryStore()

const callModel: GraphNode<typeof State> = async (state, runtime) => {
  // 当前是谁，不适合塞进长期记忆里，
  // 更适合通过 runtime.context 在每次调用时带进来
  const userId = runtime.context?.userId
  const namespace = ['users', userId ?? 'anonymous', 'profile']

  // 节点里可以直接访问 runtime.store
  const memory = await runtime.store?.get(namespace, 'preferences')

  const preference = memory?.value?.tone ?? 'normal'

  return {
    messages: [{
      role: 'assistant',
      content: `已读取到用户偏好，当前语气要求：${preference}`,
    }],
  }
}

const graph = new StateGraph(State)
  .addNode('callModel', callModel)
  .addEdge(START, 'callModel')
  .addEdge('callModel', END)
  .compile({
    store,
    contextSchema: ContextSchema,
  })
```

这里有两处要一起看：

一处是 `compile({ store })`，没有这一步，图里的节点就拿不到长期记忆。

另一处是 `runtime.store`，节点真正运行时，是从这里去读写 Store 的。

## 5. 跨会话长期记忆，最常见的用法就是按用户取资料

上面那段只是读一条已有记忆。放回真实业务里，更常见的是按用户去取这份资料。

这时候 `runtime.context` 就开始有用了。你通常会把当前用户是谁放在这里，再据此拼出对应的 `namespace`。

read-user-memory.ts

```typescript
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  START,
  END,
  InMemoryStore,
} from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const State = new StateSchema({
  messages: MessagesValue,
})

const ContextSchema = z.object({
  userId: z.string(),
})

const store = new InMemoryStore()

await store.put(['users', 'user_001', 'profile'], 'preferences', {
  tone: 'short',
  language: 'zh-CN',
})

const respondWithMemory: GraphNode<typeof State> = async (state, runtime) => {
  const userId = runtime.context?.userId
  const namespace = ['users', userId ?? 'anonymous', 'profile']
  // 这里读的是用户长期偏好，不是当前线程里的临时状态
  const item = await runtime.store?.get(namespace, 'preferences')

  const tone = item?.value?.tone ?? 'normal'
  const language = item?.value?.language ?? 'zh-CN'
  const question = state.messages.at(-1)?.text ?? ''

  return {
    messages: [{
      role: 'assistant',
      content: `我会用 ${language} 回复，并保持 ${tone} 风格。你刚刚的问题是：${question}`,
    }],
  }
}

const graph = new StateGraph(State)
  .addNode('respondWithMemory', respondWithMemory)
  .addEdge(START, 'respondWithMemory')
  .addEdge('respondWithMemory', END)
  .compile({
    store,
    contextSchema: ContextSchema,
  })

const result = await graph.invoke(
  {
    messages: [{ role: 'user', content: '以后回复我尽量简短一点。' }],
  },
  {
    context: { userId: 'user_001' },
  },
)

console.log(result.messages.at(-1)?.text)
```

这一段里，线程可以换，`thread_id` 也可以换，但只要 `userId` 没变，图还是能读到这位用户之前留下来的资料。

这就是 Store 真正有用的地方。它记住的不是这条线程，而是这个用户。

## 6. 只会读取还不够，长期记忆还得会写回去

有了读取以后，下一步自然就是写回。

这件事的落点通常不是每一轮都写，而是在图里找到一个合适的节点，把本轮值得长期保存的信息整理一下，再写进 Store。

比如用户明确说了：

「以后都用中文回复我。」

这句话就很适合落进长期记忆。

write-user-memory.ts

```typescript
import type { GraphNode } from '@langchain/langgraph'

const savePreference: GraphNode<typeof State> = async (state, runtime) => {
  const userId = runtime.context?.userId
  const namespace = ['users', userId ?? 'anonymous', 'profile']
  const lastMessage = state.messages.at(-1)?.text ?? ''

  // 这里只演示最小写法：检测到明确偏好后，写回 Store
  if (lastMessage.includes('中文')) {
    // 这一类信息适合长期保留，因为下一个新线程里仍然会用到
    await runtime.store?.put(namespace, 'preferences', {
      language: 'zh-CN',
      tone: 'short',
    })
  }

  return {
    messages: [{
      role: 'assistant',
      content: '我已经记住这个长期偏好了，后面的新会话里也会继续使用。',
    }],
  }
}
```

这里最需要注意的不是 `put` 本身，而是写回的时机。

长期记忆不适合把每一句话都原样塞进去。更稳的做法，是在图里找一个专门节点，只在真正值得长期保留的时候再写回。这样 Store 里留下来的内容才会更干净。

## 7. Search 这一步，才会让 Store 真正有“记忆感”

如果 Store 只会 `get(namespace, key)`，它更像一个按名字取数据的存储层。

真正让它开始像「长期记忆」的，是搜索。

当某个用户积累下来的长期资料越来越多时，你往往不会每次都知道自己要拿哪一条 key。更常见的情况是：

我想找出跟当前问题最相关的那几条记忆。

search-memory.ts

```typescript
import { InMemoryStore } from '@langchain/langgraph'

const store = new InMemoryStore()
const namespace = ['users', 'user_001', 'memories']

await store.put(namespace, 'm1', {
  text: '用户偏好周末上午开会',
  kind: 'schedule-preference',
})

await store.put(namespace, 'm2', {
  text: '用户希望邮件语气尽量简短直接',
  kind: 'writing-preference',
})

// search 更像是在一组长期资料里找与当前问题有关的内容
const items = await store.search(namespace, {
  query: '会议时间偏好',
})

console.log(items.map(item => item.value.text))
```

这里有一点要讲清楚：`search()` 适合的是「资料多起来以后，再找相关内容」。如果你现在只是在读某一个固定 profile，那么 `get()` 会更直接。

也可以把这三个动作简单分一下：

- `get()` 是按名字拿一条固定资料

- `put()` 是把一条资料写进去

- `search()` 是资料多起来以后，再按当前问题去找相关内容

## 8. 用在真实业务里时，最容易写歪的地方

最常见的问题，是把短期状态和长期记忆混在一起。明明只是这一轮图里的临时结果，却也想顺手塞进 Store。这样时间一长，Store 里就会堆满根本不该长期保留的内容。

第二个问题，是 namespace 设计得太随意。今天写成 `['user_001']`，明天又写成 `['users', 'user_001']`，后面数据一多，就很难再整理。长期记忆一旦开始真的落库，namespace 最好一开始就想清楚。

还有一个问题，是把 Store 当成数据库替代品。Store 当然可以保存结构化 JSON，但它最适合的是「和图运行直接相关、需要在节点里顺手读写的长期资料」。如果你要做特别复杂的业务查询、跨很多表的关联，那还是业务数据库更合适。

## 9. 总结

走到这里，LangGraph 这一章的视角又往前拉了一步。

前面几篇一直在处理线程里的状态和多 Agent 之间的协作，这一篇开始把时间轴拉长，处理跨会话的长期记忆。`checkpointer` 让同一条线程能继续，`Store` 让很多条线程之间也能共享真正该被记住的东西。

下一篇讲 **错误处理与容错**。到那时，问题会从「系统能不能记住东西」切到「系统出错以后，怎么别一下子整条图都断掉」。
