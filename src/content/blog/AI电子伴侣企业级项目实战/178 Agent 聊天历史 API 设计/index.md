---
title: "178 Agent 聊天历史 API 设计"
pubDate: 2026-06-09
description: "这一篇只看聊天历史相关 API。记忆系统落到页面以后，用户最先感知到的不是长期记忆，而是打开某个 Agent 时，右侧聊天窗口能不能恢复之前的内容。如果历史接口设计得不清楚，前端就只能继续依赖临时 U。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-06-09
---
原文链接：[https://aicompanion.usehook.cn/43-agent-memory-history-api/](https://aicompanion.usehook.cn/43-agent-memory-history-api/)

## API 设计

这次 API 分成两类。

这一篇只看聊天历史相关 API。记忆系统落到页面以后，用户最先感知到的不是长期记忆，而是打开某个 Agent 时，右侧聊天窗口能不能恢复之前的内容。如果历史接口设计得不清楚，前端就只能继续依赖临时 UI 状态；一旦刷新页面，聊天又会回到没有记忆的状态。

我们需要先把几个问题想清楚：打开 Agent 时，前端应该请求哪个接口；如果这个 Agent 还没有会话，后端是返回空，还是顺手创建默认会话；首次返回多少条消息比较合适；消息多了以后，前端如何加载更早历史；每个请求如何确认当前用户确实拥有这个 Agent。这些问题都不复杂，但要在接口层一次梳理明白。

第一类是聊天历史接口：

index.txt

```txt
GET  /rpc/chat/inbox/:agentId/conversation
GET  /rpc/chat/inbox/:agentId/messages?cursor=...
POST /rpc/chat/inbox
```

第二类是长期记忆管理接口：

index.txt

```txt
GET    /rpc/agent/my/:agentId/memories
PATCH  /rpc/agent/my/:agentId/memories/:memoryId
DELETE /rpc/agent/my/:agentId/memories/:memoryId
```

虽然这里列出了两类接口，但这一篇先把聊天历史接口讲透。长期记忆管理接口会在前端恢复与管理那篇里展开。两块分开看会更清楚：历史接口解决聊天窗口恢复和分页，记忆管理接口解决记忆库页面的查看、编辑、停用和删除。

`POST /rpc/chat/inbox` 是发送聊天的接口，也列在这里，是因为它和历史接口共用同一套会话身份。发送流程会单独展开，这里我们先记住一点：发送消息时也会带上 `conversationId`，后端才能把用户消息和 assistant 回复写进正确会话。

## 获取或创建默认会话

打开某个 Agent 时，web 端先请求：

index.txt

```txt
GET /rpc/chat/inbox/:agentId/conversation
```

后端会校验当前用户是否拥有这个 Agent，然后获取或创建默认会话：

这里有一个设计选择：打开 Agent 时，如果会话不存在，后端直接创建默认会话，而不是让前端再调用一个创建会话接口。v1 只支持一个用户和一个 Agent 的默认一对一会话，这个会话没有复杂的创建表单，也不需要用户输入标题。既然打开 Agent 就意味着用户准备和它聊天，那么由读取接口顺手创建默认会话，会让前端逻辑简单很多。

当然，这种写法要建立在唯一约束之上。数据库里已经通过 `user_id + agent_id` 保证同一个用户和同一个 Agent 只有一条默认会话。所以即使用户快速切换、页面重复请求、React Query 重试，后端也不会创建出多条重复会话。

index.ts

```typescript
async function requireOwnedAgentConversation(params: {
  c: Context<{ Bindings: ApiBindings }>
  userId: string
  agentId: string
}) {
  const db = getDb(params.c.env.DB)
  const agent = await findUserAgentCompanionOwner(db, {
    userId: params.userId,
    agentId: params.agentId,
  })

  if (!agent) {
    throw authUnauthorizedError('Agent is not available')
  }

  const conversation = await getOrCreateDefaultAgentConversation({
    db,
    id: crypto.randomUUID(),
    userId: params.userId,
    agentId: params.agentId,
    title: agent.name,
    nowMs: Date.now(),
  })

  return {
    agent,
    conversation,
  }
}
```

这里的 `getOrCreateDefaultAgentConversation` 里用了 `onConflictDoNothing()`，避免两个请求同时打开同一个 Agent 时，因为唯一索引冲突导致创建失败。

我们可以把这个函数看成历史 API 的前置关口。它不只是取会话，还负责确认 Agent 的归属。`findUserAgentCompanionOwner` 会用当前登录用户 ID 和 Agent ID 去查用户自己的 Agent，如果查不到，就说明这个 Agent 对当前用户不可用。后面无论是返回历史消息，还是分页加载更早消息，都应该建立在这个权限校验之上。

这样做能避免一个很常见的问题：前端 URL 或请求参数里带了某个 `agentId`，后端就直接按这个 ID 查询消息。如果没有同时校验 `userId`，就可能出现跨用户读取。记忆系统保存的是聊天内容和长期偏好，这类数据比普通展示数据更敏感，所以接口层必须把归属校验放在最前面。

`getOrCreateDefaultAgentConversation` 接收的 `title` 使用了 Agent 名称。v1 里虽然还没有多会话列表，但会话表仍然保留标题字段。这个字段可以先服务于默认会话，后续如果要做多会话，标题也可以自然扩展成用户可编辑的会话名。

返回时会带上最近 40 条消息：

index.ts

```typescript
inboxChatRoute.get('/:agentId/conversation', async (c) => {
  const claims = await requireWebAccessToken(c)
  const agentId = c.req.param('agentId')?.trim()

  const { agent, conversation } = await requireOwnedAgentConversation({
    c,
    userId: claims.sub,
    agentId,
  })

  const messages = await listAgentConversationMessages({
    db: getDb(c.env.DB),
    userId: claims.sub,
    agentId,
    conversationId: conversation.id,
    limit: initialHistoryLimit,
  })

  const res = AgentConversationResponseSchema.parse({
    conversationId: conversation.id,
    agentId,
    title: conversation.title,
    summary: conversation.summary,
    messageCount: conversation.messageCount,
    openingMessage: agent.openingMessage,
    messages: messages.map(toConversationMessageResponse),
    nextCursor: getOldestMessageCursor(messages, initialHistoryLimit),
  })

  return c.json(buildSuccess(res, createApiMeta()))
})
```

首次打开会话时返回最近 40 条消息，是为了让聊天窗口有足够上下文。这个数字和发送 prompt 时使用的最近消息数量不是同一件事。页面恢复历史需要给用户看一段比较完整的聊天记录，而 prompt 组装只需要取一段适合模型上下文的消息。页面层和模型层的数量可以不同。

返回数据里有几项值得单独看一下。`conversationId` 是后续发送消息时要带回去的会话 ID。`summary` 是会话摘要，虽然前端页面不一定直接展示，但它是服务端上下文系统的一部分。`messageCount` 可以让前端知道会话规模。`openingMessage` 用于没有历史消息时展示默认开场。`messages` 是最近历史消息，`nextCursor` 则决定页面是否显示加载更早入口。

`messages.map(toConversationMessageResponse)` 这一步也不能省。数据库里的字段是内部结构，接口返回的是 contract 定义的结构。比如数据库字段可能是 `created_at_ms`，前端拿到的是 `createdAtMs`。中间做一次明确转换，可以让后端内部 schema 和前端协议保持解耦。

`nextCursor` 的计算发生在首次返回消息时。如果最近消息数量少于请求 limit，说明已经没有更早历史，cursor 就是 `null`。如果刚好取满，说明可能还有更早消息，就把当前返回列表里最早那条消息的时间作为下一页游标。

## 分页加载更早消息

历史分页接口是：

index.txt

```txt
GET /rpc/chat/inbox/:agentId/messages?cursor=...
```

当前 cursor 使用最早一条消息的 `createdAtMs`：

分页接口解决的是另一个体验问题：聊天历史可能会越来越长，首次打开页面不应该一次性把所有消息都返回。一次性加载太多消息会增加接口响应时间，也会让前端渲染压力变大。更合理的方式是先返回最近一段，用户想看更早内容时再向前翻。

index.ts

```typescript
function getOldestMessageCursor(messages: Array<{ createdAtMs: number }>, requestedLimit: number) {
  if (messages.length < requestedLimit || messages.length === 0) {
    return null
  }

  return String(messages[0]!.createdAtMs)
}
```

查询时取小于 cursor 的消息：

这里的 cursor 不是页码，而是基于时间的游标。页码分页在聊天场景里不太合适，因为聊天消息会不断新增，页码很容易因为新消息插入而偏移。用最早消息的 `createdAtMs` 做游标，含义更直接：请给我这个时间点之前的消息。

index.ts

```typescript
export async function listAgentConversationMessages(params: {
  db: ApiDb
  userId: string
  agentId: string
  conversationId: string
  beforeMs?: number
  limit: number
}) {
  const conditions: SQL[] = [
    eq(agentConversationMessages.userId, params.userId),
    eq(agentConversationMessages.agentId, params.agentId),
    eq(agentConversationMessages.conversationId, params.conversationId),
  ]

  if (params.beforeMs) {
    conditions.push(sql`${agentConversationMessages.createdAtMs} < ${params.beforeMs}`)
  }

  const rows = await params.db
    .select()
    .from(agentConversationMessages)
    .where(and(...conditions))
    .orderBy(sql`${agentConversationMessages.createdAtMs} desc, ${agentConversationMessages.id} desc`)
    .limit(params.limit)

  return rows.reverse()
}
```

这个分页方案简单直观。后续如果要处理同一毫秒内多条消息的极端情况，可以把 cursor 扩展为 `{ createdAtMs, id }` 组合游标。

查询时先按条件过滤 `userId`、`agentId` 和 `conversationId`，这和前面说的权限边界保持一致。即使前端传了某个 conversationId，后端也不会只按 conversationId 查，而是继续要求它属于当前用户和当前 Agent。这样可以避免用户拿到别人的 conversationId 后读取历史。

排序时先按 `createdAtMs desc`，再按 `id desc`，是为了从最新往更早取一页。取完以后 `reverse()`，让返回给前端的消息仍然是从旧到新的顺序。聊天窗口通常按时间正序渲染，如果后端直接返回倒序，前端还要再处理一次，而且容易在加载更早消息时拼接错。

当前实现只用 `createdAtMs` 作为 cursor，已经能覆盖大多数情况。极端情况下，如果同一毫秒内插入多条消息，单独用时间可能会漏掉或重复某条消息。后续可以把 cursor 扩展成组合结构，比如把 `createdAtMs` 和 `id` 一起编码成字符串。查询时用时间小于，或者时间相同但 ID 小于的方式继续翻页。这个优化可以等消息量和并发确实上来以后再做。

到这里，历史 API 的职责就比较清楚了。它不负责调用 LLM，也不负责抽取长期记忆；它只负责把会话身份建立起来，把最近历史返回给前端，并且提供继续加载更早消息的能力。发送聊天时如何使用这份会话身份，我们再接着往后看。

## 总结

聊天历史 API 先把会话身份建立起来。打开 Agent 时，后端会校验归属、获取或创建默认会话，并返回最近一段消息；历史变多以后，前端再通过 cursor 加载更早消息。这个接口层看起来不复杂，但它把权限、会话、分页和前端恢复串在了一起，是后面发送消息和恢复聊天窗口的基础。
