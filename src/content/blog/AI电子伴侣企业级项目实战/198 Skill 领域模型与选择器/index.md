---
title: "198 Skill 领域模型与选择器"
pubDate: 2026-07-26
description: "上一篇已经把 Skill 与聊天系统的边界，以及控制面和运行面的职责梳理清楚了。接下来我们把视角放到 Skill 自身，看看一种能力需要用什么类型表达，又需要哪些领域实体才能进入统一的管理和运行体系。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/63-agent-skill-domain-model-selector/](https://aicompanion.usehook.cn/63-agent-skill-domain-model-selector/)

## Skill 类型

上一篇已经把 Skill 与聊天系统的边界，以及控制面和运行面的职责梳理清楚了。接下来我们把视角放到 Skill 自身，看看一种能力需要用什么类型表达，又需要哪些领域实体才能进入统一的管理和运行体系。

不同 Skill 的运行方式和风险差异很大，不适合硬塞进同一种执行模型。我们可以按照能力边界把它们分为四类。

**Prompt Skill**

只向当前回复增加过程指令，不调用外部工具，也不维护独立状态。它适合主动倾听、决策澄清、目标拆解、冲突修复话术、群聊圆桌等能力，是风险最低、最适合第一阶段验证的类型。

**Workflow Skill**

具有多个步骤、条件分支和中间状态，通常由 LangGraph 或独立状态机执行。它适合长期目标规划、关系复盘、旅行规划、共同创作、周期性习惯辅导等能力。

**Tool Skill**

需要调用外部服务或读写真实数据。它必须声明工具白名单、输入 Schema、权限、超时、幂等策略和审批要求，适合日历安排、搜索、图片生成、文件分析、发送消息或写入第三方系统。

**Background Skill**

由时间、事件或状态变化触发，在当前聊天请求之外运行。它适合生日提醒、周期复盘、长期未互动关怀、计划到期检查，需要独立的调度、取消、重试和通知策略，不能伪装成普通 Prompt Skill。

## 领域模型

这四种 Skill 最后都会进入统一的管理和运行体系，因此我们还需要把下面这些领域实体定义清楚。

**SkillDefinition**

`SkillDefinition` 表示 Skill 的稳定身份和目录信息：

skill-definition.ts

```typescript
type SkillDefinition = {
  id: string
  name: string
  description: string
  kind: 'prompt' | 'workflow' | 'tool' | 'background'
  owner: 'system' | 'user' | 'organization'
  status: 'draft' | 'published' | 'deprecated' | 'disabled'
  currentVersion: string
}
```

**SkillVersion**

`SkillVersion` 表示一次不可变实现：

skill-version.ts

```typescript
type SkillVersion = {
  skillId: string
  version: string
  manifest: SkillManifest
  contentDigest: string
  runtimeEntry: string
  releasedAt: number
}
```

发布后的版本不直接修改。修复内容应产生新版本，旧运行仍然可以定位到原实现。

**SkillBinding**

`SkillBinding` 描述某个范围是否启用 Skill，以及使用什么配置：

skill-binding.ts

```typescript
type SkillBinding = {
  skillId: string
  skillVersion: string | 'latest-compatible'
  scopeType: 'system' | 'user' | 'agent' | 'group' | 'conversation'
  scopeId: string | null
  enabled: boolean
  priorityOverride?: number
  config?: Record<string, unknown>
}
```

绑定关系需要遵循从具体范围覆盖全局范围的顺序：

binding-priority.txt

```text
conversation > group / agent > user > system
```

例如系统默认启用**主动倾听**，用户可以全局关闭，某个 Agent 可以重新启用，而某次会话还可以临时禁用。

**SkillSession**

`SkillSession` 保存跨轮任务状态：

skill-session.ts

```typescript
type SkillSession = {
  id: string
  skillId: string
  skillVersion: string
  conversationId: string
  status: 'active' | 'waiting_user' | 'completed' | 'cancelled' | 'failed'
  currentStep: string
  state: unknown
  expiresAt?: number
}
```

Session 必须固定 Skill 版本，否则一次进行中的任务可能在升级后突然改变状态结构。

**SkillRun**

`SkillRun` 表示一次选择或执行记录：

skill-run.ts

```typescript
type SkillRun = {
  id: string
  skillId: string
  skillVersion: string
  sessionId?: string
  trigger: 'explicit' | 'rule' | 'semantic' | 'event' | 'schedule'
  selectionReason: string
  status: 'selected' | 'running' | 'completed' | 'skipped' | 'failed'
  latencyMs?: number
  tokenUsage?: number
  errorCode?: string
}
```

