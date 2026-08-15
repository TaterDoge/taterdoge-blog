---
title: "199 Skill 运行时、安全与演进"
pubDate: 2026-07-26
description: "前面已经定义了 Skill 类型、领域模型和选择器，但选中 Skill 并不等于它已经可以安全运行。我们还需要用统一运行时接住不同类型的执行差异，让聊天路由只提交一份统一请求，不必了解每个 Skill。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-07-26
---
原文链接：[https://aicompanion.usehook.cn/64-agent-skill-runtime-safety-evolution/](https://aicompanion.usehook.cn/64-agent-skill-runtime-safety-evolution/)

## Skill 运行时

前面已经定义了 Skill 类型、领域模型和选择器，但选中 Skill 并不等于它已经可以安全运行。我们还需要用统一运行时接住不同类型的执行差异，让聊天路由只提交一份统一请求，不必了解每个 Skill 的内部文件和处理步骤：

skill-runtime.ts

```typescript
type SkillExecutionContext = {
  userId: string
  conversationId: string
  scope: 'single_chat' | 'group_chat'
  agentIds: string[]
  userText: string
  safety: unknown
  understanding: unknown
  memories: unknown[]
  signal: AbortSignal
}

type SkillExecutionResult = {
  systemInstructions?: string[]
  statePatch?: unknown
  artifacts?: SkillArtifact[]
  suggestedMessages?: Array<{ role: string; content: string }>
  completionStatus: 'completed' | 'waiting_user' | 'skipped'
}
```

不同类型由不同 Runner 负责：

skill-runners.txt

```text
PromptSkillRunner
WorkflowSkillRunner
ToolSkillRunner
BackgroundSkillRunner
```

统一 Executor 负责超时、错误映射、取消、日志、版本固定和 Policy Gate，而不是让每个 Skill 重复实现这些基础设施。

把这些组件串起来以后，一次聊天请求会经历下面这段生命周期：

![Skill 运行时聊天请求流程图](/images/aicompanion/64-agent-skill-runtime-safety-evolution/1.png)

Prompt Skill 的 Executor 只返回系统指令；Workflow 或 Tool Skill 可能在模型调用前后执行多个步骤。聊天路由不应该直接知道每个 Skill 的内部文件和规则。

## 多轮状态

需要多轮互动的 Skill 不能依赖一个不断增长的 Prompt。我们可以把状态拆成：

- `input`：用户最初目标。

- `slots`：已经收集的结构化信息。

- `currentStep`：当前流程节点。

- `pendingQuestion`：等待用户回答的问题。

- `artifacts`：已经生成的计划、草稿等产物引用。

- `checkpoint`：工作流恢复信息。

- `expiresAt`：长期未继续时的过期时间。

每条新消息到来时，系统先检查是否存在等待中的 Skill Session，再判断这条消息是在继续当前任务、切换任务还是取消任务。

除了保存这些字段，Session 还要能够明确取消和完成，也要处理超时过期与版本固定。并发更新时需要乐观锁或其他保护手段，执行过程则必须保持幂等，避免网络重试造成重复写入或重复调用外部服务。

## 单聊、群聊与安全

单聊通常由一个 Agent 执行 Skill。Skill 应尊重该 Agent 的人格、双方关系阶段和长期记忆。

群聊比单聊多了一层协作关系。系统不仅要判断哪个 Skill 适合处理用户任务，还要决定哪些 Agent 参与，以及每个 Agent 分别承担什么部分。

群聊 Skill 不应让每个 Agent 独立执行同一套完整流程，否则很容易得到几段内容相近的回复。更完整的做法是由 Group Coordinator 先创建共享 Skill Run，再根据任务给 Agent 分配角色：主持者负责确认问题和收束讨论，观点提供者从自己的角色视角回答，质疑者检查遗漏与风险，行动整理者负责形成可以继续执行的下一步。

第一阶段的**群聊圆桌**只增加轻量 Prompt 约束，继续利用现有 Agent 选择流程，让每个被选中的 Agent 提供互补观点。共享 Run 和角色分工会留到后面的阶段实现。

Skill 系统会逐步从**影响回复内容**发展到**影响真实世界**，权限也必须随着能力一起升级。我们可以把风险划分为五个等级：

| 等级 | 能力 | 默认策略 |
| --- | --- | --- |
| L0 | 只读 Prompt 指令 | 内置并审核后可自动运行 |
| L1 | 读取应用内非敏感数据 | 需要明确数据范围 |
| L2 | 写入应用内数据 | 需要用户授权、Schema 校验和审计 |
| L3 | 调用外部服务或发送内容 | 需要细粒度授权，部分操作执行前确认 |
| L4 | 支付、删除、公开发布等高风险操作 | 强制二次确认或禁止自动执行 |

风险等级只是第一层约束，执行入口还要把具体边界落实下来。Tool 必须来自白名单，Skill 不能自由构造任意工具名；输入和输出都要经过结构化 Schema 校验，每次执行也要限制超时、成本和调用次数。

只要涉及写操作，就要提供幂等键。外部内容始终按照不可信数据处理，不能让 Prompt Injection 借助 Skill 扩大权限。用户提供的 Skill 与系统内置 Skill 使用不同信任等级，Background Skill 必须可以查看、暂停和取消，日志中也不能保存私钥、API Key、验证码和不必要的对话原文。

## 可观测性与评测

没有观测的 Skill 系统，很难判断问题究竟出在**没有触发**、**触发错了**，还是**执行质量不够好**。所以每次运行都要记录候选数量、选择结果和选择来源，明确这一轮来自显式命令、确定性规则、语义判断、事件还是计划任务。Skill ID 与确切版本也要一并保存，被 Policy Gate 拒绝或跳过时，需要留下可以追踪的原因。

执行阶段还要记录耗时、模型 Token、工具调用次数和错误码。到了多轮任务，我们再继续关注 Session 完成率、中途退出率和平均轮数，并把用户反馈与回复质量评分一起纳入观察。

有了运行记录以后，我们还需要从三个方向评测 Skill。触发评测用于验证应该触发、不能触发、多个候选冲突和场景限制，关注 precision、recall 和误触发类型；执行评测用于验证 Skill 是否遵循步骤、使用正确资料、产出符合 Schema，并在信息不足时合理追问；安全回归则要验证 Skill 不能覆盖拒绝、隐私、依赖性表达和工具权限，每个新版本发布前都应该运行固定安全样本。

## 版本与发布

版本采用语义化规则。Patch 用来处理措辞修复和规则微调，不改变输入输出合同；Minor 用来增加兼容能力或可选步骤；当状态结构、输入输出或行为边界出现不兼容变化时，才升级 Major。

三种版本都要经过同一套发布流程：

release-flow.txt

```text
Draft
  -> Schema 校验
  -> 触发评测
  -> 执行与安全回归
  -> 小流量灰度
  -> Published
  -> 指标异常时回滚
```

进行中的 Skill Session 默认继续使用创建时版本。新会话才使用新版本，除非存在明确的数据迁移程序。

## 场景与演进

回到电子伴侣本身，我们可以按照六个方向整理 Skill。

**情绪陪伴**

情绪陪伴可以包含主动倾听、情绪降温、孤独陪伴、冲突后的关系修复和睡前放松引导。实现时要特别避免心理诊断、过度依赖暗示，以及让电子伴侣替代现实支持系统。

**思考与决策**

思考与决策更关注决策澄清、利弊分析、假设检查、复盘总结和价值偏好澄清，重点是帮助用户看清问题，而不是替用户做决定。

**行动与成长**

目标拆解、习惯计划、学习规划、周复盘和任务启动陪伴都属于这个方向。它们需要把模糊目标转换成用户真正能够开始执行的行动。

**关系与沟通**

在关系与沟通场景中，可以提供回复草稿、非暴力沟通整理、边界表达、道歉与修复，以及约会或共同活动策划。

**创作与娱乐**

故事共创、角色扮演场景主持、图片提示词设计、游戏或问答主持，更适合归到创作与娱乐方向。

**群聊协作**

群聊可以进一步发展出群聊圆桌、多角色头脑风暴、支持者与质疑者双视角，以及群聊总结与行动项。这些 Skill 的重点不是让 Agent 说得更多，而是让不同角色真正形成分工。

是否实现一个 Skill，不只取决于场景是否有趣，还要看触发边界、评测方法和安全成本是否足够明确。

如果现在就把这些能力全部铺开，系统会同时面对选择、状态、权限和运行风险，很难判断问题究竟来自哪一层。更稳妥的方式是分成五个阶段逐步推进。

**第一阶段：最小 Prompt Skill 闭环**

第一阶段先建立 Manifest 契约、静态可信 Registry 和确定性 Selector，单轮只选择一个 Prompt Skill，并把它接入单聊与群聊的主回复。我们要验证的是：在不破坏现有聊天系统的前提下，Skill 能否被稳定选择，回复方法是否真的得到改善。

**第二阶段：可配置和可观测**

选择效果稳定以后，再建立触发评测数据集和自动化回归，增加用户、Agent、群聊与会话 Binding，同时写入 SkillRun 记录。管理 API、基础 UI、灰度、禁用和版本回滚也在这个阶段补充进来。

**第三阶段：多轮 Workflow**

进入多轮任务后，我们再增加统一 Executor 与 Runner 接口，引入 SkillSession 和状态迁移，并接入独立 LangGraph 子图。取消、恢复、过期和并发控制也要在这个阶段真正落地。

**第四阶段：Tool 与 Background**

Tool 与 Background Skill 会接触真实数据和外部系统，因此需要增加 PermissionGrant 与 Policy Gate，把工具白名单、审批、幂等、审计、计划任务、事件触发、重试和取消放进完整执行流程。

**第五阶段：开放生态**

最后才进入开放生态，允许用户或组织创建 Skill。到了这一步，沙箱、签名验证、发布审核、可信等级，以及目录发现、安装、评分和兼容性管理都不能缺少。

每一个阶段都要建立在前一阶段的真实数据和评测结果上。选择器还不稳定、运行记录也没有建立时，急着开放高权限工具只会放大风险。

## 总结

到这里，Skill 已经从**被选中**继续推进到**能够稳定运行**。统一运行时把不同 Skill Runner 隐藏在同一个执行接口后面，并集中处理超时、取消、错误、版本和策略检查；多轮 Skill 还要建立独立 Session，不能依赖聊天记录反复推断任务进度。

当 Skill 开始读取数据、写入系统或调用外部服务以后，安全等级、运行观测、触发评测、版本发布和回滚必须一起建立。我们可以先从低风险 Prompt Skill 积累真实运行数据，再逐步进入 Workflow、Tool、Background 和开放生态，这样每一次能力升级都有足够依据。
