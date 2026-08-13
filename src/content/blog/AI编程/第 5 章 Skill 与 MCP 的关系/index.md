---
title: "第 5 章　Skill 与 MCP 的关系"
pubDate: 2026-04-08
description: "对比 Skill 与 MCP 的职责边界：Skill 管流程和规范，MCP 管外部能力与工具连接。"
tags: [AI编程, SDD, 企业级实战]
category: AI编程
draft: false
---
原文链接：[https://xiaobot.net/post/c386a610-d847-413c-87aa-12d479970670](https://xiaobot.net/post/c386a610-d847-413c-87aa-12d479970670)

> 第二部分：Skills 深度解析

上一章把 Skill 的结构讲清楚了。但你可能会有个疑问：第 3 章里 MCP 也出现了，Skill 和 MCP 都是"扩展 AI 能力"的东西，它们到底有什么区别？该用哪个？

这两个概念是整个工具链里最容易被混淆的。搞清楚它们的边界，后面的章节会轻松很多。

---

## 5.1　MCP 是什么

第 3 章已经讲过 MCP 的企业落地价值，这里从 AI 编程工具的视角再说一遍，更具体一点。

MCP（Model Context Protocol）是一个开放协议，它做的事情只有一件：**让 AI 模型能够调用外部工具**。

如果把 AI 比作一个程序员，那这个程序员天生只会在脑子里推理——它能看代码、能想方案、能写文字，但它没有手。它读不了你电脑上的实时日志，调不了你公司内网的接口，也打不开浏览器截图。

MCP 就是给它装手。

技术上，MCP 服务器是一个独立运行的进程，对外暴露一组工具（tools）。AI 需要做某件"超纲"的事时，就通过 MCP 协议发起调用，MCP 服务器执行，把结果返回给 AI，AI 继续推理。

一个 MCP 工具的声明大概长这样：

```
{
"name": "query_orders",
"description": "查询指定用户的订单列表，支持按状态过滤",
"inputSchema": {
"type": "object",
"properties": {
"user_id":    { "type": "integer", "description": "用户 ID" },
"status":     { "type": "string",  "enum": ["pending", "paid", "cancelled"] },
"page_size":  { "type": "integer", "default": 20, "maximum": 100 }
},
"required": ["user_id"]
}
}
```

AI 拿到这份声明，就知道这个工具能做什么、参数是什么类型、有什么约束——不需要你在 prompt 里手写一遍接口文档。调用时，AI 生成一个符合 schema 的参数对象，MCP 服务器收到后执行真实逻辑，把结果以结构化 JSON 返回：

```
// AI → MCP：发起调用
{ "tool": "query_orders", "arguments": { "user_id": 10086, "status": "pending" } }
// MCP → AI：返回结果
{
"orders": [
{ "id": "ORD-001", "amount": 299.00, "created_at": "2026-04-07T10:30:00Z" },
{ "id": "ORD-002", "amount": 89.00,  "created_at": "2026-04-07T09:15:00Z" }
],
"total": 2
}
```

具体点说：Pencil MCP 提供了 create_design、update_component 这类工具，让 AI 能直接操作 UI 设计文件；browser MCP 让 AI 能操控真实浏览器、抓取页面、截图；数据库 MCP 让 AI 能直接查表、写 SQL。这些 AI 原生做不到，MCP 把这些能力插进来。

---

## 5.2　Skill 和 MCP 的根本区别

一句话版本：**Skill 管逻辑，MCP 管能力。**

Skill 定义的是"做什么、按什么顺序、输出什么格式"——它是流程，是剧本，是工作规范。Skill 本身不执行任何外部操作，它只告诉 AI 该怎么思考、怎么走步骤。

MCP 提供的是"做这件事所需的工具"——它是锤子、是扳手、是钻头。MCP 不知道你要造什么，它只负责在被调用时把工具递过来。

举个实际场景：

/brainstorming 这个 Skill 里有一步是"给用户展示交互原型，在浏览器里渲染"。Skill 文件里写的只是意图：

```
## 执行步骤
- [ ] 理解用户需求，提出 2-3 个设计方案
- [ ] 对每个方案生成 HTML mockup 代码
- [ ] 调用 browser MCP 在本地浏览器渲染 mockup，截图展示给用户
- [ ] 根据用户反馈，选定方案并输出设计文档
```

“在本地浏览器渲染"这件事，Skill 不管怎么实现——那是 browser MCP 的工作。Skill 只负责说"这一步要做什么”，MCP 负责"怎么做到"。

Skill 写的是意图，MCP 提供实现。两者职责不重叠。

---

## 5.3　三者协作的完整链路

真实的执行链路是这样的：

```
你（用户）
↓ 输入 /brainstorming
Skill（brainstorming.md）
↓ 加载进上下文，定义执行流程
AI
↓ 按流程推理，遇到"需要外部能力"的步骤时
MCP 服务器
↓ 执行工具调用，返回结果
AI
↓ 拿到结果继续推理，直到完成 Skill 定义的所有步骤
你（用户）
```

把这条链路展开成伪代码，更直观：

```
# 用户触发
user.input("/daily-summary")
# Step 1: 加载 Skill
skill = load_skill(".claude/skills/daily-summary.md")
# → 得到：执行步骤 + 输出格式定义
# Step 2: AI 按 Skill 逻辑推理，遇到需要外部工具的步骤
ai.think("需要获取今日 git 提交，调用 shell 工具")
# Step 3: 通过 MCP 调用工具
result = mcp.call("run_shell", {
"command": 'git log --since="00:00" --oneline --author="$(git config user.name)"'
})
# → 返回：["a1b2c3 feat: 添加订单查询接口", "d4e5f6 fix: 修复分页边界问题"]
# Step 4: AI 拿到结果，继续按 Skill 定义的格式组织输出
ai.think("按功能模块分组，生成日报")
ai.output(skill.output_template, data=result)
# → 输出结构化日报给用户
```

你能看出来：Skill 定义了"做什么"（步骤和格式），MCP 提供了"怎么做到"（真实的 shell 执行能力），AI 是驱动整条流程的引擎。三者角色清晰，谁也不越界。

用剧组的比喻：Skill 是剧本，告诉 AI 整场戏怎么演；MCP 是道具组，提供演出需要的工具；AI 是演员，按剧本走，需要道具时向道具组要。

这个分层有个实际好处——**调试时能快速定位问题层**。

一个 Skill 跑出来结果不对，问题只可能出在三个地方：

1. **剧本有问题**：Skill 逻辑描述不清，AI 理解偏了——改 Skill 的 description 或执行步骤

2. **道具有问题**：MCP 工具不稳定或返回格式对不上——查 MCP 服务器日志

3. **演员有问题**：AI 自身推理偏差，特别是在复杂多步任务里——通常需要在 Skill 里增加中间检查点

三层分开，调试才能精准，而不是"AI 又犯病了"这种无从下手的判断。

---

## 5.4　什么时候写 Skill，什么时候接 MCP

这个问题我见很多人纠结过，说清楚就很简单：

**写 Skill 的判断标准**：你有一套反复使用的流程，或者想统一团队的操作方式，或者需要固定输出格式。只要是"做事的方式"，就考虑 Skill。

**接 MCP 的判断标准**：你需要 AI 做某件它原生做不到的事——操作真实浏览器、读写数据库、调用内网 API、获取实时数据。只要是"能力边界"问题，就考虑 MCP。

**两者都需要**，才是最常见的生产场景。

SDD 流程里大多数 Skill 都依赖 MCP。举几个具体例子：

- /opsx:propose：OpenSpec 的规格提案 Skill，调用 OpenSpec CLI（一个 MCP 工具）生成 [proposal.md](http://proposal.md)、[design.md](http://design.md)、[tasks.md](http://tasks.md) 等文档

- /brainstorming：需要展示视觉方案时，调用 browser MCP 在浏览器里渲染 mockup

- /daily-summary：如果你接入了飞书 MCP，Skill 可以直接把日报推送到飞书群，而不只是在终端打印

Skill 定义流程，MCP 提供执行工具。少了 MCP，Skill 只能在 AI 的能力范围内转圈；少了 Skill，MCP 的工具是散的，每次用都要手动描述怎么调、按什么顺序调。两者配合，才让工作流既有约束又有能力。

---

## 5.5　一个常见误区：把 Skill 写成了 MCP 的功能

Fly哥在帮团队落地时，见过一个很典型的写法：

```
---
name: query-database
description: 查询数据库，获取用户订单数据
---
1. 连接数据库 host: xxx, port: 5432
2. 执行 SQL: SELECT * FROM orders WHERE user_id = ?
3. 返回结果
```

这个 Skill 写的是**能力**，不是**流程**。连接数据库、执行 SQL，这些是 MCP 该做的事，不是 Skill 该描述的事。AI 看到这个 Skill，它没法真的去连数据库——除非你已经接了数据库 MCP，否则这个 Skill 就是一张空头支票。

正确的分工是这样的：

**MCP 侧**（database-mcp，负责封装能力）：

```
{
"name": "query_user_orders",
"description": "查询指定用户的订单列表",
"inputSchema": {
"properties": {
"user_id":   { "type": "integer" },
"status":    { "type": "string", "enum": ["pending", "paid", "cancelled"] },
"limit":     { "type": "integer", "default": 10, "maximum": 50 }
},
"required": ["user_id"]
}
}
```

**Skill 侧**（负责定义流程和输出规范）：

```
---
name: order-report
description: 生成指定用户的订单分析报告，输入 /order-report [user_id] 触发
---
## 执行步骤
- [ ] 调用 `query_user_orders`，获取该用户全部订单（不过滤状态）
- [ ] 按订单状态分组统计：pending / paid / cancelled 各多少笔
- [ ] 计算总金额、平均单价、最大单笔金额
- [ ] 按以下格式输出分析报告：
## 输出格式
**用户 [user_id] 订单分析**
| 状态 | 笔数 | 金额合计 |
|------|------|---------|
| 待支付 | N | ¥xxx |
| 已支付 | N | ¥xxx |
| 已取消 | N | ¥xxx |
**关键指标：** 平均单价 ¥xx | 最大单笔 ¥xx
```

看出区别了吗？MCP 只管"我能查什么、怎么查"；Skill 只管"拿到数据后做什么分析、输出什么格式"。两者各司其职，改 MCP 不影响 Skill，改 Skill 不影响 MCP。

**Skill 假设工具已经准备好，它只负责说清楚该怎么用这些工具。**

---

## 5.6　企业场景：Skill + MCP 的真实价值

用 Skill + MCP 的组合之前，我们团队的 AI 辅助开发是这样的：

每次开新功能，工程师手动从飞书里复制 PRD，粘贴进 AI 对话框；手动从 Swagger 翻接口定义；手动把 AI 输出的代码 review 一遍，确认没有产生幻觉字段；手动推送到 GitLab……每个环节都要人工中转，AI 只是个"高级打字机"。

接入 MCP 之后，这条链路自动化了：飞书 MCP 直接让 AI 读取最新 PRD，不用手动复制；Swagger MCP 把接口定义结构化地喂给 AI，不会再有"幻觉字段"；GitLab MCP 让 AI 直接提交分支、创建 PR。而 Skill 在上层把整套流程串成可触发的工作流，一个 /start-feature 命令，从读 PRD 到提 PR，中间的每一步都有约束。

这不是理论，这是真实发生的效率变化。

从企业视角看，这套组合还解决了一个团队协作问题：**经验的可传递性**。

以前"会用 AI"是个人能力，靠摸索积累。某个工程师摸出了一套高效的 prompt 组合，但那套经验在他的脑子里，换人就消失了。现在把流程写进 Skill，把工具能力封进 MCP，新人 git clone 下来，立刻拥有和老人一样的 AI 工作流。团队的 AI 使用水位，不再取决于"谁最会用 AI"，而是取决于"Skill 库有多成熟"。

---

## 小结

Skill 和 MCP 不是竞争关系，是互补关系。

- **Skill**：你的工作方式、你的流程规范、你的输出标准——用结构化的方式告诉 AI “按我的规则来”

- **MCP**：AI 触达外部世界的手——把 AI 的能力边界从"文本推理"扩展到"真实操作"

两者配合的核心是分工清晰：流程归 Skill，能力归 MCP，执行归 AI。哪一层出了问题，就在哪一层改，不会牵一发而动全身。

下一章，我们直接上手——从零创建你的第一个 Skill，跑通整条链路。
