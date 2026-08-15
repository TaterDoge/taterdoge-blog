---
title: "186 Reply Quality Guard"
pubDate: 2026-06-16
description: "Agent 聊天中的 Reply Quality Guard 实现方案。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-06-16
---
原文链接：[https://aicompanion.usehook.cn/51-agent-chat-reply-quality-guard/](https://aicompanion.usehook.cn/51-agent-chat-reply-quality-guard/)

## 概述

Agent 聊天中的 Reply Quality Guard 实现方案

在 AI 电子伴侣场景里，前面已经有了安全边界、意图判断、情绪路由和回复策略模板，但这些模块主要是在**回复生成之前**告诉模型应该怎么说。真正落地后，我们还会遇到另一个问题：模型最终生成出来的内容，是否真的遵守了这些策略？

Reply Quality Guard 解决的就是这个问题。它不是新的聊天能力，而是一个**回复后质检层**：模型回复生成完成之后，再检查这段回复是否过长、是否问太多问题、是否过早给建议、是否暴露内部标签，以及是否破坏电子伴侣的沉浸感。

## 完整链路

当前聊天链路可以理解为：

index.txt

```text
用户输入
  -> Safety Boundary
  -> Intent Detection
  -> Emotion Routing
  -> Reply Policy
  -> LLM 生成回复
  -> Reply Quality Guard
  -> assistant 消息落库
```

前面的 Reply Policy 负责制定**本轮应该怎么回**，Reply Quality Guard 则负责在回复完成后检查**本轮实际有没有这么回**。

## 暂不拦截

第一版没有做拦截、重写或二次生成，而是只把检测结果写入 assistant 消息的 `metadata_json`。

这样处理会更稳一些。它不会影响聊天主流程，用户仍然能稳定收到回复；也不会增加额外 LLM 调用成本，不影响流式输出速度。我们可以先收集真实数据，等问题类型和频率都看清楚以后，再决定哪些问题值得阻断或自动修复。出问题时，也可以回看每条 assistant 消息的质检记录，判断是策略没有约束住，还是模型最终输出偏离了策略。

第一版的目标不是**一次性把所有回复变完美**，而是先建立一条可观察、可追溯的质量闭环。

## 核心数据结构

API 中新增了 `ReplyQualityGuardSchema`，用于描述一次回复质检结果：

index.ts

```typescript
const ReplyQualityGuardSchema = z.object({
  status: z.enum(['pass', 'warn', 'fail']),
  score: z.number().min(0).max(1),
  sentenceCount: z.number().int().min(0),
  questionCount: z.number().int().min(0),
  adviceCount: z.number().int().min(0),
  violations: z.array(z.object({
    code: z.enum([
      'too_many_sentences',
      'too_many_questions',
      'too_many_suggestions',
      'internal_label_leak',
      'breaks_immersion',
      'forbidden_lecture',
      'forbidden_over_explain',
      'forbidden_premature_advice',
      'forbidden_intense_flirt',
      'forbidden_diagnosis',
      'forbidden_aggressive_siding',
      'forbidden_pressure',
      'forbidden_real_world_promise',
    ]),
    severity: z.enum(['low', 'medium', 'high']),
    evidence: z.string().trim().max(160),
  })).max(12),
})
```

这些字段各有分工。`status` 是本轮回复质检结果，`pass` 表示通过，`warn` 表示轻中度问题，`fail` 表示有明显高风险问题。`score` 是 0 到 1 的质量分，违规越多、严重程度越高，分数越低。`sentenceCount`、`questionCount`、`adviceCount` 分别记录回复句子数量、问号数量和建议型表达数量。`violations` 则保存具体命中的问题列表。

## 质检规则

当前 Reply Quality Guard 不是再调用一个模型做判断，而是根据 Reply Policy 和固定规则做轻量检测。

### 句子数量

Reply Policy 中有本轮回复的句子预算：

index.ts

```typescript
sentenceBudget: {
  min: number
  max: number
}
```

质检时会统计 assistant 回复的句子数，如果超过 `sentenceBudget.max`，就记录：

index.ts

```typescript
code: 'too_many_sentences'
```

这能避免电子伴侣在用户只需要轻轻陪伴时，突然输出一大段分析。

### 问题数量

Reply Policy 中也会限制本轮最多问几个问题：

index.ts

```typescript
questionLimit: number
```

如果回复里的 `？` 或 `?` 数量超过限制，就记录：

index.ts

```typescript
code: 'too_many_questions'
```

在陪伴聊天里，连续追问会让用户感到被审问，而不是被陪伴，所以这个规则很重要。

### 建议数量

系统会统计常见建议型表达，例如：

index.ts

```typescript
const advicePatterns = [
  /建议你/g,
  /你可以/g,
  /不妨/g,
  /最好/g,
  /应该/g,
  /试着/g,
  /尝试/g,
  /可以先/g,
]
```

如果超过 Reply Policy 中的 `adviceLimit`，就记录：

index.ts

```typescript
code: 'too_many_suggestions'
```

这主要服务于情绪陪伴场景。很多时候用户不是来要解决方案，而是希望先被理解。

### 内部标签泄露

如果回复里出现内部工程标签，例如：

- `intent`

- `emotion`

- `route`

- `policy`

- `safety`

- `replyPolicy`

- `意图判断`

- `情绪路由`

- `回复策略`

- `metadata`

就记录：

index.ts

```typescript
code: 'internal_label_leak'
```

电子伴侣不应该让用户感受到背后的工作流。用户看到的应该是自然对话，而不是系统分析报告。

### 沉浸感破坏

如果回复里出现类似**作为一个 AI**、**我只是 AI**、**我是语言模型**、**我没有真实情感**、**我没有身体**这类表达：

就记录：

index.ts

```typescript
code: 'breaks_immersion'
```

AI 电子伴侣不是通用问答助手，回复需要维持角色感和陪伴感。频繁自曝模型身份会直接破坏体验。

## 与 Reply Policy 的结合

Reply Policy 中有一个字段：

index.ts

```typescript
forbiddenMoves: string[]
```

它表示本轮回复禁止出现的动作。Reply Quality Guard 会根据这些 forbidden moves 做额外检查。

例如当前策略禁止 `lecture`，但回复里出现：

index.txt

```text
你要明白...
你必须...
正确的做法是...
```

就记录：

index.ts

```typescript
code: 'forbidden_lecture'
```

当前已经覆盖的 forbidden moves 包括 `lecture`、`over_explain`、`premature_advice`、`intense_flirt`、`diagnose_user`、`take_sides_aggressively`、`pressure_to_disclose` 和 `promise_real_world_action`。也就是禁止说教、过度解释、过早建议、强暧昧、诊断用户、激烈站队或拱火、逼迫用户继续透露，以及承诺现实行动。

这样质量检测就不是一套孤立规则，而是和本轮回复策略绑定在一起。同一句话在不同上下文里可能有不同含义，Guard 会尽量尊重前面策略模块给出的判断。

## 核心实现代码

质量检测入口是 `evaluateReplyQuality`：

index.ts

```typescript
function evaluateReplyQuality(params: {
  assistantText: string
  replyPolicy: ReplyPolicy | null
}): ReplyQualityGuard {
  const text = normalizeStoredMessage(params.assistantText)

  if (!text) {
    return fallbackReplyQualityGuard
  }

  const replyPolicy = params.replyPolicy ?? fallbackReplyPolicy
  const sentenceCount = countReplySentences(text)
  const questionCount = countPatternMatches(text, [/？/g, /\?/g])
  const adviceCount = countPatternMatches(text, advicePatterns)
  const violations: ReplyQualityGuard['violations'] = []

  if (sentenceCount > replyPolicy.sentenceBudget.max) {
    addReplyGuardViolation(violations, {
      code: 'too_many_sentences',
      severity: sentenceCount > replyPolicy.sentenceBudget.max + 2 ? 'high' : 'medium',
      evidence: `回复 ${sentenceCount} 句，超过策略上限 ${replyPolicy.sentenceBudget.max} 句。`,
    })
  }

  return ReplyQualityGuardSchema.parse({
    status,
    score,
    sentenceCount,
    questionCount,
    adviceCount,
    violations: violations.slice(0, 12),
  })
}
```

实际代码里还会继续检查问句数量、建议数量、内部标签泄露、沉浸感破坏，以及 forbidden moves。

## 如何计算分数

每条违规都有严重程度，分别是 `high`、`medium` 和 `low`。

分数计算逻辑是：

index.ts

```typescript
const score = Math.max(
  0,
  1 - highCount * 0.35 - mediumCount * 0.18 - lowCount * 0.08,
)
```

状态判断逻辑是：

index.ts

```typescript
const status =
  highCount > 0 || score < 0.5
    ? 'fail'
    : violations.length > 0
      ? 'warn'
      : 'pass'
```

也就是说，只要出现高严重度问题，本轮就直接标记为 `fail`。如果没有高严重度问题，但有轻中度问题，就标记为 `warn`。

## 落库位置

Reply Quality Guard 在 `saveAssistantTurn` 中执行，也就是 assistant 回复准备落库时：

index.ts

```typescript
const replyQualityGuard = evaluateReplyQuality({
  assistantText: message,
  replyPolicy: params.replyPolicy,
})

await insertAgentConversationMessage({
  db,
  id: assistantMessageId,
  conversationId: params.conversationId,
  userId: params.userId,
  agentId: params.agentId,
  role: 'assistant',
  content: message,
  status: 'completed',
  metadataJson: toAssistantReplyQualityMetadata({
    replyPolicy: params.replyPolicy,
    guard: replyQualityGuard,
  }),
  nowMs,
})
```

写入 metadata 的结构是：

index.ts

```typescript
function toAssistantReplyQualityMetadata(params: {
  replyPolicy: ReplyPolicy | null
  guard: ReplyQualityGuard
}) {
  return JSON.stringify({
    analysisVersion: 'reply-quality-guard-v1',
    replyPolicy: params.replyPolicy,
    guard: params.guard,
  })
}
```

这样每条 assistant 消息都可以追溯：当时使用了什么回复策略，最终回复命中了哪些问题，本轮回复质量是通过、警告还是失败。

## 为什么不需要 D1 迁移

本次实现没有新增表，也没有新增字段。

原因是聊天消息表原本已经有 `metadata_json` 字段，Reply Quality Guard 的结果直接写入该字段即可。

这类能力适合放在 metadata 中，因为它属于**消息生成时的分析结果**，不是主业务字段。后续如果需要做统计报表，我们再考虑单独拆出质量日志表。

## 后续升级

当前 v1 是记录型 Guard。后续可以继续往几个方向演进。

### 自动重写

如果 `status = fail`，可以触发一次轻量重写：

index.txt

```text
请在不改变含义的前提下，压缩回复，去掉内部标签，保持角色沉浸感。
```

这会增加一次模型调用，但能显著提高最终输出质量。

### 前端调试面板

在开发模式或 admin 后台中展示每条消息的 Guard 结果，方便观察：

- 哪些 Agent 最容易过度解释。

- 哪些模型容易暴露内部标签。

- 哪些回复策略太宽或太窄。

### 质量统计

可以按 Agent、模型、用户配置统计：

- `pass` 占比。

- `warn` 占比。

- `fail` 占比。

- 高频违规类型。

这些数据能反过来优化 prompt、策略模板和模型选择。

### LangChain Evaluator

如果后续希望判断更主观的问题，例如**是否足够温柔**、**是否真的理解用户情绪**，可以引入 LangChain 的 evaluator 或单独的 LLM-as-judge。

但第一版先不用模型评估，是为了让系统保持简单、稳定、低成本。

## 总结

Reply Quality Guard 给 Agent 聊天系统补上了最后一层质量闭环。

安全边界、意图判断、情绪路由和回复策略解决的是**生成前如何指导模型**；Reply Quality Guard 解决的是**生成后如何确认模型有没有遵守指导**。

第一版选择轻量规则检测，并把结果写入 assistant 消息 metadata。它不影响用户聊天体验，也不会增加额外模型成本，但已经能让系统具备可观测、可追溯、可持续优化的基础。
