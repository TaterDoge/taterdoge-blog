---
title: "225 流式响应中的 Token 计量"
pubDate: 2026-08-05
description: "AI 对话通常采用 SSE。客户端会不断收到文本片段，最后才收到完成事件和 usage。只要最后一个事件正常到达，计量并不困难；问题集中在连接提前结束的时候。"
tags: [AI编程, 计费系统, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-05
---
原文链接：[https://aicompanion.usehook.cn/6streaming-token-metering/](https://aicompanion.usehook.cn/6streaming-token-metering/)

## 1. 流已经结束，账却不一定完整

AI 对话通常采用 SSE。客户端会不断收到文本片段，最后才收到完成事件和 usage。只要最后一个事件正常到达，计量并不困难；问题集中在连接提前结束的时候。

用户关闭页面后，浏览器连接会取消，但上游模型可能已经生成了更多 Token。中转站如果立即丢弃请求上下文，就拿不到最终 usage；如果继续在后台读取，又需要限制最长时间和资源占用。

因此，流式代理不能只是 `return new Response(upstream.body)`。它还要在转发数据的同时识别协议事件、保存最终用量，并把结算任务从客户端连接生命周期中分离出来。

## 2. 给流式请求建立状态

一次流式请求可以用下面几个状态描述：

stream-state.ts

```typescript
export type StreamBillingState =
  | 'forwarding'
  | 'provider_completed'
  | 'client_disconnected'
  | 'provider_failed'
  | 'usage_missing'
  | 'settled'
```

`client_disconnected` 和 `provider_failed` 不是同一件事。客户端断开后，中转站可能仍然成功读到上游完成事件；上游失败则可能只产生部分输出。状态需要分别记录，后续对账才能知道 usage 为什么缺失。

系统还要保存 `firstTokenAt`、`lastChunkAt`、`providerCompletedAt` 和收到的字节数。这些数据既能帮助排查计费，也能计算首 Token 延迟和流中断率。

## 3. 边转发边解析 SSE

SSE 数据不是按事件边界到达的。一个网络 chunk 可能只包含半行，也可能同时包含多个事件，因此解析器必须保留残余字符串，按空行切出完整事件。

sse-usage-tap.ts

```typescript
export class SseUsageTap {
  private pending = ''
  private finalUsage: NormalizedUsage | null = null

  push(chunk: Uint8Array) {
    this.pending += new TextDecoder().decode(chunk, { stream: true })
    const events = this.pending.split('\n\n')
    this.pending = events.pop() ?? ''

    for (const event of events) {
      const usage = parseProviderUsageEvent(event)
      if (usage) this.finalUsage = usage
    }
  }

  result() {
    return this.finalUsage
  }
}
```

真实实现应复用同一个 `TextDecoder`，并处理 `\r\n`、多行 `data:`、注释心跳和厂商特有事件。这里展示的是计量边界，不是完整 SSE 解析库。

解析发生在旁路中，原始字节仍按原顺序交给客户端。不要先把整个响应读进内存再返回，那会失去流式体验，也可能让长回答占用大量内存。

## 4. 客户端断开后是否继续读取

有两种常见策略。第一种是在客户端断开时取消上游请求，尽量停止继续产生费用；第二种是将上游读取转入短时间的后台任务，争取拿到最终 usage。

标准实现可以先发送取消信号，同时给结算任务一个独立、有限时长的 context。上游能够立即停止时，按已经返回的 usage 结算；上游仍然发送完成事件时，后台读取到 usage 后再结算；超过截止时间则进入 `usage_missing`。

在 Cloudflare Workers 中，可以用 `ctx.waitUntil()` 承接短时结算和日志写入，但它不是无限期后台服务。耗时较长的对账应提交到 Queue，由独立消费者处理。Node 运行时则可以使用受控 worker pool，不能为每个断开的请求随意创建没有上限的 Promise。

## 5. 没有最终 Usage 的处理顺序

usage 缺失时，系统按证据强弱依次尝试：查询厂商的请求用量接口、读取上游响应头或中间累计事件、使用目标模型 tokenizer 估算。每一步都要记录来源。

如果已经向用户输出了大量内容，直接按零费用结算会造成稳定漏收；直接按 `max_tokens` 收费又可能严重多收。更合理的方式是先从预占中保留一笔待结算金额，创建 `pending_reconciliation` 事件，等对账任务拿到更可靠数据后 capture 或 release。

估算时输入内容相对容易恢复，输出只能根据已经经过代理的文本与工具调用参数计算。模型在断开后继续生成但没有经过代理的部分，平台 tokenizer 无法得知，这也是为什么上游请求 ID 和厂商账单接口很重要。

## 6. 结算不能依赖请求 Context

HTTP 请求结束后，原始 context 通常会被取消。如果异步结算继续使用它，数据库事务可能在写到一半时失败。应当在请求期间构造一个只包含计费快照的对象，再使用独立超时执行结算。

settlement-input.ts

```typescript
export interface SettlementInput {
  requestId: string
  holdId: string
  pricingVersionId: string
  usage: NormalizedUsage
  usageEvidenceHash: string
  completedAt: Date
}
```

不要把完整 Request、Response、Prompt 或大块缓冲区传给 worker。它们会延长内存生命周期，也可能把敏感内容带入不需要访问正文的账务模块。

结算接口自身必须幂等。网络层可能在 stream close、provider completed 和后台补偿三个位置都尝试结算，同一个 `requestId` 最终只能成功应用一次。

## 7. 总结

流式计量要同时管理两条生命周期：面向客户端的内容转发，以及面向平台的上游读取和账务结算。客户端断开不能直接等同于零用量，上游完成也不能因为请求 context 取消而丢失账单。

有了稳定的 usage，下一篇就可以实现费用计算引擎。我们会把不同 Token 桶、价格版本、倍率和舍入规则放进一个可测试的纯函数，避免金额计算散落在各个路由中。
