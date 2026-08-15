---
title: "179 Agent 聊天发送与 Prompt 组装"
pubDate: 2026-06-09
description: "在没有记忆系统之前，聊天发送链路比较直接：前端把当前 UI 里的 messages 发给后端，后端把这些消息转成模型输入，然后把模型输出流式返回给前端。这个流程能跑起来，但它有一个明显限制：上下文主要。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-06-09
---
原文链接：[https://aicompanion.usehook.cn/44-agent-memory-chat-prompt/](https://aicompanion.usehook.cn/44-agent-memory-chat-prompt/)

## 聊天发送流程

发送聊天消息时，流程比之前多了几步。

在没有记忆系统之前，聊天发送链路比较直接：前端把当前 UI 里的 `messages` 发给后端，后端把这些消息转成模型输入，然后把模型输出流式返回给前端。这个流程能跑起来，但它有一个明显限制：上下文主要来自前端当前状态。

接入记忆系统以后，发送链路要发生变化。后端不能只相信前端传来的消息列表，而是要把服务端已经保存的历史消息、会话摘要和长期记忆一起纳入考虑。也就是说，前端仍然负责提交本轮用户输入和必要的会话信息，但真正参与 prompt 组装的上下文，应该以服务端持久化数据为准。

这样处理以后，聊天状态会稳定很多。用户刷新页面以后，前端 `messages` 会重新初始化；用户切换 Agent 后，前端状态也会变化；甚至用户打开多个标签页时，不同页面里的 UI 状态都可能不一致。服务端 D1 里的历史消息才是统一来源。发送时回到 D1 读取上下文，能让聊天行为不依赖某一次页面状态。

index.txt

```txt
用户发送消息
        ↓
API 校验 token
        ↓
找到用户拥有的 Agent
        ↓
获取默认 conversation
        ↓
写入用户消息
        ↓
读取最近历史消息
        ↓
读取长期记忆
        ↓
组装 LLM prompt
        ↓
调用上游 LLM
        ↓
流式返回给前端
        ↓
流结束后写入 assistant 消息
        ↓
更新 summary、message_count、last_message_at_ms
        ↓
抽取长期记忆
```

这张流程图里，本文先讲到 prompt 组装为止。流式返回、assistant 消息落库、摘要更新和长期记忆抽取属于模型回复后的处理，放在下一段链路里看会更清楚。

## 先写入用户消息

用户消息会在调用 LLM 前先写入 D1：

我们需要先讨论写入顺序。直觉上，我们可能会等 LLM 成功返回以后，再把用户消息和 assistant 回复一起保存。这样写起来似乎更整齐，但会带来一个体验问题：如果上游 LLM 调用失败，用户刚刚输入的内容也会丢掉。用户明明已经发送了一条消息，刷新后却看不到它，这会让聊天历史不可信。

因此这里选择先保存用户消息。只要用户请求已经通过鉴权，并且能确认当前 Agent 和 conversation，就先把这条用户消息写入 `agent_conversation_messages`。后续 LLM 成功时，再补 assistant 消息；如果 LLM 失败，用户消息仍然留在历史里，页面列表也可以显示用户刚刚发出的内容。

index.ts

```typescript
if (agentId && conversationId && latestUserText) {
  sourceUserMessageId = crypto.randomUUID()
  const userMessageNowMs = Date.now()

  await insertAgentConversationMessage({
    db,
    id: sourceUserMessageId,
    conversationId,
    userId: claims.sub,
    agentId,
    role: 'user',
    content: latestUserText,
    status: 'completed',
    nowMs: userMessageNowMs,
  })

  await updateAgentConversationAfterMessage({
    db,
    userId: claims.sub,
    agentId,
    conversationId,
    summary: ownedConversation?.conversation.summary ?? null,
    messageCount: (ownedConversation?.conversation.messageCount ?? 0) + 1,
    lastMessageAtMs: userMessageNowMs,
    nowMs: userMessageNowMs,
  })
}
```

如果上游 LLM 调用失败，用户刚刚发出的消息也不会丢。它仍然会成为历史消息的一部分。

这里还同步更新了 conversation 的 `messageCount` 和 `lastMessageAtMs`。这一步不是为了 prompt，而是为了会话状态。用户消息一旦写入，会话就已经发生变化。即使 assistant 还没有返回，首页列表也应该知道这个 Agent 刚刚有新互动。`lastMessageAtMs` 会影响排序，`messageCount` 会影响后续会话统计和摘要判断。

`sourceUserMessageId` 也在这里保存下来。它后面会用于长期记忆的来源关联。比如从本轮用户消息里抽取出一条偏好，就可以把记忆的 `sourceMessageId` 指向这条用户消息。这样记忆库页面以后就能追溯：这条记忆是从哪条对话里来的。

当然，并不是所有边缘路径都一定能写入用户消息。比如缺少 `agentId` 或 `conversationId` 时，代码会走兼容逻辑。正因为存在这些边缘情况，后面更新消息数时才不能简单固定 `+2`，而要根据是否真的写入过用户消息来决定。

## 读取历史和长期记忆

调用 LLM 之前，后端会读取两类上下文。

用户消息落库以后，就要准备模型输入。这里不直接使用前端传来的全部 `messages`，而是从服务端读取最近历史和长期记忆。前端传来的消息仍然有价值，它能提供当前 UI 的最新输入，也能作为 contracts 的必要字段；但服务端上下文应该由服务端自己确认。

最近聊天消息解决的是当前对话连贯性。用户前几轮说了什么，assistant 刚刚怎么回答，当前问题接着哪句话而来，这些都需要最近消息来支撑。没有最近消息，模型很容易把本轮输入当成孤立问题来回答。

最近聊天消息：

index.ts

```typescript
const storedRecentMessages = agentId && conversationId
  ? await listAgentConversationMessages({
      db,
      userId: claims.sub,
      agentId,
      conversationId,
      limit: recentMessageLimit,
    })
  : []
```

长期记忆：

长期记忆解决的是跨会话稳定偏好。它不一定在最近几条消息里出现，但会影响回答方式。比如用户曾经表达过不喜欢过度分析，或者希望回复更自然直接，这类记忆就应该在每次聊天时被优先尊重。

index.ts

```typescript
const activeMemories = agentId
  ? await listActiveAgentMemories({
      db,
      userId: claims.sub,
      agentId,
      limit: memoryInjectionLimit,
    })
  : []
```

长期记忆按重要度和更新时间排序：

index.ts

```typescript
.orderBy(sql`${agentMemories.importance} desc, ${agentMemories.updatedAtMs} desc`)
```

这样排序以后，重要记忆会优先进入 prompt。

这里按 `importance desc` 和 `updatedAtMs desc` 排序，是第一版没有向量检索时的简单策略。重要度高的记忆优先进入 prompt；重要度相同，则更新更近的记忆优先。这个方案不一定永远最准确，但在记忆数量不多时非常直接，也容易解释给用户。

我们还要注意一个边界：长期记忆不是越多越好。每条记忆都会占用 prompt 空间，如果无节制地注入，反而会挤掉最近消息和用户本轮输入。第一版用 `memoryInjectionLimit` 控制数量，就是为了让长期记忆参与回答，但不主导整个上下文。

## 组装 prompt

系统 prompt 里会注入 Agent 默认人设、长期记忆和会话摘要：

prompt 组装决定模型最终能看到什么，也决定 Agent 的回答风格是否稳定。这里采用的顺序是先系统级约束，再聊天对象资料，再历史消息，最后是本轮用户输入。

系统 prompt 的第一层是 Agent 默认人设。它描述这个 Agent 应该如何回答、应该保持什么语气、应该避免哪些风险。长期记忆和会话摘要也放在系统消息里，是为了让模型把它们当作更高优先级的背景信息，而不是普通用户输入。

index.ts

```typescript
const messages: ChatCompletionMessage[] = [
  {
    role: 'system',
    content: [
      agentPrompt?.defaultPrompt || '你是 AI Agent Web 控制台里的聊天陪伴助手。',
      '请基于当前聊天对象、关系氛围和用户意图，用简洁、自然的中文回答用户。',
      '如果用户要求起草回复，请直接给出可发送的聊天内容，避免正式公文格式和职场汇报语气。',
      '你的建议应尊重双方边界，避免操控式话术、制造焦虑或诱导过度解读。',
      activeMemories.length > 0
        ? [
            '以下是用户与该 Agent 的长期记忆，请优先尊重：',
            ...activeMemories.map((memory) => `- [${memory.type} / 重要度 ${memory.importance}] ${memory.content}`),
          ].join('\n')
        : '',
      ownedConversation?.conversation.summary
        ? `此前对话摘要：${ownedConversation.conversation.summary}`
        : '',
    ].join('\n'),
  },
]
```

然后追加当前聊天对象资料：

当前聊天对象资料单独作为一条 user message 追加进去，是为了让模型知道这次对话面对的是哪个 Agent，以及这个 Agent 的关系阶段、主题、节奏、备注等信息。它不是长期记忆，也不是聊天历史，而是当前聊天对象的静态上下文。

index.ts

```typescript
messages.push({
  role: 'user',
  content: [
    `聊天对象：${payload.conversation.name}（${payload.conversation.handle}）`,
    `对象状态：${payload.conversation.status}，${payload.conversation.lastActive}`,
    `关系阶段：${payload.conversation.relationship}`,
    `聊天主题：${payload.conversation.headline}`,
    `共同点：${payload.conversation.topic}`,
    `心动值：${payload.conversation.chemistryLabel} ${payload.conversation.chemistry}`,
    `互动节奏：${payload.conversation.rhythm}`,
    `对象备注：${payload.conversation.profileNote}`,
  ].join('\n'),
})
```

最后追加历史消息和本轮用户输入：

历史消息来自 D1 中保存的最近消息。追加时会先通过 `normalizeStoredMessage` 清理内容，空消息会跳过。这样可以减少异常数据进入 prompt 的机会。历史消息保留原来的 `role`，用户消息仍然是 `user`，assistant 回复仍然是 `assistant`，模型就能理解对话轮次。

index.ts

```typescript
for (const message of promptHistory) {
  const text = normalizeStoredMessage(message.content)

  if (!text) {
    continue
  }

  messages.push({ role: message.role, content: text })
}

if (storedRecentMessages.length > 0 && latestUserText) {
  messages.push({ role: 'user', content: latestUserText })
}
```

这里有一个细节：前端虽然也会传 `messages`，但后端优先使用 D1 中保存的历史。这样用户刷新、切换 Agent、加载历史后，真正决定上下文的是服务端持久化数据，而不是前端临时状态。

这里需要再强调一次：前端消息和服务端历史可能短暂不一致，尤其在刚发送、刚刷新、加载更早消息、或者多个标签页同时打开时。如果后端完全依赖前端传来的 `messages`，记忆系统就会退回到 UI 状态驱动。现在后端优先用 D1 里的历史，前端只提交最近 UI 消息和本轮请求必要字段，整个链路就更稳定。

我们还可以把这套 prompt 组装理解成一次上下文分拣。Agent 默认人设回答「你是谁、要以什么方式回答」；长期记忆回答「这个用户有哪些稳定偏好和边界」；会话摘要回答「更早之前聊到了什么」；最近消息回答「当前对话现场是什么」；本轮用户输入回答「这一次到底要处理什么」。这几个部分按顺序进入模型，回答才不容易飘。

到这里，发送前的准备工作就完成了。下一步就是调用上游 LLM，并把模型返回的内容一边流式送回前端，一边在结束后保存成 assistant 消息。那部分属于回复后的落库和记忆沉淀，后面再单独拆开。

## 总结

这一篇讲的是模型调用前的准备。用户消息先落库，避免上游失败时丢失输入；随后后端从 D1 读取最近历史和长期记忆，再把 Agent 人设、记忆、摘要、聊天对象资料、历史消息和本轮输入组装成 prompt。这样一来，真正决定上下文的是服务端持久化数据，而不是前端当前那一份临时 messages。
