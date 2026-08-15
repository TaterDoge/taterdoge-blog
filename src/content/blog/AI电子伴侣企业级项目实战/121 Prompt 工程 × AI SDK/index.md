---
title: "121 Prompt 工程 × AI SDK"
pubDate: 2026-05-19
description: "前面我们已经学习过 Prompt 工程的通用方法论：角色、任务、约束、fewshot、思维链、自洽采样等等。本篇不重复那些。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/6-prompts-in-ai-sdk/](https://aicompanion.usehook.cn/6-prompts-in-ai-sdk/)

## 1. 概述

前面我们已经学习过 Prompt 工程的通用方法论：角色、任务、约束、few-shot、思维链、自洽采样等等。本篇不重复那些。

这一篇只讲 Prompt 工程在 Vercel AI SDK 里具体怎么落地：

- `prompt` 和 `messages` 两个参数到底什么关系、什么时候用哪个

- `system` 放在哪——是当消息发、还是走参数？不同 Provider 的差异怎么抹平

- 多模态 prompt（图、文件、PDF）怎么构造

- Few-shot 示例在 AI SDK 里的两种写法

- Prompt 管理：集中化、版本化、模板化的工程实践

- Prompt 里的几个典型陷阱：消息越界、Token 浪费、System 失效

## 2. prompt vs messages：何时用哪个

`generateText` / `streamText` 接受三种互斥输入组合：

| 组合 | 用法 | 场景 |
| --- | --- | --- |
| 只传 prompt | { prompt: string } | 单轮、纯文本、最简情况 |
| 传 prompt + system | { prompt, system } | 单轮、带角色设定 |
| 只传 messages | { messages: ModelMessage[] } | 多轮、工具调用、复杂对话 |

看一下实际代码：

prompt-vs-messages.ts

```typescript
// 简单场景
const { text } = await generateText({
  model: models.chat,
  system: '你是一个冷静的 code reviewer。',
  prompt: '审这段代码：...',
})

// 多轮场景
const { text: reply } = await generateText({
  model: models.chat,
  messages: [
    { role: 'system', content: '你是一个情感细腻的 AI 伴侣。' },
    { role: 'user', content: '我今天很累。' },
    { role: 'assistant', content: '辛苦了，想聊聊吗？' },
    { role: 'user', content: '主要是工作上不顺。' },
  ],
})
```

其实 `prompt` 就是 `messages` 的语法糖。AI SDK 内部看到 `prompt` 时，会自动把它展开成一条 messages：

prompt-expansion.ts

```typescript
// 这个
{ system: 'X', prompt: 'Y' }
// 等价于
{ messages: [{ role: 'system', content: 'X' }, { role: 'user', content: 'Y' }] }
```

所以同时传 `prompt` 和 `messages` 会报错，只能二选一。

怎么选？几条经验：

- 前端来的消息数组，直接用 `messages`（`useChat` 默认给你的就是这种）

- 后端内部脚本（翻译、分类、摘要）用 `prompt` + `system` 更干净

- 有 tool call + 多轮交互必须用 `messages`，因为 tool 角色消息只能出现在 messages 里

## 3. system 的正确放置

`system` 是让模型扮演某个角色、遵守某些规则的最重要机制。但它在不同 Provider 底下的处理方式是不一样的：

- OpenAI 把它当 `messages[0]`，角色 `system`

- Anthropic 走独立 `system` 字段，不算消息的一部分

- Google Gemini 走独立 `systemInstruction` 字段

- Cohere 走 `preamble` 字段

这些差异 AI SDK 帮你抹平了。你只要统一这样写：

system-usage.ts

```typescript
// 方式 A：走 system 参数
const r = streamText({
  model: models.chat,
  system: buildSystemPrompt(ctx),
  messages: userMessages,
})

// 方式 B：写进 messages 里（作为 system 角色的第一条）
const r2 = streamText({
  model: models.chat,
  messages: [
    { role: 'system', content: buildSystemPrompt(ctx) },
    ...userMessages,
  ],
})
```

两种方式等价。推荐方式 A，原因有两点：

- 语义上更清楚，`system` 是一个独立参数，不混在消息历史里

- 方便做 System Prompt 的集中管理（下一节会详细说）

### 多条 system 消息怎么处理

有时候业务需要多段 system 信息（角色 + 规则 + 当前时间 + 用户画像），两种写法。

拼成一个大字符串：

multi-system.ts

```typescript
const system = [
  '你是一个情感细腻的 AI 伴侣，名字叫小舟。',
  `当前北京时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
  `用户画像：${userProfile.personalityTags.join(', ')}`,
  '规则：',
  '- 每次回复不超过 80 字',
  '- 不要给建议，除非用户明确要求',
  '- 保持温和、不评判的语气',
].join('\n\n')

