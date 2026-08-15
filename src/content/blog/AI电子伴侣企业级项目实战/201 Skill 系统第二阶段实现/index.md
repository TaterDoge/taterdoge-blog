---
title: "201 Skill 系统第二阶段实现"
pubDate: 2026-07-26
description: "第一阶段已经完成了最小 Prompt Skill 闭环。我们用 Manifest 描述 Skill，把可信的内置能力注册到静态 Registry，再由确定性的 Selector 保证单轮最多选择一个 。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/66-agent-skill-system-stage-two/](https://aicompanion.usehook.cn/66-agent-skill-system-stage-two/)

## 第二阶段目标与约束

第一阶段已经完成了最小 Prompt Skill 闭环。我们用 Manifest 描述 Skill，把可信的内置能力注册到静态 Registry，再由确定性的 Selector 保证单轮最多选择一个 Skill，最终把过程指令注入单聊和群聊回复。

真正运行起来后，三个产品层面的缺口很快就会暴露出来。所有 Skill 只能沿用 Manifest 默认状态，用户无法针对自己、某个 Agent 或某个群聊单独配置；Skill 是否触发只存在于当前请求里，事后看不到实际命中情况；Selector 也没有固定评测样本，调整关键词或规则时，很难判断是否引入了回归。

所以第二阶段先不急着增加更多 Skill。我们要做的是给已有 Prompt Skill 补齐可配置、可观察、可评估的运行基础。

本阶段实现范围：

stage-two-scope.txt

```text
SkillBinding
  + SkillRun
  + 管理 API
  + Web 管理页
  + Selector 评测资产
  + 版本固定基础
```

范围也要提前说清楚：这一阶段仍然不实现 Workflow、Tool、Background、SkillSession，也不开放任何外部执行权限。

**不破坏现有聊天链路**

现有单聊已经具备安全、意图、情绪、关系阶段、回复策略、记忆和反馈机制；群聊已经使用 LangGraph 完成意图识别、Agent 选择、多人回复和质量检查。

第二阶段只在 Skill 选择前增加**有效候选解析**，并在选择后增加 Run 记录，不替换已有的理解与生成流程。

**Binding 只控制可用性**

Binding 负责回答：

NOTE

这个 Skill 在当前用户、Agent、群聊或会话中是否可用？

Binding 不负责判断用户当前是否需要该 Skill。是否触发仍然由 Selector 根据用户消息决定。

**Run 不保存用户原文**

第二阶段需要观察 Skill 是否被选择，但没有必要复制完整聊天内容。Run 只保存 Skill ID 与版本、触发方式、得分、选择原因和 Binding 来源，同时记录单聊或群聊 Scope，以及关联的 Agent、群聊、会话 ID。为了支持运行分析，它还会保留状态、耗时和时间戳。

用户消息原文、完整 Prompt、长期记忆和模型回复不会写入 `skill_runs`。

**群聊一条用户消息只创建一个 Run**

群聊可能一次选中多个 Agent。如果让每个 Agent 在构建回复时独立解析 Skill，同一条用户消息就会重复读取 Binding，同一个 Skill 也可能被记录多次，甚至让多个 Agent 得到不一致的解析结果。

因此第二阶段把群聊 Skill 解析提升到编排入口：先解析一次，再把同一个系统指令传给所有被选中的 Agent。

**可观测失败不阻断聊天**

Binding 查询属于实际行为配置，读取失败应该明确暴露；Run 写入只属于观测能力，不应该导致原本能够生成的回复失败。

因此 `SkillRun` 写入采用 best-effort：记录失败会输出服务端错误日志，但已经解析出的 Skill 仍然可以继续参与回复。

### 第二阶段架构

![第二阶段 Prompt Skill 运行时流程图](/images/aicompanion/66-agent-skill-system-stage-two/1.png)

第二阶段新增了两个明确边界。Binding Resolver 位于 Registry 和 Selector 之间，只向 Selector 提供当前允许使用的候选；Run Recorder 位于 Selector 之后，负责记录已经完成的 Prompt Skill 解析。这样一来，可用性判断与触发判断不会混在一起，运行记录也不会侵入原有回复生成过程。

## 契约与数据模型

### 共享契约

实现文件：

contract-files.txt

