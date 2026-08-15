---
title: "17 LangSmith vs Langfuse"
pubDate: 2026-04-17
description: "上一篇我们讲清楚了可观测性的核心概念——Trace、Span、degraded 状态。但如果你真的要落地，第一反应通常会是：有没有现成的工具或平台可以直接用？"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/14b-tracing-tools-comparison/](https://aicompanion.usehook.cn/14b-tracing-tools-comparison/)

上一篇我们讲清楚了可观测性的核心概念——Trace、Span、degraded 状态。但如果你真的要落地，第一反应通常会是：**有没有现成的工具或平台可以直接用？**

答案是有的。最常被提到的两个名字，是 **LangSmith** 和 **Langfuse**。再往后走一步，你就会发现第三个思路同样重要：**自建 Tracing**

这三种方案都能做"AI 系统可观测性"，但它们解决问题的重心并不一样：

- **LangSmith** 更偏向 LangChain / LangGraph 生态里的开发调试与评估

- **Langfuse** 更偏向开源、自托管、多框架接入的 LLM observability 平台

- **自建方案** 更偏向完全掌控数据结构、采样策略、存储成本与线上治理

如果不把这三者拆开看，就很容易出现一种常见误判："它们不都是记录 Trace 吗，差别应该不大。"实际上，差别非常大。差别不只在功能，而在于它们分别站在哪个工程阶段、哪种组织约束、哪类数据治理要求上思考问题。

## 1. LangSmith：最强的是开发调试闭环

**LangSmith 是什么？** 它是 LangChain 团队（开发 LangChain / LangGraph 框架的公司）推出的一个 SaaS 平台，专门用于 LLM 和 Agent 应用的调试、观测与评估。你可以把它理解成一个"AI 应用专用的 DevTools"。

如果你已经在用 LangChain 或 LangGraph 来构建 AI 应用，那么 LangSmith 的接入体验会非常顺手——只需要设置几个环境变量，你的应用就会自动把 Trace 数据上报到 LangSmith 平台：

langsmith-env.ts

```typescript
// 第一步：设置环境变量，LangChain 组件自动上报 Trace
// LANGCHAIN_TRACING_V2=true
// LANGCHAIN_API_KEY=ls_xxx
// LANGCHAIN_PROJECT=ai-companion-prod
```

如果你的管线里有自定义函数（不是 LangChain 组件），可以用 `traceable` 包装，让它也纳入 Trace 链路：

langsmith-traceable.ts

```typescript
import { traceable } from 'langsmith/traceable'
import { ChatOpenAI } from '@langchain/openai'

// 用 traceable 包装自定义函数，自动记录输入、输出和耗时
const retrieveMemories = traceable(
  async (query: string) => {
    const results = await vectorStore.similaritySearch(query, 5)
    return results
  },
  { name: 'memory_retrieval', run_type: 'retriever' }
)

// LangChain 的 ChatModel 天然支持，无需包装
const model = new ChatOpenAI({ modelName: 'gpt-4o' })

// 整条管线的每一步都会自动出现在 LangSmith 的 Trace 面板里
const memories = await retrieveMemories('我养过什么宠物？')
const response = await model.invoke([
  { role: 'system', content: buildPrompt(memories) },
  { role: 'user', content: '我养过什么宠物？' }
])
```

设置完成后，你在 LangSmith 的 Web 界面上就能看到：

- 一次请求的完整调用链（每个节点做了什么、花了多久）

- 每一步 Prompt 的输入与输出（包括最终传给模型的完整文本）

- 模型调用参数、耗时、Token 消耗

- 工具调用、检索命中、链路分支与中间结果

- 多次实验之间的效果对比（比如两个 Prompt 版本谁更稳定）

也就是说，LangSmith 不只是"日志平台"，它更像是 AI 应用的**调用链追踪 + Prompt 调试台 + 实验记录台**三合一。

它天然能回答这些问题：

- 这次回答为什么跑偏了，是检索没命中，还是 Prompt 约束失效？

- 同一个问题多跑几次，哪一个版本的 Prompt 更稳定？

- 哪个工具调用最慢，哪一步最容易失败？

- 这次回复引用了哪些上下文，真正传给模型的输入到底是什么？

这些能力对 AI 开发非常关键，因为 AI 问题往往不是"有没有抛异常"，而是"为什么它这次答得比上次差"。LangSmith 的强项，正好就是帮助你分析这种"结果质量问题"。

如果一句话概括：LangSmith 的最大优势不是"存 Trace"，而是"**把 Agent 调试体验做得非常完整**"。

## 2. Langfuse：平台化、可自控的 observability 基座

**Langfuse 是什么？** 它是一个开源的 LLM observability 平台，和 LangSmith 解决的是同一类问题，但气质不太一样。如果说 LangSmith 更像"LangChain 生态的官方 DevTools"，那 Langfuse 更像"一套通用的、你可以自己部署的 LLM 观测基础设施"。

Langfuse 通常更强调：

- **开源与可扩展**：代码开源，你可以阅读、修改、贡献

- **自托管能力**：可以部署在自己的服务器上，数据不出自己的网络

- **多语言、多框架接入**：不强绑定 LangChain，提供 Python/JS SDK，也可以用 REST API 手动上报

- **统一记录多种对象**：Trace、Score、Session、Prompt、Eval 等

如果你的系统不是完全围绕 LangChain / LangGraph 构建，而是自己写编排逻辑、自己拼检索链路、自己接多个模型供应商，那么 Langfuse 往往会更自然一些。下面是一个接入示例：

langfuse.ts

```typescript
import { Langfuse } from 'langfuse'

// 初始化 Langfuse 客户端
const langfuse = new Langfuse({
  publicKey: 'pk-xxx',
  secretKey: 'sk-xxx',
  baseUrl: 'https://your-langfuse-instance.com' // 可以指向自托管实例
})

// 创建一个 Trace（对应一次用户请求）
const trace = langfuse.trace({
  name: 'ai-companion-chat',
  userId: 'user_123',
  sessionId: 'session_456',
  metadata: { version: '1.2.0' }
})

// 在 Trace 下创建 Span（对应一个管线节点）
const retrievalSpan = trace.span({
  name: 'memory_retrieval',
  input: { query: '我养过什么宠物？' }
})

// ... 执行实际的记忆检索逻辑 ...

// 结束 Span，记录输出
retrievalSpan.end({
  output: { memories: ['用户养了一只猫'], hitCount: 1 }
})
```

Langfuse 的典型优势体现在：

- 不强依赖某一个特定 Agent 框架

- 更适合做跨服务、跨语言的统一埋点

- 数据归属和部署形态更灵活（特别是自托管场景）

- 对"线上持续观测"这件事的产品心智更强

换句话说，LangSmith 更像是"帮你把 Agent 调试明白"，Langfuse 更像是"帮你把 LLM 系统观测体系搭起来"。

## 3. 三者最核心的区别，不在 UI，而在控制权

真正决定你该选谁的，不是界面好不好看，而是下面四个问题：

- **你的系统是不是深度依赖 LangChain / LangGraph？** 如果是，LangSmith 的集成体验最好

- **你对用户数据主权有没有强要求？** 如果有，需要考虑自托管方案（Langfuse 或自建）

- **你要解决的是开发调试，还是生产全量观测？** 前者选平台工具更高效，后者需要考虑成本和控制权

- **你愿不愿意自己承担埋点协议、存储设计、采样和治理成本？** 自建的前提是你有足够的工程投入

把这四个问题想清楚，再看三者差异就会非常清楚：

| 维度 | LangSmith | Langfuse | 自建 Tracing |
| --- | --- | --- | --- |
| 核心定位 | LangChain / LangGraph 生态里的调试、评估、实验平台 | 通用 LLM observability 平台，强调开源与平台化 | 完全按业务需求定制的追踪与诊断系统 |
| 上手速度 | 很快，尤其是已使用 LangChain / LangGraph 时 | 较快，但通常需要更明确地设计接入方式 | 最慢，需要自己定义协议、SDK、存储和查询 |
| 生态耦合 | 对 LangChain 生态最友好 | 更偏框架无关 | 完全框架无关 |
| 调试体验 | 很强，适合看链路细节、Prompt、实验对比 | 也能调试，但产品重心更偏平台化观测 | 取决于你自己做多少 UI 和工具能力 |
| Prompt / Eval 能力 | 很强，适合开发阶段反复试验 | 也支持，但团队常把它更多用于统一观测与分析 | 需要自己建设 |
| 数据控制权 | 中等，通常需要接受平台的产品边界 | 更高，尤其在自托管场景下 | 最高，所有结构和保留策略都自己定义 |
| 自托管弹性 | 提供企业版自托管，但门槛较高 | 明显更强，是很多团队选择它的重要原因 | 天然就是自托管 |
| 成本可预测性 | 中等，随调用量上升可能放大 | 中高，取决于部署方式与采样策略 | 最高，但前提是你能做好系统设计 |
| 生产全量追踪 | 可以做，但要仔细评估成本与数据边界 | 更适合承担长期观测基座角色 | 最适合高敏感、高规模、强定制场景 |
| 最适合谁 | 已经深度使用 LangChain / LangGraph 的团队 | 想要开源、自控、多框架兼容的团队 | 对数据、成本、架构控制要求极高的团队 |

## 4. 为什么在边缘架构里，不建议把第三方平台当作生产主账本

无论是 LangSmith 还是 Langfuse，只要你把它们当作"生产全量主账本"（即所有线上请求的 Trace 都往那里写），在我们的边缘架构里都会遇到同一类现实问题：

**第一，边缘环境额外延迟。** 我们的应用跑在 Cloudflare Workers 上，每次上报 Trace 到第三方平台都是一次额外的网络请求。哪怕你把上报操作放进 `waitUntil`（一种让后台任务不阻塞响应的机制，后续文章会详细讲），也要考虑 Workers 的执行时限和网络稳定性。

**第二，数据主权。** Trace 里往往包含用户消息原文、记忆内容、情绪标签。这些信息天然敏感，把它们全量发送到第三方平台需要额外的合规评估。

**第三，成本。** 一条完整的 Trace 可能包含十几个 Span，每个 Span 还有 input/output 数据。一旦请求量起来（比如每天 10 万次对话），Trace 平台的计费会非常快地放大。

**第四，字段模型未必贴合你的业务。** 第三方平台的 Trace 抽象通常是通用的（适用于所有 LLM 应用），但 AI 伴侣系统里真正关键的字段，可能是 `memoryHitRate`（记忆命中率）、`fallbackReason`（降级原因）、`emotionRoute`（情绪路由路径）、`personaVersion`（人设版本号）、`safetyPolicyVersion`（安全策略版本号）。这些字段你当然可以塞进 metadata，但一旦要做强约束查询、长期分析和跨版本统计，自建结构往往会更顺手。

这就是为什么第三方平台非常适合"帮助你理解问题"，却不一定适合"承接你全部线上观测治理"。

那自建方案到底长什么样？这里给一个最简化的框架，让你对它有个直觉（下一篇会展开完整实现）：

custom-tracing.ts

```typescript
// 自建 Tracing 的核心数据结构
interface SpanRecord {
  spanId: string
  name: string
  startTime: number
  duration?: number
  status: 'ok' | 'error' | 'degraded'
  input?: unknown
  output?: unknown
  metadata?: Record<string, unknown>
  children: SpanRecord[]
}

interface TraceRecord {
  traceId: string
  userId: string
  sessionId: string
  rootSpan: SpanRecord
  // 业务专属字段——这些在第三方平台里只能塞 metadata
  memoryHitRate: number
  fallbackReason?: string
  emotionRoute: string
  personaVersion: string
}

// 在 Cloudflare Workers 中持久化 Trace
async function persistTrace(trace: TraceRecord, env: Env) {
  // 全量数据写入 D1（支持 SQL 查询和长期分析）
  await env.DB.prepare(
    'INSERT INTO traces (trace_id, user_id, data, created_at) VALUES (?, ?, ?, ?)'
  ).bind(trace.traceId, trace.userId, JSON.stringify(trace), Date.now()).run()

  // 摘要写入 KV（快速查看最近的 Trace 列表）
  await env.KV.put(
    `trace:recent:${trace.traceId}`,
    JSON.stringify({
      traceId: trace.traceId,
      duration: trace.rootSpan.duration,
      memoryHitRate: trace.memoryHitRate,
      fallbackReason: trace.fallbackReason
    }),
    { expirationTtl: 86400 * 7 }
  )
}
```

注意这段代码里的 `memoryHitRate`、`fallbackReason`、`emotionRoute` 这些字段——它们是 AI 伴侣的业务核心指标，在自建方案里是一等公民，直接写在类型定义里。而在 LangSmith 或 Langfuse 中，它们只能被塞进 metadata 字典，查询和聚合都不方便。

## 5. 更务实的分工方式

因此，如果让我给这三者下一个最务实的分工建议，会是下面这样：

- **LangSmith**：最适合开发与测试阶段做深度调试、Prompt 试验、Agent 行为分析

- **Langfuse**：最适合想要较强平台能力，同时又希望保留更高部署与数据控制权的团队

- **自建 Tracing**：最适合承担生产环境的全量追踪、审计归档、成本治理与业务化指标体系

把它们放到同一套系统里时，比较合理的使用方式通常是：

| 场景 | 优先方案 | 原因 |
| --- | --- | --- |
| 开发环境调试 Agent | LangSmith | 调试闭环最完整，尤其适合 LangGraph |
| 多团队共享 LLM 观测平台 | Langfuse | 平台化、自托管、多框架接入更自然 |
| 生产环境全量请求归档 | 自建 Tracing | 成本、数据、结构完全可控 |
| 线上复杂问题专项排查 | 按需采样到 LangSmith 或 Langfuse | 借助成熟可视化能力快速定位 |
| 高敏感用户消息场景 | 自建优先 | 降低外部传输与治理复杂度 |

如果你的团队只能先做一个选择，我会这样建议：

- **已经深度使用 LangChain / LangGraph**：先上 LangSmith，快速把调试能力建立起来

- **技术栈比较分散，且重视自托管**：优先评估 Langfuse

- **从第一天就知道自己对数据主权、成本和边缘部署要求很高**：直接自建，不要晚一点再被迫迁移

## 6. 总结

这一篇的核心目标是帮你在 LangSmith、Langfuse 和自建 Tracing 三条路之间做出清晰判断。

回顾关键结论：

- **LangSmith** 的最大优势是开发调试闭环——Agent 链路追踪、Prompt 实验对比、结果质量分析，在 LangChain / LangGraph 生态里体验最完整

- **Langfuse** 更适合作为平台化观测基座——开源、自托管、多框架接入，适合需要统一观测体系的团队

- **自建 Tracing** 在数据控制权、成本可预测性和业务字段定制上最强，但前期工程投入也最大

- **在边缘架构里**，第三方平台不适合当生产全量主账本——延迟、数据主权、成本、字段贴合度都是现实约束

- **最务实的做法**是分层使用：开发调试用平台工具，生产全量追踪自建，线上排查按需采样到平台

下一篇我们直接进入 Workers 环境下的 Tracing 落地：`TraceContext` 怎么设计、采样怎么做、D1 和 KV 怎么分层存储。
