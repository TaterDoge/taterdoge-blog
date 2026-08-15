---
title: "125 多步推理"
pubDate: 2026-05-20
description: "上一篇写了一个典型 tool calling 的例子：LLM 说「我要调 searchMemory」，我们执行，把结果回给它，它再生成最终回复。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/10-multi-step-agent/](https://aicompanion.usehook.cn/10-multi-step-agent/)

## 1. 从「一次调用」到「多步 Agent」

上一篇写了一个典型 tool calling 的例子：LLM 说「我要调 searchMemory」，我们执行，把结果回给它，它再生成最终回复。

但如果这次「生成最终回复」时 LLM 又觉得信息不够、还想再调一个工具呢？这就是 Agent 循环：

agent-loop.txt

```text
user: 帮我记录今天的情绪并推荐一首适合听的歌

LLM step1: 先调 classifyEmotion
    ↓
tool-result: { emotion: 'sad', intensity: 0.7 }
    ↓
LLM step2: 好，现在调 searchMusic，按情绪找
    ↓
tool-result: [{ title: 'x', url: 'y' }, ...]
    ↓
LLM step3: 最后调 logEmotion 记录下来
    ↓
tool-result: { ok: true }
    ↓
LLM step4: 生成最终回复 「我记录了你今天的情绪，推荐这首...」
```

AI SDK 把这套循环内置了，你不用自己写 while 循环。只要给 `streamText` 传一个 `stopWhen`，它就会自动做这几件事：

- 调 LLM

- LLM 返回 tool-call → AI SDK 执行工具 → 把 tool-result 塞进消息

- 再调 LLM

- 重复，直到 LLM 不再调工具，或者触发 `stopWhen`

这一篇把这套机制讲透。

## 2. 最简 Agent 循环

看最简单的用法：

agent-simple.ts

```typescript
import { streamText, stepCountIs } from 'ai'

const result = streamText({
  model: models.chat,
  messages: [
    { role: 'user', content: '帮我记录今天的情绪并推荐一首适合听的歌' },
  ],
  tools: {
    classifyEmotion,
    searchMusic,
    logEmotion,
  },
  stopWhen: stepCountIs(5), // 最多 5 step
})

for await (const part of result.fullStream) {
  if (part.type === 'text-delta') process.stdout.write(part.delta)
  if (part.type === 'tool-call') console.log('\n[调用]', part.toolName)
  if (part.type === 'tool-result') console.log('\n[结果]', part.output)
  if (part.type === 'finish-step') console.log('\n[step 完成]')
  if (part.type === 'finish') console.log('\n[全部完成]', part.finishReason)
}
```

对应的 `fullStream` 会输出多轮 `start-step` / `tool-call` / `tool-result` / `finish-step`，最后才是 `text-delta` 和 `finish`。

## 3. stopWhen：停止条件

`stopWhen` 控制循环什么时候结束。它可以是单个条件，也可以是条件数组（任意一个满足就停）。

### 3.1 stepCountIs：按步数

最常用的一个：

step-count.ts

```typescript
import { stepCountIs } from 'ai'

stopWhen: stepCountIs(5)       // 最多 5 步
stopWhen: stepCountIs(3)       // 最多 3 步（适合简单任务）
stopWhen: stepCountIs(10)      // 最多 10 步（复杂任务）
```

给多少步合适，看任务复杂度：

- 简单任务（1-2 个工具顺序调用）：3 步够

- 中等任务（需要探索、回退）：5-7 步

- 复杂任务（多工具交叉、规划）：10 步起

上限的核心意义是防死循环。LLM 有时候会陷入「调工具 → 结果不满意 → 再调 → 还不满意」的死循环，`stepCountIs` 是硬保险。

### 3.2 其他停止条件

某个工具被调用过就停，用 `hasToolCall`：

has-tool-call.ts

```typescript
import { hasToolCall } from 'ai'

// 只要调过 finalizeResponse 就停
stopWhen: hasToolCall('finalizeResponse')
```

适合的场景：工具箱里有一个「终结者」工具（比如 `finalizeResponse` 或 `commitAction`），调到它就意味着任务完成。

