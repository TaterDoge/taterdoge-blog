---
title: "29 Few-Shot 与动态 Prompt"
pubDate: 2026-04-21
description: "这些规则写进 systemPrompt 或 Prompt Template 当然有用。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/5-few-shot-prompt/](https://aicompanion.usehook.cn/5-few-shot-prompt/)

## 1. Prompt 模板写好了，为什么还会不稳定

上一篇已经把 Prompt Template 接到 Agent 上了。

现在一轮请求里的输入结构已经能稳定组织出来了。

但这时候很快会遇到另一个问题：

结构是对的，回答风格却不一定稳定。

比如同样是陪伴型 Agent，你可能希望它始终做到下面三件事：

- 先接住情绪，再给建议

- 回复控制在 3 句话以内

- 不要一上来就说教

这些规则写进 `systemPrompt` 或 Prompt Template 当然有用。

但实际跑起来时，模型有时还是会忽长忽短，或者突然换成一种很生硬的语气。

Few-Shot 要解决的就是这个问题。

它不是再多加一条规则，而是给模型看几组“你希望它怎么答”的样板。

规则告诉模型该做什么。

示例告诉模型做出来应该长什么样。

## 2. 先看一个最小的 Agent 场景

先把场景压到最小。

现在有一个陪伴型 Agent，默认设定是：

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
  systemPrompt: '你是一名面向前端开发者的陪伴助手。先共情，再给建议，控制在 3 句话以内。',
})
```

如果这一轮输入是：

code.ts

```txt
今天被改了好多次需求，我现在真的有点烦。
```

只靠规则，模型大概率能答对方向。

但“共情到什么程度”“建议要具体到什么粒度”“语气要多自然”，都还是容易飘。

所以这时候更稳的做法是，再补两组示例。

## 3. Few-Shot 的基本写法

在 LangChain.js 里，chat 场景下最常用的是 `FewShotChatMessagePromptTemplate`。

先看一个完整一点的例子：

index.ts

```typescript
import {
  ChatPromptTemplate,
  FewShotChatMessagePromptTemplate,
} from '@langchain/core/prompts'

const examples = [
  {
    input: '今天开会被否了 3 次，我有点怀疑自己。',
    output:
      '被连续否定确实很伤状态，但这不等于你能力不行。先把被否的点拆成“需求变化”和“表达问题”两类，你会更容易看清哪里该改。今晚先别继续内耗，把问题归档下来就够了。',
  },
  {
    input: '我明知道要学 React 19，可一下班就只想躺着刷手机。',
    output:
      '你不是不想学，你只是下班后已经没有整块意志力了。今晚别定大目标，只看 15 分钟一个小点。先把启动门槛降下来，反而更容易重新进入状态。',
  },
]

const examplePrompt = ChatPromptTemplate.fromMessages([
  ['user', '{input}'],
  ['assistant', '{output}'],
])

const fewShotPrompt = new FewShotChatMessagePromptTemplate({
  examples,
  examplePrompt,
  inputVariables: [],
})

const prompt = ChatPromptTemplate.fromMessages([
  ...(await fewShotPrompt.formatMessages({})),
  ['user', '{input}'],
])
```

这里分成了三层：

- `examples`：准备示例数据

- `examplePrompt`：规定每条示例怎样变成消息

- `fewShotPrompt`：把所有示例拼成一个可插入的模板块

这一步里，角色我建议统一用：

- `user`

- `assistant`

不要再在这篇里混用 `human` / `ai`，这样和前面几篇的 Agent 主线会更一致。

## 4. 先生成消息，再交给 Agent

Few-Shot 写到这里，还没有真正调用 Agent。

先做的事情还是和上一篇一样：

先让模板把这一轮消息组织出来。

index.ts

```typescript
const promptValue = await prompt.invoke({
  input: '今天被改了好多次需求，我现在真的有点烦。',
})

console.log(promptValue.toChatMessages())
```

如果你把它打印出来，会看到最终消息大致是这个顺序：

- 第一组示例的 `user`

- 第一组示例的 `assistant`

- 第二组示例的 `user`

- 第二组示例的 `assistant`

- 当前这一轮真实输入

也就是说，Few-Shot 本质上还是在组织消息。

只是这一次组织进去的，不只是规则和当前输入，还包括几组样板回答。

整理好之后，再把这些消息交给 Agent：

index.ts

```typescript
const result = await agent.invoke({
  messages: promptValue.toChatMessages(),
})

