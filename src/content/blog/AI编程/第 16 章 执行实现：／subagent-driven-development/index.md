---
title: "第 16 章　执行实现：/subagent-driven-development"
pubDate: 2026-05-02
description: "讲解 subagent-driven development 如何把任务拆给多个 Agent 执行，并通过计划、验收和 review 控制质量。"
tags: [AI编程, SDD, 企业级实战]
category: AI编程
draft: false
---
原文链接：[https://xiaobot.net/post/a327ed5e-d1ca-4bdd-ad60-2ff988a0d2f1](https://xiaobot.net/post/a327ed5e-d1ca-4bdd-ad60-2ff988a0d2f1)

> 第三部分：实战篇

上一章把物理环境隔好了——worktree 建好、依赖装好、基线测试全过。现在的问题是：这堆 Task 怎么变成可以合并的代码？

光有 agent 还不够。Fly哥见过太多「让 AI 一口气把所有功能写完」的尝试，结果是：代码能跑，spec 对不上，问题藏得很深，等到联调才发现。

这一章说的是**逻辑流水线**：每个 Task 怎么从实现走到可合并，以及这个 skill 背后的设计逻辑——为什么是这个结构，不是别的。

---

## 16.1 为什么是 Subagent：新鲜上下文的价值

/subagent-driven-development 有一个核心设计决策：**每个 Task 分给一个全新的子代理，不继承当前 session 的上下文和历史。**

这不是随便这么设计的，Fly哥第一次看到这个设计时也觉得「多此一举」——为什么不直接让一个 agent 把所有 task 跑完？

原因有两个。

第一个是**上下文污染**。一个 agent 做完 Task 1，里面有大量关于 Task 1 实现细节的上下文——用了什么变量名、踩过哪个坑、临时做了什么决定。这些信息做 Task 2 的时候大部分是噪声，有时候还是有害的：agent 会把 Task 1 的约束带进来，在 Task 2 的代码里留下奇怪的惯性。

第二个是**注意力稀释**。session 越长，前面的内容被「遗忘」的概率越高。Task 7 的 agent 如果继承了整个 session，它的注意力会被前六个任务的历史分散。

新鲜 subagent 的意思是：**你精确构造它需要的上下文，不多一行，不少一行。** task 的全文、相关 spec、项目结构里它需要知道的部分——这些由你来判断和提供，agent 只看它该看的，干它该干的。

这个分工里，你扮演的角色叫 **controller**。controller 不写代码，但做三件关键的事：读计划、提取 task、为每个 subagent 构造上下文。这个工作看起来轻，实际上是整个流水线质量的天花板。

---

## 16.2 Controller 的开局动作

拿到实施计划，/subagent-driven-development 的第一步不是马上发 Task，而是**一次性把所有 task 读完、提取完、记录下来**。

```
[Read plan file once: docs/plans/feature-plan.md]
[Extract all 5 tasks with full text and context]
[Create TodoWrite with all tasks]
```

为什么要先全部提取，而不是用到哪个读哪个？

因为 task 之间有依赖关系。全部摊开才能看清楚哪些可以独立推进、哪些必须等前置完成。这是在**尊重 DAG**——有向无环图——而不是拍脑袋「反正都是模块，并行发出去」。

有依赖的 task 串行，没有依赖的才能考虑并行。但这里有一条**红线：实现者 subagent 绝对不能并行派发。** 多个实现者同时改同一个 codebase，文件冲突是小事，更大的问题是两个 agent 同时「看到」同一个状态然后各自修改，最后的代码是谁都没预料到的结果。

一次一个实现者。这是纪律，不是建议。

---

## 16.3 单 Task 的流水线

每个 task 走一条固定管线：

```
Controller 派发 → Implementer subagent
↓
有疑问？→ 问清楚再开工（不是开工后再问）
↓
实现 + 测试 + 自我 review + 提交
↓
Spec Compliance Reviewer → 对照 spec 逐条核查
↓
❌ 不合规 → Implementer 修 → 再审
↓
✅ 合规 → Code Quality Reviewer → 健壮性 / 安全 / 性能
↓
❌ 有问题 → Implementer 修 → 再审
↓
✅ 通过 → 标记 task 完成
```

两点值得单独说。

**疑问要在开工前解决。** 实现者 subagent 在开始之前会问问题——这是正常现象，不是麻烦。在这个阶段把问题说清楚，比让它实现了一半发现假设错了、推倒重来便宜得多。实际案例里经常有类似这样的对话：

```
Implementer: "Before I begin — should the hook be installed at user or system level?"
You: "User level (~/.config/superpowers/hooks/)"
Implementer: "Got it. Implementing now..."
```

一句话，省掉一次返工。

**两道审查的顺序不能反。** 一定是 spec compliance 先，code quality 后。

原因很直接：如果实现连 spec 都没对上，讨论代码质量是在浪费时间——你在优化一个方向错了的东西。等 spec 对齐了，再谈「这段代码在压力下会不会变形」才有意义。

---

## 16.4 四种实现状态，分别怎么处理

实现者 subagent 完成之后会汇报一个状态。有四种，处理方式各不相同。

**DONE**——正常推进，进 spec compliance review。

**DONE_WITH_CONCERNS**——实现完成，但 agent 标记了一些疑虑。这里要停一下，把 concerns 读完再决定怎么走。如果疑虑涉及正确性或范围，先处理再进审查；如果是观察性的（「这个文件开始变大了」），记下来，继续推进。

**NEEDS_CONTEXT**——实现者缺少信息，没办法完成 task。这个时候补充上下文，重新派发，不要让它猜。Fly哥见过有人在这种情况下说「你先尽力做」——agent 确实会尽力，但尽力做出来的东西大概率需要推倒重来。

**BLOCKED**——实现者明确表示卡住了。这里有几条处理路径：

- 如果是上下文问题，补充信息，同一个模型重新派；

- 如果 task 需要更强的推理能力，换更强的模型重新派；

- 如果 task 太大，拆小再发；

- 如果是计划本身的问题，升级给人处理。

**关键原则：不要对 BLOCKED 视而不见，也不要用同样的模型、同样的上下文重新派一次期待不同结果。** agent 说卡住了，说明有什么东西需要改变。

---

## 16.5 模型选择：贵的不一定合适

每个 subagent 用哪个模型，是有讲究的。

基本原则是**用能胜任的最便宜模型**，而不是所有 task 都上最强的模型。这不只是节省 token，更快的模型迭代更快，整体流水线速度反而更好。

**机械实现类 task**（spec 清晰、改动集中在 1-2 个文件、逻辑简单）：用便宜快速的模型。大部分实现 task 在计划写得好的情况下都属于这类。

**集成与判断类 task**（跨多个文件、需要理解模块间关系、调试类问题）：用标准模型。

**架构、设计、审查类**：用最强的模型。spec compliance review 和 code quality review 都属于这类——判断「这段代码在边界情况下会不会出问题」需要足够的推理能力，便宜模型容易漏。

判断的信号很简单：改一到两个文件、spec 明确 → 便宜模型；跨文件、有集成考量 → 标准模型；需要设计判断、全局视角 → 最强模型。

---

## 16.6 两道审查的真实案例

理解了流水线结构之后，来看两道审查在实际项目里长什么样。

### Spec Compliance：只要二进制结果

合规审查只做一件事：**对照 **[**spec.md**](http://spec.md)**，逐条确认实现是否符合。**

输出长这样：

```
📋 Spec Compliance Review — Task 7
对照: campaign-service/spec.md
✅ POST /campaign/:id/init — 符合
✅ POST /campaign/:id/play — 符合（含 db.transaction）
✅ GET  /campaign/:id/result — 符合
✅ Seed 含 demo-grid9 / demo-spin-wheel / demo-blind-box — 符合
结论: SPEC COMPLIANT
```

没有「基本符合」「整体逻辑正确」。spec 写了什么，就验什么，每条打一个明确的 ✅ 或 ❌。任何一条是 ❌，整体结论就是 NON-COMPLIANT，进修复循环，修完重新审。

**灰度话术是返工的温床。** spec 是上一章花时间写出来的，如果实现可以「大体 OK」，那当初写 spec 的时间浪费了。

### Code Quality：七只漏网之鱼

质量审查看的是 spec 里不会写、但生产上会被用户找到的问题。

Fly哥有个真实案例，全项目质量审查检出 7 个问题，分布在 service 层（4 个）和 BFF 层（3 个）。

**Service 层 4 个：**

**CRITICAL — 竞态条件。** play 接口检查剩余次数再落库，两步之间有时间窗口。两个并发请求都读到 remaining = 1，都通过检查，各自落库，用户实际抽了两次。单测几乎不会稳定触发这个 bug，促销活动的流量峰值会把这个窗口撑得很宽。

```
// 错：检查与落库不在同一事务
const remaining = getRemainingPlays(userId, gameId);
if (remaining <= 0) throw new Error('No plays left');
recordPlay(userId, gameId, prizeId);
// 对：整体塞进事务
db.transaction(() => {
const remaining = getRemainingPlays(userId, gameId);
if (remaining <= 0) throw new Error('No plays left');
recordPlay(userId, gameId, prizeId);
})();
```

**HIGH — 权重浮点越界。** 奖品概率权重累加因浮点精度不严格等于 1，随机值落在最后一段权重之外，draw 返回 undefined，调用方 NPE。在最后兜底返回最后一个奖品，便宜有效。

**MEDIUM — getDb() 未初始化返回 null。** 调用方拿到 null 继续调方法，报错信息指向调用方行号，排查绕弯子。改一行：getDb() 里加显式抛错，信息直接。

**MEDIUM — init/seed 生命周期。** 插件外部 I/O 在服务关停时可能悬挂，Kubernetes 滚动更新时容器超时被强杀。teardown 钩子里处理收尾。

**BFF 层 3 个：**

**HIGH — auth middleware 二次写响应。** reply.send() 后缺 return，handler 继续执行再写一次响应，压测下密集抛「Reply already sent」。一个字的修法：return reply.send()。

**MEDIUM — userId 拼进 URL。** 直接字符串拼接有路径注入面，改用 URLSearchParams，这个口子就关掉了。

**MEDIUM — 缺全局 error handler。** service 层未处理异常透传到前端是裸 500，联调时排障起点模糊。加一个全局 handler，统一格式，一行代码。

这 7 个里，竞态、浮点越界、生命周期这几个**单测不易稳定触发**。质量审查的价值，是在联调前把「要运气才能踩到」的雷搬到桌面上。

---

## 16.7 严重级别怎么处理

**CRITICAL 和 HIGH，默认必须修，不谈条件。** 到了生产是真实的用户故障，修复成本随时间指数上涨。

**MEDIUM，看收益和改动面。** getDb() 加一行显式抛错，顺手就做。「给所有函数加超时控制」这种 MEDIUM，改动面大、v1 的收益不明确——记进技术债文档，规模化阶段再处理。

这里有一个容易踩的坑：**建议本身完全正确，但与当前里程碑无关。** 质量审查会产出一些长期建议——「这个模块应该支持水平扩展」「缓存策略需要重新设计」。这些建议是对的，但 v1 的目标是功能可用。用复杂度买假想中的未来，是技术债的另一种形式。

所有 task 跑完之后，还有最后一步：**派发一个 final code reviewer subagent，对整个实现做一遍总复盘**。单 task 的审查是局部的，最终审查看的是全局：各模块之间有没有不一致的地方，整体结构是否符合最初的设计意图。通过之后，进入 /finishing-a-development-branch，收尾合并。

---

下一章，功能块合拢、质量审查通过、final reviewer 也过了,接下来我们进入最重要的一章节/QA
