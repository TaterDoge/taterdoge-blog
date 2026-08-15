---
title: "52 中断机制"
pubDate: 2026-04-28
description: "LangGraph 用 interrupt 函数解决这件事。它不是在图的外面做拦截，而是直接写在节点代码里——节点跑到 interrupt 这一行时，整张图就暂停了。等你给了回复，图从暂停的位置继续往下走。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/9-interrupt/](https://aicompanion.usehook.cn/9-interrupt/)

## 1. 有些决策，只能让人来做

前面的图都是全自动的。

`invoke` 一调，图从头跑到尾，中间不会停。

但有些场景不能这样：

- Agent 准备发一封邮件——你想先看一眼内容再发

- Agent 生成了一段代码——你想确认没问题再执行

- Agent 准备删除数据——你需要审批才能继续

这些都是同一个模式：图跑到某一步时，需要暂停下来，等人给一个回复，然后再继续。

LangGraph 用 `interrupt()` 函数解决这件事。它不是在图的外面做拦截，而是直接写在节点代码里——节点跑到 `interrupt()` 这一行时，整张图就暂停了。等你给了回复，图从暂停的位置继续往下走。

NOTE

这篇会继续用到 Checkpointer。图暂停后，状态得先保存下来，恢复时才能从原来的位置接着跑。如果第五篇还没看熟，先回去翻一下会更顺。

## 2. interrupt：在节点里暂停执行

`interrupt` 是一个函数。你在节点代码里调用它，图就会暂停在这一行。

interrupt-shape.ts

```typescript
import { interrupt } from '@langchain/langgraph'

// interrupt 接收一个参数：暂停时带出去的信息
// 这个信息会出现在调用方拿到的结果里，告诉调用方「为什么暂停了、需要什么输入」
const answer = interrupt('请确认是否继续')

// 当图被恢复时，interrupt() 的返回值就是调用方传入的回复
console.log(answer) // → 调用方恢复时传入的值
```

先看一个最小的完整例子，把整个流程走通：

interrupt-basic.ts

```typescript
import {
  StateGraph,
  StateSchema,
  START,
  END,
  Command,
  interrupt,
  MemorySaver,
} from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const State = new StateSchema({
  question: z.string().default(''),
  answer: z.string().default(''),
})

const askHuman: GraphNode<typeof State> = (state) => {
  // 图执行到这里就会暂停
  // '请回答问题' 是带给调用方的提示信息
  const humanAnswer = interrupt(`请回答问题：${state.question}`)

  // 这一行在暂停时不会执行
  // 只有恢复后才会继续往下走
  return { answer: humanAnswer }
}

const graph = new StateGraph(State)
  .addNode('askHuman', askHuman)
  .addEdge(START, 'askHuman')
  .addEdge('askHuman', END)
  .compile({ checkpointer: new MemorySaver() })

// ① 第一次调用：图会在 interrupt() 处暂停
const config = { configurable: { thread_id: 'demo-001' } }
const result1 = await graph.invoke(
  { question: '你最喜欢的编程语言是什么？' },
  config,
)

// result1 不是最终结果，而是暂停时的状态
// 暂停的信息可以通过 getState 查看
const snapshot = await graph.getState(config)
console.log(snapshot.next)
// → ['askHuman']  ← 图暂停在 askHuman 节点

console.log(snapshot.tasks[0]?.interrupts)
// → [{ value: '请回答问题：你最喜欢的编程语言是什么？' }]

// ② 恢复执行：用 Command 传入回复
const result2 = await graph.invoke(
  new Command({ resume: 'TypeScript' }),
  config,
)

console.log(result2.answer)
// → TypeScript
```

这里有几个关键点。

**第一，interrupt 暂停后，图不会返回最终结果。** 第一次 `invoke` 拿到的是暂停时的状态，不是图跑完后的最终结果。你可以通过 `getState` 查看暂停信息。

**第二，恢复时传入的是 `Command({ resume })`，不是普通的输入。** `Command` 的 `resume` 值会变成 `interrupt()` 的返回值。节点从暂停的位置继续往下执行。

