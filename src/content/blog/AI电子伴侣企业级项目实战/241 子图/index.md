---
title: "241 子图"
pubDate: 2026-08-12
description: "上一篇把「获取地址 → 获取天气」放在同一条并行分支里。它能说明依赖关系，却默认定位服务和天气服务永远成功。真实环境会遇到定位权限被拒绝、地址格式不一致、主天气源超时、返回数据过期，以及用户在请求结束。"
tags: [AI编程, 学习心法]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-12
---
原文链接：[https://aicompanion.usehook.cn/7production-weather-subgraph/](https://aicompanion.usehook.cn/7production-weather-subgraph/)

1. 生产级改造
上一篇把「获取地址 → 获取天气」放在同一条并行分支里。它能说明依赖关系，却默认定位服务和天气服务永远成功。真实环境会遇到定位权限被拒绝、地址格式不一致、主天气源超时、返回数据过期，以及用户在请求结束前关闭页面等情况。
如果继续把这些判断塞进一个 requestWeather 函数，函数很快就会变成一长串 try/catch。更麻烦的是，父流程只能看到「成功」或「失败」，看不到失败发生在哪一步，也很难从中间位置恢复。
生产级改造的目标不是增加更多代码，而是让每一种变化都有明确归属：
变化应该由谁处理父流程需要知道吗定位失败与地址标准化天气领域流程不需要知道细节主源超时与有限重试天气领域流程不需要知道次数数据过期与备用源天气领域流程只需要最终来源用户取消请求整条运行链路需要立即停止最终天气是否可信天气领域输出契约需要知道结果
2. 子图
LangGraph 的子图就是一张可以作为父图节点使用的编译图。父图把「查询可信天气」看成一个节点，子图内部再展开定位、标准化、主源查询、质量校验、重试和降级。
这张图要关注两个边界。虚线框外是父图，它只传入原始问题并接收可信天气；虚线框内是天气团队自己维护的领域流程。主源重试了几次、为什么切换备用源，都不应该变成父图的分支。
parent-graph.ts1const weatherSubgraph = createProductionWeatherSubgraph()
2
3const parentGraph = new StateGraph(WeatherState)
4  .addNode('weatherSubgraph', (state, config) => (
5    weatherSubgraph.invoke(state, config)
6  ))
7  .addEdge(START, 'weatherSubgraph')
8  .addEdge('weatherSubgraph', END)
9  .compile()
这里父图和子图使用相同的状态字段，所以编译后的子图可以直接作为节点。大型项目也可以让两者使用不同状态，再在节点边界显式映射输入和输出。
3. 状态
子图中的 WeatherState 记录输入、标准地址、查询次数、天气数据、质量结论和最终摘要。它们不是为了把所有变量堆进一个对象，而是为了让条件边拥有可检查的事实。这里使用 Annotation.Root 定义 LangGraph 状态通道；需要校验外部输入时，仍在工具边界使用 Zod。
weather-state.ts1export const WeatherState = Annotation.Root({
2  input: Annotation<string>,
3  city: Annotation<string>,
4  providerAttempts: Annotation<number>,
5  quality: Annotation<'unknown' | 'invalid' | 'valid'>,
6  lastError: Annotation<string>,
7  summary: Annotation<string>,
8})
例如，providerAttempts 决定还能不能重试，quality 决定是否可以结束，lastError 则帮助日志和界面解释为什么进入下一条边。节点只返回自己修改的字段，LangGraph 负责把更新合并回状态。
状态字段越多，Agent 的复杂度也越高。每个字段都意味着额外的来源、更新时机和一致性规则。因此只保存后续节点真正需要判断或追踪的数据，不要把每个函数的局部变量都升级成图状态。
4. 重试、校验和降级
主天气源返回后，流程不会立刻相信结果，而是进入质量校验节点。条件边根据状态做三选一：结果可信就结束；尝试次数未到上限就重试；次数耗尽则切换备用源。
weather-graph.ts1function routeAfterQualityCheck(state: WeatherGraphState) {
2  if (state.quality === 'valid') return 'finalize'
3  if (state.providerAttempts < 2) return 'queryPrimary'
4  return 'queryBackup'
5}
「有限」很重要。如果没有 providerAttempts < 2，临时错误可能让图无限循环。生产系统还会为每个请求设置超时、为整张图设置 recursionLimit，并把浏览器的 AbortSignal 一路传到最底层请求。
备用源也必须经过相同的质量校验，而不是因为它叫「备用」就默认可信。这样，所有供应商最终都遵守同一份输出契约。
5. 案例发送「我明天出门要带什么？」后，案例会从原始输入开始获取模拟地址。主源第一次请求会超时，第二次虽然返回数据，但更新时间超过允许范围，因此子图切换到备用天气源。最终聊天只逐字输出可信天气和携带建议，不会把内部错误当成回复发给用户。
生产级天气子图0 / 7 个步骤完成等待用户消息校验请求输入边界获取地址定位服务标准化地址地理编码主源查询天气服务 A质量校验领域规则备用查询天气服务 B生成结果子图输出
天气子图演示主源失败时自动重试、校验并切换备用源发送出门问题，观察天气子图如何处理外部服务异常
weather-graph.tsweather-state.tsparent-graph.tsstatus.tsformat.tschat.tsx001import {
002  END,
003  START,
004  StateGraph,
005} from '@langchain/langgraph'
006
007import type { WeatherStepEvent, WeatherStepId } from './status'
008import { WeatherState, type WeatherGraphState } from './weather-state'
009
010interface CreateWeatherGraphOptions {
011  onStepEvent: (event: WeatherStepEvent) => void
012}
013
014export function createProductionWeatherSubgraph({
015  onStepEvent,
016}: CreateWeatherGraphOptions) {
017  const validate = withStatus('validate', onStepEvent, async (state, signal) => {
018    await wait(180, signal)
019    if (!state.input.trim()) throw new Error('天气查询缺少有效的出行时间')
020    return { date: '明天' }
021  })
022
023  const locate = withStatus('locate', onStepEvent, async (_state, signal) => {
024    await wait(520, signal)
025    return { city: '杭州', district: '西湖区' }
026  })
027
028  const normalize = withStatus('normalize', onStepEvent, async (_state, signal) => {
029    await wait(220, signal)
030    return { coordinate: '120.1302,30.2590' }
031  })
032
033  const queryPrimary = withStatus('primary', onStepEvent, async (state, signal) => {
034    await wait(460, signal)
035    const attempt = state.providerAttempts + 1
036
037    if (attempt === 1) {
038      return {
039        providerAttempts: attempt,
040        provider: '天气服务 A',
041        quality: 'invalid' as const,
042        lastError: '主源请求超时，准备重试',
043      }
044    }
045
046    return {
047      providerAttempts: attempt,
048      provider: '天气服务 A',
049      condition: '多云',
050      temperature: '18-25℃',
051      rainProbability: 10,
052      quality: 'invalid' as const,
053      lastError: '数据更新时间超过阈值，切换备用源',
054    }
055  })
056
057  const queryBackup = withStatus('backup', onStepEvent, async (_state, signal) => {
058    await wait(560, signal)
059    return {
060      provider: '天气服务 B',
061      condition: '阵雨',
062      temperature: '19-24℃',
063      rainProbability: 70,
064      quality: 'valid' as const,
065      lastError: '',
066    }
067  })
068
069  const checkQuality = withStatus('quality', onStepEvent, async (state, signal) => {
070    await wait(160, signal)
071    return state.quality === 'valid'
072      ? { lastError: '' }
073      : { lastError: state.lastError || '天气数据未通过质量校验' }
074  })
075
076  const finalize = withStatus('finalize', onStepEvent, async (state, signal) => {
077    await wait(180, signal)
078    return {
079      summary: `${state.city}${state.district}${state.date}${state.condition}，${state.temperature}，降雨概率 ${state.rainProbability}%`,
080    }
081  })
082
083  return new StateGraph(WeatherState)
084    .addNode('validate', validate)
085    .addNode('locate', locate)
086    .addNode('normalize', normalize)
087    .addNode('queryPrimary', queryPrimary)
088    .addNode('checkQuality', checkQuality)
089    .addNode('queryBackup', queryBackup)
090    .addNode('finalize', finalize)
091    .addEdge(START, 'validate')
092    .addEdge('validate', 'locate')
093    .addEdge('locate', 'normalize')
094    .addEdge('normalize', 'queryPrimary')
095    .addEdge('queryPrimary', 'checkQuality')
096    .addConditionalEdges('checkQuality', routeAfterQualityCheck, [
097      'queryPrimary',
098      'queryBackup',
099      'finalize',
100    ])
101    .addEdge('queryBackup', 'checkQuality')
102    .addEdge('finalize', END)
103    .compile({ name: 'production_weather_subgraph' })
104}
105
106function routeAfterQualityCheck(state: WeatherGraphState) {
107  if (state.quality === 'valid') return 'finalize'
108  if (state.providerAttempts < 2) return 'queryPrimary'
109  return 'queryBackup'
110}
111
112function withStatus(
113  stepId: WeatherStepId,
114  onStepEvent: CreateWeatherGraphOptions['onStepEvent'],
115  run: (
116    state: WeatherGraphState,
117    abortSignal?: AbortSignal,
118  ) => Promise<Partial<WeatherGraphState>>,
1) {
120  return async (state: WeatherGraphState, config: { signal?: AbortSignal }) => {
121    const startedAt = Date.now()
122    onStepEvent({
123      stepId,
124      phase: 'running',
125      message: getRunningMessage(stepId, state),
126    })
127
128    try {
129      const update = await run(state, config.signal)
130      onStepEvent({
131        stepId,
132        phase: 'success',
133        message: getSuccessMessage(stepId, state),
134        durationMs: Date.now() - startedAt,
135      })
136      return update
137    }
138    catch (error) {
139      onStepEvent({
140        stepId,
141        phase: 'error',
142        message: error instanceof Error ? error.message : '步骤执行失败',
143        durationMs: Date.now() - startedAt,
144      })
145      throw error
146    }
147  }
148}
149
150function getRunningMessage(stepId: WeatherStepId, state: WeatherGraphState) {
151  return {
152    validate: '正在校验时间范围与输入格式',
153    locate: '正在请求浏览器定位服务',
154    normalize: '正在把地址转换为标准坐标',
155    primary: `正在请求主天气源（第 ${state.providerAttempts + 1} 次）`,
156    quality: '正在检查时效性、字段完整性与可信度',
157    backup: '主源不可用，正在请求备用天气源',
158    finalize: '正在收敛天气子图的结构化输出',
159  }[stepId]
160}
161
162function getSuccessMessage(stepId: WeatherStepId, state: WeatherGraphState) {
163  if (stepId === 'primary' && state.providerAttempts === 0) return '请求超时，进入重试分支'
164  if (stepId === 'primary') return '主源数据返回，等待质量校验'
165  return '步骤执行完成'
166}
167
168function wait(durationMs: number, abortSignal?: AbortSignal) {
169  return new Promise<void>((resolve, reject) => {
170    if (abortSignal?.aborted) {
171      reject(new DOMException('请求已取消', 'AbortError'))
172      return
173    }
174
175    const timer = window.setTimeout(finish, durationMs)
176    function finish() {
177      abortSignal?.removeEventListener('abort', cancel)
178      resolve()
179    }
180    function cancel() {
181      window.clearTimeout(timer)
182      reject(new DOMException('请求已取消', 'AbortError'))
183    }
184    abortSignal?.addEventListener('abort', cancel, { once: true })
185  })
186}
1. 复杂度与收益子图没有减少天气领域本身的复杂度，它只是把复杂度放到了正确的位置。代价是你需要维护更多节点、条件边、状态字段、重试上限和可观测事件；收益是父图不再随着天气供应商的变化而修改。还要注意，子图依然是确定性工作流。它按照开发者写好的条件做路由，不会自己理解「用户只是想看温度，没必要查询降雨概率」，也不会在多个工具之间自主选择。它是可靠的领域能力，但还不是子 Agent。
2. 总结生产级天气能力的核心是一份稳定契约：父图提供问题，子图负责定位、标准化、重试、质量校验和降级，最后只返回可信结果。LangGraph 让这些步骤成为可以观察、测试和恢复的状态变化，而不再隐藏在一个巨大的异步函数中。下一篇会保持这张天气子图不变，再用 LangChain 工具边界和独立模型目标把它封装成天气子 Agent。届时新增的复杂度不再来自外部请求，而来自 Agent 的自主决策和上下文隔离。
