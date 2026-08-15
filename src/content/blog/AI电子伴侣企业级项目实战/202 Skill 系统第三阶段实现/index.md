---
title: "202 Skill 系统第三阶段实现"
pubDate: 2026-07-26
description: "第一阶段解决了 Prompt Skill 的定义、选择与注入；第二阶段增加了 Binding、版本、Run、评测和管理页面。前两阶段中的 Skill 都是单轮能力，每一轮只生成一段过程指令，不保存独立。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/67-agent-skill-system-stage-three/](https://aicompanion.usehook.cn/67-agent-skill-system-stage-three/)

## 第三阶段目标与设计

第一阶段解决了 Prompt Skill 的定义、选择与注入；第二阶段增加了 Binding、版本、Run、评测和管理页面。前两阶段中的 Skill 都是单轮能力，每一轮只生成一段过程指令，不保存独立任务状态。

第三阶段要解决的问题是：

NOTE

一个需要多轮收集信息和逐步推进的任务，如何在聊天请求之间可靠恢复？

这一阶段需要先把 `SkillSession` 持久化，再引入统一的 `SkillExecutor`，并在执行器下面区分 `PromptSkillRunner` 与 `WorkflowSkillRunner`。Workflow 一侧会补上 Registry、Selector 和独立的 LangGraph 子图，请求链路则要处理消息重试幂等，以及 Session 的恢复、取消、过期和乐观并发控制。为了让这些能力能够被观察和管理，我们还会增加 Session 管理 API、Web 管理界面，并实现第一个 Workflow Skill：长期目标规划。

本阶段仍然不授予 Skill 外部工具、后台调度、支付、删除或第三方写入权限。

### 为什么选择长期目标规划

选择首个 Workflow 时，我们可以先确定几个条件。这个任务确实需要多轮状态，不能合理压缩成一轮 Prompt；推进步骤要明确、稳定并且可以评测；执行过程不能依赖外部高权限工具。它还要适合多个不同人格的电子伴侣复用，最终结果则继续由当前 Agent 用自己的语气表达。

长期目标规划需要依次确认：

planning-steps.txt

```text
目标
  -> 周期
  -> 现实约束
  -> 可观察的完成标准
  -> 阶段计划
```

它能够验证 Session 和 Executor 的核心能力，又不会提前引入日历、通知或外部写操作。

**Workflow 状态与聊天历史分离**

聊天历史描述双方说了什么，Workflow State 描述任务已经推进到哪里。如果只依赖重新阅读聊天历史恢复任务，历史越长，恢复成本就越高；模型也可能对相同历史推断出不同步骤，更无法可靠支持取消、过期和并发更新。

因此第三阶段使用结构化 `state_json + current_step` 保存任务状态。

**LangGraph 负责状态迁移，模型负责表达**

长期目标规划的 LangGraph 节点是确定性的。它先吸收当前用户的回答，再计算下一个缺失字段，最后构造本轮过程指令。

LangGraph 不调用聊天模型，也不自行生成最终回复。当前 Agent 的主模型继续负责自然确认、提出问题和生成最终计划。

这种分工让流程可恢复、可评测，同时保留 Agent 人格。

**活动 Session 优先**

统一 Executor 的处理顺序为：

executor-priority.txt

```text
重复消息恢复
  -> 活动 Session 继续或取消
  -> 新 Workflow 选择
  -> Prompt Skill 选择
  -> 不启用 Skill
```

如果活动 Workflow 不优先，用户回答**每天一小时**时，Selector 无法知道它是在回答规划约束，任务会被普通聊天覆盖。

**一个聊天 Scope 同时只允许一个活动 Workflow**

数据库使用部分唯一索引限制：

active-session-index.txt

```text
user_id + scope_type + scope_id
WHERE status IN ('active', 'waiting_user')
```

同一个会话中不能同时有两个 Workflow 等待用户回答。这样可以避免下一条消息无法判断属于哪个任务。

**活动 Session 固定版本**

Session 创建时保存 `skill_id + skill_version`。后续每一步都从 Workflow Registry 加载同一版本，系统升级不会改变进行中任务的状态结构。