```text
packages/contracts/src/skill/skill.contract.ts
packages/contracts/src/index.ts
```

第一阶段已有 `Manifest`、`Scope`、`Kind` 和 `Selection`。第二阶段增加以下合同。

**触发方式**

skill-trigger.ts

```typescript
type CompanionSkillTrigger = 'explicit' | 'rule'
```

`explicit` 表示用户通过 `/skill-id` 或 `/skill skill-id` 显式启用，`rule` 表示 Selector 根据语义模式和关键词自动选择。

触发类型成为 Selection 的必要字段，Run 不再需要通过分数或原因反推触发来源。

**Binding Scope**

binding-scope.ts

```typescript
type CompanionSkillBindingScopeType =
  | 'user'
  | 'agent'
  | 'group'
  | 'conversation'
```

API 使用统一目标结构：

binding-target.ts

```typescript
type CompanionSkillBindingTarget = {
  scopeType: CompanionSkillBindingScopeType
  scopeId: string | null
}
```

用户 Scope 不接收客户端传入的 ID，由服务端绑定到登录用户；其他 Scope 必须提供 ID。

**Catalog Item**

管理页面不仅需要 Manifest，还需要知道当前有效状态来自哪里：

catalog-item.ts

```typescript
type CompanionSkillCatalogItem = {
  manifest: CompanionSkillManifest
  effectiveEnabled: boolean
  bindingSource: 'default' | 'user' | 'agent' | 'group' | 'conversation'
  overrideEnabled: boolean | null
}
```

这里的 `effectiveEnabled` 是应用完整继承规则后的最终状态，`bindingSource` 指向实际生效的配置层级，`overrideEnabled` 则说明当前正在查看的 Scope 是否存在直接覆盖；当它为 `null` 时，表示继续继承上级配置。

**Binding 更新语义**

update-binding.ts

```typescript
type UpdateCompanionSkillBindingRequest = {
  target: CompanionSkillBindingTarget
  skillId: string
  enabled: boolean | null
}
```

`true` 表示在当前 Scope 明确启用，`false` 表示明确停用，`null` 则会删除当前 Scope 的覆盖，恢复上级继承。使用 `null` 表达**恢复继承**，可以避免把上级状态重复写入下级 Binding。

### D1 数据模型

迁移文件：

migration-file.txt

```text
apps/api/migrations/0017_skill_runtime.sql
```

Drizzle Schema：

schema-file.txt

```text
apps/api/src/db/schema.ts
```

**`skill_bindings`**

0017_skill_runtime.sql

```sql
CREATE TABLE skill_bindings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  skill_version TEXT,
  enabled INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
```

唯一索引：

binding-unique-index.txt

```text
user_id + scope_type + scope_id + skill_id
```

`scope_id` 有意设计为非空。SQLite 唯一索引允许多条 `NULL` 值，如果用户 Scope 使用 `NULL`，同一个用户和 Skill 可能产生多条全局配置。

服务端把用户 Scope 归一化为：

user-scope-normalization.txt

```text
scope_type = user
scope_id   = 当前登录用户 ID
```

客户端仍然使用 `{ scopeType: 'user', scopeId: null }`，不会接触这项存储细节。

**`skill_runs`**

0017_skill_runtime.sql

```sql
CREATE TABLE skill_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  skill_version TEXT NOT NULL,
  chat_scope TEXT NOT NULL,
  binding_source TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  score INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  agent_id TEXT,
  group_chat_id TEXT,
  conversation_id TEXT,
  latency_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER
);
```

索引先服务最常见的两个查询：一类是获取用户最近的运行记录，另一类是获取用户某个 Skill 的历史运行。

## 运行时基础设施

### Repository 与 Registry

实现文件：

repository-file.txt

```text
apps/api/src/skills/repository.ts
```

Repository 把 D1/Drizzle 细节与运行时逻辑隔开。Binding 的查询、写入和删除分别由 `listSkillBindingsForUser`、`upsertSkillBinding`、`deleteSkillBinding` 负责；`findOwnedConversationSkillContext` 用来查找属于当前用户的会话上下文；Run 则通过 `insertSkillRun` 写入，再由 `listSkillRunsForUser` 查询。

**Upsert**

