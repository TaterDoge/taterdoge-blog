---
title: "26 第一次调用"
pubDate: 2026-04-20
description: "我用的是 DeepSeek，但接法走的是 OpenAI 兼容接口，所以代码里会用到 @langchain/openai 的 ChatOpenAI"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/2-setup-first-call/](https://aicompanion.usehook.cn/2-setup-first-call/)

## 1. 先把调用跑通

这一篇不追求讲很多概念，只做一件事：先把 LangChain 跑起来

我用的是 DeepSeek，但接法走的是 OpenAI 兼容接口，所以代码里会用到 `@langchain/openai` 的 `ChatOpenAI`

我们会按三个小步骤往下走：

- 先直接调一次模型

- 再试一次流式输出

- 最后再换成一个最小 Agent

这样走下来，后面再看消息、Prompt、Tool、Agent，就不会觉得突然

## 2. 先看目录结构

第一次尝试 LangChain，建议不要一上来就塞进页面里。

先单独放一个 playground，更容易定位问题。

当前目录结构是这样的：

.env.localDeepSeek 的本地环境变量.gitignore忽略密钥和依赖package.json依赖和运行命令tsconfig.jsonTypeScript 配置first-call.ts第一次完整调用first-stream.ts第一次流式输出first-agent.ts第一次 Agent 流式调用

## 3. 依赖和命令

先看当前 playground 里的 `package.json`：

package.json

```json
{
  "name": "langchain-first-call-playground",
  "private": true,
  "type": "module",
  "packageManager": "yarn@4.12.0",
  "scripts": {
    "first-call": "tsx scripts/first-call.ts",
    "first-stream": "tsx scripts/first-stream.ts",
    "first-agent": "tsx scripts/first-agent.ts"
  },
  "dependencies": {
    "@langchain/core": "^1.1.36",
    "@langchain/openai": "^1.3.1",
    "dotenv": "^17.3.1",
    "langchain": "^1.2.37"
  },
  "devDependencies": {
    "tsx": "^4.21.0",
    "typescript": "^6.0.2"
  }
}
```

这里先记住几个最常用的：

- `@langchain/openai`：负责接 OpenAI 兼容接口

- `langchain`：后面写 Agent 会用到

- `dotenv`：读取 `.env.local`

- `tsx`：直接运行 TypeScript 脚本

## 4. 先把环境变量配对

当前这套 playground 用的是下面这组三个变量：

.env.local

```shellscript
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
```

这三个字段分别对应：

- `DEEPSEEK_API_KEY`：密钥

- `DEEPSEEK_BASE_URL`：OpenAI 兼容接口地址

- `DEEPSEEK_MODEL`：模型名

这里有个很容易漏掉的细节：

`DEEPSEEK_BASE_URL` 要带上 `/v1`。

如果少了这一段，脚本很容易直接报错。

## 5. 第一次完整调用：first-call.ts

第一步先不要碰 Agent，直接调模型。

scripts/first-call.ts

```typescript
import dotenv from 'dotenv'
import { ChatOpenAI } from '@langchain/openai'

dotenv.config({ path: new URL('../.env.local', import.meta.url) })

const model = new ChatOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})

const response = await model.invoke([
  {
    role: 'system',
    content: '你是一名面向前端开发者的助手，回答要清楚、简短。',
  },
  {
    role: 'user',
    content: '请用两句话确认 LangChain 与 DeepSeek 的连接已经正常。',
  },
])

console.log('invoke result:')
console.log(response.text)
```

执行命令：

code.ts

```shellscript
yarn first-call
```

这一段最值得记住的是 `invoke()` 的感觉：

- 把一份完整输入交给模型

- 等模型生成结束

- 一次性拿回结果

## 6. 第二次：换成流式输出

scripts/first-stream.ts

```typescript
import dotenv from 'dotenv'
import { ChatOpenAI } from '@langchain/openai'

dotenv.config({ path: new URL('../.env.local', import.meta.url) })

const model = new ChatOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})

const stream = await model.stream([
  {
    role: 'system',
    content: '你是一名面向前端开发者的助手，回答要自然、简短。',
  },
  {
    role: 'user',
    content: '请用一句话说明当前是流式输出验证。',
  },
])

process.stdout.write('stream result:\n')

for await (const chunk of stream) {
  process.stdout.write(chunk.text)
}

process.stdout.write('\n')
```

执行命令：

code.ts

```shellscript
cd apps/aicompanion/playgrounds/langchain-first-call
yarn first-stream
```

这时候最大的变化只有一个：

不再等完整结果，而是边生成边输出。

所以你可以先把区别简单记成这样：

- `invoke()`：一次性拿结果

- `stream()`：边生成边拿结果

## 7. 第三次：换成最小 Agent

前面两段代码都还是“直接调模型”。

现在再往前走一步，看看最小 Agent 是什么样。

scripts/first-agent.ts

```typescript
import dotenv from 'dotenv'
import { createAgent } from 'langchain'
import { ChatOpenAI } from '@langchain/openai'

dotenv.config({ path: new URL('../.env.local', import.meta.url) })

// 定义模型
const model = new ChatOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})

// 定义 Agent
const agent = createAgent({
  model,
  tools: [],
  systemPrompt: '你是一名面向前端开发者的助手，回答要自然、简短。',
})

// 定义 message
const inputMessages = {
  role: 'user',
  content: '请用一句话说明当前是 Agent 流式调用验证。',
}

// Agent 调用 stream 流式输出，返回的是消息流
const stream = await agent.stream({
  messages: [inputMessages],
}, {
  // 设置 streamMode 为 messages，返回的是消息流
  streamMode: 'messages',
})

process.stdout.write('agent stream result:\n')

for await (const [messageChunk] of stream) {
  if (messageChunk.content) {
    process.stdout.write(messageChunk.text)
  }
}

process.stdout.write('\n')
```

执行命令：

code.ts

```shellscript
yarn first-agent
```

这段代码里最值得注意的地方有三个。

第一，模型配置本身没有变。

也就是说，Agent 不是另一套模型初始化方式，它还是建立在同一个模型对象之上。

第二，真正变化的是入口。

前面是：

code.ts

```typescript
model.invoke(...)
model.stream(...)
```

这里变成了：

code.ts

```typescript
agent.stream(...)
```

第三，`createAgent()` 让模型外面多了一层运行时包装。

现在这个例子里还没有工具，所以它看上去像是“绕了一层再调模型”。但后面一旦把 tools 接进去，这层包装的价值就会很明显。

## 8. 这个 Agent 版本里，多出来了什么

如果你第一次看 `first-agent.ts`，最容易疑惑的是：

“它和 `first-stream.ts` 看起来差不多，为什么还要单独写 Agent 版？”

原因就在于，后面我们整章要讲的主线不是“怎么调一个模型”，而是：

**单个 Agent 怎样在一轮请求里调用多个工具，把事情做完。**

所以这里先放一个最小 Agent，有两个作用：

- 先把 `createAgent()` 和 `agent.stream()` 这些入口认熟

- 后面加工具时，不需要再突然切换思路

换句话说，`first-call.ts` 和 `first-stream.ts` 是在确认底层模型调用正常，`first-agent.ts` 则是在给后面的 Agent 主线铺路。

## 9. 总结

第一次不要试图把所有细节都吃透，先看懂下面四件事就够了。

### 9.1 dotenv.config({ path: new URL(...) })

这里显式指定了 `.env.local` 的位置。

这样做的好处是：只要脚本文件路径不变，就能稳定找到同一个环境变量文件，不容易因为执行目录变化而读错环境变量。

### 9.2 消息是数组，不是单个字符串

无论是 `model.invoke()`、`model.stream()`，还是 `agent.stream()`，这里传进去的都不是单一字符串，而是一组消息。

这会比“拼一整段字符串”更适合后面的多轮对话和工具调用场景。

### 9.3 response.text 和 chunk.text

在直接调模型时：

- 完整返回看 `response.text`

- 流式返回看 `chunk.text`

第一次跑通时，先这么理解最省事。

### 9.4 streamMode: 'messages'

在 `first-agent.ts` 里，这一项很关键：

code.ts

```typescript
{
  streamMode: 'messages'
}
```

这样拿到的是消息流，终端里可以直接边生成边打印文字。

如果没有这层设置，Agent 的流式返回会更偏运行时事件结构，不适合做这篇的最小示例
