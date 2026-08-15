---
title: "49 ReAct Agent"
pubDate: 2026-04-27
description: "前五篇分别学了 StateGraph 的节点与边、Reducer 的状态合并、条件边的循环控制、Checkpointer 的状态持久化。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/6-react-agent/](https://aicompanion.usehook.cn/6-react-agent/)

1. 前五篇的零件，这一篇组装
前五篇分别学了 StateGraph 的节点与边、Reducer 的状态合并、条件边的循环控制、Checkpointer 的状态持久化。
每一篇解决一个具体问题，但始终没有放在一起。
这一篇就是「回报点」——把所有零件组装成一个完整的 ReAct Agent。
构建完成后你会发现，核心图定义只有三行。之前五篇铺垫的知识点，在这三行里全部用上了。
2. 什么是 Agent：模型自己决定下一步做什么在写 Agent 之前，先搞清楚一个根本问题：Agent 和普通程序的区别是什么？普通程序的执行路径是你写死的。用户输入 → 调 API → 拼结果 → 返回。每一步做什么、做几次、什么时候停下来，全由代码决定。Agent 不一样。你把工具交给模型，模型自己决定：
调不调工具——用户说「你好」，不需要调工具，直接回复
调哪个工具——用户说「北京天气」，模型选择 get_weather 而不是 calculate
传什么参数——模型从用户的自然语言中提取 city: "北京"
调几次——用户说「北京和上海的天气」，模型一次调两个
什么时候停——拿到所有结果后，模型决定不再调工具，生成最终回复
这就是「自主性」。你不写 if...else 来分发请求，模型根据上下文自己做判断。ReAct（Reasoning + Acting）是实现这种自主性最经典的模式。它的循环很简单：
react-loop.txt01用户: 北京明天天气怎么样？
02
03  [思考] 用户想知道天气，我需要调用天气工具
04  [行动] 调用 get_weather({ city: "北京" })
05  [观察] 工具返回：晴，12-25°C
06
07  [思考] 已经拿到天气信息，可以直接回复了
08  [行动] 生成最终回复
09
10AI: 北京明天天气晴朗，气温 12-25°C，适合出门！对应到 LangGraph，就是第四篇讲过的条件边循环：
callModel 节点——模型思考 + 决定行动（调工具还是直接回复）
callTools 节点——执行工具，把结果放回消息列表（观察）
条件边——有工具调用就继续循环，没有就结束
3. 准备工具：给 Agent 装上能力Agent 的能力边界由工具决定。我们准备三个工具：查天气、做计算、查时间。
tools.ts01import { tool } from '@langchain/core/tools'
02import * as z from 'zod'
03
04// 查天气
05const getWeather = tool(
06  async ({ city }) => {
07    const data: Record<string, string> = {
08      北京: '晴，12-25°C',
09      上海: '小雨，17-22°C',
10      深圳: '多云，26-30°C',
11    }
12    return data[city] ?? `暂无 ${city} 的天气数据`
13  },
14  {
15    name: 'get_weather',
16    description: '查询指定城市的天气',
17    schema: z.object({
18      city: z.string().describe('城市名称'),
19    }),
20  },
1)

