---
title: "50 流式输出"
pubDate: 2026-04-27
description: "如果图里只有一两个节点，这种方式没什么问题。可一旦图里有模型节点、工具节点，还要来回走几轮，用户面对的就是一段很长的等待。页面没有变化，终端也没有输出，只能干等。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/7-streaming/](https://aicompanion.usehook.cn/7-streaming/)

1. 为什么要讲流式输出
上一篇我们把图跑起来了，但调用方式还是 invoke。
invoke 的特点很直接：等整张图执行完，再一次性拿到结果。
如果图里只有一两个节点，这种方式没什么问题。可一旦图里有模型节点、工具节点，还要来回走几轮，用户面对的就是一段很长的等待。页面没有变化，终端也没有输出，只能干等。
流式输出就是把这段等待拆开。
图在运行过程中，每往前走一步，你就先拿到一步的结果。模型开始调工具时，可以先显示“正在查询天气”；工具跑完时，可以先把工具结果打出来；模型开始生成回复时，也可以边生成边往前端推。
这一篇先讲 graph.stream(...)。
它已经覆盖了大部分日常场景。streamEvents(...) 还会讲，但放在后面，当作更细粒度的补充。
2. 先看最常用的 streamgraph.stream(...) 返回的是一个异步迭代器。
你可以把它理解成一条持续吐数据的管道，图每产生一段新结果，你就从这条管道里读一段出来。最常见的写法是这样：
stream-basic.ts01// 先创建一条流。这里还没有开始逐段消费，只是拿到一个可迭代的流对象。
02const stream = await graph.stream(
03  { messages: [{ role: 'user', content: '北京天气怎么样？' }] },
04  {
05    configurable: { thread_id: 'stream-001' },
06    // updates 表示：每个节点执行完后，把这个节点刚刚返回的状态更新推出来。
07    streamMode: 'updates',
08  },
09)
10
11// 真正开始一段一段读取结果，是从 for await...of 这里开始。
12for await (const chunk of stream) {
13  console.log(chunk)
14}这里有两个点先记住就够了。第一，graph.stream(...) 这一步是在创建流。
第二，真正一段一段读结果，是后面的 for await...of。刚接触这套 API 时，很多人会疑惑：既然都 stream 了，为什么前面还有一个 await？
原因就是这里分了两步：
先异步创建一个可消费的流对象
再逐段把里面的数据读出来
3. streamMode 才是这篇的重点stream 本身不是固定只有一种输出形式。
真正决定你拿到什么内容的，是 streamMode。这一层想清楚了，后面的用法就会顺很多。3.1 updates：按节点看状态更新updates 是最适合先学的模式。
图里每个节点执行完以后，LangGraph 会把这个节点刚刚返回的状态更新推给你。
stream-updates.ts01const stream = await graph.stream(
02  { messages: [{ role: 'user', content: '北京天气怎么样？' }] },
03  {
04    configurable: { thread_id: 'stream-002' },
05    // 只关心“这一小步刚刚更新了什么”。
06    streamMode: 'updates',
07  },
08)
09
10for await (const chunk of stream) {
11  // chunk 的结构一般是：{ 节点名: 该节点这一步返回的状态更新 }
12  console.log('--- 收到更新 ---')
13  console.log(chunk)
14}输出会是这种结构：
stream-updates-output.txt01--- 收到更新 ---
02{
03  callModel: {
04    messages: [AIMessage { content: '', tool_calls: [{ name: 'get_weather', args: { city: '北京' } }] }]
05  }
06}
07
08--- 收到更新 ---
09{
10  callTools: {
11    messages: [ToolMessage { content: '晴，12-25°C' }]
12  }
13}
14
15--- 收到更新 ---
16{
17  callModel: {
18    messages: [AIMessage { content: '北京今天天气晴朗，气温 12-25°C，适合出门！' }]
19  }
20}这种模式最适合看图到底执行到了哪一步。
读这个输出时，可以按下面这个顺序去理解：第一个 chunk 是 callModel。模型先看了一眼用户问题，然后决定调 get_weather。
第二个 chunk 是 callTools。工具真正跑完，把天气结果写回状态。
第三个 chunk 又回到 callModel。模型拿到工具结果以后，才生成最终回复。如果你要在页面上显示：
正在调用哪个工具
哪个节点已经执行完
工具返回了什么结果
updates 就已经够用了。3.2 values：看完整状态快照updates 给的是“这一小步刚改了什么”。
values 给的则是“走到当前这一步时，整份状态长什么样”。
stream-values.ts01const stream = await graph.stream(
02  { messages: [{ role: 'user', content: '北京天气怎么样？' }] },
03  {
04    configurable: { thread_id: 'stream-003' },
05    // values 表示：每一步都给你一份完整状态，而不只是增量。
06    streamMode: 'values',
07  },
08)
09
10for await (const state of stream) {
11  // 这里拿到的就是当前这一步结束后的完整 state。
12  const lastMsg = state.messages.at(-1)
13  console.log('当前消息总数:', state.messages.length)
14  console.log('最后一条消息:', lastMsg)
15}这个模式更适合调试。
因为你拿到的是完整状态，不需要自己把前面的更新再拼回去。刚开始学的时候，updates 和 values 最容易混。可以直接这样分：
updates 看增量
values 看全量
3.3 messages：拿模型流式生成的内容如果你要做打字机效果，重点不是 streamEvents，而是先看 streamMode: "messages"。它会把模型生成过程里的消息块持续推出来。
对前端来说，这通常就是最直接的流式输出入口。
stream-messages.ts01const stream = await graph.stream(
02  { messages: [{ role: 'user', content: '用 50 字介绍一下 LangGraph' }] },
03  {
04    configurable: { thread_id: 'stream-004' },
05    // messages 表示：把模型生成过程里的消息块持续推出来。
06    streamMode: 'messages',
07  },
08)
09
10for await (const chunk of stream) {
11  // messages 模式下，每次拿到的是一个二元组：
12  // [消息块, 元信息]
13  const [messageChunk, meta] = chunk
14
15  // 一张图里可能不止一个节点会往外吐消息。
16  // 这里先只接模型节点的输出。
17  if (meta.langgraph_node === 'callModel') {
18    const token = messageChunk.content
19    if (typeof token === 'string' && token) {
20      // 每来一小块就先输出一小块，终端里看到的就是流式效果。
21      process.stdout.write(token)
22    }
23  }
24}
25
26console.log()这一段的关键不在“记住返回值长什么样”，而在知道它是用来做什么的：
updates 更像图执行进度
messages 更像模型回复本身的流
所以如果你只是想做“边生成边显示”，完全可以先学 streamMode: "messages"，不用一上来就跳到事件流。
4. 在 ReAct Agent 里怎么消费这些流放到 ReAct Agent 里以后，最常见的需求有两种。第一种是看 Agent 现在做到哪一步。
第二种是让用户看到回复正在生成。这两种需求，通常分别对应：
updates
messages
先看 updates 的消费方式：
stream-consume-updates.ts01const stream = await graph.stream(
02  { messages: [{ role: 'user', content: '北京天气怎么样？顺便算下 12 * 15' }] },
03  {
04    configurable: { thread_id: 'stream-005' },
05    streamMode: 'updates',
06  },
07)
08
09for await (const chunk of stream) {
10  if ('callModel' in chunk) {
11    // callModel 这一步结束后，最后一条消息通常就是模型刚刚产出的那条。
12    const lastMsg = chunk.callModel.messages.at(-1)
13
14    if (lastMsg?.tool_calls?.length) {
15      // 如果模型产出的是 tool_calls，说明它这一步不是在回答用户，
16      // 而是在决定下一步要调用哪些工具。
17      const toolNames = lastMsg.tool_calls.map(tc => tc.name).join(', ')
18      console.log(`🔧 正在调用: ${toolNames}`)
19    } else if (lastMsg?.content) {
20      // 如果没有 tool_calls，而是直接有文本内容，
21      // 这通常就是模型已经开始生成最终回复了。
22      console.log(`💬 ${lastMsg.content}`)
23    }
24  }
25
26  if ('callTools' in chunk) {
27    // 工具节点结束后，可以把工具结果先展示出来，
28    // 不用等模型把整轮回复全组织完。
29    for (const msg of chunk.callTools.messages) {
30      console.log(`📋 工具结果: ${msg.content}`)
31    }
32  }
33}这段代码适合挂在后端日志里，也适合给前端推“阶段性进展”。再看 messages 的消费方式：
stream-consume-messages.ts01const stream = await graph.stream(
02  { messages: [{ role: 'user', content: '北京天气怎么样？' }] },
03  {
04    configurable: { thread_id: 'stream-006' },
05    streamMode: 'messages',
06  },
07)
08
09for await (const [messageChunk, meta] of stream) {
10  // 这里只消费模型节点吐出来的文本流。
11  // 如果图里还有别的节点也产生消息，可以按 meta 再分流处理。
12  if (meta.langgraph_node !== 'callModel') continue
13
14  const token = messageChunk.content
15  if (typeof token === 'string' && token) {
16    // 每收到一个文本块就往前推一次，聊天界面里就会看到“边生成边显示”。
17    process.stdout.write(token)
18  }
19}
20
21console.log()这段更接近你在聊天界面里会用到的逻辑。
用户不会先看到整段最终回复，而是会看到它一点点出现。5. streamEvents 放在什么时候用streamEvents(...) 不是不能用，而是它更像一层更底的事件视角。当你已经不满足于：
看节点更新
看模型文本流
而是还想知道：
工具什么时候开始
工具什么时候结束
哪个 runnable 正在开始
哪个 runnable 已经结束
这时候再上 streamEvents(...) 会更合适。
stream-events.ts01const eventStream = graph.streamEvents(
02  { messages: [{ role: 'user', content: '北京天气怎么样？' }] },
03  {
04    version: 'v2',
05    configurable: { thread_id: 'events-001' },
06  },
07)
08
09for await (const event of eventStream) {
10  if (event.event === 'on_tool_start') {
11    // 工具真正开始执行时，这里会先收到一条事件。
12    console.log(`🔧 开始调用 ${event.name}`)
13  }
14
15  if (event.event === 'on_tool_end') {
16    // 工具结束后，再收到一条结束事件。
17    console.log(`✅ ${event.name} 已完成`)
18  }
19
20  if (event.event === 'on_chat_model_stream') {
21    // 如果你想要最细的模型流式事件，可以在这里接 token。
22    const token = event.data.chunk?.content
23    if (typeof token === 'string' && token) {
24      process.stdout.write(token)
25    }
26  }
27}
28
29console.log()这一层的优点是细。
缺点也一样明显，就是你得自己过滤事件、自己分发处理。
所以如果只是做一个普通聊天界面，先用 stream + streamMode 通常会更顺。6. 完整例子：同一张图，三种流式方式下面这段代码沿用上一篇的 ReAct Agent，只把调用方式换成流式。
streaming-agent.ts001import {
002  StateGraph,
003  StateSchema,
004  MessagesValue,
005  START,
006  END,
007} from '@langchain/langgraph'
008import type { GraphNode, ConditionalEdgeRouter } from '@langchain/langgraph'
009import { InMemorySaver } from '@langchain/langgraph'
010import { ChatOpenAI } from '@langchain/openai'
011import { tool } from '@langchain/core/tools'
012import * as z from 'zod'
013
014const getWeather = tool(
015  async ({ city }) => {
016    const data: Record<string, string> = {
017      北京: '晴，12-25°C',
018      上海: '小雨，17-22°C',
019      深圳: '多云，26-30°C',
020    }
021    return data[city] ?? `暂无 ${city} 的天气数据`
022  },
023  {
024    name: 'get_weather',
025    description: '查询指定城市的天气',
026    schema: z.object({ city: z.string().describe('城市名称') }),
027  },
028)
029
030const calculate = tool(
031  async ({ expression }) => {
032    try {
033      const result = new Function(`return ${expression}`)()
034      return `${expression} = ${result}`
035    } catch {
036      return `无法计算: ${expression}`
037    }
038  },
039  {
040    name: 'calculate',
041    description: '计算数学表达式',
042    schema: z.object({ expression: z.string().describe('数学表达式') }),
043  },
044)
045
046const tools = [getWeather, calculate]
047const toolsByName = Object.fromEntries(tools.map(t => [t.name, t]))
048
049// 模型先绑定工具。后面模型节点里只负责看消息、决定是回答还是调工具。
050const model = new ChatOpenAI({ model: 'gpt-4.1-mini' }).bindTools(tools)
051
052const State = new StateSchema({
053  messages: MessagesValue,
054})
055
056const callModel: GraphNode<typeof State> = async (state) => {
057  // 把当前累积的消息都交给模型，让它决定下一步是直接回答还是继续调工具。
058  const response = await model.invoke(state.messages)
059  return { messages: [response] }
060}
061
062const callTools: GraphNode<typeof State> = async (state) => {
063  // 工具节点只看最后一条模型消息里的 tool_calls。
064  const lastMsg = state.messages.at(-1)!
065  const toolCalls = lastMsg.tool_calls ?? []
066
067  const results = await Promise.all(
068    toolCalls.map(async (tc) => {
069      try {
070        // 按工具名取出真正的工具，再把参数传进去执行。
071        const result = await toolsByName[tc.name].invoke(tc.args)
072        return { role: 'tool' as const, content: result, tool_call_id: tc.id }
073      } catch (err) {
074        const errorMsg = err instanceof Error ? err.message : String(err)
075        return {
076          role: 'tool' as const,
077          content: `工具执行失败: ${errorMsg}`,
078          tool_call_id: tc.id,
079        }
080      }
081    }),
082  )
083
084  return { messages: results }
085}
086
087const shouldContinue: ConditionalEdgeRouter<typeof State, 'callTools'> = (state) => {
088  // 如果最后一条模型消息里还带着 tool_calls，就继续走工具节点；
089  // 否则说明模型已经准备好给最终回复，可以结束整张图。
090  const lastMsg = state.messages.at(-1)!
091  if (lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
092    return 'callTools'
093  }
094  return END
095}
096
097const graph = new StateGraph(State)
098  .addNode('callModel', callModel)
099  .addNode('callTools', callTools)
100  .addEdge(START, 'callModel')
101  .addConditionalEdges('callModel', shouldContinue, ['callTools'])
102  .addEdge('callTools', 'callModel')
103  .compile({ checkpointer: new InMemorySaver() })
104
105const config = { configurable: { thread_id: 'streaming-demo' } }
106
107console.log('=== updates ===')
108const updatesStream = await graph.stream(
109  { messages: [{ role: 'user', content: '北京天气怎么样？' }] },
110  {
111    ...config,
112    streamMode: 'updates',
113  },
114)
115
116for await (const chunk of updatesStream) {
117  // updates 最适合先看图到底是怎么往前推进的。
118  console.log(chunk)
119}
120
121console.log('\n=== messages ===')
122const messagesStream = await graph.stream(
123  { messages: [{ role: 'user', content: '那上海呢？' }] },
124  {
125    ...config,
126    streamMode: 'messages',
127  },
128)
129
130for await (const [messageChunk, meta] of messagesStream) {
131  // 这里只展示模型节点的文本流，不把别的节点混进来。
132  if (meta.langgraph_node !== 'callModel') continue
133
134  const token = messageChunk.content
135  if (typeof token === 'string' && token) {
136    process.stdout.write(token)
137  }
138}
139
140console.log('\n\n=== streamEvents ===')
141const eventStream = graph.streamEvents(
142  { messages: [{ role: 'user', content: '顺便算一下 12 * 15' }] },
143  {
144    version: 'v2',
145    configurable: { thread_id: 'streaming-demo' },
146  },
147)
148
149for await (const event of eventStream) {
150  // streamEvents 更适合看一条运行事件到底是在什么时候发生的。
151  if (event.event === 'on_tool_start') {
152    console.log(`\n🔧 ${event.name} 开始执行`)
153  }
154
155  if (event.event === 'on_tool_end') {
156    console.log(`✅ ${event.name} 执行完成`)
157  }
158}这一段最重要的不是把输出背下来，而是看清一件事：
图完全没变，节点也没变，边也没变。真正变的只有调用方式。同一张图：
invoke 是等全部跑完再拿结果
stream(..., { streamMode: "updates" }) 是看每一步状态更新
stream(..., { streamMode: "messages" }) 是看模型生成过程
streamEvents(...) 是看更细的运行事件
7. 这篇先记住什么如果你现在刚接触 LangGraph 的流式输出，先把下面这层关系记住就够了。stream 是正文里最该先会的入口。
真正决定你拿到什么的，是 streamMode。一般可以这样选：
想看图走到了哪一步，用 updates
想看完整状态快照，用 values
想做打字机效果，用 messages
想看更细的运行事件，再用 streamEvents
下一篇再继续往下讲 Command 与 Send。到那时，图不只是“边跑边输出”，还会在运行过程中动态改变下一步要走到哪里。
