---
title: "55 Supervisor 模式"
pubDate: 2026-04-29
description: "但业务再往前走一步，问题就不只是「流程有多长」了，而是「是不是所有事都该让一个角色来做」。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/12-supervisor/](https://aicompanion.usehook.cn/12-supervisor/)

## 1. 一个人开始忙不过来时，就会想拆角色

前面几篇一直在写一张图里的节点怎么配合。

到了这里，图已经能暂停、恢复、拆子图，也能把一段流程包成模块。

但业务再往前走一步，问题就不只是「流程有多长」了，而是「是不是所有事都该让一个角色来做」。

比如一个个人助理系统，用户可能一口气说一句话：

「帮我看看周五下午有没有空，再起草一封邮件给客户，说我们把会议改到三点。」

这句话里其实有两种完全不同的能力。一种是查日程、安排时间，一种是写邮件、组织措辞。把它们全塞给一个 Agent 当然也能写，但工具一多、提示词一长、上下文一杂，决策就开始变得不稳定。

这时候更顺的办法通常不是继续往一个 Agent 身上加东西，而是把角色拆开：让一个总控角色负责判断眼前要找谁处理，再把具体工作交给对应的专门 Agent。

这就是 `Supervisor` 模式。

## 2. Supervisor 到底在做什么

先把名字放轻一点看。`Supervisor` 不是什么特殊 API，它更像一种组织方式。

它做的事情其实很简单。自己不直接处理所有细节，手里握着几个专门 Agent，先判断当前请求应该交给谁，拿到结果以后，再决定要不要继续找下一个角色，或者直接回复用户。

如果把前面那句用户请求拆开看，`Supervisor` 可能会先把「看周五下午有没有空」交给日程 Agent，再把「起草邮件」交给邮件 Agent，最后把两边结果收回来，整理成一段最终回复。

这里真正重要的，不是「角色变多了」，而是上下文开始分层了。日程 Agent 不用知道怎么写邮件，邮件 Agent 也不用关心所有日历工具的细节。每个角色只管自己那一块。

## 3. 先把两个专门 Agent 准备出来

这一篇先用两个最容易理解的角色来讲：一个是 `calendarAgent`，只负责查空闲时间和安排会议；另一个是 `emailAgent`，只负责起草和发送邮件。

当前这套官方示例更常见的写法，是把专门 Agent 包成工具，让总控 Agent 去调用。因为总控 Agent 眼里不需要看见每个底层 API，只需要知道「这里有一个日程专家」和「这里有一个邮件专家」就够了。

这一层虽然写的是 `createAgent()`，但关注点已经不是单个 Agent 自己怎么调工具了，而是多个角色之间怎么分工、怎么把结果重新收回来。

specialist-agents.ts

```typescript
import { createAgent, tool } from 'langchain'
import { ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'

const model = new ChatOpenAI({
  model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL,
  },
})

// 先准备底层工具。专门 Agent 真正做事时，还是靠这些工具落地。
const checkCalendar = tool(
  async ({ date, period }) => {
    return `${date} 的 ${period} 目前空闲，可以安排会议。`
  },
  {
    name: 'check_calendar',
    description: '查看某一天某个时间段是否空闲',
    schema: z.object({
      date: z.string(),
      period: z.string(),
    }),
  },
)

const draftEmail = tool(
  async ({ to, subject, body }) => {
    return `邮件草稿已生成：收件人 ${to}，主题《${subject}》，正文：${body}`
  },
  {
    name: 'draft_email',
    description: '生成邮件草稿',
    schema: z.object({
      to: z.string(),
      subject: z.string(),
      body: z.string(),
    }),
  },
)

// 日程 Agent 只看日程领域的问题
const calendarAgent = createAgent({
  model,
  tools: [checkCalendar],
  systemPrompt: '你是一个日程助理，只处理时间、会议和安排相关的问题。',
})

// 邮件 Agent 只看邮件领域的问题
const emailAgent = createAgent({
  model,
  tools: [draftEmail],
  systemPrompt: '你是一个邮件助理，只处理邮件起草和发送相关的问题。',
})
```

这里先注意一个边界：专门 Agent 不一定要暴露给用户。很多时候，用户只和总控 Agent 对话，专门 Agent 只是系统内部角色。

## 4. 把专门 Agent 包成总控可调用的工具

到了 `Supervisor` 这一层，问题就变了。它不关心底层工具怎么用，它只关心：

「日程这件事交给谁。」

「邮件这件事交给谁。」

所以更顺的做法，是把 `calendarAgent` 和 `emailAgent` 再包一层，变成总控 Agent 眼里的两个高层工具。

wrap-subagents-as-tools.ts