**第三，恢复时还是沿用同一个 `config`（同一个 `thread_id`）。** 因为图的状态是按 `thread_id` 保存的，恢复时得把这一条会话重新接上。

### interrupt 暂停时发生了什么

把整个流程拆开看：

- `graph.invoke(input, config)` 开始执行

- 图走到 `askHuman` 节点

- 节点代码执行到 `interrupt(...)` 这一行

- `interrupt` 内部抛出一个特殊的 `GraphInterrupt` 错误

- LangGraph 捕获这个错误，通过 checkpointer 保存当前状态

- `invoke` 返回，图处于暂停状态

- 调用方通过 `getState` 看到 `next: ['askHuman']` 和中断信息

- 调用方用 `Command({ resume })` 再次调用 `invoke`

- LangGraph 加载保存的状态，从 `askHuman` 节点重新执行

- 这次 `interrupt()` 发现有 `resume` 值，不再抛错，而是直接返回这个值

- 节点继续执行后续代码

- 图正常走完

关键理解：**恢复时节点会从头重新执行一次。** `interrupt()` 之前的代码会再跑一遍，但 `interrupt()` 这次不会暂停，而是直接返回 `resume` 值。所以 `interrupt()` 之前的代码应该是幂等的（多次执行结果一样）。

## 3. 一个节点里可以有多个 interrupt

`interrupt` 不限于每个节点只能用一次。你可以在一个节点里连续调用多次，每次暂停、恢复，再到下一个 `interrupt`。

multi-interrupt.ts

```typescript
import {
  StateGraph,
  StateSchema,
  START,
  END,
  Command,
  interrupt,
  MemorySaver,
} from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const State = new StateSchema({
  name: z.string().default(''),
  age: z.string().default(''),
  greeting: z.string().default(''),
})

const collectInfo: GraphNode<typeof State> = () => {
  // 第一个 interrupt：收集姓名
  const name = interrupt('请输入你的姓名')

  // 第二个 interrupt：收集年龄
  // 第一次恢复后，执行到这里会再次暂停
  const age = interrupt('请输入你的年龄')

  return {
    name,
    age,
    greeting: `你好，${name}！你今年 ${age} 岁。`,
  }
}

const graph = new StateGraph(State)
  .addNode('collectInfo', collectInfo)
  .addEdge(START, 'collectInfo')
  .addEdge('collectInfo', END)
  .compile({ checkpointer: new MemorySaver() })

const config = { configurable: { thread_id: 'multi-001' } }

// ① 第一次调用：暂停在第一个 interrupt
await graph.invoke({}, config)
let snapshot = await graph.getState(config)
console.log(snapshot.tasks[0]?.interrupts[0]?.value)
// → '请输入你的姓名'

// ② 恢复第一个：传入姓名，然后暂停在第二个 interrupt
await graph.invoke(new Command({ resume: '小明' }), config)
snapshot = await graph.getState(config)
console.log(snapshot.tasks[0]?.interrupts[0]?.value)
// → '请输入你的年龄'

// ③ 恢复第二个：传入年龄，图跑完
const result = await graph.invoke(new Command({ resume: '25' }), config)
console.log(result.greeting)
// → 你好，小明！你今年 25 岁。
```

多个 `interrupt` 的处理是顺序的：

- 第一次 `invoke`：执行到第一个 `interrupt`，暂停

- 第一次 `resume`：第一个 `interrupt` 返回值，继续执行到第二个 `interrupt`，再次暂停

- 第二次 `resume`：第二个 `interrupt` 返回值，继续执行到节点结束

LangGraph 会把这条线程里已经恢复过的 interrupt 位置一起记住，所以每次恢复时都能接着往下走。

## 4. 实战：带人工审核的内容生成

把前面学的内容综合起来，做一个更贴近实际的例子。

**场景**：AI 生成一段文案 → 人工审核 → 通过就发布，不通过就带着反馈重新生成。

review-workflow.ts

