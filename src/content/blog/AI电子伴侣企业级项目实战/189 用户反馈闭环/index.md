---
title: "189 用户反馈闭环"
pubDate: 2026-06-16
description: "在 AI 电子伴侣场景里，模型回复能用还不够。用户真正关心的是：这个 Agent 能不能越来越懂我，能不能少犯同样的错，能不能逐渐贴近我喜欢的表达方式。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-06-16
---
原文链接：[https://aicompanion.usehook.cn/54-agent-chat-user-feedback-loop/](https://aicompanion.usehook.cn/54-agent-chat-user-feedback-loop/)

## 概述

Agent 聊天用户反馈闭环：从点赞点踩到回复质量自适应

在 AI 电子伴侣场景里，模型回复**能用**还不够。用户真正关心的是：这个 Agent 能不能越来越懂我，能不能少犯同样的错，能不能逐渐贴近我喜欢的表达方式。

所以这一步实现的是一个轻量但完整的用户反馈闭环。用户可以对某条 Agent 回复进行正向或负向反馈；API 会把反馈绑定到具体 assistant 消息，并持久化到 D1；历史消息加载时会返回已经提交过的反馈状态；下一轮聊天时，API 会读取最近反馈，把它注入到系统提示词中；LLM 再在不暴露内部标签的前提下，自动调整后续回复风格。

这个版本不做复杂评分体系，也不直接微调模型。它更像是一个**偏好记事本**：把用户显式表达的喜欢和不喜欢，稳定地带回下一轮对话。

## 反馈闭环

前面已经有了长期记忆、意图判断、情绪路由、关系阶段、回复策略模板、回复质量守卫等模块。这些模块解决的是**系统应该如何理解一轮聊天**。

但用户反馈解决的是另一个问题：用户本人到底喜欢什么。

例如同样是安慰，有人喜欢温柔细腻，有人喜欢短句直接；同样是虚拟女友，有人喜欢活泼撒娇，有人喜欢克制陪伴。如果完全依赖通用规则，Agent 很容易变得**标准但不贴身**。

因此反馈闭环的目标不是替代已有判断模块，而是在已有策略之上增加一层用户偏好校准。

## 数据模型

新增 D1 表 `agent_message_feedbacks`，一条记录对应**某个用户对某条 assistant 消息的反馈**。

核心字段如下：

index.sql

```sql
CREATE TABLE IF NOT EXISTS agent_message_feedbacks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES user_agent_companions(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES agent_conversation_messages(id) ON DELETE CASCADE,
  rating TEXT NOT NULL,
  reason TEXT,
  note TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
```

重点是唯一索引：

index.sql

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_message_feedbacks_user_message_unique
ON agent_message_feedbacks(user_id, message_id);
```

这样同一个用户对同一条消息只能有一条反馈。用户从点赞切换到点踩时，不新增记录，而是更新原记录。

## 消息结构

在 `packages/contracts/src/chat/inbox-chat.contract.ts` 中定义反馈枚举：

index.ts

```typescript
export const AgentMessageFeedbackRatingSchema = z.enum(['positive', 'negative'])

export const AgentMessageFeedbackReasonSchema = z.enum([
  'good_tone',
  'helpful',
  'warm',
  'remembered_context',
  'bad_tone',
  'too_long',
  'too_cold',
  'too_pushy',
  'wrong_memory',
  'unsafe',
  'other',
])
```

消息结构增加 `feedback` 字段：

index.ts

```typescript
export const AgentConversationMessageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  agentId: z.string().min(1),
  role: AgentConversationMessageRoleSchema,
  content: z.string(),
  status: z.enum(['completed', 'failed']),
  createdAtMs: z.number().int().nonnegative(),
  feedback: AgentMessageFeedbackSchema.nullable(),
})
```

这样前端加载历史消息时，可以直接知道某条 assistant 回复是否已经被用户标记过。

## 提交反馈

新增接口：

index.http

```http
POST /rpc/chat/inbox/:agentId/messages/:messageId/feedback
```

请求体：

index.ts

```typescript
export const SubmitAgentMessageFeedbackRequestSchema = z.object({
  rating: AgentMessageFeedbackRatingSchema,
  reason: AgentMessageFeedbackReasonSchema.optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
})
```

接口实现时会做几个关键校验：必须是当前登录用户，Agent 必须属于当前用户，message 必须是当前用户、当前 Agent 下的 assistant 消息，并且 message 状态必须是 `completed`。

核心逻辑：

index.ts

```typescript
const message = await findAgentConversationMessageForFeedback({
  db,
  userId: claims.sub,
  agentId,
  messageId,
})

if (!message) {
  throw new AppError(BizCode.COMMON_NOT_FOUND, 'Assistant message not found', 404)
}

