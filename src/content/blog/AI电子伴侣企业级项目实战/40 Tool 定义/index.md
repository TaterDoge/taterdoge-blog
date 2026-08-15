---
title: "40 Tool 定义"
pubDate: 2026-04-24
description: "后面用 createAgent... 时，Agent 只是把这套循环接管过去，不用你自己维护。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/16-tool-function-calling/](https://aicompanion.usehook.cn/16-tool-function-calling/)

## 1. 用户一句话里，常常不止一个动作

前面几篇里，Agent 已经能做几件事：

- 接收消息

- 读取检索结果

- 结合上下文生成回复

但只靠聊天模型，它还是只能停在「回答」这一层。

比如用户说：

tool-scene.txt

```txt
帮我查一下明天上海下不下雨，如果下雨就提醒我带伞。
```

这句话里其实有两个动作：

- 先查天气

- 如果下雨，再创建提醒

普通聊天模型能理解这句话，但它碰不到天气接口，也碰不到提醒系统。

Tool 就是补这层能力的。

Tool 在这里做的事很具体：

- 把一个外部能力暴露给模型

- 告诉模型这个能力叫什么

- 告诉模型这个能力要什么参数

- 当模型想调用它时，先返回一份结构化的调用请求

真正执行函数的，还是你的程序。

## 2. 先看一遍工具调用到底发生了什么

这一层最好先看清楚，再去用 Agent。

一次工具调用通常是这个顺序：

- 你先定义工具

- 把工具列表交给模型

- 用户发来消息

- 模型判断要不要调工具

- 如果要调，就返回 `tool_calls`

- 你的程序执行工具

- 再把工具结果交还给模型

- 模型生成最后的回复

后面用 `createAgent(...)` 时，Agent 只是把这套循环接管过去，不用你自己维护。

## 3. 先把工具定义出来

先从两个最小工具开始：查天气、建提醒。

companion-tools.ts

```typescript
import { tool } from 'langchain'
import { z } from 'zod'

// 这个工具只负责查天气。
// 模型看到 description 和 schema 后，才知道什么时候该调它、该怎么传参。
export const getWeather = tool(
  async ({ city }) => {
    const fakeWeatherMap: Record<string, string> = {
      上海: '明天小雨，17-22 度',
      北京: '明天晴，12-25 度',
      深圳: '明天多云，26-30 度',
    }

    return fakeWeatherMap[city] ?? `${city}：暂无天气数据`
  },
  {
    name: 'get_weather',
    description: '查询某个城市未来的天气情况',
    schema: z.object({
      city: z.string().describe('要查询天气的城市名'),
    }),
  },
)

// 这个工具只负责创建提醒。
// 返回对象没有问题，后面模型照样能继续读取字段内容。
export const createReminder = tool(
  async ({ content, time }) => {
    return {
      ok: true,
      message: `提醒已创建：${time} - ${content}`,
    }
  },
  {
    name: 'create_reminder',
    description: '帮用户创建一个提醒事项',
    schema: z.object({
      content: z.string().describe('提醒的具体内容'),
      time: z.string().describe('提醒时间，例如 明天早上 8 点'),
    }),
  },
)
```

这段代码里，真正决定模型能不能用对工具的，不是函数体有多复杂，而是后面这三项：

- `name`

- `description`

- `schema`

尤其是 `schema` 里的 `.describe()`，不要省。

它不是写给人看的注释，而是给模型看的参数说明。

## 4. 先手动跑一遍，再看 Agent 接管

先看手动版，Tool Calling 的原理会更清楚。

这里故意用了 `HumanMessage` 这类消息对象。原因很简单：手动循环里会依次往同一个数组里塞进用户消息、模型消息和工具消息，用消息对象会更直观。

tool-loop.ts

```typescript
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage } from '@langchain/core/messages'
import { getWeather, createReminder } from './companion-tools'

const tools = [getWeather, createReminder]
const toolMap = new Map(tools.map(tool => [tool.name, tool]))

const model = new ChatOpenAI({
  model: 'gpt-4.1-mini',
})

// 这里只是把工具定义交给模型。
// 到这一步为止，工具还没有被真正执行。
const modelWithTools = model.bindTools(tools)

const messages = [
  new HumanMessage('帮我看看明天上海天气，如果下雨就提醒我带伞。'),
]

// 第一步：模型先决定要不要调工具。
// 如果它觉得需要，会先返回 tool_calls。
const aiMessage = await modelWithTools.invoke(messages)
messages.push(aiMessage)

// 第二步：你的程序根据 tool_calls 真正执行工具。
for (const toolCall of aiMessage.tool_calls ?? []) {
  const selectedTool = toolMap.get(toolCall.name)

  if (!selectedTool) {
    throw new Error(`未知工具：${toolCall.name}`)
  }

  // selectedTool.invoke(...) 会执行工具，并返回一个 ToolMessage。
  // 这个 ToolMessage 里会带上 tool_call_id，模型后面靠它来对上这次调用。
  const toolMessage = await selectedTool.invoke(toolCall)
  messages.push(toolMessage)
}

// 第三步：把工具结果再交给模型。
// 这一次拿到的，才是给用户看的最终回复。
const finalResponse = await modelWithTools.invoke(messages)

console.log(finalResponse.text)
```

这段代码里有两个很容易混掉的点：

- `bindTools()` 只是把工具说明交给模型

