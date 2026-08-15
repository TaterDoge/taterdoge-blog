---
title: "43 Tracing"
pubDate: 2026-04-25
description: "上一篇我们已经把 interrupt 跑通了，知道图可以在节点里暂停，等外部输入后再继续。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/19-tracing/](https://aicompanion.usehook.cn/19-tracing/)

## 1. 前面手动搭了一整套 Tracing，LangChain 里还要再来一遍吗

在第一章的可观测性中，我们从头搭了一套完整的可观测体系：

- **TraceContext**：每次请求创建一个实例，用 `trace.span()` 包装每个管线节点，自动记录输入、输出、耗时、状态

- **采样策略**：错误和降级全量保留，正常请求按比例采样

- **分层存储**：D1 存完整现场，KV 存聚合摘要，waitUntil 不阻塞响应

那套方案很好，但接入成本不算低。每个管线节点都要手动包一层 `trace.span()`，每次新增节点都要记得埋点。

manual-span.ts

```typescript
// 前面的做法：手动包装每个节点
const memories = await trace.span(
  'memory_retrieval',
  { query: userMessage, sessionId },
  () => retrieveMemories(env, userMessage, sessionId)
)
```

现在进入 LangChain 体系，事情变了。

LangChain 的每个核心组件——ChatModel、Tool、Chain、Retriever——在运行时都会**自动**在关键节点发出事件通知。你不需要手动写 `trace.span()`，框架已经帮你埋好了。

这套事件通知机制就是 **Callbacks**。

一句话概括它和前面 TraceContext 的关系：

**TraceContext 是你自己搭的事件采集框架，Callbacks 是 LangChain 内建的事件采集框架。** 概念一样，只是谁来做的区别。

## 2. Callbacks 的事件模型：和 Span 一一对应

前面定义 Span 时，每个 Span 记录三件事：**什么时候开始**（startTime）、**什么时候结束**（duration）、**结果是什么**（status + output）。

LangChain 的 callbacks 把这三件事拆成了成对的事件。以工具调用为例：

| Span 阶段 | 对应 Callback 事件 | 触发时机 |
| --- | --- | --- |
| 开始 | handleToolStart | 工具开始执行，携带工具名和输入参数 |
| 成功结束 | handleToolEnd | 工具执行完成，携带输出结果 |
| 失败结束 | handleToolError | 工具执行报错，携带错误信息 |

每一对 start/end 事件，就等价于前面 TraceContext 里的一个 Span。

LangChain 为所有核心组件都定义了这样的事件对：

**模型调用**

| 事件 | 触发时机 |
| --- | --- |
| handleChatModelStart | ChatModel 开始推理，携带完整的消息列表 |
| handleLLMEnd | 模型推理完成，携带生成结果和 token 用量 |
| handleLLMError | 模型调用失败 |
| handleLLMNewToken | 流式输出时，每产生一个 token 触发一次 |

**工具调用**

| 事件 | 触发时机 |
| --- | --- |
| handleToolStart | 工具开始执行 |
| handleToolEnd | 工具执行完成 |
| handleToolError | 工具执行报错 |

**Chain（链）**

| 事件 | 触发时机 |
| --- | --- |
| handleChainStart | Chain 开始运行 |
| handleChainEnd | Chain 运行完成 |
| handleChainError | Chain 运行报错 |

**Retriever（检索器）**

| 事件 | 触发时机 |
| --- | --- |
| handleRetrieverStart | 检索器开始查询 |
| handleRetrieverEnd | 检索器返回结果 |
| handleRetrieverError | 检索器报错 |

**Agent（代理）**

| 事件 | 触发时机 |
| --- | --- |
| handleAgentAction | Agent 决定执行一个动作（选择了哪个工具、传什么参数） |
| handleAgentEnd | Agent 本轮运行结束 |

你会发现这些事件和前面 TraceContext 的 `span()` 方法做的事是一样的——记录每个操作的输入、输出和状态。区别在于：TraceContext 需要你手动调用，Callbacks 由框架自动触发。

## 3. 用 Callbacks 重新实现 TraceContext 的能力