多个条件任一满足就停，用数组组合：

combine.ts

```typescript
stopWhen: [
  stepCountIs(10),
  hasToolCall('finalizeResponse'),
]
```

`stopWhen` 也可以传一个函数，接收 `{ steps }`，返回 boolean：

custom-stop.ts

```typescript
stopWhen: ({ steps }) => {
  // 如果有任何 step 用到了超过 3000 个 input token，停
  const totalTokens = steps.reduce((sum, s) => sum + s.usage.inputTokens, 0)
  return totalTokens > 3000
}
```

这就给成本控制、业务规则留了很多空间。

## 4. 完整流：一次 Agent 循环发生了什么

用一个详细例子看清 Agent 循环内部到底发生了什么。

输入：

input.txt

```text
用户: 帮我查一下上周五聊了什么，用那个话题写一段安慰的回复
```

工具箱：`searchMemory`、`analyzeEmotion`、`finalizeResponse`。

### Step 1：LLM 分析，决定先检索记忆

step1.txt

```text
start-step
text-delta: "让我先回忆一下..."
tool-call: searchMemory({"query": "上周五 话题"})
```

AI SDK 执行 `searchMemory`：

step1-tool.txt

```text
tool-result: [{content: "上周五你说工作压力大"}, ...]
finish-step
```

### Step 2：LLM 拿到记忆，决定分析情绪

step2.txt

```text
start-step
tool-call: analyzeEmotion({"text": "上周五你说工作压力大"})
```

AI SDK 执行 `analyzeEmotion`：

step2-tool.txt

```text
tool-result: {emotion: "stressed", intensity: 0.8}
finish-step
```

### Step 3：LLM 综合信息，生成最终回复

step3.txt

```text
start-step
text-delta: "我记得你上周五说..."
text-delta: "到工作压力特别大..."
text-delta: "希望这周好一点..."
finish-step
finish (reason: stop)
```

整个过程通过一个 `streamText` 调用、一次 `fullStream` 消费就完成了。

这里一个重要的细节：消息历史是自动累积的。AI SDK 内部会把每个 step 的 tool-call / tool-result 拼进下一次 LLM 调用的 messages 里，不需要你手动组装。

## 5. 访问 steps：拿到每一步的详情

流结束之后，可以拿到所有 step 的结构化数据：

access-steps.ts

```typescript
const result = streamText({ model, messages, tools, stopWhen: stepCountIs(5) })

// 等流跑完
for await (const _ of result.textStream) { /* 消费或丢弃 */ }

// 拿到所有 step
const steps = await result.steps
for (const [i, step] of steps.entries()) {
  console.log(`Step ${i + 1}:`)
  console.log('  - text:', step.text)
  console.log('  - toolCalls:', step.toolCalls)
  console.log('  - toolResults:', step.toolResults)
  console.log('  - usage:', step.usage)
  console.log('  - finishReason:', step.finishReason)
}

// 汇总信息
const totalUsage = await result.usage
const finalText = await result.text
```

每个 step 就是一次完整的「LLM 调用 + 工具执行」轮次。这个结构非常适合做三件事：

- 埋点——知道每一步多少 token、用了什么工具

- 回放——存下来后可以重现一次 Agent 运行

- Debug——看清楚 LLM 每一步的决策

## 6. prepareStep：step 之间的钩子

`prepareStep` 是一个非常强大的钩子。它在每次 step 开始前被调用，可以动态修改下一个 step 的行为：

prepare-step.ts

```typescript
streamText({
  model: models.chat,
  messages,
  tools: companionTools,
  stopWhen: stepCountIs(5),

  prepareStep: async ({ stepNumber, steps, messages }) => {
    // 第一步：强制用结构化工具分类情绪
    if (stepNumber === 0) {
      return {
        toolChoice: { type: 'tool', toolName: 'classifyEmotion' },
      }
    }

    // 最后一步：禁用所有工具，强制生成文本
    if (stepNumber === 4) {
      return { toolChoice: 'none' }
    }

    // 其他 step 保持默认
    return undefined
  },
})
```

还可以在 prepareStep 里动态修改 messages、system、tools：

dynamic-step.ts

