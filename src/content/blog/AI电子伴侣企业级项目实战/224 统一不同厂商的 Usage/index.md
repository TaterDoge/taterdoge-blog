---
title: "224 统一不同厂商的 Usage"
pubDate: 2026-08-05
description: "OpenAI、Anthropic 和 Gemini 的响应里都能找到 Token 用量，看起来只要改几个字段名就能统一。真正实现时会发现，最麻烦的不是命名，而是字段之间是否包含。"
tags: [AI编程, 计费系统, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-05
---
原文链接：[https://aicompanion.usehook.cn/5usage-normalization/](https://aicompanion.usehook.cn/5usage-normalization/)

## 1. 厂商都返回 Usage，但口径并不相同

OpenAI、Anthropic 和 Gemini 的响应里都能找到 Token 用量，看起来只要改几个字段名就能统一。真正实现时会发现，最麻烦的不是命名，而是字段之间是否包含。

OpenAI 的 `input_tokens` 包含缓存读取量，`output_tokens` 又包含 reasoning token。Anthropic 把普通输入、缓存创建和缓存读取分成三个可以相加的桶。Gemini 的 `promptTokenCount` 包含缓存内容，`thoughtsTokenCount` 则单独参与总量。

如果适配器没有先弄清包含关系，就会把同一批 Token 放进两个计费桶。账单数值可能只多几厘，但调用量上来以后会形成稳定偏差。

## 2. 先固定内部口径

归一化结构不能只追求字段齐全，还要给每个字段写清楚不变量：

usage-contract.ts

```typescript
export interface NormalizedUsage {
  regularInputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  reasoningTokens: number
  imageInputTokens: number
  imageOutputTokens: number
  toolCalls: number
  source: 'provider' | 'estimated'
}
```

这里规定 `regularInputTokens` 不包含缓存创建和缓存读取；`outputTokens` 是否包含推理量由适配器转换成统一约定。为了适配当前厂商，课程将 `outputTokens` 定义为**可见输出与普通输出的部分**，推理量单独放入 `reasoningTokens`。如果某厂商只提供包含推理的输出总数，适配器需要在确认 reasoning 是子集后做减法。

每个字段都要保证大于等于零。上游数据出现矛盾时，不能让减法产生负数后继续计费，而应标记解析异常并保存原始 usage 摘要。

## 3. 三种响应怎样转换

下面的图把三套字段收敛到同一结构：

OpenAI Responses API 当前提供 `input_tokens`、`input_tokens_details.cached_tokens`、`output_tokens` 和 `output_tokens_details.reasoning_tokens`。由于缓存和推理字段都是明细，普通量需要从总量中扣除。

openai-usage-adapter.ts

```typescript
export function fromOpenAI(usage: OpenAIUsage): NormalizedUsage {
  const cached = usage.input_tokens_details?.cached_tokens ?? 0
  const reasoning = usage.output_tokens_details?.reasoning_tokens ?? 0

  return {
    regularInputTokens: Math.max(0, usage.input_tokens - cached),
    outputTokens: Math.max(0, usage.output_tokens - reasoning),
    cacheWriteTokens: 0,
    cacheReadTokens: cached,
    reasoningTokens: reasoning,
    imageInputTokens: 0,
    imageOutputTokens: 0,
    toolCalls: 0,
    source: 'provider',
  }
}
```

Anthropic Messages API 的普通输入、`cache_creation_input_tokens` 和 `cache_read_input_tokens` 是三个独立部分。官方文档说明，总输入量应当由三者相加。`output_tokens_details.thinking_tokens` 是 `output_tokens` 的子集，因此仍然要避免重复。

Gemini 的 `promptTokenCount` 包含 `cachedContentTokenCount`，普通输入需要做减法；`candidatesTokenCount` 和 `thoughtsTokenCount` 则分别进入普通输出和推理桶。Gemini 还能按 modality 返回文本、图片、音频和视频明细，计费模型有独立多模态价格时应继续拆分。

这些字段会随着 API 演进，适配器实现前应核对 [OpenAI Usage](https://platform.openai.com/docs/api-reference/responses-streaming/response/reasoning_text/done)、[Claude Messages](https://platform.claude.com/docs/en/api/typescript/messages/create) 和 [Gemini UsageMetadata](https://ai.google.dev/api/generate-content) 的当前定义，而不是复制旧博客中的类型。

## 4. 原始响应仍然要保留证据

归一化以后不需要把完整模型响应写入数据库，其中可能包含用户隐私和大量文本。但计费审计至少要保留厂商、响应 ID、usage 哈希、原始字段版本和安全裁剪后的 usage JSON。

usage-evidence.ts

```typescript
export interface UsageEvidence {
  provider: string
  providerResponseId: string | null
  adapterVersion: string
  rawUsage: Record<string, unknown>
  rawUsageHash: string
}
```

`adapterVersion` 用来说明当时使用哪一版转换规则。以后发现某个版本把缓存量算重了，可以按版本筛出受影响事件，批量生成冲正记录，而不是猜测哪些历史账单可能有问题。

原始 usage 也需要白名单过滤，只保存计费字段。不要把整个 SSE 事件或 Prompt 放进账务表，内容审计和财务审计应使用不同的数据边界与保留周期。

## 5. 缺失 Usage 时怎么办

非流式请求通常能在最终响应拿到 usage，但网络超时、客户端断开或厂商异常可能让最后一个事件缺失。系统可以用与目标模型匹配的 tokenizer 估算输入和已经收到的输出，不过估算不是精确账单。

推荐把结果分成三种状态：`exact` 表示厂商返回完整 usage；`partial` 表示只拿到部分厂商计数；`estimated` 表示全部由本地估算。`partial` 和 `estimated` 先进入待对账队列，是否立即扣费由平台策略决定。

不要把 `total_tokens = 0` 当作免费。它既可能表示模型没有产生费用，也可能是适配器没有识别新字段。判断时要结合 HTTP 状态、是否收到内容、厂商响应 ID 和原始 usage 是否存在。

## 6. 适配器测试要覆盖包含关系

测试不能只断言字段映射成功，还要验证所有计费桶互斥。可以为每个厂商准备一组真实结构的脱敏 fixture，再检查：普通输入加缓存是否等于厂商总输入，普通输出加推理是否等于厂商输出口径，任何字段缺失时是否使用零值，以及矛盾数据是否进入异常分支。

usage-invariant.ts

```typescript
export function assertUsage(usage: NormalizedUsage) {
  for (const [name, value] of Object.entries(usage)) {
    if (typeof value === 'number' && (!Number.isInteger(value) || value < 0)) {
      throw new Error(`INVALID_USAGE_${name}`)
    }
  }
}
```

工具调用还可能产生按次费用。Anthropic 和 Gemini 的服务端搜索、代码执行等能力不一定包含在 Token 单价中，适配器要把调用次数作为独立计量维度交给费用引擎，不能硬塞进 Token 字段。

## 7. 总结

Usage 归一化的核心是统一包含关系，而不是统一字段名称。每个厂商适配器都要输出互斥计费桶、证据来源和适配器版本，并在字段缺失时明确标记估算状态。

下一篇会继续处理流式响应。流式链路的内容会边生成边发送，usage 往往最后才到，客户端断开又不等于上游立即停止，这让结算时机比非流式请求复杂得多。
