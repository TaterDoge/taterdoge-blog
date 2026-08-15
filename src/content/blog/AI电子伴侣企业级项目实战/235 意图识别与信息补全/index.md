---
title: "235 意图识别与信息补全"
pubDate: 2026-08-12
description: "我们常说的 Agent 是对于大模型（LLM）对话能力的封装。"
tags: [AI编程, 学习心法]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-12
---
原文链接：[https://aicompanion.usehook.cn/1what-to-bring/](https://aicompanion.usehook.cn/1what-to-bring/)

## 1. 什么是 AI Agent

我们常说的 Agent 是对于大模型（LLM）对话能力的封装。

Agent 的复杂度，会按照如下几个方向，进行演变

- 从单次对话，到多次对话、

- 从短期对话，到长期对话、

- 从有回应，到有更好的回应

- 从单角色，到多角色对话、

而我们的速成学习法，也是围绕这个方向进行展开。因此，这一章，我们要要掌握的，就是我们最熟悉的最常见的一种场景：跟 LLM 单次对话

## 单次对话

如下案例所示，我这里实现了一个最简单 Agent. 在此 Agent 中，我没有做任何处理，直接跟大语言模型进行对话，通俗来说就是直接调用大语言模型的 API，我的第一个需求是：「**明天出门我应该带什么**？」

出行规划 Agent

LangChain + DeepSeek

告诉 Agent 你的出行计划，看看它还需要了解哪些信息

```typescript agent.ts
import { ChatOpenAI } from '@langchain/openai'
import { readRequiredActiveLlmConfig } from '@keepzml/llm-runtime/client'

export interface AgentReplyChunk {
  content: string
  model: string
}

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function* runTravelAgent(
  messages: readonly AgentMessage[],
  abortSignal?: AbortSignal,
): AsyncGenerator<AgentReplyChunk> {
  const config = await readRequiredActiveLlmConfig({ provider: 'deepseek' })
  const model = new ChatOpenAI({
    apiKey: config.apiKey,
    model: config.model,
    temperature: config.temperature ?? 0,
    maxTokens: config.maxTokens,
    timeout: config.timeoutMs ?? 30000,
    maxRetries: 1,
    streamUsage: false,
    configuration: {
      baseURL: config.baseURL,
      dangerouslyAllowBrowser: true,
    },
  })

  const stream = await model.stream([
    [
      'system',
      `你是一个谨慎的出行规划 Agent。你的目标是根据用户的目的地、行程、天气和个人习惯，给出可靠的出行准备建议`,
    ],
    ...messages.map(message => ({
      role: message.role,
      content: message.content,
    })),
  ], { signal: abortSignal })

  let hasContent = false

  for await (const chunk of stream) {
    const content = readTextContent(chunk.content)
    if (!content) continue

    hasContent = true
    yield {
      content,
      model: config.model,
    }
  }

  if (!hasContent) throw new Error('模型没有返回可显示的文字内容')
}

function readTextContent(content: unknown) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const text = content
    .map((part) => {
      if (typeof part === 'string') return part
      if (
        part
        && typeof part === 'object'
        && 'text' in part
        && typeof part.text === 'string'
      ) {
        return part.text
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')

  return text
}

```

```tsx chat-demo.tsx
'use client'

import {
  ArticleChat,
  type ArticleChatRun,
} from '@keepzml/ui/article-chat'

import { runTravelAgent } from './agent'

const runAgent: ArticleChatRun = ({ messages, abortSignal }) => {
  return runTravelAgent(messages, abortSignal)
}

export default function TravelAgentDemo() {
  return (
    <ArticleChat
      title='出行规划 Agent'
      subtitle='LangChain + DeepSeek'
      emptyText='告诉 Agent 你的出行计划，看看它还需要了解哪些信息'
      suggestions={['明天出门我应该带什么？']}
      placeholder='描述目的地、行程或者个人需求...'
      pendingText='Agent 正在分析'
      onRun={runAgent}
    />
  )
}
```

目前为止，从回复中，我们可以看到。此时 LLM **并无法给我们准确答案**，它给出的答案，更像是一种通用建议，而非针对性的建议。

这个回答并不算错，但它没有真正解决问题。

因为「应该带什么」并不是一个固定清单，而是取决于很多事情：明天去哪里，要待多久，天气怎么样，中间有没有特殊安排，身上有没有已经习惯携带的物品。

如果明天只是下楼取个快递，带上手机和钥匙就够了；如果要坐高铁去外地出差，身份证、充电器、电脑和药品也许更重要。问题本身没有变，答案却会随着场景变化。

这就是我们学习开发 AI Agent 时非常重要的第一个观察：**用户说出来的通常只是一个结果愿望，而不是一份完整需求。**

**并且，用户大概率并不会主动告诉我们所有背景**。他只会说自己此刻最先想到的那句话

因此，当用户期望我们的 Agent 变得更加强大，能够给出更加精准的答案时，我们就需要帮助用户低成本的补充缺失的信息，例如，常见的前置信息有

- 用户的目的地

- 用户的出行方式

- 用户的出行时间

- 天气怎么样

- 用户的出行习惯

- 用户的出行特殊需求

- 用户出行的陪同人员

- ...

当我们开始尝试去补全这些前置信息时，我们的 Agent 就会逐渐变得更加复杂，相对应的一系列我们需要学习的知识点，也会随之出现

首先第一个需要学习的知识点是：**意图识别**

## 2. 意图识别

在帮助用户更加精准的回答时，我们首先需要做的，就是**意图识别与信息抽取**：LLM 要首先知道用户想要**做什么**，并且在得到更准确的回答之前，还**缺什么**

用户输入“明天出门我应该带什么？”之后，Agent 先不急着给出物品清单，而是把处理过程做一个拆分：先判断用户想完成什么，再整理问题中已经明确出现的信息。

拆开之后，每一步只负责一个比较明确的任务。第一步回答“用户想做什么”，第二步回答“用户已经说了什么、还缺什么”。等这两个结果稳定下来，后面再决定要不要查天气、要不要追问用户，就有了可以依赖的上下文。

我们通过下面这个案例演示，来理解这个过程

意图识别与信息抽取

只分析，不生成最终建议

输入一个问题，查看 Agent 如何拆解它

```typescript agent.ts
import { ChatOpenAI } from '@langchain/openai'
import { readRequiredActiveLlmConfig } from '@keepzml/llm-runtime/client'

import { INFORMATION_SYSTEM_PROMPT, INTENT_SYSTEM_PROMPT } from './prompt'
import { InformationSchema, IntentSchema } from './schema'

export interface IntentMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface IntentChunk {
  content: string
  model: string
}

export async function* runIntentAgent(
  messages: readonly IntentMessage[],
  abortSignal?: AbortSignal,
): AsyncGenerator<IntentChunk> {
  // 这个案例只分析最后一条用户消息，前面的对话暂不参与判断。
  const question = [...messages]
    .reverse()
    .find(message => message.role === 'user')?.content.trim()

  if (!question) throw new Error('请先输入一个问题')

  const config = await readRequiredActiveLlmConfig()
  const model = new ChatOpenAI({
    apiKey: config.apiKey,
    model: config.model,
    temperature: config.temperature ?? 0,
    maxTokens: config.maxTokens,
    timeout: config.timeoutMs ?? 30000,
    maxRetries: 1,
    streamUsage: false,
    configuration: {
      baseURL: config.baseURL,
      dangerouslyAllowBrowser: true,
    },
  })

  // DeepSeek 思考模式不接受强制 tool_choice，因此改用 JSON mode。
  const structuredOutputMethod = config.provider === 'deepseek'
    ? 'jsonMode'
    : 'functionCalling'

  // 第一步只判断用户想做什么，不生成物品清单。
  yield {
    content: '### 第一步：意图识别\n\n正在判断用户想完成什么事情...\n\n',
    model: config.model,
  }

  const intent = await model
    .withStructuredOutput(IntentSchema, {
      name: 'recognize_intent',
      method: structuredOutputMethod,
    })
    .invoke([
      ['system', INTENT_SYSTEM_PROMPT],
      ['human', question],
    ], { signal: abortSignal })

  yield {
    content: [
      `意图：${intent.intent}`,
      `目标：${intent.goal}`,
      `置信度：${intent.confidence}`,
    ].join('\n') + '\n\n',
    model: config.model,
  }

  // 第二步只提取已知条件，并列出完成目标还缺少的信息。
  yield {
    content: '### 第二步：信息抽取\n\n正在整理问题中已经明确出现的信息...\n\n',
    model: config.model,
  }

  const information = await model
    .withStructuredOutput(InformationSchema, {
      name: 'extract_information',
      method: structuredOutputMethod,
    })
    .invoke([
      ['system', INFORMATION_SYSTEM_PROMPT],
      ['human', `用户问题：${question}\n\n已经识别出的意图：${intent.intent}`],
    ], { signal: abortSignal })

  yield {
    content: [
      `- 时间：${information.time ?? '未提供'}`,
      `- 地点：${information.destination ?? '未提供'}`,
      `- 出行目的：${information.purpose ?? '未提供'}`,
      `- 停留时长：${information.duration ?? '未提供'}`,
      `- 其他明确条件：${formatList(information.explicitDetails)}`,
      `- 当前缺少的信息：${formatList(information.missingInformation)}`,
    ].join('\n') + '\n\n',
    model: config.model,
  }
}

function formatList(items: readonly string[]) {
  return items.length ? items.join('、') : '无'
}

```

```typescript schema.ts
import { z } from 'zod'

const IntentConfidenceSchema = z.enum(['高', '中', '低'])
type IntentConfidence = z.infer<typeof IntentConfidenceSchema>
const StringListSchema = z.union([z.array(z.string()), z.string()]).nullable().optional()
const DetailValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]).nullable()
const ExplicitDetailsSchema = z.union([
  z.array(z.string()),
  z.string(),
  z.record(DetailValueSchema),
]).nullable().optional()

export const IntentSchema = z.object({
  intent: z.string().describe('用户这次输入想完成的事情，用一句短语表示'),
  goal: z.string().optional().describe('用户希望最终得到什么结果'),
  expected_result: z.string().optional().describe('goal 的兼容字段'),
  confidence: z.union([
    IntentConfidenceSchema,
    z.number().min(0).max(1),
  ]).describe('判断信心，可以是高/中/低或 0 到 1 的数值'),
}).transform(({ intent, goal, expected_result, confidence }) => ({
  intent,
  goal: goal ?? expected_result ?? '未提供',
  confidence: normalizeConfidence(confidence),
}))

export const InformationSchema = z.object({
  time: z.string().nullable().optional().describe('用户明确提到的时间'),
  destination: z.string().nullable().optional().describe('用户明确提到的地点'),
  purpose: z.string().nullable().optional().describe('用户明确提到的出行目的'),
  duration: z.string().nullable().optional().describe('用户明确提到的停留时长'),
  explicitDetails: ExplicitDetailsSchema.describe('问题中明确出现的其他条件，优先返回字符串数组，也兼容键值对象'),
  explicit_details: ExplicitDetailsSchema.describe('explicitDetails 的兼容字段'),
  missingInformation: StringListSchema.describe('当前尚未提供的信息'),
  missing_information: StringListSchema.describe('missingInformation 的兼容字段'),
}).transform(({
  time,
  destination,
  purpose,
  duration,
  explicitDetails,
  explicit_details,
  missingInformation,
  missing_information,
}) => ({
  time: time ?? null,
  destination: destination ?? null,
  purpose: purpose ?? null,
  duration: duration ?? null,
  explicitDetails: normalizeExplicitDetails(explicitDetails ?? explicit_details),
  missingInformation: normalizeStringList(missingInformation ?? missing_information),
}))

function normalizeStringList(value: readonly string[] | string | null | undefined) {
  if (Array.isArray(value)) return value.map(item => item.trim()).filter(Boolean)
  if (typeof value !== 'string' || !value.trim()) return []
  return [value.trim()]
}

type ExplicitDetailsInput = z.input<typeof ExplicitDetailsSchema>

const DETAIL_LABELS: Record<string, string> = {
  transportation: '交通方式',
  transport: '交通方式',
  dressCode: '着装要求',
  dress_code: '着装要求',
  companions: '同行人员',
  equipment: '携带设备',
}

function normalizeExplicitDetails(value: ExplicitDetailsInput) {
  if (Array.isArray(value) || typeof value === 'string' || value == null) {
    return normalizeStringList(value)
  }

  return Object.entries(value).flatMap(([key, detail]) => {
    if (detail == null) return []
    const label = DETAIL_LABELS[key] ?? key
    const content = Array.isArray(detail)
      ? detail.map(formatDetailValue).filter(Boolean).join('、')
      : formatDetailValue(detail)

    return content ? [`${label}：${content}`] : []
  })
}

function formatDetailValue(value: string | number | boolean) {
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value).trim()
}

function normalizeConfidence(value: IntentConfidence | number): IntentConfidence {
  if (typeof value !== 'number') return value
  if (value >= 0.8) return '高'
  if (value >= 0.5) return '中'
  return '低'
}

```

```typescript prompt.ts
export const INTENT_SYSTEM_PROMPT = `你只负责识别用户意图，不负责回答问题。

请根据用户输入判断：
1. 用户想完成什么事情；
2. 用户最终希望得到什么结果；
3. 对这个判断的信心程度。

不要补充用户没有表达的事实。
请严格使用 intent、goal、confidence 这三个字段；confidence 优先使用“高”“中”“低”之一。
请只输出符合要求的 json 对象，不要输出 Markdown 或其他文字。`

export const INFORMATION_SYSTEM_PROMPT = `你只负责从用户输入中抽取信息，不负责生成最终建议。

要求：
- 只能记录用户明确说出的内容；
- 没有出现的字段返回 null；
- 不要根据常识猜测地点、天气、出行目的或用户习惯；
- missingInformation 只列出完成用户目标时可能需要、但当前尚未提供的信息。
请严格使用 time、destination、purpose、duration、explicitDetails、missingInformation 这些字段。
- explicitDetails 使用字符串数组，例如 ["交通方式：高铁"]；没有其他明确条件时返回空数组。
请只输出符合要求的 json 对象，不要输出 Markdown 或其他文字。`

```

```tsx chat.tsx
'use client'

import {
  ArticleChat,
  type ArticleChatRun,
} from '@keepzml/ui/article-chat'

import { runIntentAgent } from './agent'

const runAgent: ArticleChatRun = ({ messages, abortSignal }) => {
  return runIntentAgent(messages, abortSignal)
}

export default function IntentChat() {
  return (
    <ArticleChat
      title='意图识别与信息抽取'
      subtitle='只分析，不生成最终建议'
      emptyText='输入一个问题，查看 Agent 如何拆解它'
      suggestions={[
        '我明天要坐高铁去上海出差，应该带什么？',
        '周末带孩子去公园，需要准备哪些东西？',
      ]}
      placeholder='输入一个自然语言问题...'
      pendingText='Agent 正在分析'
      onRun={runAgent}
    />
  )
}

```

在这个过程中，我们需要了解三个字段：`intent`、`goal`、`confidence`。它们并不只是为了让模型多返回几项数据，而是在为后续流程提供控制信号。

最简单的 LLM 调用只有一条路径：收到问题，然后直接回答。加入这三个字段之后，Agent 开始面对三类新的判断：应该进入哪条处理流程、怎样才算完成任务、当前信息是否足够继续执行。也正是从这里开始，一个简单问答逐渐变成了需要路由、状态和条件分支的 Agent。

## intent

`intent` 表示用户这次想做哪一类事情。对于“我明天要坐高铁去上海出差，应该带什么”这句话，我们可以把意图概括为“准备出差所需物品”。用户换一种说法，例如“去上海出差要准备哪些东西”，文字虽然不同，但意图并没有改变。

如果 Agent 只有“生成物品清单”这一种能力，其实不需要路由，所有输入都可以交给同一段代码。等它同时具备查询天气、预订车票和生成行李清单等能力后，问题就出现了：这次请求到底应该调用哪一种能力？`intent` 提供的正是这个判断依据。

这意味着每增加一种意图，Agent 通常就要增加一条处理分支，并为无法识别的意图准备兜底逻辑。意图识别错了，后面的步骤即使执行得完全正确，也会跑到错误的流程中。因此，`intent` 让 Agent 获得了选择能力，同时也引入了**路由复杂度**。

当前案例只把识别出的意图展示出来，还没有真正执行天气、车票或物品清单分支。我们先得到一个简短、稳定的 `intent`，是为了让后续章节可以在这个结果上继续增加路由，而不必每次重新理解用户原话。

## goal

`goal` 表示用户希望最终得到什么结果。仍然以出差为例，`intent` 可以是“准备出差所需物品”，对应的 `goal` 则是“得到一份适合乘坐高铁去上海出差的物品清单”。前者决定进入哪类流程，后者决定这条流程最后应该交付什么。

为什么已经有 `intent`，还需要再保留 `goal`？因为进入同一条出行准备流程后，用户可能希望得到完整的行李清单，也可能只想确认有没有漏带证件，还可能希望系统根据停留天数删掉不必要的物品。它们属于同一类事情，但完成标准并不相同。

当流程只有一次模型调用时，回答生成完毕就可以结束。引入 `goal` 之后，Agent 还要记录当前目标、判断缺少哪些条件，并在每一步执行后检查是否已经得到用户需要的结果。任务没有完成时，它可能继续查询工具、补充信息或追问用户；达到目标后，流程才应该结束。

因此，`goal` 不只是用来修饰最终回答。随着 Agent 能力增加，它会逐渐成为运行状态的一部分，并成为判断“继续还是结束”的依据。这让 Agent 能够处理多步骤任务，同时也引入了**状态与终止条件的复杂度**。当前案例先识别并展示 `goal`，后续再把它接入真正的任务状态。

## confidence

`confidence` 表示模型对本次意图判断有多大把握，通俗来说就是模型是否听懂了用户在说什么。没有这个字段时，Agent 只能假设自己的判断总是正确，然后直接进入下一步。加入置信度之后，它就可以根据不确定程度选择不同策略。

比如用户说“我明天要坐高铁去上海出差，应该带什么”，出行时间、方式、地点和目的都比较明确，模型通常会给出较高的置信度。如果用户只说“帮我准备一下”，我们甚至不知道他要准备旅行、会议还是考试，这时置信度就应该更低。低置信度不是报错，而是在提醒 Agent：**现在掌握的信息还不足以直接行动**。

这里需要注意，置信度是模型根据当前输入做出的自我判断，并不是经过统计验证的客观正确率。模型返回 `0.95`，不能简单理解成“这个意图有 95% 的概率一定正确”。它更适合用来做相对判断：信息越明确，置信度通常越高；表达越模糊，越应该先追问或让用户确认。

不同模型返回置信度的方式可能不同。有的直接返回“高”“中”“低”，有的会返回 `0` 到 `1` 之间的数值。这个案例会先把结果统一成三个等级：数值大于等于 `0.8` 记为“高”，大于等于 `0.5` 但小于 `0.8` 记为“中”，其余记为“低”。这样后面的代码只需要处理三个固定值，不必关心模型最初使用了哪种格式。

真正使用这个字段时，Agent 还要定义阈值和对应策略：置信度高时继续执行，置信度较低时先把问题问清楚，必要时还可以重新识别或交给人工确认。原本的一条执行路径由此变成多个条件分支，而且阈值设置不合理时，可能出现频繁追问或者错误执行。因此，`confidence` 引入的是**不确定性处理和条件分支的复杂度**。

当前案例只把置信度展示出来，还没有根据它改变执行流程。这里先完成格式统一和等级划分，是为了让下一步增加追问能力时，可以直接使用稳定的“高 / 中 / 低”结果。真实项目中的分档还需要根据实际测试结果和错误成本继续调整。

## 总结

到这里可以看到，由意图识别引发的三个字段分别增加了一种决策维度：`intent` 让 Agent 选择流程，`goal` 让 Agent 记录目标并判断何时结束，`confidence` 让 Agent 在不确定时改变执行策略。Agent 的复杂度并不是凭空增加的，而是因为我们开始把自然语言中原本模糊的判断，变成代码能够明确处理的路由、状态和分支。

下一步还不能急着制定计划。我们要先判断缺失的信息应该询问用户、交给工具查询，还是可以暂时忽略；只有关键条件补齐之后，计划才有可靠的依据。