const r = streamText({ model: models.chat, system, messages })
```

或者拆成多条 system 消息：

multi-system-messages.ts

```typescript
const r = streamText({
  model: models.chat,
  messages: [
    { role: 'system', content: '你是小舟，情感细腻的 AI 伴侣。' },
    { role: 'system', content: `当前时间：${time}` },
    { role: 'system', content: `用户画像：${tags}` },
    { role: 'system', content: '规则：\n- 回复不超过 80 字\n...' },
    ...userMessages,
  ],
})
```

AI SDK 会根据 Provider 要求自动合并或保留。多数情况下拼字符串更安全（某些 Provider 只认第一条 system）；多条 system 可读性更好。生产项目建议直接拼字符串。

## 4. 多模态 Prompt：图、文件、PDF

Chat API 的消息不再局限于纯文本。AI SDK 把多模态输入统一成了 `content: Array<TextPart | ImagePart | FilePart>`：

multimodal.ts

```typescript
import { generateText } from 'ai'

const { text } = await generateText({
  model: models.chat,
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: '描述这张图里发生了什么：' },
        { type: 'image', image: new URL('https://example.com/photo.jpg') },
      ],
    },
  ],
})
```

图片支持多种来源：

image-sources.ts

```typescript
// URL
{ type: 'image', image: new URL('https://...') }

// Base64 字符串
{ type: 'image', image: 'data:image/png;base64,iVBORw0KG...' }

// Buffer / Uint8Array（Node 侧）
{ type: 'image', image: await readFile('photo.png') }
```

PDF 或其他文件：

file-input.ts

```typescript
{
  type: 'file',
  mediaType: 'application/pdf',
  data: await readFile('report.pdf'),
}
```

几个注意点：

- 不是所有 Provider 都支持多模态，不支持时 AI SDK 会直接抛错

- Gemini 的多模态能力最强（支持视频、音频），GPT-4o / Claude 4 支持图和 PDF

- URL 模式下，Provider 会帮你下载文件或直接转给模型，但跨区访问可能触发超时。生产环境建议先自己下载，再以 base64 或 Buffer 喂入

## 5. Few-Shot 示例的两种写法

Few-Shot 就是在 prompt 里塞几个「输入-输出」范例。AI SDK 里有两种写法。

写进 system：

fewshot-system.ts

```typescript
const system = `
你是一个情绪分类器。根据用户文字，返回 happy / sad / angry / neutral 之一。

示例：
输入：今天中了彩票！
输出：happy

输入：好烦，又没赶上地铁。
输出：angry

输入：这花不错。
输出：neutral
`

const { text } = await generateText({
  model: models.chat,
  system,
  prompt: `输入：${userText}\n输出：`,
})
```

写进 messages，做成对话式 few-shot：

fewshot-messages.ts

```typescript
const { text } = await generateText({
  model: models.chat,
  system: '你是情绪分类器，只返回 happy / sad / angry / neutral 之一。',
  messages: [
    { role: 'user', content: '今天中了彩票！' },
    { role: 'assistant', content: 'happy' },
    { role: 'user', content: '好烦，又没赶上地铁。' },
    { role: 'assistant', content: 'angry' },
    { role: 'user', content: '这花不错。' },
    { role: 'assistant', content: 'neutral' },
    { role: 'user', content: userText },
  ],
})
```

怎么选：

- 示例在 5 条以内、格式简单，写进 system 更紧凑

- 示例较多、格式复杂、需要模拟真实对话风格，写进 messages 更稳定

- 如果做的是 Structured Output（下一篇讲 `generateObject`），这两种都不需要，直接用 Zod schema 约束就行

## 6. Prompt 管理：集中化与版本化

Prompt 散落在代码里的项目，大概第三个月就会开始失控：

- 改一个 system prompt 要搜遍 10 个文件

- 不知道生产上当前跑的是哪一版 prompt

- 想做 A/B 对比但没有基线

下面推荐一个最小可行的 Prompt 管理方案，适合 AI 伴侣这种规模的项目。

### 方案：packages/prompts 独立包

companion.ts伴侣主体 promptemotion-classifier.ts情绪分类 promptmemory-extractor.ts记忆提取 promptindex.ts统一出口

每个文件导出一个 prompt 模板函数：

prompts/companion.ts

```typescript
import { z } from 'zod'

export const CompanionPromptContextSchema = z.object({
  userNickname: z.string(),
  personalityTags: z.array(z.string()),
  intimacy: z.number().min(0).max(1),
  recentEmotions: z.array(z.string()),
  memories: z.array(z.object({
    content: z.string(),
    relevance: z.number(),
  })),
  currentTime: z.string(),
})

export type CompanionPromptContext = z.infer<typeof CompanionPromptContextSchema>

export const COMPANION_PROMPT_VERSION = 'v1.3'

