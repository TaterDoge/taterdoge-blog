---
title: "第 6 章　创建你的第一个 Skill"
pubDate: 2026-04-09
description: "从零创建一个 Skill，跑通触发、目录结构和调试流程，理解 Skill 如何在实际项目中复用。"
tags: [AI编程, SDD, 企业级实战]
category: AI编程
draft: false
---
原文链接：[https://xiaobot.net/post/d42ad2c5-f89a-49a2-8097-004fdcae4481](https://xiaobot.net/post/d42ad2c5-f89a-49a2-8097-004fdcae4481)

> 第二部分：Skills 深度解析

上一章把 Skill 和 MCP 的边界说清楚了——Skill 管流程，MCP 管能力。这一章直接上手：从零写一个 Skill，跑通触发，看到效果。

别担心，Skill 文件就是 Markdown，没有任何编译步骤。最难的部分是"想清楚你要固化什么流程"，写文件本身十分钟就够。

---

## 6.1　Skill 的文件结构

Skill 放在 .claude/skills/ 目录下，**每个 Skill 是一个同名文件夹**，文件夹里必须有 SKILL.md 作为主入口。这是唯一的结构形式，没有例外。

```
.claude/
skills/
git-status-report/       ← /git-status-report
└── SKILL.md
daily-standup/           ← /daily-standup
└── SKILL.md
```

复杂的 Skill 可以在目录里放更多文件：

```
.claude/
skills/
daily-summary/           ← /daily-summary
├── SKILL.md           必需，主入口和导航
├── reference.md       git 命令速查，按需加载
├── examples.md        样本输出，按需加载
└── scripts/
└── collect.sh   数据采集脚本，执行不加载
```

Skill 目录的核心设计思路有三点：

- **SKILL.md** 是主入口，只放核心流程和导航，保持精简

- **reference.md / examples.md** 是详细资料，由 AI 在需要时按需加载，不是每次都放进上下文

- **scripts/** 里的脚本用来执行（通过 !<command> 注入输出），而不是被当作 Markdown 读取

**什么时候需要拆分额外文件？** 一个判断标准：当你的 SKILL.md 开始变长，你发现自己在里面写很多"备注"、“参考命令”、“输出样例”——这些内容其实不需要每次都放进上下文。拆出来，按需加载，Skill 反而跑得更稳。

另一个触发点是 scripts/。如果你的 Skill 需要在触发时运行一段 shell 脚本来采集数据，把脚本单独写成文件，比在 context 字段里嵌一大段 bash 命令维护性好得多。

---

## 6.2　写一个最小可用 Skill（Step by step）

目标：创建一个 /git-status-report，用中文汇报当前 git 仓库状态。

**第一步，创建目录和文件：**

```
mkdir -p .claude/skills/git-status-report
touch .claude/skills/git-status-report/SKILL.md
```

**第二步，填 frontmatter：**

```
---
name: git-status-report
description: |
当用户输入 /git-status-report 时触发。
用中文汇报当前 git 仓库状态：未提交变更、最近 3 条提交、当前分支。
不适用于：查询特定 commit、生成 changelog、统计提交数量。
---
```

description 里的"不适用于"那行别省——它告诉 AI 这个 Skill 的边界在哪，防止在不该触发的时候触发。

**第三步，写执行逻辑：**

```
# Git 状态报告
## 执行步骤
- [ ] 运行 `git branch --show-current` 确认当前分支
- [ ] 运行 `git status --short` 获取工作区状态
- [ ] 运行 `git log --oneline -3` 获取最近 3 条提交
- [ ] 用中文输出报告，格式见下方
## 输出格式
**当前分支：** [分支名]
**工作区状态：**
- 已修改：[文件列表，无则写"干净"]
- 未追踪：[文件列表，无则写"无"]
**最近提交：**
1. [hash] [message]
2. [hash] [message]
3. [hash] [message]
**一句话判断：** [对当前仓库状态的简要评估，例如"有 2 个未提交文件，建议先 commit 再继续开发"]
```

**第四步，测试：**

在 Claude Code 或 Cursor 里输入 /git-status-report，观察输出是否符合预期。

第一次跑通，会有一种"就这？"的感觉。对，就这。Skill 的门槛故意设得很低，让你能快速验证，再迭代。

---

## 6.3　小案例：/daily-summary 带辅助文件的 Skill

最小可用的 Skill 只需要一个目录加一个 SKILL.md。但当 Skill 开始承担更多职责，目录里值得放更多文件。

/daily-summary 就是一个典型案例。这个 Skill 每天下班前运行，汇总当天 git 提交记录、生成工作日报。听起来简单，但实际用起来会碰到几个问题：

- 需要运行多条 git 命令采集数据，写在 context 里越来越乱

- 输出样例想保留几个，方便 AI 对齐格式，但放在主文件里太占空间

- git 命令参数想查，每次都要翻文档

这些都是在目录里拆分额外文件的理由。

**目录结构：**

```
.claude/skills/daily-summary/
├── SKILL.md        主入口：触发规则、执行流程、导航
├── reference.md    git 命令速查手册（按需加载）
├── examples.md     标准输出样例（按需加载）
└── scripts/
└── collect.sh  数据采集脚本（执行，不加载）
```

### SKILL.md——主入口，保持精简

```
---
name: daily-summary
description: |
当用户输入 /daily-summary 时触发。
汇总当日 git 提交记录，生成格式化工作日报。适合每日收尾使用。
不适用于：查询特定日期记录、生成周报或月报。
context: |
!bash .claude/skills/daily-summary/scripts/collect.sh
---
# Daily Summary
上方已注入今日 git 数据，直接生成日报，无需再次运行 git 命令。
## 执行步骤
- [ ] 解析注入的提交记录，按功能模块分组（根据 commit message 判断）
- [ ] 检查注入的工作区状态，识别未提交变更
- [ ] 按输出格式生成日报
## 输出格式
**[今日日期] 工作日报**
**完成事项：**
- [按模块分组的提交摘要]
**进行中：**
- [未提交的变更文件；无则写"无"]
**提交次数：** [N] 次
> 总结：[一句话描述今天的主要工作]
---
如需查看完整 git 命令参考，读取 `.claude/skills/daily-summary/reference.md`。
如需对齐输出格式，参考 `.claude/skills/daily-summary/examples.md`。
```

注意最后两行的导航指引——这是目录式 Skill 的关键。AI 不会一口气把所有文件都加载进来，而是在需要时按需读取。SKILL.md 的职责是告诉 AI"需要时去哪找"。

### scripts/collect.sh——数据采集，执行不加载

```
#!/bin/bash
# collect.sh — /daily-summary 数据采集脚本
AUTHOR=$(git config user.name)
TODAY_START="$(date '+%Y-%m-%d') 00:00:00"
TODAY_END="$(date '+%Y-%m-%d') 23:59:59"
echo "=== 今日提交记录 ==="
git log \
--since="$TODAY_START" \
--until="$TODAY_END" \
--oneline \
--author="$AUTHOR" 2>/dev/null || echo "（无提交）"
echo ""
echo "=== 工作区状态 ==="
git status --short 2>/dev/null || echo "（非 git 仓库）"
echo ""
echo "=== 采集时间 ==="
date '+%Y-%m-%d %H:%M'
```

这个脚本通过 SKILL.md 里的 !bash .claude/skills/daily-summary/scripts/collect.sh 在 Skill 触发时自动执行，输出注入到 AI 上下文。

脚本单独成文件的好处：可以加注释、可以处理错误边界（|| echo "..." fallback）、可以单独调试，比把所有逻辑挤在 frontmatter 的 context 字段里清晰得多。

### reference.md——按需加载的参考手册

```
# Daily Summary — Git 命令参考
## 常用采集命令
### 按作者筛选今日提交
```bash
git log --since="00:00" --until="23:59" --oneline --author="$(git config user.name)"
```
### 查看工作区状态（简洁格式）
```bash
git status --short
```
输出格式：`M` 已修改，`A` 已暂存，`?` 未追踪，`D` 已删除。
### 查看文件级变更统计
```bash
git diff --stat HEAD
```
### 按时间范围查提交（自定义日期）
```bash
git log --since="2026-04-01" --until="2026-04-09" --oneline --author="yourname"
```
## 故障排查
**没有输出？**
- 检查 `git config user.name` 是否设置，与提交时用的名字是否一致
- 确认当前目录是 git 仓库（`git status` 不报错）
```

这个文件不会在每次触发 /daily-summary 时自动加载。只有当 AI 判断需要查 git 命令细节时，才会主动读取。大多数情况下它不进上下文，不占 token。

### examples.md——输出样例对齐格式

```
# Daily Summary — 输出样例
## 样例一：有提交、有未提交变更
```
2026-04-09 工作日报
完成事项：
- [认证模块] 添加 Google OAuth 登录支持
- [认证模块] 修复登录失败锁账逻辑
- [数据库] 添加用户 IP 记录表迁移
进行中：
- src/auth/session.ts（已修改，未提交）
提交次数：3 次
> 总结：主要完成认证模块的 OAuth 接入和安全加固。
```
## 样例二：今日无提交
```
2026-04-09 工作日报
完成事项：
- 今日暂无提交记录
进行中：
- src/feature/new-flow.ts（进行中，未提交）
- docs/api.md（已修改，未提交）
提交次数：0 次
> 总结：今日主要做了新功能的前期探索，尚未形成提交。
```
## 样例三：干净工作区，只有提交
```
2026-04-09 工作日报
完成事项：
- [重构] 拆分 UserService 为 UserQueryService / UserCommandService
- [重构] 更新所有调用方引用
进行中：
- 无
提交次数：2 次
> 总结：完成用户服务的 CQRS 拆分重构。
```
```

---

## 6.4　常见错误与调试方法

### Skill 没有触发

按顺序检查：

- .claude/skills/ 目录存在吗？

- 对应的目录名和命令名完全一致吗？（git-status-report/ 目录对应 /git-status-report）

- 目录下有 SKILL.md 吗？缺了这个文件，整个 Skill 等于不存在

- frontmatter 格式正确吗？（YAML，冒号后面必须有空格，缩进不能混用 tab 和空格）

- **新创建的SKILL，重启一下终端或者是编辑器，让系统重新注册一下SKIL**

快速验证方法：在 AI 对话里直接问"你对 /daily-summary 这个 Skill 的理解是什么？"——AI 会解释它加载到的内容，可以确认 Skill 是否被正确读取。

### Skill 触发了但行为不对

- description 足够具体吗？模糊的 description 会导致 AI 理解偏差

- 执行步骤有歧义吗？“分析需求"改成"列出 3 个具体问题”——越具体越稳定

- 输出格式有明确定义吗？没有格式定义，AI 每次输出结构都会不一样

目录里有辅助文件时，记得检查：SKILL.md 里的导航指引写了吗？如果 AI 找不到 reference.md 的路径，就算文件在那里它也不会去读。

### scripts/ 脚本没有执行

- 脚本有执行权限吗？运行 chmod +x .claude/skills/daily-summary/scripts/collect.sh

- context 字段里的路径是相对仓库根目录的绝对路径还是相对路径？建议用相对仓库根的路径，如 .claude/skills/daily-summary/scripts/collect.sh

- 单独跑一下脚本确认没有报错：bash .claude/skills/daily-summary/scripts/collect.sh

### Skill 在不该触发时触发了

在 description 里加"不适用于"一行：

```
description: |
当用户输入 /daily-summary 时触发。
不适用于：查询特定日期的记录、生成周报或月报。
```

---

## 6.5　实在不知道写什么？让 /skill-creator 替你想

这是本章最重要的一节，但也是最容易被跳过的一节。

很多人卡在"我知道 Skill 有用，但我不知道该固化什么、怎么写"。这个卡点完全可以绕过去——你根本不需要自己从零设计 Skill。

**核心思路：你只需要发现流程，AI 帮你固化。**

具体做法是这样的：

你平时和 AI 协作，跑通了一套不错的工作流。比如你花了两个小时，通过反复对话，让 AI 帮你生成了一份漂亮的接口文档。这套对话流程：先分析现有代码、再提取接口定义、再格式化输出、再检查遗漏——整个过程你觉得以后还会用，而且希望每次都这样来。

这时候你只需要：**新开一个对话，输入 /skill-creator，然后把上面的流程描述给 AI。**

/skill-creator 是官方内置的 Skill，它会主动和你对话：问你这个流程的触发场景是什么、每一步做什么、输出格式长什么样、有什么边界条件——然后帮你生成完整的 Skill 文件，你只需要确认、微调，放进 .claude/skills/ 目录，直接能用。

一次实际的对话流程大概是这样的：

```
你：/skill-creator
AI：我来帮你创建 Skill。请描述一下：
你想固化什么工作流程？触发场景是什么？
你：我经常需要分析一个模块的代码，提取所有对外暴露的接口，
整理成 OpenAPI 格式的文档。每次都要手动说很多次，
想固化成一个命令。
AI：明白了。我来帮你设计这个 Skill，有几个问题确认一下：
1. 触发方式：你倾向于输入 /api-doc 还是 /generate-api-doc？
2. 输入参数：是分析整个项目，还是指定某个文件/目录？
3. 输出格式：纯 Markdown 表格，还是标准 OpenAPI YAML？
4. 需要参考文档或输出样例吗？如果需要，我帮你生成目录结构。
你：命令叫 /api-doc，指定目录，输出 Markdown 表格，
不需要额外文档。
AI：好，生成 Skill 文件如下：
[完整的 SKILL.md 内容]
放进 .claude/skills/api-doc.md 就能用了。
```

整个过程你没有写一行 Skill 文件——你只是在描述你自己的工作方式，AI 把它结构化了。

**什么时候该考虑用 /skill-creator？**

判断标准很简单：**你做了一件事，觉得"这个流程下次还会用，而且希望每次都这样"——那就值得固化。**

几个典型场景：

- 你每次 code review 都按同一套思路来，问题严重程度、改进建议，一个都不少

- 你每次发版前都要检查同样的一份清单——测试通过、文档更新、changelog 写了没有

- 你每次接手新项目，都要先做一轮代码结构分析，摸清模块边界

这些都值得一个 Skill。不需要你自己设计，跑一遍 /skill-creator，十分钟搞定。

---

## 6.6　Skill 不是写完就完了

Skill 和代码一样，有生命周期。

第一版 Skill 几乎不可能是最终版——你会发现某个步骤描述得不够具体，AI 理解偏了；或者输出格式少了一个字段，每次都要手动补；或者触发条件太宽，在不该激活的时候跑出来了。

Fly哥的建议是：**用三次之后做一次回顾。**

跑完三次，你已经有足够的样本判断：这个 Skill 哪里卡壳了，哪里输出不稳定，哪里每次都要人工干预。把这些改进点写回 Skill 文件，下一版就稳多了。

目录里的文件有一个迭代红利：每个文件的职责清晰，改 reference.md 不影响主流程，调整 collect.sh 不用动 SKILL.md。比把所有东西堆在 SKILL.md 里好改得多。

后面会专门讲 Skill 的测试和迭代方法，这里先种下这个概念。

---

## 6.7　进阶：让 Skill 更聪明的四个技巧

入门 Skill 够用了，但有几个进阶用法，能把 Skill 的能力拉到一个新的层次。这些不是必须的，但一旦你用过，回不去了。

### 动态注入上下文：!<command> 语法

/daily-summary 上面已经用到了这个技巧——SKILL.md 里的 !bash .../collect.sh 在 Skill 触发时执行脚本，把输出注入上下文。

原理是：在 context 字段里，以 ! 开头的行会被当作 shell 命令执行，输出直接塞进 AI 的上下文，然后 Skill 才开始处理。

两种写法都可以：

**内联写法**（适合简单命令，一两行搞定）：

```
context: |
!git log --since="00:00" --until="23:59" --oneline --author="$(git config user.name)"
!git status --short
```

**脚本写法**（适合复杂逻辑，放进 scripts/ 文件）：

```
context: |
!bash .claude/skills/daily-summary/scripts/collect.sh
```

当命令超过两三行、有条件判断、需要处理错误时，写成脚本文件是更好的选择——可以加注释、可以复用、可以单独调试。

一个更典型的场景是 /requesting-code-review——代码审查 Skill 需要知道当前 PR 的变更。写成脚本：

```
#!/bin/bash
# scripts/collect.sh — 审查数据采集
echo "=== 变更统计 ==="
git diff main...HEAD --stat
echo ""
echo "=== 提交记录 ==="
git log main..HEAD --oneline
echo ""
echo "=== PR 信息 ==="
gh pr view --json title,body 2>/dev/null || echo "（未关联 PR）"
```

SKILL.md 里只需要一行：

```
context: |
!bash .claude/skills/requesting-code-review/scripts/collect.sh
```

触发的那一刻，diff 摘要、提交记录、PR 信息全部进上下文，AI 直接进入审查，少了"先拿数据"这一步。

**本质是什么**：把"运行时动态获取数据"提前到"Skill 加载时注入数据"。适合那些每次触发都需要某类实时数据的 Skill。

### 隔离执行：context: fork

有些 Skill 你希望它在一个**干净的环境**里跑——不带当前对话的历史，不受前面聊天记录的干扰，就像开了一个新的对话窗口。

这用 context: fork 实现。

SDD 里的 /brainstorming 就是典型场景。brainstorming 阶段要求 AI 能自由发散，但如果当前对话里已经讨论了半小时某个具体实现细节，AI 的"背景辐射"会让它没办法真正从零开始。加上 context: fork，每次触发都是全新上下文：

```
---
name: brainstorming
description: |
当用户输入 /brainstorming 时触发。
进行需求澄清和设计决策，输出 design.md。
context: fork
---
```

fork 的效果类似"无痕浏览"——当前对话历史对这次 Skill 执行没有影响，Skill 跑完，结果写进文件，回到正常对话。

另一个常用场景是 /subagent-driven-development——这个 Skill 要派出多个 Subagent 并行执行任务，每个 Subagent 必须完全独立，context: fork 正好满足。

**什么时候用 fork**：Skill 需要从零推理、不希望被历史对话干扰；或者 Skill 要派出多个独立 Subagent 并行工作。

### 指定 Agent 类型：agent 字段

不同类型的任务，用专门的 Agent 效果会好很多。Claude Code 内置了几种：

- general-purpose：通用，适合大多数任务

- Explore：专门做代码探索，擅长快速定位文件和理解结构

- Plan：专门做方案设计，擅长权衡利弊、输出结构化方案

/opsx:propose 需要先深度理解代码库现状（有哪些已有接口、哪些模块可复用），再提出方案——用 Explore Agent 更合适：

```
---
name: opsx:propose
description: |
当用户输入 /opsx:propose 时触发。
基于 design.md 生成 proposal.md、spec.md、tasks.md。
agent: Explore
context: fork
---
```

Explore Agent 天生会先把代码库摸清楚再开始工作，对于"需要先理解项目再提方案"这类任务，比通用 Agent 少走很多弯路。

你也可以用自定义 Agent——把 Agent 定义文件放在 .claude/agents/ 目录下，agent 字段填文件名即可。

### 工具权限控制：allowed-tools

allowed-tools 字段精细控制 Skill 执行期间可以使用哪些工具。

SDD 里的 /opsx:propose 只需要调 OpenSpec CLI 和读写文件，其他命令一概不需要：

```
allowed-tools:
- Bash(opsx *) # 只允许 opsx 系列命令
- Read
- Write
```

Bash(opsx *) 表示只允许执行以 opsx 开头的 shell 命令，其他 shell 命令被拦截。

这在企业环境里特别有价值——一个暴露给非技术同事的 Skill，你不希望 AI 在执行过程中顺手跑了 rm -rf 或调了某个敏感 API。工具边界框死，出了边界就被拦住。

几个常见配置模式：

```
# 只读模式：只能看代码，不能修改
allowed-tools:
- Read
- Glob
- Grep
# 开发模式：可以读写，可以跑测试
allowed-tools:
- Read
- Write
- Edit
- Bash(npm test)
- Bash(npm run *)
# MCP 专用模式：只能调特定外部工具
allowed-tools:
- mcp__database__query_orders
- mcp__database__get_user
```

---

## 6.8　四个技巧的组合：一个完整的目录式 Skill

把上面的内容综合在一起，这是 SDD 里 /requesting-code-review 的完整目录式版本：

```
.claude/skills/requesting-code-review/
├── SKILL.md
├── reference.md     审查维度参考（按需加载）
├── examples.md      历史审查样例（按需加载）
└── scripts/
└── collect.sh  PR 数据采集
```

**scripts/collect.sh**：

```
#!/bin/bash
echo "=== 变更统计 ==="
git diff main...HEAD --stat
echo ""
echo "=== 提交列表 ==="
git log main..HEAD --oneline
echo ""
echo "=== PR 信息 ==="
gh pr view --json title,body,additions,deletions 2>/dev/null \
|| echo "（未关联 PR）"
```

**SKILL.md**：

```
---
name: requesting-code-review
description: |
当用户输入 /requesting-code-review 时触发。
对当前分支相对 main 的变更做全面代码审查，输出结构化审查报告。
不适用于：单文件注释检查、依赖版本审查、性能 profiling。
context: |
fork
!bash .claude/skills/requesting-code-review/scripts/collect.sh
agent: general-purpose
allowed-tools:
- Read
- Glob
- Grep
- Bash(git *)
---
# Code Review
上方已注入变更摘要，对每个变更文件做深度审查。
## 审查维度
- [ ] **正确性**：逻辑是否有明显 bug，边界情况是否处理
- [ ] **安全性**：输入校验、权限控制、敏感数据处理
- [ ] **可测试性**：新增逻辑是否有对应测试
- [ ] **可维护性**：命名清晰度、函数复杂度、注释必要性
## 输出格式
**审查摘要**
- 变更文件数：N
- 高风险问题：N 个
- 中风险问题：N 个
- 建议改进：N 个
**逐文件审查**
### `[文件路径]`
- 🔴 [高风险] 问题描述，建议修改方式
- 🟡 [中风险] 问题描述，建议修改方式
- 💡 [建议] 可优化点
**总体评估：** [是否可以合并，还是需要修改]
---
审查维度详细说明见 `.claude/skills/requesting-code-review/reference.md`。
历史审查样例见 `.claude/skills/requesting-code-review/examples.md`。
```

读一遍 SKILL.md 你会发现，它非常干净：frontmatter 配置齐全，主体只有流程和格式，细节资料全部导航到独立文件。触发时注入实时数据，在隔离的 fork 环境里审查，工具权限只开只读——AI 只能看代码，没有写权限，没有机会在审查过程中"顺手改点什么"。

这才是生产级 Skill 该有的样子。

---

## 小结

写 Skill 的完整路径：

1. **入门**：创建目录 + SKILL.md，填 name、description、执行步骤，跑通最小可用版

2. **调试**：触发是否准确，行为是否稳定，输出格式是否固定

3. **拆分**：Skill 变复杂时，在目录里增加辅助文件——reference.md/examples.md 按需加载，scripts/ 放采集脚本

4. **固化**：不会写就用 /skill-creator，描述流程，AI 帮你生成

5. **进阶**：四个技巧做精——动态注入上下文、隔离执行、指定 Agent、控制工具权限

所有 Skill 都是目录结构，区别只在于目录里放多少东西。从最简单的一个 SKILL.md 开始，需要时再往里加，不要一上来就设计过头。

下一章，我们把目光拉高一层——Skill 和 Skill 之间怎么组合，串联和并联的设计，以及如何把一整套编排逻辑本身固化成一个 Skill。
