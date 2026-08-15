---
title: "239 节点编排"
pubDate: 2026-08-12
description: "上一篇的执行器已经能够依次查询天气、生成清单并验证结果。不过，那段代码仍然更像一个专门解决上海出差问题的异步函数：每一步直接写在函数体里，步骤一多，主流程就会越来越长。"
tags: [AI编程, 学习心法]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-12
---
原文链接：[https://aicompanion.usehook.cn/5orchestrate-nodes/](https://aicompanion.usehook.cn/5orchestrate-nodes/)

1. 节点编排
上一篇的执行器已经能够依次查询天气、生成清单并验证结果。不过，那段代码仍然更像一个专门解决上海出差问题的异步函数：每一步直接写在函数体里，步骤一多，主流程就会越来越长。
先不考虑「节点」这个词，一段最普通的异步串行代码大致如下：
serial.ts01const intent = await recognizeIntent(input)
02const information = await extractInformation(input, intent)
03const gap = await analyzeInformationGap(intent, information)
04
05if (!gap.readyToPlan) return gap.nextQuestion
06
07const plan = await makePlan(intent, information)
08const weather = await queryWeather(information.destination)
09const draft = await generatePackingList({ intent, information, plan, weather })
10const result = await validatePackingList(draft, weather)
11const reply = await formatReply(result)
它有一个非常清楚的特点：前一个 await 没有结束，下一行就不会开始。因此，数据会按照固定方向从理解需求流向最终回复。
节点编排并没有推翻这种写法。它只是把每个异步步骤变成一个拥有统一输入和输出的「节点」，再把执行顺序交给一个独立的编排器管理。这样，步骤实现和流程控制就不再挤在同一个函数里。
本案例使用 LangChain 的 Runnable API 实现这层编排：RunnableLambda 把普通异步函数包装成节点，RunnableSequence 按顺序连接节点。
节点是什么？
在 LangChain 中，节点不是一个必须继承的特殊类，而是一个遵守统一调用约定的 Runnable。它接收当前的 AgentState，只负责完成一项边界清楚的工作，然后返回需要合并回状态的增量，例如天气节点读取 information.destination 后返回 { weather }。RunnableLambda 可以把普通函数包装成这样的节点，RunnableSequence 再把多个节点按顺序连接起来。
因此，节点描述“做什么”，并规定“下一步交给谁”。
2. await 映射成节点和边初学者第一次看到节点图，容易觉得它和普通代码是两套完全不同的东西。实际上并不是，对于串行流程，两者其实可以一一对应。异步串行中的东西节点编排中的名字负责什么一个异步函数RunnableLambda 节点完成一项边界清楚的工作前后两个 awaitRunnableSequence 中的顺序规定下一步必须等待谁函数之间传递的变量共享状态保存后续节点需要的数据依次调用函数的主流程编排器选择节点、等待结束、处理失败加载文字或进度条状态事件告诉界面 Agent 当前在做什么最后的 return最终回复只把可交付结果发送给用户图的上排是熟悉的异步函数调用，下排是节点图。每一列表示同一项工作；横向箭头表示执行顺序。这张图只用六个步骤说明 await 与节点的对应关系，不是下面案例的完整流程。实际演示共有十个节点：接收消息、意图识别、信息抽取、判断缺口、补全与确认、制定计划、查询天气、生成清单、验证结果、组织回复。
3. 共享状态节点不能依赖上一个函数作用域里的局部变量，因为编排器需要用同一种方式调用所有节点。本案例使用一个 AgentState 保存整条链路的数据：
state.ts01interface AgentState {
02  rawInput: string
03  input?: string
04  latestUserSupplement?: string
05  intent?: Intent
06  information?: Information
07  informationGap?: InformationGap
08  plan?: ExecutionPlan
09  weather?: WeatherResult
10  draft?: PackingList
11  finalResult?: PackingList
12  reply?: string
13}
每个节点读取已有状态，只返回自己新增的部分。例如意图节点只返回 { intent }，信息节点只返回 { information }，天气节点读取 information.destination 后返回 { weather }。生成节点必须等到 intent、information、plan 和 weather 都存在，才能返回 { draft }。编排器用展开运算符合并新旧状态。这会让 Agent 比普通异步函数多出一些复杂度。节点必须检查依赖数据是否存在，状态字段必须避免互相覆盖，失败时还要知道停在哪个节点。但换来的好处是，每一步都可以被替换、测试、计时和观察。
4. 案例下面从头实现上海出差案例，createInitialState 只接收用户刚刚发送的原始字符串：
state.ts1export function createInitialState(rawInput: string): AgentState {
2  return { rawInput }
3}
预设问题故意只说「明天坐高铁去上海出差」，没有提供出差天数和工作安排。首轮会按顺序执行接收消息、意图识别、信息抽取和判断缺口，然后暂停并只回复一个澄清问题。你回答「三天，第一天参加产品评审，第二天拜访客户」后，Agent 会把这句话交给补全与确认节点。确认关键条件已经完整后，再继续执行计划、天气、生成、验证和回复。意图识别与初始信息抽取不会在第二轮重复执行。
code.ts1首轮：原始问题 → 接收 → 意图识别 → 信息抽取 → 判断缺口 → 暂停并提问
2补充轮：用户回答 → 补全与确认 → 计划 → 天气 → 生成 → 验证 → 回复
天气节点继续使用明确标注的模拟工具，避免天气变化干扰学习。意图识别、信息抽取、缺口判断、信息补全和清单生成会调用当前配置的模型；计划、验证和格式化回复使用普通 TypeScript 完成。
串行节点轨迹0 / 10 个节点完成等待用户消息接收消息输入意图识别模型信息抽取模型判断缺口模型补全与确认模型制定计划代码查询天气工具生成清单模型验证结果代码组织回复输出
节点编排 Agent从原始问题开始，缺信息时暂停，补齐后继续执行发送一个不完整的问题，观察 Agent 从 0 建立状态
graph.tsnodes.tsstate.tsstatus.tstools.tsstream.tsmodel.tsschema.tsprompt.tsformat.tschat.tsx001import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables'
002
003import { NODE_RUNNERS } from './nodes'
004import {
005  createInitialState,
006  resumeAgentState,
007  type AgentState,
008} from './state'
009import {
010  NODE_DESCRIPTORS,
011  type NodeEvent,
012  type NodeId,
013} from './status'
014
015const INITIAL_NODE_IDS = ['receive', 'intent', 'extract', 'clarify'] as const
016const EXECUTION_NODE_IDS = [
017  'plan',
018  'weather',
019  'generate',
020  'validate',
021  'reply',
022] as const
023
024interface RunGraphOptions {
025  onNodeEvent: (event: NodeEvent) => void
026  previousState?: AgentState
027  abortSignal?: AbortSignal
028}
029
030export interface GraphResult {
031  type: 'clarification' | 'final'
032  content: string
033  state: AgentState
034}
035
036export async function runSerialGraph(
037  input: string,
038  { onNodeEvent, previousState, abortSignal }: RunGraphOptions,
039): Promise<GraphResult> {
040  let state = previousState
041    ? resumeAgentState(previousState, input)
042    : createInitialState(input)
043
044  if (previousState) {
045    // 补充轮从已有对话状态继续，只重跑允许合并新事实的补全节点。
046    state = await invokeNodes(state, ['complete'], onNodeEvent, abortSignal)
047  }
048  else {
049    // 首轮必须从原始消息依次产生意图、信息和缺口判断。
050    state = await invokeNodes(
051      state,
052      INITIAL_NODE_IDS,
053      onNodeEvent,
054      abortSignal,
055    )
056  }
057
058  if (!state.informationGap?.readyToPlan) {
059    return {
060      type: 'clarification',
061      content: state.informationGap?.nextQuestion
062        ?? '请补充这次出差的停留时长和主要工作安排。',
063      state,
064    }
065  }
066
067  const remainingNodeIds = previousState
068    ? EXECUTION_NODE_IDS
069    : (['complete', ...EXECUTION_NODE_IDS] as const)
070  state = await invokeNodes(
071    state,
072    remainingNodeIds,
073    onNodeEvent,
074    abortSignal,
075  )
076
077  if (!state.reply) throw new Error('串行图执行结束，但回复节点没有产生结果')
078  return { type: 'final', content: state.reply, state }
079}
080
081async function invokeNodes(
082  state: AgentState,
083  nodeIds: readonly NodeId[],
084  onNodeEvent: RunGraphOptions['onNodeEvent'],
085  abortSignal?: AbortSignal,
16) {
087  const runnables = nodeIds.map(nodeId => (
088    createNodeRunnable(readNodeDescriptor(nodeId), onNodeEvent)
089  ))
090  const first = runnables[0]
091  const last = runnables.at(-1)
092
093  if (!first || !last) throw new Error('至少需要一个待执行节点')
094  if (runnables.length === 1) {
095    return first.invoke(state, { signal: abortSignal })
096  }
097
098  // RunnableSequence 会把上一个节点返回的状态传给下一个节点。
099  const graph = new RunnableSequence<AgentState, AgentState>({
100    first,
101    middle: runnables.slice(1, -1),
102    last,
103    name: `travel-agent:${nodeIds.join('->')}`,
104  })
105  return graph.invoke(state, { signal: abortSignal })
106}
107
108function createNodeRunnable(
109  node: typeof NODE_DESCRIPTORS[number],
110  onNodeEvent: RunGraphOptions['onNodeEvent'],
2) {
112  return RunnableLambda.from<AgentState, AgentState>(async (state, config) => {
113    const startedAt = Date.now()
114    onNodeEvent({
115      nodeId: node.id,
116      phase: 'running',
117      message: node.runningText,
118    })
119
120    try {
121      const patch = await NODE_RUNNERS[node.id](state, config.signal)
122      const nextState = { ...state, ...patch }
123      onNodeEvent({
124        nodeId: node.id,
125        phase: 'success',
126        message: getSuccessMessage(node.id, nextState),
127        durationMs: Date.now() - startedAt,
128      })
129      return nextState
130    }
131    catch (error) {
132      onNodeEvent({
133        nodeId: node.id,
134        phase: 'error',
135        message: error instanceof Error ? error.message : '节点执行失败',
136        durationMs: Date.now() - startedAt,
137      })
138      throw error
139    }
140  }).withConfig({ runName: `node:${node.id}` })
141}
142
143function readNodeDescriptor(nodeId: NodeId) {
144  const node = NODE_DESCRIPTORS.find(item => item.id === nodeId)
145  if (!node) throw new Error(`找不到节点：${nodeId}`)
146  return node
147}
148
149function getSuccessMessage(nodeId: NodeId, state: AgentState) {
150  if (
151    (nodeId === 'clarify' || nodeId === 'complete')
152    && !state.informationGap?.readyToPlan
153  ) {
154    return '等待用户补充关键信息'
155  }
156  return '节点执行完成'
157}
1. LangChain 连接节点createNodeRunnable 用 RunnableLambda 包住每一个业务函数，统一处理运行状态、耗时、错误和状态合并。invokeNodes 接收本轮需要执行的节点编号，再用 RunnableSequence 把它们连接为一条串行链。
graph.ts01const INITIAL_NODE_IDS = ['receive', 'intent', 'extract', 'clarify']
02
03let state = previousState
04  ? resumeAgentState(previousState, input)
05  : createInitialState(input)
06
07state = previousState
08  ? await invokeNodes(state, ['complete'])
09  : await invokeNodes(state, INITIAL_NODE_IDS)
10
11if (!state.informationGap?.readyToPlan) {
12  return { type: 'clarification', content: state.informationGap.nextQuestion, state }
13}
14
15if (!previousState) state = await invokeNodes(state, ['complete'])
16state = await invokeNodes(state, ['plan', 'weather', 'generate', 'validate', 'reply'])
RunnableSequence 内部会等待当前 Runnable 完成，再把它返回的新状态传给下一个 Runnable。因此，信息抽取一定能读到意图，生成节点一定能读到天气，验证节点也一定能读到草稿。这里没有并发启动多个节点，也没有再用手写循环假装节点图。
previousState 是不是一个快照捷径？它是运行状态，但不是预先写好的案例快照。两者的区别在于来源：预制快照会在开始前直接塞入 intent、information 或 plan；这里首轮调用 createInitialState 时只有 rawInput，其余字段必须由首轮节点现场生成。当 Agent 提出澄清问题后，聊天组件才把本轮产生的状态保存在当前会话的 sessionRef 中。下一条用户回答到来时，resumeAgentState 把回答放进 latestUserSupplement，补全节点在刚才的结果上继续。这是在恢复同一项工作，不是绕过前面的工作。
节点出错时，包装节点的 catch 会把当前节点切换为失败并重新抛出错误。RunnableSequence 不会继续执行后续节点，所以界面能够准确显示 Agent 停在哪一步，而不是在状态不完整时勉强生成一个看似正常的回复。
2. 节点过程可见本案例同时存在两条输出通道。onNodeEvent 是状态通道，只发送节点编号、运行阶段和耗时；runSerialGraph 的返回值是结果通道，首轮只包含澄清问题，信息补齐后只包含最终 reply。状态面板因此可以持续显示「正在识别意图」或「天气节点已完成」，但聊天记录里不会出现意图 JSON、信息对象、执行计划、天气工具原始对象和清单草稿。第一轮聊天只出现必须由用户回答的问题；十个节点全部成功后，聊天里才出现最终 Markdown。
这里还要区分「生成结果」和「显示结果」。节点图只生成一次完整的 reply，不会为了逐字效果重复执行模型或节点。streamCharacters 再把这份结果拆成字符，通过异步生成器逐个 yield 给 ArticleChat。界面中仍然只有一条 Agent 回复，只是它会像打字一样持续增长。
chat.tsx1const result = await runSerialGraph(input, options)
2
3for await (const character of streamCharacters(result.content, abortSignal)) {
4  yield { content: character }
5}
信息保存位置用户如何感知节点运行阶段NodeStatus[]状态面板实时切换节点中间结果AgentState不直接显示必要的澄清问题result.content信息不足时逐字显示最终交付内容state.reply在同一条 Agent 回复中逐字显示
把状态和回复分开之后，开发者仍然能观察执行过程，用户也不会被内部数据淹没。这正是 Agent 产品里「过程可感知」和「回复要干净」可以同时成立的原因。
3. 总结串行节点编排可以从普通的异步代码自然演化而来：异步函数变成节点，await 的先后顺序变成边，局部变量变成共享状态，主函数变成编排器。本篇的十个节点从原始用户消息开始，完整走过意图识别、信息抽取、缺口判断、信息补全、规划、工具调用、生成、验证和回复。节点由 LangChain 的 RunnableLambda 与 RunnableSequence 串行编排，执行过程通过状态事件展示，中间结果只在当前会话的共享状态中传递。
完整 Agent 不一定从第一条消息一口气跑到底。发现关键信息缺失时，正确做法是暂停当前串行链，向用户提问，再从保存下来的真实运行状态继续。这样既没有跳过前置步骤，也不会在后续回答中重复执行意图识别和初始信息抽取。
