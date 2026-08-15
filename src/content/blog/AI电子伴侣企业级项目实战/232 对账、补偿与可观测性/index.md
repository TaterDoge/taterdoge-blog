---
title: "232 对账、补偿与可观测性"
pubDate: 2026-08-05
description: "数据库事务可以保证一次结算内部一致，却无法保证平台记录与模型厂商账单永远一致。厂商可能延迟提供 usage，适配器可能漏掉新字段，价格同步也可能出现错误。管理员还可能执行退款或人工调整。"
tags: [AI编程, 计费系统, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-05
---
原文链接：[https://aicompanion.usehook.cn/13billing-reconciliation/](https://aicompanion.usehook.cn/13billing-reconciliation/)

## 1. 事务正确不代表永远没有差异

数据库事务可以保证一次结算内部一致，却无法保证平台记录与模型厂商账单永远一致。厂商可能延迟提供 usage，适配器可能漏掉新字段，价格同步也可能出现错误。管理员还可能执行退款或人工调整。

因此，计费系统需要一条独立的对账流程。它不是等用户投诉后查日志，而是定期比较不同证据，主动发现漏收、错收和余额漂移。

## 2. 对账需要比较三层数据

第一层是内部业务一致性：用量事件的收费金额是否等于对应账本金额，账本累计是否等于账户余额变化。第二层是请求一致性：每个已完成的上游调用是否存在用量事件，每个预占是否已经结算、释放或进入待处理。第三层是外部一致性：平台记录的上游成本是否与厂商用量或账单接近。

三层检查不能合成一条总金额比较。总额相同可能只是两笔相反错误互相抵消，必须按请求、用户、模型、上游账号和时间窗口逐层聚合。

## 3. 内部一致性怎样检查

账户余额应满足一个可验证公式：

account-invariant.txt

```txt
期末余额 = 期初余额
         + 充值
         + 赠送
         + 退款
         + 人工调增
         - 模型消费
         - 人工调减
```

冻结余额还需要满足：所有处于 `held` 或 `reconciling` 状态的预占金额之和，等于账户冻结快照。发现差异时先冻结高风险操作，不能直接把数据库余额改成计算结果。

每天可以按账户生成对账快照，保存期初、各类变动、期末、冻结额和校验状态。明细账本仍是事实来源，快照用于快速发现异常和缩小排查范围。

reconciliation-result.ts

```typescript
export interface ReconciliationResult {
  scope: 'account' | 'request' | 'provider'
  scopeId: string
  expectedMicroUsd: bigint
  actualMicroUsd: bigint
  differenceMicroUsd: bigint
  status: 'matched' | 'warning' | 'failed'
  evidenceIds: string[]
}
```

## 4. 上游账单怎样关联

网关要保存厂商 response ID、request ID、账号 ID、模型和执行时间。厂商用量接口可以按这些字段关联时，优先逐请求核对；只能提供小时或天聚合时，则按账号、模型和时间窗口比较。

时间窗口要考虑厂商账单延迟和时区。刚结束的请求不应立即判定缺失，可以设置成熟时间，例如事件发生 30 分钟后才进入外部对账。跨日流式请求按开始时间还是结束时间归属，也要在内部与外部报表中保持一致。

差异阈值需要同时考虑绝对金额和比例。一天只消费 0.001 美元时，差 0.0001 的比例很高但风险很小；消费 10,000 美元时，0.1% 已经值得调查。

## 5. 补偿不能修改原记录

确认用户多扣 2,000 微美元时，系统新增一条 `billing_refund` 账本记录；确认漏扣时新增 `billing_adjustment_debit`。原用量事件和原账本保持不变，并通过 `correctionOf` 关联修正对象。

billing-correction.ts

```typescript
export interface BillingCorrection {
  correctionId: string
  correctionOf: string
  type: 'refund' | 'additional_charge'
  amountMicroUsd: bigint
  reasonCode: string
  evidenceIds: string[]
  approvedBy: string | null
}
```

小额、规则明确的差异可以自动补偿；超过阈值、涉及大量用户或需要补扣时，应进入人工审批。补偿任务本身继续使用幂等键，避免定时任务重跑造成重复退款。

## 6. 计费可观测性看哪些指标

普通接口监控关注延迟和错误率，计费还要观察业务不变量。关键指标包括价格解析失败数、usage 缺失率、估算用量比例、预占超时数、幂等冲突数、余额透支金额、结算队列延迟、对账差异金额和缓存回源率。

日志使用 `requestId`、`callId`、`attemptId`、`ledgerEntryId` 串联，但不要输出完整 API Key、Prompt 和用户内容。金额日志统一使用整数和币种，避免不同服务按不同小数位格式化。

告警也要区分紧急程度。单个冷门模型价格缺失可以立即禁用该模型；大面积结算失败需要打开计费熔断并停止新请求；对账出现小额延迟差异可以等待下一轮确认，避免频繁误报。

## 7. 总结

对账把用量事件、账本余额和上游账单放到同一个验证闭环中。发现差异后通过追加冲正修复，而不是覆盖历史记录，这样每次变化都有来源。

下一篇会把这些能力放进管理后台。后台不仅要展示图表，还要限制谁能改价格、谁能调余额，以及所有高风险操作如何审批和审计。
