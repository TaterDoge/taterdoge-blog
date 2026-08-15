---
title: "第 13 章　规格提案：/opsx:propose"
pubDate: 2026-04-21
description: "讲解 /opsx:propose 如何把需求转换成 proposal 与 spec，明确允许变化、边界和验收标准。"
tags: [AI编程, SDD, 企业级实战]
category: AI编程
draft: false
---
原文链接：[https://xiaobot.net/post/46e260cf-8ba3-45a3-a707-2459c96b3a7b](https://xiaobot.net/post/46e260cf-8ba3-45a3-a707-2459c96b3a7b)

#

> 第三部分：实战篇

上一章用 Pencil 把「长什么样」钉住了。接下来这一章，要把「允许怎么动、不允许怎么动」写成机器和人都能对账的东西。

在说 /opsx:propose 之前，先说它要解决的问题长什么样。

我见过最典型的一次翻车：前后端各写了两周，联调那天发现对同一个接口的理解完全不同。后端觉得 prize 是奖品 ID，前端觉得是完整对象。没有 spec，谁也没错——各自按「合理理解」实现的。改哪边都不轻松，前端状态机已经绕着对象结构写了一圈。那次重构花了三天，比当初写规格的成本高了五倍。

/opsx:propose 干的事，就是在动代码前把这些「各自合理的理解」**强制落成文字**。不是写散文，是**生成一套能跟着项目走的契约包**：[proposal.md](http://proposal.md)、[design.md](http://design.md)、各模块 [spec.md](http://spec.md)、[tasks.md](http://tasks.md)。每份文档分工不同，缺一份都会在某个节点变成隐形债务。

## 13.1 [proposal.md](http://proposal.md)：四段结构，少一段都痛

触发后，通常先有 [proposal.md](http://proposal.md)，结构固定成四块。固定是关键——格式一旦统一，新人、AI、三个月后的你，都知道去哪找什么。

**Why**——为什么要做，一到三句，说清楚痛点。本案例类似：

> 移动端游戏落地页玩法上新频繁，缺统一骨架与复用机制；每次从零搭，周期长、质量波动大。接新玩法平均要两周，且强依赖熟悉代码的人。

这一段的作用不是写给当下的人看——当下每个人都知道为什么要做。它是写给**三个月后被拉来的人**看的：快速重建背景，不用开会问。

**What Changes**——到底改了什么，新增能力和改掉的行为逐条列清。「新增」和「改变」要分开，改变往往意味着风险，不分开就容易漏评估。

**Capabilities**——本次变更带来的能力清单，每条通常对应一个 spec 文件：

```
- game-plugin-interface: GamePlugin 标准接口 + 注册表
- bff-game-api: init / play / result 三个标准端点
- campaign-service: SQLite 活动管理 + 业务逻辑
- game-grid9 / game-spin-wheel / game-blind-box: 三个玩法组件
- skin-system: CSS Variables 皮肤切换
- demo-landing-page: 参考实现
```

每条能力对应一份 spec，不是一个功能点。粒度差一级，后面 AI 生成代码时的边界就糊一圈。

**Impact**——对现有系统的影响与风险：部署、数据、兼容、回滚。这段很多人省掉，省掉的代价通常在上线那天结清。哪怕只写一句「本次无 DB migration，可独立回滚」，值。

四段写完，三个月后的你、新来的同事、被拉来救场的 AI，都能在同一页上对齐「这次到底在折腾啥」。

对比「只丢个需求群公告」的传统做法：**proposal 是可 diff、可归档、可引用的**，群消息三天后沉了，永远找不到当时说过什么。[proposal.md](http://proposal.md) 进了仓库，就是永久的。

## 13.2 [design.md](http://design.md)：决策要编号，别靠脑内缓存

架构决策建议用 D1、D2... 编号，每条包含：**结论、原因、备选、风险**。本案例五条决策展开来是这样：

编号

决策

结论

备选被否原因

D1

仓库结构

pnpm workspace Monorepo

独立仓库需发包管理税；单仓扩展成本线性增长

D2

部署拆分

BFF 与 Service 分容器部署

合部署耦合度高，Service 横向扩不开

D3

玩法扩展

插件注册表 + 统一接口

硬编码 switch 每加玩法要动主应用

D4

存储层

SQLite

PG 运维成本高，此场景 QPS 不到 100，SQLite 够用

D5

换肤机制

CSS Variables + token 文件

JS 注入方案运行时开销大，且不可静态 lint

每条决策都有编号之后，代码里的注释可以直接引用：

```
// D3: 插件注册表统一管理玩法，新增不需改 core
registry.register('grid9', GridPlugin)
```

以后有人杠「为啥不用 PostgreSQL」，不用拉人开会，也不用翻三年前的群聊。打开 [design.md](http://design.md)，**D4 的账就在那**：当时 QPS 评估、SQLite 的选择理由、以及「什么情况下需要迁移 PG」的迁移条件。

企业里这叫**决策可追溯**：审计、复盘、架构评审，省掉的不只是口水——是「下个 AI Agent 接手这个项目时，能不能还原出当时的思路」。不留编号，它只能猜。

## 13.3 [spec.md](http://spec.md)：接口 + MUST/SHOULD + 错误码

每个模块一份 spec，建议固定骨架，减少「每个文件一种写法」的噪音。以 bff-game-api 为例，完整骨架长这样：

```
# bff-game-api Spec
## Endpoints
### POST /api/game/:gameId/init
- 请求：{ userId: string, gameId: string }
- 响应：{ remainingPlays: number, config: GameConfig }
### POST /api/game/:gameId/play
- 请求：{ userId: string, gameId: string }
- 响应：{ prize: Prize, remainingPlays: number }
### POST /api/game/:gameId/result
- 请求：{ userId: string, prizeId: string }
- 响应：{ confirmed: boolean }
## 行为约束
- 每次 play MUST 在单个 DB 事务内完成检查与落库
- remainingPlays 为 0 时 MUST 返回 403，不扣次数
- prize MUST NOT 为 null（无奖用「谢谢参与」条目表达）
- config SHOULD 包含皮肤 token，但允许降级为默认皮肤
- result 接口 MAY 幂等处理重复确认请求
## 错误码
| code | 触发条件 | HTTP 状态 |
|------|---------|---------|
| GAME_NOT_FOUND | gameId 不存在 | 400 |
| NO_REMAINING_PLAYS | 次数耗尽 | 403 |
| DB_FAILURE | 事务失败 | 500 |
```

**MUST / SHOULD / MAY** 三个词不是装饰，是 RFC 2119 定义的约束强度，写代码时、review 时、写测试时各有对应的处理方式：

- **MUST**：没做到就是 bug，不商量

- **SHOULD**：推荐做到，有充分理由可以例外，但例外要在注释里写明

- **MAY**：允许实现，也允许不实现

这套格式的价值在于：**AI 生成代码时读同一份表，审查时也按同一列清单打勾**。传统口头约定的问题不是「说错了」，而是「每个人记住的版本不一样」。[spec.md](http://spec.md) 进了仓库，约定就有了唯一版本。

## 13.4 [tasks.md](http://tasks.md)：78 条二进制验收

[tasks.md](http://tasks.md) 是可执行验收清单，按模块分组，每条只有两个状态：过，或者没过。

「二进制」这个限制是刻意的。「基本完成」「差不多好了」「除了边界情况都 OK」——这些都是生产事故的前身。验收条件要么过，要么没过，不设中间态。

以 campaign-service 为例：

```
[ ] init 返回 200 + InitResponse，字段类型与 spec 一致
[ ] play 在单一 DB 事务内完成（可通过日志或测试验证）
[ ] 剩余次数为 0 时 play 返回 403，次数不变
[ ] 权重之和 ≠ 1 时 drawPrize 触发兜底逻辑，不崩
[ ] DB 事务失败时返回 DB_FAILURE，上层可感知
[ ] Seed 数据包含 demo-grid9 / demo-spin-wheel / demo-blind-box 三条活动
```

本案例 78 条从哪来？不是拍脑袋——每条对应 [spec.md](http://spec.md) 里的一条 MUST 约束，或者一个已知的边界情况。spec 写得越细，tasks 越能自动推导出来。/opsx:propose 执行时，AI 会扫描所有 spec 文件的 MUST 约束，逐条翻译成验收条目。

「能跑」和「做完」之间，差的就是这一屏勾。

尤其在 AI 参与开发的场景里，[tasks.md](http://tasks.md) 还有另一层价值：**它是 AI 的完工信号**。Agent 执行 Task 结束时，拿 [tasks.md](http://tasks.md) 对账——还有没勾的条目，继续；全勾了，提 PR。不用 reviewer 每次重新发明验收标准，也不用 AI 自己判断「我觉得做完了」。做完的定义在文件里，不在某人脑子里。

从企业视角看：78 条验收清单进了仓库，下次上同类玩法时直接 fork 改一改，不用从零写。**可复制的验收标准，才是真正的工程资产**。

下一章，把这些规格**翻译成实施计划**：/writing-plans 如何把 15 个 Task、依赖、验证步骤排成一条能交给 AI 执行的生产线。
