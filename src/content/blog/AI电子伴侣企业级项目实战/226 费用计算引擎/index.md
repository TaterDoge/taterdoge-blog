---
title: "226 费用计算引擎"
pubDate: 2026-08-05
description: "路由负责接收请求，适配器负责解析 usage，价格中心负责返回价格快照。真正的金额计算不需要访问数据库、Redis 或网络，最好实现成纯函数。"
tags: [AI编程, 计费系统, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-05
---
原文链接：[https://aicompanion.usehook.cn/7billing-calculation-engine/](https://aicompanion.usehook.cn/7billing-calculation-engine/)

## 1. 费用计算应该是一段纯逻辑

路由负责接收请求，适配器负责解析 usage，价格中心负责返回价格快照。真正的金额计算不需要访问数据库、Redis 或网络，最好实现成纯函数。

纯函数有两个好处。相同输入永远得到相同结果，历史账单可以重放；测试也不需要搭建完整网关，只要准备价格和 Token 数量即可覆盖边界。

计算结果不能只有总金额，还要返回每一部分费用，方便后台展示和对账。

## 2. 定义计算输入与输出

billing-calculator.ts

```typescript
export interface BillingCalculationInput {
  usage: NormalizedUsage
  pricing: ResolvedPricing
  userRate: string
  accountCostRate: string
  billingMode: 'token' | 'per_request' | 'image' | 'video'
  requestCount: number
}

export interface CostBreakdown {
  inputMicroUsd: bigint
  outputMicroUsd: bigint
  cacheWriteMicroUsd: bigint
  cacheReadMicroUsd: bigint
  reasoningMicroUsd: bigint
  baseMicroUsd: bigint
  chargedMicroUsd: bigint
  upstreamCostMicroUsd: bigint
}
```

`userRate` 决定用户售价，`accountCostRate` 用于估算平台真实成本。两者不能共用一个字段，否则渠道采购价调整会意外改变用户账单。

## 3. Token 模式怎样计算

每个桶的基础费用都等于 Token 数量乘每 Token 单价。所有乘法在高精度十进制环境中完成，最后统一舍入成微美元。

calculate-token-cost.ts

```typescript
import Decimal from 'decimal.js'

function toMicroUsd(tokens: number, usdPerToken: string) {
  return BigInt(
    new Decimal(tokens)
      .mul(usdPerToken)
      .mul(1_000_000)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toFixed(0),
  )
}

export function calculateTokenCost(input: BillingCalculationInput) {
  const { usage, pricing } = input
  const p = pricing.prices

  const inputCost = toMicroUsd(
    usage.regularInputTokens,
    p.inputUsdPerToken,
  )
  const outputCost = toMicroUsd(
    usage.outputTokens,
    p.outputUsdPerToken,
  )
  const cacheWriteCost = toMicroUsd(
    usage.cacheWriteTokens,
    p.cacheWriteUsdPerToken,
  )
  const cacheReadCost = toMicroUsd(
    usage.cacheReadTokens,
    p.cacheReadUsdPerToken,
  )

  return { inputCost, outputCost, cacheWriteCost, cacheReadCost }
}
```

示例代码使用 `decimal.js` 表达算法，实际项目可以选择同类高精度库。不要先把价格转成 `number`，否则精度在进入 Decimal 之前已经丢失。

## 4. 推理、缓存和长上下文

推理 Token 的口径由厂商决定。OpenAI 和 Anthropic 当前都把 reasoning 或 thinking 作为输出总量的明细，因此适配器拆分后，价格中心要明确推理是否与普通输出同价。价格未单独配置时，可以按输出价计算，但必须把这个回退规则写进价格版本。

Anthropic 的缓存创建还可能区分 5 分钟和 1 小时 TTL。此时 `cacheWriteTokens` 需要进一步拆桶，不能把两种缓存全部按同一价格处理。上游没有返回 TTL 明细时，应使用配置中的保守默认值并记录回退标记。

长上下文价格通常由总输入量触发。判断阈值时要确认普通输入、缓存创建和缓存读取是否都计入上下文，再对整个请求的输入和输出应用对应倍率。不能只把超过阈值的那一小段 Token 乘倍率，除非厂商价格规则明确这样规定。

Service Tier、高峰倍率和用户分组倍率也应在请求开始时冻结。计算引擎只读取快照，不在结算阶段根据当前时间重新判断。

## 5. 不按 Token 计费的能力

图片、视频、网页搜索和部分工具调用可能按张、按秒或按次计费。计算引擎通过 `billingMode` 选择公式，而不是看到 Token 为零就假定免费。

calculate-request-cost.ts

```typescript
export function calculatePerRequestCost(input: {
  unitPriceMicroUsd: bigint
  count: number
  rateNumerator: bigint
  rateDenominator: bigint
}) {
  const base = input.unitPriceMicroUsd * BigInt(input.count)
  return base * input.rateNumerator / input.rateDenominator
}
```

视频按秒计费时还要保存分辨率和实际时长。图片编辑可能同时包含输入图片 Token 和输出图片 Token，不能因为业务名称是“生图”就全部切到按张模式。计费模式应由渠道价格配置与上游响应共同确定。

## 6. 舍入规则决定能否对账

金额可以在每个桶分别舍入，也可以先汇总高精度费用再对总额舍入，两种结果在小额请求上可能相差一个最小单位。平台必须固定一种规则，并在价格版本中记录 `roundingMode` 和 `currencyScale`。

推荐先按高精度计算各桶原始费用，汇总后应用用户倍率，最后只舍入一次得到扣费金额；各桶展示金额可以按比例分配舍入差额。这样不会因为 Token 被拆成更多桶而改变总费用。

退款和冲正必须使用原账单保存的最终整数金额，不能拿当前价格重新计算。重新计算只用于验证，不作为资金变动的直接依据。

## 7. 总结

费用计算引擎接收归一化 usage 和不可变价格快照，输出可解释的费用明细。它不读取外部状态，也不修改余额，因此可以独立进行大量边界和属性测试。

费用能算清以后，还不能立即把所有请求送到上游。下一篇会在调用前检查用户、套餐、额度和容量，确定什么请求有资格进入真正产生费用的环节。
