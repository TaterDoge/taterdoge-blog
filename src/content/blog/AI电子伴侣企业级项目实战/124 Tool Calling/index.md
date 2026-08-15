---
title: "124 Tool Calling"
pubDate: 2026-05-20
description: "LLM 只会「说话」，它没法真的去查数据库、调 API、发邮件。但我们希望 LLM 能变成一个会行动的 Agent。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/9-tool-calling/](https://aicompanion.usehook.cn/9-tool-calling/)

## 1. Tool Calling 解决什么问题

LLM 只会「说话」，它没法真的去查数据库、调 API、发邮件。但我们希望 LLM 能变成一个会行动的 Agent。

Tool Calling 就是这座桥：

- 我们把可用的函数（tool）描述给 LLM

- LLM 在需要时，返回「我要调 `foo`，参数是 `{...}`」

- 我们的代码执行 `foo`，把结果返回给 LLM

- LLM 基于结果继续生成回复

[Tool 定义](/16-tool-function-calling) 我们用 `bindTools` 做过这件事。AI SDK 的 `tool()` 函数做的是同一件事，但 API 更贴 TypeScript 开发者的习惯。

## 2. 定义一个 tool

最小例子：

simple-tool.ts

```typescript
import { tool } from 'ai'
import { z } from 'zod'

const getWeather = tool({
  description: '获取指定城市的天气',
  inputSchema: z.object({
    city: z.string().describe('城市名，中英文都可以'),
    unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  }),
  execute: async ({ city, unit }) => {
    const resp = await fetch(`https://weather.api/${city}?unit=${unit}`)
    return await resp.json()  // { temp: 22, condition: 'sunny' }
  },
})
```

三个关键字段：

- `description`：告诉 LLM 这个工具是干嘛的。一句话越具体越好，LLM 决定要不要调就是看这一句

- `inputSchema`：用 Zod schema 定义参数，会被翻译成 JSON Schema 喂给 LLM

- `execute`：真正的执行逻辑。async 函数，接收的参数已经校验过

把 tool 塞给 `streamText`：

use-tool.ts

```typescript
const result = streamText({
  model: models.chat,
  messages: [{ role: 'user', content: '帮我查一下北京的天气' }],
  tools: { getWeather },
})

for await (const part of result.fullStream) {
  if (part.type === 'tool-call') {
    console.log('LLM 决定调', part.toolName, part.input)
  }
  if (part.type === 'tool-result') {
    console.log('执行结果', part.output)
  }
}
```

注意 `tools` 是一个对象（`Record<string, Tool>`），key 就是工具名。LLM 在响应里返回的 `toolName` 就是这个 key。

## 3. 多工具：一次给 LLM 一个工具箱

真实项目里工具很少只有一个。看一个 AI 伴侣的例子：

companion-tools.ts

```typescript
import { tool } from 'ai'
import { z } from 'zod'
import type { Env } from './env'