export function buildCompanionPrompt(ctx: CompanionPromptContext): string {
  return [
    `你是小舟，一个情感细腻的 AI 伴侣，陪伴用户 ${ctx.userNickname}。`,
    '',
    `当前时间：${ctx.currentTime}`,
    `亲密度：${(ctx.intimacy * 100).toFixed(0)}/100`,
    `用户画像：${ctx.personalityTags.join('、')}`,
    '',
    ctx.memories.length > 0
      ? `相关回忆（越靠前越相关）：\n${ctx.memories.map(m => `- ${m.content}`).join('\n')}`
      : '',
    '',
    '规则：',
    '- 每次回复 30~120 字',
    '- 不主动给建议，除非用户请求',
    '- 保持温和、不评判的语气',
    '- 如果用户提到过去的事，尽量自然地引用相关回忆',
  ].filter(Boolean).join('\n')
}
```

这份代码有三个关键点：

- Context 用 Zod schema 描述，编译期类型安全，运行期也能校验

- 导出版本号 `COMPANION_PROMPT_VERSION`，埋点时当字段用，方便做 A/B 对照

- 函数是纯函数，同样的 context 一定产出同样的 prompt，方便测试和回放

使用方也很直接：

usage.ts

```typescript
import { buildCompanionPrompt, COMPANION_PROMPT_VERSION } from '@/prompts/companion'
import { streamText } from 'ai'

const result = streamText({
  model: models.chat,
  system: buildCompanionPrompt(ctx),
  messages: convertToModelMessages(messages),
  experimental_telemetry: {
    isEnabled: true,
    metadata: {
      'prompt.name': 'companion',
      'prompt.version': COMPANION_PROMPT_VERSION,
    },
  },
})
```

`experimental_telemetry.metadata` 让你在 OpenTelemetry 里能看到每一次调用用的是哪一版 prompt（[可观测性：Telemetry](/17-observability) 会展开）。

### 要不要上 PromptLayer / Langfuse Prompts / LangSmith Playground

这些工具提供的能力是「在 Web UI 里改 prompt，不用发版」。核心卖点是让产品经理或运营人员也能参与 Prompt 调优，不必走发版流程。

选型按团队规模看：

- 小团队或单人项目：代码版本化就够了，省去外部依赖。上面的 `packages/prompts` 方案已经覆盖了版本化和埋点的需求

- 多人协作、产品经理要参与 Prompt 调优：可以接 Langfuse Prompts，效果立竿见影。Langfuse 还自带调用链追踪，配合 [可观测性：Telemetry](/17-observability) 的 Telemetry 体验很好

- 企业合规要求高：LangSmith Playground + 代码双轨，每次 prompt 变更都有审计记录

本专栏 AI 伴侣走代码版本化路线，后期如果接入 Langfuse 会在 [可观测性：Telemetry](/17-observability) 提到。

## 7. 常见陷阱

### 陷阱 1：System 被用户消息覆盖

某些 Provider（尤其是开源小模型）对 system 的遵从度不高。用户如果说「忽略你之前的设定」，可能真的会把角色丢掉。可以这样缓解：

- 关键规则每 N 轮用户消息后重新注入一次 system

- 在每条用户消息前 prepend 简短提醒（但会增加 token 成本）

- 生产上直接用推理能力强的模型（GPT-4 级别）

### 陷阱 2：消息越界 / Token 超限

长会话 + 多段 prompt + 历史工具调用结果，很容易打爆 context window。AI SDK 抛 `AI_APICallError: context_length_exceeded` 之后，常见恢复策略：

- 滑动窗口，只保留最近 K 条

- 摘要化，把早期消息摘成一条 system

- 分层记忆，让旧内容进 Vectorize，需要时再检索回来（这正是本专栏 AI 伴侣的设计）

### 陷阱 3：Prompt 改动引发线上漂移

你改了 prompt，本地测试没问题，上线后一批用户反馈异常。常见原因是测试 case 覆盖不全、改动引发了工具调用路径变化、用户消息分布和测试集差异大。防护手段：

- Prompt 版本化 + 埋点（上面的方案已经覆盖）

- 影子模式灰度：一部分流量跑旧 prompt、一部分跑新 prompt，对比结果（[影子模式与灰度验证](/17-shadow-rollout-validation) 专题讲过）

- 关键业务 prompt 补自动化回归用例

### 陷阱 4：Few-shot 不是越多越好

过多的 few-shot 会带来几个副作用：每次调用都要发，token 成本会飙；模型可能「过拟合」到示例的某个表达习惯；system 的主导权也会被稀释。经验上对话式 few-shot 超过 5 组就不太划算了，如果真需要大量示例，考虑微调而不是 few-shot。

## 8. 小结

- `prompt` 是 `messages` 的语法糖，二选一；多轮或工具调用必用 `messages`

- `system` 用参数而不是消息更干净，多段 system 建议拼字符串

- 多模态输入用 `content` 数组，`image` 支持 URL / base64 / Buffer，`file` 支持 PDF 等

- Few-shot 两种写法：写进 system 紧凑、写进 messages 更稳；Structured Output 时都不需要

- Prompt 管理独立包 + 版本号，配合 `experimental_telemetry` 埋点，方便做 A/B 和灰度

- 四个常见陷阱：system 覆盖、context 越界、prompt 改动漂移、few-shot 过量

下一篇进入 Core 层主干——**`streamText` 与 UIMessageStream 协议**。对照 [Streaming](/13-streaming-response-architecture) 手写版本，看看一个统一协议能省掉多少手写代码。