const feedback = await upsertAgentMessageFeedback({
  db,
  id: crypto.randomUUID(),
  userId: claims.sub,
  agentId,
  conversationId: message.conversationId,
  messageId: message.id,
  rating: payload.rating,
  reason: payload.reason ?? null,
  note: payload.note?.trim() || null,
  nowMs,
})
```

这里使用 `upsert` 思路：如果用户已经对这条消息反馈过，就更新；没有反馈过，就新增。

## 历史消息

原来的历史消息只返回消息本身。现在查询消息时左连接 `agent_message_feedbacks`：

index.ts

```typescript
.leftJoin(agentMessageFeedbacks, and(
  eq(agentMessageFeedbacks.userId, params.userId),
  eq(agentMessageFeedbacks.messageId, agentConversationMessages.id),
))
```

最终返回：

index.ts

```typescript
feedback: row.feedbackRating && typeof row.feedbackUpdatedAtMs === 'number'
  ? {
      rating: row.feedbackRating as 'positive' | 'negative',
      reason: row.feedbackReason,
      note: row.feedbackNote,
      updatedAtMs: row.feedbackUpdatedAtMs,
    }
  : null
```

这样刷新页面或加载更早历史时，前端都能还原点赞/点踩状态。

## Prompt 注入

反馈闭环最关键的一步，是让下一轮生成能够读到最近反馈。

API 在聊天生成前读取最近几条反馈：

index.ts

```typescript
const recentFeedbacks = agentId
  ? await listRecentAgentMessageFeedbacks({
      db,
      userId: claims.sub,
      agentId,
      limit: messageFeedbackInjectionLimit,
    })
  : []
```

然后格式化成系统指令：

index.ts

```typescript
function getFeedbackSystemInstruction(feedbacks: StoredAgentMessageFeedback[]) {
  if (feedbacks.length === 0) {
    return ''
  }

  return [
    '近期用户对该 Agent 回复的反馈：',
    formatRecentMessageFeedbacks(feedbacks),
    '请把正向反馈视为用户偏好的表达风格，把负向反馈视为需要避免的问题；不要在回复中提到评分、点赞、点踩或反馈记录。',
  ].join('\n')
}
```

最终放入 system prompt：

index.ts

```typescript
content: [
  agentPrompt?.defaultPrompt || '你是 AI Agent Web 控制台里的聊天陪伴助手。',
  getSafetySystemInstruction(safety),
  getIntentSystemInstruction(intent),
  getEmotionRouteSystemInstruction({ emotion, route }),
  getRelationshipStageSystemInstruction(relationshipStage),
  getReplyPolicySystemInstruction(replyPolicy),
  getFeedbackSystemInstruction(recentFeedbacks),
].join('\n')
```

注意这里有一句非常重要：

index.txt

```txt
不要在回复中提到评分、点赞、点踩或反馈记录。
```

因为用户是在和**电子伴侣**聊天，而不是在操作一个后台调参面板。反馈应该影响行为，但不能破坏沉浸感。

## Web UI

前端在 assistant 气泡下方展示两个轻量图标按钮：

index.tsx

```tsx
<button
  aria-label="这条回复有帮助"
  onClick={() => {
    feedbackMutation.mutate({ messageId: message.id, rating: "positive" })
  }}
  type="button"
>
  <ThumbsUp className="size-3.5" />
</button>

<button
  aria-label="这条回复不合适"
  onClick={() => {
    feedbackMutation.mutate({ messageId: message.id, rating: "negative" })
  }}
  type="button"
>
  <ThumbsDown className="size-3.5" />
</button>
```

这里有一个细节：只给已经从服务端历史里返回过的 assistant 消息展示反馈按钮。

原因是流式输出刚结束时，前端当前消息 ID 可能还是 AI SDK 的临时 ID，并不是数据库里的 `messageId`。如果这时提交反馈，后端找不到对应消息。当前实现用 `persistedAssistantMessageIds` 记录服务端返回过的消息，避免误提交。

index.ts

```typescript
const canSubmitFeedback =
  !isUser &&
  message.id !== INITIAL_ASSISTANT_MESSAGE_ID &&
  persistedAssistantMessageIds.has(message.id)
```

这是一个务实选择：先保证反馈准确落库，后续再考虑通过流式响应回传 assistant messageId，让刚生成的回复也能立即反馈。

## 当前边界

这个版本是反馈闭环 v1，有意保持克制。

它不做模型微调，不自动调整 Agent 人设 prompt，不做复杂反馈弹窗，也不把反馈开放给其他用户共享。更重要的是，它不会让反馈绕过安全边界、意图判断和回复策略。

它只做一件事：把用户对具体回复的显式偏好，稳定地带入后续回复生成。

## 后续升级

后续可以在这个基础上继续增强。

- 反馈原因细分：太长、太冷、太油、记错了、不安全等。

- 负反馈后弹出二级选择，让用户低成本告诉系统哪里不好。

- 将多条反馈归纳为**用户偏好画像**，避免 prompt 越来越长。

- 对负反馈触发回复质量守卫复盘，记录具体违规点。

- 对高频负反馈生成 Agent 调参建议，但仍由用户确认后写入 Agent 设定。

- 新增**撤销反馈**或**清除偏好**能力，给用户可控性。

## 总结

用户反馈闭环是 AI 电子伴侣从**会回复**走向**越来越懂你**的关键基础设施。

这次实现的重点不是复杂，而是完整。

有数据库表，反馈不会丢；有 contracts，前后端类型一致；有 API 校验，不能反馈别人的消息；有历史回显，用户知道自己标记过什么；有 prompt 注入，下一轮回复真的会受影响；有 UI 入口，也不会打断聊天体验。

在产品层面，它让 Agent 的成长开始有了用户参与；在工程层面，它为后续偏好画像、质量复盘和个性化调参留下了稳定接口。
