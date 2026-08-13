---
title: "第 14 章　实施计划：/writing-plans"
pubDate: 2026-04-26
description: "拆解 /writing-plans 如何把规格编译成可执行任务图，明确依赖、文件地图、验收和交付节奏。"
tags: [AI编程, SDD, 企业级实战]
category: AI编程
draft: false
---
原文链接：[https://xiaobot.net/post/798427c4-add5-444a-9be9-f9d7649a6c29](https://xiaobot.net/post/798427c4-add5-444a-9be9-f9d7649a6c29)

fly哥：

## **第 14 章　实施计划：/writing-plans**

### **第三部分：实战篇**

上一章用 /openspec-propose 把需求变成了结构化的 proposal 和 spec。那一刻你很容易飘——感觉万事俱备，可以开工了。

但你一打开编辑器，现实就开始打脸：15 个 spec，先动哪个？game-core 的类型定义依赖 bff-contracts 还是反过来？数据库 migration 得在 service 之前跑还是之后？这些问题，spec 通常不会替你做决定。

这才是 /writing-plans 要解决的事：把规格「编译」成一张可执行的任务图——**有依赖、有边界、有验收**，执行端（人或 Agent）拿到就能干，不需要再猜。

---

### **14.1 粒度的拆分**

拆任务最常见的翻车点，就两个极端：

- **一个 Task 一个模块**：看起来省事，实际是灾难。

- **一个 Task 一个函数**：看起来严谨，实际是毛线团。

我两种都踩过。结论很硬：**粒度不对，执行就乱。**

**太粗的 Task** 有个致命问题：AI 一口气改十几个文件，你根本没法 review diff。更惨的是，做完一个 Task，团队还说不清“到底完成了啥”——验收标准模糊，改了 50% 还是 95%？谁说了算？

**太细的 Task** 则是另一种死法：每个函数独立成一个 Task，依赖图直接炸开；调度成本上去，合并冲突按指数增长。Fly哥见过一个项目拆了 80 个 Task，最后 PM 一句总结特别真实：**“我不知道整体进度到哪了，我只知道每天在合并冲突。”**

所以本章案例把一个中等体量的功能拆成 **15 个 Task**，按层来走：

- **Task 1–3**：基础包（monorepo 初始化、game-core 类型定义与注册表）

- **Task 4**：跨层契约（bff-contracts，所有层共享的类型）

- **Task 5–7**：service 层（DB schema → 业务逻辑 → HTTP 路由）

- **Task 8**：BFF 层

- **Task 9–14**：前端（基座 → 三个玩法组件 → 路由注册 → Demo 页面）

- **Task 15**：联调与验收验证

这个分法背后就一条铁律：**依赖方向决定执行顺序。**

- 底层类型包必须先立住，否则上层全是空中楼阁

- BFF 必须等 service 的接口稳定，否则你写的是“假对接”

- 前端组件必须等基座搭好，否则就是到处补洞

计划的本质，是把运行时才会暴露的依赖错误，提前在纸面上处决掉。别等它在第 4 天用合并冲突的方式找你算账。

---

### **14.2 文件地图先于任务拆分**

大多数工程师习惯是：“想好要做什么，再想在哪做。”/writing-plans 要你反过来：**先把文件结构画出来，再拆 Task。**

这不是形式主义。原因有两个，而且都跟“少踩坑”有关。

**第一，依赖关系在文件层面才看得清。**比如：service/db.ts 先建还是 bff-contracts/types.ts 先建？你不先画文件地图，就很容易出现这种离谱现场——**Task 7 引用了 Task 9 才会创建的类型**。写的时候没感觉，跑起来才报错，然后全员回头重排。

**第二，文件粒度决定 Task 粒度。**一个文件一个清晰职责是原则。如果你发现一个文件要承担三个职责，那不是“我能力强所以塞一起”，那是：**这个文件该拆，对应 Task 也要跟着拆。**

文件地图画完，任务拆分就有了骨架。剩下的事，就是往骨架上填肉——而不是边写边发明骨架。

---

### **14.3 计划文档的四层结构**

**14.3.1 头部：三句话锁定上下文**

每份计划文档必须以这段头部开场：

```
[Feature Name] Implementation Plan
For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
Goal: [一句话描述这个功能建了什么]
Architecture: [2–3 句描述整体技术方案]
Tech Stack: [关键技术栈清单]
```

---

看起来像废话，但它解决的是执行端的“失忆问题”。

- 新同事接手：脑子里没有上下文

- 外包团队上手：只有任务标题，没有系统认知

- 第二天早上继续干：你自己也会忘

这段头部把“我在干什么、为什么这样干、用什么干”压缩进几行字。执行前扫两眼，状态恢复成本从“翻十分钟文档”降到“十秒进入战斗”。

对 Subagent 更关键：每个 Agent 实例天然无状态，Goal + Architecture 就是它的锚点，没有锚点它就会开始猜，开始脑补，开始跑偏。

**14.3.2 Task 结构：TDD 闭环的最小单元**

每个 Task 内部建议长这样（注意：这不是教条，是为了让状态可见、验收可控）：

```
Task N: [组件名]
Files:
Create: apps/service/src/db.ts
Modify: apps/service/src/router.ts:45-78
Test: tests/service/db.test.ts
Step 1: 写失败的测试
test('createCampaign 写入 DB 并返回 id', async () => {
const result = await createCampaign({ name: 'test' })
expect(result.id).toBeDefined()
})
Step 2: 跑测试，确认它红了
Run: pnpm --filter service test db.test.ts
Expected: FAIL with "createCampaign is not defined"
Step 3: 写最小实现让测试通过
Step 4: 跑测试，确认它绿了
Run: pnpm --filter service test db.test.ts
Expected: PASS
Step 5: Commit
git add tests/service/db.test.ts apps/service/src/db.ts
git commit -m "feat: add createCampaign with DB write"
```

每个 Step 的设计目标是 **2–5 分钟**。不是强迫症，是信噪比控制：

- Step 太大：做到一半出问题，你不知道是哪一步的锅

- Step 太小：文档比代码还长，没人愿意看，也没人愿意照做

而 TDD 闭环在这里的价值也很直白：

- **先写失败的测试**：强迫你把验收标准先写清楚

- **确认它红了**：防止测试本身是坏的——没有红过的测试，不值得信任

**14.3.3 禁止占位符：把认知债务留给自己**

/writing-plans 对以下内容零容忍：

- “TBD / TODO / implement later”

- “Add appropriate error handling”（怎么加？加到哪？错误码是什么？）

- “Write tests for the above”（测试点是什么？断言是什么？）

- “Similar to Task N”（让读者自己跳回去对照）

- 描述了“做什么”，但不给可执行步骤

这些话的本质是：**作者省十分钟，执行端多花一小时摸黑。**

Fly哥的经验是：你现在觉得“显而易见不用写”的地方，往往就是执行端最容易卡住的地方。尤其当执行端不是你自己，而是一个无状态的 Subagent。

**14.3.4 Self-Review：计划写完 ≠ 计划可用**

写完整份计划后，必须做一轮自检，三块就够：

**① Spec coverage**回头翻 spec 的每一节：能不能指向具体某个 Task？指不出来的需求，等价于“你准备漏实现”。

**② Placeholder scan**全文搜索上面那些“禁止模式”，发现就地修复。别把模糊留到执行期，那叫延期爆炸。

**③ Type consistency**命名不一致不是风格问题，是实打实的 bug：Task 3 里叫 clearLayers()，Task 7 里叫 clearFullLayers()——执行到后半段必炸。类型名、方法签名、属性名必须全篇自洽，否则 Subagent 会在你最不想回头的时候逼你回头。

我见过团队跳过这步，结果 Task 11 引用了 Task 5 里从未定义过的接口。Subagent 做到一半报错，回头改计划花的时间比写计划还长。那种痛，谁踩谁知道。

---

### **14.4 执行交接：两条路，各有场景**

计划文档存档之后，/writing-plans 要求你明确选执行方式。

**方案 A：Subagent-Driven（推荐）**每个 Task 独立派发一个新 Subagent。Task 完成后，主 Agent 做 code review，确认没问题再启动下一个。优点很直接：隔离性强，单个 Task 失败不污染其他任务上下文。适合任务之间耦合度低、可并发推进的场景。

**方案 B：Inline Execution**在当前会话里顺序执行，周期性打 checkpoint。适合任务之间耦合度高、需要共享大量中间状态、或者需要你在人旁边盯着节奏的场景。

计划文件头部那行：

> For agentic workers: REQUIRED SUB-SKILL ...

就是给 Subagent 的“执行入口”。它读到这里就知道：接下来不是自由发挥，而是按协议跑流程。

**计划本身是协议，不是备忘录。**它要能被人读，也要能被 Agent 解析执行。格式看起来繁琐，原因只有一个：给执行端省力，不是给作者省力。

---

### **14.5 企业视角：计划是可审计的交付资产**

单人项目里，计划可以只是一条脑内时间线。但多人项目、跨部门协作、外包交付……计划必须是看得见的文档。

TL 最怕的不是“开发慢”，而是“不知道慢在哪”。Task 级计划能直接回答三件事：

1. **完成了几个 Task？** —— 进度可量化，不靠“感觉快了”

2. **卡在哪条依赖？** —— 瓶颈可见，资源调配有依据

3. **哪条验证红灯？** —— 质量可追溯，不靠“我测了感觉没问题”

对企业来说，还有一层更硬的价值：**可审计性。**需求评审完，计划文档就是承诺记录；做完了，按 Task 逐条验收。出了问题，翻文档就能看清楚：是计划没写清，还是执行偏了。责任到位，扯皮就少。

用过这套流程的团队普遍反馈：交付后的“验收争议”少了很多。因为验证步骤在计划阶段就谈清楚了，不是做完了才现场拍脑袋。

---

下一章，把执行环境也隔离开：/using-git-worktrees。每个 Task 在独立目录里跑，主工作区随时保持干净；feature 在沙盒里长，合并前不容易互相踩脚。
