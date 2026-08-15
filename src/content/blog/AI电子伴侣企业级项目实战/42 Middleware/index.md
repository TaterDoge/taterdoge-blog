---
title: "42 Middleware"
pubDate: 2026-04-25
description: "到前一篇为止，一个单 Agent 已经能接多个工具，也能在一轮里连续做几件事了。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/18-middleware/](https://aicompanion.usehook.cn/18-middleware/)

## 1. 同一个 Agent，白天和深夜不一定该做同样的事

到前一篇为止，一个单 Agent 已经能接多个工具，也能在一轮里连续做几件事了。

这时候很快会碰到一个更实际的问题。

比如你做的是一个 AI 伴侣。白天，用户说：

daytime-scene.txt

```txt
帮我看看明天的安排，再顺手建一个 8 点起床提醒。
```

这类请求很正常，查日程、建提醒都可以照常做。

但如果深夜两点，用户说：

night-scene.txt

```txt
我现在有点烦，顺便帮我把明天所有安排都取消掉。
```

这时候你可能不想让 Agent 立刻去动用户的日程。

你更希望它先安抚一下，再把这类高风险动作拦下来，或者至少换一种更谨慎的处理方式。

问题就在这里：

工具本身没有错，Agent 也没有错。

你只是希望同一个 Agent，在不同运行场景里，多一层规则。

Middleware 就是放这层规则的地方。

## 2. Middleware 放在 Agent 循环的外面，但又贴着它

可以把它理解成一层夹在 Agent 运行过程周围的薄壳。

用户消息进来以后，Agent 还是会照常去做这些事：

- 调模型

- 决定要不要用工具

- 执行工具

- 再继续往下走

Middleware 不负责替代这些步骤。

它负责在这些步骤的前后插手一下。

最常见的几种用法其实都很朴素：

- 改一下这一轮的 system prompt

- 根据上下文决定哪些工具能用

- 在工具报错时做一层兜底

- 记录一些运行信息，方便后面排错

这一篇先只讲前面三种，不去展开 tracing。

## 3. 先做一个最实用的：根据场景改 system prompt

先从最容易感受到价值的地方开始。

还是刚才那个 AI 伴侣。我们希望它在深夜时更克制一点，不要把回复写得太像白天的办事助手。

这件事不用改工具，也不用重写 Agent。

直接在 Agent 外面挂一层 middleware 就够了。

dynamic-system-prompt.ts

```typescript
import * as z from 'zod'
import { createAgent, dynamicSystemPromptMiddleware, tool } from 'langchain'

const contextSchema = z.object({
  isQuietHours: z.boolean(),
})

const querySchedule = tool(
  async ({ date }) => `${date}：10:00 产品评审会，14:00 和小李 1v1`,
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
  tools: [querySchedule],
  contextSchema,
  middleware: [
    dynamicSystemPromptMiddleware<z.infer<typeof contextSchema>>((state, runtime) => {
      // 这里不是改用户消息，而是按运行时上下文决定这一轮的行为准则。
      // 同一个 Agent，在不同场景里可以临时换一套说话方式。
      if (runtime.context.isQuietHours) {
        return `
你是用户的深夜陪伴助手。
回复要短一点，先照顾用户情绪。
如果请求涉及高风险操作，不要直接执行，先提醒用户白天再确认一次。
        `.trim()
      }

      return `
你是用户的生活助理。
在需要时可以查询日程并提供简洁帮助。
      `.trim()
    }),
  ],
})

const result = await agent.invoke(
  {
    messages: [
      {
        role: 'user',
        content: '帮我看看明天的安排。',
      },
    ],
  },
  {
    // 这份 context 不会直接出现在消息里，
    // 但 middleware 可以在运行时读到它。
    context: { isQuietHours: true },
  },
)

console.log(result.messages.at(-1)?.text)
```

这一层最重要的地方，不是 API 名字，而是思路。

以前你可能会把「白天模式」和「深夜模式」硬塞进一个超长 `systemPrompt` 里，然后让模型自己猜。

现在这层逻辑可以明确写在 middleware 里，运行时到了哪种场景，就切哪种规则。

## 4. 再往前走一步：有些工具，深夜就先别给它看见

只改 system prompt 还不够的时候，就要开始动工具列表了。

还是同一个场景。假设你的 Agent 平时有这几个工具：

- 查日程

- 建提醒

- 取消日程

白天都能用没有问题。

但深夜两点，你不想让它直接看到 `cancel_schedule` 这种工具。

这时候 middleware 可以在模型调用前，把工具列表过滤一遍。

filter-tools.ts