```typescript
import {
  StateGraph,
  StateSchema,
  START,
  END,
  Command,
  interrupt,
  MemorySaver,
} from '@langchain/langgraph'
import type { GraphNode } from '@langchain/langgraph'
import { z } from 'zod'

const State = new StateSchema({
  topic: z.string().default(''),
  draft: z.string().default(''),
  feedback: z.string().default(''),
  status: z.string().default('pending'),
  version: z.number().default(0),
})

// 1. 生成节点：根据主题（和可能的反馈）生成文案
const generate: GraphNode<typeof State> = (state) => {
  const version = state.version + 1

  if (version === 1) {
    // 首次生成（实际项目里调 LLM）
    return {
      draft: `【${state.topic}】LangGraph 是一个基于图结构的 AI 工作流编排框架，让你用节点和边来组织复杂的 Agent 逻辑。`,
      version,
    }
  }

  // 根据反馈修改（实际项目里把反馈传给 LLM 重新生成）
  return {
    draft: `【${state.topic}】LangGraph 是一个基于图结构的 AI 工作流编排框架。它的核心优势在于：状态管理清晰、控制流显式、支持人工介入。（根据反馈修改：${state.feedback}）`,
    version,
  }
}

// 2. 审核节点：暂停等待人工审核
const review: GraphNode<typeof State> = (state) => {
  // 把当前草稿展示给审核人，等待审核结果
  const decision = interrupt({
    message: '请审核以下文案',
    draft: state.draft,
    version: state.version,
    instruction: '回复 { approved: true } 通过，或 { approved: false, feedback: "修改建议" } 打回',
  })

  if (decision.approved) {
    return new Command({
      update: { status: 'approved', feedback: '' },
      goto: 'publish',
    })
  }

  // 打回：带着反馈回到生成节点
  return new Command({
    update: { status: 'rejected', feedback: decision.feedback ?? '请改进' },
    goto: 'generate',
  })
}

// 3. 发布节点
const publish: GraphNode<typeof State> = (state) => {
  return {
    status: 'published',
    draft: `[已发布] ${state.draft}`,
  }
}

const graph = new StateGraph(State)
  .addNode('generate', generate)
  .addNode('review', review, { ends: ['generate', 'publish'] })
  .addNode('publish', publish)
  .addEdge(START, 'generate')
  .addEdge('generate', 'review')
  .addEdge('publish', END)
  .compile({ checkpointer: new MemorySaver() })

const config = { configurable: { thread_id: 'review-001' } }

// ① 启动工作流：生成第一版 → 到审核节点暂停
await graph.invoke({ topic: 'LangGraph 简介' }, config)

let snapshot = await graph.getState(config)
const interruptInfo = snapshot.tasks[0]?.interrupts[0]?.value
console.log(interruptInfo.message)
// → '请审核以下文案'
console.log(interruptInfo.draft)
// → '【LangGraph 简介】LangGraph 是一个基于图结构的...'

// ② 审核人决定打回
await graph.invoke(
  new Command({
    resume: { approved: false, feedback: '请补充核心优势' },
  }),
  config,
)

// 图回到 generate 重新生成，然后又到 review 暂停
snapshot = await graph.getState(config)
console.log(snapshot.tasks[0]?.interrupts[0]?.value.version)
// → 2（第二版）

// ③ 审核人这次通过
const result = await graph.invoke(
  new Command({ resume: { approved: true } }),
  config,
)

console.log(result.status)
// → published
console.log(result.version)
// → 2
```

这个例子把前面学过的几个能力组合在一起：

- `interrupt`：在审核节点暂停，展示草稿，等待人工决策

- `Command`：审核节点根据人工决策路由到不同节点（通过 → 发布，打回 → 重新生成）

- `checkpointer`：保存暂停时的状态，恢复时接着用

- 循环：打回时回到 `generate`，生成新版本后再次进入 `review`

整个工作流可以循环多次，每次都等人工审核，直到通过为止。

## 5. 使用注意

**interrupt 要和 checkpointer 一起用**

