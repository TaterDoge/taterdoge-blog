---
title: "191 Agent 群聊底座"
pubDate: 2026-06-16
description: "我们从这一篇开始整理 AI 电子伴侣里的 Agent 群聊 功能。原来的单聊只有一个用户和一个 Agent，群聊要处理的事情会更多：一个群聊里有多个 Agent，有独立的消息历史，有成员管理，也要决定。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-06-16
---
原文链接：[https://aicompanion.usehook.cn/56-agent-group-chat-foundation/](https://aicompanion.usehook.cn/56-agent-group-chat-foundation/)

## 概述

我们从这一篇开始整理 AI 电子伴侣里的 **Agent 群聊** 功能。原来的单聊只有一个用户和一个 Agent，群聊要处理的事情会更多：一个群聊里有多个 Agent，有独立的消息历史，有成员管理，也要决定用户发完消息后到底由谁来回复。

所以群聊功能不能简单理解成把多个 Agent 堆到同一个聊天室里。我们真正要做的是一个受控、可持久化、可扩展的多人陪伴场景：用户可以创建群聊、邀请多个 Agent、发送消息，然后由系统选择最合适的 1 到 3 个 Agent 进行回复。

这部分内容比较多，我们把它拆成两篇来讲。这一篇先讲群聊底座，也就是数据模型、Contract、API、创建群聊和成员管理。下一篇再讲谁来回复、Prompt 如何组装、消息发送链路、LLM 配置和前端交互体验。

群聊第一版先把几个最基础的问题处理掉。用户要能创建一个 Agent 群聊，并邀请自己创建的 Agent 加入；每个群聊要有独立的成员、消息历史、最近消息和摘要；用户发送消息以后，系统要能根据内容决定由哪些 Agent 回复；前端也要有完整 UI，至少包括群聊列表、消息窗口、成员管理、邀请 Agent 和 LLM 配置选择。

为了避免群聊一开始就失控，第一版先加上几条限制：一个群聊最多 6 个 Agent，每轮最多 3 个 Agent 回复。如果用户点名某个 Agent，优先让被点名 Agent 回复；如果用户说**你们怎么看**、**大家一起**这类群体提问，再触发多个 Agent；默认情况下只让第一个 Agent 回复，避免刷屏。

## 数据模型

群聊使用 D1 持久化，新增迁移文件：

index.txt

```txt
apps/api/migrations/0016_agent_group_chats.sql
```

迁移里新增三张表：

index.sql

```sql
CREATE TABLE IF NOT EXISTS agent_group_chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT,
  message_count INTEGER NOT NULL,
  last_message_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_group_chat_members (
  id TEXT PRIMARY KEY,
  group_chat_id TEXT NOT NULL REFERENCES agent_group_chats(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES user_agent_companions(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL,
  status TEXT NOT NULL,
  joined_at_ms INTEGER NOT NULL,
  removed_at_ms INTEGER
);

CREATE TABLE IF NOT EXISTS agent_group_chat_messages (
  id TEXT PRIMARY KEY,
  group_chat_id TEXT NOT NULL REFERENCES agent_group_chats(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL,
  agent_id TEXT REFERENCES user_agent_companions(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  metadata_json TEXT,
  created_at_ms INTEGER NOT NULL
);
```

这三个表的职责很清楚。`agent_group_chats` 是群聊主表，记录标题、摘要、消息数量和最近消息时间。`agent_group_chat_members` 是群聊成员表，记录哪些 Agent 在群里，同时通过 `status`、`removed_at_ms` 支持软移除。`agent_group_chat_messages` 是群聊消息表，用户消息和 Agent 消息都会落到这里。

这里要特别注意 `sender_type`。单聊消息通常只有 `user` 和 `assistant` 两种角色，但群聊里一个 assistant 已经不够表达是谁在说话，所以扩展为三种类型：

| sender_type | 含义 |
| --- | --- |
| user | 用户发送 |
| agent | 某个 Agent 发送 |
| system | 预留给系统事件 |

同时，Agent 消息会通过 `agent_id` 关联到具体 Agent。这样前端渲染消息时，才能显示不同 Agent 的名称、头像和角色身份。

## Contract 先行

前后端通过下面这个文件共享类型：

index.txt

```txt
packages/contracts/src/chat/group-chat.contract.ts
```

成员结构里保留了 Agent 的基础展示信息，包括名称、简介、头像、状态、排序和加入时间。

index.ts

```typescript
export const AgentGroupChatMemberSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  name: z.string().min(1).max(120),
  headline: z.string().max(200).nullable(),
  imageKey: z.string().max(300).nullable(),
  status: z.enum(['active', 'removed']),
  displayOrder: z.number().int().nonnegative(),
  joinedAtMs: z.number().int().nonnegative(),
})
```

消息结构里，`senderType` 用来区分用户、Agent 和系统事件；`agentId`、`agentName`、`agentImageKey` 用来承接 Agent 消息的展示信息。

index.ts

```typescript
export const AgentGroupChatMessageSchema = z.object({
  id: z.string().min(1),
  groupChatId: z.string().min(1),
  senderType: z.enum(['user', 'agent', 'system']),
  agentId: z.string().min(1).nullable(),
  agentName: z.string().max(120).nullable(),
  agentImageKey: z.string().max(300).nullable(),
  content: z.string(),
  status: z.enum(['completed', 'failed']),
  turnIndex: z.number().int().nonnegative(),
  createdAtMs: z.number().int().nonnegative(),
})
```

创建群聊时，前端需要提交群聊标题和 Agent 列表。这里直接在 Contract 层限制 `agentIds` 最少 1 个，最多 6 个。

index.ts

```typescript
export const CreateAgentGroupChatRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
  agentIds: z.array(z.string().min(1)).min(1).max(6),
})
```

发送群聊消息时，除了 `groupChatId` 和用户输入的 `message`，还可以带上可选的 `llmConfig`。这样群聊可以复用个人中心里的本地 LLM 配置能力。

index.ts

```typescript
export const SendAgentGroupChatMessageRequestSchema = z.object({
  groupChatId: z.string().min(1),
  message: z.string().trim().min(1).max(4000),
  llmConfig: InboxChatLlmConfigSchema.optional(),
})
```

把 Contract 放在前面，前端调用 API 时能直接拿到类型提示，后端也能用同一份 schema 校验输入。群聊后面还会继续扩展成员邀请、历史分页、回复生成，如果没有 Contract 收口，前后端很容易各传各的字段。

## API 设计

群聊 API 注册在：

index.ts

```typescript
// apps/api/src/routes/index.ts
.route('/rpc/chat/group', groupChatRoute)
```

接口大致分成这几类：

index.http

```http
GET    /rpc/chat/group
POST   /rpc/chat/group
GET    /rpc/chat/group/:groupChatId
GET    /rpc/chat/group/:groupChatId/messages?cursor=...
POST   /rpc/chat/group/:groupChatId/members
DELETE /rpc/chat/group/:groupChatId/members/:memberId
POST   /rpc/chat/group/send
```

这些接口覆盖了群聊的完整基础能力：读取群聊列表、创建群聊、读取群聊详情、分页读取历史消息、添加成员、移除成员，以及发送群聊消息。

前端封装在：

index.txt

```txt
apps/web/src/auth/api.ts
```

前端会把这些接口封装成方法：

index.ts

```typescript
export function getAgentGroupChats() {
  return http.get<AgentGroupChatListResponse>('/rpc/chat/group')
}

export function createAgentGroupChat(input: CreateAgentGroupChatRequest) {
  return http.post<CreateAgentGroupChatResponse, CreateAgentGroupChatRequest>('/rpc/chat/group', input)
}

export function getAgentGroupChatDetail(groupChatId: string) {
  return http.get<AgentGroupChatDetailResponse>(`/rpc/chat/group/${groupChatId}`)
}

export function sendAgentGroupChatMessage(input: SendAgentGroupChatMessageRequest) {
  return http.post<SendAgentGroupChatMessageResponse, SendAgentGroupChatMessageRequest>('/rpc/chat/group/send', input)
}
```

可以看到，群聊 API 没有直接复用单聊接口，而是单独挂在 `/rpc/chat/group` 下。这样边界更清楚，后面不管是加群聊记忆、流式回复，还是 Agent 之间互相回应，都不会把单聊接口搅复杂。

## 创建群聊

创建群聊时，后端会做三层校验：

- 必须是 Web 用户 token。

- 至少选择 1 个 Agent，最多 6 个。

- 选择的 Agent 必须属于当前用户。

我们可以看这段创建逻辑：

index.ts

```typescript
const agentIds = dedupeStrings(payload.agentIds).slice(0, 6)

if (agentIds.length === 0) {
  throw new AppError(BizCode.COMMON_INVALID_REQUEST, 'Please select at least one agent', 400)
}

const agents = await listOwnedAgentCompanionsByIds(db, {
  userId: claims.sub,
  agentIds,
})

if (agents.length !== agentIds.length) {
  throw new AppError(BizCode.AUTH_FORBIDDEN, 'Some agents are unavailable', 403)
}

await createAgentGroupChat({
  db,
  id: groupChatId,
  userId: claims.sub,
  title: payload.title.trim(),
  agentIds,
  nowMs,
})
```

这里不允许用户把别人的 Agent 混进自己的群聊，避免数据越权。`dedupeStrings(payload.agentIds).slice(0, 6)` 也把重复 Agent 和超过上限的输入提前收掉，防止后面的成员写入出现重复数据。

创建成功后，群聊主表会记录基础信息，成员表会按选择顺序写入 Agent。后续读取详情时，前端就能拿到群聊信息、成员列表和最近消息。

## 成员管理

群聊详情页右侧栏支持两个动作：移除当前群成员，从自己的 Agent 列表里邀请新成员。

添加成员时同样限制最多 6 个：

index.ts

```typescript
if (groupChat.members.length + nextAgentIds.length > 6) {
  throw new AppError(BizCode.BIZ_RULE_VIOLATION, 'A group chat can include at most 6 agents', 422)
}
```

前端邀请时会过滤掉已经在群里的 Agent：

index.ts

```typescript
const currentMemberAgentIds = new Set(currentMembers.map((member) => member.agentId))

return availableAgents.filter((agent) => {
  if (currentMemberAgentIds.has(agent.id)) {
    return false
  }

  return true
})
```

这里有两个细节需要留意。成员上限要同时在前端体验和后端规则里存在，前端负责不让用户选得太离谱，后端负责最终兜底。移除成员时也不一定要物理删除，成员表已经预留了 `status` 和 `removed_at_ms`，后面如果要展示历史成员、系统事件，或者恢复成员，都还有空间。

## 总结

到这里，群聊功能的底座已经搭起来了：D1 负责群聊、成员和消息持久化，Contract 保证前后端类型一致，API 控制权限、成员上限、详情读取和基础成员管理。

这一篇先把群聊能不能被创建、能不能被保存、成员关系是否清楚、前后端字段是否统一这些问题讲清楚。下一篇我们继续往下走：用户在群里发一条消息以后，系统如何选择 Agent、如何组装 Prompt、如何写入多条回复，以及前端如何用 React Query 做乐观更新和失败回滚。
