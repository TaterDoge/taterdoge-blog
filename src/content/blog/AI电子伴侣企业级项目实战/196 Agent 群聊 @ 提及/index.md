---
title: "196 Agent 群聊 @ 提及"
pubDate: 2026-07-26
description: "这一篇我们把 Agent 群聊里的 @ 提及功能梳理一下。这个功能看起来只是输入框里的一个小交互，但它其实牵着前端输入、乐观消息、服务端调度和 LangGraph 选择结果。用户键入 @ 时，输入框要。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-07-26
---
原文链接：[https://aicompanion.usehook.cn/61-agent-group-chat-mentions/](https://aicompanion.usehook.cn/61-agent-group-chat-mentions/)

## 目标与设计原则

Agent 群聊 `@` 提及功能实现记录

这一篇我们把 Agent 群聊里的 `@` 提及功能梳理一下。这个功能看起来只是输入框里的一个小交互，但它其实牵着前端输入、乐观消息、服务端调度和 LangGraph 选择结果。用户键入 `@` 时，输入框要能自动列出当前群内 Agent；继续输入昵称或简介时，候选项要能跟着筛选；候选项既要支持鼠标选择，也要支持键盘选择。选中之后，我们写入消息正文的是 `@昵称`，而不是只在前端显示一个临时标签。消息发送后，服务端必须优先选择被 `@` 的 Agent 回复，不能被后面的智能调度结果覆盖。

改动主要落在两个文件：

index.txt

```txt
apps/web/app/(dashboard)/group-chats/page.tsx
apps/api/src/routes/chat/group.route.ts
```

`@` 功能不能只做成输入框的视觉补全。群聊服务端会根据群成员、人设、上下文、用户情绪和最近发言频率调度回复者；如果提及信息只存在于前端状态中，发送请求后服务端就无法确定用户明确点名了谁。

因此我们采用文本兼容方案：选择成员后直接写入 `@昵称 `。这样消息历史、乐观消息、接口请求和服务端调度都使用同一份文本，不需要修改现有的群聊消息契约。

## 前端提及输入

提及只应该在光标前的最后一个独立 `@` 片段生效，避免把邮件地址或消息中较早的 `@` 误认为当前提及。

index.ts

```typescript
type MentionContext = {
  start: number
  end: number
  query: string
}

function getMentionContext(value: string, cursor: number): MentionContext | null {
  const beforeCursor = value.slice(0, cursor)
  const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/)

  if (!match) {
    return null
  }

  const query = match[2] ?? ""

  return {
    start: cursor - query.length - 1,
    end: cursor,
    query,
  }
}
```

这个判断要求 `@` 位于文本开头或空白符之后，因此 `name@example.com` 不会打开成员菜单。

页面里增加两个状态，用来保存当前提及范围和候选选中位置：

index.ts

```typescript
const [mentionContext, setMentionContext] = useState<MentionContext | null>(null)
const [mentionIndex, setMentionIndex] = useState(0)
```

在输入变化时，使用当前 textarea 的 `selectionStart` 重新计算提及范围。

index.ts

```typescript
function updateDraftMessage(value: string, cursor: number) {
  setDraftMessage(value)
  setMentionContext(getMentionContext(value, cursor))
  setMentionIndex(0)
}
```

候选集合来自 `currentMembers`，也就是当前群聊详情或群聊列表中已有的成员。只输入 `@` 时展示全体成员；继续输入 `@小` 时，再按昵称和简介过滤。

index.ts

```typescript
const mentionCandidates = useMemo(() => {
  if (!mentionContext) {
    return []
  }

  const query = mentionContext.query.trim().toLowerCase()

  return currentMembers.filter((member) => {
    if (!query) {
      return true
    }

    return [member.name, member.headline ?? ""].some((value) => value.toLowerCase().includes(query))
  })
}, [currentMembers, mentionContext])
```

## 插入与交互

选中候选项时，只替换当前的 `@查询词` 区间，保留消息前后内容，并自动追加空格。

index.ts

```typescript
function insertMention(member: AgentGroupChat["members"][number]) {
  if (!mentionContext) {
    return
  }

  setDraftMessage((current) => (
    `${current.slice(0, mentionContext.start)}@${member.name} ${current.slice(mentionContext.end)}`
  ))
  setMentionContext(null)
  setMentionIndex(0)
}
```

这种方式可以处理一条消息中的多个提及。比如输入 `@小明 帮我问问 @小红` 时，每次只替换当前光标正在编辑的那一个提及片段。

候选菜单作为 `PromptInput` 内的绝对定位浮层显示在输入区上方。候选项里会展示头像、昵称、简介，以及将要插入的 `@昵称` 文本。

输入框的键盘交互保持这几条规则：

| 按键 | 行为 |
| --- | --- |
| ArrowDown | 选中下一名成员 |
| ArrowUp | 选中上一名成员 |
| Enter | 插入当前成员，而不是发送消息 |
| Tab | 插入当前成员 |
| Escape | 关闭候选菜单 |

只有在提及菜单打开且存在候选项时，`Enter` 才被菜单消费；其他正常输入状态仍由 `PromptInputTextarea` 处理发送行为。

鼠标候选项在 `onMouseDown` 中调用 `preventDefault()`，确保点击时 textarea 不丢失焦点，然后由 `onClick` 插入成员。

切换群聊、点击快捷提示、提交消息、按下 `Escape` 时，都会关闭提及菜单。这样可以避免旧浮层还停留在页面上，但草稿内容已经变了。

## 服务端提及识别

服务端新增 `findExplicitlyMentionedAgents`，它只识别 `@昵称`，并要求昵称后面是空白、标点或文本结尾。

index.ts

```typescript
function findExplicitlyMentionedAgents(agents: AgentGroupChatAgentRecord[], userText: string) {
  return agents.filter((agent) => {
    const escapedName = agent.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const mentionPattern = new RegExp(`@${escapedName}(?=\\s|[,.!?，。！？、]|$)`, 'i')

    return mentionPattern.test(userText)
  })
}
```

转义昵称是必要的。昵称可能包含括号、加号等正则特殊字符，不能直接拼到正则表达式中。

原有 `selectAgentsForReply` 会根据昵称出现、群聊意图和上下文进行回退选择。现在先检查显式提及：

index.ts

```typescript
const explicitlyMentionedAgents = findExplicitlyMentionedAgents(params.agents, params.userText)

if (explicitlyMentionedAgents.length > 0) {
  return explicitlyMentionedAgents.slice(0, groupReplyAgentLimit)
}
```

这样可以保证 LangGraph 编排失败时，用户点名仍然有效。

## 调度覆盖

只修改回退逻辑还不够。正常流程会调用 LangGraph 选择 Agent，它可能基于情绪、关系和最近发言频率选择了其他成员。因此在 `selectGroupAgentsNode` 中，在调用模型调度前直接处理显式提及：

index.ts

```typescript
const explicitlyMentionedAgents = findExplicitlyMentionedAgents(state.agents, state.userText)

if (explicitlyMentionedAgents.length > 0) {
  const selection = GroupChatAgentSelectionSchema.parse({
    selectedAgentIds: explicitlyMentionedAgents.slice(0, groupReplyAgentLimit).map((agent) => agent.id),
    mode: explicitlyMentionedAgents.length > 1 ? 'multi_serial' : 'single',
    reason: '用户在消息中显式提及了 Agent。',
  })

  return {
    intent,
    speakingContext,
    selection,
    selectedAgents: explicitlyMentionedAgents.slice(0, groupReplyAgentLimit),
  }
}
```

这样处理以后，不提及任何成员时，仍然保留原有智能调度；提及一名成员时，该成员单独优先回复；提及多名成员时，按消息中匹配的群成员顺序选择，最多遵循现有 `groupReplyAgentLimit`。

## 兼容边界

这个方案不需要给 `SendAgentGroupChatMessageRequest` 新增字段，因为 `message` 文本已经携带提及信息。乐观消息、消息持久化、历史消息和群聊预览也会自然保留 `@昵称` 文本。

手动输入 `@昵称` 同样能被服务端识别，不依赖前端候选菜单。成员被移出群聊后，不会再出现在候选列表，也不会成为服务端可选择对象。无匹配成员时，前端仍然保留用户输入，并显示 **没有匹配的群成员**。

### 验证建议

可以按这些场景验证：

- 输入 `@`，确认显示群内所有成员。

- 输入 `@昵称片段`，确认候选项实时过滤。

- 分别使用鼠标、方向键加回车、方向键加 Tab 选择成员。

- 连续提及两名成员，确认两个 `@昵称` 都被正确插入。

- 发送 `@某成员 你怎么看？`，确认该成员参与本轮回复。

- 发送不含 `@` 的普通消息，确认仍由原有调度策略决定回复者。

- 点击**加载更早消息**、切换群聊和发送消息后，确认提及浮层不会残留。

## 总结

`@` 提及看起来是一个输入框体验，但真正要解决的是前端选择和服务端调度之间的一致性。选择成员后直接写入 `@昵称`，可以让消息文本、乐观更新、历史记录和服务端调度共享同一份信息。

服务端再通过显式提及识别和 LangGraph 调度前置覆盖，保证用户点名的 Agent 一定优先回复。这样既保留了原有智能调度，也让用户的明确意图不会被模型选择结果冲掉。