console.log(result.messages.at(-1)?.text)
```

放回这条主线里看，会更清楚一点：

- Prompt Template 负责整理一轮输入

- Few-Shot 负责补进示例样板

- Agent 负责真正处理这一轮输入

## 5. 为什么 Few-Shot 能让回答更稳

只写规则时，模型需要自己猜“你想要的回答长什么样”。

加上 Few-Shot 之后，这部分信息就不再是抽象要求，而是具体示例了。

上面的两组样例实际上给了模型几层很清楚的信号：

- 语气要自然，不要像在训人

- 先接情绪，再给建议

- 建议要能立刻执行

- 回复长度要短，不要散

所以 Few-Shot 解决的，通常不是“知识不够”，而是：

- 风格不稳定

- 格式不稳定

- 判断粒度不稳定

这也是为什么它特别适合放在陪伴型 Agent、分类型 Agent、结构化输出型 Agent 前面。

## 6. 多轮对话里，Few-Shot 应该放在哪

到了多轮对话，输入里通常不止当前这一轮，还会有历史消息。

这时候更常见的写法是把 `FewShotChatMessagePromptTemplate` 和 `MessagesPlaceholder` 放在一起：

index.ts

```typescript
import {
  ChatPromptTemplate,
  FewShotChatMessagePromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts'

const finalPrompt = ChatPromptTemplate.fromMessages([
  fewShotPrompt,
  new MessagesPlaceholder('history'),
  ['user', '{input}'],
])
```

真正调用时：

index.ts

```typescript
const promptValue = await finalPrompt.invoke({
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
  input: '最烦的是昨天刚定下来，今天又推翻了。',
})

const result = await agent.invoke({
  messages: promptValue.toChatMessages(),
})
```

这里没有唯一正确顺序。

有的项目会把 `history` 放在 `fewShot` 前面，有的会放在后面。

但有一个判断标准比较稳：

- 如果历史消息很多，就减少 few-shot 的数量

- 如果当前是新会话、上下文很短，就可以保留 1 到 2 组示例

因为 few-shot 和历史消息本质上都在争上下文长度。

## 7. 动态选择示例，先从最简单的分类开始

很多文章一讲动态 few-shot，就直接跳到向量检索。

对新手来说，第一步没必要走这么快。

更自然的方式，是先按任务类别选示例。

index.ts

```typescript
type Category = 'emotion' | 'learning' | 'coding'

type Example = {
  category: Category
  input: string
  output: string
}

const allExamples: Example[] = [
  {
    category: 'emotion',
    input: '今天一直被打断，心态有点炸。',
    output:
      '一直被打断确实很消耗人。先别急着责怪自己，先把今天剩余任务缩到一件最重要的事。你先把节奏稳住，再处理情绪。',
  },
  {
    category: 'learning',
    input: 'React 19 的知识点太多了，我不知道从哪开始。',
    output:
      '别先追求全懂，先抓住一个最常用的入口。今晚只看一个小点，把它跑通比泛看十篇文章更有效。',
  },
  {
    category: 'coding',
    input: '这个组件总是重复渲染，我有点看不懂。',
    output:
      '先别一起看所有状态，把触发渲染的源头拆开。先检查 props 变化，再看父组件状态，最后看订阅范围。把更新边界拆清楚，问题通常就会浮出来。',
  },
]

function selectExamples(category: Category) {
  return allExamples.filter((item) => item.category === category).slice(0, 2)
}
```

然后把选出来的示例交给 few-shot：

index.ts

```typescript
const fewShotPrompt = new FewShotChatMessagePromptTemplate({
  examples: selectExamples('coding'),
  examplePrompt,
  inputVariables: [],
})
```

这已经足够算动态 few-shot 了。

示例集合不再是固定常量，而是会随着当前任务变化。

## 8. 这篇里真正要注意的两件事

**第一，不要把 Few-Shot 写成“堆例子比赛”。**

示例越多，不一定越稳。无关样例一多，反而会把当前输入淹没。

**第二，不要让 Few-Shot 和 Agent 的长期设定打架。**

Agent 已经有 `systemPrompt`，few-shot 就主要负责补样板，不要再在示例里夹带一套相反的风格要求。

这一篇放回整章主线里，位置其实很清楚：

- Prompt Template 负责把输入组织好

- Few-Shot 负责把回答样板补进去

- Agent 再根据这份上下文继续运行

下一篇再继续往后走，进入输出这一侧，开始学习 `Output Parser`