## 请求流程与共享契约

### 请求总流程

![第三阶段 Skill 请求流程图](/images/aicompanion/67-agent-skill-system-stage-three/1.png)

### 契约与数据模型

实现位置：

skill-contract-file.txt

```text
packages/contracts/src/skill/skill.contract.ts
```

**Selection 增加 Kind**

skill-selection.ts

```typescript
type CompanionSkillSelection = {
  skillId: string
  skillVersion: string
  skillKind: 'prompt' | 'workflow' | 'tool' | 'background'
  trigger: 'explicit' | 'rule' | 'session'
  score: number
  reason: string
}
```

`session` 表示本轮不是重新通过规则触发，而是在继续已有 Workflow。

**Session 状态**

session-statuses.txt

```text
active
waiting_user
completed
cancelled
expired
failed
```

当前 Workflow 在持久化时主要使用五种状态。`waiting_user` 表示正在等待下一轮回答，`completed` 表示已经收集完整信息并生成最终计划指令，`cancelled` 表示用户主动终止。超过 TTL 后，Session 会进入 `expired`；如果出现版本缺失、状态损坏或运行异常，则会进入 `failed`。

**Run 扩展**

`SkillRun` 会增加 `skillKind` 和 `sessionId`，运行状态也扩展为支持 `waiting_user`、`cancelled`、`expired` 等值。

Prompt Run 的 `sessionId` 为 `null`；Workflow 的每一步都关联同一个 Session。

**D1 数据迁移**

迁移文件：

migration-file.txt

```text
apps/api/migrations/0018_skill_workflow_sessions.sql
```

迁移先扩展 `skill_runs`：

0018_skill_workflow_sessions.sql

```sql
ALTER TABLE skill_runs ADD COLUMN skill_kind TEXT NOT NULL DEFAULT 'prompt';
ALTER TABLE skill_runs ADD COLUMN session_id TEXT;
```

旧 Run 会自动视为 `prompt`，不需要回填脚本。

新增 `skill_sessions` 主要字段：

| 字段 | 作用 |
| --- | --- |
| skill_id / skill_version | 固定 Workflow 实现 |
| chat_scope | 单聊或群聊 |
| binding_source | 创建时实际生效的 Binding 来源 |
| scope_type / scope_id | Session 所属会话范围 |
| status | 生命周期状态 |
| current_step | 当前 Workflow 步骤 |
| state_json | 结构化业务状态 |
| pending_question | 等待用户回答的问题 |
| last_source_message_id | 最近一次已处理消息，用于幂等 |
| last_system_instruction | 重试时复用的过程指令 |
| revision | 乐观并发版本 |
| expires_at_ms | Session TTL |

Session 状态可能包含用户目标和约束，因此 API 不向 Web 返回 `state_json` 或内部系统指令。

## Workflow 与执行器

### Workflow 定义与子图

新增类型：

workflow-definition.ts

```typescript
type WorkflowSkillDefinition = {
  manifest: CompanionSkillManifest & { kind: 'workflow' }
  sessionTtlMs: number
  initialStep: string
  matchers: SkillMatchers
  createInitialState: () => unknown
  parseState: (value: unknown) => unknown
  runTurn: (input: WorkflowTurnInput) => Promise<WorkflowTurnOutput>
}
```

实现位置：

workflow-registry-files.txt

```text
apps/api/src/skills/core/workflow-registry.ts
apps/api/src/skills/core/workflow-selector.ts
apps/api/src/skills/core/catalog.ts
```

Workflow Registry 与 Prompt Registry 都使用：

versioned-registry.txt

```text
Map<skillId, Map<version, definition>>
```

统一 Catalog 承担三项职责：防止不同运行类型使用重复 Skill ID，按 ID 和版本获取 Prompt 或 Workflow 定义，并向管理 API 返回统一的 Skill 列表。

**长期目标规划 Workflow**

实现目录：

index.tsWorkflow 定义入口workflow.tsLangGraph 状态迁移

Manifest：

workflow-manifest.txt

```text
id: long-term-goal-planning
version: 1.0.0
kind: workflow
scope: single_chat
ttl: 14 天
```

