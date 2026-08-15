---
title: "243 多 Agent"
pubDate: 2026-08-12
description: "天气 Agent 只适合回答天气相关建议，但「我明天出门要带什么？」还涉及个人习惯和同行人的需求。如果继续给天气 Agent 增加状态读取、记忆检索和最终清单职责，它会重新变成一个知道所有事情的巨大 。"
tags: [AI编程, 学习心法]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-12
---
原文链接：[https://aicompanion.usehook.cn/9supervisor-multi-agent/](https://aicompanion.usehook.cn/9supervisor-multi-agent/)

1. 多 Agent 演变
天气 Agent 只适合回答天气相关建议，但「我明天出门要带什么？」还涉及个人习惯和同行人的需求。如果继续给天气 Agent 增加状态读取、记忆检索和最终清单职责，它会重新变成一个知道所有事情的巨大 Agent，上一篇建立的上下文隔离也会消失。
更合适的做法是让三个领域 Agent 分工：
Agent独立上下文可使用的能力明确不负责天气 Agent用户问题、天气工具结果生产级天气子图习惯与陪同人习惯 Agent用户问题、当前 Agent 状态读取本次运行状态天气与长期记忆陪同人 Agent用户问题、记忆检索结果读取长期记忆天气与个人习惯
它们都只返回领域结论，再由一个 Supervisor 对最终结果负责。
2. Supervisor
Supervisor 的职责是理解总目标、选择合适的子 Agent、准备委派任务、等待结果并解决重复或冲突。它不应该绕过天气 Agent 自己查天气，也不应该凭空补写记忆。
图中的每个子 Agent 都有自己的模型消息和工具范围。Supervisor 只接收它们最后返回的领域答案，因此天气子图里的坐标、重试和供应商错误不会占用主 Agent 的上下文。
3. 工具
在 Supervisor 模式中，子 Agent 常被包装成工具。工具描述告诉 Supervisor 什么时候应该委派，工具函数内部才真正调用对应 Agent。
specialists.ts1const weatherAgentTool = tool(
2  ({ task }) => runWeatherSubagent(task),
3  {
4    name: 'ask_weather_agent',
5    description: '委派天气 Agent 查询可靠天气并给出携带建议',
6    schema: z.object({ task: z.string() }),
7  },
1)

习惯 Agent 从当前 AgentState 读取习惯，陪同人 Agent 从长期记忆检索结果中工作。它们的工具输入都只有 task，具体数据由各自边界注入，而不是让 Supervisor 把整个全局状态复制给所有 Agent。
4. 并行委派
本案例要求 Supervisor 在同一轮调用三个工具。LangChain Agent 的 v1 工具节点会并发执行同一条模型消息中的多个工具调用，因此天气、习惯和陪同人三条支线可以同时工作。
supervisor.ts1const supervisor = createAgent({
2  name: 'packing_supervisor',
3  model,
4  tools: [weatherAgentTool, habitAgentTool, companionAgentTool],
5  version: 'v1',
6  systemPrompt: '同一轮调用三个领域 Agent，结果返回后合并清单。',
7})
并行只解决等待时间，不解决意见冲突。假设天气 Agent 建议带保温杯，习惯 Agent 也建议带水杯，Supervisor 需要合并重复项；如果一个 Agent 建议轻装，另一个要求携带药品，Supervisor 应把安全相关建议放在更高优先级，而不是随意删掉其中一个。
5. 案例这个演示不会读取上一篇保存的快照。每次发送「我明天出门要带什么？」，Supervisor 都从原始消息重新拆分任务；天气 Agent 会从定位节点重新运行生产级天气子图，习惯 Agent 读取当前运行状态，陪同人 Agent 模拟检索长期记忆。状态面板让用户感知当前是哪几个 Agent 在工作。聊天回复不会输出工具结果或中间步骤，只在三个 Agent 都完成后逐字显示 Supervisor 合并的最终清单。
Supervisor 多 Agent 运行轨迹0 / 5 个步骤完成等待用户消息Supervisor任务分派天气 Agent天气子图习惯 AgentAgent 状态陪同人 Agent长期记忆汇总回答Supervisor
多 Agent 出门助手Supervisor 分派三个领域 Agent，最终只回复合并后的清单发送原始问题，观察多 Agent 如何从 0 开始协作
supervisor.tsspecialists.tsstatus.tschat.tsx001import { createAgent } from 'langchain'
002
003import { createSubagentModel } from '../../8weather-subagent/demo/model'
004import { createSpecialistTools } from './specialists'
005import type { SupervisorStepEvent } from './status'
006
007interface RunSupervisorOptions {
008  onStepEvent: (event: SupervisorStepEvent) => void
009  abortSignal?: AbortSignal
010}
011
012export async function runSupervisor(
013  input: string,
014  { onStepEvent, abortSignal }: RunSupervisorOptions,
015) {
016  const startedAt = Date.now()
017  onStepEvent({
018    stepId: 'supervisor',
019    phase: 'running',
020    message: '正在识别出门目标并拆分领域任务',
021  })
022
023  const model = await createSubagentModel()
024  const startedSpecialists = new Set<string>()
025  let synthesisStartedAt = 0
026  const { tools, getCompletedCount } = createSpecialistTools({
027    model,
028    onStepEvent,
029    abortSignal,
030    onDelegationStarted: (stepId) => {
031      startedSpecialists.add(stepId)
032      if (startedSpecialists.size !== 3) return
033      onStepEvent({
034        stepId: 'supervisor',
035        phase: 'success',
036        message: '已选择天气、习惯和陪同人三个子 Agent',
037        durationMs: Date.now() - startedAt,
038      })
039    },
040    onAllSpecialistsComplete: () => {
041      synthesisStartedAt = Date.now()
042      onStepEvent({
043        stepId: 'synthesis',
044        phase: 'running',
045        message: '三个领域结果已返回，正在生成最终清单',
046      })
047    },
048  })
049  const supervisor = createAgent({
050    name: 'packing_supervisor',
051    description: '负责把出门问题分派给领域 Agent，并汇总为最终清单',
052    model,
053    tools,
054    version: 'v1',
055    systemPrompt: [
056      '你是出门清单 Supervisor。',
057      '收到用户问题后，必须在同一轮同时调用 ask_weather_agent、ask_habit_agent 和 ask_companion_agent。',
058      '不要替子 Agent 猜测结果，也不要省略任何一个 Agent。',
059      '三个结果全部返回后，合并重复项，输出一份简洁的中文清单。',
060      '最终回答只面向用户，不暴露工具调用、内部状态或思考过程。',
061    ].join('\n'),
062  })
063
064  const result = await supervisor.invoke({
065    messages: [{ role: 'user', content: input }],
066  }, { signal: abortSignal })
067
068  if (getCompletedCount() !== 3) {
069    onStepEvent({
070      stepId: 'supervisor',
071      phase: 'error',
072      message: 'Supervisor 没有完成三个领域任务的委派',
073    })
074    throw new Error('Supervisor 没有同时调用天气、习惯和陪同人三个子 Agent，请重试')
075  }
076
077  const content = readLastAssistantText(result.messages)
078  if (!content) throw new Error('Supervisor 没有返回可展示的最终答案')
079  onStepEvent({
080    stepId: 'synthesis',
081    phase: 'success',
082    message: '最终清单已生成',
083    durationMs: synthesisStartedAt ? Date.now() - synthesisStartedAt : undefined,
084  })
085
086  return content
087}
088
089function readLastAssistantText(messages: readonly unknown[]) {
090  const message = messages.at(-1)
091  if (!message || typeof message !== 'object' || !('content' in message)) return ''
092  if (typeof message.content === 'string') return message.content
093  if (!Array.isArray(message.content)) return ''
094
095  return message.content.map((part) => {
096    if (typeof part === 'string') return part
097    if (
098      part
099      && typeof part === 'object'
100      && 'text' in part
101      && typeof part.text === 'string'
102    ) return part.text
103    return ''
104  }).filter(Boolean).join('\n')
105}
1066. 多 Agent单 Agent 的主要不确定性是「会不会正确调用工具」，多 Agent 还要面对委派是否完整、子 Agent 是否重复工作、并发失败如何降级、结果是否冲突，以及一次用户请求会触发多少次模型调用。可以把总体可靠性粗略理解为多条链路共同决定，而不是增加 Agent 数量就一定更聪明。如果三个子 Agent 各自都有失败概率，Supervisor 本身也可能分派错误，系统整体失败面会扩大。因此多 Agent 应该用于真正存在专业边界、上下文隔离或并行收益的任务，而不是为了架构看起来高级。可观测性也必须从「节点执行了多久」升级到「Supervisor 委派了什么任务、调用了哪个 Agent、子 Agent 使用了哪些工具、最终采用了哪条证据」。案例的状态面板只展示用户可理解的阶段，生产环境还需要保存结构化 trace、Token 消耗和错误分类。
7. 总结最近这三篇文章完成了一条连续演进路线：生产级天气子图把外部服务的不确定性收进领域流程；天气子 Agent 在子图之外增加目标、工具选择和上下文隔离；Supervisor 再把多个领域 Agent 组织成一个面向用户的完整助手。判断是否应该继续拆分时，可以问三个问题：这个能力是否有独立目标，是否需要独立上下文，是否能由单独团队维护并通过稳定契约调用。三个答案都为「是」时，它才真正值得成为子 Agent。
