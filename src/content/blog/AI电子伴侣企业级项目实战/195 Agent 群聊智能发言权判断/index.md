---
title: "195 Agent 群聊智能发言权判断"
pubDate: 2026-06-16
description: "这一篇我们继续整理 Agent 群聊发言权判断 的升级实现。此前群聊选择谁回复，主要依赖点名、关键词和 LLM 对 Agent 人设的基础理解；升级之后，系统会综合 Agent 性格、关系阶段、最近发。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-06-16
---
原文链接：[https://aicompanion.usehook.cn/60-agent-group-chat-smart-speaker-selection/](https://aicompanion.usehook.cn/60-agent-group-chat-smart-speaker-selection/)

## 目标与整体设计

Agent 群聊智能发言权判断实现复盘

这一篇我们继续整理 **Agent 群聊发言权判断** 的升级实现。此前群聊选择谁回复，主要依赖点名、关键词和 LLM 对 Agent 人设的基础理解；升级之后，系统会综合 Agent 性格、关系阶段、最近发言频率和用户情绪来判断谁更适合发言。

这一次的目标不是完全抛弃规则，而是让发言权判断从**谁被点名**，进一步升级为**谁在这个场景里最该接话**。

### 为什么要升级发言权判断

群聊里最容易出现两个问题。一个是某个 Agent 总是抢话，另一个是系统只会根据**你们**、**大家**、**怎么看**这类关键词决定多人回复。

但真实的 AI 电子伴侣群聊里，谁该说话应该取决于更多信息。

比如用户很难过时，应该优先让温柔、稳定、关系更熟的 Agent 回应；用户在纠结选择时，应该优先让理性、清晰、擅长分析的 Agent 回应；用户情绪激烈时，应该让边界感强、能降温的 Agent 回应。某个 Agent 最近已经连续说了很多次，就应该适当降权；如果用户明确点名某个 Agent，仍然优先尊重点名。

所以这一轮实现要表达的是：点名和关键词仍然有效，但不再是唯一依据。

### 整体设计

新的发言权判断会综合四类信号：Agent 人设、关系阶段、最近发言频率和用户情绪。Agent 人设来自简介、说明、性格、语气和默认提示词；关系阶段来自用户和某个 Agent 的一对一聊天深度；最近发言频率用来判断某个 Agent 最近是不是说太多；用户情绪则告诉系统，用户当前是需要安慰、建议、降温，还是轻松闲聊。

LangGraph 流程也从原来的：

index.ts

```typescript
classifyIntent -> selectAgents -> generateReplies -> generateCrossReplies -> checkQuality
```

升级为：

index.ts

```typescript
classifyIntent -> detectEmotion -> selectAgents -> generateReplies -> generateCrossReplies -> checkQuality
```

也就是说，在真正选择 Agent 前，先增加一个轻量情绪识别节点。

## 关系与发言上下文

为了判断关系阶段，群聊成员查询需要拿到用户和每个 Agent 的一对一会话统计。

在 `apps/api/src/auth/repository.ts` 中，`AgentGroupChatAgentRecord` 新增两个字段：

index.ts

```typescript
export type AgentGroupChatAgentRecord = {
  id: string
  name: string
  headline: string | null
  description: string | null
  storyBackground: string | null
  personalityPrompt: string | null
  tonePrompt: string | null
  guardrailsPrompt: string | null
  defaultPrompt: string | null
  imageKey: string | null
  displayOrder: number
  conversationMessageCount: number
  conversationLastMessageAtMs: number | null
}
```

查询群聊成员时，通过 `agent_conversations` 表拿到 message count：

index.ts

```typescript
conversationMessageCount: sql<number>`coalesce(${agentConversations.messageCount}, 0)`,
conversationLastMessageAtMs: agentConversations.lastMessageAtMs,
```

并通过 left join 关联：

index.ts

```typescript
.leftJoin(
  agentConversations,
  and(
    eq(agentConversations.userId, agentGroupChatMembers.userId),
    eq(agentConversations.agentId, agentGroupChatMembers.agentId),
  ),
)
```

这个改动没有新增数据库字段，也不需要 D1 迁移。关系阶段直接从已有一对一会话统计推导。

### 发言权上下文结构

在 `apps/api/src/routes/chat/group.route.ts` 中新增了发言权上下文：

index.ts

```typescript
type AgentSpeakingContext = {
  agentId: string
  conversationMessageCount: number
  recentReplyCount: number
  lastSpokeTurnsAgo: number | null
  relationshipStage: 'new_connection' | 'warming_up' | 'trusted' | 'close_bond'
  relationshipScore: number
  freshnessScore: number
}

type GroupSpeakingContext = {
  userEmotion: GroupChatUserEmotion
  agentContexts: AgentSpeakingContext[]
}
```

这些字段描述了一个 Agent 在当前群聊里的发言条件。`conversationMessageCount` 表示用户和该 Agent 的一对一消息数；`recentReplyCount` 表示该 Agent 在最近群聊里的发言次数；`lastSpokeTurnsAgo` 表示距离该 Agent 上次发言过了多少轮；`relationshipStage` 和 `relationshipScore` 描述关系阶段和熟悉度；`freshnessScore` 则表示发言新鲜度，最近说太多会降低。

### 关系阶段推导

当前关系阶段先用消息数量做启发式推导：

index.ts

```typescript
function getRelationshipStageFromMessageCount(messageCount: number): AgentSpeakingContext['relationshipStage'] {
  if (messageCount >= 80) {
    return 'close_bond'
  }

  if (messageCount >= 30) {
    return 'trusted'
  }

  if (messageCount >= 8) {
    return 'warming_up'
  }

  return 'new_connection'
}
```

对应关系分数：

index.ts

```typescript
function getRelationshipScore(stage: AgentSpeakingContext['relationshipStage']) {
  if (stage === 'close_bond') {
    return 0.95
  }

  if (stage === 'trusted') {
    return 0.78
  }

  if (stage === 'warming_up') {
    return 0.52
  }

  return 0.25
}
```

这还不是完整形态，但足够作为第一轮信号。后面可以接入更完整的关系阶段系统，而不是只看消息数。

### 最近发言频率

为了避免某个 Agent 连续抢话，系统会读取最近群聊消息中的 Agent 发言：

index.ts

```typescript
const recentAgentMessages = params.recentMessages
  .filter((message) => message.senderType === 'agent' && message.agentId)
  .slice(-18)
```

然后对每个 Agent 计算：

index.ts

```typescript
const messagesByAgent = recentAgentMessages.filter((message) => message.agentId === agent.id)
const lastMessage = messagesByAgent.at(-1)
const lastSpokeTurnsAgo = lastMessage ? Math.max(0, maxTurnIndex - lastMessage.turnIndex) : null
const freshnessBase = lastSpokeTurnsAgo === null ? 1 : Math.min(1, lastSpokeTurnsAgo / 6)
const freshnessPenalty = Math.min(0.75, messagesByAgent.length * 0.16)
const freshnessScore = Math.max(0, Number((freshnessBase - freshnessPenalty).toFixed(2)))
```

这段计算的思路很直接：很久没说话的 Agent，新鲜度更高；最近说过太多次的 Agent，新鲜度降低；如果刚刚说过，后面的 fallback 还会额外降权。

## 用户情绪识别

新增了结构化用户情绪：

index.ts

```typescript
const GroupChatUserEmotionSchema = z.object({
  primaryEmotion: z.enum([
    'neutral',
    'happy',
    'sad',
    'anxious',
    'angry',
    'lonely',
    'stressed',
    'confused',
    'romantic',
    'playful',
    'unknown',
  ]),
  intensity: z.number().min(0).max(1),
  needsComfort: z.boolean(),
  needsAdvice: z.boolean(),
  needsDeescalation: z.boolean(),
  socialEnergy: z.enum(['low', 'medium', 'high']),
  reason: z.string().trim().max(400),
})
```

情绪识别 prompt 是独立的：

index.ts

```typescript
const groupChatUserEmotionPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      '你是 AI 电子伴侣群聊的用户情绪识别器。',
      '只判断用户本轮消息体现出的主要情绪、强度和陪伴需求，不要生成聊天回复。',
      '需要区分用户是需要安慰、建议、降温，还是只是轻松闲聊。',
    ].join('\n'),
  ],
])
```

它只负责判断情绪，不负责选择 Agent，也不生成回复。

### 情绪识别 fallback

LLM 情绪识别失败时，会使用本地启发式：

index.ts

```typescript
function buildFallbackGroupUserEmotion(userText: string): GroupChatUserEmotion {
  const sad = /(难过|伤心|委屈|想哭|失落|崩溃|没人懂|孤独|孤单)/.test(text)
  const anxious = /(焦虑|紧张|慌|害怕|担心|压力|睡不着|不安)/.test(text)
  const angry = /(生气|愤怒|烦死|气死|吵架|不爽|火大)/.test(text)
  const romantic = /(喜欢|想你|暧昧|心动|恋爱|约会|亲密|撒娇)/.test(text)
  const playful = /(哈哈|笑死|好玩|逗|开玩笑|hh|lol)/i.test(lower)
  const happy = /(开心|高兴|快乐|惊喜|太好了|舒服了)/.test(text)
  const confused = /(怎么办|不知道|纠结|迷茫|怎么选|不懂|为什么)/.test(text)

  return GroupChatUserEmotionSchema.parse({
    primaryEmotion: ...,
    needsComfort: sad || anxious || angry || /陪陪|安慰|抱抱|难受/.test(text),
    needsAdvice: confused || /(建议|分析|复盘|怎么做|帮我想|选择)/.test(text),
    needsDeescalation: angry || /(冷静|别吵|缓一缓|降温)/.test(text),
  })
}
```

这样即使结构化 LLM 调用失败，系统仍然能根据情绪做基本发言权判断。

### 构建发言权上下文

关键函数是 `buildGroupSpeakingContext`：

index.ts

```typescript
function buildGroupSpeakingContext(params: {
  agents: AgentGroupChatAgentRecord[]
  recentMessages: AgentGroupChatMessageRecord[]
  userText: string
  userEmotion?: GroupChatUserEmotion | null
}): GroupSpeakingContext {
  ...

  return {
    userEmotion: params.userEmotion ?? buildFallbackGroupUserEmotion(params.userText),
    agentContexts,
  }
}
```

它会把用户情绪和每个 Agent 的发言权信号汇总成一个对象，后续同时给 LLM 选择器和 fallback 打分使用。

## 选择器升级

Agent 选择 prompt 从**根据人设和最近聊天选择**，升级为**根据意图、情绪、人设、关系阶段和发言频率选择**：

index.ts

```typescript
const groupChatAgentSelectionPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      '你是 AI 电子伴侣群聊的发言权调度器。',
      '请根据意图判断、用户情绪、Agent 人设、关系阶段和最近发言频率，选择最适合回复的 Agent。',
      `最多选择 ${groupReplyAgentLimit} 个 Agent。`,
      '不要为了热闹而选择过多 Agent。只有用户明确询问大家意见、要求分别回答、需要多视角或高情绪强度需要接力陪伴时，才选择多个。',
      '选择原则：',
      '- 情绪低落、孤独、焦虑时，优先选择性格稳定、温柔、善于共情且关系更熟的 Agent。',
      '- 用户需要分析、计划、建议时，优先选择理性、清晰、擅长复盘的 Agent。',
      '- 用户情绪激烈或冲突升级时，优先选择边界感强、克制、能降温的 Agent。',
      '- 用户轻松玩笑或高社交能量时，可以选择更活泼、有趣的 Agent。',
      '- 最近发言太频繁的 Agent 要适当降权，避免一个 Agent 连续抢话。',
      '- 长期关系更深的 Agent 可以优先承接高情绪强度内容，但不能无视人设匹配。',
      '输出 selectedAgentIds 时必须使用给定 Agent 的 id。',
    ].join('\n'),
  ],
])
```

同时在 user message 中加入：

index.ts

```typescript
'发言权上下文：',
'{speakingContext}',
```

格式化后的上下文会包含用户主情绪、情绪强度、是否需要安慰、是否需要建议、是否需要降温和社交能量，也会包含每个 Agent 的关系阶段、一对一消息数、最近发言次数、距离上次发言轮数和新鲜度。

### LangGraph 增加 detectEmotion 节点

新增节点：

index.ts

```typescript
async function detectGroupEmotionNode(state: typeof GroupChatOrchestrationState.State) {
  const userEmotion = await detectGroupUserEmotionWithLangGraph({
    providerConfig: state.providerConfig,
    groupChat: state.groupChat,
    recentMessages: state.recentMessages,
    userText: state.userText,
    signal: state.signal,
  })

  return {
    speakingContext: buildGroupSpeakingContext({
      agents: state.agents,
      recentMessages: state.recentMessages,
      userText: state.userText,
      userEmotion,
    }),
  }
}
```

图结构变成：

index.ts

```typescript
const groupChatOrchestrationGraph = new StateGraph(GroupChatOrchestrationState)
  .addNode('classifyIntent', classifyGroupIntentNode)
  .addNode('detectEmotion', detectGroupEmotionNode)
  .addNode('selectAgents', selectGroupAgentsNode)
  .addNode('generateReplies', generateGroupRepliesNode)
  .addNode('generateCrossReplies', generateCrossAgentRepliesNode)
  .addNode('checkQuality', checkGroupReplyQualityNode)
  .addEdge(START, 'classifyIntent')
  .addEdge('classifyIntent', 'detectEmotion')
  .addEdge('detectEmotion', 'selectAgents')
  .addEdge('selectAgents', 'generateReplies')
  .addEdge('generateReplies', 'generateCrossReplies')
  .addEdge('generateCrossReplies', 'checkQuality')
  .addEdge('checkQuality', END)
  .compile()
```

这让选择 Agent 之前，系统已经有了完整的用户情绪和发言权上下文。

## Fallback 与打分

旧 fallback 的逻辑很直接：点名谁，就谁回复；有**你们**、**大家**等关键词，就多个 Agent 回复；否则第一个 Agent 回复。

新 fallback 保留点名优先，但非点名场景改成打分排序：

index.ts

```typescript
return [...params.agents]
  .map((agent) => ({
    agent,
    score: scoreAgentForFallbackSelection({
      agent,
      userText: params.userText,
      userEmotion: speakingContext.userEmotion,
      context: contextByAgentId.get(agent.id),
    }),
  }))
  .sort((a, b) => b.score - a.score || a.agent.displayOrder - b.agent.displayOrder)
  .slice(0, limit)
  .map((item) => item.agent)
```

这样即使 LLM 选择失败，本地 fallback 仍然能考虑谁最近说太多、谁和用户更熟、谁的人设更适合当前情绪，以及当前是否需要多人回复。

### Fallback 打分逻辑

打分函数是 `scoreAgentForFallbackSelection`：

index.ts

```typescript
if (params.context) {
  score += params.context.relationshipScore * 1.6
  score += params.context.freshnessScore * 1.8
  score -= params.context.recentReplyCount * 0.45

  if (params.context.lastSpokeTurnsAgo === 0) {
    score -= 0.9
  }
}
```

然后根据用户情绪匹配 Agent 人设关键词：

index.ts

```typescript
if (params.userEmotion.needsComfort && /(温柔|陪伴|情绪|安慰|稳定|倾听|治愈|共情)/.test(profileText)) {
  score += 2.4
}

if (params.userEmotion.needsAdvice && /(理性|分析|建议|计划|复盘|清醒|判断|策略)/.test(profileText)) {
  score += 2.1
}

if (params.userEmotion.needsDeescalation && /(克制|边界|冷静|稳定|成熟|安全)/.test(profileText)) {
  score += 2.2
}
```

这不是要替代 LLM，而是在 LLM 不可用时提供一个比关键词更稳的底座。

## 追踪、前端与边界

每条 Agent 消息保存时，`metadata_json` 中会记录本轮编排信息：

index.ts

```typescript
metadataJson: JSON.stringify({
  source: 'group_chat_agent',
  selectedBy: 'langgraph_v1',
  model: providerConfig.model,
  wireApi: providerConfig.wireApi,
  replyKind: reply.replyKind ?? 'primary',
  respondToAgentId: reply.respondToAgentId ?? null,
  crossReplyReason: reply.crossReplyReason ?? null,
  crossReplyRound: reply.crossReplyRound ?? null,
  orchestration: {
    intent: orchestration.intent,
    selection: orchestration.selection,
    speakingContext: orchestration.speakingContext,
    crossReplyPlan: orchestration.crossReplyPlan,
    quality: orchestration.quality,
  },
})
```

有了这份 metadata，后面就可以排查当时识别到的用户情绪是什么、每个 Agent 的关系阶段和发言频率是什么、为什么选择了这些 Agent、是否触发了 Agent 间补充回应，以及回复质量检查结果如何。

### 为什么不改前端

这个能力完全发生在 API 编排层，前端仍然接收原来的：

index.ts

```typescript
agentMessages: AgentGroupChatMessage[]
```

因为发言权判断只是决定谁回复，不改变消息展示协议。前端无需知道选择逻辑，也不需要同步改 UI。

后续如果要做后台分析页，可以再从 `metadata_json` 中读取 `speakingContext` 展示。

### 当前边界

当前实现仍然有一些边界。关系阶段暂时从一对一消息数推导，还不是完整关系阶段模型；fallback 人设匹配使用关键词，不是 embedding 或分类器；发言频率只看最近一段群聊消息，不做长期统计；情绪识别是群聊局部轻量版，没有完整复用一对一聊天里的复杂链路；也还没有给用户提供**更安静 / 更热闹**的群聊偏好设置。

这些边界是有意保留的。这一版重点是把发言权判断从关键词推进到多信号决策，而不是一次性做成复杂调度系统。

### 后续优化

后面可以逐步升级。比如把一对一聊天里的关系阶段系统复用到群聊，给 Agent 增加结构化能力标签，例如情绪陪伴、理性分析、活跃破冰；也可以使用 embedding 或分类器匹配用户需求与 Agent 能力，增加用户级群聊偏好：安静、均衡、热闹。再往后，还可以记录长期发言统计，避免某些 Agent 在多轮中长期过度活跃，并在后台分析页展示每轮选择理由和打分结果。

## 总结

这一轮实现让群聊发言权判断从**关键词触发**升级成了**上下文调度**。

系统现在会先理解用户在说什么、情绪如何，再结合每个 Agent 的人设、关系阶段和最近发言频率来决定谁最适合回复。

这对 AI 电子伴侣群聊非常关键。好的群聊不是每个 Agent 都抢着说话，而是合适的人在合适的时候接住用户。
