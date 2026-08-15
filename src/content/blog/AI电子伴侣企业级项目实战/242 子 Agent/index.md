---
title: "242 子 Agent"
pubDate: 2026-08-12
description: "上一篇的天气子图已经会重试、校验和降级，但每条路线仍由开发者提前写死。给它相同状态，它总会走相同的条件边。它不会理解父流程交给它的任务，也不会决定这次应该调用哪个工具，更不会用自然语言解释领域结论。"
tags: [AI编程, 学习心法]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-12
---
原文链接：[https://aicompanion.usehook.cn/8weather-subagent/](https://aicompanion.usehook.cn/8weather-subagent/)

1. 子 Agent
上一篇的天气子图已经会重试、校验和降级，但每条路线仍由开发者提前写死。给它相同状态，它总会走相同的条件边。它不会理解父流程交给它的任务，也不会决定这次应该调用哪个工具，更不会用自然语言解释领域结论。
我们只需要在子图基础之上增加独立目标、边界和模型选择，就可以让子图变成一个可以委派目标的天气 Agent 专家。
能力子图子 Agent按状态执行固定路线有有，可以把子图当工具理解父 Agent 委派的目标没有有独立系统提示词自己决定是否调用工具没有由模型进行工具选择隔离领域上下文只隔离流程字段隔离消息、工具结果和模型调用返回领域自然语言答案需要父图格式化自己生成后返回父 Agent
所以不能仅把 weatherSubgraph 重命名为 weatherAgent。真正的封装需要新的调用边界。
2. 三层封装
天气子 Agent 由三层组成。最内层仍是上一篇的 LangGraph 子图；中间层用 LangChain tool 把子图变成一个带名称、说明和 Zod 输入契约的工具；最外层用 createAgent 创建拥有独立目标的天气专家。
这三个边界不能混在一起：
StateGraph 管理可靠执行，擅长循环、分支、重试和恢复。
tool 定义外部可调用契约，隐藏内部状态并限制输入输出。
createAgent 管理目标、消息和工具选择，负责把结构化天气转成领域答案。
3. 工具契约
天气工具只接收一条完整问题。工具内部从头运行天气子图，再返回地点、天气、温度、降雨概率和来源。providerAttempts、坐标、主源错误等内部字段不会暴露给父 Agent。
weather-tool.ts01const weatherTool = tool(
02  async ({ question }) => {
03    const result = await runPackingWeather(question)
04    return JSON.stringify({
05      location: `${result.city}${result.district}`,
06      condition: result.condition,
07      temperature: result.temperature,
08      rainProbability: result.rainProbability,
09      source: result.provider,
10    })
11  },
12  {
13    name: 'query_reliable_weather',
14    description: '查询明天出门地点的可信天气',
15    schema: z.object({ question: z.string() }),
16  },
1)

工具返回 JSON 字符串不是为了让用户阅读，而是给模型一份稳定、低歧义的观察结果。父 Agent 只会拿到天气 Agent 最终生成的领域回答，不会直接接触这份工具输出。
4. 独立目标和边界
createAgent 把模型、工具和系统提示词组合为一个可调用 Agent。提示词明确要求先查询可信天气，并禁止它推测个人习惯和陪同人。这种「不能做什么」与「要做什么」同样重要。
weather-agent.ts01const weatherAgent = createAgent({
02  name: 'weather_specialist',
03  description: '负责定位、天气查询和天气相关出门建议',
04  model,
05  tools: [weatherTool],
06  systemPrompt: [
07    '你是天气领域子 Agent。',
08    '必须先调用 query_reliable_weather。',
09    '只回答天气相关建议，不推测习惯或陪同人。',
10  ].join('\n'),
11})
本案例还为 DeepSeek 显式关闭思考模式。原因不是天气问题不需要思考，而是工具型 Agent 依赖 tool_choice，部分 DeepSeek 思考模式不接受这种参数组合。关闭思考模式后，模型仍可进行工具选择，但不会触发 Thinking mode does not support this tool_choice。
5. 案例发送「我明天出门要带什么？」后，状态面板会展示四个层次：父 Agent 交接任务、天气 Agent 做工具决策、天气工具运行上一篇的完整子图、天气 Agent 返回领域答案。聊天中只逐字显示最后的天气建议。
天气子 Agent 运行轨迹0 / 4 个步骤完成等待用户消息接收任务父 Agent自主决策天气 Agent调用天气工具LangChain Tool领域回答天气 Agent
天气子 Agent独立决策、调用天气工具，只返回天气领域答案发送出门问题，观察子图如何被封装成子 Agent
weather-agent.tsweather-tool.tsmodel.tsstatus.tschat.tsx001import { createAgent } from 'langchain'
002
003import { createSubagentModel } from './model'
004import type { SubagentStepEvent } from './status'
005import { createWeatherTool } from './weather-tool'
006
007interface RunWeatherSubagentOptions {
008  onStepEvent: (event: SubagentStepEvent) => void
009  abortSignal?: AbortSignal
010}
011
012export async function runWeatherSubagent(
013  input: string,
014  { onStepEvent, abortSignal }: RunWeatherSubagentOptions,
015) {
016  const handoffStartedAt = Date.now()
017  onStepEvent({
018    stepId: 'handoff',
019    phase: 'running',
020    message: '正在读取父 Agent 委派的天气任务',
021  })
022
023  const model = await createSubagentModel()
024  onStepEvent({
025    stepId: 'handoff',
026    phase: 'success',
027    message: '任务和独立上下文已准备完成',
028    durationMs: Date.now() - handoffStartedAt,
029  })
030  onStepEvent({
031    stepId: 'decision',
032    phase: 'running',
033    message: '正在判断需要使用哪个领域工具',
034  })
035
036  const { weatherTool, wasInvoked } = createWeatherTool({
037    onStepEvent,
038    abortSignal,
039  })
040  const weatherAgent = createAgent({
041    name: 'weather_specialist',
042    description: '负责定位、天气查询、可信度校验和天气相关出门建议',
043    model,
044    tools: [weatherTool],
045    systemPrompt: [
046      '你是天气领域子 Agent。',
047      '收到出门问题后，必须先调用 query_reliable_weather 获取可信天气。',
048      '只回答与天气有关的携带建议，不推测个人习惯或陪同人。',
049      '回答使用中文，简洁说明地点、天气、温度、降雨概率和建议物品。',
050    ].join('\n'),
051  })
052
053  const answerStartedAt = Date.now()
054  const result = await weatherAgent.invoke({
055    messages: [{
056      role: 'user',
057      content: `父 Agent 委派任务：${input}`,
058    }],
059  }, { signal: abortSignal })
060  if (!wasInvoked()) {
061    onStepEvent({
062      stepId: 'decision',
063      phase: 'error',
064      message: '天气子 Agent 没有调用可信天气工具',
065    })
066    throw new Error('天气子 Agent 没有调用可信天气工具，请重试')
067  }
068  const content = readLastAssistantText(result.messages)
069
070  if (!content) throw new Error('天气子 Agent 没有返回可展示的领域答案')
071  onStepEvent({
072    stepId: 'domainAnswer',
073    phase: 'success',
074    message: '天气领域答案已返回父 Agent',
075    durationMs: Date.now() - answerStartedAt,
076  })
077
078  return content
079}
080
081function readLastAssistantText(messages: readonly unknown[]) {
082  const message = messages.at(-1)
083  if (!message || typeof message !== 'object' || !('content' in message)) return ''
084  return readTextContent(message.content)
085}
086
087function readTextContent(content: unknown) {
088  if (typeof content === 'string') return content
089  if (!Array.isArray(content)) return ''
090
091  return content.map((part) => {
092    if (typeof part === 'string') return part
093    if (
094      part
095      && typeof part === 'object'
096      && 'text' in part
097      && typeof part.text === 'string'
098    ) return part.text
099    return ''
100  }).filter(Boolean).join('\n')
101}
1026. Agent 化增加模型之后，路线不再完全确定。同一句任务可能产生不同工具参数，模型也可能遗漏工具调用，因此工具说明、系统边界和运行轨迹都要测试。每个子 Agent 还会增加一次或多次模型调用，带来延迟、费用、限流和失败概率。上下文隔离也有两面性。天气 Agent 看不到不相关的陪同人记忆，可以减少干扰和 Token；但父 Agent 必须准备一份足够完整的任务描述，否则子 Agent 会因为缺少地点或时间而反复澄清。好的委派不是把用户原话随手转发，而是传递完成领域任务所需的最小完整上下文。
7. 总结天气子图负责「可靠地做事」，天气子 Agent 负责「理解天气领域目标并决定怎样使用能力」。用工具包住子图后，内部复杂状态不会扩散；用 createAgent 包住工具后，父流程得到的是一个可以委派目标的天气专家。下一篇会把天气 Agent、习惯 Agent 和陪同人 Agent 同时交给 Supervisor。那时新的问题不再是一个 Agent 会不会调用工具，而是多个 Agent 应该由谁选择、怎样并行，以及结果冲突时谁做最后决定。
