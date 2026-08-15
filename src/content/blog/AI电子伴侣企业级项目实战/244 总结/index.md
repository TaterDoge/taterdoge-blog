---
title: "244 总结"
pubDate: 2026-08-12
description: "而是让大家感受 Agent 从简单对话案例，逐步演变为复杂任务、节点图、多 Agent 协作的完整过程。从而帮助大家对 Agent 开发祛魅。作为初学者，能够直观的感受到 Agent 开发在做什么事情。"
tags: [AI编程, 学习心法]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-12
---
原文链接：[https://aicompanion.usehook.cn/10-agent-evolution/](https://aicompanion.usehook.cn/10-agent-evolution/)

1. 演变
这个章节，不是为了让大家学会案例代码怎么编写。
而是让大家感受 Agent 从简单对话案例，逐步演变为复杂任务、节点图、多 Agent 协作的完整过程。从而帮助大家对 Agent 开发祛魅。作为初学者，能够直观的感受到 Agent 开发在做什么事情，并且根据需求的变化，多 Agent 还可以变得更加复杂，如下案例所示
出行建议 Agent偏好、近期对话和天气结果会在本地浏览器中协同工作尚未保存偏好或对话LangGraph 多 Agent 运行轨迹0 / 9 个步骤完成等待用户消息意图识别IntentSchema信息抽取开放事实模型动态澄清场景缺口偏好学习候选偏好Supervisor任务分派天气 Agent天气子图偏好 AgentIndexedDB 偏好记忆 AgentIndexedDB 对话建议汇总Supervisor
出门带什么？先澄清条件，再由 Supervisor 协调天气、偏好和本地记忆 Agent先设置偏好，再输入出行问题；信息不足时 Agent 会先向你提问
graph.tsgraph-state.tsunderstanding.tstravel-schema.tstravel-prompt.tsspecialist-agents.tsmemory.tspreference-memory.tsmodel.tstrack-node.tsstatus.tstypes.tschat.tsxpreferences.tsxfloating-label-field.tsx001import { END, START, StateGraph } from '@langchain/langgraph'
002import { createSubagentModel, createTravelModel } from './model'
003import { filterSafePreferenceCandidates } from './preference-memory'
004import {
005  createTravelChannels,
006  createTravelInput,
007  formatCompleteTravelInput,
008  type TravelGraphState,
009} from './graph-state'
010import {
011  clarifyInformation,
012  extractInformation,
013  recognizeIntent,
014} from './understanding'
015import {
016  runMemoryAgent,
017  runPreferenceAgent,
018  runSynthesisAgent,
019  runWeatherAgent,
020} from './specialist-agents'
021import { trackNode } from './track-node'
022import type { TravelStepEvent } from './status'
023import type {
024  TravelAgentInput,
025  TravelPreferenceCandidate,
026  TravelSession,
027} from './types'
028
029export interface TravelGraphResult {
030  reply: string
031  awaitingUserInput: boolean
032  session: TravelSession | null
033  learnedPreferences: TravelPreferenceCandidate[]
034}
035
036interface RunTravelGraphOptions {
037  onStepEvent: (event: TravelStepEvent) => void
038  abortSignal?: AbortSignal
039}
040
041export async function runTravelGraph(
042  input: TravelAgentInput,
043  { onStepEvent, abortSignal }: RunTravelGraphOptions,
044): Promise<TravelGraphResult> {
045  const { model, structuredOutputMethod } = await createTravelModel()
046  const specialistModel = await createSubagentModel()
047  const graph = new StateGraph<TravelGraphState>({
048    channels: createTravelChannels(input),
049  })
050    .addNode('recognizeIntentNode', trackNode('intent', onStepEvent, async (state, signal) => {
051      if (state.intent) return { intent: state.intent }
052      return {
053        intent: await recognizeIntent(
054          state.input,
055          model,
056          structuredOutputMethod,
057          signal,
058        ),
059      }
060    }))
061    .addNode('extractInformationNode', trackNode('extract', onStepEvent, async (state, signal) => {
062      if (state.information) {
063        return {
064          information: state.information,
065          preferenceCandidates: state.preferenceCandidates,
066        }
067      }
068      return extractInformation(
069        state.input,
070        state.intent,
071        model,
072        structuredOutputMethod,
073        signal,
074      )
075    }))
076    .addNode('clarifyInformationNode', trackNode('clarify', onStepEvent, async (state, signal) => {
077      const clarification = await clarifyInformation(
078        state,
079        model,
080        structuredOutputMethod,
081        signal,
082      )
083      const awaitingUserInput = clarification.askUserFor.length > 0
084      return {
085        information: clarification.information,
086        preferenceCandidates: clarification.preferenceCandidates,
087        awaitingUserInput,
088        clarificationQuestion: clarification.nextQuestion ?? '',
089        pendingSession: awaitingUserInput ? {
090          id: 'default',
091          intent: state.intent!,
092          information: clarification.information,
093          preferenceCandidates: clarification.preferenceCandidates,
094          updatedAt: Date.now(),
095        } : null,
096      }
097    }))
098    .addNode('learnPreferencesNode', trackNode('learn', onStepEvent, async state => ({
099      preferenceCandidates: filterSafePreferenceCandidates(
100        state.preferenceCandidates,
101      ),
102    })))
103    .addNode('returnClarificationNode', async () => ({}))
104    .addNode('readyForDelegationNode', async () => ({}))
105    .addNode('supervisor', trackNode('supervisor', onStepEvent, async state => ({
106      awaitingUserInput: false,
107      clarificationQuestion: '',
108      pendingSession: null,
109      input: formatCompleteTravelInput(state),
110    })))
111    .addNode('weather', trackNode('weather', onStepEvent, async (state, signal) => ({
112      weatherAdvice: await runWeatherAgent(
113        formatCompleteTravelInput(state),
114        specialistModel,
115        onStepEvent,
116        signal,
117      ),
118    })))
119    .addNode('preference', trackNode('preference', onStepEvent, async (state, signal) => ({
120      preferenceAdvice: await runPreferenceAgent(
121        formatCompleteTravelInput(state),
122        state.preferences,
123        specialistModel,
124        signal,
125      ),
126    })))
127    .addNode('memory', trackNode('memory', onStepEvent, async (state, signal) => ({
128      memoryAdvice: await runMemoryAgent(
129        formatCompleteTravelInput(state),
130        state.conversations,
131        specialistModel,
132        signal,
133      ),
134    })))
135    .addNode('synthesis', trackNode('synthesis', onStepEvent, async (state, signal) => ({
136      finalReply: await runSynthesisAgent(state, specialistModel, signal),
137    })))
138    .addEdge('clarifyInformationNode', 'learnPreferencesNode')
139    .addConditionalEdges(
140      'learnPreferencesNode',
141      state => state.awaitingUserInput
142        ? 'returnClarificationNode'
143        : 'readyForDelegationNode',
144      ['returnClarificationNode', 'readyForDelegationNode'],
145    )
146    .addEdge(START, 'recognizeIntentNode')
147    .addEdge('recognizeIntentNode', 'extractInformationNode')
148    .addEdge('extractInformationNode', 'clarifyInformationNode')
149    .addEdge('supervisor', 'weather')
150    .addEdge('supervisor', 'preference')
151    .addEdge('supervisor', 'memory')
152    .addEdge(['weather', 'preference', 'memory'], 'synthesis')
153    .addEdge('synthesis', END)
154    .addEdge('returnClarificationNode', END)
155    .addEdge('readyForDelegationNode', 'supervisor')
156    .compile({ name: 'travel_advice_multi_agent' })
157
158  const result = await graph.invoke(createTravelInput(input), {
159    signal: abortSignal,
160  }) as unknown as TravelGraphState
161
162  if (result.awaitingUserInput) {
163    return {
164      reply: `为了给出更合适的建议，想再确认一下：${result.clarificationQuestion}`,
165      awaitingUserInput: true,
166      session: result.pendingSession,
167      learnedPreferences: result.preferenceCandidates,
168    }
169  }
170  if (!result.finalReply) throw new Error('出行建议 Agent 没有生成最终结果')
171  return {
172    reply: result.finalReply,
173    awaitingUserInput: false,
174    session: null,
175    learnedPreferences: result.preferenceCandidates,
176  }
177}
178
这条路线可以压缩成一句话：把「一次对话」逐步变成「可验证的任务」，再把任务变成「可观察的工作流」，最后把工作流拆成「可以协作的专业角色」。
图中的每一步都对应前面文章里解决的一类具体问题：信息不完整时先澄清，步骤太多时先规划，流程变长时拆节点，有等待依赖时做串行或并行编排，领域边界稳定后再抽成子图和子 Agent，最后由 Supervisor 负责委派与汇总。
不要把最后的多 Agent 误解成学习的起点。它只是前面所有边界都已经变得清楚之后，系统自然演变出来的组织方式。
2. 第一阶段：把对话变成可验证任务最初的 Agent 只有一个输入和一个输出。用户说「我明天出门要带什么」，模型直接生成一段建议。这样的交互很快，但系统不知道模型有没有真正理解目的，也不知道答案缺少哪些条件。前四篇文章依次补上了四个缺口：
阶段新增的结构解决的问题意图识别intent用户到底想完成什么信息补全information、informationGap继续执行还缺哪些条件计划制定ExecutionPlan先做什么，后做什么计划执行memory、验证结果如何真正执行并检查结果
这时，模型不再直接负责一切。模型适合理解自然语言、判断意图和生成草稿；普通代码适合检查必填字段、确认依赖、验证清单是否完整。Agent 的可靠性，正是从这种职责分开开始提高的。
task-pipeline.ts01const intent = await recognizeIntent(input)
02const information = await extractInformation(input, intent)
03const gap = await analyzeInformationGap(intent, information)
04
05if (!gap.readyToPlan) {
06  return { type: 'clarification', content: gap.nextQuestion }
07}
08
09const plan = await makePlan({ intent, information })
10const result = await executeAndValidate(plan)
11
12return formatReply(result)这段代码仍然是一条串行函数，但它已经具备了 Agent 的第一个重要特征：每一步都有明确的输入、输出和停止条件。发现信息不完整时，系统可以暂停并向用户提问，而不是编造一个看似完整的答案。
3. 第二阶段：把任务变成可观察的节点图当任务步骤增加，继续把所有逻辑写在一个函数中会带来新的问题：主流程难以阅读，某一步无法单独测试，失败时也很难知道停在哪里。节点编排解决的是代码组织和执行控制。RunnableLambda 把普通函数包装成节点，RunnableSequence 表达串行依赖，RunnableParallel 表达可以同时运行的分支。它们没有改变业务本身，只是让每一步拥有统一的调用协议，并由编排器决定下一步。节点之间不再依赖某个函数作用域里的局部变量，而是通过共享状态接力。每个节点读取已有字段，只返回自己新增或更新的部分；状态事件则单独发送给界面，用来显示「正在查询天气」或「节点已完成」。这张图里有两条通道：数据通道保存节点真正产生的状态和最终结果，控制通道只发送运行阶段、耗时和错误。用户看到的是稳定的状态面板和最终回复，而不是意图对象、工具原始响应或模型草稿。这里的「可观察」不是把所有内部数据都显示出来，而是让开发者能够追踪，让用户只看到对当前任务有帮助的进度。
4. 第三阶段：从单条工作流到多 Agent 协作节点图可以把一个 Agent 组织得很清楚，但当不同领域开始拥有不同工具、不同提示词和不同上下文时，继续把所有节点放进一张图也会让边界重新变模糊。前面三篇文章给出了逐层拆分的方式：
子图：先把天气查询、重试、备用源和质量校验收进一个领域流程。
子 Agent：在子图外增加独立目标、工具选择和上下文，让它只对天气领域负责。
Supervisor：接收用户总目标，决定委派哪些 Agent，等待结果并处理重复、冲突和最终回复。
多 Agent 并不是把一个大模型复制三份。每个 Agent 都应该有自己的输入边界、能力范围和输出契约；Supervisor 只传递完成任务所需要的信息，不把整个全局状态无差别复制给所有分支。图中的并行分支代表专业边界，不代表任何任务都应该并行。天气查询依赖地址，应该在天气分支内部串行完成；习惯读取和记忆检索彼此独立，才适合同时启动。Supervisor 最后汇合领域结果，负责去重、解决冲突，并把内部过程压缩为一条清晰回复。
5. 学习路线学习 Agent 最容易犯的错误，是一开始就追逐「多 Agent」「自主规划」或复杂框架。更有效的练习方式，是每次只增加一个结构，并观察它解决了什么问题、带来了什么代价。
练习顺序只增加什么需要回答的问题1intent 和 informationGap模型理解对了吗，条件够了吗2ExecutionPlan能否把目标拆成可执行步骤3AgentState 和验证中间结果保存在哪里，如何证明完成4RunnableLambda、RunnableSequence节点如何独立测试和串行连接5RunnableParallel哪些分支真的没有互相依赖6子图、子 Agent、Supervisor哪些能力已经值得拥有独立边界
每完成一个阶段，都应该保留同一个用户问题做回归测试。比如始终使用「明天出门要带什么」，只比较状态结构、节点事件、失败处理和最终答案如何变化。这样学习的是抽象能力，而不是记住一串框架 API。还要同时观察三种结果：任务是否完成，用户是否看懂当前进度，开发者是否能定位失败原因。只有三者都可解释，Agent 才算从「能跑」走向「可维护」。
6. 扩展当前实现是一个完整的浏览器端教学案例，但「能运行」和「可依赖」之间还隔着几项必须明确的产品能力。建议按下面顺序补齐：
优先级需要补齐的能力原因与验收标准P0动态关键信息确认根据当前场景决定必须确认的条件，不能固定追问，也不能擅自默认会改变结果的信息P0天气数据真实来源接入有更新时间、来源和失败回退的天气 API；回答展示「数据更新时间」P0安全边界药物、儿童、过敏和极端天气建议必须使用谨慎措辞；不替用户做医疗判断，必要时要求人工确认P0失败与重试任一 Agent 失败时保留其他分支结果，显示可理解的降级说明，并允许只重试失败分支P1行程结构化使用开放的 facts 和 missingInformation 表达场景事实，避免固定字段限制追问范围P1记忆治理已支持自动偏好单条删除和敏感字段过滤；生产版还需补充来源与过期时间P1建议反馈用户可以标记「有用」「不适用」并说明原因，后续只更新偏好，不把错误建议直接当成记忆P2多地点与多日支持每天不同地点和天气，生成按天分组的清单，而不是把所有物品混在一起P2成本与延迟控制记录每次模型调用、token 和耗时，允许低风险场景使用规则模板减少模型调用
尤其要先解决 P0。没有真实地点、时间和天气更新时间，Agent 即使回答得很流畅，也不能称为可靠的出行助手。多 Agent 负责拆分职责，但不能替代事实来源、校验规则和用户确认。
7. 建议一个可用版本可以先收敛为五步，而不是继续增加 Agent 数量：
识别目标：识别用户意图，抽取地点、时间、同行人和活动类型。
补齐条件：对会改变天气查询或清单结果的缺口逐个追问，缺信息时暂停图运行。
获取事实：天气 Agent 查询并校验实时天气，记忆 Agent 只读取用户允许复用的信息。
生成清单：Supervisor 合并结果，按优先级和原因解释每一项，不输出无法追溯的猜测。
反馈学习：当前案例会先学习通过安全过滤的稳定个人事实，并允许用户在偏好弹窗中删除；生产版本还应增加「保留/忽略」确认和建议反馈，再决定是否升级为长期偏好。
建议把「学习」定义成偏好和规则的可控更新，而不是让模型自行修改记忆。每一次更新都应该能回答：是谁写入的、依据哪一轮对话、什么时候过期、用户能否撤销。
8. 总结这九篇文章加上本篇总结，描述的是一条从简单到复杂、从模型输出到系统协作的学习路径：
用意图和信息缺口把自然语言变成结构化任务。
用计划、状态和验证把任务变成可执行流程。
用节点、串行和并行编排把流程变成可观察工作流。
用子图、子 Agent 和 Supervisor 把稳定的领域能力组织成多 Agent 系统。
可以把 Agent 的核心抽象记成四个问题：它要完成什么，当前还缺什么，下一步由谁完成，结果如何被验证。 无论使用的是普通 TypeScript、LangChain Runnable 还是更复杂的 Agent 框架，只要这四个问题始终有清楚的答案，系统就能继续演变而不会失去边界。
