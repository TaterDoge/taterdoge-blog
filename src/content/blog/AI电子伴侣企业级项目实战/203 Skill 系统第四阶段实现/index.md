---
title: "203 Skill 系统第四阶段实现"
pubDate: 2026-07-26
description: "前三阶段已经建立 Prompt、Workflow、Binding、Run、Session 和统一 Executor，但所有 Skill 仍然只能影响模型的回复过程，不能读取受保护数据，也不能离开当前请。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-07-26
---
原文链接：[https://aicompanion.usehook.cn/68-agent-skill-system-stage-four/](https://aicompanion.usehook.cn/68-agent-skill-system-stage-four/)

## 第四阶段目标与边界

前三阶段已经建立 Prompt、Workflow、Binding、Run、Session 和统一 Executor，但所有 Skill 仍然只能影响模型的回复过程，不能读取受保护数据，也不能离开当前请求执行任务。

第四阶段需要把两个问题解释清楚：Skill 如何在明确授权下调用受控工具，以及它如何离开当前聊天请求，可靠地执行后台任务。

为此，我们会先定义 Permission Requirement、Permission Grant 和风险等级契约，再让 PolicyGate 统一处理权限判断与审计。Tool 一侧增加版本化 Registry、Selector 和 Runner，并为输入输出 Schema、超时、调用次数上限与幂等记录建立约束；Background 一侧则增加版本化 Registry，以及基于 D1 的任务队列、租约、重试、取消和定时调度。

用户能够在 Skills 管理页控制权限和目标复盘提醒。系统也会落地首个 Tool Skill `memory-recall@1.0.0`、首个 Background Skill `goal-check-in-reminder@1.0.0`，并补上 Tool Selector 与 Background Payload 评测资产。

本阶段仍然不允许 Skill 执行任意代码、自由构造 SQL、访问任意 URL、支付、删除数据或向第三方系统写入。

**Skill 不能直接拥有基础设施**

如果给 Skill Definition 注入完整数据库或通用 HTTP Client，那么 Manifest 中的权限声明只是说明文字，无法形成真正的边界。一个实现错误或恶意 Skill 可以绕过声明，读取其他 Agent 数据或向外部系统发送内容。

因此第四阶段使用受控执行模型：

controlled-execution-model.txt

```text
Skill Definition
  -> 声明能力、权限、输入输出和限制
  -> Registry 只注册可信内置实现
  -> Selector 只负责判断是否需要
  -> PolicyGate 决定是否允许
  -> 专用 Runner 执行固定 Tool / Background Handler
  -> Repository 记录最小审计元数据
```

Tool Skill 不是一个可以动态填写 URL 或 SQL 的脚本。它只能引用代码中已经注册的 `toolId`，并通过固定 Handler 访问有限资源。

**为什么先做记忆检索**

记忆检索是一个只读操作，不会修改用户数据，数据边界也天然限定在当前用户和当前 Agent。检索结果可以直接作为当前回复的补充上下文，整个过程不依赖外部网络和第三方凭证，却足以验证权限、Schema、超时、审计与数据最小化。

它被定义为 L1 风险，需要持久授权 `memory:read`。

**为什么先做目标复盘**

目标复盘提醒可以验证一条完整的后台生命周期。用户主动创建任务并指定 Agent、执行时间和关注点，任务离开当前 HTTP 请求后执行。真正执行前，系统要重新检查权限和启用状态；发生失败时需要重试，执行前还要允许用户取消，最终结果则写入现有 Agent 会话。

它会产生用户可见写入，因此定义为 L2 风险，需要持久授权 `proactive_message:write`。

## 权限与策略模型

### 权限模型

Manifest 可以声明多个权限要求：

skill-permission-requirement.ts

```typescript
type CompanionSkillPermissionRequirement = {
  code: 'memory:read' | 'proactive_message:write'
  riskLevel: 'L0' | 'L1' | 'L2' | 'L3' | 'L4'
  approvalMode: 'none' | 'persistent' | 'per_operation'
}
```

当前风险语义：

| 等级 | 含义 | 当前示例 |
| --- | --- | --- |
| L0 | 无受保护资源或纯计算 | Prompt / Workflow 过程指令 |
| L1 | 受保护数据只读 | 读取当前 Agent 长期记忆 |
| L2 | 可撤销的站内写入 | 向 Agent 会话发送复盘提醒 |
| L3 | 外部写入或高影响操作 | 当前未开放 |
| L4 | 支付、删除、公开发布等不可逆操作 | 当前禁止 |

`PermissionGrant` 会保存当前用户、Skill ID、授权时版本和 Permission Code，同时记录 `user` 或 `agent` Scope、`active / revoked` 状态，以及授权、撤销和更新时间。

授权按 `skillId + permissionCode + scope` 生效。记录保留授权时版本用于审计，但小版本升级不会让同一权限无故失效；如果新版本需要新增权限代码，仍然必须单独授权。

### PolicyGate

PolicyGate 是选择与执行之间的硬边界。

![PolicyGate 权限判断流程图](/images/aicompanion/68-agent-skill-system-stage-four/policy-gate-flow-v2.png)

PolicyGate 接收用户、Skill ID、版本和 Manifest 权限要求，同时拿到当前 Agent 与用户 Scope 候选，以及动作名称和目标 ID。判断完成后，它会返回是否允许、命中的 Grant、缺失的权限，以及一段可以用于用户提示和审计的原因。

Tool 每次调用前检查。Background 在创建任务时检查一次，在真正执行前再次检查一次。用户撤销权限后，已经排队但尚未执行的任务不会继续写消息。

## Tool Skill 执行链路

### 契约与 Registry

Tool Definition 在 Manifest 之外必须提供：

tool-definition.ts

```typescript
type ToolSkillDefinition = {
  manifest: CompanionSkillManifest & { kind: 'tool' }
  toolId: string
  timeoutMs: number
  maxCallsPerTurn: number
  inputSchema: ZodType
  outputSchema: ZodType
  matchers: SkillMatchers
  buildInput: (context) => unknown
  execute: (context) => Promise<unknown>
  buildSystemInstruction: (output) => string
}
```

Registry 启动时会验证 Manifest 必须属于 `tool`，并确保 `skillId + version` 不重复。单回合调用上限必须在 1 到 4 之间，超时范围则限制在 100ms 到 30s 之间。

当前 `memory-recall` 固定为：

memory-recall-definition.txt

```text
toolId: agent-memory.search
timeout: 2000ms
maxCallsPerTurn: 1
permission: memory:read / L1 / persistent
scope: single_chat
```

### 记忆检索执行

统一 Executor 的顺序变为：

executor-order.txt

```text
重复 Workflow 消息恢复
  -> 活动 Workflow
  -> 新 Workflow
  -> Tool Skill
  -> Prompt Skill
  -> 普通回复
```

Tool Runner 的过程：

- 调用 PolicyGate。

- 使用 `buildInput` 构造参数。

- 使用 Zod 校验输入。

- 生成输入摘要和幂等键。

- 创建 Tool Execution 元数据。

- 使用 `AbortController + Promise.race` 执行超时控制。

- 使用 Zod 校验输出。

- 把输出转换成系统指令。

- 写入 Tool Audit 和 SkillRun。

记忆 Handler 只能调用已有的 `listActiveAgentMemories`，查询条件同时包含 `userId + agentId + active`。它不会接受调用者提供的 SQL，也不能查询其他类型数据。

检索先从问题中提取中文片段和文本 Token，再按匹配数量、记忆重要度和更新时间排序，最多返回 6 条。没有匹配时，系统要求 Agent 如实说明想不起确切信息，禁止编造记忆。

**数据最小化**

`skill_tool_executions` 保存 Tool、Skill、版本和来源消息 ID，也会记录幂等键、输入 SHA-256 摘要、状态、错误代码和耗时。

它不保存输入原文、记忆正文或完整输出。

幂等键采用：

tool-idempotency-key.txt

```text
userId + toolId + sourceMessageId
```

当前 Tool 是只读查询，重复请求不会产生外部副作用。唯一键确保只创建一条执行元数据；未来接入写操作时，需要在专用 Tool Handler 内进一步实现结果复用或目标系统幂等键，不能只依赖运行记录。

## Background Skill 运行时

### 契约与生命周期

Background Definition 包含：

background-definition.ts

```typescript
type BackgroundSkillDefinition = {
  manifest: CompanionSkillManifest & { kind: 'background' }
  payloadSchema: ZodType
  maxAttempts: number
  execute: (context) => Promise<void>
}
```

`goal-check-in-reminder` Payload 只允许 `agentId`、`agentName`、`conversationId` 和 `note` 四个字段。

这些字段由服务端根据已验证的 Agent 和默认会话构造，客户端不能直接指定 conversationId 或任意消息正文。

后台任务的生命周期如下：

![后台任务生命周期状态图](/images/aicompanion/68-agent-skill-system-stage-four/background-job-lifecycle-v2.png)

任务保存固定 Skill 版本、Agent、会话、Permission Grant、Payload、计划时间、下一次尝试时间、次数、Revision 和租约到期时间。

Cloudflare Cron 每 5 分钟调用处理器。处理器每批最多领取 20 个任务。

### 租约、重试与消息幂等

领取任务时使用两层控制：

- 查询 `scheduled / retrying` 且已到期的候选。

- 使用 `id + revision + status` 条件原子更新为 `running`。

只有更新成功的 Worker 才能执行任务。租约为 2 分钟；如果 Worker 在领取后中断，后续扫描会把过期租约恢复为 `retrying`。

失败退避：

retry-backoff.txt

```text
第 1 次失败：5 分钟
第 2 次失败：10 分钟
第 3 次失败：达到 maxAttempts，进入 failed
单次退避上限：60 分钟
```

权限缺失、Skill 被停用或固定版本不存在属于永久失败，不进行无意义重试。

**消息写入幂等**

后台任务使用 `jobId` 作为 Agent Message ID。

如果 Worker 在消息插入后、任务完成前中断，重试时 `ON CONFLICT DO NOTHING` 不会产生第二条消息。Handler 随后重新统计会话消息数量，并更新 Agent 最近回复和会话摘要元数据，因此可以修复**消息已写入但会话元数据未完成**的中间状态。

消息正文由可信模板构造：

reminder-message-template.txt

```text
我们约定的目标复盘时间到了。
{用户设置的关注点或默认复盘引导}
现在进展到哪里了？
```

用户关注点只作为引用内容，不作为系统指令执行。

## 审计、迁移与管理

### 审计与 D1 迁移

`skill_audit_events` 会记录 Skill 与版本，以及授权、撤销、Tool 执行、后台创建、执行和取消等动作。决策结果使用 allowed、denied、succeeded、failed、cancelled 表达，并保留 Scope、目标 ID 和不含消息正文的结构化元数据。

Policy 判断和最终执行结果会分别记录，因此可以区分**允许但执行失败**和**在执行前就被拒绝**。

迁移文件：

migration-file.txt

```text
apps/api/migrations/0019_skill_controlled_execution.sql
```

新增四张表：

| 表 | 作用 |
| --- | --- |
| skill_permission_grants | 持久授权与撤销状态 |
| skill_tool_executions | Tool 幂等、状态和耗时元数据 |
| skill_audit_events | 权限和执行审计 |
| skill_background_jobs | 调度、租约、重试、取消和结果 |

部署时必须先应用 `0017`、`0018`，再应用 `0019`，然后发布包含定时处理器的新 Worker。

### 管理 API 与页面

新增接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | /rpc/skills/permissions | 查看当前用户的授权记录 |
| PATCH | /rpc/skills/permissions | 授权或撤销 Manifest 已声明的权限 |
| GET | /rpc/skills/background-jobs | 查看后台任务 |
| POST | /rpc/skills/background-jobs | 创建目标复盘任务 |
| POST | /rpc/skills/background-jobs/:id/cancel | 取消未执行任务 |

权限 API 不能授予 Manifest 未声明的 Permission Code。Agent Scope 会验证 Agent 所有权。

创建后台任务时，服务端会确认 Skill 已经注册为 Background Skill、Agent 属于当前用户，并且 Skill 当前处于有效启用状态。计划时间必须在 1 分钟到 1 年之间，主动消息权限需要保持有效，Payload 也必须通过 Background Definition Schema。

原有 Catalog、Binding、Session、Run 和评测摘要全部保留。本阶段在 Skills 页面新增两个独立区域。

**执行权限**

权限区域集中展示两类能力：读取 Agent 记忆属于 L1 只读权限，发送主动提醒属于 L2 站内写入权限。

每项权限使用独立 Switch 授权或撤销，不与 Skill 启用开关混为一个概念。

**目标复盘提醒**

创建目标复盘提醒时，用户可以选择 Agent 和本地日期时间，填写可选关注点并提交任务。任务创建后，页面会展示等待、运行、重试、完成、失败和取消状态，尚未执行的任务也可以直接取消。

未授予主动消息权限时，表单保留但明确禁用创建操作。

## 评测、验证与限制

### 评测资产

第四阶段的纯函数评测同时覆盖显式 `/memory-recall` 和语义记忆回忆触发，并验证 Skill 禁用时不会触发、群聊场景不会触发单聊 Tool、普通问题不会误触发。Background Payload 既要接受合法字段，也要拒绝缺少 Agent ID 的输入。

这些样例并不替代数据库集成测试，但可以继续复用现有评测摘要页面观察 Selector 规则回归。

### 失败与降级

Tool 未授权时不会执行查询，Agent 会提示用户前往 Skills 页面授权。输入无效时，Runner 不调用 Handler，而是返回自然降级指令；Tool 超时或执行失败时只记录失败，绝不能编造检索结果。

Background 任务在创建时未获得授权，API 会返回规则错误且不创建任务。如果执行前权限已被撤销，任务会永久失败并且不写入消息；执行前 Skill 被停用时同样永久失败。临时错误按照退避策略重试，已经进入运行状态的任务则不能从页面取消，以免出现**已经写入但 UI 显示取消**的竞态。审计和 Run 数据始终不包含用户消息原文与记忆正文。

### 手工验证

按照仓库 `AGENTS.md` 约定，本次没有自动运行迁移、测试、构建、开发服务器或浏览器检查。建议手工验证：

- 按顺序应用 `0017`、`0018`、`0019` D1 迁移。

- 打开 `/skills`，确认目录出现**记忆检索**和**目标复盘提醒**。

- 未授权记忆读取时，在单聊输入**你还记得我喜欢什么吗**，确认没有读取结果，并提示授权。

- 开启**读取 Agent 记忆**，再次提问，确认只使用当前 Agent 的相关记忆回答。

- 使用 `/memory-recall` 显式触发，确认最近 Run 显示 Tool Skill。

- 停用记忆检索，确认同类消息不再调用 Tool。

- 未开启主动提醒权限时，确认**安排提醒**不可用。

- 开启主动提醒权限，创建一个几分钟后的复盘任务。

- 确认任务显示**等待执行**，随后收到一条 Agent 主动消息并进入**已完成**。

- 创建另一个任务并在执行前取消，确认不会发送消息。

- 创建任务后撤销主动提醒权限，确认到期后任务失败且不发送消息。

- 创建任务后停用 Background Skill，确认执行前被拒绝。

- 人工制造一次临时执行错误，确认任务进入 retrying 且 attempts 增加。

- 并发触发两个定时扫描，确认同一个任务只产生一条消息。

### 当前限制与第五阶段

当前只有一个 Tool Skill 和一个 Background Skill。Tool Selector 仍然使用确定性规则，没有候选集 LLM 路由；记忆检索也只是轻量文本匹配，还没有向量索引或语义重排。后台任务使用 5 分钟 Cron 粒度，不保证秒级触发。

管理能力也有明确边界。UI 目前只管理用户级 Permission Grant，虽然 API 已经支持 Agent Scope；Audit 已经持久化，但还没有专门的审计查看页面。后台 Job 只能执行一次，没有周期规则，也没有事件总线触发的 Background Skill。L3/L4 操作和 per-operation 审批交互同样尚未开放。

第四阶段证明了受控内置 Skill 可以安全获得有限权限，但这还不足以开放用户上传代码。

下一阶段若要进入开放生态，至少需要：

stage-five-scope.txt

```text
签名与发布审核
  + 隔离运行时或沙箱
  + 更细的资源 Scope
  + 每次操作审批 UI
  + 配额、成本和频率限制
  + 审计查询与告警
  + 版本兼容与自动回滚
  + 安装来源和可信等级
```

在这些能力完成前，Registry 应继续只加载仓库内审查过的内置 Definition，不接受任意 Skill 脚本或动态工具名称。

## 总结

第四阶段让 Skill 第一次能够在明确授权下读取受保护数据，并在当前聊天请求之外执行后台任务。Permission Grant 与 PolicyGate 把权限判断放在 Selector 和 Runner 之间，固定 Tool Handler、输入输出 Schema、超时、调用上限和最小化审计则把执行范围限制在可信边界内。

`memory-recall` 验证了只读 Tool 的授权、检索和降级链路，`goal-check-in-reminder` 验证了后台任务的调度、租约、重试、取消与消息幂等。开放用户代码之前，系统仍然需要补齐沙箱、逐次审批、配额、审计告警和版本回滚，Registry 也应继续只加载经过审查的内置实现。