只有明确的长期规划表达才会自动触发，例如未来三个月、半年、年度目标或分阶段长期计划。普通的**帮我安排明天计划**仍然留给 Prompt Skill，不创建 Session。

显式命令：

workflow-commands.txt

```text
/long-term-goal-planning
/skill long-term-goal-planning
```

**LangGraph 子图**

Graph State：

long-term-goal-state.ts

```typescript
type LongTermGoalPlanningState = {
  goal: string | null
  horizon: string | null
  constraints: string | null
  successCriteria: string | null
  currentStep:
    | 'collect_goal'
    | 'collect_horizon'
    | 'collect_constraints'
    | 'collect_success_criteria'
    | 'build_plan'
}
```

节点：

workflow-graph.txt

```text
START
  -> absorbUserTurn
  -> resolveStep
  -> buildOutput
  -> END
```

**`absorbUserTurn`**

新 Session 会把初始消息作为目标，并尝试从文本中确定性提取**三个月、半年、一年**等周期。

已有 Session 根据 `currentStep` 把当前回答写入对应字段。

**`resolveStep`**

按固定顺序查找第一个缺失字段。没有让模型自由选择下一步，避免同一状态得到不同迁移结果。

**`buildOutput`**

如果仍然缺少字段，Session 状态返回 `waiting_user`，本轮只生成一个 `pendingQuestion`，同时要求 Agent 不要提前输出完整计划。

字段全部收集完成后，Session 状态返回 `completed`。此时指令要求 Agent 生成阶段里程碑、近期节奏、第一步、检查点和风险应对，并停止继续追问。

### Session Repository

实现位置：

session-repository-file.txt

```text
apps/api/src/skills/repository.ts
```

Repository 通过 `findActiveSkillSession` 查找活动任务，使用 `findProcessedSkillSessionTurn` 判断当前消息是否已经处理。Session 的创建和推进分别由 `createSkillSession`、`updateSkillSessionTurn` 完成，取消与失败则交给 `cancelSkillSession`、`failSkillSession`。管理页面需要查看任务时，再通过 `listSkillSessionsForUser` 获取当前用户的 Session。

**恢复**

每轮请求先按用户和 Scope 查找 `active / waiting_user` Session。找到后使用 Session 中固定的 Skill 版本恢复状态。

**消息重试幂等**

Session 保存最近的 `last_source_message_id` 和 `last_system_instruction`。

同一条聊天消息重试时，系统不会再次推进步骤，也不会重复写入 Run，而是直接复用上一次生成的过程指令。这就覆盖了聊天请求中最常见的**最新消息网络重试**场景。

**乐观并发**

每次更新必须匹配：

optimistic-lock.txt

```text
session_id + user_id + expected_revision + active status
```

成功后 `revision + 1`。两个并发请求只有一个能够更新，另一个会先检查是否属于同一消息重试，否则返回 `BIZ.CONFLICT`。

**惰性过期**

活动 Session 查询和列表查询前，会把：

session-expiration.txt

```text
expires_at_ms <= now
```

的活动记录更新为 `expired`。长期目标规划每次成功推进后重新获得 14 天 TTL。

不需要后台定时器，也不会让过期 Session 永久占用唯一活动槽位。

### Runner 与统一 Executor

实现位置：

runner-files.txt

```text
apps/api/src/skills/core/runners.ts
apps/api/src/skills/core/executor.ts
```

**PromptSkillRunner**

复用现有 Prompt Selector 和指令构造，不创建 Session。

**WorkflowSkillRunner**

`WorkflowSkillRunner` 先使用 Workflow 定义自己的 Schema 解析 State，再调用独立的 Workflow 子图，最后返回新的 State、步骤、状态、问题和系统指令。

Runner 不直接写数据库，持久化统一由 Executor 完成。

**Executor**

统一入口：

executor.ts

```typescript
executeConfiguredSkillTurn({
  db,
  userId,
  scope,
  userText,
  sourceMessageId,
  bindingTargets,
  sessionTarget,
})
```

