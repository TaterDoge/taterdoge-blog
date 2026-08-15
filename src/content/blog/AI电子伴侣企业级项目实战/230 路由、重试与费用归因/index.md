---
title: "230 路由、重试与费用归因"
pubDate: 2026-08-05
description: "用户在页面上只点了一次发送，网关却可能先尝试账号 A，遇到限流后切换到账号 B。进入 LangGraph 后，意图识别、记忆提取、工具选择和最终回复还可能分别调用模型。"
tags: [AI编程, 计费系统, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-05
---
原文链接：[https://aicompanion.usehook.cn/11routing-retry-attribution/](https://aicompanion.usehook.cn/11routing-retry-attribution/)

## 1. 一个用户动作可能产生多次上游调用

用户在页面上只点了一次发送，网关却可能先尝试账号 A，遇到限流后切换到账号 B。进入 LangGraph 后，意图识别、记忆提取、工具选择和最终回复还可能分别调用模型。

这些调用不能都使用同一个幂等键，也不能全部视为一次上游尝试。我们需要区分用户动作、Agent 运行、逻辑模型调用和渠道尝试四个层级。

## 2. 四层标识怎样关联

`traceId` 关联用户发起的一次完整操作，`runId` 表示一次 LangGraph 执行，`callId` 表示图中某个模型节点的一次逻辑调用，`attemptId` 表示该调用向某个上游账号发起的一次尝试。

每个 `callId` 都有独立预占和结算，因为它真正对应一笔模型消费。多个 attempt 共享同一 call，但平台仍要分别记录上游成本，才能知道故障切换损失了多少。

billing-attribution.ts

```typescript
export interface BillingAttribution {
  traceId: string
  runId: string
  nodeName: string
  callId: string
  attemptId: string
  attemptNumber: number
}
```

这些 ID 由服务端生成或验证。客户端可以传 trace 方便关联，但不能自行决定 `callId`，否则可能让两次真实调用共用幂等键。

## 3. 失败尝试应该由谁承担

上游在返回内容前立即拒绝请求，通常不会产生可计费用量。平台可以切换账号并只向用户收取最终成功调用。若失败尝试已经返回部分内容和 usage，上游可能仍然收费。

标准策略是分别记录两种金额：`upstreamCost` 记录每个 attempt 的真实平台成本，`userCharge` 根据公开规则决定是否向用户收费。由平台路由故障造成、且用户没有获得有效结果的成本，默认由平台承担；用户主动取消但已经接收内容的请求，则可以按实际 usage 收费。

规则必须写进产品条款和计费策略版本，不能在客服申诉时临时判断。账务记录保存 `chargeReason`，例如 `completed`、`client_cancelled_after_output` 或 `provider_failure_absorbed`。

## 4. 模型映射后的价格与成本

客户端请求的模型、计费模型和最终上游模型可能不同。用户售价通常依据分组承诺的 `billingModel`，平台成本依据 `upstreamModel` 和具体账号成本倍率。

attempt-cost.ts

```typescript
export interface AttemptCost {
  requestedModel: string
  billingModel: string
  upstreamModel: string
  userChargeMicroUsd: bigint
  upstreamCostMicroUsd: bigint
  absorbedCostMicroUsd: bigint
}
```

调度器可以在选账号时执行利润门：只有预计上游成本不超过用户售价减安全缓冲的账号，才进入候选池。价格数据缺失时应拒绝该候选，而不是把未知成本当作零。

粘性会话能提高 Prompt Cache 命中，但不能绕过利润和可用性检查。粘连账号失效后切换到新账号，缓存读取可能变成普通输入，计费应以实际 usage 为准，并在必要时向用户说明缓存迁移策略。

## 5. LangGraph 预算怎样控制

只限制单次模型请求不足以控制 Agent 成本。一个循环图可能不断反思和重试，每次调用都没有超额，整个 run 却消耗大量余额。

运行开始时可以建立 `RunBudget`，记录最大金额、最大模型调用次数和剩余额度。每个节点预占前先检查 run 预算，结算后增加已用金额。

run-budget.ts

```typescript
export interface RunBudget {
  runId: string
  maxCostMicroUsd: bigint
  usedCostMicroUsd: bigint
  heldCostMicroUsd: bigint
  maxModelCalls: number
  modelCalls: number
}
```

预算状态应由服务端存储，不能只放在 LangGraph state 中相信客户端。LangGraph 可以根据预算不足进入降级节点，例如使用更便宜模型、跳过可选反思或请求用户确认追加预算。

## 6. 重试策略也要有费用上限

重试不能只看错误码。身份失效、模型不存在和请求格式错误通常不应在同一账号重复；临时限流、连接重置和上游 5xx 才适合有限重试。每次重试前还要检查总 attempt 数、累计等待时间和平台已吸收成本。

调度记录应保存候选账号、选择原因、失败类别、冷却时间和是否产生 usage。这样线上成本突然增加时，可以判断是用户调用变多，还是某个渠道频繁失败导致平台承担了大量无效尝试。

对客户端返回错误前，网关要先完成最后一次 attempt 的计量处理。不能因为最终没有成功响应，就把前面所有上游证据一起丢弃。

## 7. 总结

用户操作、Agent run、逻辑模型调用和上游 attempt 是四个不同层级。用户账单通常按逻辑调用结算，上游成本则按每次 attempt 记录，两者的差额反映路由质量和平台利润。

下一篇会把这些高频状态放进 Redis 和异步任务。目标不是把数据库替换掉，而是让准入与统计更快，同时保证缓存和队列出现问题时账本仍然正确。
