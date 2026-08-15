---
title: "188 记忆候选判断实现"
pubDate: 2026-06-16
description: "长期记忆是 AI 电子伴侣体验里很关键的一环。用户会期待 Agent 记住自己的偏好、边界、关系目标和重要事实。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-06-16
---
原文链接：[https://aicompanion.usehook.cn/53-agent-chat-memory-candidate-judgement/](https://aicompanion.usehook.cn/53-agent-chat-memory-candidate-judgement/)

## 概述

Agent 聊天：记忆候选判断实现方案

长期记忆是 AI 电子伴侣体验里很关键的一环。用户会期待 Agent 记住自己的偏好、边界、关系目标和重要事实。

但长期记忆也有一个很现实的问题：不是每一句聊天都值得保存。

如果每轮对话都直接进入记忆抽取，系统很快就会变得不好维护。普通寒暄可能被保存下来，比如**哈哈**、**好**、**晚安**；一次性情绪也可能被长期化，比如**我今天有点烦**；重复事实会反复进入记忆库，让记忆变脏。除此之外，每次回复后都调用 LLM 抽取，也会让成本变高；如果敏感内容被错误长期化，用户隐私风险也会变大。

所以这次新增了**记忆候选判断**层。它位于长期记忆抽取之前，先判断这一轮是否值得进入抽取流程。

## 完整链路

原来的链路是：

index.txt

```text
assistant 回复完成
  -> 保存 assistant 消息
  -> 如果安全边界允许
  -> 直接调用长期记忆抽取器
  -> 写入 agent_memories
```

现在改成：

index.txt

```text
assistant 回复完成
  -> 保存 assistant 消息
  -> 如果安全边界允许
  -> 读取已有长期记忆
  -> 记忆候选判断
  -> 如果不值得保存，直接跳过
  -> 如果值得保存，调用长期记忆抽取器
  -> 去重
  -> 写入 agent_memories
```

这样长期记忆系统多了一层闸门。抽取器不再处理所有聊天，只处理**有长期价值的候选对话**。

## 候选判断的职责

记忆候选判断不负责抽取最终记忆。

它只回答一个问题：

index.txt

```text
这一轮对话值不值得进入长期记忆抽取？
```

它会判断这轮对话里是否有稳定信息，未来多轮对话是否仍然用得上；也会排除临时情绪、普通寒暄、已有记忆的重复表达，以及不应该保存的敏感内容。

只有判断通过，才进入后续抽取器。

## 候选判断 Schema

后端新增了 `AgentMemoryCandidateSchema`：

index.ts

```typescript
const AgentMemoryCandidateSchema = z.object({
  shouldExtract: z.boolean(),
  confidence: z.number().min(0).max(1),
  category: z.enum([
    'preference',
    'boundary',
    'relationship_goal',
    'conversation_style',
    'important_fact',
    'identity_profile',
    'temporary_emotion',
    'small_talk',
    'assistant_generated',
    'duplicate',
    'unsafe',
    'unclear',
  ]),
  stability: z.enum(['stable', 'likely_stable', 'temporary', 'unclear']),
  importance: z.number().int().min(0).max(5),
  reason: z.string().trim().max(300),
  candidateFacts: z.array(z.string().trim().min(1).max(120)).max(3),
})
```

这些字段各有分工。`shouldExtract` 表示是否进入长期记忆抽取，`confidence` 表示判断置信度，`category` 表示候选类型，`stability` 表示信息稳定性，`importance` 表示重要度，`reason` 保存判断原因，`candidateFacts` 则保存可能值得抽取的候选事实。

注意：这里的 `candidateFacts` 不是最终记忆，只是给下一步抽取器的参考。

## 适合进入候选

适合进入长期记忆候选的内容，通常是未来很多轮对话都会继续用到的信息。

- 用户偏好：喜欢什么、不喜欢什么。

- 用户边界：不要怎样称呼、不要怎样回复、哪些话题不舒服。

- 关系目标：希望 Agent 怎么陪伴，关系如何推进。

- 对话风格：希望轻松一点、少讲道理、不要连续追问。

- 重要事实：生日、城市、重要计划、家庭关系、长期目标。

- 稳定身份资料：职业、学习方向、长期兴趣。

## 不适合进入候选

不适合进入长期记忆候选的内容，通常是临时的、重复的，或者不应该被长期保存的。

- 普通寒暄：好、嗯、哈哈、晚安。

- 一次性情绪：今天有点烦、现在有点困。

- 临时状态：我刚吃完饭、我现在在路上。

- 纯感谢：谢谢、你真好。

- Agent 自己编造的信息。

- 已有记忆的重复表达。

- 敏感隐私或凭证：密码、验证码、身份证、银行卡、API Key。

长期记忆不是聊天记录备份，而是高价值用户画像和关系上下文。

## Fast Reject

为了降低成本，候选判断不是一上来就调用 LLM。

第一步是本地快速拒绝，也就是 `shouldSkipMemoryCandidateFast`。

它会处理几类明显不需要记忆的情况。

### 空内容

index.ts

```typescript
if (!userText || !assistantText) {
  return {
    shouldExtract: false,
    category: 'unclear',
    reason: '用户消息或 Agent 回复为空，不进入长期记忆候选。',
  }
}
```

没有完整的一轮用户消息和 Agent 回复时，不进入长期记忆。

### 短寒暄

index.ts

```typescript
if (userText.length < 6 && !/(记住|以后|喜欢|讨厌|不要|别再)/.test(userText)) {
  return {
    shouldExtract: false,
    category: 'small_talk',
    reason: '用户消息过短且没有明确记忆信号，判断为寒暄或临时互动。',
  }
}
```

短消息如果没有明显记忆信号，大概率只是即时互动。

### 常见确认语

index.ts

```typescript
if (/^(好|嗯|哦|啊|哈+|哈哈+|谢谢|谢啦|好的|可以|行|ok|OK|晚安|早安|拜拜|再见)[。！!~～\s]*$/.test(userText)) {
  return {
    shouldExtract: false,
    category: 'small_talk',
    reason: '本轮是普通寒暄、确认或结束语，不适合作为长期记忆。',
  }
}
```

这类内容即使出现很多次，也不应该污染长期记忆库。

### 完全重复

index.ts

```typescript
const normalizedUserText = normalizeMemoryContent(userText)

if (params.existingMemories.some((memory) => normalizeMemoryContent(memory.content) === normalizedUserText)) {
  return {
    shouldExtract: false,
    category: 'duplicate',
    reason: '用户消息与已有长期记忆完全重复，不需要再次抽取。',
  }
}
```

重复内容直接跳过，避免同一条记忆被保存多次。

### 敏感信息

index.ts

```typescript
if (/(密码|验证码|身份证|银行卡|住址|手机号|电话|token|api key|apikey|secret|密钥)/i.test(userText)) {
  return {
    shouldExtract: false,
    category: 'unsafe',
    reason: '本轮疑似包含敏感隐私或凭证信息，不进入长期记忆。',
  }
}
```

这些内容即使看起来重要，也不应该被长期保存。

## LangChain 候选判断

如果本地规则没有快速拒绝，就进入 LangChain 结构化判断。

Prompt 如下：

index.ts

```typescript
const agentMemoryCandidatePrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      '你是 AI 电子伴侣聊天产品的长期记忆候选判断器。',
      '你的任务不是抽取记忆，也不是回复用户，而是判断本轮对话是否值得进入长期记忆抽取流程。',
      '只有稳定、未来多轮对话仍然有用的信息才应该进入抽取：用户偏好、边界禁忌、关系目标、对 Agent 的互动风格要求、重要事实、稳定身份资料。',
      '以下内容通常不要进入抽取：普通寒暄、一次性情绪、临时状态、纯粹感谢、表情语气、Agent 自己编造的信息、已经存在的重复记忆、危险或不应保存的信息。',
      '如果用户明确要求“记住/以后/不要/别再/我喜欢/我不喜欢/我的习惯/我的边界”，通常应判断为候选。',
      '如果只是用户当下难过、生气、累，除非它表达了稳定偏好、重要事件或长期边界，否则不要进入长期记忆。',
      '输出必须是可被 LangChain 结构化解析的 JSON 对象。',
    ].join('\n'),
  ],
])
```

调用方式：

index.ts

```typescript
const structuredModel = model.withStructuredOutput(AgentMemoryCandidateSchema, {
  name: 'agent_memory_candidate_judgement',
  method: params.method,
})

const chain = agentMemoryCandidatePrompt.pipe(structuredModel)

const result = await chain.invoke({
  agentName: params.agentName || '未命名 Agent',
  existingMemories: formatExistingMemories(params.existingMemories),
  conversationSummary: params.conversationSummary || '暂无',
  userText: params.userText,
  assistantText: params.assistantText.slice(0, 3000),
})
```

这里传入了已有长期记忆，目的是让模型判断重复内容时更谨慎。

## 多 structured output method 兼容

项目里用户可以配置不同的 OpenAI 兼容接口，所以结构化输出不能只依赖一种方式。

当前复用了已有的 structured output 方法选择：

index.ts

```typescript
function getStructuredOutputMethods(providerConfig: ChatProviderConfig) {
  return providerConfig.wireApi === 'responses'
    ? ['jsonSchema', 'functionCalling', 'jsonMode'] as const
    : ['functionCalling', 'jsonSchema', 'jsonMode'] as const
}
```

候选判断会依次尝试：

index.ts

```typescript
for (const method of getStructuredOutputMethods(params.providerConfig)) {
  try {
    return await invokeLangChainMemoryCandidateJudgement({
      ...params,
      method,
      userText,
      assistantText,
    })
  } catch (error) {
    lastError = error
  }
}
```

如果全部失败，会使用本地关键词兜底。

## 兜底策略

当 LangChain 候选判断失败时，会调用 `buildFallbackMemoryCandidate`。

它根据关键词做保守判断：

index.ts

```typescript
const hasExplicitMemorySignal = /(记住|记一下|以后|下次|别再|不要再|我喜欢|我不喜欢|我讨厌|我习惯|我的习惯|我的边界|我的偏好|我希望你|你以后)/.test(text)
const hasBoundarySignal = /(不要|别|拒绝|不接受|底线|边界|禁忌|雷点|不舒服)/.test(text)
const hasPreferenceSignal = /(喜欢|不喜欢|偏好|习惯|更想|更希望|受不了|讨厌|想要你|希望你)/.test(text)
const hasImportantFactSignal = /(生日|工作|学校|家人|朋友|伴侣|前任|城市|搬家|生病|考试|面试|项目|目标|计划)/.test(text)
```

如果命中这些信号，才允许进入抽取。

这不是完美语义判断，但在模型不可用时，它比**全部抽取**更安全。

## 规范化候选结果

模型返回后还会经过 `normalizeMemoryCandidate`。

关键规则：

index.ts

```typescript
if (
  next.category === 'small_talk' ||
  next.category === 'temporary_emotion' ||
  next.category === 'assistant_generated' ||
  next.category === 'duplicate' ||
  next.category === 'unsafe'
) {
  next.shouldExtract = false
}
```

这些类别无论模型是否设置 `shouldExtract = true`，都会被强制跳过。

临时信息和低重要度内容也会被跳过：

index.ts

```typescript
if (next.stability === 'temporary' || next.importance <= 0) {
  next.shouldExtract = false
}
```

低置信度且重要度不高的内容也跳过：

index.ts

```typescript
if (next.confidence < 0.55 && next.importance < 4) {
  next.shouldExtract = false
}
```

这一步保证模型判断不会直接越过产品规则。

## 接入持久化流程

原来的 `persistAgentMemoriesFromTurn` 是直接抽取。

现在变成：

index.ts

```typescript
const existingMemories = await listActiveAgentMemories({
  db: params.db,
  userId: params.userId,
  agentId: params.agentId,
  limit: 50,
})

const memoryCandidate = await judgeAgentMemoryCandidateWithLangChain({
  providerConfig: params.providerConfig,
  agentName: params.agentName,
  existingMemories,
  conversationSummary: params.previousSummary,
  userText: params.userText,
  assistantText: params.assistantText,
  signal: params.signal,
})

if (!memoryCandidate.shouldExtract) {
  console.info('Agent memory extraction skipped by candidate judgement', {
    userId: params.userId,
    agentId: params.agentId,
    sourceMessageId: params.sourceMessageId,
    category: memoryCandidate.category,
    confidence: memoryCandidate.confidence,
    reason: memoryCandidate.reason,
  })
  return
}
```

只有通过候选判断，才继续调用抽取器：

index.ts

```typescript
const candidateMemories = await extractAgentMemoriesWithLangChain({
  providerConfig: params.providerConfig,
  agentName: params.agentName,
  existingMemories,
  memoryCandidate,
  conversationSummary: params.previousSummary,
  userText: params.userText,
  assistantText: params.assistantText,
  signal: params.signal,
})
```

## 候选判断如何帮助抽取器

候选判断结果不只是一个开关，也会传给抽取器：

index.ts

```typescript
function formatMemoryCandidateForPrompt(candidate: AgentMemoryCandidate) {
  return [
    `是否进入抽取：${candidate.shouldExtract ? '是' : '否'}`,
    `类别：${candidate.category}`,
    `置信度：${candidate.confidence.toFixed(2)}`,
    `稳定性：${candidate.stability}`,
    `重要度：${candidate.importance}`,
    `判断原因：${candidate.reason}`,
    candidate.candidateFacts.length > 0
      ? `候选事实：${candidate.candidateFacts.map((fact, index) => `${index + 1}. ${fact}`).join('；')}`
      : '候选事实：暂无',
  ].join('\n')
}
```

抽取器 Prompt 中新增：

index.txt

```text
本轮记忆候选判断：
{memoryCandidate}
```

这样抽取器不是从整轮对话里盲抽，而是围绕候选判断给出的方向做精抽。

## 为什么不新增 D1 表

本次没有新增表，也没有新增字段。

原因是记忆候选判断是**抽取前的运行时决策**，不是一个必须长期保存的业务实体。

真正需要长期保存的仍然是 `agent_memories` 表中的记忆结果。

如果后续要分析候选命中率、跳过原因、不同模型的候选质量，可以再新增审计表，例如：

index.txt

```text
agent_memory_candidate_logs
```

第一版先不加表，避免过早扩大数据模型。

## 与安全边界的关系

候选判断不是安全边界的替代品。

当前流程仍然是：

index.txt

```text
Safety Boundary
  -> allowMemoryExtraction
  -> Memory Candidate Judgement
  -> Memory Extraction
```

也就是说，如果安全边界已经判断本轮不允许记忆抽取，候选判断不会执行。

候选判断只负责在安全允许的前提下，进一步判断**是否值得长期保存**。

## 后续升级

### 候选日志

后续可以保存每次候选判断结果，用来观察哪些内容最常被跳过，哪些 Agent 容易产生脏记忆，以及哪些模型的候选判断质量更好。

### 用户确认

对于高敏感或高重要度候选，可以让用户确认：

index.txt

```text
我可以记住这一点吗？
```

不过这要谨慎设计，不能频繁打断聊天。

### 类型映射

当前候选类别和最终记忆类型还不是一一强绑定。

后续可以建立映射，例如：

- `preference` -> `偏好`

- `boundary` -> `边界`

- `relationship_goal` -> `关系目标`

- `conversation_style` -> `对话风格`

- `important_fact` / `identity_profile` -> `重要事实`

这样抽取器会更稳定。

### 参与排序

候选判断中的 `importance` 和 `confidence` 可以用于长期记忆排序，决定哪些记忆更应该优先注入 Prompt。

## 总结

记忆候选判断是长期记忆系统的第一道过滤层。

它不负责保存记忆，也不负责生成最终记忆内容，而是决定本轮对话是否值得进入抽取器。

第一版采用**本地 fast reject + LangChain 结构化判断 + 关键词兜底**的组合：简单内容快速跳过，有语义价值的内容交给模型判断，模型失败时仍有保守兜底。

这样可以降低成本、减少脏记忆、保护敏感信息，也让 AI 电子伴侣的长期记忆更像**真正重要的理解**，而不是聊天记录垃圾桶。
