---
title: "129 RSC 流式 UI"
pubDate: 2026-05-22
description: "前三篇讲的 useChat / useObject 都基于「流数据 → 客户端组件渲染」这套模型。ai/rsc 提供了第四种玩法：让 LLM 直接 stream 出一个 React 组件树。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/14-ai-rsc/](https://aicompanion.usehook.cn/14-ai-rsc/)

## 1. 为什么单开一篇讲 ai/rsc

前三篇讲的 `useChat` / `useObject` 都基于「流数据 → 客户端组件渲染」这套模型。`ai/rsc` 提供了第四种玩法：让 LLM 直接 stream 出一个 React 组件树。

这听起来有点反直觉——LLM 怎么可能 stream 组件？它不就是吐字符串吗？

关键在于 RSC（React Server Components）的模型：Server Component 运行在服务端，产物是序列化的 React 元素（不是 HTML，也不是 JSON），传到客户端后直接挂到 React 树里。`ai/rsc` 做的事情是：根据 LLM 的输出，在服务端动态 yield 出不同的 Server Component 实例，这些实例按流式 chunk 发送到客户端。

用一个例子直观感受下：

compare.txt

```text
传统 useChat:
  后端: streamText → SSE → 客户端解析 UIMessage parts
  客户端: <Message parts={...} /> 按 part type 分发渲染

ai/rsc:
  后端: streamUI → 服务端决定每个 chunk 渲染什么组件
  客户端: 直接接收 <Weather city="北京" temp={22} /> 这样的组件
```

本专栏主线不用 ai/rsc（原因后面讲），但它是一个值得知道的工具，以后遇到特定场景能识别出来。

## 2. 一个 ai/rsc 最小例子

先感受下代码长什么样。

Next.js Server Action（注意是 `.tsx`，因为要返回 React 元素）：

actions.tsx

```tsx
'use server'

import { streamUI } from 'ai/rsc'
import { z } from 'zod'

export async function askCompanion(question: string) {
  const result = await streamUI({
    model: models.chat,
    prompt: question,

    // 普通文本，流式渲染一个 <TextBubble>
    text: ({ content, done }) => (
      <TextBubble text={content} streaming={!done} />
    ),

    // 工具：返回的是组件，而不是数据
    tools: {
      getWeather: {
        description: '查询城市天气',
        inputSchema: z.object({ city: z.string() }),
        generate: async function* ({ city }) {
          yield <WeatherSkeleton />          // 调用中，骨架屏
          const weather = await fetchWeather(city)
          return <WeatherCard data={weather} />  // 拿到数据，换完整卡片
        },
      },
    },
  })

  return result.value  // 这是一个 React element
}
```

客户端组件：

chat-page.tsx

```tsx
'use client'

import { useState } from 'react'
import { askCompanion } from './actions'

export default function Chat() {
  const [ui, setUi] = useState<React.ReactNode>(null)
  const [input, setInput] = useState('')

  async function handleSubmit() {
    const ui = await askCompanion(input)
    setUi(ui)
  }

  return (
    <div>
      {ui}
      <input value={input} onChange={(e) => setInput(e.target.value)} />
      <button onClick={handleSubmit}>发送</button>
    </div>
  )
}
```

用户问「北京今天天气」，客户端先看到一个 skeleton 天气卡片，后端拿到数据后自动替换成完整卡片——整个过程前端不用写任何 part type 分发逻辑。

## 3. ai/rsc 的几个核心 API

最常用的入口是 `streamUI`，参数和 `streamText` 很像，但有两个关键区别：`text` 是一个回调而不是「自动返回字符串」，你决定每个 text chunk 渲染成什么组件；`tools[xxx].generate` 是一个 async generator，可以 yield 中间态、return 最终态。

### createStreamableUI

更底层的 API，不和 LLM 绑定。你拿到一个「可变的 React 元素」，通过调用方法流式更新它：

streamable-ui.tsx

```tsx
import { createStreamableUI } from 'ai/rsc'

async function myAction() {
  const ui = createStreamableUI(<Loading />)

  // 异步推进 UI
  setTimeout(() => ui.update(<Progress percent={30} />), 1000)
  setTimeout(() => ui.update(<Progress percent={70} />), 2000)
  setTimeout(() => ui.done(<Result data={...} />), 3000)

  return ui.value
}
```

客户端 `await myAction()` 拿到 `ui.value`，渲染出来会看到三段式的变化。

### createStreamableValue

流式值（不是组件）。适合在 RSC 里把一个值流给客户端：

streamable-value.tsx

```tsx
'use server'
import { createStreamableValue } from 'ai/rsc'

export async function countdown() {
  const v = createStreamableValue(10)
  for (let i = 9; i >= 0; i--) {
    await sleep(1000)
    v.update(i)
  }
  v.done()
  return v.value
}
```

