---
title: "229 幂等、事务与账本"
pubDate: 2026-08-05
description: "客户端可能因为超时重发请求，网关可能在写回响应前断线，队列采用至少一次投递时也会重复发送任务。计费系统如果把“函数被调用一次”当成“业务只发生一次”，重复扣费迟早会出现。"
tags: [AI编程, 计费系统, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-05
---
原文链接：[https://aicompanion.usehook.cn/10idempotent-atomic-billing/](https://aicompanion.usehook.cn/10idempotent-atomic-billing/)

## 1. 重试是正常现象，不是特殊情况

客户端可能因为超时重发请求，网关可能在写回响应前断线，队列采用至少一次投递时也会重复发送任务。计费系统如果把“函数被调用一次”当成“业务只发生一次”，重复扣费迟早会出现。

幂等要求同一个业务操作执行多次，最终只产生一次账务效果。它不能只靠内存锁，因为进程重启或请求落到另一台实例后，锁就不存在了。幂等事实必须落到所有实例共享的数据库中。

## 2. 请求 ID 还不够

幂等键可以使用 `requestId + apiKeyId`。加入 API Key 是为了允许不同租户使用相同客户端请求 ID，同时防止同一个 Key 对同一请求重复结算。

不过，只比较 ID 还会掩盖另一种错误：客户端错误复用了 request ID，但请求模型和 Token 用量已经变化。系统应当为计费命令生成指纹。

billing-fingerprint.ts

```typescript
export interface BillingFingerprintInput {
  requestId: string
  apiKeyId: string
  billingModel: string
  pricingVersionId: string
  usage: NormalizedUsage
  chargedMicroUsd: bigint
  requestPayloadHash: string
}

export async function createBillingFingerprint(
  input: BillingFingerprintInput,
) {
  return sha256(stableStringify(input))
}
```

相同幂等键和相同指纹表示重复执行，可以直接返回第一次结果；幂等键相同但指纹不同表示冲突，应当拒绝并告警，不能默默沿用旧账单。

## 3. 结算事务包含哪些动作

一笔结算至少要声明幂等键、锁定预占、写入用量事件、写入账本、更新余额或套餐额度、更新 API Key 配额，最后把预占改为 captured。它们必须在同一数据库事务中完成：

任何一步失败都回滚。不能先异步扣余额，再异步补用量日志；也不能账本成功后因为缓存更新失败而回滚数据库。Redis 只是读模型，事务提交后失效或刷新即可。

Sub2API 的 `usageBillingRepository.Apply()` 也是先插入窄幂等表，再在同一 PostgreSQL 事务里更新余额、订阅、API Key 额度和上游账号配额。这种结构比让各个 service 分别提交更容易保证一致性。

## 4. 幂等声明怎样写

claim-billing.sql

```sql
INSERT INTO billing_dedup (
  request_id,
  api_key_id,
  request_fingerprint,
  created_at
)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (request_id, api_key_id) DO NOTHING
RETURNING id;
```

插入成功才有资格继续应用账务。没有返回行时，事务需要查询已有指纹：相同则返回 `applied: false`，不同则抛出 `BILLING_REQUEST_CONFLICT`。

幂等表保持窄小，可以比用量明细保留更久。历史明细归档后，旧请求仍然可能被队列重新投递；过早删除幂等键会让它再次扣费。需要清理时先迁移到归档幂等表，并让 claim 同时检查在线表与归档表。

## 5. 账本与余额怎样一起更新

结算事务先锁定账户或使用带条件的原子更新，计算 `balance_after`，然后插入账本。账本金额使用实际结算额的负数，退款或释放差额则有对应正向记录。

capture-hold.sql

```sql
UPDATE billing_accounts
SET
  frozen_micro_usd = frozen_micro_usd - $1,
  available_micro_usd = available_micro_usd + $1 - $2,
  version = version + 1
WHERE user_id = $3
  AND frozen_micro_usd >= $1
RETURNING available_micro_usd, frozen_micro_usd;
```

这里 `$1` 是预占金额，`$2` 是实际金额。实际金额超过预占时需要使用另一条包含可用余额或授信条件的 SQL，不能让这个公式绕过余额不足检查。

数据库提交后再更新 Redis。缓存更新失败只会导致下次请求回源，不会改变已经成立的账务事实。为防止短时间读到旧余额，可以删除缓存而不是计算并写入新值，或者使用账户 `version` 做 compare-and-set。

## 6. 异步事件使用 Outbox

结算完成后通常还要发送低余额通知、刷新仪表盘汇总、记录运营事件。如果事务提交后直接发消息，进程可能在提交与发送之间崩溃；如果先发消息，数据库回滚后消费者却已经收到不存在的账单。

Outbox 模式会在同一事务中插入一条待发布事件。后台发布器读取它，发送到 Queue 后标记完成。消费者继续以事件 ID 幂等处理。

billing-outbox.ts

```typescript
export interface BillingSettledEvent {
  eventId: string
  requestId: string
  userId: string
  ledgerEntryId: string
  chargedMicroUsd: string
  occurredAt: string
}
```

用量汇总、邮件和分析任务可以异步，余额、账本和预占状态不可以异步拆开。判断边界的方法很简单：丢失这一步是否会让用户的钱对不上。如果会，它就属于核心事务。

## 7. 总结

幂等键防止重复执行，指纹防止同一个键被错误复用，数据库事务则保证用量、账本、余额和配额要么一起成功，要么一起失败。Redis 和通知在事务之外更新，不应反过来决定财务事实。

下一篇会处理更复杂的路由情况。一个用户请求可能尝试多个上游账号，也可能在 LangGraph 中触发多次模型调用，需要先确定哪一层才是一笔可收费操作。