Executor 先处理幂等恢复、活动 Session 查找和聊天取消指令，再解析 Binding 与固定版本。没有活动任务时，它会优先选择 Workflow，未命中后再回退到 Prompt Skill。Session 的创建与更新、Run 记录和并发冲突处理也统一收敛在这里。

**取消机制**

聊天中支持：

cancel-commands.txt

```text
/cancel-skill
/cancel-workflow
取消当前规划
停止这次目标规划
```

取消请求通过乐观锁更新 Session，并生成一条 `cancelled` Run。模型只会简短确认停止，不会继续追问，也不会暴露内部 Session 名称。

Skills 管理页也提供取消按钮。管理 API 同样验证当前用户所有权和活动状态，并写入取消 Run。

## 聊天接入与管理

### 接入与管理能力

**单聊接入**

单聊使用已经验证所有权的 Conversation 作为 Session Scope：

single-chat-session-scope.txt

```text
scope_type = conversation
scope_id   = conversation.id
```

如果没有持久化 Conversation，则回退到 Agent Scope。

用户消息入库生成的 ID 作为 `sourceMessageId`，用于幂等。

**群聊接入**

统一 Executor 已接入群聊入口，Group ID 作为 Session Scope。当前首个 Workflow 只支持单聊，因此群聊仍然执行 Prompt Skill。

这个接入为未来群聊 Workflow 保留了 Session、Run 和 metadata 能力，不需要再次修改主编排接口。

群聊 Agent 消息 metadata 增加：

group-message-metadata.txt

```text
skillRunId
skillSessionId
```

**Session 管理 API**

新增：

sessions.http

```http
GET  /rpc/skills/sessions?activeOnly=true&limit=20
POST /rpc/skills/sessions/:sessionId/cancel
```

Session 列表只返回管理页面真正需要的内容，包括 Skill 名称和版本、Scope、状态、当前步骤、等待问题与 Revision，同时给出创建、更新、过期、完成和取消时间。

不会返回 `state_json`、用户原始输入或内部系统指令。

**Web 管理页**

`/skills` 页面会增加 `long-term-goal-planning` Workflow 卡片，并使用**多轮 Workflow**标记区分运行类型。页面还会展示进行中的任务、Session 当前等待的问题和取消任务按钮，Run 记录中也会出现**Session 继续**这一触发来源。

取消成功后，页面同时刷新 Session 和 Run 查询。

## 评测与完整任务

### 评测资产

新增 Workflow Selector 样本：

workflow-selector-cases.txt

```text
apps/api/src/skills/evaluations/workflow-selector-cases.ts
```

这批样本会覆盖两种显式启用方式，并确认 Binding 候选为空时不能通过显式命令绕过限制。自动触发部分包含三个月、半年和年度规划正例，也包含短期普通计划负例，还会检查单聊 Workflow 在群聊中不可用。

新增状态迁移评测：

workflow-state-evaluation.txt

```text
apps/api/src/skills/evaluations/evaluate-long-term-goal-planning.ts
```

状态迁移评测会检查系统能否从初始消息中自动识别周期，能否依次进入约束收集和完成标准收集。字段完整后，状态应该进入 `build_plan / completed`；如果缺少周期，则应该进入 `collect_horizon`。

评测不依赖数据库、网络或模型调用。管理 API 的评测摘要现在同时包含 Prompt Selector、Workflow Selector 和 Workflow 状态迁移案例。

### 完整任务示例

第一轮：

workflow-turn-one.txt

```text
用户：帮我规划未来三个月的英语学习目标。
```

Workflow Selector 首先命中 `long-term-goal-planning`，State 保存用户目标并提取**三个月**。接着步骤进入 `collect_constraints`，系统创建 `waiting_user` Session 和 Run，再由 Agent 自然询问时间、预算或精力限制。

第二轮：

workflow-turn-two.txt

```text
用户：工作日每天最多一小时，周末可以多一些。
```

这一轮会恢复同一个 Session，把回答保存到 constraints，并执行 `revision + 1`。步骤随后进入 `collect_success_criteria`，同时写入一条触发类型为 `session` 的 Run。

第三轮：

workflow-turn-three.txt

```text
用户：三个月后可以完成一次二十分钟的英文分享。
```

