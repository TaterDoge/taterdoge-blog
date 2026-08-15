---
title: "223 模型定价中心"
pubDate: 2026-08-05
description: "客户端请求 claude-sonnet，中转站可能把它映射到某个带日期的模型版本，也可能因为渠道故障切换到另一个兼容模型。只拿客户端传来的字符串查价格，很容易出现收错模型费用的问题。"
tags: [AI编程, 计费系统, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-05
---
原文链接：[https://aicompanion.usehook.cn/4model-pricing-center/](https://aicompanion.usehook.cn/4model-pricing-center/)

## 1. 模型名称不能直接当价格键

客户端请求 `claude-sonnet`，中转站可能把它映射到某个带日期的模型版本，也可能因为渠道故障切换到另一个兼容模型。只拿客户端传来的字符串查价格，很容易出现收错模型费用的问题。

计费链路中至少会出现三个名称：`requestedModel` 是客户端请求的名称，`upstreamModel` 是最终发给厂商的名称，`billingModel` 是价格中心使用的标准名称。它们相同时最简单，不同时必须全部保存。

Sub2API 的用量表也分别记录 requested model 和 upstream model，并在渠道映射后选择计费模型。这样既能向用户说明请求了什么，也能核算平台实际上使用了什么。

## 2. 价格需要版本和生效时间

直接更新模型价格会改变历史语义。昨天调用时输入价格是 3 美元每百万 Token，今天调成 2 美元后，如果账单只保存模型名称，重新计算昨天费用就会得到不同结果。

价格记录应该采用版本化设计：

model-price-version.ts

```typescript
export interface ModelPriceVersion {
  id: string
  provider: 'openai' | 'anthropic' | 'google'
  billingModel: string
  inputUsdPerToken: string
  outputUsdPerToken: string
  cacheWriteUsdPerToken: string
  cacheReadUsdPerToken: string
  reasoningUsdPerToken: string | null
  effectiveFrom: Date
  effectiveTo: Date | null
  source: 'remote' | 'admin' | 'fallback'
  sourceHash: string
}
```

请求开始时用 `startedAt` 查询有效版本，把版本 ID 和具体单价写入计费上下文。即使响应跨过价格切换时间，也继续使用请求开始时的快照，这样用户看到的价格不会在一条流中变化。

## 3. 建立明确的价格优先级

一个模型可能同时存在平台默认价、渠道覆盖价和管理员临时价格。解析顺序必须固定，否则后台页面和真实扣费可能使用不同结果。

推荐的优先级是：渠道指定模型价格、平台人工覆盖价格、已校验的远程价格、内置应急价格。每次命中哪一层都要记录到 `source`，不能只返回一组数字。

pricing-resolver.ts

```typescript
export interface PricingQuery {
  billingModel: string
  channelId: string
  pricingAt: Date
}

export interface ResolvedPricing {
  versionId: string
  billingModel: string
  source: 'channel' | 'admin' | 'remote' | 'fallback'
  prices: ModelPriceVersion
}

export interface PricingResolver {
  resolve(query: PricingQuery): Promise<ResolvedPricing>
}
```

Sub2API 会同步 LiteLLM 格式的模型价格，并在远程数据不可用时读取本地文件或硬编码回退价。这个思路适合保证服务启动，但回退表必须有更新时间、校验和告警，不能悄悄使用多年以前的价格。

## 4. 未知价格必须在转发前处理

价格缺失最危险的处理方式是把费用记为零后继续转发。上游成本已经发生，平台却没有收费依据。尤其是模型名称映射错误时，这种问题可能持续很久才从财务报表中暴露。

标准链路会在请求转发前执行价格预检。模型不支持、Token 计费字段缺失或价格版本已过期时，直接返回明确错误，并把模型名称和渠道写入告警。

require-pricing.ts

```typescript
export async function requirePricing(
  resolver: PricingResolver,
  query: PricingQuery,
) {
  const pricing = await resolver.resolve(query)

  if (!pricing.prices.inputUsdPerToken ||
      !pricing.prices.outputUsdPerToken) {
    throw new Error('BILLING_PRICE_UNAVAILABLE')
  }

  return pricing
}
```

按图片、视频或请求次数计费的能力不要求 Token 单价，但必须显式声明 `billingMode`。不能因为 Token 价格为空，就猜测它是免费或按次计费。

## 5. 倍率与单价要分开保存

用户售价常写成“官方价格乘 0.8 倍”。倍率很方便，但不能覆盖基础单价。账单应同时保存基础费用、用户倍率、最终售价和上游账号成本倍率。

分开以后可以回答两类问题：用户为什么被扣这些钱，以及平台这次请求是否盈利。假设用户倍率为 0.8，上游账号实际成本倍率为 0.7，毛利并不是简单的 0.1 美元，还要使用同一份基础价格和实际 Token 计算。

高峰倍率也应根据请求开始时间冻结。请求在 21:59 开始、22:01 结束，不应把前半段和后半段拆成不同价格。后台展示价格时要使用与网关相同的 resolver，避免预览和扣费各写一套规则。

## 6. 更新价格时怎样避免事故

远程价格同步至少要经过 JSON 结构校验、模型数量检查、哈希比较和异常波动检查。如果新文件让大量常用模型价格突然归零，应该拒绝发布，而不是立即覆盖生产数据。

价格发布可以采用下面的过程：下载到候选版本、解析并校验、计算与当前版本的差异、管理员确认异常变化、写入新版本、灰度解析、最后切换生效时间。旧版本继续保留，供历史账单复算。

测试时不要只验证某个模型的固定数字，还要覆盖模型别名、带日期后缀、渠道覆盖、缓存价格缺失、长上下文规则和版本切换边界。价格中心一旦算错，后续事务做得再严谨，也只是稳定地扣错钱。

## 7. 总结

定价中心负责把请求使用的模型名称、渠道和时间解析成一份不可变价格快照。历史账单引用版本，新请求按生效时间获取新版本，两者互不影响。

价格确定后，下一步才是取得准确用量。不同厂商对输入、缓存和推理 Token 的字段定义并不一致，我们需要先把这些响应适配成同一种内部结构。