没有 checkpointer，图暂停以后就没有地方保存状态，后面也就谈不上恢复了。所以这类图在 `compile()` 时都会一起把 checkpointer 配上。开发阶段可以先用 `MemorySaver`，真正落地时再换成持久化方案。

**不要用 try/catch 包裹 interrupt**

`interrupt()` 内部通过抛出 `GraphInterrupt` 错误来实现暂停。如果你用 `try/catch` 把它包住了，暂停机制就失效了：

interrupt-try-catch.ts

```typescript
// ❌ 错误：try/catch 会吞掉 GraphInterrupt
const myNode = (state) => {
  try {
    const answer = interrupt('请确认')
    return { result: answer }
  } catch (e) {
    // GraphInterrupt 会被这里捕获，图不会暂停
    return { result: 'fallback' }
  }
}

// ✅ 正确：如果必须用 try/catch，确保重新抛出 GraphInterrupt
import { isGraphInterrupt } from '@langchain/langgraph'

const myNode2 = (state) => {
  try {
    const answer = interrupt('请确认')
    return { result: answer }
  } catch (e) {
    if (isGraphInterrupt(e)) throw e  // 让 GraphInterrupt 继续传播
    return { result: 'error' }
  }
}
```

**interrupt 之前的代码要保持幂等**

恢复时节点会从头重新执行。`interrupt()` 之前的代码会再跑一遍。如果这些代码有副作用（比如发请求、写数据库），就会重复执行。所以要注意：

- `interrupt()` 之前的逻辑尽量是纯计算

- 如果有副作用，把它放在 `interrupt()` 之后（拿到回复再执行）

- 或者用状态字段做幂等检查

**interrupt vs interruptBefore / interruptAfter**

`interrupt()` 函数是在节点代码里主动暂停，适合生产环境的人工介入场景。

`interruptBefore` 和 `interruptAfter` 是在 `compile()` 时配置的静态断点，适合调试：

interrupt-before-after.ts

```typescript
// 静态断点：在 review 节点执行前暂停（调试用）
const graph = builder.compile({
  checkpointer: new MemorySaver(),
  interruptBefore: ['review'],
})
```

两者的区别：

| 特性 | interrupt() 函数 | interruptBefore/After |
| --- | --- | --- |
| 写在哪 | 节点代码里 | compile() 配置 |
| 灵活度 | 可以条件性暂停 | 每次经过都暂停 |
| 能带信息吗 | 能，参数就是带出的信息 | 不能 |
| 能拿回复吗 | 能，返回值就是回复 | 不能 |
| 适合场景 | 生产环境，人工审核 | 开发调试，断点检查 |

平时做业务里的人工审核、人工确认，更常用的是直接在节点里写 `interrupt()`。`interruptBefore/After` 更像调试断点，想临时停在某个节点前后看一眼时再用。

## 6. 总结

`interrupt` 解决的核心问题：**让图在执行过程中暂停，等待外部输入，然后从暂停的位置继续。**

完整的暂停/恢复流程：

- 节点里调用 `interrupt(提示信息)`，图暂停

- 调用方通过 `getState` 查看暂停信息

- 调用方用 `graph.invoke(new Command({ resume: 回复 }), config)` 恢复

- `interrupt()` 返回回复值，节点继续执行

使用速查：

| 步骤 | 代码 |
| --- | --- |
| 暂停 | const answer = interrupt('请确认') |
| 查看暂停信息 | (await graph.getState(config)).tasks[0]?.interrupts |
| 恢复 | graph.invoke(new Command({ resume: value }), config) |
| 必须条件 | compile({ checkpointer: new MemorySaver() }) |

三个地方最容易踩坑：

- 记得一起配上 checkpointer

- 不要用 try/catch 把 `interrupt()` 吞掉

- `interrupt()` 前面的代码会在恢复时再跑一遍，尽量保持幂等

下一篇讲 **Human-in-the-Loop 实战：审批工作流**——把 `interrupt` 和前面学过的所有能力组合起来，构建一个更完整的、带多级审批和条件分支的工作流。