Binding 使用复合唯一索引执行 `onConflictDoUpdate`。同一用户、Scope、目标和 Skill 始终只有一条记录。

发生更新时，原 ID 和创建时间保持不变，只改写 Skill 版本、Enabled 状态和 Updated 时间。

**Conversation 所有权**

Conversation Binding 不能只信任客户端提供的 `conversationId`。Repository 会同时按 `conversation_id` 和 `user_id` 查询，并返回对应 `agentId`，用于构建：

conversation-inheritance.txt

```text
conversation > agent > user
```

继承链。

**版本化 Registry**

实现文件：

registry-file.txt

```text
apps/api/src/skills/core/registry.ts
```

第一阶段 Registry 使用：

registry-stage-one.txt

```text
Map<skillId, definition>
```

第二阶段调整为：

registry-stage-two.txt

```text
Map<skillId, Map<version, definition>>
```

调整之后，重复检查不再只看 Skill ID，而是检查 `skillId + version`。`getPromptSkill(skillId, version?)` 可以获取指定版本；没有传版本时，则按照语义化版本选择最新定义。与此同时，`listPromptSkillVersions` 为以后的版本管理 API 留出了入口，Catalog 默认仍然展示当前最新版本。

当前四个内置 Skill 都只有 `1.0.0`。Registry 已经能够保留多个不可变版本，但管理页没有展示不存在的旧版本，也没有提供虚假的回滚操作。

未来发布 `1.1.0` 时，应保留 `1.0.0` 定义；旧 Binding 可以继续固定 `1.0.0`，新 Binding 再使用 `1.1.0`。

### Binding Resolver

实现文件：

binding-resolver-file.txt

```text
apps/api/src/skills/core/bindings.ts
```

Binding Resolver 接收当前聊天 Scope、当前用户的全部 Binding，以及一条已经按优先级排好的目标链。

输出：

binding-resolution.ts

```typescript
{
  availableSkillIds: string[]
  availableSkillVersions: Record<string, string>
  bindingSources: Record<string, BindingSource>
}
```

**单聊继承**

single-chat-inheritance.txt

```text
conversation > agent > user > Manifest.enabledByDefault
```

示例：

binding-example.txt

```text
Manifest: goal-breakdown = enabled
User:     goal-breakdown = disabled
Agent A:  goal-breakdown = enabled
```

解析后，与 Agent A 单聊时会启用该 Skill，来源是 `agent`；与其他 Agent 单聊时则会停用，来源是 `user`。同一份用户级配置，可以被更具体的 Agent 配置覆盖，但不会影响其他 Agent。

**群聊继承**

group-chat-inheritance.txt

```text
group > user > Manifest.enabledByDefault
```

Agent Scope 不参与群聊继承。Agent 在群聊中仍然保留自己的人格和记忆，但 Skill 是否允许执行由群聊和用户配置决定。

**版本可用性**

如果 Binding 固定了一个 Registry 中不存在的版本，Resolver 不会悄悄升级到最新版本，而是把该 Skill 从有效候选中移除。

这比自动升级更保守：缺少旧实现应该被明确发现，而不是让进行中的行为无提示改变。

### Selector 与 Prompt Runtime

实现文件：

selector-file.txt

```text
apps/api/src/skills/core/selector.ts
```

Selector 新增两个可选输入：

selector-input.ts

```typescript
availableSkillIds?: readonly string[]
availableSkillVersions?: Record<string, string>
```

没有传入候选集时，Selector 仍按 Manifest 默认状态工作，便于纯函数评测和独立调用。

传入候选集后，自动规则只会在候选集中评分，显式 `/skill-id` 也必须位于候选集。指定版本必须能够从 Registry 获取，场景 Scope 也仍然需要匹配。

因此显式命令只改变触发优先级，不能绕过用户停用、场景限制或版本限制。

Selection 同时增加：

skill-selection.ts

```typescript
trigger: 'explicit' | 'rule'
```

**Prompt Runtime**

实现文件：

runtime-file.txt

```text
apps/api/src/skills/core/runtime.ts
```

新增统一入口：

runtime.ts

```typescript
resolveConfiguredPromptSkill({
  db,
  userId,
  scope,
  userText,
  targets,
  agentId,
  groupChatId,
  conversationId,
})
```

执行顺序：

- 读取当前用户 Binding。

