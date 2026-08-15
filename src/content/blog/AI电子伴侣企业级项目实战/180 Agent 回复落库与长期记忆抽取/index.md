---
title: "180 Agent 回复落库与长期记忆抽取"
pubDate: 2026-06-09
description: "当前聊天接口仍然返回纯文本流，兼容前端 TextStreamChatTransport。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-06-09
---
原文链接：[https://aicompanion.usehook.cn/45-agent-memory-save-and-extract/](https://aicompanion.usehook.cn/45-agent-memory-save-and-extract/)

## 流式返回和 assistant 消息落库

当前聊天接口仍然返回纯文本流，兼容前端 `TextStreamChatTransport`。

上一篇讲到模型调用前的准备：用户消息先落库，后端读取最近历史和长期记忆，再组装 prompt。接下来要处理的是模型回复之后的事情。这里有一个比较容易忽略的点：前端需要尽快看到流式文本，但数据库里又需要保存完整 assistant 回复。也就是说，后端要同时照顾实时体验和持久化结果。

如果只追求实时体验，后端可以把上游模型返回的文本一段段转发给前端，流结束后就结束请求。但这样刷新页面以后 assistant 回复不会进入历史，记忆系统也无法从回复里更新摘要或抽取记忆。如果只追求落库，等完整回复生成完再一次性返回，用户又会失去流式输出的反馈。因此这里采用的是一边流式返回、一边累积完整文本，流结束后再统一落库。

对于 SSE 上游，后端会边解析边返回：

index.ts

```typescript
if (result.text) {
  hasContent = true
  assistantMessageText += result.text
  controller.enqueue(encoder.encode(result.text))
}
```

同时，后端会把完整 assistant 文本累积在 `assistantMessageText` 里。等上游流结束后，再统一写入消息表：

`assistantMessageText` 的作用就是把流式片段重新拼回完整回复。前端看到的是逐段返回的文本，数据库需要的是最终完整内容。这个变量正好连接了两边：每解析到一段文本，就先追加到 `assistantMessageText`，再通过 `controller.enqueue` 推给前端。

index.ts

```typescript
await saveAssistantTurn({
  c,
  userId: claims.sub,
  agentId,
  conversationId,
  sourceUserMessageId,
  userText: latestUserText,
  assistantText: assistantMessageText,
  previousSummary: ownedConversation?.conversation.summary ?? null,
  previousMessageCount: ownedConversation?.conversation.messageCount ?? 0,
  recentMessages: storedRecentMessages,
})
```

`saveAssistantTurn` 是这一轮回复结束后的收口。它会写入 assistant 消息，更新会话摘要和消息数，也会同步 Agent 列表里的最新回复，并为后面的长期记忆抽取准备数据。

这四件事放在同一个收口函数里，是为了让 assistant 一轮回复完成后的副作用集中管理。否则代码很容易散在不同位置：某处写消息，某处更新摘要，某处更新列表预览，某处再抽取记忆。分散以后，边缘路径就很难保证一致，比如 assistant 消息写进去了，但列表最新回复没更新；或者摘要更新了，消息数没更新。

我们可以直接看这段代码：

index.ts

```typescript
async function saveAssistantTurn(params: {
  c: Context<{ Bindings: ApiBindings }>
  userId: string
  agentId: string | undefined
  conversationId: string | undefined
  sourceUserMessageId: string | null
  userText: string
  assistantText: string
  previousSummary: string | null
  previousMessageCount: number
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
}) {
  const message = normalizeStoredMessage(params.assistantText)

  if (!params.agentId || !params.conversationId || !message) {
    await saveLatestAssistantMessage({
      c: params.c,
      userId: params.userId,
      agentId: params.agentId,
      text: params.assistantText,
    })
    return
  }

  const db = getDb(params.c.env.DB)
  const nowMs = Date.now()
  const assistantMessageId = crypto.randomUUID()

  await insertAgentConversationMessage({
    db,
    id: assistantMessageId,
    conversationId: params.conversationId,
    userId: params.userId,
    agentId: params.agentId,
    role: 'assistant',
    content: message,
    status: 'completed',
    nowMs,
  })

  const nextSummary = buildConversationSummary({
    previousSummary: params.previousSummary,
    recentMessages: params.recentMessages,
    userText: params.userText,
    assistantText: message,
  })

  await updateAgentConversationAfterMessage({
    db,
    userId: params.userId,
    agentId: params.agentId,
    conversationId: params.conversationId,
    summary: nextSummary,
    messageCount: params.previousMessageCount + (params.sourceUserMessageId ? 2 : 1),
    lastMessageAtMs: nowMs,
    nowMs,
  })

  await saveLatestAssistantMessage({
    c: params.c,
    userId: params.userId,
    agentId: params.agentId,
    text: message,
  })
}
```

注意这里的消息计数不是固定 `+2`。如果某些边缘路径没有写入用户消息，但写入了 assistant 消息，就只加 1。

这个细节来自上一篇的发送链路。正常情况下，一轮对话会写入用户消息和 assistant 消息，所以消息数应该增加 2。但如果缺少 `agentId`、`conversationId`，或者某些兼容路径没有提前保存用户消息，那么此处只能保存 assistant 回复。为了避免 `message_count` 和真实消息数量越来越偏，代码用 `sourceUserMessageId` 判断是否已经写入用户消息。

还有一个回退逻辑也要看一下：如果没有 `agentId`、没有 `conversationId`，或者 assistant 文本为空，函数不会继续写入会话消息，而是只尝试更新 Agent 列表里的最新回复。这是为了兼容旧链路或异常路径。记忆系统不应该让原本的聊天功能因为缺少会话上下文就完全中断，能保存多少就保存多少，主聊天体验优先保持可用。

assistant 消息写入以后，会话摘要也会立即更新。这里没有把摘要更新放到异步任务里，是因为下一次聊天很可能马上发生。如果本轮摘要没有及时写入，下一轮 prompt 组装时就无法读取最新摘要。第一版先让摘要更新跟随 assistant 落库同步完成，逻辑最直观。

## 会话摘要策略

当前 v1 的摘要不是再调用一次 LLM，而是用轻量规则做滚动摘要：

摘要的目的不是生成一篇漂亮的聊天总结，而是压缩更早上下文。随着对话越来越长，我们不能把所有历史消息都放进 prompt。最近消息负责现场感，摘要负责保留更早脉络。只要摘要能让模型知道此前大概聊过什么，它就完成了第一版的任务。

index.ts

```typescript
function buildConversationSummary(params: {
  previousSummary: string | null
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  userText: string
  assistantText: string
}) {
  const sourceLines = [
    params.previousSummary ? `既有摘要：${params.previousSummary}` : '',
    ...params.recentMessages.slice(-8).map((message) => `${message.role === 'user' ? '用户' : 'Agent'}：${message.content}`),
    `用户：${params.userText}`,
    `Agent：${params.assistantText}`,
  ].filter(Boolean)

  return sourceLines
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-1600)
}
```

这不是最智能的摘要方式，但很适合当前阶段。它不额外消耗模型 token，也不会拖慢聊天回复链路，同时已经足够承担 v1 的上下文压缩任务。

后续可以升级为「每隔 N 轮对话调用一次 LLM 做摘要」，但这应该在聊天主链路稳定之后再做。

这段摘要逻辑非常朴素：把既有摘要、最近几条消息、本轮用户输入和 assistant 回复拼起来，然后做空白压缩，最后截取后 1600 个字符。它没有理解语义，也不会提炼重点，但确定性很强。输入是什么，输出就是什么，不会因为模型摘要质量波动影响聊天流程。

为什么截取后 1600 个字符，而不是前 1600 个？因为越靠后的内容通常越接近当前对话。既有摘要放在前面，最近消息和本轮对话放在后面，取尾部能保留更近的上下文。这个策略不完美，但足够适合第一版。

当然，规则摘要也有边界。它可能保留太多无关内容，也可能把真正重要的信息挤掉。比如用户很早之前表达过一个重要边界，后面聊了很多普通内容，简单截断就可能把边界挤出摘要。长期记忆可以弥补一部分这个问题，因为稳定偏好和边界会进入 `agent_memories`，不完全依赖摘要保存。

后续升级 LLM 摘要时，也不建议每轮都调用模型做摘要。更合理的方式是每隔 N 轮、或者当消息数达到某个阈值时再总结一次。这样可以控制成本，也能避免聊天回复链路被额外模型调用拖慢。

## 长期记忆抽取

长期记忆抽取发生在 assistant 回复成功之后。失败不会影响聊天主流程。

长期记忆和会话摘要的定位不同。摘要关注的是这段 conversation 的整体脉络，长期记忆关注的是用户与某个 Agent 之间可以长期复用的信息。比如用户说「我不喜欢被催促」「以后回复尽量短一点」「我希望先维持朋友边界」，这些内容不只是本轮对话上下文，它们会影响后续很多次回答。

长期记忆抽取适合放在 assistant 回复成功之后。本轮对话已经完成，用户消息和 assistant 回复都已经有了，系统可以根据这一轮内容判断是否有值得保存的记忆。抽取失败不能影响聊天，因为记忆沉淀是附加能力，不应该让用户因为记忆写入失败而收不到回复。

当前实现是轻量规则抽取：

index.ts

```typescript
function extractCandidateMemories(params: {
  userText: string
  assistantText: string
}) {
  const normalizedUserText = normalizeStoredMessage(params.userText)
  const candidates: Array<{ type: string; content: string; importance: number }> = []

  if (!normalizedUserText) {
    return candidates
  }

  const shouldRemember = /我|不喜欢|喜欢|希望|想要|以后|记住|别|不要|需要|习惯|倾向/.test(normalizedUserText)

  if (!shouldRemember) {
    return candidates
  }

  candidates.push({
    type: classifyMemoryType(normalizedUserText),
    content: normalizedUserText.slice(0, 500),
    importance: /记住|不要|不喜欢|边界|以后/.test(normalizedUserText) ? 5 : 3,
  })

  return candidates
}
```

分类规则也很简单：

第一版抽取规则是关键词驱动。它先看用户消息里是否出现了「喜欢」「不喜欢」「希望」「记住」「不要」「习惯」这类表达，如果没有，就不抽取。这样可以避免把所有普通聊天都写成记忆。只有当用户明显表达偏好、目标、边界或习惯时，才生成候选记忆。

index.ts

```typescript
function classifyMemoryType(text: string) {
  if (/不喜欢|不要|避免|边界|压力|操控|套路/.test(text)) {
    return '边界'
  }

  if (/喜欢|偏好|更希望|倾向|习惯/.test(text)) {
    return '偏好'
  }

  if (/目标|想要|希望|正在/.test(text)) {
    return '关系目标'
  }

  return '对话风格'
}
```

写入前会做去重，避免完全相同的记忆重复保存：

分类规则也保持得很粗。它不是为了精准理解所有语义，而是为了把第一版记忆大致分到几个可展示、可管理的类型里。边界类记忆通常比普通偏好更重要，因为它涉及用户不想要什么、希望避免什么。关系目标和对话风格则更多影响 assistant 的回答方向。

`importance` 的默认判断也比较直接。带有「记住」「不要」「不喜欢」「边界」「以后」的内容通常更值得长期尊重，所以重要度给到 5；其他候选记忆给到 3。这个规则不是最终答案，但能让第一版 prompt 注入时有一个可排序依据。

index.ts

```typescript
const existingMemories = await listActiveAgentMemories({
  db,
  userId: params.userId,
  agentId: params.agentId,
  limit: 50,
})
const existingMemoryContents = new Set(existingMemories.map((memory) => memory.content))

for (const memory of candidateMemories.slice(0, 2)) {
  if (existingMemoryContents.has(memory.content)) {
    continue
  }

  await insertAgentMemory({
    db,
    id: crypto.randomUUID(),
    userId: params.userId,
    agentId: params.agentId,
    type: memory.type,
    content: memory.content,
    importance: memory.importance,
    sourceMessageId: params.sourceUserMessageId ?? assistantMessageId,
    nowMs: Date.now(),
  })
}
```

这套规则很适合第一版技术验证。真正产品化以后，可以替换为 LLM 结构化抽取：

index.txt

```txt
输入：最近一轮用户消息和 assistant 回复
输出：JSON 数组，每项包含 type/content/importance
```

这样可以更准确地识别稳定偏好、关系边界和重要事件。

去重也要提前考虑。用户可能多次表达相同意思，如果每次都写入一条一模一样的记忆，记忆库很快会变得嘈杂。当前只做完全相同内容的去重，比较保守，但实现简单。后续如果要做语义去重，可以引入 LLM 判断或 embedding 相似度。

另外，候选记忆只取前两条写入。这是为了控制单轮对话对记忆库的影响。一次聊天里可能出现很多关键词，但并不代表每一句都应该变成长期记忆。第一版宁可少记一点，也不要把记忆库写得过满。记忆系统真正有价值的地方，不是记住所有东西，而是记住那些稳定、重要、用户愿意被记住的信息。

到这里，assistant 回复后的处理就完整了。流式文本保证用户体验，assistant 落库保证历史可恢复，摘要更新保证更早上下文可压缩，长期记忆抽取则让偏好和边界可以跨轮次保留下来。后端把这些事情处理好以后，前端才能恢复历史、展示最新消息，并把记忆库页面真正接起来。

## 总结

这一篇讲的是模型回复之后的处理。后端一边把文本流式返回给前端，一边累积完整 assistant 文本；流结束后，再把 assistant 消息写入 D1，更新会话摘要、消息数和最新回复。长期记忆抽取也放在这个阶段完成，但它不能影响聊天回复本身。这样处理以后，实时体验和历史持久化就能同时兼顾。
