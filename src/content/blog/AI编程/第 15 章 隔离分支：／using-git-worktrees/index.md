---
title: "第 15 章　隔离分支：/using-git-worktrees"
pubDate: 2026-05-02
description: "说明为什么 SDD 开发前要用 git worktree 隔离分支，以及如何降低多任务并行时的工作区污染。"
tags: [AI编程, SDD, 企业级实战]
category: AI编程
draft: false
---
原文链接：[https://xiaobot.net/post/1ef8002a-fcd3-4fe8-a8e2-02bb25ae2053](https://xiaobot.net/post/1ef8002a-fcd3-4fe8-a8e2-02bb25ae2053)

> 第三部分：实战篇

上一章把实施计划拆成了 Task 图，该拆的拆、该排的排，看上去万事俱备。但在真正开写之前，还有一道很土、很容易被忽略、但会在你最不想出事的时候给你埋雷的工程题：

**工作目录怎么管？**

这一章说 git worktree。不是炫技，不是为了把简历写漂亮，是给 AI 辅助开发这种「agent 随时可能动你文件」的工作模式，留一条「主仓干净、分支互不污染」的退路。

---

## 15.1 切分支的隐形成本

大多数人对切分支没什么戒心。git checkout feature-xxx，改几行，git checkout main，一气呵成，没出过问题。

直到出了问题。

Fly哥印象最深的一次是带团队做一个活动页重构。agent 在 feature 分支上跑了一半，我手贱在根目录跑了一句全局格式化——结果 main 和 feature 的文件同时被动了，后来 merge 的时候 diff 全是格式噪声，代码 review 直接废了。那次 PR 推迟了两天，原因不是功能没做完，是没人分得清哪些是真改动、哪些是格式变更。

这个问题的根源很简单：**切分支时，工作区文件会跟着变；但你的工具链、脚本、IDE，乃至你自己的手，并不总是知道「现在在哪个分支」。**

几个高频场景：

本地有一坨未提交改动，切分支时冲突，你只好 stash。stash 这个东西理论上很好用，实际上 Fly哥见过无数次「stash 了但后来忘了」的悲剧，最后 git stash list 一看，攒了十几条，没一条记得是干什么的。

两个分支目录结构差太大——比如一个是旧版 pages 路由，一个是新版 app 路由——切来切去，IDE 的索引和类型提示开始发疯，TypeScript 报一堆莫名其妙的错，你花半小时排查，最后发现是 IDE 缓存没刷新。

AI agent 在 feature 上做大批量修改，你同时要在 main 查一个线上 bug。手动切分支，agent 的上下文和未提交改动怎么处理？要 commit 吧，但又没到提交节点；要 stash 吧，上面说了 stash 不可靠。

传统的解法无非两条：stash，或者另 clone 一份仓库。前者容易忘，后者占磁盘还要额外维护远端同步。

**worktree 是第三条路：同一套 .git 数据库，派生出多套独立的工作树。** 主仓动不着，feature 改动物理隔离，用完删掉，干干净净。

---

## 15.2 worktree 给 AI 协作带来的额外收益

说 worktree 对普通 git 工作流有用，很多人听了会说「我用 stash 也够了」。但放进 AI 协作的场景里，这个工具的价值层级是不一样的。

**问题的本质变了。**

传统开发，切分支是你自己的动作，你知道自己在干什么，误操作概率低。AI 协作里，agent 有自己的 cwd，工具链有默认的工作路径，你在一个终端里敲命令，agent 在另一个进程里跑任务——两者的「当前目录」是不同的，但后果会叠加到同一个文件系统上。

**误触面控制。** 工具链、构建脚本、agent 的默认 cwd 如果指错了——这种情况比你想象的多——至少不会一把梭到主分支文件上。worktree 等于给主仓加了一层物理隔离，agent 只能动它自己那个目录下的文件，越不出去。这不是在说 agent 不靠谱，是说**能用物理隔离解决的问题，就不要靠「足够小心」来防范。**

**真正的并行工作。** 你一边在 main 分支上查文档、回 code review、修一个紧急 bug；一边让 agent 在 .worktrees/feature-xxx/ 里滚着任务。两边互不干扰，你不需要每次查 main 上的内容都先 commit feature 的进度、切分支、查完再切回来。路径即上下文——打开 .worktrees/feature-xxx/ 下的文件，脑子里自动进入 feature 的心理模型；打开根目录，就是 main 的上下文。比 git status 和 git branch 直观太多了。

说白了：**worktree 买的是隔离，付的是多占一个文件夹。** 在复杂 feature 上，这账怎么算怎么划算。

---

## 15.3 /using-git-worktrees 实际在做什么

光说理念没用，这节把 /using-git-worktrees 这个指令拆开看——它在幕后走了四个步骤，每一步都有具体的判断逻辑。

### 第一步：目录选择

worktree 放哪里，不是随便定一个路径就算了。这个指令有一套优先级：

```
# 按顺序探测
ls -d .worktrees 2>/dev/null   # 优先：隐藏目录，不显眼
ls -d worktrees 2>/dev/null    # 备选：明文目录
```

如果 .worktrees/ 或 worktrees/ 已经存在，直接用。两个都有的话 .worktrees/ 优先。如果都不存在，先去 [CLAUDE.md](http://CLAUDE.md) 查项目约定：

```
grep -i "worktree.*director" CLAUDE.md 2>/dev/null
```

有指定就用指定的，不问你。只有在什么都查不到的情况下，才会问你选项目本地还是全局路径：

```
No worktree directory found. Where should I create worktrees?
1. .worktrees/ (project-local, hidden)
2. ~/.config/superpowers/worktrees/<project-name>/ (global location)
```

**为什么要这么设计？** 因为「每次都问」的工具没人愿意用，但「乱猜目录」会破坏团队约定。优先读现有状态、读项目文档，问用户只是最后手段。

### 第二步：安全校验

这一步是最容易被省掉、但省掉代价最高的。

如果你选的是项目本地目录（.worktrees/ 或 worktrees/），在创建 worktree **之前**，必须确认这个目录已经被 gitignore 掉了：

```
git check-ignore -q .worktrees 2>/dev/null
```

这条命令会同时检查本地 .gitignore、全局 gitignore、系统级 gitignore，比手动 cat .gitignore | grep 可靠得多。

**如果没有忽略怎么办？** 不是报错退出，是立刻修：

```
echo ".worktrees/" >> .gitignore
git add .gitignore
git commit -m "chore: ignore worktree directory"
```

修完提交，再继续创建 worktree。这是「发现问题立刻修」的原则——不留技术债，不靠人记。

你可能觉得这有点繁琐。但想想另一个场景：worktree 目录没有被忽略，里面积累了几十个分支的工作文件，某天你跑 git add .，把 .worktrees/ 下一堆临时文件全提交进去了。Fly哥见过这种 PR，review 的人当场懵了。

全局路径（~/.config/superpowers/worktrees/）不需要这步，因为整个目录在项目之外，git 根本看不到。

### 第三步：环境安装

worktree 建好之后，是一个干净的分支检出，但**没有依赖**。直接让 agent 跑任务，大概率第一步就报「找不到模块」。

指令会根据项目文件自动探测并安装：

```
# Node.js
[ -f package.json ]      && npm install
# Rust
[ -f Cargo.toml ]        && cargo build
# Python（两种包管理都支持）
[ -f requirements.txt ]  && pip install -r requirements.txt
[ -f pyproject.toml ]    && poetry install
# Go
[ -f go.mod ]            && go mod download
```

没有匹配文件就跳过，不会报错、不会猜。这是「自动探测而不是硬编码」——同一个指令在 Node 项目和 Rust 项目里都能用，不需要改配置。

### 第四步：基线验证

这一步是最容易被质疑「有没有必要」的——但 Fly哥认为它是整个流程里最有价值的一环。

环境装好之后，跑一次项目测试：

```
npm test      # Node
cargo test    # Rust
pytest        # Python
go test ./... # Go
```

**如果全过了**，输出 worktree 路径 + 测试结果，告诉你可以开工了：

```
Worktree ready at /Users/fly/myproject/.worktrees/feature-auth
Tests passing (47 tests, 0 failures)
Ready to implement auth feature
```

**如果有失败**，停下来问你：是继续推进，还是先查清楚？

这不是在替你做决定，是在给你一个明确的决策点。失败的测试有两种可能：一是分支本身带着上游还没修的 bug，二是环境装得有问题。不问就推进，后来 agent 改出来的代码出了问题，你根本说不清是 feature 的锅还是环境的锅。

**基线验证的核心价值是：让「新引入的问题」和「已有的问题」可以被区分。** 没有这个基线，debug 就是在大海里捞针。

---

完整跑下来，你会看到类似这样的输出：

```
I'm using the using-git-worktrees skill to set up an isolated workspace.
[Check .worktrees/ - exists]
[Verify ignored - git check-ignore confirms .worktrees/ is ignored]
[Create worktree: git worktree add .worktrees/sdd-game-landing -b feature/sdd-game-landing]
[Run npm install - 847 packages]
[Run npm test - 47 passing]
Worktree ready at /Users/fly/myproject/.worktrees/sdd-game-landing
Tests passing (47 tests, 0 failures)
Ready to implement sdd-game-landing feature
```

收尾阶段，配合 /finishing-a-development-branch 流程，两条命令清理现场：

```
git worktree remove --force .worktrees/sdd-game-landing
git branch -d feature/sdd-game-landing
```

---

下一章，计划有了，目录隔开了，基线也验证了，真正的重头戏来了——**/subagent-driven-development**：Task 怎么被 agent 实现、怎么对照 spec 逐条审查、以及质量检查怎么抓住单测抓不到的逻辑漏洞。