理解了事件模型以后，我们来做一件直觉上很自然的事：**用 LangChain 的 Callbacks 接口，重新实现一个和前面 TraceContext 等价的追踪器。**

这个练习的目的不是为了实际使用（LangSmith 和 LangFuse 已经帮你做好了），而是让你真正理解 Callbacks 和 TraceContext 的映射关系。

### 3.1 BaseCallbackHandler：所有 handler 的基类

LangChain 提供了 `BaseCallbackHandler` 基类。你只需要继承它，覆盖你关心的事件方法。没有覆盖的事件会被默认忽略。

trace-handler.ts

```typescript
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { Serialized } from '@langchain/core/load/serializable'

// 复用前面定义的 Span 结构
interface Span {
  spanId: string
  name: string
  startTime: number
  duration?: number
  status: 'ok' | 'error' | 'degraded'
  input: Record<string, any>
  output: Record<string, any>
}

class TraceCallbackHandler extends BaseCallbackHandler {
  name = 'TraceCallbackHandler'

  // 和前面的 TraceContext 一样，收集所有 Span
  private spans: Span[] = []
  // runId → Span 的映射，用于在 end 事件里找到对应的 start
  private activeSpans = new Map<string, Span>()

  // --- 模型事件 ---

  handleChatModelStart(
    llm: Serialized,
    messages: any[][],
    runId: string
  ) {
    // 模型开始推理 → 创建一个新 Span
    const span: Span = {
      spanId: runId,
      name: `llm:${llm.id?.at(-1) ?? 'unknown'}`,
      startTime: Date.now(),
      status: 'ok',
      input: { messages },
      output: {},
    }
    this.activeSpans.set(runId, span)
  }

  handleLLMEnd(output: any, runId: string) {
    // 模型推理完成 → 填充 duration 和 output，关闭 Span
    const span = this.activeSpans.get(runId)
    if (span) {
      span.duration = Date.now() - span.startTime
      span.output = {
        text: output.generations?.[0]?.[0]?.text?.slice(0, 200),
        tokenUsage: output.llmOutput?.tokenUsage,
      }
      this.spans.push(span)
      this.activeSpans.delete(runId)
    }
  }

  handleLLMError(error: Error, runId: string) {
    const span = this.activeSpans.get(runId)
    if (span) {
      span.duration = Date.now() - span.startTime
      span.status = 'error'
      span.output = { error: error.message }
      this.spans.push(span)
      this.activeSpans.delete(runId)
    }
  }

  // --- 工具事件 ---

  handleToolStart(tool: Serialized, input: string, runId: string) {
    const span: Span = {
      spanId: runId,
      name: `tool:${tool.id?.at(-1) ?? 'unknown'}`,
      startTime: Date.now(),
      status: 'ok',
      input: { toolInput: input },
      output: {},
    }
    this.activeSpans.set(runId, span)
  }

  handleToolEnd(output: string, runId: string) {
    const span = this.activeSpans.get(runId)
    if (span) {
      span.duration = Date.now() - span.startTime
      span.output = { result: output.slice(0, 200) }
      this.spans.push(span)
      this.activeSpans.delete(runId)
    }
  }

  handleToolError(error: Error, runId: string) {
    const span = this.activeSpans.get(runId)
    if (span) {
      span.duration = Date.now() - span.startTime
      span.status = 'error'
      span.output = { error: error.message }
      this.spans.push(span)
      this.activeSpans.delete(runId)
    }
  }

  // --- 检索器事件 ---

  handleRetrieverStart(
    retriever: Serialized,
    query: string,
    runId: string
  ) {
    const span: Span = {
      spanId: runId,
      name: `retriever:${retriever.id?.at(-1) ?? 'unknown'}`,
      startTime: Date.now(),
      status: 'ok',
      input: { query },
      output: {},
    }
    this.activeSpans.set(runId, span)
  }

  handleRetrieverEnd(documents: any[], runId: string) {
    const span = this.activeSpans.get(runId)
    if (span) {
      span.duration = Date.now() - span.startTime
      span.output = {
        documentCount: documents.length,
        documents: documents.map(d => d.pageContent?.slice(0, 100)),
      }
      // 检索到了但结果为空 → 标记为 degraded
      if (documents.length === 0) {
        span.status = 'degraded'
      }
      this.spans.push(span)
      this.activeSpans.delete(runId)
    }
  }

  handleRetrieverError(error: Error, runId: string) {
    const span = this.activeSpans.get(runId)
    if (span) {
      span.duration = Date.now() - span.startTime
      span.status = 'error'
      span.output = { error: error.message }
      this.spans.push(span)
      this.activeSpans.delete(runId)
    }
  }

  // --- 对外暴露的查询方法 ---

  getSpans(): Span[] {
    return this.spans
  }

  hasError(): boolean {
    return this.spans.some(s => s.status === 'error')
  }

  hasDegraded(): boolean {
    return this.spans.some(s => s.status === 'degraded')
  }

  toJSON() {
    return {
      spanCount: this.spans.length,
      spans: this.spans,
    }
  }
}
```

