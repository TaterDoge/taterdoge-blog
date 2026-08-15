---
title: "222 计费领域模型与数据库设计"
pubDate: 2026-08-05
description: "很多计费系统最初只有一张 usage_logs 表，里面同时放 Token 数量、金额和用户余额。功能少时看不出问题，等到需要退款、补扣、管理员调账和历史价格回溯时，这张表会变得很难维护。"
tags: [AI编程, 计费系统, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-05
---
原文链接：[https://aicompanion.usehook.cn/3billing-domain-model/](https://aicompanion.usehook.cn/3billing-domain-model/)

## 1. 先分清三类账务数据

很多计费系统最初只有一张 `usage_logs` 表，里面同时放 Token 数量、金额和用户余额。功能少时看不出问题，等到需要退款、补扣、管理员调账和历史价格回溯时，这张表会变得很难维护。

用量事件、账本和余额快照应该分开。用量事件回答“这次模型调用发生了什么”；账本回答“哪一笔业务让账户增加或减少多少钱”；余额快照回答“当前还能使用多少”。

余额可以根据账本重新计算，用量事件却不一定直接改变余额。例如订阅套餐消耗的是周期额度，免费试用可能只记录用量，影子计费则只计算金额但不真正扣除。

## 2. 数据表之间的关系

下面的关系图只保留计费需要的核心实体：

用户可以拥有多个 API Key，每个 Key 可以绑定分组、模型范围和独立额度。一次模型请求产生一条用量事件，用量事件引用请求开始时选定的价格版本。余额预占在请求开始时创建，结算后对应一条或多条账本记录。

上游账号没有直接出现在用户钱包关系中，因为它属于平台成本侧。同一笔用量需要同时保存用户售价和上游成本，后面才能计算毛利并核对渠道账单。

## 3. 核心表怎么设计

生产实现至少需要下面几组表：

| 表 | 关键职责 |
| --- | --- |
| billing_accounts | 用户可用余额、冻结余额和版本号 |
| model_price_versions | 带生效时间的模型价格 |
| usage_events | 每次上游调用的模型、Token 和费用明细 |
| balance_holds | 请求预占、结算和释放状态 |
| ledger_entries | 所有余额变动的不可修改记录 |
| billing_dedup | 声明某个请求是否已应用账务效果 |
| subscriptions | 套餐状态和周期额度 |
| quota_counters | 用户、API Key、平台维度的周期用量 |

金额字段不能直接使用 JavaScript `number` 作为长期存储格式。课程代码统一使用微美元 `microUsd`，即 1 美元等于 1,000,000 微美元。单个 Token 的价格先以高精度十进制字符串参与计算，最终结算时按照明确规则舍入成整数。

money.ts

```typescript
export type MicroUsd = bigint

export interface MoneyAmount {
  currency: 'USD'
  microUsd: MicroUsd
}
```

如果使用 PostgreSQL，可以把余额和账本金额保存为 `BIGINT`，TypeScript 侧按字符串或 `bigint` 读取。价格表则使用 `NUMERIC(30, 18)`，避免每 Token 单价过小时提前归零。

## 4. 用量事件必须能够复算

一条用量事件不只保存总 Token。它需要记录归一化后的互斥 Token 桶，以及计费时使用的价格快照：

usage-event.ts

```typescript
export interface UsageEvent {
  id: string
  requestId: string
  attemptId: string
  userId: string
  apiKeyId: string
  providerAccountId: string
  requestedModel: string
  upstreamModel: string
  billingModel: string
  pricingVersionId: string
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  reasoningTokens: number
  upstreamCostMicroUsd: bigint
  chargedMicroUsd: bigint
  usageSource: 'provider' | 'estimated'
  stream: boolean
  createdAt: Date
}
```

`requestId` 表示用户发起的逻辑请求，`attemptId` 表示某一次上游尝试。发生故障切换时，一个请求可能有多个 attempt，但最终账单不能简单把所有 attempt 全部计给用户。这个问题会在路由与重试一篇中单独处理。

用量事件采用 append-only。发现解析错误时，不应直接把历史行改成新金额，而是写入修正事件和对应账本冲正，让修改过程可见。

## 5. 账本才是余额事实

账本记录每一次资金变化。充值、消费、退款、人工调账和活动赠送都使用相同结构，但 `entryType` 和关联业务不同。

ledger-entries.sql

```sql
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL,
  request_id VARCHAR(128),
  entry_type VARCHAR(32) NOT NULL,
  amount_micro_usd BIGINT NOT NULL,
  balance_after_micro_usd BIGINT NOT NULL,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

消费记录的 `amount_micro_usd` 为负数，充值和退款为正数。`balance_after_micro_usd` 方便快速展示和排查，但账户当前余额仍要在同一数据库事务中更新，不能先写账本、稍后异步修改余额。

管理员调整余额也必须写账本，并附带操作人、原因和工单号。直接执行 `UPDATE users SET balance = ...` 会让财务变化失去来源，应当在数据库权限层面限制这种操作。

## 6. 索引、分区与保留策略

用量表增长很快，查询通常围绕用户、API Key、模型和时间范围展开。因此至少需要 `(user_id, created_at)`、`(api_key_id, created_at)`、`request_id` 和 `pricing_version_id` 索引。

当数据达到一定规模后，可以按月对 `usage_events` 分区，把明细查询和后台聚合分开。用户仪表盘读取日汇总表，不要每次扫描几千万条明细；审计或申诉时再查询原始事件。

幂等键不能跟着普通明细过早删除。Sub2API 将账务幂等键拆成窄表，并提供归档表，原因正是历史用量清理后仍然要防止旧请求再次被扣费。我们的保留策略也会把幂等记录、账本和用量明细设置成不同生命周期。

## 7. 总结

用量事件保存调用证据，账本保存资金变化，余额只是为了快速判断和展示的快照。把三者拆开以后，退款、补扣、对账和管理员调账都有明确落点。

下一篇会继续处理价格。模型名称会映射，渠道价格会调整，官方价格也会更新，因此计费系统需要解析价格版本，而不是在代码里维护一组会随时过期的常量。