export function createCompanionTools(env: Env, sessionId: string) {
  return {
    searchMemory: tool({
      description: '从长期记忆库里检索与当前对话相关的回忆',
      inputSchema: z.object({
        query: z.string().describe('检索关键词，可以是一句话'),
        topK: z.number().int().min(1).max(10).default(3),
      }),
      execute: async ({ query, topK }) => {
        const embedding = await embedText(env, query)
        const results = await env.VECTORIZE.query(embedding, {
          topK,
          filter: { sessionId },
          returnMetadata: true,
        })
        return results.matches.map((m) => ({
          content: m.metadata.content,
          relevance: m.score,
        }))
      },
    }),

    updateEmotion: tool({
      description: '记录用户当前的情绪状态到数据库',
      inputSchema: z.object({
        emotion: z.enum(['happy', 'sad', 'angry', 'calm', 'neutral']),
        intensity: z.number().min(0).max(1),
      }),
      execute: async ({ emotion, intensity }) => {
        await env.DB.prepare(
          'INSERT INTO emotion_logs (session_id, emotion, intensity, created_at) VALUES (?,?,?,?)',
        ).bind(sessionId, emotion, intensity, Date.now()).run()
        return { success: true }
      },
    }),

    checkIntimacy: tool({
      description: '查询当前会话的亲密度分值',
      inputSchema: z.object({}),
      execute: async () => {
        const row = await env.DB.prepare(
          'SELECT intimacy FROM sessions WHERE id = ?',
        ).bind(sessionId).first()
        return { intimacy: row?.intimacy ?? 0 }
      },
    }),
  }
}
```

这里有几个设计点值得注意：

- 工厂函数模式：`createCompanionTools` 接收 env 和 sessionId，返回一组工具。这样每次请求都能拿到新鲜的 tools，共享同一个执行上下文

- 无参工具也要 `z.object({})`：不能写 `z.null()` 或省略 `inputSchema`，协议要求 schema 必须是 object

- 每个工具的 execute 都是独立 async 函数，可以自由返回任意可 JSON 序列化的值

使用方：

use-companion-tools.ts

```typescript
app.post('/chat', async (c) => {
  const { messages } = await c.req.json()
  const sessionId = c.req.header('x-session-id')!

  const result = streamText({
    model: models.chat,
    messages: convertToModelMessages(messages),
    tools: createCompanionTools(c.env, sessionId),
    stopWhen: stepCountIs(5),
  })

  return result.toUIMessageStreamResponse()
})
```

## 4. toolChoice：控制 LLM 的选择

默认 `toolChoice: 'auto'`，LLM 自己决定要不要调工具、调哪个。总共四个选项：

| 值 | 行为 |
| --- | --- |
| 'auto' | 默认。LLM 自主决定，可能不调、可能调一个、可能调多个 |
| 'required' | 必须调至少一个工具。用于「强制 Agent 动作」的场景 |
| 'none' | 本次禁用所有工具。用于「禁止工具，纯对话回复」 |
| { type: 'tool', toolName: 'xxx' } | 必须调指定的这个工具 |

典型用法：

tool-choice.ts

```typescript
// 第一步：强制模型调情绪分类器
const step1 = await generateText({
  model: models.chat,
  messages,
  tools: { classifyEmotion },
  toolChoice: { type: 'tool', toolName: 'classifyEmotion' },
})

// 第二步：禁用工具，生成最终回复
const step2 = streamText({
  model: models.chat,
  messages: [...messages, step1.response.messages],
  tools: companionTools,
  toolChoice: 'none',
})
```

这种「先强制结构化、再生成回复」的模式在 AI 伴侣里很常见，相当于手动拼出一条多 step 管线。不过更常见的做法是用 Agent 循环（下一篇讲），让 LLM 自己走完。

## 5. 省略 execute：手动执行

`execute` 字段是可选的。不传的话，AI SDK 只返回 tool-call（参数已经决定），但不会执行：

no-execute.ts

```typescript
const tools = {
  dangerousAction: tool({
    description: '执行一个有副作用的操作，需要用户确认',
    inputSchema: z.object({
      action: z.enum(['delete', 'notify']),
      target: z.string(),
    }),
    // 不传 execute
  }),
}

const result = await generateText({ model, messages, tools })