对比一下前面的 TraceContext：

| 能力 | TraceContext（手动） | TraceCallbackHandler（LangChain） |
| --- | --- | --- |
| 创建 Span | 手动调用 trace.span(name, input, fn) | 框架自动触发 handleXxxStart / handleXxxEnd |
| 记录输入输出 | 手动传入 input，从返回值取 output | 事件参数自动携带 |
| 计算耗时 | span() 方法内部计时 | start 事件记录开始时间，end 事件计算差值 |
| 标记 degraded | 手动调用 trace.markDegraded() | 在 end 事件里根据业务逻辑判断 |
| 错误处理 | span() 的 try/catch | 框架自动触发 handleXxxError |

**核心区别只有一个：谁来触发。** 手动方案需要你在每个节点的调用处包一层，Callbacks 由 LangChain 框架在组件内部自动触发。

### 3.2 怎么把 handler 传给组件

LangChain 支持两个传入位置，作用域不同：

**构造时传入 → 全局生效**

callbacks-constructor.ts

```typescript
import { ChatOpenAI } from '@langchain/openai'

const handler = new TraceCallbackHandler()

// handler 会收到这个 model 实例以及它内部所有子组件的事件
const model = new ChatOpenAI({
  model: 'gpt-4.1-mini',
  callbacks: [handler],
})
```

构造时传入的 handler 会**向下传播**。如果一个 Agent 在构造时带了 handler，那么这个 Agent 内部调用的每个工具、每次模型推理，handler 都会收到事件。这就像前面 TraceContext 被传入整个管线一样。

**调用时传入 → 单次生效**

callbacks-invoke.ts

```typescript
const handler = new TraceCallbackHandler()

const result = await agent.invoke(
  {
    messages: [{ role: 'user', content: '明天上海天气怎么样？' }],
  },
  {
    callbacks: [handler],
  },
)

// 这次调用结束后，handler 里就有了完整的 Span 列表
console.log(handler.toJSON())
```

调用时传入的 handler 只对这一次 `invoke` 生效。适合你只想追踪特定请求的场景——这和前面"每次请求创建一个新的 TraceContext 实例"是一样的思路。

**两种方式可以同时使用。** LangChain 会把构造时和调用时的 handler 合并，所有 handler 都会收到事件。

### 3.3 完整示例：追踪一轮 Agent 运行

agent-with-trace-handler.ts