- 解析有效 Skill ID、版本和来源。

- 调用纯函数 `resolvePromptSkill`。

- 没有选择结果时直接返回空指令。

- 有选择结果时创建一个 `SkillRun`。

- 返回系统指令、Selection、Binding 来源和 Run ID。

Prompt Skill 在完成选择和指令构造后就视为执行完成。Run 的 `completed` 表示 Skill 过程指令已经成功准备，不代表上游聊天模型一定生成成功。

## 管理 API 与聊天接入

### 管理 API

实现文件：

management-api-files.txt

```text
apps/api/src/routes/skill/management.route.ts
apps/api/src/routes/index.ts
```

路由前缀：

api-prefix.txt

```text
/rpc/skills
```

**获取 Catalog**

catalog.http

```http
GET /rpc/skills/catalog?scopeType=user
GET /rpc/skills/catalog?scopeType=agent&scopeId=agent-id
GET /rpc/skills/catalog?scopeType=group&scopeId=group-id
GET /rpc/skills/catalog?scopeType=conversation&scopeId=conversation-id
```

服务端会按下面的顺序处理请求：

- 验证 Access Token。

- 校验 Target 结构。

- 验证 Agent、群聊或会话所有权。

- 构造继承链。

- 返回当前 Scope 适用的 Catalog。

Agent 和 Conversation 只返回支持 `single_chat` 的 Skill；Group 只返回支持 `group_chat` 的 Skill；User 返回全部内置 Skill。

**更新 Binding**

binding.http

```http
PATCH /rpc/skills/binding
```

请求示例：

binding-request.json

```json
{
  "target": {
    "scopeType": "agent",
    "scopeId": "agent-id"
  },
  "skillId": "goal-breakdown",
  "enabled": true
}
```

恢复继承：

inherit-request.json

```json
{
  "target": {
    "scopeType": "agent",
    "scopeId": "agent-id"
  },
  "skillId": "goal-breakdown",
  "enabled": null
}
```

API 会验证 Skill 是否存在、是否支持当前 Scope，并固定当前定义版本。

**查询 Run**

runs.http

```http
GET /rpc/skills/runs?limit=30
```

最多返回 100 条当前用户记录。API 会用 Registry 补充 Skill 展示名称，但历史记录仍保留原始 ID 和版本。

**评测摘要**

evaluations.http

```http
GET /rpc/skills/evaluations/summary
```

API 运行纯函数评估器，只返回总数、通过数、失败数和通过率，不把所有案例细节发送到 Web。

### 单聊与群聊接入

实现文件：

inbox-route-file.txt

```text
apps/api/src/routes/chat/inbox.route.ts
```

第一阶段在安全边界响应之后同步调用 `resolvePromptSkill`。第二阶段替换为异步的 `resolveConfiguredPromptSkill`。

目标链由已验证的会话和 Agent 构造：

inbox-targets.ts

```typescript
[
  { scopeType: 'conversation', scopeId: ownedConversationId },
  { scopeType: 'agent', scopeId: agentId },
  { scopeType: 'user', scopeId: userId },
]
```

只有通过所有权验证的 `ownedConversation` 才会进入继承链，客户端提供的任意 Conversation ID 不会直接获得配置权限。

安全边界响应依然在 Skill 解析前返回，所以危机支持、拒绝或重定向不会创建 SkillRun。

普通回复中的提示顺序保持不变：

prompt-order.txt

```text
安全与角色
  -> 意图、情绪、关系阶段
  -> 回复策略
  -> Skill 指令
  -> 反馈、记忆和摘要
```

**群聊接入**

实现文件：

group-route-file.txt

```text
apps/api/src/routes/chat/group.route.ts
```

群聊在用户消息入库后、加载 Agent 记忆和执行 LangGraph 前解析 Skill：

group-skill.ts

```typescript
const promptSkill = await resolveConfiguredPromptSkill({
  scope: 'group_chat',
  targets: [
    { scopeType: 'group', scopeId: groupChatId },
    { scopeType: 'user', scopeId: userId },
  ],
})
```

LangGraph State 新增：

group-state.ts

```typescript
skillSystemInstruction: string
```

主流程、串行回复、并行回复和 fallback 回复都从 State 获取同一指令。`buildAgentReply` 不再自行调用 Selector。

