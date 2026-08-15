---
title: "228 余额预占、结算与释放"
pubDate: 2026-08-05
description: "假设用户只有 0.01 美元，却同时发起十个长对话请求。十个请求在准入时都看到余额大于零，于是一起进入上游。等响应结束后逐笔扣费，前几个请求已经把余额用完，后面的费用只能把账户扣成负数。"
tags: [AI编程, 计费系统, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-05
---
原文链接：[https://aicompanion.usehook.cn/9balance-hold-settlement/](https://aicompanion.usehook.cn/9balance-hold-settlement/)

## 1. 为什么要先冻结余额

假设用户只有 0.01 美元，却同时发起十个长对话请求。十个请求在准入时都看到余额大于零，于是一起进入上游。等响应结束后逐笔扣费，前几个请求已经把余额用完，后面的费用只能把账户扣成负数。

这不是余额缓存慢一点的问题，而是缺少并发下的资金占用。请求开始前应当原子地把预计费用从可用余额转为冻结余额，让后续请求看不到已经被占用的部分。

Sub2API 在批量图片任务中已经使用 `balance + frozen_balance` 完成 reserve、capture 和 release。普通流式请求面对的风险相同，只是预计费用需要根据 Token 上限计算。

## 2. 预占状态怎样变化

一笔预占从创建到结束只允许沿着明确路径变化：

`held` 表示余额已经冻结，模型请求才可以进入上游。正常拿到 usage 后进入 `captured`，实际费用从冻结额中结算，多余部分退回可用余额。请求在转发前失败则进入 `released`。

如果已经输出内容却缺少 usage，不能立即释放，也不能随意按上限扣除，而是进入 `reconciling`。后台对账拿到证据后再 capture；超过处理期限仍无法确认时，按照平台公布的异常计费政策处理。

## 3. 预占金额怎样估算

输入 Token 可以在转发前用目标模型 tokenizer 估算，输出使用请求中的 `max_output_tokens`。为了覆盖工具调用、协议包装和 tokenizer 偏差，还可以增加一个有限的安全缓冲。

estimate-hold.ts

```typescript
export interface HoldEstimateInput {
  estimatedInputTokens: number
  maxOutputTokens: number
  cacheReadTokens: number
  safetyRate: string
  pricing: ResolvedPricing
}

export function estimateHold(input: HoldEstimateInput) {
  const maximumUsage: NormalizedUsage = {
    regularInputTokens: input.estimatedInputTokens,
    outputTokens: input.maxOutputTokens,
    cacheWriteTokens: 0,
    cacheReadTokens: input.cacheReadTokens,
    reasoningTokens: 0,
    imageInputTokens: 0,
    imageOutputTokens: 0,
    toolCalls: 0,
    source: 'estimated',
  }

  return calculateMaximumCharge(maximumUsage, input)
}
```

不能无限相信客户端的 `max_output_tokens`。平台要为每个模型设置允许上限，并在请求进入价格计算前完成截断或拒绝。对于没有提供上限的请求，使用模型默认值和平台保守上限。

预占过高会让用户明明有余额却无法并发调用，预占过低又会产生透支。可以根据真实数据调整安全缓冲，但规则必须可解释，不能按用户历史消费随意改变而不展示。

## 4. Reserve 必须是原子操作

读取余额、在应用层判断、再执行更新会产生竞态。正确做法是把条件放进同一条 SQL：

reserve-balance.sql

```sql
UPDATE billing_accounts
SET
  available_micro_usd = available_micro_usd - $1,
  frozen_micro_usd = frozen_micro_usd + $1,
  version = version + 1,
  updated_at = NOW()
WHERE user_id = $2
  AND available_micro_usd >= $1
RETURNING available_micro_usd, frozen_micro_usd, version;
```

没有返回行表示余额不足或账户不存在，调用方再查询账户状态决定具体错误。不要在余额不足时自动允许负数预占，除非该用户具有明确授信额度，并且授信额度也进入 SQL 条件。

成功更新账户后，还要在同一事务中插入 `balance_holds`。如果只改余额而预占记录写入失败，后台就不知道这笔冻结属于哪个请求。

## 5. Capture 与 Release 怎样计算

假设预占 20,000 微美元，实际费用为 13,500 微美元。Capture 要减少 20,000 冻结额，其中 13,500 进入消费账本，剩余 6,500 回到可用余额。

实际费用高于预占时，可以从剩余可用余额补扣差额。补扣仍然不足时，不建议静默丢弃费用。系统可以记录真实负债、暂停该 API Key，并触发告警；也可以在产品规则允许时把用户余额扣成负数。无论选择哪一种，都必须保留 `overdrafted` 状态，便于后续追缴和风险控制。

Release 只把冻结额退回可用余额，不产生消费记录。为了防止“从未成功预占却执行释放”凭空增加余额，Release 必须验证原 hold 存在并处于 `held` 状态。

## 6. 服务重启后的恢复

进程可能在预占成功后、发起上游请求前崩溃，也可能在上游完成后、结算事务前退出。因此后台需要扫描超时 hold。

恢复任务先检查是否存在 usage 事件和上游请求 ID。没有转发证据的 hold 可以释放；存在完整 usage 的执行 capture；存在上游请求但 usage 不完整的进入对账。恢复动作继续使用原请求幂等键，任务重复运行也不会二次退回或扣费。

预占过期时间不能短于模型请求最大运行时间。长时间 Agent、批量任务和普通聊天可以使用不同 TTL，并在任务仍活跃时续租。续租只延长过期时间，不重复冻结余额。

## 7. 总结

余额预占解决的是并发请求共同消费同一份余额的问题。Reserve、Capture 和 Release 都要通过数据库条件更新与状态机保证原子性，异常请求则进入待对账，而不是直接按零费用处理。

下一篇会把预占、账本、配额和用量放进同一个幂等事务。这样即使客户端重试、队列重复投递或多个结算入口同时触发，账务效果也只会应用一次。