```typescript
import { createAgent, tool } from 'langchain'
import * as z from 'zod'

const getWeather = tool(
  async ({ city }) => `${city}：明天小雨，17-22 度`,
  {
    name: 'get_weather',
    description: '查询某个城市未来的天气情况',
    schema: z.object({
      city: z.string().describe('要查询天气的城市名'),
    }),
  },
)

const createReminder = tool(
  async ({ content, time }) => `提醒已创建：${time} - ${content}`,
  {
    name: 'create_reminder',
    description: '帮用户创建一个提醒事项',
    schema: z.object({
      content: z.string().describe('提醒内容'),
      time: z.string().describe('提醒时间'),
    }),
  },
)

const sendMessage = tool(
  async ({ text }) => `已发送给用户：${text}`,
  {
    name: 'send_message',
    description: '把一段结果发送给用户',
    schema: z.object({
      text: z.string().describe('要发送的内容'),
    }),
  },
)

const agent = createAgent({
  model: 'openai:gpt-4.1-mini',
  tools: [getWeather, createReminder, sendMessage],
  systemPrompt: '你是用户的生活助理，会在需要时连续调用工具。',
})

// 每次请求创建一个新的 handler 实例（等价于每次请求创建一个新的 TraceContext）
const handler = new TraceCallbackHandler()

const result = await agent.invoke(
  {
    messages: [
      {
        role: 'user',
        content: '帮我看看明天上海天气。如果下雨就提醒我带伞，再把结果顺手发给我。',
      },
    ],
  },
  {
    callbacks: [handler],
  },
)

// 调用结束后，handler 里已经自动收集了所有 Span
const trace = handler.toJSON()
console.log(`共 ${trace.spanCount} 个 Span：`)
trace.spans.forEach(span => {
  console.log(
    `  [${span.status}] ${span.name} - ${span.duration}ms`
  )
})
```

输出大概会是这样：

trace-output.txt

```txt
共 6 个 Span：
  [ok] llm:gpt-4.1-mini - 820ms
  [ok] tool:get_weather - 3ms
  [ok] llm:gpt-4.1-mini - 650ms
  [ok] tool:create_reminder - 2ms
  [ok] tool:send_message - 1ms
  [ok] llm:gpt-4.1-mini - 430ms
```

和前面手动 `trace.span()` 包每个节点相比，这里的代码量少了很多。你不需要在每个工具定义里加埋点，不需要在 Agent 内部改逻辑，只要在调用时传一个 handler 进去，框架就帮你记录了所有过程。

## 4. 接入 LangSmith 和 LangFuse：Callbacks 是统一的对接口

前面工具选型那篇已经详细对比过 LangSmith、LangFuse 和自建方案的适用场景。这里不重复介绍它们的功能差异，只聚焦一个问题：**在 LangChain 体系里，它们是怎么接进来的。**

答案就一句话：**它们都是 `BaseCallbackHandler` 的实现。**

### 4.1 LangSmith：零代码接入

LangSmith 的接入不需要你写任何代码。LangChain 检测到环境变量后，会自动在内部注册一个 LangSmith 的 CallbackHandler。

.env.local

```shellscript
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_pt_xxxxxxxxxxxxxxxx
LANGSMITH_PROJECT=aicompanion-single-agent
```

设好以后，你的 Agent 代码完全不用改。每次 `invoke` 时，LangChain 都会自动把事件发送给 LangSmith 的 handler，后者负责把数据上报到 LangSmith 平台。

这和前面"把 TraceContext 传入管线"的思路是一样的——只是 LangChain 帮你自动做了。

如果你想对个别请求加上 tags 和 metadata（方便在 LangSmith 里筛选），在调用时传入即可：

langsmith-tags.ts

```typescript
const result = await agent.invoke(
  {
    messages: [{ role: 'user', content: '明天上海天气怎么样？' }],
  },
  {
    tags: ['single-agent', 'weather-flow', 'staging'],
    metadata: {
      user_id: 'user_2048',
      session_id: 'session_20260331_01',
    },
  },
)
```

但如果你有自定义函数（不是 LangChain 组件），LangChain 自然无法自动追踪它们。这时候需要用 `traceable` 手动包装——这在工具选型那篇已经讲过：

langsmith-traceable.ts

```typescript
import { traceable } from 'langsmith/traceable'

// 非 LangChain 组件，需要手动包装才能纳入 Trace 链路
const customBusinessLogic = traceable(
  async (input: string) => {
    // 你自己的业务逻辑...
    return result
  },
  { name: 'custom_business_logic', run_type: 'chain' }
)
```

### 4.2 LangFuse：通过 CallbackHandler 对接

LangFuse 的接入方式和我们前面自己实现的 `TraceCallbackHandler` 一模一样——它也是一个 `BaseCallbackHandler` 的子类。

install-langfuse.sh

```shellscript
yarn add @langfuse/langchain
```

.env.local

