---
title: "181 Agent 记忆系统前端恢复与管理"
pubDate: 2026-06-09
description: "apps/web/app/dashboard/_components/inbox-chat.tsx。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-06-09
---
原文链接：[https://aicompanion.usehook.cn/46-agent-memory-web-and-manage/](https://aicompanion.usehook.cn/46-agent-memory-web-and-manage/)

## 首页聊天窗口如何恢复历史

web 端聊天组件位于：

index.txt

```txt
apps/web/app/(dashboard)/_components/inbox-chat.tsx
```

打开某个 Agent 时，先查询会话：

前面几篇已经把后端的表结构、历史接口、发送链路和落库逻辑梳理完了。到了前端这里，重点就变成一个问题：这些服务端能力如何变成用户能感知到的体验。最直接的体验就是打开某个 Agent 时，右侧聊天窗口不再从空白开始，而是能恢复之前保存的历史。

这里不能再让聊天窗口只依赖组件内部的初始状态。组件挂载时，要先根据当前 Agent 查询服务端会话。如果查询还在进行，就展示加载状态；如果查询失败，就展示错误状态；只有拿到服务端会话以后，才进入真正的聊天组件。这样可以避免 UI 先渲染一份临时消息，随后又被历史消息替换，导致页面闪动或状态错乱。

index.ts

```typescript
export function InboxChat({ conversation, onConversationUpdated }: InboxChatProps) {
  const queryClient = useQueryClient()
  const conversationQuery = useQuery({
    queryKey: ["agent-conversation", conversation.id],
    queryFn: () => getAgentConversation(conversation.id ?? ""),
    enabled: Boolean(conversation.id),
  })

  if (conversationQuery.isLoading) {
    return <InboxChatLoadingPanel conversation={conversation} />
  }

  if (conversationQuery.isError || !conversationQuery.data) {
    return <InboxChatErrorPanel conversation={conversation} />
  }

  return (
    <InboxChatInner
      conversation={conversation}
      key={conversationQuery.data.conversationId}
      onConversationUpdated={() => {
        void queryClient.invalidateQueries({ queryKey: ["agent-conversation", conversation.id] })
        onConversationUpdated?.()
      }}
      serverConversation={conversationQuery.data}
    />
  )
}
```

如果服务端有历史消息，就用历史消息初始化 `useChat`。如果没有历史消息，就用 Agent 的 `openingMessage` 做默认开场：

这里使用 `key={conversationQuery.data.conversationId}` 也需要认真处理。不同 conversation 应该是不同聊天状态。切换 Agent 时，如果 React 复用了旧组件实例，内部 messages 状态可能会残留。把 conversationId 放到 key 上，可以让聊天内部状态随着服务端会话一起重建，避免把上一个 Agent 的消息带到下一个 Agent。

index.ts

```typescript
function buildInitialMessages(serverConversation: AgentConversationResponse): UIMessage[] {
  if (serverConversation.messages.length > 0) {
    return serverConversation.messages.map(toUiMessage)
  }

  if (serverConversation.openingMessage?.trim()) {
    return [
      {
        id: INITIAL_ASSISTANT_MESSAGE_ID,
        role: "assistant",
        parts: [{ type: "text", text: serverConversation.openingMessage }],
      },
    ]
  }

  return [
    {
      id: INITIAL_ASSISTANT_MESSAGE_ID,
      role: "assistant",
      parts: [{ type: "text", text: "我已经准备好陪你聊天了。你可以直接说今天想聊什么。" }],
    },
  ]
}
```

`buildInitialMessages` 的分支也体现了产品体验的优先级。第一优先级是服务端历史消息，只要有历史，就应该恢复历史。第二优先级是 Agent 自己配置的 `openingMessage`，这能让第一次打开时更像和某个具体 Agent 对话。最后才是兜底文案，避免页面完全没有消息。

## 发送时带上 conversationId

前端发送聊天时，会把 `conversationId` 带给 API：

恢复历史只是第一步，发送新消息时也要把服务端会话 ID 带回去。否则后端即使能收到用户消息，也不知道应该写进哪段 conversation。`conversationId` 在这里就像一根线，把前端当前聊天窗口和后端会话记录接起来。

index.ts

```typescript
const transport = useMemo(
  () => new TextStreamChatTransport<UIMessage>({
    api: `${getWebClientEnv().NEXT_PUBLIC_API_BASE_URL}/rpc/chat/inbox`,
    prepareSendMessagesRequest({ api, body, messages }) {
      const requestMessages = messages.slice(-20)

      return {
        api,
        headers: storedSession
          ? { authorization: `Bearer ${storedSession.accessToken}` }
          : undefined,
        body: {
          ...body,
          conversationId: serverConversation.conversationId,
          messages: requestMessages,
          conversation,
        },
      }
    },
  }),
  [conversation, serverConversation.conversationId],
)
```

这里有一个细节：`messages.slice(-20)`。

因为 contracts 里限制了 `messages.max(20)`。历史消息真正由服务端 D1 决定，前端只需要提交最近一段 UI 消息，避免请求体过大。

这也再次说明前端和后端的分工。前端提交最近 UI 消息，是为了让本轮请求保留必要上下文；后端真正组装 prompt 时，会优先读取 D1 中保存的历史。前端不需要把所有历史重新发送一遍，也不应该承担完整上下文存储职责。这样请求体会更轻，聊天状态也更稳定。

## 加载更早消息

点击「加载更早消息」时，调用分页接口：

首次打开会话只返回最近一段消息，如果用户想看更早的聊天，就需要分页加载。加载更早消息时，前端要把新拿到的 olderMessages 拼到当前消息列表前面，而不是后面。聊天窗口的时间顺序是从旧到新，越早的消息应该出现在顶部。

index.ts

```typescript
async function loadMoreHistory() {
  if (!nextCursor || isLoadingMoreHistory || !conversation.id) {
    return
  }

  setIsLoadingMoreHistory(true)

  try {
    const response = await getAgentConversationMessages(conversation.id, nextCursor)
    const olderMessages = response.messages.map(toUiMessage)

    setHistoryMessages((current) => [...olderMessages, ...current])
    setMessages((current) => [...olderMessages, ...current])
    setNextCursor(response.nextCursor)
  } finally {
    setIsLoadingMoreHistory(false)
  }
}
```

历史 assistant 消息不会重新逐字播放，只有新回复会逐字显示。这是通过 `visibleAssistantTextById` 初始化完成的：

index.ts

```typescript
const [visibleAssistantTextById, setVisibleAssistantTextById] = useState<Record<string, string>>(() =>
  buildVisibleAssistantTextById(historyMessages),
)
```

历史 assistant 消息不重新逐字播放，是一个很细的体验点。逐字播放适合新回复，因为用户正在等待模型输出；但历史消息是已经发生过的内容，如果每次加载历史都重新播放，会让页面显得拖沓，也会干扰用户快速回看。初始化 `visibleAssistantTextById`，就是让历史 assistant 文本直接完整显示，只有新生成的回复继续使用逐字效果。

## 首页 Agent 列表展示最新消息

首页列表不能再展示角色简介，而应该展示最新聊天内容。

记忆系统接入以后，首页 Agent 列表也要跟着改变。原来列表展示角色简介，适合还没有聊天历史的状态；但一旦用户和 Agent 聊过天，列表更应该显示最近互动内容。这样用户回到首页时，能快速判断每个 Agent 最近聊到了哪里。

repository 查询时会同时拿：

- `user_agent_companions.last_assistant_message`

- `agent_conversation_messages` 中真正最新的一条消息

然后优先展示时间更新的那条。

index.ts

```typescript
const latestStoredMessageIsNewer =
  agent.latestMessageAtMs !== null &&
  (agent.lastAssistantMessageAtMs === null || agent.latestMessageAtMs > agent.lastAssistantMessageAtMs)

const previewMessage = latestStoredMessageIsNewer
  ? agent.latestMessage
  : agent.lastAssistantMessage || agent.latestMessage

const previewMessageAtMs = latestStoredMessageIsNewer
  ? agent.latestMessageAtMs
  : agent.lastAssistantMessageAtMs ?? agent.latestMessageAtMs
```

这样处理后，正常回复成功时，列表会显示最新 assistant 回复；如果 LLM 调用失败但用户消息已经保存，列表也能显示用户刚刚发出的内容，而不是掉回角色简介。

第二种情况很容易被忽略。前面讲过，用户消息会在调用 LLM 前先落库。这样即使模型失败，用户发出的内容也不会消失。首页列表如果只看 `last_assistant_message`，就会错过这条用户消息；用户回到首页时，会感觉刚才的操作没有留下痕迹。现在同时比较真实最新消息和旧的 assistant 预览，就能让列表更贴近聊天历史。

## 记忆库页面

记忆库页面位于：

index.txt

```txt
apps/web/app/(dashboard)/memories/page.tsx
```

页面现在从接口读取真实数据：

记忆库页面解决的是可管理性。长期记忆如果只在后端参与 prompt，用户看不见、改不了，就很容易变成黑盒。页面从真实接口读取数据以后，用户就能知道系统到底记住了什么，也能在记忆不准确时进行调整。

index.ts

```typescript
const agentInboxQuery = useQuery({
  queryKey: ["dashboard", "my-agent-inbox"],
  queryFn: getMyAgentInbox,
})

const memoriesQuery = useQuery({
  queryKey: ["agent-memories", selectedAgent?.id],
  queryFn: () => getMyAgentMemories(selectedAgent!.id),
  enabled: Boolean(selectedAgent),
})
```

编辑记忆时调用 PATCH：

这里先加载 Agent 列表，再根据当前选中的 Agent 加载记忆。这样页面天然以 Agent 为维度组织长期记忆。不同 Agent 的关系、偏好、边界可能完全不同，记忆不能混在一起展示。`enabled: Boolean(selectedAgent)` 也能避免没有选中 Agent 时发出无效请求。

index.ts

```typescript
const updateMemoryMutation = useMutation({
  mutationFn: (input: { memoryId: string; patch: UpdateAgentMemoryRequest }) =>
    updateMyAgentMemory(selectedAgent!.id, input.memoryId, input.patch),
  onSuccess: invalidateMemories,
})
```

删除记忆时不是物理删除，而是把 `status` 改成 `deleted`：

编辑记忆后需要重新拉取列表，保证页面和服务端状态一致。记忆会参与后续 prompt，不能只在前端本地改一下就结束。停用、修改重要度、修改内容，都会影响后面 Agent 回答时使用哪些记忆。

index.ts

```typescript
myAgentRoute.delete('/:agentId/memories/:memoryId', async (c) => {
  await updateAgentMemory({
    db,
    userId: claims.sub,
    agentId,
    memoryId,
    patch: { status: 'deleted' },
    nowMs: Date.now(),
  })

  return c.json(buildSuccess({ success: true }, createApiMeta()))
})
```

保留软删除的好处是：后续如果要做审计、恢复、分析记忆质量，都还有数据基础。

软删除还有一个产品层面的好处：它让用户操作更有余地。记忆被标记为 `deleted` 后，不再作为有效记忆参与展示和 prompt，但数据仍然可以用于后续分析。比如我们想知道哪些类型的记忆经常被用户删除，或者哪类抽取规则容易产生误判，就需要这些历史状态。

## 本地迁移和部署

新增 D1 迁移以后，本地需要执行：

index.bash

```shellscript
pnpm --filter @repo/api db:migrate:local
```

对应项目脚本是：

index.json

```json
{
  "db:migrate:local": "wrangler d1 migrations apply ai-agent-local-auth --local"
}
```

如果部署到 Cloudflare remote D1，需要执行类似：

index.bash

```shellscript
pnpm wrangler d1 migrations apply ai-agent-production-auth --env production --remote
```

迁移成功以后，首页才能正常查询 Agent 列表和聊天历史。否则会出现类似：

index.txt

```txt
Agent 列表加载失败
请确认 API 已部署并完成最新 D1 迁移后再刷新首页。
```

这个错误不是前端 UI 坏了，而是 API 查询新表时，本地或远程 D1 还没有应用最新 schema。

这类问题在新表上线时很常见。前端页面已经开始请求新接口，后端代码也已经部署，但 D1 还停留在旧 schema，查询 `agent_conversations`、`agent_conversation_messages` 或 `agent_memories` 时就会失败。所以部署记忆系统时，迁移不是可选步骤，而是功能能否运行的前提。

本地验证和远程部署也要分开看。本地开发时使用 local D1，需要执行 local migration；部署到 Cloudflare remote D1 时，要对 production 数据库执行 remote migration。只在本地迁移成功，不代表线上已经有新表；线上迁移成功，也不代表本地调试环境可用。两个环境都要分别确认。

## 手动验证建议

我们可以按这个流程验证：

- 打开首页，确认 Agent 列表能正常加载。

- 选择一个 Agent，确认右侧聊天窗口会加载历史。

- 如果没有历史，确认显示的是 Agent 的 `openingMessage`。

- 发送一条消息，确认用户消息立即出现在聊天窗口。

- 等待 assistant 回复完成，刷新页面。

- 刷新后确认用户消息和 assistant 回复都还在。

- 多聊几轮以后，打开「记忆库」页面。

- 选择对应 Agent，确认能看到自动沉淀的记忆。

- 编辑、停用、删除一条记忆，确认页面状态更新。

- 回到聊天页，继续聊天，确认长期记忆会被注入 prompt。

如果要看数据库，可以检查：

index.sql

```sql
SELECT * FROM agent_conversations;
SELECT * FROM agent_conversation_messages ORDER BY created_at_ms DESC;
SELECT * FROM agent_memories ORDER BY updated_at_ms DESC;
```

这组验证步骤覆盖了记忆系统最完整的闭环。先看列表能否加载，是确认基础查询没有问题；再看聊天窗口能否恢复历史，是确认 conversation 和 messages 生效；发送消息后刷新页面，是确认用户消息和 assistant 回复都已落库；打开记忆库，是确认长期记忆抽取和管理接口可用；最后回到聊天页继续聊天，是确认记忆不只是能展示，还能参与后续 prompt。

## 当前 v1 的边界

当前实现是第一版，重点是把记忆系统闭环跑通。它还有一些明确边界：

- 只支持用户与单个 Agent 的默认一对一会话。

- 暂不支持多会话列表。

- 暂不支持群聊和多 Agent 联动。

- 长期记忆抽取是规则实现，不是 LLM 结构化抽取。

- 没有向量检索，长期记忆按重要度和更新时间选取。

- 分页 cursor 当前只用 `createdAtMs`，极端情况下同毫秒多条消息可以进一步优化。

这些边界不是问题，而是 v1 的取舍。我们先让聊天历史、上下文注入、记忆管理跑通，再逐步增强抽取质量和检索能力。

这些边界需要在文章里讲清楚，是因为第一版很容易被误解成最终版。比如规则抽取长期记忆，不代表后面不能用 LLM；不支持多会话，也不代表表结构完全没考虑未来扩展；不用向量检索，也不代表长期记忆只能永远按重要度排序。v1 的目标是跑通基础能力，并且把未来升级的接口留出来。

## 后续可以怎么升级

## 1. LLM 结构化记忆抽取

把当前规则抽取升级为 LLM JSON 输出：

index.json

```json
[
  {
    "type": "偏好",
    "content": "用户喜欢轻松、直接、不绕弯的聊天方式",
    "importance": 4
  }
]
```

这样可以更准确地区分偏好、事实、边界和重要事件。

这一步升级以后，记忆质量会明显提高。规则抽取只能看关键词，LLM 结构化抽取可以理解上下文，也能把一句比较口语化的话整理成更稳定的记忆内容。不过这类能力要配合重试、JSON 校验和异常兜底，否则模型输出格式不稳定时会影响写入。

## 2. 记忆确认机制

现在记忆会自动写入 active。后续可以增加 `pending` 状态，让用户确认后再进入长期记忆。

index.txt

```txt
pending -> active
pending -> deleted
active -> disabled
```

这会让记忆系统更可控，也更符合隐私预期。

确认机制适合在产品进一步成熟后加入。自动写入 active 很方便，但用户可能不希望系统自动记住某些内容。增加 pending 状态以后，系统可以先提出候选记忆，用户确认后再进入长期记忆。这样会牺牲一点自动化，但能换来更高的信任感。

## 3. 向量检索

当记忆数量变多以后，可以给 `agent_memories` 增加 embedding，并在聊天时按语义相关性检索。

向量检索适合解决记忆数量变多后的相关性问题。重要度高不代表和当前输入相关，更新时间近也不代表本轮一定需要。通过 embedding 找到语义上更接近当前输入的记忆，可以让 prompt 注入更精准。

最终 prompt 注入可以变成：

index.txt

```txt
高重要度长期记忆
+ 与当前输入语义相关的记忆
+ 最近消息
+ 会话摘要
```

## 4. 多会话

当前 `user_id + agent_id` 只有一个默认会话。后续可以让一个 Agent 支持多个 conversation，例如：

index.txt

```txt
日常聊天
关系复盘
角色故事线
学习陪伴
```

这时 `agent_conversations` 的唯一索引就需要调整，或者增加 `conversation_type`。

多会话会改变当前默认会话模型。现在 `user_id + agent_id` 唯一，代表一个用户和一个 Agent 只有一条默认 conversation。后续如果要支持多会话，就需要让用户选择当前会话，也要让消息、摘要和记忆之间的关系重新梳理。这个方向很有价值，但不适合和第一版记忆系统一起上线。

## 总结

这套 Agent 聊天记忆系统的关键不是某一个复杂算法，而是把聊天链路拆成稳定的几个部分。用户消息和 assistant 回复都要落库，打开 Agent 时要能从服务端恢复历史，更早上下文要能通过摘要压缩，稳定偏好和边界要能沉淀成长期记忆。记忆本身也不能是黑盒，用户需要能查看、编辑、停用和删除。

第一版先用 D1 落地，不引入向量库，不做复杂抽取，是一个务实选择。它让产品先具备「记得住」的基础能力，同时为后续 LLM 抽取、确认机制和向量检索留下了升级空间。

到这里，前端恢复和管理这一侧就串起来了。后端负责把历史、摘要和长期记忆保存好，前端负责把这些能力变成用户可见的聊天历史、最新消息预览和记忆管理页面。两边合在一起，Agent 才不只是当下能回复，而是能在一次次对话之间积累上下文。
