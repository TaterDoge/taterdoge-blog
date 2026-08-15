---
title: "236 澄清问题与补全信息"
pubDate: 2026-08-12
description: "上一篇中，Agent 已经从「我明天要坐高铁去上海出差，应该带什么」这句话里识别出了用户的意图和目标：用户正在准备一次出差，希望得到一份适合这次行程的物品清单。"
tags: [AI编程, 学习心法]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-12
---
原文链接：[https://aicompanion.usehook.cn/2clarify-the-question/](https://aicompanion.usehook.cn/2clarify-the-question/)

## 1. 信息不全

上一篇中，Agent 已经从「我明天要坐高铁去上海出差，应该带什么」这句话里识别出了用户的意图和目标：用户正在准备一次出差，希望得到一份适合这次行程的物品清单。

这个判断的置信度可以很高，但 Agent 仍然不知道出差几天，也不知道用户需要参加普通办公、正式会议还是客户拜访。它已经看懂了问题，却还没有掌握生成可靠清单所需的全部条件。

这是初学 Agent 开发时很容易混淆的两个判断：

| 判断 | 回答的问题 | 当前案例 |
| --- | --- | --- |
| 意图置信度 | 我是否看懂用户想做什么 | 高 |
| 信息完整度 | 我是否具备完成目标的条件 | 还不够 |

因此，意图识别之后不应该马上制定计划。更稳妥的下一步，是检查缺失信息会不会改变最终结果，并决定应该从哪里取得这些信息。

## 2. 获取信息来源

上一篇的信息抽取结果中，一个字段 `missingInformation` 会列出「出差天数」「具体工作安排」「天气情况」等缺口。它们看起来都叫缺失信息，获取方式却不相同。

**从过往的历史对话中获取信息**，是智能化的重要体现。当然，这种方式的前提是，Agent 能够记住前面发生过什么，因此从这里可以衍生出几乎所有的 Agent 都需要实现的能力：记忆系统

「速成法中不针对记忆系统做扩展，前面我们有大量的篇幅在详细讲解，这里就不再赘述了」

**需要询问用户的信息**，通常是只有用户自己知道的行程和偏好。例如出差几天、是否要见客户、是否需要携带演示设备。这些内容无法通过常识可靠推断，猜错之后还会直接影响清单。

**适合交给工具的信息**，通常是可以从外部服务取得的客观事实。例如天气、车次状态和日历安排。Agent 应该记录这些查询项，而不是要求用户先去天气应用查完再回来回答。

**暂时不必补充的信息**，是那些变化之后也不会明显改变答案的细节。为了显得周到而把所有可能的问题都问一遍，只会把一次简单对话变成长表单。

这一步让 Agent 多了一层判断：它不再看到缺口就统一追问，而是先识别信息来源。系统由一条直线流程变成了带有分支和重复执行的流程，复杂度也从「生成内容」增加到了「管理对话状态和下一步动作」。

## 3. 追问

假设当前还缺少出差天数、工作安排和个人偏好，Agent 可以一次把三个问题全部抛给用户。但这很像填写表单，用户既要理解多个问题，又要组织一段完整答案，放弃回复的可能性也会增加。

更自然的策略，是每轮只选择一个最能改变最终结果的问题。判断时可以问自己：如果这个答案不同，物品清单会不会发生明显变化？

对当前案例来说，「出差几天」会直接影响衣物、药品和充电用品的数量，通常比「喜欢背什么颜色的包」更值得优先确认。因此，Agent 可以先问：

NOTE

这次去上海准备待几天？

用户回答之后，Agent 不是顺着预先写好的问题列表机械地问下一题，而是把新信息放回当前上下文，重新计算还剩下哪些关键缺口。这个过程可以概括成四步：整理已知信息、找出关键缺口、只追问一个问题、收到回答后重新检查。

当没有会明显改变结果的用户信息缺口时，澄清就应该停止。好的 Agent 不以「问得多」为目标，而以「用尽量少的交互获得足够信息」为目标。

## 4. 案例

下面的案例从上一篇使用的原始问题重新开始，不会提前假定 `intent`、`goal` 或 `missingInformation` 已经存在。点击「开始上海出差案例」后，你会依次看到三个阶段：

- 使用上一篇的 `IntentSchema` 识别 `intent`、`goal` 和 `confidence`；

- 使用上一篇的 `InformationSchema` 抽取已知条件和 `missingInformation`；

- 把真实的 `missingInformation` 分成询问用户、交给工具和暂不补充三类。

第三步如果发现还缺少用户才能提供的信息，只会提出一个最关键的问题。你可以继续输入「三天，需要参加产品评审，第二天还要见客户」。这次不会再执行意图识别和初始信息抽取，而是直接进入第三步：读取上一轮保存的信息状态，把新回答合并进去，再判断还剩下哪些缺口。

澄清问题与补全信息完整展示意图识别、信息抽取和澄清从上一篇的上海出差问题开始，观察三步结果如何连续传递agent.tsintent-schema.tsintent-prompt.tsclarify-schema.tsclarify-prompt.tschat.tsx

```typescript
import { ChatOpenAI } from '@langchain/openai'
import { readRequiredActiveLlmConfig } from '@keepzml/llm-runtime/client'

import {
  INFORMATION_SYSTEM_PROMPT,
  INTENT_SYSTEM_PROMPT,
} from '../../1what-to-bring/demo/intent/prompt'
import {
  InformationSchema,
  IntentSchema,
} from '../../1what-to-bring/demo/intent/schema'
import { CLARIFICATION_SYSTEM_PROMPT } from './prompt'
import { ClarificationSchema } from './schema'

export interface ClarificationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ClarificationChunk {
  content: string
  model: string
}

interface IntentState {
  intent: string
  goal: string
  confidence: string
}

interface InformationState {
  time: string | null
  destination: string | null
  purpose: string | null
  duration: string | null
  explicitDetails: string[]
  missingInformation: string[]
}

export interface ClarificationSession {
  intent: IntentState | null
  information: InformationState | null
  processedUserMessageCount: number
}

export function createClarificationSession(): ClarificationSession {
  return {
    intent: null,
    information: null,
    processedUserMessageCount: 0,
  }
}

export async function* runClarificationAgent(
  messages: readonly ClarificationMessage[],
  session: ClarificationSession,
  abortSignal?: AbortSignal,
): AsyncGenerator<ClarificationChunk> {
  const userMessages = messages
    .filter(message => message.role === 'user')
    .map(message => message.content.trim())
    .filter(Boolean)

  const originalQuestion = userMessages[0]
  if (!originalQuestion) throw new Error('请先输入出行问题')

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

  // DeepSeek 思考模式不接受强制 tool_choice，因此继续沿用上一篇的 JSON mode。
  const structuredOutputMethod = config.provider === 'deepseek'
    ? 'jsonMode'
    : 'functionCalling'

  let intent = session.intent
  let information = session.information
  const isFirstRound = !intent || !information

  if (isFirstRound) {
    // 只有首轮需要建立 intent 和初始信息状态。
    yield createChunk(
      '### 第一步：意图识别\n\n正在复用上一篇的 `IntentSchema` 判断用户想做什么...\n\n',
      config.model,
    )

    intent = await model
      .withStructuredOutput(IntentSchema, {
        name: 'recognize_intent',
        method: structuredOutputMethod,
      })
      .invoke([
        ['system', INTENT_SYSTEM_PROMPT],
        ['human', originalQuestion],
      ], { signal: abortSignal })

    yield createChunk([
      `- 意图：${intent.intent}`,
      `- 目标：${intent.goal}`,
      `- 置信度：${intent.confidence}`,
      '',
    ].join('\n'), config.model)

    yield createChunk(
      '### 第二步：信息抽取\n\n正在从原始问题中建立第一份信息状态...\n\n',
      config.model,
    )

    information = await model
      .withStructuredOutput(InformationSchema, {
        name: 'extract_information',
        method: structuredOutputMethod,
      })
      .invoke([
        ['system', INFORMATION_SYSTEM_PROMPT],
        [
          'human',
          `用户问题：${originalQuestion}\n\n已经识别出的意图：${intent.intent}\n用户目标：${intent.goal}`,
        ],
      ], { signal: abortSignal })

    yield createChunk(`${formatInformation(information)}\n`, config.model)

    session.intent = intent
    session.information = information

    yield createChunk(
      '### 第三步：缺口分类与澄清\n\n正在判断每个缺口应该询问用户、交给工具，还是暂不处理...\n\n',
      config.model,
    )
  }
  else {
    if (!intent || !information) {
      throw new Error('会话中没有可继续补全的信息状态')
    }

    // 后续回答就是第三步的输入，前两步结果直接从会话状态读取。
    yield createChunk([
      '### 第三步：继续补全信息',
      '',
      `- 沿用意图：${intent.intent}`,
      `- 上一轮缺口：${formatList(information.missingInformation)}`,
      '- 第一步和第二步不再执行',
      '',
      '正在把本轮回答合并进已有信息状态...',
      '',
    ].join('\n'), config.model)
  }

  if (!intent || !information) {
    throw new Error('意图识别或信息抽取没有生成可用状态')
  }

  const latestUserSupplement = isFirstRound
    ? []
    : userMessages.slice(session.processedUserMessageCount)

  const clarification = await model
    .withStructuredOutput(ClarificationSchema, {
      name: 'complete_and_classify_information',
      method: structuredOutputMethod,
    })
    .invoke([
      ['system', CLARIFICATION_SYSTEM_PROMPT],
      [
        'human',
        JSON.stringify({
          intent,
          currentInformation: information,
          latestUserSupplement,
        }, null, 2),
      ],
    ], { signal: abortSignal })

  const updatedInformation = mergeInformation(
    information,
    clarification.information,
  )

  session.information = updatedInformation
  session.processedUserMessageCount = userMessages.length

  yield createChunk(
    formatClarification(clarification, updatedInformation, !isFirstRound),
    config.model,
  )
}

function mergeInformation(
  current: InformationState,
  updated: InformationState,
): InformationState {
  return {
    time: updated.time ?? current.time,
    destination: updated.destination ?? current.destination,
    purpose: updated.purpose ?? current.purpose,
    duration: updated.duration ?? current.duration,
    explicitDetails: [...new Set([
      ...current.explicitDetails,
      ...updated.explicitDetails,
    ])],
    missingInformation: updated.missingInformation,
  }
}

function formatClarification(
  result: {
    askUserFor: readonly string[]
    toolInformation: readonly string[]
    notRequiredInformation: readonly string[]
    readyToPlan: boolean
    nextQuestion: string | null
    reason: string
  },
  information: InformationState,
  showUpdatedInformation: boolean,
) {
  const sections = showUpdatedInformation
    ? ['#### 合并后的信息状态', '', formatInformation(information), '']
    : []

  sections.push(
    '#### 剩余缺口的处理方式',
    '',
    `- 询问用户：${formatList(result.askUserFor)}`,
    `- 交给工具：${formatList(result.toolInformation)}`,
    `- 暂不补充：${formatList(result.notRequiredInformation)}`,
    `- 可以进入计划：${result.readyToPlan ? '是' : '否'}`,
    '',
  )

  if (result.readyToPlan) {
    sections.push(
      '**用户侧关键条件已经补齐，可以进入计划阶段。**',
      '',
      `判断依据：${result.reason}`,
    )
  }
  else {
    sections.push(
      '**继续澄清，但这一轮只问一个问题。**',
      '',
      `判断依据：${result.reason}`,
      '',
      `> ${result.nextQuestion}`,
    )
  }

  return `${sections.join('\n')}\n`
}

function formatInformation(information: InformationState) {
  return [
    `- 时间：${information.time ?? '未提供'}`,
    `- 地点：${information.destination ?? '未提供'}`,
    `- 出行目的：${information.purpose ?? '未提供'}`,
    `- 停留时长：${information.duration ?? '未提供'}`,
    `- 其他明确条件：${formatList(information.explicitDetails)}`,
    `- 当前缺少的信息：${formatList(information.missingInformation)}`,
  ].join('\n')
}

function createChunk(content: string, model: string): ClarificationChunk {
  return { content, model }
}

function formatList(items: readonly string[]) {
  return items.length ? items.join('、') : '无'
}

```

`agent.ts` 是这次案例最值得观察的文件。首轮运行时，它没有复制或改写上一篇的 Zod 和提示词，而是直接导入它们，然后按「意图识别 → 信息抽取 → 缺口分类」的顺序传递真实结果。完成首轮之后，它会把 `intent`、当前信息和已经处理的用户消息数量保存到会话状态中。

用户第二次回答后，主流程直接读取这份状态，只把尚未处理的用户消息作为 `latestUserSupplement` 交给第三步。第三步会合并新事实、移除已经解决的缺口，并重新生成 `askUserFor` 和 `nextQuestion`。这样既不会重复花费模型调用，也不会让已经稳定的意图在每轮对话中发生不必要的变化。

## 5. 字段说明

现在的案例包含三个连续阶段，字段也应该放回各自所属的阶段理解：

| 阶段 | 字段 | 作用 |
| --- | --- | --- |
| 意图识别 | intent、goal、confidence | 确定任务类型、完成目标和判断把握 |
| 信息状态 | time、destination、duration 等 | 第二步初始建立，第三步随用户补充更新 |
| 信息状态 | missingInformation | 保存第三步仍然需要处理的条件 |
| 缺口分类 | askUserFor | 找出必须询问用户的关键缺口 |
| 缺口分类 | toolInformation | 找出应该由外部工具获取的信息 |
| 缺口分类 | notRequiredInformation | 明确哪些缺口当前不值得继续补充 |
| 缺口分类 | nextQuestion | 控制这一轮只推进一个问题 |
| 代码推导 | readyToPlan | 决定继续澄清还是进入计划 |

首轮中，前一个阶段的输出会成为后一个阶段的输入：没有 `goal`，Agent 不知道哪些信息会影响完成标准；没有 `missingInformation`，澄清步骤就只能凭空发明问题；没有缺口分类，系统又会把天气这种客观信息错误地推给用户回答。后续轮次则沿用前两步的稳定结果，只更新第三步负责的信息状态。学习者在演示中看到的不是三段孤立文字，而是一条有状态的数据链路。

字段越多，不代表 Agent 一定越聪明。每增加一个字段，代码就要处理它为空、格式错误或与其他字段矛盾的情况。例如模型可能一边返回需要询问的内容，一边又声称已经可以规划。

因此，案例没有让模型直接生成 `readyToPlan`，而是由代码根据 `askUserFor.length === 0` 推导。只要仍有关键问题需要用户回答，就不能进入计划；当列表为空时，用户侧澄清才算结束。把能够确定的规则留在代码里，比让模型同时猜两个互相依赖的字段更稳定。

## 6. 计划制定

「信息足够」不是指所有相关信息都已经收集完，而是指当前掌握的条件足以决定下一步，而且继续追问带来的收益已经很小。

在这个案例中，当用户说明出差天数和关键工作安排后，Agent 就不必继续询问低价值偏好。天气仍然未知，但它已经被放进 `toolInformation`，后续可以由天气工具查询。此时 `readyToPlan` 表示的是「用户侧关键条件已经补齐」，并不表示整个任务已经完成。

进入计划前，可以用三个问题做最后检查：

- 目标是否仍然清楚；

- 是否还缺少只有用户才能提供、并且会明显改变结果的信息；

- 剩余缺口是否已经有明确的工具或默认策略负责处理。

三个问题都能得到明确答案时，Agent 才适合把目标拆成任务、安排工具调用，并生成可以执行的步骤。这样制定出来的计划依赖的是已经确认的事实，而不是藏在模型回答里的猜测。
