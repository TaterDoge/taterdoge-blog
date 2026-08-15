---
title: "119 模型 Provider 生态"
pubDate: 2026-05-19
description: "三层架构https://aicompanion.usehook.cn/2threelayerarchitecture 讲过，Provider 层的任务是把任意 LLM 厂商的 API 包装成 LanguageModelV2 接口。这一篇我们"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/4-model-providers/](https://aicompanion.usehook.cn/4-model-providers/)

## 1. Provider 生态的全景

[三层架构](/2-three-layer-architecture) 讲过，Provider 层的任务是把任意 LLM 厂商的 API 包装成 `LanguageModelV2` 接口。这一篇我们把整个生态摊开来看一遍：都有哪些 Provider、什么场景用谁、自己项目里怎么选。

按出处分，Provider 有三类：

| 分类 | 维护方 | 举例 |
| --- | --- | --- |
| 官方 Provider | Vercel 官方 | @ai-sdk/openai / @ai-sdk/anthropic / @ai-sdk/google / @ai-sdk/mistral / @ai-sdk/xai / @ai-sdk/amazon-bedrock / @ai-sdk/azure / @ai-sdk/groq |
| 社区 Provider | 第三方维护，质量不一 | @openrouter/ai-sdk-provider / workers-ai-provider / ollama-ai-provider / deepseek 等 |
| 自定义 Provider | 自己写 | 内部私有 LLM、代理层、需要额外加工的模型 |

不过 Provider 只是「入口」，真正决定你能做什么的是后面接的模型。不同模型支持的能力差别很大，本章会用到的几个关键能力如下：

| 能力 | 说明 | 依赖的底层特性 |
| --- | --- | --- |
| 基础 chat | 对话式生成 | 几乎所有模型都有 |
| 流式输出 | 逐 token 返回 | 主流模型都有 |
| Tool Calling | 函数调用 | 较新的模型才有（GPT-4+、Claude 3+、Gemini 1.5+ 等） |
| 结构化输出 | JSON Schema 强制输出 | 部分模型有（OpenAI / Anthropic / Gemini 2+） |
| 推理模型 | Reasoning / Thinking tokens | o1 / o3 / Claude Sonnet 4.5 / DeepSeek R1 等 |
| 多模态输入 | 图片 / 文件 / 音频 | 部分多模态模型 |
| 原生 Web Search | 不用外部搜索 API | 少数模型（GPT-4o、Claude Sonnet 4+、Perplexity） |

所以，一个 Provider 能给你什么，取决于它对接的模型支持什么。能力缺失时 AI SDK 会抛 `NoSuchCapabilityError`，不会悄悄降级。

## 2. 官方 Provider 三巨头

### 2.1 OpenAI — @ai-sdk/openai

最常用、文档最完整、能力最全。支持：chat、tool、结构化、多模态、推理模型、audio。

openai.ts

```typescript
import { openai } from '@ai-sdk/openai'
import { generateText } from 'ai'

const { text } = await generateText({
  model: openai('gpt-4o'),
  prompt: '...',
})

// 推理模型（o1 / o3 / o4-mini）
const { text: reasoningText } = await generateText({
  model: openai('o3-mini'),
  prompt: '一步一步推理：...',
  providerOptions: {
    openai: {
      reasoningEffort: 'medium', // low | medium | high
    },
  },
})
```

如果要走代理、中转或兼容层，给 OpenAI 指定自定义端点：

openai-custom.ts

```typescript
import { createOpenAI } from '@ai-sdk/openai'

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://your-proxy.com/v1',
  compatibility: 'strict', // 'strict' | 'compatible'
})
```

`compatibility: 'strict'` 表示对方完全兼容 OpenAI 官方 API；`'compatible'` 是宽松模式，适配大部分兼容层（国内中转、LM Studio、某些国产模型的 OpenAI 兼容端点）。

### 2.2 Anthropic — @ai-sdk/anthropic

Claude 系列。和 OpenAI 相比有几处差异：

- `system` 是独立字段，不作为消息的一员

- 原生支持 `reasoning` part（Claude Sonnet 4.5+ 的 thinking tokens）

- Tool 调用的 schema 解析更严格，参数名不能有保留字

anthropic.ts

```typescript
import { anthropic } from '@ai-sdk/anthropic'
import { streamText } from 'ai'

const result = streamText({
  model: anthropic('claude-opus-4-6'),
  system: '你是一个情绪敏感的 AI 伴侣。',
  messages,
  providerOptions: {
    anthropic: {
      thinking: {
        type: 'enabled',
        budgetTokens: 2000, // 思考 token 预算
      },
    },
  },
})
```

开启 thinking 之后，`fullStream` 里会先冒出 `reasoning-delta` 事件，再冒出正式的 `text-delta`。前端可以用 UI Parts 把「正在思考」和「正在回答」分开渲染。

### 2.3 Google — @ai-sdk/google

Gemini 系列。主要特色有几个：

- 长上下文（Gemini 1.5 Pro 可用 2M tokens 上下文）

- 原生多模态特别强，图、视频、音频都能直接传

- Structured Output 用 JSON Mode，效果稳定

google.ts

```typescript
import { google } from '@ai-sdk/google'
import { generateText } from 'ai'

const { text } = await generateText({
  model: google('gemini-2.5-pro'),
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: '描述这张图里的人在干什么：' },
        { type: 'image', image: new URL('https://example.com/photo.jpg') },
      ],
    },
  ],
})
```

Gemini 还有一个 Vertex AI 版本（`@ai-sdk/google-vertex`），是给 GCP 企业客户用的，走 GCP 鉴权。

## 3. 聚合与中转 Provider

### 3.1 OpenRouter — 一把 Key 通吃

`@openrouter/ai-sdk-provider` 是社区维护得很积极的一个 Provider。它的核心价值是：一个 API Key、一套价格、覆盖 200+ 模型。调试阶段不用注册 N 家账号。

openrouter.ts

```typescript
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { streamText } from 'ai'

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

const result = streamText({
  model: openrouter('anthropic/claude-opus-4-6'),
  prompt: '...',
})

// 换模型只改字符串
const result2 = streamText({
  model: openrouter('google/gemini-2.5-pro'),
  prompt: '...',
})
```

适合用它的场景：

- 多模型对比实验

- 国内访问 OpenAI / Claude 不便

- 早期产品，还没稳定选型

不适合的场景：

- 生产环境（多一层中转会增加延迟）

- 对 token 成本非常敏感（OpenRouter 会加少量加价）

### 3.2 Azure OpenAI

企业合规场景常用，走 Azure 订阅鉴权：

azure.ts

```typescript
import { createAzure } from '@ai-sdk/azure'

const azure = createAzure({
  resourceName: 'your-resource',
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  apiVersion: '2024-10-21',
})

const model = azure('your-deployment-name')
```

注意 Azure 走的是「deployment」而不是 modelId，名字是你在 Azure 控制台自定义的。模型版本和区域也在 Azure 控制台配置，Provider 端只需要 deployment 名称和 API 版本号。如果你公司已有 Azure 订阅，这通常是最省心的生产部署方案。

## 4. Cloudflare Workers AI Provider

这是本专栏特别重要的一个 Provider。AI 伴侣项目部署在 Cloudflare Workers 上，Workers AI 正好是天然搭档：

- 免费额度够用：每天 10,000 个 Neuron，大致够几百到几千次 chat 调用（具体看模型）

- 延迟很低：模型就跑在 Cloudflare 边缘节点上，不出 Workers 网络

- 不用管 API Key：Workers 代码通过 binding，直接 `env.AI` 调用

官方没有 `@ai-sdk/cloudflare-workers`，不过社区有 `workers-ai-provider`：

index.bash

```shellscript
pnpm add workers-ai-provider
```

workers-ai.ts

```typescript
import { createWorkersAI } from 'workers-ai-provider'
import { streamText } from 'ai'

// 在 Workers Handler 里
export default {
  async fetch(req: Request, env: Env) {
    const workersai = createWorkersAI({ binding: env.AI })

    const result = streamText({
      model: workersai('@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
      prompt: 'hi',
    })

    return result.toUIMessageStreamResponse()
  },
}
```

`wrangler.jsonc` 里配 AI binding：

wrangler.jsonc

```jsonc
{
  "name": "ai-companion",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "ai": {
    "binding": "AI"
  }
}
```

它的优点很直接：零配置鉴权、部署到 Workers 后延迟非常低、成本好预估。

但也有几个短板要知道：模型池有限，最新的 GPT / Claude 用不了；本地开发（`wrangler dev`）有一些限制；部分高级特性比如 thinking tokens 暂时还没跟上。

本专栏采用的策略是主力用 Workers AI、回退用 OpenAI。[缓存、限流、Fallback](/16-middleware) 做 Fallback 中间件时会用到这个组合。

## 5. 本地模型 Provider

本地跑模型有两种主流方式。

### 5.1 Ollama — ollama-ai-provider

Ollama 是目前最简单的本地 LLM 运行时。装好 Ollama 客户端，`ollama run llama3.3`，就能通过 HTTP 调它。

ollama.ts

```typescript
import { createOllama } from 'ollama-ai-provider'
import { generateText } from 'ai'

const ollama = createOllama({
  baseURL: 'http://localhost:11434/api',
})

const { text } = await generateText({
  model: ollama('llama3.3'),
  prompt: '...',
})
```

适合用它的场景：

- 离线开发或演示

- 隐私极敏感的内部工具

- 学生党、没有 API 预算的个人项目

注意 Ollama 的 Tool Calling 支持度因模型而异，简单 chat 一般没问题，复杂 Agent 流程可能不稳。

### 5.2 LM Studio / OpenAI 兼容端点

LM Studio、vLLM、TGI 这些本地部署工具都会提供 OpenAI 兼容端点。直接用 `createOpenAI({ baseURL: '...', compatibility: 'compatible' })` 指过去就行。

lm-studio.ts

```typescript
import { createOpenAI } from '@ai-sdk/openai'

const local = createOpenAI({
  baseURL: 'http://localhost:1234/v1',
  apiKey: 'lm-studio', // 占位，本地服务通常不校验
  compatibility: 'compatible',
})

const { text } = await generateText({
  model: local('local-model'),
  prompt: '...',
})
```

## 6. 自定义 Provider：从零包一个

有时候你需要包一个内部私有 LLM，比如公司自建的大模型网关，或者一个需要额外加工的代理层。

AI SDK 提供了 `customProvider` 帮手，不用从零实现 `LanguageModelV2`：

custom.ts

```typescript
import { customProvider } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

// 场景：内部网关，对外暴露 OpenAI 兼容 API，但做了模型别名映射
const internal = customProvider({
  languageModels: {
    'smart': createOpenAI({ baseURL: 'https://gw.intra/v1' })('gpt-4o'),
    'fast':  createOpenAI({ baseURL: 'https://gw.intra/v1' })('gpt-4o-mini'),
    'cheap': createOpenAI({ baseURL: 'https://gw.intra/v1' })('gpt-3.5-turbo'),
  },
  fallbackProvider: createOpenAI({ baseURL: 'https://gw.intra/v1' }),
})

// 业务代码只认内部别名
const { text } = await generateText({
  model: internal.languageModel('smart'),
  prompt: '...',
})
```

这么做有几个好处：业务代码和模型厂商脱钩，公司换家也不用动业务；别名语义清晰（`smart` / `fast` / `cheap`）；可以在 `fallbackProvider` 里统一配置 baseURL 和鉴权。

如果你要的是完全从零实现，就得手写一个符合 `LanguageModelV2` 接口的对象。这一层比较底层，一般不需要自己写，除非你对接的是非常小众的模型。

## 7. Provider 基线与选型建议

### 给本章后续例子定一个 Provider 基线

为了让后面 17 篇示例代码可以复用、可以替换，我们约定一个 Provider 基线文件，集中管理：

packages/shared/models.ts

```typescript
import { openai, createOpenAI } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'
import { customProvider } from 'ai'

// 默认走 OpenAI，如果你没 key，把下面一行改成你要的 Provider 即可
const defaultProvider = {
  chat: openai('gpt-4o-mini'),
  chatPro: openai('gpt-4o'),
  reasoning: openai('o3-mini'),
  structured: openai('gpt-4o-mini'),
}

// Anthropic 备份线
const anthropicProvider = {
  chat: anthropic('claude-sonnet-4-5'),
  chatPro: anthropic('claude-opus-4-6'),
  reasoning: anthropic('claude-opus-4-6'),
  structured: anthropic('claude-sonnet-4-5'),
}

export const models = defaultProvider
// export const models = anthropicProvider

// 专供 Workers 环境用（[AI SDK × Hono](/15-ai-sdk-with-hono) 会用到）
export function getWorkersAIModels(binding: Ai) {
  const { createWorkersAI } = require('workers-ai-provider')
  const workersai = createWorkersAI({ binding })
  return {
    chat: workersai('@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
    chatPro: workersai('@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
    reasoning: workersai('@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'),
    structured: workersai('@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
  }
}
```

后面所有例子里我们都这么写：

example.ts

```typescript
import { models } from '@/shared/models'

const { text } = await generateText({
  model: models.chat,
  prompt: '...',
})
```

这样每一篇的焦点就不会被 Provider 选择干扰。你也可以按需切到 Anthropic / Workers AI 跑同样的代码。

### 选型建议

下表给几个典型项目的推荐。先看「场景」列找到自己的定位，再看对应的「推荐」和「理由」。

| 场景 | 推荐 | 理由 |
| --- | --- | --- |
| 个人学习 / Hackathon | OpenAI + Ollama 备份 | 最省事 |
| AI 伴侣（本专栏） | Workers AI 主 + OpenAI 回退 | 免费额度大、延迟低、Fallback 保底 |
| 企业内部工具 | Azure OpenAI / 自建网关 + 自定义 Provider | 合规、统一计费 |
| 多模型对比 / 调研 | OpenRouter | 一把 key 省心 |
| 离线演示 | Ollama + LM Studio | 不依赖网络 |
| 推理密集型 Agent | o3 / Claude Opus 4.6 / DeepSeek R1 | 推理能力强 |

一个很实用的经验：项目早期别纠结 Provider，先用最顺手的跑通业务；后期再换成适合生产的 Provider，这一步在 AI SDK 里是无损切换（Provider 层本来就解耦了）。如果你是跟着本专栏从头做 AI 伴侣，先用 OpenAI 跑通，[AI SDK × Hono](/15-ai-sdk-with-hono) 再切到 Workers AI。

## 8. 小结

- Provider 分三类：官方、社区、自定义，能力高度依赖后面的模型本身

- 官方三巨头：OpenAI / Anthropic / Google，基本能力都齐，细节 API 略有差异

- OpenRouter 适合调研期，一把 key 通吃 200+ 模型

- Workers AI 是 Cloudflare 生态首选：免费额度大、延迟低、无需 API Key

- 自定义 Provider 用 `customProvider` 帮手，给模型起别名、统一 baseURL

- 本章示例统一用 `@/shared/models` 文件管理 Provider，方便切换和对照

下一篇拆**消息协议**——两套消息模型 `UIMessage` 和 `ModelMessage` 的职责差异，以及 `convertToModelMessages` 的作用。这是前后端之间最容易绊倒人的一环。