22
23// 做计算
24const calculate = tool(
25  async ({ expression }) => {
26    try {
27      // 生产环境请用安全的表达式解析器，这里仅做演示
28      const result = new Function(`return ${expression}`)()
29      return `${expression} = ${result}`
30    } catch {
31      return `无法计算: ${expression}`
32    }
33  },
34  {
35    name: 'calculate',
36    description: '计算数学表达式',
37    schema: z.object({
38      expression: z.string().describe('数学表达式，例如 "2 + 3 *4"'),
39    }),
40  },
41)
42
43// 查时间
44const getCurrentTime = tool(
45  async () => {
46    return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
47  },
48  {
49    name: 'get_current_time',
50    description: '获取当前北京时间',
51    schema: z.object({}),
52  },
53)
54
55const tools = [getWeather, calculate, getCurrentTime]每个工具的结构都一样：一个执行函数 + 一个描述对象。name 和 description 是给模型看的——模型根据这些信息决定什么时候调用哪个工具。schema 用 Zod 定义参数结构，LangChain 会自动把它转成模型需要的 JSON Schema 格式。
4. 构建 ReAct Agent4.1 状态、模型、节点
agent-core.ts01import {
02  StateGraph,
03  StateSchema,
04  MessagesValue,
05  START,
06  END,
07} from '@langchain/langgraph'
08import type { GraphNode, ConditionalEdgeRouter } from '@langchain/langgraph'
09import { InMemorySaver } from '@langchain/langgraph'
10import { ChatOpenAI } from '@langchain/openai'
11
12// 状态：只需要一个消息列表
13// 用户输入、模型回复、工具调用请求、工具执行结果——全部是消息
14const State = new StateSchema({
15  messages: MessagesValue,
16})
17
18// 模型：绑定工具后，模型在推理时会自动考虑是否调用它们
19const model = new ChatOpenAI({ model: 'gpt-4.1-mini' }).bindTools(tools)
20
21// 节点 1：调用模型
22// 把所有消息（含历史对话和工具结果）发给模型，拿回回复
23const callModel: GraphNode<typeof State> = async (state) => {
24  const response = await model.invoke(state.messages)
25  return { messages: [response] }
26}
27
28// 节点 2：执行工具
29// 从模型回复中取出工具调用请求，执行后把结果放回消息列表
30const toolsByName = Object.fromEntries(tools.map(t => [t.name, t]))
31
32const callTools: GraphNode<typeof State> = async (state) => {
33  const lastMsg = state.messages.at(-1)!
34  const toolCalls = lastMsg.tool_calls ?? []
35
36  // 多个工具调用并行执行
37  const results = await Promise.all(
38    toolCalls.map(async (tc) => {
39      try {
40        const result = await toolsByName[tc.name].invoke(tc.args)
41        return { role: 'tool' as const, content: result, tool_call_id: tc.id }
42      } catch (err) {
43        // 工具失败时把错误信息返回给模型，让它自己决定怎么应对
44        const errorMsg = err instanceof Error ? err.message : String(err)
45        return {
46          role: 'tool' as const,
47          content: `工具执行失败: ${errorMsg}`,
48          tool_call_id: tc.id,
49        }
50      }
51    }),
52  )
53
54  return { messages: results }
55}
4.2 路由和组装
build-graph.ts01// 路由：模型回复里有工具调用就继续循环，没有就结束
02const shouldContinue: ConditionalEdgeRouter<typeof State, 'callTools'> = (state) => {
03  const lastMsg = state.messages.at(-1)!
04  if (lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
05    return 'callTools'
06  }
07  return END
08}
09
10// 组装图
11const graph = new StateGraph(State)
12  .addNode('callModel', callModel)
13  .addNode('callTools', callTools)
14  .addEdge(START, 'callModel')                                     // 入口
15  .addConditionalEdges('callModel', shouldContinue, ['callTools'])  // 条件分支
16  .addEdge('callTools', 'callModel')                               // 循环回路
17  .compile({
18    checkpointer: new InMemorySaver(),  // 支持多轮对话
19  })三行图定义，就是整个 ReAct Agent 的控制流。对照第四篇的条件边循环：
START → callModel：收到消息后，先让模型思考
callModel → shouldContinue → callTools：模型决定调工具，执行它
callTools → callModel：工具结果回到模型，继续思考
模型决定不再调工具时，shouldContinue 返回 END，循环结束。
5. 运行：观察 Agent 的自主决策5.1 Agent 自己选择工具
single-turn.ts01const config = { configurable: { thread_id: 'test-001' } }
02
03const result = await graph.invoke(
04  { messages: [{ role: 'user', content: '北京和上海今天天气怎么样？顺便算下 365* 24' }] },
05  config,
06)
07
08for (const msg of result.messages) {
09  const type = msg.getType()
10  if (type === 'human') {
11    console.log(`[用户] ${msg.content}`)
12  } else if (type === 'ai' && msg.tool_calls?.length) {
13    console.log(`[模型决策] 调用工具: ${msg.tool_calls.map(tc =>`${tc.name}(${JSON.stringify(tc.args)})`).join(', ')}`)
14  } else if (type === 'tool') {
15    console.log(`[工具结果] ${msg.content}`)
16  } else {
17    console.log(`[模型回复] ${msg.content}`)
18  }
19}
输出：
output.txt1[用户] 北京和上海今天天气怎么样？顺便算下 365 *24
2[模型决策] 调用工具: get_weather({"city":"北京"}), get_weather({"city":"上海"}), calculate({"expression":"365* 24"})
3[工具结果] 晴，12-25°C
4[工具结果] 小雨，17-22°C
5[工具结果] 365 *24 = 8760
6[模型回复] 北京今天天气晴朗，气温 12-25°C；上海有小雨，17-22°C，记得带伞。365 × 24 = 8760，一年有 8760 个小时！注意看 [模型决策] 那一行：你没有写任何代码告诉模型「先查天气再算数」。模型自己分析了用户的请求，判断需要调三个工具，一次性发出了三个调用请求。这就是第二节说的「自主性」——控制流不是你写死的，是模型推理出来的。如果用户改问「你好」，模型会判断不需要任何工具，直接回复。你不需要为此写一行额外的代码。
5.2 多轮对话：Checkpointer 的效果
multi-turn.ts01const config = { configurable: { thread_id: 'test-002' } }
02
03// 第一轮
04await graph.invoke(
05  { messages: [{ role: 'user', content: '现在几点了？' }] },
06  config,
07)
08
09// 第二轮：同一个 thread_id，上下文自动累积
10const r2 = await graph.invoke(
11  { messages: [{ role: 'user', content: '帮我算一下 365* 24' }] },
12  config,
13)
14console.log(r2.messages.at(-1)?.content)
15// → 365 × 24 = 8760，一年有 8760 个小时。
16
17// 第三轮：Agent 记得之前的对话
18const r3 = await graph.invoke(
19  { messages: [{ role: 'user', content: '前面我问了你什么？' }] },
20  config,
21)
22console.log(r3.messages.at(-1)?.content)
23// → 你先问了现在几点，然后问一年有多少小时。多轮对话的能力来自第五篇的 Checkpointer。同一个 thread_id 下，每次 invoke 时 Checkpointer 先加载上一次的状态，新消息通过 MessagesValue 追加到历史后面。你只需要传本轮新增的消息，历史对话由 Checkpointer 自动管理。
6. 添加系统提示：给 Agent 一个人格裸的 ReAct Agent 已经能跑了。生产环境最常见的定制是加一个系统提示，控制 Agent 的行为风格。最简单的方式——在第一轮调用时把系统消息放在消息列表最前面：
system-prompt.ts01const config = { configurable: { thread_id: 'companion-001' } }
02
03const result = await graph.invoke(
04  {
05    messages: [
06      {
07        role: 'system',
08        content: `你是一个贴心的 AI 伴侣。
09规则：
101. 用温暖、口语化的方式回复
112. 如果用户问天气，主动给出穿衣建议
123. 如果无法确定答案，坦诚说不知道，不要编造`,
13      },
14      { role: 'user', content: '深圳天气怎么样？' },
15    ],
16  },
17  config,
18)
19
20console.log(result.messages.at(-1)?.content)
21// → 深圳今天多云，26-30°C，挺热的！穿短袖就好，出门记得涂防晒~如果你把系统消息也放进 messages，同一个 thread_id 下后续轮次通常会继续带着它，所以很多场景里不用每轮都重复传。如果系统提示需要动态变化（比如根据用户身份调整），更好的做法是在 callModel 节点里注入：
dynamic-system-prompt.ts01const callModel: GraphNode<typeof State> = async (state, config) => {
02  const userId = config?.configurable?.user_id ?? 'anonymous'
03
04  // 每次调模型时在消息最前面插入系统提示
05  const systemMessage = {
06    role: 'system' as const,
07    content: `你是用户 ${userId} 的 AI 伴侣。用温暖的方式回复。`,
08  }
09
10  const response = await model.invoke([systemMessage, ...state.messages])
11  return { messages: [response] }
12}
7. 生产环境：createReactAgent前面手动构建了整个 ReAct Agent，是为了理解内部结构。但在实际开发中，LangGraph 提供了一个开箱即用的工具函数 createReactAgent，一行代码就能创建标准的 ReAct Agent：
create-react-agent.ts01import { createReactAgent } from '@langchain/langgraph/prebuilt'
02import { ChatOpenAI } from '@langchain/openai'
03import { InMemorySaver } from '@langchain/langgraph'
04
05const model = new ChatOpenAI({ model: 'gpt-4.1-mini' })
06
07// 一行搞定：模型 + 工具 + Checkpointer
08const agent = createReactAgent({
09  model,
10  tools: [getWeather, calculate, getCurrentTime],
11  checkpointer: new InMemorySaver(),
12})
13
14// 用法和手动构建的完全一样
15const result = await agent.invoke(
16  { messages: [{ role: 'user', content: '北京天气怎么样？' }] },
17  { configurable: { thread_id: 'quick-001' } },
18)createReactAgent 内部做的事和我们手动构建的完全一样：定义 callModel 节点、callTools 节点、条件边循环、编译图。它是一层封装，不是黑魔法。什么时候用 createReactAgent，什么时候手动构建？
标准的「模型 + 工具」场景 → 用 createReactAgent，省时间
需要在循环中插入额外步骤（安全检查、日志记录、人工审批）→ 手动构建，因为你需要控制节点和边的结构
理解了本文的手动构建过程，你就知道 createReactAgent 省略了什么，也知道在需要定制时从哪里下手。
8. 总结这一篇把前五篇的知识点串在了一起：
知识点来自在 ReAct Agent 中的作用StateSchema + MessagesValue第二篇定义状态，消息自动追加合并条件边 + 循环第四篇callModel → callTools → callModel 的 ReAct 循环InMemorySaver + thread_id第五篇多轮对话的状态持久化GraphNode + ConditionalEdgeRouter第二、四篇节点和路由函数的类型约束
Agent 的核心不是代码量，而是一个设计决策：把「下一步做什么」的决定权交给模型。 你定义好工具、接好循环，模型在循环里自主推理、自主行动、自主判断何时停下。这就是从「程序」到「Agent」的跨越。下一篇讲流式输出——让 Agent 的回复像打字一样逐字出现，而不是等所有工具执行完才一次性返回。
