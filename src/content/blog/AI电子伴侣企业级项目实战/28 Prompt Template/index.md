---
title: "28 Prompt Template"
pubDate: 2026-04-21
description: "Prompt Template 的作用，就是先把这一轮输入整理好，再交给 Agent。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/4-prompt-template/](https://aicompanion.usehook.cn/4-prompt-template/)

## 1. Prompt Template 在 Agent 里是做什么的

消息知道怎么传之后，下一步就是把这一轮输入整理成稳定结构。

先看一个最直接的 `Agent` 调用：

index.ts

```typescript
const stream = await agent.stream({
  messages: [
    {
      role: 'user',
      content: '解释一下消息协议。',
    },
  ],
}, {
  streamMode: 'messages',
})
```

这段代码在最小示例里没问题。

但只要场景稍微复杂一点，输入很快就不止一条 `user` 消息了。

比如同一轮请求里，可能还会有：

- 用户昵称

- 当前场景

- 额外补充说明

- 历史消息

- 固定的回复风格

这些东西继续手写在消息数组里，代码会越来越散。

Prompt Template 的作用，就是先把这一轮输入整理好，再交给 Agent。

## 2. 案例

假设现在有一个陪伴型 Agent，已经定义好了默认设定：

index.ts

```typescript
import { createAgent } from 'langchain'
import { ChatOpenAI } from '@langchain/openai'

const model = new ChatOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})

const agent = createAgent({
  model,
  tools: [],
  systemPrompt: '你是一名温和、克制、说话自然的陪伴助手。',
})
```

现在这一轮请求里，我们还想补充几项动态信息：

- 用户昵称

- 当前场景

- 本轮输入

这时候可以先用模板把它们组织成消息：

index.ts

```typescript
import { ChatPromptTemplate } from '@langchain/core/prompts'

const prompt = ChatPromptTemplate.fromMessages([
  [
    'user',
    [
      '用户昵称：{nickname}',
      '当前场景：{scene}',
      '本轮输入：{input}',
    ].join('\n'),
  ],
])
```

真正调用时，先把变量格式化成消息：

index.ts

```typescript
const messages = await prompt.formatMessages({
  nickname: '小林',
  scene: '下班后情绪低落，想找人聊一会儿',
  input: '今天真的有点烦，不太想继续改需求了。',
})
```

再把整理好的消息交给 Agent：

index.ts

```typescript
const stream = await agent.stream({
  messages,
}, {
  streamMode: 'messages',
})
```

这就是这一篇最核心的用法：

**Prompt Template 先组织输入，Agent 再根据这份输入继续运行。**

## 3. 模板真正解决的是「固定部分」和「变化部分」分开写

如果不用模板，这一轮输入通常会直接写成这样：

index.ts

```typescript
const messages = [
  {
    role: 'user',
    content: [
      '用户昵称：小林',
      '当前场景：下班后情绪低落，想找人聊一会儿',
      '本轮输入：今天真的有点烦，不太想继续改需求了。',
    ].join('\n'),
  },
]
```

只写一次当然没什么问题。

但后面只要有变量变化，这段结构就要反复手写。

Prompt Template 的写法在代码维护上更友好：

index.ts

```typescript
import { ChatPromptTemplate } from '@langchain/core/prompts'

const prompt = ChatPromptTemplate.fromMessages([
  [
    'user',
    [
      '用户昵称：{nickname}',
      '当前场景：{scene}',
      '本轮输入：{input}',
    ].join('\n'),
  ],
])
```

这里真正固定下来的，是消息结构。

真正变化的，是 `nickname`、`scene`、`input` 这些变量。

这样后面你要改字段、加字段、删字段，都会轻松很多。

## 4. prompt.formatMessages() 和 agent.stream() 是两步

这一步最好分清楚，不然后面很容易写乱。

模板调用：

index.ts

```typescript
const messages = await prompt.formatMessages({
  nickname: '小林',
  scene: '下班后情绪低落，想找人聊一会儿',
  input: '今天真的有点烦，不太想继续改需求了。',
})
```

这里拿到的还不是模型回复，也不是 `Agent` 回复。

拿到的是格式化后的消息数组。

你可以先打印出来看一下：

index.ts

```typescript
console.log(messages)
```

这一步特别适合排查输入问题。

变量有没有替换对，消息顺序对不对，一眼就能看出来。

真正让 Agent 开始工作，是下一步：

index.ts

```typescript
const stream = await agent.stream({
  messages,
}, {
  streamMode: 'messages',
})
```

所以这里的分工很明确：

- `prompt.formatMessages(...)`：生成这一轮的消息输入

- `agent.stream(...)` / `agent.invoke(...)`：让 Agent 开始处理这一轮输入

## 5. 多轮对话里要用 MessagesPlaceholder

只有当前输入时，模板还比较简单。

一旦进入多轮对话，历史消息就不能继续手塞在模板字符串里了。

这时候要用 `MessagesPlaceholder` 给历史消息留一个插槽。

index.ts

```typescript
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'

const prompt = ChatPromptTemplate.fromMessages([
  new MessagesPlaceholder({
    variableName: 'history',
    optional: true,
  }),
  [
    'user',
    [
      '用户昵称：{nickname}',
      '当前场景：{scene}',
      '本轮输入：{input}',
    ].join('\n'),
  ],
])
```

这个模板的意思很直接：

- 前面插入历史消息

- 后面放当前这一轮输入

真正调用时，再把历史消息传进去：

index.ts

```typescript
const messages = await prompt.formatMessages({
  history: [
    {
      role: 'user',
      content: '今天开会又改需求了。',
    },
    {
      role: 'assistant',
      content: '听起来你已经有点烦了，最麻烦的是哪一段？',
    },
  ],
  nickname: '小林',
  scene: '下班路上，还在想白天的事情',
  input: '最烦的是昨天刚定下来，今天又推翻了。',
})
```

整理好之后，再交给 Agent：

index.ts

```typescript
const result = await agent.invoke({
  messages,
})
```

这样历史消息和当前输入的顺序就稳定下来了，不需要每次手动拼。

## 6. systemPrompt 和模板不要写重复

这里有个很常见的坑。

Agent 本身已经有 `systemPrompt`：

index.ts

```typescript
const agent = createAgent({
  model,
  tools: [],
  systemPrompt: '你是一名温和、克制、说话自然的陪伴助手。',
})
```

这时候模板里就不要再重复写一大段完全一样的 `system` 消息了。

更稳的分工是：

- 长期稳定的人设、规则，放进 `systemPrompt`

- 当前这一轮才会变化的上下文，放进 Prompt Template

这样做的好处很直接：

- Agent 的长期设定固定在一个地方

- 每一轮请求的动态输入由模板来管

- 后面调整时不容易重复或冲突

## 7. 总结

这一篇的主线可以压成下面这个顺序：

- 先创建 Agent

- 再用 `ChatPromptTemplate` 整理这一轮输入

- 如果有历史消息，就加 `MessagesPlaceholder`

- 把模板生成的消息交给 `agent.invoke()` 或 `agent.stream()`

写成代码，大致就是这个形状：

index.ts

```typescript
const messages = await prompt.formatMessages({
  history: [
    {
      role: 'user',
      content: '今天开会又改需求了。',
    },
    {
      role: 'assistant',
      content: '听起来你已经有点烦了，最麻烦的是哪一段？',
    },
  ],
  nickname: '小林',
  scene: '下班路上，还在想白天的事情',
  input: '最烦的是昨天刚定下来，今天又推翻了。',
})

const stream = await agent.stream(
  {
    messages,
  },
  {
    streamMode: 'messages',
  }
)
```