系统保存完成标准后，Session 进入 `build_plan / completed`。Agent 根据完整的结构化信息生成阶段计划，完成之后的普通聊天也不会继续占用这个 Session。

## 迁移、边界与衔接

### 失败与边界

安全边界响应仍然早于 Skill Executor，因此不会创建或推进 Session。指定的 Workflow 版本不存在，或者 State 无法通过 Skill Schema 时，活动 Session 都会标记为 `failed`，并且不会自动升级版本。出现并发 Revision 冲突时，接口返回 409，不会覆盖较新的状态；Run 写入失败则只记录服务端错误，不会阻断已经成功执行的 Skill。

Session 创建之后，即使对应 Binding 被关闭，也不会暗中改变进行中任务固定的版本，用户仍然可以显式取消 Session。一个聊天 Scope 同时只能存在一个活动 Workflow，避免下一条回答的归属变得不清楚。

### 迁移与验证

本地环境需要按顺序应用第二、第三阶段迁移：

migrate-local.bash

```shellscript
pnpm --filter @repo/api db:migrate:local
```

生产或测试环境需要通过对应 Wrangler 环境应用 `0018_skill_workflow_sessions.sql`，并确保迁移先于新 API 服务版本发布。

根据仓库 `AGENTS.md` 约定，本次没有自动运行迁移、测试、构建、开发服务器或浏览器检查。建议手工验证：

- 应用 `0018_skill_workflow_sessions.sql`。

- 打开 `/skills`，确认出现**长期目标规划**和 Workflow 标记。

- 在单聊输入**帮我规划未来三个月的英语学习目标**。

- 确认 Agent 只询问现实约束，没有提前输出完整计划。

- 刷新页面或重新进入对话，再回答约束，确认 Session 能恢复。

- 提供完成标准，确认最终生成阶段计划并关闭活动 Session。

- 在任务进行中输入 `/cancel-skill`，确认停止继续追问。

- 新建另一个任务，在 `/skills` 的进行中任务区域点击取消。

- 重复提交同一个消息请求，确认步骤不会推进两次。

- 对同一 Session 并发提交不同回答，确认只允许一个 Revision 更新成功。

- 停用 Workflow，确认新的长期规划请求不创建 Session。

- 输入普通的**安排明天计划**，确认不会误触发长期 Workflow。

### 限制与第四阶段

**当前限制**

目前只有一个 Workflow Skill，并且长期目标规划只支持单聊。活动 Session 会把下一条普通消息当作当前步骤的回答，用户需要先取消才能退出任务。幂等机制也只保存最近一次消息 ID，还没有独立的 Session Event 历史表。

Workflow State 仍然保存在 D1 JSON 文本中，没有独立的迁移版本字段，也没有支持暂停后切换任务的 Session 栈。Tool 调用、外部副作用、后台调度和主动提醒同样不在当前实现范围内。

**第四阶段衔接**

第三阶段已经提供 Tool 与 Background Skill 所需的执行基础，但第四阶段不能直接让 Workflow 任意调用外部能力。

下一阶段应优先增加：

stage-four-scope.txt

```text
PermissionGrant
  + PolicyGate
  + Tool Registry
  + 输入输出 Schema
  + 超时与调用次数限制
  + 幂等键
  + 审批与审计
  + Background 调度、重试和取消
```

第一个 Tool Skill 应选择低风险、可撤销或只读能力，例如读取用户授权的日历空闲时间，而不是直接发送消息、支付、删除或公开发布。

## 总结

第三阶段把 Skill 从单轮 Prompt 指令推进到了可以跨请求恢复的 Workflow。结构化 Session 保存任务状态，LangGraph 负责确定性的状态迁移，当前 Agent 继续负责自然表达；统一 Executor 则把幂等恢复、活动任务、Binding、版本、Run 和并发控制收拢到同一条执行链路中。

长期目标规划验证了 Session 创建、继续、完成、取消与过期的完整生命周期。管理 API、Web 页面和评测资产也已经能够观察这条链路。接下来增加 Tool 与 Background Skill 时，需要先补齐权限、审批、审计和外部副作用控制，不能直接把现有 Workflow 扩展成任意工具调用器。