- 真正执行工具的是 `selectedTool.invoke(...)`

也就是说，模型不会直接替你跑函数。

它只是先说一句：“我想调这个工具，请你帮我执行。”

接下来再看 Agent 版本。

agent-with-tools.ts

```typescript
import { createAgent } from 'langchain'
import { getWeather, createReminder } from './companion-tools'

const agent = createAgent({
  model: 'openai:gpt-4.1-mini',
  tools: [getWeather, createReminder],
  systemPrompt: '你是用户的生活助理，能聊天，也能在必要时调用工具。',
})

const result = await agent.invoke({
  messages: [
    {
      role: 'user',
      content: '帮我看看明天上海天气，如果下雨就提醒我带伞。',
    },
  ],
})

// Agent 已经把前面的工具循环跑完了。
// 这里直接读取最后一条消息，就是这一轮最终回复。
console.log(result.messages.at(-1)?.text)
```

这两段代码做的是同一件事。

- 手动版：你自己维护「模型请求工具 -> 执行工具 -> 回传结果」这条循环

- Agent 版：这条循环交给 `createAgent(...)`

文章放两段代码，是为了把边界看清楚。

平时写应用时，直接用 Agent 会省很多事。

## 5. 多个工具接到一个 Agent 里

放回 AI 伴侣场景里，工具通常不止两个。

再加一个查日程的工具，整条链就完整了：

multi-tools-agent.ts

```typescript
import { createAgent, tool } from 'langchain'
import { z } from 'zod'

const getWeather = tool(
  async ({ city }) => {
    const data: Record<string, string> = {
      上海: '明天小雨，17-22 度',
      北京: '明天晴，12-25 度',
    }
    return data[city] ?? `${city}：暂无数据`
  },
  {
    name: 'get_weather',
    description: '查询某个城市未来的天气情况',
    schema: z.object({
      city: z.string().describe('要查询天气的城市名'),
    }),
  },
)

const createReminder = tool(
  async ({ content, time }) => {
    return `提醒已创建：${time} - ${content}`
  },
  {
    name: 'create_reminder',
    description: '帮用户创建一个提醒事项',
    schema: z.object({
      content: z.string().describe('提醒的具体内容'),
      time: z.string().describe('提醒时间，例如 明天早上 8 点'),
    }),
  },
)

const querySchedule = tool(
  async ({ date }) => {
    const schedules: Record<string, string> = {
      明天: '10:00 产品评审会，14:00 和小李 1v1',
      后天: '全天无日程',
    }
    return schedules[date] ?? `${date}：没有找到日程`
  },
  {
    name: 'query_schedule',
    description: '查询用户某一天的日程安排',
    schema: z.object({
      date: z.string().describe('要查询的日期，例如 今天、明天、后天'),
    }),
  },
)

const agent = createAgent({
  model: 'openai:gpt-4.1-mini',
  tools: [getWeather, createReminder, querySchedule],
  systemPrompt: `
你是用户的 AI 伴侣。
当用户请求涉及天气、提醒和日程时，使用对应工具。
如果用户只是在聊天，就直接回复，不要硬调工具。
  `.trim(),
})

const result = await agent.invoke({
  messages: [
    {
      role: 'user',
      content: '明天上海天气怎么样？如果下雨，明早提醒我带伞。顺便看看我明天有什么安排。',
    },
  ],
})

console.log(result.messages.at(-1)?.text)
```

这类请求里，Agent 可能会连续做几件事：

- 先查天气

- 再判断要不要建提醒

- 还可能再去查日程

你在调用入口里只写了一次 `agent.invoke(...)`，中间怎么循环、要不要继续调下一个工具，已经交给 Agent。

## 6. 写工具时，几个地方最容易出错

**描述写得太空**

如果 `description` 只写「查询信息」「执行操作」，模型很难判断它什么时候该用这个工具。

描述里最好直接写清楚：

- 这个工具解决什么问题

- 用户说到什么场景时该调用

- 参数大概是什么含义

**参数结构太宽**

别把所有输入都塞成一个大字符串。

bad-tool-schema.ts

```typescript
schema: z.object({
  input: z.string(),
})
```

这种写法短期看着省事，后面最难排查。

如果你知道工具要 `city`、`time`、`content` 这几个字段，就直接拆出来。

**以为绑定后就会自动执行**

`bindTools()` 只负责把工具定义交给模型。

如果你没有用 Agent，就还得自己跑那条工具循环。

**一个工具里塞太多事**

像下面这种「万能工具」通常不好用：

assistant-action.ts

```typescript
const assistantAction = tool(
  async ({ action, payload }) => {
    // 根据 action 再去分发天气、提醒、日程等逻辑
  },
  {
    name: 'assistant_action',
    description: '处理所有外部动作',
    schema: z.object({
      action: z.string(),
      payload: z.string(),
    }),
  },
)
```

这样做会让模型更难选工具，也更难把参数填稳。

一般来说，一个工具只负责一类明确动作，会更好维护。

## 7. 记住这几件事

这一篇真正要记住的是这几件事：

- Tool 是给模型看的「外部能力说明书」

- 模型返回 `tool_calls`，不等于工具已经执行

- 手动版里，要自己维护那条工具循环

- Agent 版里，这条循环交给 `createAgent(...)`

这一篇和下一篇是接着的：

- 这一篇先把工具调用过程拆开

- 下一篇再看单个 Agent 怎么把多个工具接起来
