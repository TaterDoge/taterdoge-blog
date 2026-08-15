---
title: "118 第一次调用"
pubDate: 2026-05-18
description: "前两篇讲的是定位和架构，从本篇开始进入实战。我们要做的事很简单：从零搭一个最小工程，调通 generateText 的第一次调用。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/3-setup-first-call/](https://aicompanion.usehook.cn/3-setup-first-call/)

## 1. 这一篇要跑通什么

前两篇讲的是定位和架构，从本篇开始进入实战。我们要做的事很简单：**从零搭一个最小工程，调通 `generateText` 的第一次调用**。

具体分五步：

- 用 `pnpm` / `yarn` 在一个空目录搭出最小工程

- 安装 `ai` + 一个 Provider（默认用 `@ai-sdk/openai`，没有 OpenAI key 的同学可以换 `openrouter` 或 Workers AI）

- 写一个 20 行左右的脚本，一次调用拿到完整文本

- 升级成流式版本（`streamText`），看逐 token 输出

- 把几个常见错误一次性讲清楚

跑完这一篇，你手上就有了一个可以反复改来改去的沙盒。后面所有核心章节的例子，都能在它里面验证。

## 2. 最小工程初始化

新建一个目录，用 Node 20+（AI SDK 要求 Node 18+，20+ 更稳）：

index.bash

```shellscript
mkdir ai-sdk-sandbox && cd ai-sdk-sandbox
pnpm init
pnpm add -D typescript tsx @types/node
pnpm add ai @ai-sdk/openai zod
```

这几个依赖各自的职责：

| 包 | 作用 |
| --- | --- |
| ai | Core 层主包，提供 streamText / generateText / tool 等 |
| @ai-sdk/openai | Provider 层，OpenAI 适配器 |
| zod | 之后写 Structured Output 和 Tool 参数时要用它做校验 |
| tsx | 直接跑 .ts 文件，不用先编译 |

初始化 `tsconfig.json`：

tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

`package.json` 里加上 `"type": "module"`，脚本用 tsx 启动：

package.json

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts"
  }
}
```

这样 ESM 的 `import` 语法就能直接用了。

## 3. 第一次调用：generateText

先准备 API Key。OpenAI 的 key 长得像 `sk-proj-...`，在项目根目录新建 `.env` 存它：

.env

```shellscript
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
```

`.env` 一定要加进 `.gitignore`，千万别提交上去。

AI SDK 的 Provider 会自动从 `process.env.OPENAI_API_KEY` 读 key，代码里不用手动传。不过 Node 默认不读 `.env`，得你告诉它怎么读。两种方式：

- **方式 A（推荐）**：Node 20.6+ 自带 `--env-file` 参数，把 `dev` 脚本改成 `tsx --env-file=.env src/index.ts`

- **方式 B**：装 `dotenv`，代码开头写 `import 'dotenv/config'`

这里用方式 A：

package.json

```json
{
  "scripts": {
    "dev": "tsx --env-file=.env src/index.ts"
  }
}
```

然后写第一个脚本 `src/index.ts`：

src/index.ts

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

const { text, usage } = await generateText({
  model: openai('gpt-4o-mini'),
  prompt: '用一句话解释什么是 Vercel AI SDK，不超过 30 字。',
})

console.log('回复：', text)
console.log('Token 用量：', usage)
```

跑起来：

index.bash

```shellscript
pnpm dev
```

正常的话会看到：

index.txt

```text
回复：用于构建 AI 应用的统一 TypeScript 工具库，简化模型与 UI 集成。
Token 用量：{ inputTokens: 38, outputTokens: 24, totalTokens: 62 }
```

这段代码有几个细节值得留意：

- `generateText` 是 async 函数，所以顶层直接用了 await。这需要 `package.json` 里的 `"type": "module"` 和 Node 18+

- `openai('gpt-4o-mini')` 返回的就是 [三层架构](/2-three-layer-architecture) 讲的 `LanguageModelV2` 实例。`gpt-4o-mini` 是 modelId，要换 `gpt-4o` / `gpt-5` 只改这里

- 返回值是个对象：`text` 是完整回复字符串，`usage` 是 token 用量。对象上还有 `finishReason` / `warnings` / `response` 等字段，后面用到再介绍

## 4. 升级到流式：streamText

把 `generateText` 换成 `streamText`，其他几乎不动：

src/index.ts

```typescript
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'

const result = streamText({
  model: openai('gpt-4o-mini'),
  prompt: '用三句话介绍 Vercel AI SDK 的三层架构。',
})

// 方式 1：逐 token 的字符串流
for await (const chunk of result.textStream) {
  process.stdout.write(chunk)
}

console.log('\n---')
console.log('总 token：', (await result.usage).totalTokens)
```

再跑一遍，你会看到文字是一个字一个字蹦出来的，而不是等全部拿到再一口气 print。这就是流式。

和非流式相比，有几点不一样，值得留意：

- `streamText` 本身不是 async，它同步就返回一个 `result`。真正的异步发生在消费 `result.textStream` 的时候

- `result.usage` 是 Promise，要等整个流结束才能拿到

- `textStream` 只能消费一次。消费完这条流就耗尽了，想复用得自己把中间内容缓存起来