经过这次调整，一条群聊消息只读取一次 Binding，最多选择一个 Skill，也最多创建一个 SkillRun。被选中的多个 Agent 会使用同一个过程目标，Agent 之间的简短交叉回复也不会重复执行 Skill。

Agent 消息 metadata 同时保存 `skillRunId`，便于以后把回复反馈与 Run 关联。

## 评测与管理页面

### Selector 评测

实现文件：

evaluation-files.txt

```text
apps/api/src/skills/evaluations/selector-cases.ts
apps/api/src/skills/evaluations/evaluate-selector.ts
```

案例使用纯数据结构：

selector-case.ts

```typescript
type PromptSkillSelectorCase = {
  name: string
  scope: 'single_chat' | 'group_chat'
  userText: string
  expectedSkillId: string | null
  availableSkillIds?: readonly string[]
}
```

案例要覆盖显式触发、自动触发和不应触发三类情况。显式触发同时检查 `/skill-id` 与 `/skill skill-id`，还要验证不在候选集中的 Skill 即使被显式指定也不能启用。自动触发覆盖四个内置 Skill 的典型正例，以及群聊 Skill 在单聊中的场景限制。负例包括普通闲聊、只有一个弱关键词、出现群聊词汇但没有圆桌意图，以及空输入。

评估器逐条执行 Selector，返回：

selector-evaluation.ts

```typescript
{
  total: number
  passed: number
  failed: number
  passRate: number
  results: Array<{
    name: string
    expectedSkillId: string | null
    actualSkillId: string | null
    passed: boolean
  }>
}
```

当前项目还没有统一测试框架，所以这里先把案例和执行器写成纯函数，不依赖数据库、网络和模型。以后接入测试或 CI 时，可以直接复用这批评测资产。

### Web 管理页

实现文件：

web-files.txt

```text
apps/web/app/(dashboard)/skills/page.tsx
apps/web/app/(dashboard)/_components/app-sidebar.tsx
apps/web/src/auth/api.ts
```

Dashboard 新增 `/skills` 页面和侧边栏入口。

**Scope 选择**

页面打开后，需要同时加载当前用户的全部 Agent、全部群聊、当前 Scope 的 Skill Catalog、最近 SkillRun 和 Selector 评测摘要。Scope 下拉框提供三个层次的入口：全部聊天、每个单聊 Agent，以及每个 Agent 群聊。

Conversation Binding 已由 API 支持，但当前系统每个 Agent 只有一个默认会话，因此页面没有重复展示 Conversation 选项。未来支持多个会话后可以直接增加。

**Skill 列表**

每个 Skill 都会展示名称、版本、能力描述和适用范围。配置部分除了当前有效状态，还会标明状态来源，以及当前 Scope 是否存在直接覆盖，用户不需要自己反推继承结果。

Switch 写入当前 Scope 覆盖；存在直接覆盖时，提供恢复继承按钮。

**运行记录**

页面右侧显示最近 Run，其中包括 Skill 名称、发生时间和选择原因，也会区分显式启用与规则命中、单聊与群聊，并给出解析耗时。

页面不会展示或请求用户消息原文。

### 文件结构与请求示例

skill.contract.tsSkill 共享契约0017_skill_runtime.sql第二阶段数据库迁移schema.tsDrizzle Schemaindex.ts路由入口inbox.route.ts单聊接入group.route.ts群聊接入management.route.tsSkill 管理 APIrepository.tsBinding 与 Run 数据访问bindings.tsBinding Resolverregistry.ts版本化 Registryselector.tsSkill 选择器prompt.tsPrompt 构造runtime.ts统一 Prompt Runtimeselector-cases.tsSelector 评测案例evaluate-selector.ts纯函数评估器api.tsSkill 管理请求app-sidebar.tsx侧边栏入口page.tsxSkill 管理页

**一次完整请求示例**

假设配置为：

request-binding-example.txt

```text
Manifest: decision-clarifier 默认启用
User:     decision-clarifier 停用
Agent A:  decision-clarifier 启用
```

用户在 Agent A 单聊中发送：

request-user-message.txt

```text
两个工作机会我都喜欢，不知道怎么选。
```

我们顺着一次完整请求来看执行过程：

- 安全分析允许正常回复。

