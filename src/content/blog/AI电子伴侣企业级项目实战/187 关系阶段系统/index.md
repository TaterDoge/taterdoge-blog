---
title: "187 关系阶段系统"
pubDate: 2026-06-16
description: "AI 电子伴侣和普通问答助手最大的区别之一，是它不是每一轮都从零开始聊天。用户会期待 Agent 逐渐熟悉自己、理解关系节奏，并且在不同阶段用不同方式回应。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-06-16
---
原文链接：[https://aicompanion.usehook.cn/52-agent-chat-relationship-stage-system/](https://aicompanion.usehook.cn/52-agent-chat-relationship-stage-system/)

## 概述

Agent 聊天：关系阶段系统实现方案

AI 电子伴侣和普通问答助手最大的区别之一，是它不是每一轮都从零开始聊天。用户会期待 Agent 逐渐熟悉自己、理解关系节奏，并且在不同阶段用不同方式回应。

如果没有关系阶段系统，Agent 很容易在两个方向上出问题：刚认识就过度亲密，显得油腻或不真实；已经聊了很多轮，却仍然像第一次见面一样生硬。

关系阶段系统要解决的，就是让 Agent 知道**我们现在是什么关系、适合用什么距离说话、能不能推进亲密度、是否应该先修复或放慢**。

## 设计目标

这次实现的关系阶段系统，不是简单给 Agent 写一个固定标签，比如**朋友**、**恋人**、**专属伴侣**。

它更像一个动态会话状态，会结合会话消息数量、会话摘要、最近聊天记录、长期记忆、安全边界判断、意图判断和情绪识别一起判断。

原因也很直接：关系阶段不是角色配置单方面决定的，而是用户和这个 Agent 在持续互动中慢慢形成的。

## 完整链路

当前聊天理解链路是用 LangGraph 编排的，关系阶段被放在情绪识别之后、情绪路由之前：

index.txt

```text
用户输入
  -> Safety Boundary
  -> Intent Detection
  -> Emotion Detection
  -> Relationship Stage
  -> Emotion Route
  -> Reply Policy
  -> LLM 生成回复
  -> Reply Quality Guard
  -> 消息落库
```

这样安排有一个好处：关系阶段可以使用意图和情绪作为输入，同时又能影响后续路由和回复策略。比如用户很暧昧，但历史消息很少，关系阶段会压低亲密度；用户很生气，关系阶段会切到修复期，后续回复策略优先修复体验；用户出现依赖风险时，关系阶段会切到依赖观察，后续回复会放慢节奏并加强边界。

## 关系阶段数据结构

后端新增了 `ConversationRelationshipStageSchema`：

index.ts

```typescript
const ConversationRelationshipStageSchema = z.object({
  stage: z.enum([
    'new_connection',
    'warming_up',
    'comfortable_chat',
    'trusted_companion',
    'close_bond',
    'repairing',
    'boundary_sensitive',
    'dependency_watch',
  ]),
  displayName: z.string().trim().min(1).max(80),
  closenessScore: z.number().int().min(0).max(100),
  trustLevel: z.enum(['low', 'medium', 'high']),
  stability: z.enum(['new', 'warming', 'stable', 'deepening', 'fragile', 'repairing']),
  boundaryMode: z.enum(['open', 'warm', 'careful', 'firm']),
  intimacyPermission: z.enum(['low', 'medium', 'high']),
  pacing: z.enum(['slow_down', 'hold', 'advance_gently', 'repair_first']),
  riskSignals: z.array(z.enum([
    'low_history',
    'dependency_risk',
    'boundary_testing',
    'conflict',
    'pulling_away',
    'sexual_boundary',
    'emotional_volatility',
  ])).max(5),
  relationshipGuidance: z.string().trim().max(700),
})
```

这些字段可以分成三组理解。第一组描述**当前阶段**，包括内部阶段枚举 `stage`、给系统和调试使用的中文阶段名 `displayName`、亲近度分数 `closenessScore`、信任等级 `trustLevel` 和关系稳定性 `stability`。

第二组描述**边界和节奏**，包括当前边界模式 `boundaryMode`、允许的亲密度 `intimacyPermission`，以及关系推进节奏 `pacing`。

第三组描述**风险和指导**，`riskSignals` 保存风险信号，`relationshipGuidance` 给后续回复策略提供指导文本。

## 阶段含义

当前第一版支持 8 个阶段。

### new_connection

初识破冰。

适合刚开始聊天、历史记录很少的关系。即使用户语气比较亲密，也不能马上进入高亲密表达。

### warming_up

升温熟悉。

双方已经有一些互动，可以多一点主动和温度，但每次只轻轻推进一步。

### comfortable_chat

舒适陪伴。

关系进入比较自然的聊天状态，可以承接情绪、延续日常，也可以适度表达熟悉感。

### trusted_companion

稳定信任。

用户和 Agent 已经有稳定互动，Agent 可以体现更多理解和默契，但不能替用户做决定。

### close_bond

亲密连结。

关系已经较深，可以更自然地表达亲近感，但仍然不能做现实承诺，也不能强化依赖。

### repairing

修复期。

用户表达不满、受伤、失望，或意图判断为对 Agent 的反馈、误会修复时进入。这个阶段优先修复体验，不推进暧昧。

### boundary_sensitive

边界敏感。

出现边界测试、性边界、安全边界提示或需要谨慎处理的互动时进入。这个阶段要放慢节奏，降低亲密度。

### dependency_watch

依赖观察。

当安全边界或意图判断识别到情绪依赖风险时进入。这个阶段要陪伴，但不能强化**只有我懂你**、**你只能依赖我**这类关系暗示。

## LangChain 判断器

关系阶段使用 LangChain 的结构化输出能力实现。

Prompt 中明确要求模型不要回复用户，而是判断关系阶段：

index.ts

```typescript
const conversationRelationshipStagePrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      '你是 AI 电子伴侣聊天产品的关系阶段判断器。',
      '你的任务不是回复用户，而是判断用户和当前 Agent 的动态关系阶段、亲密边界和推进节奏。',
      '必须结合消息数量、会话摘要、最近对话、长期记忆、安全边界、意图判断和情绪识别。',
      '关系阶段不是单纯看用户是否暧昧；也要考虑双方历史是否足够、用户是否信任、是否有冲突、是否存在依赖或边界风险。',
      '如果历史较少，即使用户语气亲密，也不要直接判断为深度亲密；优先给出慢一点、稳一点的推进策略。',
      '如果出现误会、失望、拉黑、冷淡、边界测试或依赖风险，要优先标记 repairing、boundary_sensitive 或 dependency_watch。',
      '输出必须是可被 LangChain 结构化解析的 JSON 对象。',
    ].join('\n'),
  ],
])
```

调用时传入完整上下文：

index.ts

```typescript
const result = await chain.invoke({
  agentName: params.agentName || '未命名 Agent',
  agentGuardrails: params.agentGuardrails || '暂无',
  messageCount: String(params.messageCount),
  conversationSummary: params.conversationSummary || '暂无',
  safety: formatSafetyForPrompt(params.safety),
  intent: formatIntentForPrompt(params.intent),
  emotion: formatEmotionForPrompt(params.emotion),
  activeMemories: formatExistingMemories(params.activeMemories),
  recentMessages: formatRecentMessages(params.recentMessages),
  userText: params.userText,
})
```

这让模型判断阶段时，不会只看当前一句话。

## 启发式兜底

因为用户可以配置自己的第三方 LLM，结构化输出不一定永远稳定，所以实现里加了启发式兜底。

兜底逻辑会根据消息数量、长期记忆重要度和当前亲近信号计算一个 `closenessScore`：

index.ts

```typescript
const memoryScore = Math.min(
  20,
  params.activeMemories.reduce((total, memory) => total + memory.importance, 0),
)
const historyScore = Math.min(70, Math.floor(params.messageCount * 1.6))
const warmthScore =
  params.intent?.relationshipSignal === 'seeking_closeness' ||
  params.emotion?.primaryEmotion === 'affectionate'
    ? 10
    : params.intent?.relationshipSignal === 'warming_up' ||
        params.emotion?.primaryEmotion === 'playful'
      ? 6
      : 0
```

然后根据消息数量和亲近度进入不同阶段：

index.ts

```typescript
if (params.messageCount >= 80 && closenessScore >= 75) {
  stage = 'close_bond'
} else if (params.messageCount >= 36 && closenessScore >= 58) {
  stage = 'trusted_companion'
} else if (params.messageCount >= 16 && closenessScore >= 38) {
  stage = 'comfortable_chat'
} else if (params.messageCount >= 6) {
  stage = 'warming_up'
} else {
  stage = 'new_connection'
}
```

这个兜底不是为了替代 LLM 判断，而是保证当结构化输出失败时，系统仍然有可用的关系节奏。

## 规范化规则

模型判断后，还会经过 `normalizeRelationshipStage` 做二次修正。

例如历史消息太少时，即使模型判断为亲密阶段，也会被拉回初识阶段：

index.ts

```typescript
if (params.messageCount < 6 && !['boundary_sensitive', 'dependency_watch', 'repairing'].includes(stage.stage)) {
  stage.stage = 'new_connection'
  stage.displayName = '初识破冰'
  stage.closenessScore = Math.min(stage.closenessScore, 35)
  stage.trustLevel = 'low'
  stage.stability = 'new'
  stage.intimacyPermission = 'low'
  stage.pacing = 'hold'
}
```

如果识别到依赖风险，会切到依赖观察：

index.ts

```typescript
if (params.safety.category === 'emotional_dependency' || params.intent?.relationshipSignal === 'dependency_risk') {
  stage.stage = 'dependency_watch'
  stage.displayName = '依赖观察'
  stage.boundaryMode = 'careful'
  stage.intimacyPermission = 'low'
  stage.pacing = 'slow_down'
}
```

如果识别到冲突或受伤，会切到修复期：

index.ts

```typescript
if (
  params.intent?.primary === 'conversation_repair' ||
  params.intent?.relationshipSignal === 'conflict' ||
  params.intent?.relationshipSignal === 'feeling_hurt' ||
  params.emotion?.primaryEmotion === 'hurt' ||
  params.emotion?.primaryEmotion === 'disappointed'
) {
  stage.stage = 'repairing'
  stage.displayName = '修复期'
  stage.pacing = 'repair_first'
}
```

这一步很关键。模型可以做判断，但产品规则必须兜底，尤其是边界和依赖风险。

## 接入 LangGraph

LangGraph 的状态里新增了关系阶段字段：

index.ts

```typescript
const ConversationUnderstandingState = Annotation.Root({
  providerConfig: Annotation<ChatProviderConfig>(),
  agentName: Annotation<string>(),
  agentGuardrails: Annotation<string | null>(),
  safety: Annotation<ConversationSafety>(),
  activeMemories: Annotation<StoredAgentMemory[]>(),
  recentMessages: Annotation<Array<{ role: 'user' | 'assistant'; content: string }>>(),
  conversationSummary: Annotation<string | null>(),
  messageCount: Annotation<number>(),
  userText: Annotation<string>(),
  normalizedInput: Annotation<string>(),
  intent: Annotation<ConversationIntent | null>(),
  emotion: Annotation<ConversationEmotion | null>(),
  relationshipStage: Annotation<ConversationRelationshipStage | null>(),
  route: Annotation<EmotionRoute | null>(),
  replyPolicy: Annotation<ReplyPolicy | null>(),
  signal: Annotation<AbortSignal | undefined>(),
})
```

然后新增节点：

index.ts

```typescript
async function analyzeRelationshipStageNode(state: typeof ConversationUnderstandingState.State) {
  const userText = state.normalizedInput || normalizeStoredMessage(state.userText)

  return {
    relationshipStage: await analyzeRelationshipStageWithLangChain({
      providerConfig: state.providerConfig,
      agentName: state.agentName,
      agentGuardrails: state.agentGuardrails,
      safety: state.safety,
      intent: state.intent,
      emotion: state.emotion,
      activeMemories: state.activeMemories,
      recentMessages: state.recentMessages,
      conversationSummary: state.conversationSummary,
      messageCount: state.messageCount,
      userText,
      signal: state.signal,
    }),
  }
}
```

图的顺序变成：

index.ts

```typescript
const conversationUnderstandingGraph = new StateGraph(ConversationUnderstandingState)
  .addNode('normalizeInput', normalizeUnderstandingInputNode)
  .addNode('classifyIntent', classifyIntentNode)
  .addNode('detectEmotion', detectEmotionNode)
  .addNode('analyzeRelationshipStage', analyzeRelationshipStageNode)
  .addNode('routeEmotion', routeEmotionNode)
  .addNode('buildReplyPolicy', buildReplyPolicyNode)
  .addEdge(START, 'normalizeInput')
  .addEdge('normalizeInput', 'classifyIntent')
  .addEdge('classifyIntent', 'detectEmotion')
  .addEdge('detectEmotion', 'analyzeRelationshipStage')
  .addEdge('analyzeRelationshipStage', 'routeEmotion')
  .addEdge('routeEmotion', 'buildReplyPolicy')
  .addEdge('buildReplyPolicy', END)
  .compile()
```

## 影响情绪路由

关系阶段会直接影响 Emotion Route。

例如修复期会强制切到关系修复路线：

index.ts

```typescript
if (relationshipStage.stage === 'repairing' || relationshipStage.pacing === 'repair_first') {
  route = 'relationship_repair'
  responseLength = 'short'
  shouldAskQuestion = true
  shouldGiveAdvice = false
  shouldMirrorEmotion = true
}
```

边界敏感和依赖观察会强制进入降温路线：

index.ts

```typescript
if (
  relationshipStage.stage === 'boundary_sensitive' ||
  relationshipStage.stage === 'dependency_watch' ||
  relationshipStage.boundaryMode === 'firm'
) {
  route = 'calm_deescalation'
  responseLength = 'short'
  shouldAskQuestion = false
  shouldGiveAdvice = false
  shouldUsePetName = false
}
```

如果用户想暧昧，但当前还是初识阶段，也会降低路线强度：

index.ts

```typescript
if (
  route === 'playful_flirt' &&
  (relationshipStage.stage === 'new_connection' || relationshipStage.intimacyPermission === 'low')
) {
  route = 'light_companion'
  responseLength = 'short'
  shouldUsePetName = false
}
```

这就是关系阶段的价值：它不是替代情绪路由，而是给情绪路由加上关系节奏。

## 影响回复策略

关系阶段还会影响 Reply Policy。

例如低亲密度时禁止强暧昧：

index.ts

```typescript
if (relationshipStage.intimacyPermission === 'low') {
  intimacyLevel = 'low'
  forbiddenMoves.push('intense_flirt')
}
```

如果需要放慢节奏，会压缩回复长度、减少追问和建议：

index.ts

```typescript
if (relationshipStage.pacing === 'slow_down') {
  rhythm = 'soft'
  forbiddenMoves.push('premature_advice', 'pressure_to_disclose', 'intense_flirt')
  questionLimit = Math.min(questionLimit, 1)
  adviceLimit = Math.min(adviceLimit, 1)
  sentenceBudget.max = Math.min(sentenceBudget.max, 3)
}
```

如果处于修复期，则优先修复关系体验：

index.ts

```typescript
if (relationshipStage.pacing === 'repair_first') {
  policy = 'relationship_repair'
  rhythm = 'soft'
  openingMove = 'apologize'
  forbiddenMoves.push('intense_flirt', 'take_sides_aggressively', 'over_explain')
  adviceLimit = 0
  sentenceBudget.max = Math.min(sentenceBudget.max, 3)
}
```

## 注入最终 Prompt

关系阶段也会被注入最终系统提示词：

index.ts

```typescript
function getRelationshipStageSystemInstruction(relationshipStage: ConversationRelationshipStage | null) {
  if (!relationshipStage) {
    return ''
  }

  return [
    '本轮关系阶段判断：',
    `- 阶段：${relationshipStage.displayName}（${relationshipStage.stage}）`,
    `- 亲近度：${relationshipStage.closenessScore}/100`,
    `- 信任等级：${relationshipStage.trustLevel}`,
    `- 稳定性：${relationshipStage.stability}`,
    `- 边界模式：${relationshipStage.boundaryMode}`,
    `- 允许亲密度：${relationshipStage.intimacyPermission}`,
    `- 推进节奏：${relationshipStage.pacing}`,
    relationshipStage.riskSignals.length > 0 ? `- 风险信号：${relationshipStage.riskSignals.join('、')}` : '',
    `- 关系指导：${relationshipStage.relationshipGuidance}`,
    '请把关系阶段作为隐性节奏控制：不要在回复中暴露阶段名称、分数或内部标签。',
  ].filter(Boolean).join('\n')
}
```

注意最后一句很重要：关系阶段是内部策略，不应该被用户直接看到。

## 写入消息 metadata

用户消息落库时，metadata 中会保存本轮完整理解结果：

index.ts

```typescript
function toConversationAnalysisMetadata(params: {
  safety: ConversationSafety
  intent: ConversationIntent | null
  emotion: ConversationEmotion | null
  relationshipStage: ConversationRelationshipStage | null
  route: EmotionRoute | null
  replyPolicy: ReplyPolicy | null
}) {
  return JSON.stringify({
    analysisVersion: 'conversation-understanding-v2',
    safety: params.safety,
    intent: params.intent,
    emotion: params.emotion,
    relationshipStage: params.relationshipStage,
    route: params.route,
    replyPolicy: params.replyPolicy,
  })
}
```

这样以后可以回看每一轮：

- 当时处于什么关系阶段。

- 为什么走了某条情绪路由。

- 回复策略为什么限制亲密度、建议数量或追问数量。

## 首页 Inbox 展示

除了聊天链路，首页 Inbox 也做了轻量展示调整。

列表中原本所有已发布 Agent 都显示**专属伴侣**，现在会根据 `agent_conversations.message_count` 显示阶段：

index.ts

```typescript
function getInboxRelationshipStage(messageCount: number) {
  if (messageCount >= 80) {
    return { relationship: '亲密连结' }
  }

  if (messageCount >= 36) {
    return { relationship: '稳定信任' }
  }

  if (messageCount >= 16) {
    return { relationship: '舒适陪伴' }
  }

  if (messageCount >= 6) {
    return { relationship: '升温熟悉' }
  }

  return { relationship: '初识破冰' }
}
```

这里的展示逻辑是轻量版，只基于消息量。真正影响回复的关系阶段，仍然以后端聊天链路中的 LangGraph 判断为准。

## 为什么不做 D1 迁移

本次没有新增表，也没有新增字段。

原因是第一版关系阶段是**每轮动态分析结果**，它会写入消息 `metadata_json` 中，而不是作为单独业务状态保存。

这样可以避免过早把阶段固化到数据库里。关系阶段本来就会随着最近对话、情绪和边界变化而变化。如果未来要做长期稳定的关系成长系统，再考虑新增独立表，例如：

index.txt

```text
agent_relationship_states
```

里面可以保存长期亲密度、阶段变更历史、阶段进入时间、阶段升级/降级原因等。

## 后续升级

第一版已经能影响回复，但还可以继续增强。

### 阶段历史

后续可以记录每次阶段变化，比如从初识到升温，从稳定信任降到修复期，或者从依赖观察恢复到舒适陪伴。

这可以用于分析 Agent 关系体验是否健康。

### 阶段可视化

前端可以在 Agent 详情页展示当前关系阶段、亲近度、信任等级和最近阶段变化。

但不建议把太多内部指标直接展示给普通用户，否则会让陪伴感变成游戏数值感。

### 主动消息

当关系进入稳定信任或亲密连结后，可以允许 Agent 在合适时机生成更自然的主动问候。

但这必须和安全边界、频率控制、用户设置一起做，不能变成打扰。

### 成长事件

可以设计一些非模板化的成长事件，例如：

- 第一次记住用户的重要偏好。

- 第一次完成一次情绪修复。

- 第一次共同完成一个长期目标。

这些事件可以推动关系阶段变化，而不是只靠消息数量。

## 总结

关系阶段系统让 AI 电子伴侣从**单轮回复工具**更接近**持续互动对象**。

它不会直接决定一句话怎么说，而是给后续情绪路由和回复策略提供关系节奏：什么时候要慢一点，什么时候可以自然靠近，什么时候要先修复，什么时候必须守住边界。

第一版使用 LangChain 结构化输出和 LangGraph 编排完成动态判断，并通过启发式兜底保证稳定性。它不新增 D1 迁移，而是把每轮阶段结果写入消息 metadata，先建立可追踪的关系理解闭环。