for (const toolCall of result.toolCalls) {
  // 把这个 call 发给前端，让用户点确认后再真正执行
  await sendApprovalRequest(toolCall)
}
```

这就是 **Human-in-the-Loop（HITL）**的基础模式：前端展示待确认的工具调用，用户点同意后，把 tool-result 回传给后端，后端再把结果塞进消息继续对话。

完整的 HITL 实现需要配合 Agent 循环和消息持久化，[Human-in-the-Loop](/10-human-in-the-loop) 里有完整方案。[与 LangChain 协同](/20-langchain-integration) 会讨论怎么把 AI SDK 和 LangGraph 的 HITL 模式结合起来。

## 6. 流式参数与并行执行

上一篇的 UIMessageStream 里提到过 `tool-input-start` / `tool-input-delta`，它们的意义是：工具参数本身也是流式构造的。

LLM 生成工具参数时，是逐 token 的：

tool-streaming.txt

```text
tool-input-start: toolCallId=c_1, toolName=searchMemory
tool-input-delta: inputTextDelta={"query":"
tool-input-delta: inputTextDelta=上周
tool-input-delta: inputTextDelta=五的
tool-input-delta: inputTextDelta=难过
tool-input-delta: inputTextDelta="}
tool-input-available: input={"query": "上周五的难过"}
```

前端可以在参数构造的过程中就显示「正在准备搜索『上周五的难过』…」，反馈感会更强。[UI Message Parts](/12-ui-message-parts) 会展示怎么渲染这些中间态。

除了流式参数，一次 step 里 LLM 还可能一口气调多个工具（parallel tool calls）：

parallel.json

```json
[
  { "toolName": "searchMemory", "input": {"query": "周末"} },
  { "toolName": "checkIntimacy", "input": {} }
]
```

AI SDK 会并行执行这组工具，全部完成后把所有结果一起塞回去给 LLM。比串行快很多。

如果你想强制顺序（比如第二个工具依赖第一个的结果），有两种办法：

- 在 prompt 里引导（不强约束）：「先调 `searchMemory` 拿到结果后，再决定要不要调 `updateEmotion`」

- 分成两次 step：第一次只开放 `searchMemory`，第二次再开放完整工具集，用 `toolChoice` 控制

大部分场景并行调用是安全的，工具之间互不依赖。

## 7. 错误处理

工具执行可能失败。AI SDK 不会让单个工具失败就崩掉整个流——它会把错误作为 tool-result 的 error 传回给 LLM：

tool-error.ts

```typescript
const searchMemory = tool({
  description: '...',
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    try {
      return await realSearch(query)
    } catch (err) {
      // 抛错会被 SDK 捕获，作为 error 传回 LLM
      throw new Error(`搜索失败：${(err as Error).message}`)
    }
  },
})
```

LLM 拿到错误信息后，通常会告诉用户工具出了问题，然后尝试用不同参数重新调，或者用其他工具绕过。

如果你想完全吞掉错误、对 LLM 装作什么都没发生，在 execute 里 catch 住返回空结果也行。但这很容易掩盖 bug，不推荐。

自定义错误类型：

custom-error.ts

```typescript
import { ToolExecutionError } from 'ai'

try {
  const result = await streamText({ tools, ... })
} catch (err) {
  if (ToolExecutionError.isInstance(err)) {
    console.log('工具名：', err.toolName)
    console.log('参数：', err.input)
    console.log('原始错误：', err.cause)
  }
}
```

### 和 LangChain tool 的对比

[与 LangChain 协同](/20-langchain-integration) 会展开协同，这里先做一次 API 对照：

| 维度 | LangChain tool() | AI SDK tool() |
| --- | --- | --- |
| 参数 schema | 支持 Zod 或 JSON Schema | Zod（AI SDK v5 起强制） |
| 执行函数签名 | async (input) => any | async (input) => any |
| 绑定到模型 | model.bindTools([tools]) | streamText({ tools }) |
| 无 execute 模式 | 需要 AgentExecutor 配合 HITL | 直接省略 execute 字段 |
| Streaming 参数 | 不暴露流式参数构造 | 暴露 tool-input-delta |
| Tool 内部使用 agent | 天然支持（tool 内可以调 Chain） | 需要手动组合 |
| 工具目录 / Registry | LangChain Hub（较重） | 无，手写工厂函数 |

如果你已经熟 LangChain 的 tool，切到 AI SDK 几乎不用重新学。API 风格更简洁，schema 更严格，但核心概念完全一致。

## 8. 小结

- `tool()` 三件套：`description` 指导 LLM、`inputSchema`（Zod）、`execute` 异步执行

- 用工厂函数模式组织多工具，传入 env 和 session 上下文

- `toolChoice` 控制 LLM：`'auto'` / `'required'` / `'none'` / 指定 toolName

- 省略 `execute` 进入 HITL 模式，前端确认后再执行

- 参数流式构造：`tool-input-start` / `tool-input-delta` 让 UI 能显示中间态

- 并行工具调用默认开启，要顺序就拆成多个 step

- 错误通过抛错传回 LLM，让它自然恢复

下一篇进入**多步推理：`stopWhen` 与 Agent 循环**——在单个 `streamText` 调用里自动让 LLM 执行 → 观察 → 再决策，直到任务完成。