```typescript
import * as z from 'zod'
import { createAgent, createMiddleware, tool } from 'langchain'

const contextSchema = z.object({
  isQuietHours: z.boolean(),
})

const querySchedule = tool(
  async ({ date }) => `${date}：10:00 产品评审会，14:00 和小李 1v1`,
  {
    name: 'query_schedule',
    description: '查询用户某一天的日程安排',
    schema: z.object({
      date: z.string().describe('要查询的日期'),
    }),
  },
)

const cancelSchedule = tool(
  async ({ date }) => `${date}：日程取消申请已提交`,
  {
    name: 'cancel_schedule',
    description: '取消用户某一天的重要日程',
    schema: z.object({
      date: z.string().describe('要取消的日期'),
    }),
  },
)

const quietHoursMiddleware = createMiddleware({
  name: 'QuietHoursToolFilter',
  contextSchema,
  wrapModelCall: (request, handler) => {
    // 白天照常放行。
    if (!request.runtime.context.isQuietHours) {
      return handler(request)
    }

    // 深夜时，把高风险工具先从这一轮可见工具里拿掉。
    const filteredTools = request.tools.filter((tool) => tool.name !== 'cancel_schedule')

    return handler({
      ...request,
      tools: filteredTools,
    })
  },
})

const agent = createAgent({
  model: 'openai:gpt-4.1-mini',
  tools: [querySchedule, cancelSchedule],
  contextSchema,
  middleware: [quietHoursMiddleware],
})

const result = await agent.invoke(
  {
    messages: [
      {
        role: 'user',
        content: '帮我把明天的安排都取消掉。',
      },
    ],
  },
  {
    context: { isQuietHours: true },
  },
)

console.log(result.messages.at(-1)?.text)
```

这一段代码里，工具本身完全没改。

变的是这一轮模型到底能看到哪些工具。

这类写法很适合做：

- 深夜模式

- 权限控制

- 某些阶段先隐藏高级工具

- 新用户只开放一部分能力

它的好处是很直接。

模型根本看不到不该用的工具，自然就不会调它。

## 5. 工具执行时出错了，也别把整轮对话撞断

还有一种场景很常见。

工具明明设计好了，但外部接口偶尔会报错。

比如日程服务超时、天气接口挂了、数据库临时没连上。

如果你什么都不做，这类异常可能会直接把整轮对话打断。

middleware 可以在工具调用外面包一层，把错误转成一条工具结果，再交回模型继续往下走。

tool-error-middleware.ts

```typescript
import { createAgent, createMiddleware, ToolMessage, tool } from 'langchain'
import * as z from 'zod'

const getWeather = tool(
  async ({ city }) => {
    // 这里故意模拟外部服务出错。
    throw new Error(`天气服务暂时不可用：${city}`)
  },
  {
    name: 'get_weather',
    description: '查询某个城市未来的天气情况',
    schema: z.object({
      city: z.string().describe('要查询天气的城市名'),
    }),
  },
)

const handleToolErrors = createMiddleware({
  name: 'HandleToolErrors',
  wrapToolCall: async (request, handler) => {
    try {
      // 正常情况下，工具还是按原样执行。
      return await handler(request)
    } catch (error) {
      // 报错时，不直接把整轮调用打断。
      // 这里返回一条 ToolMessage，让模型知道“工具失败了”，再自己组织回复。
      return new ToolMessage({
        content: `工具调用失败，请先不要继续依赖这个结果。错误信息：${String(error)}`,
        tool_call_id: request.toolCall.id!,
      })
    }
  },
})

const agent = createAgent({
  model: 'openai:gpt-4.1-mini',
  tools: [getWeather],
  middleware: [handleToolErrors],
})

const result = await agent.invoke({
  messages: [
    {
      role: 'user',
      content: '帮我看看明天上海天气。',
    },
  ],
})

console.log(result.messages.at(-1)?.text)
```

这一层很适合留给用户一个更平滑的结果。

用户看到的不会是一大段报错栈，而是一句还能接得住对话的话。

## 6. 写 middleware 时，先把边界想清楚

刚开始接 middleware，最容易写乱的地方不是 hook 名字，而是边界。

有些逻辑应该放 middleware，有些不该。

如果你要改的是这一轮运行规则，比如深夜模式、权限、工具暴露范围、错误兜底，那放 middleware 很合适。

因为这些东西横跨整条调用链，不属于某一个工具，也不该散在每个工具里重复写。

但如果你要做的是某个工具自己的业务逻辑，比如「提醒写进哪张表」「取消日程时要不要发通知」，那还是回到工具函数里写。

middleware 不适合接管具体业务。

还有一个很实用的判断办法：

如果这段逻辑删掉以后，工具本身还能独立成立，那它大概率适合写成 middleware。

如果删掉以后，工具就根本不完整了，那它通常不该放到 middleware 里。

## 7. 到这里，Agent 已经不像一段裸调用了

写完这一篇以后，单个 Agent 的样子会开始不一样。

它不再只是：

- 接消息

- 调工具

- 回答案

中间已经多了一层运行规则。

同一个 Agent，在不同上下文里可以有不同说话方式；

同一个工具列表，在不同场景里可以只开放一部分；

同一个工具出错时，也可以先被接住，再继续把这轮对话走完。

下一篇再往后接，就可以专门讲 tracing。

到那时，关注点就不是「这一层规则怎么加」，而是「Agent 实际跑的时候，到底都发生了什么」。