```typescript
import { tool } from 'langchain'
import { z } from 'zod'

const askCalendarAgent = tool(
  async ({ request }) => {
    // 这里把一段自然语言请求交给日程 Agent
    const result = await calendarAgent.invoke({
      messages: [{ role: 'user', content: request }],
    })

    // 总控 Agent 最终只需要看这个角色返回了什么，
    // 不需要关心日程 Agent 内部到底调了哪些底层工具
    return result.messages.at(-1)?.text ?? ''
  },
  {
    name: 'ask_calendar_agent',
    description: '把与日程、会议安排有关的事情交给日程助理处理',
    schema: z.object({
      request: z.string(),
    }),
  },
)

const askEmailAgent = tool(
  async ({ request }) => {
    // 邮件 Agent 自己决定该怎么起草邮件、调用什么工具
    const result = await emailAgent.invoke({
      messages: [{ role: 'user', content: request }],
    })

    return result.messages.at(-1)?.text ?? ''
  },
  {
    name: 'ask_email_agent',
    description: '把与邮件起草、修改、发送有关的事情交给邮件助理处理',
    schema: z.object({
      request: z.string(),
    }),
  },
)
```

这样包完以后，总控 Agent 根本不需要知道 `check_calendar` 和 `draft_email` 的参数细节。它只会觉得自己手里有两个能力：

一个能处理日程，一个能处理邮件。

这也是 `Supervisor` 模式最顺手的地方。底层工具怎么变，可以留在专门 Agent 里慢慢演进，不需要每次都回头改总控。

## 5. 最上面这一层，就是 Supervisor

现在可以把总控 Agent 接起来了。

supervisor-agent.ts

```typescript
import { createAgent } from 'langchain'

const supervisor = createAgent({
  model,
  tools: [askCalendarAgent, askEmailAgent],
  systemPrompt: `
你是一个总控助理。
你的工作不是自己完成所有任务，而是判断当前请求应该交给哪个专门助理。
如果请求里同时包含多个任务，可以按顺序调用多个助理，再把结果整理给用户。
  `.trim(),
})
```

这时候，调用方式反而变简单了。用户还是只和一个入口对话。

supervisor-run.ts

```typescript
// 对用户来说，入口依然只有一个 supervisor
const result = await supervisor.invoke({
  messages: [{
    role: 'user',
    content: '帮我看看周五下午有没有空，再起草一封邮件给客户，说会议改到三点。',
  }],
})

console.log(result.messages.at(-1)?.text)
```

这段代码里，看上去只有一个 `supervisor.invoke(...)`，但内部可能已经做了多步：

先找日程 Agent，拿到可用时间，再找邮件 Agent 起草邮件，最后回到总控整理结果。

这也是为什么 `Supervisor` 模式会比「一个 Agent 手里挂十几个底层工具」更稳一些。总控层负责分工，专门角色负责执行，每一层看到的上下文都收得更干净。

## 6. 为什么它比把所有工具都塞到一个 Agent 里更顺

这件事真正的差别，不在于角色数量，而在于决策压力。

如果只有一个 Agent，它每次都要同时面对：
日程工具、邮件工具、提示词、用户历史、格式要求和错误处理。

工具少的时候没问题，工具一多，模型开始做选择时就容易发散。它既要判断这句话属于什么领域，又要记住每个工具的参数要求，还要想怎么把多步任务串起来。

`Supervisor` 模式把这个压力拆开了。总控层先只做分工，专门层再各自处理自己的细节。这样每个 Agent 的工具范围会小很多，提示词也会短很多。

还有一个很实际的好处，是后面更容易加角色。今天只有日程和邮件，明天再加一个「知识库助理」，你不需要去重写整个系统，只要：

先新建一个专门 Agent，再把它包成一个总控可调用的工具，最后挂到 `supervisor` 上，整套结构就能继续往前长。

## 7. 写这种模式时最容易踩的坑

最常见的问题，是把总控 Agent 写得太勤快。

如果总控层自己也开始直接查日程、直接写邮件、直接做格式整理，那角色边界很快就会乱掉。写着写着，它又变回了一个什么都做的大 Agent，前面拆角色的意义就没了。

第二个常见问题，是让专门 Agent 看到太多不该看到的上下文。比如邮件 Agent 本来只需要知道「帮我写一封改期邮件」，你却把整段长长的历史对话、审批信息、其它工具结果一股脑都塞给它。这样一来，专门 Agent 的上下文又开始膨胀，角色拆分的好处也被吃掉了。

还有一个问题，是把专门 Agent 当成长期记忆主体。当前这类 `subagents` 结构里，更稳的心智模型是：会话记忆主要留在总控层，专门 Agent 每次按任务被调用，处理完就把结果交回来。这样边界更清楚，也更容易排查问题。

## 8. 总结

`Supervisor` 模式本质上是在做一件很朴素的事：把一个开始忙不过来的 Agent，拆成一个总控角色和几个专门角色。

前面这一章写到现在，已经把流程控制、暂停恢复、子图模块化都接起来了。到了这里，视角又往前走了一步，不再只是「一张图怎么组织」，而是「多个角色怎么分工」。

下一篇讲 **Handoff 与 Swarm**。到那时，重点就不再是「总控负责分发任务」，而是「角色之间能不能直接把对话和控制权交给彼此」。
