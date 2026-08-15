---
title: "227 请求准入、额度与限流"
pubDate: 2026-08-05
description: "一旦请求到达模型厂商，平台就可能产生费用。鉴权、余额、套餐和限流检查都应尽量在此之前完成，而且要按照从便宜到昂贵、从确定失败到容量计数的顺序执行。"
tags: [AI编程, 计费系统, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-05
---
原文链接：[https://aicompanion.usehook.cn/8billing-eligibility-quota/](https://aicompanion.usehook.cn/8billing-eligibility-quota/)

## 1. 准入检查要发生在上游调用之前

一旦请求到达模型厂商，平台就可能产生费用。鉴权、余额、套餐和限流检查都应尽量在此之前完成，而且要按照从便宜到昂贵、从确定失败到容量计数的顺序执行。

Sub2API 的检查过程会区分余额模式与订阅模式，然后检查 API Key 额度、平台配额和 RPM。我们在此基础上增加费用预占，把“当前余额大于零”改成“可用余额能够覆盖本次保守估算”。

## 2. 一条合理的检查顺序

推荐顺序如下：API Key 格式和状态、用户状态、分组与模型权限、价格可用性、余额或订阅、周期配额、RPM/TPM、并发槽位、余额预占、上游账号调度。

价格检查放在余额之前，是因为未知价格没有办法估算预占。并发槽位放在靠后位置，可以避免无权限请求占用等待队列。真正获得上游账号之前完成预占，则可以防止账号调度成功后因余额不足又回滚大量状态。

eligibility-service.ts

```typescript
export interface EligibilityInput {
  user: BillingUser
  apiKey: BillingApiKey
  group: BillingGroup
  pricing: ResolvedPricing
  estimatedCostMicroUsd: bigint
  platform: string
}

export interface EligibilityService {
  check(input: EligibilityInput): Promise<void>
}
```

检查函数返回错误即可，不在这里修改余额。RPM 和并发计数属于例外，它们需要原子增加，并在后续失败时按规则释放。

## 3. 余额与订阅是两种模式

余额模式从钱包扣除实际金额。预检需要读取 `available = balance - frozen`，并要求可用金额大于本次预占和平台设置的最低保留额。

订阅模式不直接扣钱包，而是增加日、周、月用量。订阅必须处于 active 状态、没有过期，并且请求模型属于套餐分组。套餐达到周期上限后返回带重置时间的限额错误。

同一请求不能同时消耗订阅额度又扣余额，除非产品明确设计了超额计费。存在超额模式时，也要先确定套餐内剩余额度和超出部分，生成两条清楚的账务记录，不能在结算后凭余额是否足够临时决定。

## 4. 配额与限流解决不同问题

配额限制累计消费，例如每天最多使用 5 美元、某个 API Key 最多消费 20 美元。RPM、TPM 和并发限制控制瞬时压力，即使用户余额很多，也不能无限并发占满上游账号。

| 限制 | 推荐维度 | 典型实现 |
| --- | --- | --- |
| 消费配额 | 用户、API Key、平台、套餐 | 数据库事实 + Redis 读模型 |
| RPM | 用户、分组、API Key | Redis 固定或滑动窗口 |
| TPM | 用户、模型、API Key | Redis Token Bucket |
| 并发 | 用户、上游账号 | Redis Lua 或 Durable Object |

用户级限制通常是全局天花板，分组覆盖不应把它绕过。Sub2API 的 RPM 设计会同时检查用户级和分组级限制，这比“命中分组配置就跳过用户配置”更符合容量保护要求。

## 5. 错误码要让客户端知道能否重试

权限不足和暂时用尽不能返回同一种状态。API Key 无权访问模型使用 `403`；请求格式错误使用 `400`；余额不足可以在平台 API 使用 `402`，为兼容只识别 OpenAI 错误结构的客户端，也可以映射为带稳定业务码的 `403`。

日、周、月额度或 RPM 暂时耗尽应返回 `429`，并设置 `Retry-After`。计费依赖不可用返回 `503`，表示稍后可以重试。不要把所有失败都包装成 `500`，SDK 无法判断应该修正配置还是自动退避。

billing-error.ts

```typescript
export interface BillingErrorBody {
  error: {
    type: 'billing_error' | 'rate_limit_error' | 'permission_error'
    code: string
    message: string
    request_id: string
  }
}
```

错误响应不得包含余额缓存键、上游账号 ID 或内部 SQL 信息。日志中可以用 request ID 关联详细原因。

## 6. 缓存故障的取舍

余额和订阅状态读取失败时采用 fail-closed，因为无法确认请求是否有支付能力。RPM 缓存失败可以按业务等级选择 fail-open，但必须记录指标并对高风险用户保留数据库或本地限制。

配额缓存命中时可以直接检查，未命中则回源数据库并用 singleflight 合并同一用户的并发查询。窗口过期时要原子刷新起点和计数，不能先删除 Redis Key 再写新值，否则删除与重建之间到达的增量可能永久丢失。

熔断器适合保护持续失败的余额或订阅依赖。达到阈值后快速返回 `503`，经过冷却时间只放少量请求探测；探测成功再关闭熔断。这样既避免每次请求都等待数据库超时，也不会在故障期间免费放行。

## 7. 总结

准入系统决定一笔请求是否可以进入会产生上游成本的区域。它需要同时检查支付能力、产品权限和系统容量，并用不同错误码表达永久失败与暂时耗尽。

下一篇会把准入阶段的费用预占完整展开。余额预占不是简单地先扣一笔钱，它还要处理实际费用更低、更高、请求失败和服务重启后的恢复。