运行记录默认不应复制完整敏感对话。需要调试样本时，应经过脱敏、权限和保留周期控制。

**SkillArtifact 与 PermissionGrant**

复杂 Skill 可能产生计划、草稿、图片或文件，应使用 `SkillArtifact` 保存结构化产物，而不是全部塞回 Session JSON。

Tool 和 Background Skill 还需要 `PermissionGrant`，明确谁授权了什么能力、适用范围和到期时间。

## Manifest 与渐进加载

Manifest 是运行时可以快速读取的能力合同，不应该承载所有详细知识。把后面几个阶段会用到的字段也考虑进去以后，它大致会形成下面的结构：

skill-manifest.ts

```typescript
type SkillManifest = {
  id: string
  version: string
  name: string
  description: string
  kind: SkillKind
  scopes: Array<'single_chat' | 'group_chat' | 'background'>
  triggerExamples: string[]
  priority: number
  enabledByDefault: boolean
  inputSchema?: unknown
  outputSchema?: unknown
  permissions?: SkillPermission[]
  conflictsWith?: string[]
  canComposeWith?: string[]
  session?: {
    supported: boolean
    ttlSeconds?: number
  }
  resources?: {
    instructions?: string
    references?: string[]
    scripts?: string[]
    tools?: string[]
  }
}
```

第一阶段只实现其中稳定且马上会用到的字段。其余字段要等对应运行能力真正落地后再进入正式契约，避免先得到一套看似完整的 Schema，运行时却没有与之匹配的语义。

随着运行能力逐渐补充完整，Skill 目录会演进成下面的结构：

catalog.tsSkill 目录binding-resolver.ts解析各级绑定selector.ts选择当前 Skillpolicy-gate.ts权限与策略检查loader.ts渐进加载资源executor.ts统一执行入口session-store.ts多轮状态存储run-recorder.ts运行记录manifest.ts能力元数据instructions.ts过程指令workflow.ts仅 Workflow 类型需要decision-methods.mdcompare-options.tstrigger-cases.jsonresponse-cases.json

Selector 只读取 Manifest。只有选中 Skill 后才读取 instructions；只有流程确实需要某个方法或脚本时，才加载 references 或执行 scripts。

数据库可以保存目录、绑定和版本索引，但不能让未经审核的数据库字符串直接变成任意可执行代码。系统内置 Skill 在起步阶段应该来自代码仓库。将来开放用户 Skill 时，我们还要把沙箱、签名、权限和发布审核一起补充完整。

## Skill 选择器

接下来把选择过程重新梳理一下，它可以分为五步。

**候选解析**

先根据下面这些条件缩小候选集：

- 当前聊天是单聊、群聊还是后台事件。

- 系统、用户、Agent、群聊和会话绑定是否启用。

- Skill 版本是否可用。

- 当前用户是否拥有所需权限。

- 是否存在互斥、冷却时间或成本限制。

**显式选择**

用户通过 UI、快捷命令或明确操作选择 Skill 时，优先级最高，但仍必须经过场景和权限检查。

**确定性规则**

使用意图、关键词、正则、会话状态和事件类型打分。规则适合高频、边界清晰且需要稳定复现的能力。

**语义路由**

当规则无法区分多个候选时，可以对少量候选执行 embedding 或 LLM 判定。模型输入只包含候选的短描述和当前必要上下文，输出必须通过结构化 Schema 校验。

**冲突与组合**

长期运行时，不能采用**命中几个就拼几个 Prompt**这种处理方式。我们需要区分三种角色：

- Primary Skill：本轮主要任务方法，只允许一个。

- Modifier Skill：只调整语气或输出形式，可以少量组合。

- Guard Skill：增加额外检查，不直接主导任务。

Manifest 通过 `conflictsWith` 和 `canComposeWith` 声明组合边界。第一阶段只选择一个 Primary Skill，从根源上避免冲突。

## 总结

重新梳理下来，我们先用四种 Skill 类型区分不同的运行方式和风险，再通过领域模型把定义、版本、绑定、会话、运行记录和产物固定下来。Manifest 只承担轻量能力合同，详细指令和资源仍然按照渐进加载的方式读取。

选择器会先根据场景、绑定、权限和版本缩小候选集，再依次处理显式选择、确定性规则、语义路由和组合冲突。第一阶段只允许一个 Primary Skill，我们可以先把选择结果稳定下来，等真实样本积累起来以后，再继续扩展组合能力。
