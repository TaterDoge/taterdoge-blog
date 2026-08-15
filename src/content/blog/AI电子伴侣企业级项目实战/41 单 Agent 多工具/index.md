---
title: "41 单 Agent 多工具"
pubDate: 2026-04-25
description: "真正写应用时，我们很少停在「模型先提请求，我再手动执行工具」这一步，更常见的是直接把几个工具交给一个 Agent，让它自己决定这一轮怎么走。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/17-single-agent-multi-tools/](https://aicompanion.usehook.cn/17-single-agent-multi-tools/)

## 1. 一个很常见的使用场景

前面一篇把 Tool Calling 拆开看了一遍，原理已经清楚了。

真正写应用时，我们很少停在「模型先提请求，我再手动执行工具」这一步，更常见的是直接把几个工具交给一个 Agent，让它自己决定这一轮怎么走。

AI 伴侣里很容易遇到这样的请求：

companion-scene.txt

```txt
明天上海天气怎么样？如果下雨，明早提醒我带伞。顺便看看我明天有什么安排。
```

这不是三个独立问题，而是一句话里的三件事：

- 先查天气

- 如果天气结果触发条件，再建提醒

- 再去查一次日程

这种场景正适合单个 Agent。

因为这里还没有出现多个角色分工，也没有复杂审批流。我们只是希望有一个 Agent 能在同一轮里连续用几个工具，把事情做完，然后给用户一个自然的回复。

## 2. 先看最后要做成什么样

先不急着拆代码，先看最后调用时应该长什么样。

agent-call.ts

```typescript
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

真正对外暴露的入口，最好就这么简单。

调用这一行代码时，我们希望 Agent 能自己完成这些事：

- 先判断这句话里需要哪些工具

- 先查天气

- 如果天气结果满足条件，再去建提醒

- 再查日程

- 最后把结果整理成一段像人说的话

前面手动循环那篇，是为了把过程讲透。

从这一篇开始，就不再让调用方手动维护那条循环了。

## 3. 先把三个工具准备好

这三个工具本身都不复杂，关键是职责要清楚。

companion-tools.ts

```typescript
import { tool } from 'langchain'
import { z } from 'zod'

// 只负责查天气。
// 正式项目里，这里通常会请求天气 API。
export const getWeather = tool(
  async ({ city }) => {
    const data: Record<string, string> = {
      上海: '明天小雨，17-22 度',
      北京: '明天晴，12-25 度',
      深圳: '明天多云，26-30 度',
    }

    return data[city] ?? `${city}：暂无天气数据`
  },
  {
    name: 'get_weather',
    description: '查询某个城市未来的天气情况',
    schema: z.object({
      city: z.string().describe('要查询天气的城市名'),
    }),
  },
)

// 只负责创建提醒。
// 返回对象会比纯字符串更清楚，后面模型也更容易读。
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
      content: z.string().describe('提醒内容'),
      time: z.string().describe('提醒时间，例如 明天早上 8 点'),
    }),
  },
)

