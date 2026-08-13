---
title: 第 20 章　sdd flow：轻量流程预设与可插拔编排实战
pubDate: 2026-05-31
description: "解决 SDD 落地中两个最常见的摩擦点：流程太重和工具不适配。用 sdd flow 按场景选短流程，用 /SDD-WORK-FLOW 编排 skill 替换工具节点。"
tags: [AI编程, SDD, 企业级实战]
category: AI编程
draft: false
---

原文链接：[https://xiaobot.net/post/cf7c9dc0-beb6-4c95-ab19-532f4ad0a48d](https://xiaobot.net/post/cf7c9dc0-beb6-4c95-ab19-532f4ad0a48d)

说实话，SDD 的开发体验是真的爽。

从需求进来，脑暴澄清、UI 设计、写 spec、拆 task、subagent 并行执行、code review、合并归档——整套跑下来，你会发现 AI 真的可以替你干掉大量重复的脑力劳动。

但跑了一段时间之后，Fly哥在**粉丝群收到了不少反馈**，集中在两个方向：

**第一个：太重了。**

"Fly哥，我就改个小功能，需求很清楚了，还要脑暴？还要 propose？token 烧了一堆，半小时过去了，代码还没开始写。"

这个反馈我完全理解。SDD 的完整流程是为「需求模糊、团队协作、长周期功能」设计的。但现实是，你每天面对的任务里，有相当一部分是「需求已经很清楚，直接写计划开发就行」的场景。用 13 步流程去处理一个 3 步就能搞定的任务，是杀鸡用牛刀。

**第二个：流程里有些 skill 不适合我们团队。**

这个问题更有意思，也更深。

有人说：「我们不用 Pencil MCP，UI 设计这步我们有自己的工具。」

有人说：「知识沉淀那步，我们不用飞书，我们用自己的数据库服务，MCP 完全不一样。」

还有人说：「我写这篇文章的时候，Pencil MCP 还在用，现在已经换成 Codex + Figma + GPT-image2 了，skill 过期了怎么办？」

这些都是真实的痛点。SDD 的核心思想是对的，但具体的工具链是会变的，是因团队而异的。一套写死的流程，迟早会和你的实际环境产生摩擦。

## 二、解决思路：两个方向

面对这两个痛点，Fly哥的解法是：

1. **轻量流程预设**：把完整 13 步拆成几个常用的短流程，按场景选用
2. **可插拔 skill 编排**：让你能自由替换流程中的任意一步，甚至自己组合一套专属流程

这两件事，我把它做成了一个新命令：sdd flow。

代码会放在小册群的共享文档里，直接拿去用，如果没有进群的，加我微信进群

![](./image-1.webp)

## 三、轻量流程：按场景选对入口

先说第一个问题：流程太重。

根本原因不是 SDD 设计有问题，而是**入口选错了**。完整流程适合「从零开始、需求模糊」的场景。但你的任务不一定都是这种。

Fly哥梳理了实际使用中最高频的两个短流程：

### Plan → Dev

**适用场景**：需求已经明确，不需要脑暴，直接写计划开发。

```plaintext
Step 0: MCP 环境检查
Step 1: /writing-plans（写实施计划）
Step 2: /using-git-worktrees（创建隔离分支）
Step 3: /subagent-driven-development（执行）
Step 4: /finishing-a-development-branch（收尾）
```

4 步，干净利落。需求清楚的时候，这就够了。

### Plan → Grill → Dev

**适用场景**：需求明确，但计划写完之后你不确定方向对不对，想在动手之前被质疑一遍。

```plaintext
Step 0: MCP 环境检查
Step 1: /writing-plans
Step 2: /grill-with-docs（质疑计划，对齐领域模型）
Step 3: /using-git-worktrees
Step 4: /subagent-driven-development
Step 5: /finishing-a-development-branch
```

多了一个 grill 环节。这一步的价值在于：在你投入开发之前，让 AI 扮演一个挑剔的同事，把计划里的假设、边界、遗漏全部逼出来。

Fly哥自己的习惯是：**改动影响面大的功能用 plan-grill-dev，小改动用 plan-dev，需求模糊才跑完整流程。**

使用方式：

```bash
sdd flow --preset plan-dev
sdd flow --preset plan-grill-dev
```

或者交互式选择：

```bash
sdd flow
```

## 四、可插拔编排：替换掉不适合你的那一步

现在说第二个问题，也是更核心的问题。

SDD 流程里，有几个步骤是「工具强依赖」的：

- **UI 设计**：原来用 Pencil MCP，现在有人用 Figma + GPT-image2，有人用 Codex，有人根本不需要这步
- **知识沉淀**：原来写飞书，你们公司可能用 Confluence、Notion、内部 Wiki
- **MCP 环境**：每家公司的内部 MCP 不一样，feishu/mooncake 是得物的，你们有自己的

这些差异不是 bug，是现实。工具会迭代，团队有自己的技术栈，没有一套流程能永远适配所有人。

**真正的解法是：让流程本身可以被替换。**

### /SDD-WORK-FLOW：把所有 skill 收敛到一个入口

这是 Fly哥在实际团队落地时用的核心策略。

思路很简单：**不要让团队成员记住 13 个 skill 的名字和触发时机，把它们全部收敛到一个编排 skill 里，这个 skill 就是你们团队的「标准流程」。**

当你需要替换某一步时，改的是这个编排 skill 里对应的那一段，而不是去动底层 skill。

比如你们的 UI 设计步骤从 Pencil MCP 换成了 Figma + GPT-image2：

```markdown
## Step 2：UI 设计

触发你们内部的 /figma-design skill（而不是 /pencil-mcp）
```

比如知识沉淀换成 Confluence：

```markdown
## Step 12：知识沉淀

触发 /capture-to-confluence skill，写入团队 Confluence 空间
```

整个流程的骨架不变，换的只是具体的工具节点。

### 用 sdd flow 生成你的专属编排

手动写一个编排 skill 是可以的，但有点繁琐。sdd flow 的自定义模式帮你把这件事自动化：

```bash
sdd flow
# 选择「自定义流程」
# 从现有 skill 列表里勾选你要的步骤
# 确认顺序
```

CLI 会生成一个 `sdd-custom-flow.prompt.md` 文件，里面包含了你选中的所有 skill 的完整内容，以及让 AI 把它们串联成编排 skill 的指令。

然后在 Claude Code 里跑一次：

```bash
claude "$(cat sdd-custom-flow.prompt.md)"
```

AI 会读取你选的 skill，理解每个步骤的输入输出，自动生成衔接规则、决策树、红线约束，最后把生成的编排 skill 写入你项目的 `.claude/skills/` 和 `.cursor/skills/`。

**这里用的是「Prompt 输出」模式，不调 API，不需要额外的 key，生成的 prompt 直接在你已有的 Claude Code 环境里跑。**

## 五、团队落地：如何保证大家都按流程走

这是一个经常被忽略但很关键的问题。

你把流程设计得再好，如果团队里每个人都在自由发挥，SDD 就变成了一个「Fly哥自己在用的东西」。

Fly哥的做法是：**把定制好的编排 skill 提交到项目仓库里。**

`.claude/skills/` 和 `.cursor/skills/` 这两个目录是跟着项目走的。你把团队定制版的编排 skill 提交进去，所有人 clone 代码之后，打开 Claude Code 或 Cursor，触发词就已经在那里了。

不需要每个人单独配置，不需要口口相传，流程就在代码里。

新人入职，clone 仓库，sdd init 一下，流程就装好了。

## 六、小结

这篇文章解决的是 SDD 在实际落地中最常见的两个摩擦点：

**流程太重**：用 `sdd flow --preset` 选对入口，需求清楚就用 plan-dev，不要每次都跑完整 13 步。

**工具不适配**：用 `/SDD-WORK-FLOW` 把流程收敛到一个编排 skill，替换工具节点时只改这一个文件，底层 skill 不动。

SDD 的核心价值从来不是「必须用这 13 个工具」，而是**让 AI 在一个有结构的流程里工作，而不是在对话框里随机发挥**。工具可以换，结构不能丢。