- Binding Resolver 按 `conversation > agent > user > default` 查找。

- Agent A Binding 首先命中，Skill 有效状态为启用，来源为 `agent`。

- Selector 命中决策模式和关键词，选择 `decision-clarifier@1.0.0`。

- Prompt Runtime 生成决策澄清内部指令。

- Run Recorder 写入：

skill-run.json

```json
{
  "skillId": "decision-clarifier",
  "skillVersion": "1.0.0",
  "chatScope": "single_chat",
  "bindingSource": "agent",
  "trigger": "rule",
  "status": "completed"
}
```

- Skill 指令与 Agent 人格、回复策略和记忆共同参与模型生成。

- 其他 Agent 仍继承用户级停用，不会触发该 Skill。

## 迁移、验证与衔接

### 迁移与验证

本地环境需要应用：

migrate-local.bash

```shellscript
pnpm --filter @repo/api db:migrate:local
```

测试和生产环境应使用对应 Wrangler 环境应用同一迁移。迁移必须先于包含第二阶段 API 的服务版本发布，否则 Catalog 和聊天中的 Binding 查询会因为表不存在而失败。

**手工验证**

根据仓库 `AGENTS.md` 约定，实现过程中没有自动运行迁移、测试、构建、开发服务器或浏览器检查。建议手工验证：

- 应用 `0017_skill_runtime.sql`。

- 打开 `/skills`，确认展示 4 个内置 Skill。

- 在全局 Scope 停用**目标拆解**。

- 发送**帮我制定一个学习计划**，确认没有新增目标拆解 Run。

- 切换到某个 Agent，重新启用**目标拆解**。

- 对该 Agent 发送同类消息，确认出现来源为 Agent 的 Run。

- 点击恢复继承，确认状态重新跟随全局设置。

- 在某个群聊停用**群聊圆桌**，确认**大家分别怎么看**不再触发。

- 输入 `/decision-clarifier ...`，确认 Run 显示显式触发和得分 100。

- 触发原有安全边界响应，确认不会新增 SkillRun。

- 刷新页面，确认 Binding 状态仍然存在。

**当前限制**

现在每个内置 Skill 只有 `1.0.0`，用户还没有旧版本可选；Selector 仍然采用规则路由，没有对候选集做语义判定；评测资产也尚未接入 CI，SkillRun 还不能自动关联单聊回复反馈。

执行能力同样停留在 Prompt Skill 范围内。系统没有 SkillSession，无法保存多轮任务状态，也没有统一的 Workflow Executor。Tool 所需的权限、审批和审计，以及 Background 所需的调度、重试和取消，都还没有进入这一阶段。

**第三阶段衔接**

走到这里，第三阶段需要的基础已经基本齐了。Binding 可以决定 Workflow Skill 在哪些范围可用，Versioned Registry 可以固定 Workflow 的实现版本，SkillRun 也能记录一次工作流执行。管理 API 和页面可以沿用现有结构展示 Session 状态，Conversation、Agent、Group 三类作用域也已经统一。

第三阶段建议新增：

stage-three-scope.txt

```text
SkillSession
  + SkillExecutor
  + PromptSkillRunner
  + WorkflowSkillRunner
  + LangGraph 子图
  + 状态恢复、取消、过期和并发控制
```

第一个 Workflow Skill 可以从不依赖外部高权限工具、但确实需要多轮状态的场景入手，例如**长期目标规划**或**关系复盘**。这样先验证 Session 和 Executor，确认运行模型稳定之后，再进入 Tool 与 Background 阶段。

## 总结

第二阶段没有继续增加 Skill 数量，而是把已有 Prompt Skill 真正接进了可管理的运行环境。Binding 负责控制当前 Scope 中哪些 Skill 可用，Selector 只在有效候选中做选择，Run Recorder 再用 best-effort 方式留下记录。即使观测写入失败，聊天本身也不会被阻断。

有了 D1 数据模型、版本化 Registry、管理 API、Web 页面和 Selector 评测，我们既能调整配置，也能看到实际命中情况，还能在修改规则后检查回归。单聊和群聊已经接入同一套运行边界，完成迁移与手工验证后，就可以继续实现 SkillSession、统一 Executor、Workflow Runner 和 LangGraph 子图。