```typescript
prepareStep: async ({ stepNumber, messages }) => {
  // 在第 3 步的 prompt 里注入新信息
  if (stepNumber === 2) {
    return {
      messages: [
        ...messages,
        { role: 'system', content: '请基于前两步的结果生成最终回复。' },
      ],
    }
  }
  return undefined
}
```

这让你能在 AI SDK 的 Agent 循环里插入自定义逻辑，不用自己重写循环。

## 7. 和 LangGraph ReAct Agent 的对比

我们在 LangChain 讲过 `createReactAgent`。两者对比一下：

| 维度 | LangChain createReactAgent | AI SDK streamText + stopWhen |
| --- | --- | --- |
| 循环控制 | Agent 内部 | stopWhen 参数 |
| step 粒度观察 | .stream({streamMode: 'values'}) | fullStream 的事件 |
| 中间逻辑钩子 | checkpointer 机制 + 自定义节点 | prepareStep / onStepFinish |
| 多 Agent 协作 | LangGraph supervisor / swarm | 不原生支持，需自己组合 |
| HITL | LangGraph interrupt | tool 不传 execute + 自行续传 |
| 时间旅行 / 回滚 | LangGraph checkpointer | 无 |
| 状态持久化 | Checkpointer（PostgresSaver 等） | 业务层自己做 |
| 学习成本 | 较高（要懂 Graph 概念） | 较低（就是一个参数） |

什么时候 AI SDK 的 Agent 循环就够用：

- 线性任务（几个工具顺序或并行调用）

- 不需要分支、回滚、HITL

- 不需要跨会话记忆 step 状态

什么时候需要上 LangGraph：

- 多节点图（情绪节点 → 记忆节点 → Prompt 节点 → LLM 节点）

- 条件路由

- HITL / 时间旅行

- 多 Agent 协作

对 AI 伴侣项目来说，主管线用 LangGraph（情绪状态机、混合记忆、HITL 审批），末端 LLM 节点内部则用 `streamText` + `stopWhen` 做 tool 调用。[与 LangChain 协同](/20-langchain-integration) 会展开。

## 8. 常见问题与小结

### 为什么 LLM 一直调工具不停

stopWhen 给的步数太少时容易出现这个现象。排查方向：工具 description 写得不清楚，导致 LLM 不知道什么时候算完成；schema 太松，LLM 反复尝试不同参数；缺少一个「终结者」工具（如 `finalizeResponse`）；或者模型推理能力不够。

### 为什么 LLM 一次也不调工具

常见原因有几个：description 太模糊；prompt 里没引导 LLM 思考工具；模型本身 tool calling 能力弱（部分小型模型会这样）。

### 工具并行调用失控

如果 LLM 一次 step 里同时调 5 个工具，但你期望顺序执行，可以在 system prompt 里明确要求「一次只调一个工具」，或者用 `prepareStep` 控制每一步开放的工具集。

### 如何强制 Agent 以特定工具收尾

用 `hasToolCall` 配合 `prepareStep`：

force-final.ts

```typescript
// stopWhen 用 hasToolCall
stopWhen: hasToolCall('finalizeResponse'),

// prepareStep 在接近上限时强制调用
prepareStep: ({ stepNumber, steps }) => {
  if (stepNumber >= 4) {
    return { toolChoice: { type: 'tool', toolName: 'finalizeResponse' } }
  }
}
```

### 小结

- `stopWhen` 把 Agent 循环变成一个参数：`stepCountIs(N)` / `hasToolCall(name)` / 自定义函数 / 数组组合

- `prepareStep` 是 step 之间的强力钩子，能动态改 `toolChoice` / `messages` / `system`

- `result.steps` 让你拿到每一步的结构化数据，便于埋点、回放、调试

- 适用场景是线性多步任务，不需要图结构、HITL、时间旅行

- 和 LangGraph 的分工：复杂编排交给 LangGraph，LLM 节点内用 AI SDK Agent 循环

本章核心能力部分到这里就结束了。下一篇开始进入**前端集成**——`useChat` Hook 替换 [Streaming](/13-streaming-response-architecture) 手写的 `useStreamChat`。