如果想看更细粒度的事件流（上一篇提到的 `text-delta` / `tool-call` / `finish` 全部事件），用 `fullStream`：

src/full-stream.ts

```typescript
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'

const result = streamText({
  model: openai('gpt-4o-mini'),
  prompt: '一句话回答：今天星期几？（你不需要真的知道，随便编一个）',
})

for await (const part of result.fullStream) {
  console.log(part.type, JSON.stringify(part).slice(0, 80))
}
```

输出大概长这样：

index.txt

```text
start {"type":"start"}
start-step {"type":"start-step",...}
text-start {"type":"text-start","id":"txt_0"}
text-delta {"type":"text-delta","id":"txt_0","delta":"今"}
text-delta {"type":"text-delta","id":"txt_0","delta":"天"}
text-delta {"type":"text-delta","id":"txt_0","delta":"星"}
...
text-end {"type":"text-end","id":"txt_0"}
finish-step {"type":"finish-step",...}
finish {"type":"finish","finishReason":"stop",...}
```

`fullStream` 是上一篇讲的 UIMessageStream 协议在 Node 侧的原始形态。[UIMessageStream](/7-stream-text) 会把它和手写 SSE 协议放一起对照。

## 5. 换一个 Provider 试试

为了让「Provider 可替换」这件事有实感，我们把 OpenAI 换掉。三种常见选择：

### 方式 A：换官方 Provider

如果你手上有另一家的 API Key，装对应官方 Provider 就行：

index.bash

```shellscript
pnpm add @ai-sdk/anthropic
```

src/index.ts

```typescript
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

const { text } = await generateText({
  model: anthropic('claude-opus-4-6'),
  prompt: '...',
})
```

`.env` 里改成 `ANTHROPIC_API_KEY=...`。业务代码只动了两行：`import` 和 `model`。

### 方式 B：用 OpenRouter 聚合

OpenRouter 是个聚合平台，一把 key 就能调各家的模型，价格统一结算。调试阶段特别方便。

index.bash

```shellscript
pnpm add @openrouter/ai-sdk-provider
```

src/index.ts

```typescript
import { generateText } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })

const { text } = await generateText({
  model: openrouter('anthropic/claude-opus-4-6'),
  prompt: '...',
})
```

### 方式 C：Cloudflare Workers AI

Workers AI 的 Provider 是社区维护的 `workers-ai-provider`，免费额度不小。但它主要在 Workers 运行时上用，在 Node 里跑会麻烦一些，这里不展开，[模型 Provider 生态](/4-model-providers) 会专门讲。

不管选哪种，`generateText` / `streamText` 的调用代码都几乎不变。这就是 Provider 层的抽象在替你省事。

## 6. 常见错误与排查

下面这张表把最常踩的坑集中列一下：

| 错误信息 | 原因 | 解决 |
| --- | --- | --- |
| Error: OPENAI_API_KEY is missing | .env 没读到，或 key 没配 | 确认 --env-file=.env 或 dotenv/config，确认 .env 在当前工作目录 |
| SyntaxError: Cannot use import statement outside a module | package.json 缺 "type": "module" | 加上 "type": "module" |
| AI_APICallError: 401 Incorrect API key | Key 无效或格式错 | 去 OpenAI 控制台确认 key，注意不要带尾部空格 |
| AI_APICallError: 429 You exceeded your current quota | 配额用尽 | 充值或换 Provider |
| AI_APICallError: 400 model xxx does not exist | modelId 拼错，或该账号没这个模型权限 | 查 Provider 文档，确认模型名 |
| fetch failed | 网络或代理问题 | 挂代理，或用 Provider.createXxx({ baseURL }) 换中转 |
| ERR_REQUIRE_ESM | TS / tsx 配置问题 | 改用 tsx 直接跑 .ts，或升级 tsconfig moduleResolution: NodeNext |

AI SDK 的所有错误类都从 `ai` 包里导出，而且设计上是结构化的：

error-handling.ts

```typescript
import { APICallError, NoSuchModelError } from 'ai'

try {
  await generateText({ /* ... */ })
} catch (err) {
  if (APICallError.isInstance(err)) {
    console.log('HTTP 状态：', err.statusCode)
    console.log('响应体：', err.responseBody)
    console.log('是否可重试：', err.isRetryable)
  }
}
```

每个错误类都有 `isInstance` 静态方法做类型判断，字段也是结构化的，而不是只给你一串字符串。后面 [缓存、限流、Fallback](/16-middleware) 做中间件和 Fallback 时，这些字段会频繁用到。

## 7. 小结

- 最小工程只要 4 个依赖：`ai` + 一个 Provider + `zod` + `tsx`

- Provider 会自动读环境变量，Node 20.6+ 用 `--env-file` 比装 `dotenv` 更轻

- `generateText` 是 async 函数，返回完整对象；`streamText` 同步返回 result，流挂在 `textStream` / `fullStream` 上

- `textStream` 只能消费一次，要复用就得自己缓存

- 换 Provider 只改两行：`import` 和 `model = xxx('modelId')`

- 错误类都能 `isInstance(err)` 判断，拿到 `statusCode` / `responseBody` / `isRetryable` 再决定要不要重试

下一篇深入 **Provider 生态**——官方几家、OpenRouter、Workers AI、Ollama，还有怎么自己包一个私有 Provider。