```shellscript
LANGFUSE_SECRET_KEY=sk-lf-xxxxxxxx
LANGFUSE_PUBLIC_KEY=pk-lf-xxxxxxxx
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

langfuse-callbacks.ts

```typescript
import { CallbackHandler } from '@langfuse/langchain'

const langfuseHandler = new CallbackHandler({
  sessionId: 'session_20260331_01',
  userId: 'user_2048',
  tags: ['single-agent', 'weather-flow'],
})

const result = await agent.invoke(
  {
    messages: [{ role: 'user', content: '明天上海天气怎么样？' }],
  },
  {
    callbacks: [langfuseHandler],
  },
)

// 确保 trace 数据发送完毕（LangFuse 默认异步批量发送）
await langfuseHandler.flushAsync()
```

注意这和前面工具选型篇里的 LangFuse 用法不一样。前面那篇用的是 LangFuse 的**原生 SDK**：

langfuse-native-sdk.ts

```typescript
// 前面的用法：直接用 Langfuse 原生 SDK，手动创建 trace 和 span
const langfuse = new Langfuse({ publicKey: '...', secretKey: '...' })
const trace = langfuse.trace({ name: 'ai-companion-chat' })
const span = trace.span({ name: 'memory_retrieval', input: { query } })
// ... 手动结束 span ...
span.end({ output: { memories } })
```

而在 LangChain 体系里，你用的是 `@langfuse/langchain` 包提供的 **CallbackHandler**：

langfuse-callback-handler.ts

```typescript
// LangChain 里的用法：传入 CallbackHandler，框架自动调用
const handler = new CallbackHandler({ userId: '...' })
await agent.invoke(input, { callbacks: [handler] })
```

**两种方式最终都是把数据发到 LangFuse 平台，区别在于谁来负责埋点。** 原生 SDK 是你自己手动埋，CallbackHandler 是 LangChain 框架自动埋。如果你的管线完全基于 LangChain 组件，用 CallbackHandler 更省事；如果管线里有大量非 LangChain 的自定义逻辑，混用两种方式更灵活。

### 4.3 同时挂多个 handler

Callbacks 是一个数组，你可以同时挂多个 handler。它们都会收到同样的事件，互不干扰。

multiple-handlers.ts

```typescript
import { CallbackHandler as LangFuseHandler } from '@langfuse/langchain'

const traceHandler = new TraceCallbackHandler()  // 自己的追踪器
const langfuseHandler = new LangFuseHandler()    // 发到 LangFuse

const result = await agent.invoke(
  { messages: [{ role: 'user', content: '明天上海天气怎么样？' }] },
  {
    callbacks: [
      traceHandler,      // 本地记录，用于采样决策
      langfuseHandler,   // 发到 LangFuse 平台
      // LangSmith 不用手动加，环境变量开了就自动生效
    ],
  },
)

// 用本地 handler 做采样决策
if (traceHandler.hasError() || traceHandler.hasDegraded()) {
  // 完整写入 D1...
}
```

这个模式特别适合前面讲过的**分层策略**：用自己的 handler 做采样决策和自建存储，同时用 LangFuse 或 LangSmith 做可视化排查。

### 4.4 Serverless 环境的注意事项

在 Cloudflare Workers、AWS Lambda 这类 Serverless 环境中，函数执行完就销毁了。LangChain 默认在后台异步执行 callbacks，可能来不及完成。

解决方法是关掉后台回调：

.env.local

```shellscript
LANGCHAIN_CALLBACKS_BACKGROUND=false
```

设为 `false` 后，callbacks 会同步执行（阻塞主流程）。如果你希望不阻塞响应，结合前面讲过的 `waitUntil` 模式：先同步收集事件到内存中的 handler，然后在 `waitUntil` 里异步刷新到远端平台。

## 5. 在 Callbacks 里实现采样和 degraded 标记

前面采样策略那篇讲了"异常全量保留，正常按比例采样"的思路。在 LangChain 体系里，这个逻辑可以完全用 Callbacks 实现。

### 5.1 用 handler 收集信息，在调用结束后做采样决策

sampling-with-callbacks.ts

```typescript
const handler = new TraceCallbackHandler()

const result = await agent.invoke(
  { messages: [{ role: 'user', content: userMessage }] },
  { callbacks: [handler] },
)

