---
title: "231 Redis 缓存与异步入账"
pubDate: 2026-08-05
description: "每次请求都从 PostgreSQL 查询余额、套餐、日额度和 RPM，会让准入延迟随着流量增加。Redis 很适合保存这些高频读状态，但不能因此成为唯一账本。"
tags: [AI编程, 计费系统, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-05
---
原文链接：[https://aicompanion.usehook.cn/12billing-cache-async/](https://aicompanion.usehook.cn/12billing-cache-async/)

## 1. Redis 负责速度，数据库负责事实

每次请求都从 PostgreSQL 查询余额、套餐、日额度和 RPM，会让准入延迟随着流量增加。Redis 很适合保存这些高频读状态，但不能因此成为唯一账本。

数据库事务提交后，余额变化已经成立；Redis 只是它的读模型。缓存丢失可以重建，账本丢失无法通过缓存恢复。设计时先确认这条边界，后面的失效和降级才不会反过来控制财务结果。

## 2. 哪些内容适合缓存

余额、订阅状态、API Key 配置、价格版本和周期配额都可以缓存。不同数据的更新特点不同，不能共用一个简单 TTL。

余额在每次结算后变化，适合按用户缓存并携带版本号；API Key 与分组配置更新较少，可以使用较长 TTL 和主动失效；价格版本在生效前加载，命中后保持不可变；RPM、TPM 和并发本身就是短生命周期计数器。

billing-cache.ts

```typescript
export interface BillingCache {
  getAccount(userId: string): Promise<CachedBillingAccount | null>
  setAccount(account: CachedBillingAccount): Promise<void>
  invalidateAccount(userId: string): Promise<void>
  incrementQuota(key: string, amountMicroUsd: bigint): Promise<void>
  acquireConcurrency(key: string, limit: number): Promise<boolean>
  releaseConcurrency(key: string): Promise<void>
}
```

缓存 key 要带 schema 版本。数据结构升级后，旧值应当被视为 miss 并回源，而不是按缺失字段的零值继续判断。

## 3. 防止缓存击穿

热门用户的缓存同时过期时，大量请求会一起查询数据库。可以使用 singleflight 把相同用户的并发回源合并成一次。

回源任务不要直接共享第一个 HTTP 请求的 context。第一个用户断开连接时，其他等待者仍然需要结果。可以为数据库加载创建独立短超时，并让每个调用者只控制自己的等待时间。

数据库中没有额度配置时，也可以缓存一个短 TTL 的 sentinel，避免每个请求都查询“没有这行数据”。sentinel TTL 应明显短于正常配置，管理员新建额度后还要主动失效。

周期窗口切换时不要先删除配额 key。删除与回填之间到达的增量可能因为 key 不存在而丢失。应当通过 Lua 或事务原子重置窗口起点和计数，再继续累加。

## 4. 核心扣费不能只进异步队列

用量记录和统计适合异步，但核心结算不能在没有可靠落盘的情况下只把任务塞进内存队列。进程崩溃、队列满或部署重启都会造成漏扣。

可靠做法有两种：请求结束后同步完成短事务，再异步更新统计；或者把结算命令写入持久化队列并保留预占，消费者成功 capture 后才结束。第二种延迟更高，适合无法在响应生命周期中完成的任务。

Sub2API 使用固定 worker pool 处理缓存写入，避免每个请求创建 goroutine，并在队列满时为关键任务同步回退。TypeScript 实现也应限制消费者数量和缓冲区，不能用不受控的 `void promise()` 代替队列。

## 5. 异步任务要有背压

队列堆积说明消费者速度低于生产速度。继续无限接收会让内存或 Redis 先耗尽，因此需要定义高水位、最大等待时间和降级动作。

低余额通知、仪表盘刷新可以延迟或合并；缓存失效失败可以让下次请求回源；核心结算任务队列达到上限时则应同步结算或拒绝新请求。任务重要性不同，不能统一选择丢弃最旧消息。

每个任务都要记录入队时间、尝试次数和最后错误。重试使用指数退避，并设置死信队列。死信不是终点，后台需要显示数量并支持人工重放。

## 6. Cloudflare 部署怎样映射

现有 AI Agent API 使用 Hono 和 Cloudflare D1。小规模版本可以让 D1 保存账本与用量，Durable Object 按用户串行化余额预占和并发计数，Cloudflare Queue 承接对账与聚合任务。

这套实现与 PostgreSQL + Redis 的职责是一致的：D1 或 PostgreSQL 保存事实，Durable Object 或 Redis 负责高频协调，Queue 负责可重试的异步工作。文章代码会通过 repository 和 cache 接口隔离，不把业务规则写死在某个云厂商 API 中。

当部署规模需要多区域、复杂 SQL 对账和大量聚合时，PostgreSQL 的事务、分区和分析生态更适合作为生产基线。迁移时只替换基础设施适配器，不改变价格、用量和结算领域模型。

## 7. 总结

Redis 提升准入和计数速度，异步任务降低请求尾部延迟，但它们都不能替代数据库中的账本事务。缓存失效、队列背压和死信处理必须在设计阶段确定，不能等出现漏账以后再补。

下一篇会讲对账和补偿。即使事务、缓存和队列都设计正确，厂商账单延迟、适配器缺陷和人工操作仍可能造成差异，系统需要主动发现这些问题。