// 只负责查日程。
// 正式项目里，这里通常会查数据库或者日历服务。
export const querySchedule = tool(
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
```

这里最容易写乱的地方，其实不是 `tool()` 这个 API，而是边界。

如果一个工具里既查天气又建提醒又查日程，模型会更难选，也更难把参数填稳。

把工具拆得明确一点，后面调试会轻松很多。

## 4. 把它们交给同一个 Agent

到这里，Agent 的代码反而比工具本身还短。

single-agent.ts

```typescript
import { createAgent } from 'langchain'
import { getWeather, createReminder, querySchedule } from './companion-tools'

const agent = createAgent({
  model: 'openai:gpt-4.1-mini',
  tools: [getWeather, createReminder, querySchedule],
  systemPrompt: `
你是用户的 AI 伴侣。

当用户的问题涉及天气、提醒和日程时，使用对应工具。
如果一句话里有多件事，就按顺序处理。
如果用户只是在聊天，就直接回复，不要强行调用工具。
  `.trim(),
})
```

这里有一个变化很重要。

前一篇里，我们自己维护：

- 模型返回 `tool_calls`

- 程序执行工具

- 再把工具结果交还给模型

这一篇里，这段循环已经交给 `createAgent(...)` 了。

所以你在入口上只看到一次 `agent.invoke(...)`，但 Agent 内部可能已经跑了不止一次工具调用。

## 5. 一轮请求里，Agent 可能会连续做几件事

先看一段完整调用：

single-agent-run.ts

```typescript
import { createAgent } from 'langchain'
import { getWeather, createReminder, querySchedule } from './companion-tools'

const agent = createAgent({
  model: 'openai:gpt-4.1-mini',
  tools: [getWeather, createReminder, querySchedule],
  systemPrompt: `
你是用户的 AI 伴侣。
当用户的请求涉及天气、提醒和日程时，使用对应工具。
如果一句话里有多件事，就按顺序处理。
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

// 最后一条消息就是这一轮最终回复。
// 前面的工具调用和中间结果，Agent 已经替我们处理好了。
console.log(result.messages.at(-1)?.text)
```

这段代码对外只有一个入口，但 Agent 在内部很可能会走成这样：

agent-multi-tools.txt

```txt
1. 先调用 get_weather({ city: '上海' })
2. 读到天气结果是“小雨”
3. 再调用 create_reminder({ content: '带伞', time: '明天早上' })
4. 再调用 query_schedule({ date: '明天' })
5. 最后把天气、提醒、日程合并成一段回复
```

也就是说，单个 Agent 不是「一次请求只能调一个工具」。

只要这句话里确实需要多步动作，它可以在同一轮里连续往下走。

如果你想把这个过程看得更明显一点，可以直接把消息打印出来：

inspect-messages.ts

```typescript
for (const message of result.messages) {
  // 这里通常能看到：
  // user 消息
  // assistant 发起的工具调用
  // tool 返回结果
  // assistant 最终回复
  console.log(message.getType(), message.text ?? message.content)
}
```

这一段很适合调试。

当你怀疑 Agent 为什么没调工具、或者调错了工具，先看 `result.messages` 往往比先改 Prompt 更有用。

## 6. 什么时候一个 Agent 还够用

写到这里，单个 Agent 已经能做不少事了。

像下面这种情况，单个 Agent 往往就够：

用户一句话里有几步动作，但都属于同一个角色在帮他办事。

比如查天气、建提醒、查日程、查知识库、发一条总结，这些都还是同一个生活助理的职责。

这时候继续拆成多个 Agent，收益不一定大，反而会先把结构变复杂。

单个 Agent 先把这些工具接稳，通常是更顺的做法。

真正开始需要再往下拆，一般是因为下面这些情况开始出现了：

- 工具越来越多，描述开始互相打架

- 一轮请求里不仅是多步动作，还开始出现不同角色分工

- 某些步骤需要长期状态、审批、回退或人工介入

那时就不是这一篇要解决的问题了。

## 7. 写这种 Agent 时，最容易卡住的地方

最常见的卡点通常不是 `createAgent(...)` 本身，而是下面这几种情况。

工具的描述太短，模型不知道什么时候该用它。

比如 `description` 只写「查询信息」，那和不写差不多。描述里最好直接点出场景和用途。

工具边界太宽，一个工具里包了太多动作。

模型要先猜 `action`，再猜 `payload`，最后还要靠你在函数里二次分发，这一层很容易出问题。

一句话里有多件事，但 `systemPrompt` 没告诉 Agent 可以按顺序处理。

这时模型有时会只做第一件，后面的动作直接漏掉。

还有一种很常见：工具其实已经调了，但你只盯着最终回复，没看中间消息。

这时最简单的办法不是猜，而是把 `result.messages` 打出来看。

单个 Agent 调多个工具，说到底没有多神秘。

前面几篇准备的东西，走到这里刚好接上：消息、Prompt、LCEL、检索、Tool，最后都汇成这一个入口。