// 调用结束后，handler 里已经有了所有 Span
// 用和前面一样的采样逻辑做决策
const totalDuration = handler.getSpans().reduce(
  (sum, s) => sum + (s.duration ?? 0), 0
)

if (handler.hasError()) {
  // 有错误 → 完整写入 D1
  await storeFullTrace(env, handler.toJSON(), userId, sessionId)
} else if (handler.hasDegraded()) {
  // 有降级 → 完整写入 D1
  await storeFullTrace(env, handler.toJSON(), userId, sessionId)
} else if (totalDuration > 5000) {
  // 异常慢 → 完整写入 D1
  await storeFullTrace(env, handler.toJSON(), userId, sessionId)
} else if (Math.random() < 0.05) {
  // 正常请求 5% 采样
  await storeFullTrace(env, handler.toJSON(), userId, sessionId)
} else {
  // 其余只存摘要
  await storeSummary(env, handler.toJSON())
}
```

### 5.2 在 handler 里自动标记 degraded

前面 TraceContext 有一个 `markDegraded()` 方法需要手动调用。在 Callbacks 体系里，你可以把 degraded 的判断逻辑直接写进 handler 的事件方法里，实现自动标记。

上面 `TraceCallbackHandler` 的 `handleRetrieverEnd` 已经展示了这种做法：

degraded-auto.ts

```typescript
handleRetrieverEnd(documents: any[], runId: string) {
  const span = this.activeSpans.get(runId)
  if (span) {
    span.duration = Date.now() - span.startTime
    span.output = { documentCount: documents.length }

    // 检索结果为空 → 自动标记为 degraded
    if (documents.length === 0) {
      span.status = 'degraded'
    }

    this.spans.push(span)
    this.activeSpans.delete(runId)
  }
}
```

你还可以在 `handleLLMEnd` 里检查 token 用量是否异常高（可能意味着 Prompt 没有被合理裁剪），或者在 `handleToolEnd` 里检查工具返回的数据格式是否符合预期。这些判断逻辑集中在 handler 里，不会侵入业务代码。

## 6. 排错思路：先对比预期步骤和实际 Span

这个思路在前面可观测性那篇讲过，这里把它映射到 LangChain 的 Callbacks 语境里再走一遍。

还是前面那个例子，用户说了三件事。你预期 Agent 应该产生这些 Span：

- `llm:gpt-4.1-mini` → 模型推理，决定先查天气

- `tool:get_weather` → 查天气

- `llm:gpt-4.1-mini` → 模型推理，决定建提醒和发消息

- `tool:create_reminder` → 建提醒

- `tool:send_message` → 发结果

- `llm:gpt-4.1-mini` → 模型推理，生成最终回复

打开 handler 收集到的 Span 列表，按顺序检查：

**如果只有 1 个 `llm` Span，没有任何 `tool` Span：**
模型根本没有产生工具调用意图。问题在 system prompt 或工具描述不够明确。

**如果有 `tool:get_weather` 但没有 `tool:create_reminder`：**
看 `get_weather` 的 output。如果天气结果里没有明确出现"雨"字样，模型可能判断不需要提醒。也可能是 `create_reminder` 的工具描述没有清楚表达它的触发条件。

**如果前面都对但没有 `tool:send_message`：**
看第二次 `llm` Span 的 output。模型可能认为它已经通过自然语言告知了用户，不需要再调 send_message。这时候要调整的是 system prompt 或工具描述。

**如果某个 `tool` Span 的 status 是 `error`：**
直接看该 Span 的 output.error 字段，问题原因一般一目了然。

**如果某个 `retriever` Span 的 status 是 `degraded`：**
说明检索到了但结果为空，可能是向量索引没有更新，或者查询理解偏了。

这套排查方式和前面完全一致。唯一的区别是：前面你要手动 `trace.span()` 才能看到这些信息，现在 LangChain 的 Callbacks 自动帮你收集了。

## 7. 总结

如果你的管线完全基于 LangChain 组件，Callbacks 就足够了，不需要再手动写 TraceContext

如果管线里有大量非 LangChain 的自定义逻辑，两种方式混用是最务实的选择
