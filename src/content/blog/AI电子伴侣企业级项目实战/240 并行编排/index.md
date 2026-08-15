---
title: "240 并行编排"
pubDate: 2026-08-12
description: "上一篇把异步步骤变成了节点，再用 RunnableSequence 按顺序执行。串行编排适合存在明确依赖的工作：必须先得到地址，天气服务才知道应该查询哪个城市。"
tags: [AI编程, 学习心法]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-12
---
原文链接：[https://aicompanion.usehook.cn/6parallel-orchestration/](https://aicompanion.usehook.cn/6parallel-orchestration/)

1. 并行编排
上一篇把异步步骤变成了节点，再用 RunnableSequence 按顺序执行。串行编排适合存在明确依赖的工作：必须先得到地址，天气服务才知道应该查询哪个城市。
但「我明天出门要带什么？」还需要个人习惯和陪同人信息。获取个人习惯不需要等待地址，检索陪同人也不依赖天气。如果仍把所有步骤排成一条直线，Agent 会浪费大量时间等待互不相关的任务。
serial.ts1const location = await requestCurrentLocation()
2const weather = await requestWeather(location)
3const habits = await readHabitsFromAgentState(state.profile)
4const companions = await readCompanionsFromMemory()
假设这四次异步操作分别耗时 0.9s、0.8s、0.7s 和 1.1s，完全串行需要大约 3.5s。并行编排会同时启动三条互不依赖的分支，总时间主要由最慢分支决定。
2. 依赖先行，并行后置并行编排不是看到多个异步函数就全部同时调用。首先要判断每个任务需要什么输入。
任务从哪里读取依赖谁能否立即启动获取地址模拟定位请求无可以获取天气模拟天气请求地址不可以获取个人习惯当前 AgentState.profile无可以获取陪同人模拟记忆系统无可以汇合结果三条分支的返回值所有分支不可以
因此，真正同时开始的是「地址天气链」「个人习惯」「陪同人」三条分支。地址天气分支内部仍然串行：地址返回之后，天气任务才开始。
从图中可以看到，情况开始变得复杂，并行、串行、依赖，这些概念开始交织在一起，形成错综复杂的编排图。图中左侧的分叉表示三条分支获得了同一份输入，并不表示分支里的每个节点都同时开始。上方分支清楚保留了「地址 → 天气」的依赖，右侧汇合点则表示任何一条分支尚未完成时，最终建议都不能生成。
3. RunnableParallel我们可以使用 RunnableParallel 来实现并行编排
LangChain 的 RunnableParallel 接收一个 Runnable 映射。每个映射项拿到同一份 ParallelAgentState，并发执行后再组合成一个对象。
graph.ts1const parallel = RunnableParallel.from({
2  locationWeather: locationWeatherBranch,
3  habits: readHabitsBranch,
4  companions: readCompanionsBranch,
5})
6
7const result = await parallel.invoke(state)返回结果的字段名来自映射的键，因此汇合结果天然具有稳定结构：
state.ts1interface ParallelResult {
2  locationWeather: {
3    location: LocationResult
4    weather: WeatherResult
5  }
6  habits: HabitResult
7  companions: CompanionResult
8}
地址天气分支本身是一个 RunnableSequence。第一个节点返回地址，第二个节点接收这份地址并查询天气：
graph.ts1const locationWeatherBranch = RunnableSequence.from([
2  requestLocationRunnable,
3  requestWeatherRunnable,
4])
这就是编排器可以组合的原因：一个 Runnable 可以是单个异步函数，也可以是已经连接好的串行链。外层只关心它是一条可以执行的分支，不需要知道分支内部还有多少节点。
4. 三种数据源本案例故意使用三种不同的数据来源，帮助你理解 Agent 上下文并不是一个巨大对象。
地址是即时环境信息。 requestCurrentLocation 模拟一次异步定位请求。它每次执行任务时重新获取，适合放在工具或外部请求层，而不是提前写入长期记忆。
个人习惯来自当前 Agent 状态。 createAgentState 为本次运行准备 profile.habitTags，习惯分支通过输入状态读取这些数据。它没有访问模块级常量，也没有重新询问用户。
陪同人来自记忆系统。 readCompanionsFromMemory 模拟一次异步记忆检索，返回妈妈和女儿以及她们的注意事项。现实项目可以把这里替换成数据库、向量检索或用户画像服务，而不改变外层并行图。
这三类信息最后都参与生成建议，但生命周期和可信来源不同。明确标记 source 能帮助调试，也能避免把临时地址错误地存成永久偏好。
5. 案例发送「我明天出门要带什么？」后，状态面板会先同时显示「获取地址」「获取个人习惯」「获取陪同人」正在运行。地址完成后，上方分支才切换到「获取天气」。三条分支全部完成，汇合任务再组织最终上下文。聊天中不会输出定位对象、状态字段或记忆记录。它们只存在于 Agent 内部，最后一条回复会结合杭州阵雨、个人习惯和陪同人需求，逐字生成携带建议。
并行任务轨迹0 / 5 个任务完成等待用户消息获取地址异步请求获取天气依赖地址获取个人习惯Agent 状态获取陪同人记忆系统汇合结果编排器
并行编排 Agent三个分支同时读取，全部完成后生成最终建议发送出门问题，观察地址天气、习惯和记忆如何并行执行
graph.tssources.tsstate.tsstatus.tsformat.tsstream.tstask-status.tsxchat.tsx001import {
002  RunnableLambda,
003  RunnableParallel,
004  RunnableSequence,
005} from '@langchain/core/runnables'
006
007import {
008  readCompanionsFromMemory,
009  readHabitsFromAgentState,
010  requestCurrentLocation,
011  requestWeather,
012  waitForSource,
013} from './sources'
014import type {
015  CompanionResult,
016  HabitResult,
017  LocationResult,
018  LocationWeatherResult,
019  ParallelAgentState,
020  ParallelResult,
021} from './state'
022import type { TaskEvent, TaskId } from './status'
023
024interface RunParallelGraphOptions {
025  onTaskEvent: (event: TaskEvent) => void
026  abortSignal?: AbortSignal
027}
028
029export async function runParallelGraph(
030  state: ParallelAgentState,
031  { onTaskEvent, abortSignal }: RunParallelGraphOptions,
12) {
033  const locationWeatherBranch = RunnableSequence.from<
034    ParallelAgentState,
035    LocationWeatherResult
036  >([
037    createTaskRunnable('location', async (_state, signal) => (
038      requestCurrentLocation(signal)
039    ), onTaskEvent),
040    createTaskRunnable('weather', async (location: LocationResult, signal) => ({
041      location,
042      weather: await requestWeather(location, signal),
043    }), onTaskEvent),
044  ])
045
046  const parallel = RunnableParallel.from<ParallelAgentState, ParallelResult>({
047    locationWeather: locationWeatherBranch,
048    habits: createTaskRunnable<ParallelAgentState, HabitResult>(
049      'habits',
050      async (input, signal) => readHabitsFromAgentState(input.profile, signal),
051      onTaskEvent,
052    ),
053    companions: createTaskRunnable<ParallelAgentState, CompanionResult>(
054      'companions',
055      async (_input, signal) => readCompanionsFromMemory(signal),
056      onTaskEvent,
057    ),
058  })
059
060  const graph = RunnableSequence.from<ParallelAgentState, ParallelResult>([
061    parallel,
062    createTaskRunnable('merge', async (result: ParallelResult, signal) => {
063      await waitForSource(250, signal)
064      return result
065    }, onTaskEvent),
066  ])
067
068  return graph.invoke(state, { signal: abortSignal })
069}
070
071function createTaskRunnable<TInput, TOutput>(
072  taskId: TaskId,
073  run: (input: TInput, abortSignal?: AbortSignal) => Promise<TOutput>,
074  onTaskEvent: RunParallelGraphOptions['onTaskEvent'],
25) {
076  return RunnableLambda.from<TInput, TOutput>(async (input, config) => {
077    const startedAt = Date.now()
078    onTaskEvent({
079      taskId,
080      phase: 'running',
081      message: getRunningMessage(taskId),
082    })
083
084    try {
085      const result = await run(input, config.signal)
086      onTaskEvent({
087        taskId,
088        phase: 'success',
089        message: '任务执行完成',
090        durationMs: Date.now() - startedAt,
091      })
092      return result
093    }
094    catch (error) {
095      onTaskEvent({
096        taskId,
097        phase: 'error',
098        message: error instanceof Error ? error.message : '任务执行失败',
099        durationMs: Date.now() - startedAt,
100      })
101      throw error
102    }
103  }).withConfig({ runName: `parallel:${taskId}` })
104}
105
106function getRunningMessage(taskId: TaskId) {
107  return {
108    location: '正在异步获取当前位置',
109    weather: '地址已返回，正在查询当地天气',
110    habits: '正在从当前 Agent 状态读取个人习惯',
111    companions: '正在从记忆系统检索陪同人',
112    merge: '正在等待分支结果并组织上下文',
113  }[taskId]
114}
1. 更快，更难并行流程的完成时间可以近似理解为：
T_parallel = max(T_location + T_weather, T_habits, T_companions) + T_merge
在本案例中，地址天气链约为 1.7s，个人习惯约为 0.7s，陪同人约为 1.1s。三条分支同时启动后，汇合点主要等待地址天气链，再加上约 0.25s 的汇合处理，总等待接近 2s，而不是四项读取任务相加后的 3.5s。
速度提升的代价是控制逻辑更复杂。开发者需要明确每条分支的输出结构，决定某个分支失败时是让整张图失败还是使用降级值，还要让状态界面同时表达多个运行中任务。
RunnableParallel 默认会等待所有分支成功。任何分支抛出错误，整体调用都会失败，不会拿着缺失的陪同人或天气信息伪造完整建议。以后需要容错时，可以在单条分支上增加 fallback，而不是把错误吞在汇合节点里。
2. 总结并行编排的关键不是把 await 全部删除，而是先识别真正独立的分支。当前案例中，地址天气是一条内部串行链，个人习惯和陪同人是两条独立读取任务，三条分支可以由 RunnableParallel 同时启动。分支全部完成后，编排器把结果汇合成结构化对象，最终回复只读取汇合后的数据。这样既缩短了等待时间，也保留了地址、Agent 状态和记忆系统各自清楚的数据边界。