客户端：

use-streamable.tsx

```tsx
'use client'
import { readStreamableValue } from 'ai/rsc'
import { countdown } from './actions'

function Counter() {
  const [n, setN] = useState(10)

  async function start() {
    const stream = await countdown()
    for await (const value of readStreamableValue(stream)) {
      setN(value)
    }
  }

  return <div onClick={start}>{n}</div>
}
```

本质上是 RSC 版本的「服务端推流」，和 SSE 等价，只是用的是 RSC 协议。

除此之外还有 `useUIState` / `useAIState`——当你想做多轮对话的 RSC 版本，需要维护「UI 状态」和「AI 历史状态」两套。`useUIState` 给前端用、`useAIState` 给 Server Action 用。这两个 Hook 需要配套一个 AI Provider，使用门槛较高，本篇不展开。官方文档的 RSC Chatbot 例子里有完整代码。

## 4. 什么情况下 ai/rsc 真的香

ai/rsc 不是普适工具，但在几类场景里是降维打击。

### Generative UI，非对话型

Travel Agent（LLM 决定给用户展示一张机票卡片、一张酒店卡片、一个地图标记）、商品推荐（LLM 根据用户提问渲染推荐商品 grid）、Dashboard 问答（用户问「上个月哪个地区销售额最高」，直接生成一个柱状图组件）。这些场景有个共同点：输出是「一组复合组件」，不是「一段文字 + tool call 可视化」。

### 内部工具、运营后台

用户和 LLM 的交互是「我要一个 X」，LLM 决定怎么组合现有组件给你这个 X。这种 UI 逻辑很重的场景，用 RSC 能让 LLM 当「UI 导演」。

### 单次查询型产品

不是多轮对话，就是 query → response 一锤子买卖。RSC 比 useChat 轻量。

## 5. 为什么 AI 伴侣不用它

几个原因。

AI 伴侣是对话产品，多轮交互、消息历史、持久化是核心。`useUIState` / `useAIState` 也能做，但复杂度远高于 `useChat`。

AI 伴侣前端要跑在不同平台（Web、iOS、Android）。RSC 只能在 Next.js（或类似 RSC 运行时）里跑，而 `useChat` 的 UIMessageStream 协议能被任何前端消费。

AI 伴侣后端部署在 Cloudflare Workers。RSC 协议的渲染和序列化对运行时有一定要求，Workers 上目前不是最顺滑的组合。

产品的 UI 由前端工程师决定，我们不希望 LLM 越俎代庖地选组件。

所以本专栏的主线坚持 `useChat` + UI Parts 方案。RSC 是你以后做 Generative UI 产品时的一把好刀，但不是万能刀。

## 6. ai/rsc 的已知限制

正式上生产前得知道这些限制。

### 只能在 RSC 运行时用

Next.js App Router 是唯一主流选择。Remix / SvelteKit / Vue 都不行。

### 调试和观测比 useChat 难

流里 yield 的是组件实例，不是结构化事件。你看不到清晰的 UIMessageStream 协议事件，埋点和追踪要自己设计。

### 多轮对话实现复杂

需要配合 `AI` context provider + `useAIState` + `useUIState`，API 远比 `useChat` 难掌握。产品如果是多轮的，老老实实用 `useChat` 更划算。

### 部分高级特性还在实验中

`ai/rsc` 整体比 Core 和 UI 层成熟度低。过去一年多 API 有过调整，用之前建议看最新官方文档确认稳定度。

### 客户端依赖体积大

RSC 协议的客户端解析器体积不小。纯 client-side 应用反而用不上它。

## 7. 小结

- `ai/rsc` 允许 LLM stream 出 React Server Components，用于「Generative UI」类产品

- 核心 API：`streamUI`（主入口）、`createStreamableUI`（流组件）、`createStreamableValue`（流值）

- 最香的场景：Travel Agent、商品推荐、Dashboard 问答、单次查询型产品

- 不适合的场景：多轮对话、多端应用、Cloudflare Workers 后端、UI 严格由前端掌控

- 本专栏主线不用 ai/rsc，坚持 `useChat` + UIMessageStream 协议

- 作为「工具箱里的一把刀」记住它，遇到合适场景能识别出来

前端集成四连到此结束。下一篇进入**后端集成三连**——[**AI SDK × Hono**](/15-ai-sdk-with-hono)。把前面学到的 `streamText` / `toUIMessageStreamResponse` / `onFinish` / `abortSignal` 组合起来，跑在 AI 伴侣项目真实的部署环境上，同时把 Workers 特有的坑趟一遍。
