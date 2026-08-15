---
title: "第 12 章　UI 先行  (蒸馏设计SKILL)"
pubDate: 2026-04-20
description: "说明为什么在写 spec 之前先做 UI 定稿，以及如何通过设计蒸馏 Skill 提前锁定界面契约。"
tags: [AI编程, SDD, 企业级实战]
category: AI编程
draft: false
---
原文链接：[https://xiaobot.net/post/75f2e219-c304-45a2-ae5e-deb95aaf3fa0](https://xiaobot.net/post/75f2e219-c304-45a2-ae5e-deb95aaf3fa0)

> 第三部分：实战篇

上一章把架构分叉在脑暴里收束了。很多人下一步就冲接口、冲目录结构——能跑，但容易漏掉一类成本：**UI 里藏着的契约**。这一章专门说：为什么在动代码前，先把界面钉死，往往比先写 spec 更省钱。同时，也要说清楚：AI 设计工具正在把这条链路重新接一遍。

## 12.1 编码前先画 UI，不是「给设计师找活」

常见误区：UI 是设计师的事，开发先搭架子再调样式。

小按钮、小表单无所谓。一旦进入「九宫格 / 转盘 / 盲盒」这种**状态机 + 动画 + 多皮肤**的组合，UI 就不再是皮，而是**数据形状与交互边界的可视化**。

拿九宫格举例：界面上 3×3，第 9 格是「开始」——那奖品数组长度、格子状态枚举、中奖态与待机动画的切换条件，全被 UI 一句话锁死了。若先写 spec 没画稿，写的人很容易漏「第 9 格状态」这种细节；等前端实现时再补，就是标准返工。

先做 UI，本质是让**设计稿当一回合的契约预览**：哪些字段必须存在、哪些状态必须可区分、哪些动画帧意味着额外的时间轴数据——画布上会自己冒出来。

对比两种顺序：

- **先 spec 后 UI**：文字能写全，但人脑对「空间与节奏」不敏感，漏项概率高。

- **先 UI 后 spec**：漏项会在图上显形，补洞成本还在纸面阶段。

我不是说 spec 不重要，而是说：**复杂交互里，图比字更早暴露矛盾。**

## 12.2 Token：把「换肤」从组件里拔出来

Pencil MCP 里，颜色、字体、间距被收成 token，通常一路落到 CSS 变量。

本项目的 token 示意：

```
/* tokens.css */
:root {
--color-bg: #0F0E17;
--color-primary: #6C63FF;
--color-accent: #FF8906;
--color-text: #FFFFFE;
--color-surface: #1B1B2F;
--radius-card: 12px;
--spacing-base: 16px;
}
```

token 不必多，但要**覆盖决策**：主色、强调色、表面色、圆角、基准间距。前端实现时禁止在组件里硬编码 #6C63FF 这种魔法数——换肤只动 tokens.css，组件逻辑不用跟着抖。

skin-system 的 spec 里可以写死一条：**MUST NOT 硬编码颜色，MUST 走 CSS 变量**。设计定义变量，规格约束用法，两条线拧成一股绳。传统「设计给 PSD、开发凭感觉抄色值」的路径，对比之下就是**不可维护的重复劳动**。

## 12.3 .pen 文件：前端的「外观合同」

.pen 里对应本案例 Task 9–14 的前端部分。每个玩法在设计稿里最好都有：

- 静止态（格 / 扇区 / 盒子）

- 关键过渡帧（跑马灯路径、旋转、开箱）

- 中奖弹窗版式

- 历史记录列表样式

有了它，开发不用猜「按钮多大、间距多少、动效多长」。Pencil MCP 还能导出 CSS 变量与尺寸，**还原度争议**在流程上就被砍了一刀。

从协作角度想：远程团队、异步评审、甚至让 AI 对着设计稿写组件——**合同是可视的**，比「口头对齐 + 事后截图扯皮」便宜一个数量级。

---

## 12.4 当设计工具开始交付代码：Figma Make、Claude Design 与设计 MCP

有件事值得单独说：上面这套流程建立在一个假设上——**设计稿和代码是两个产物，中间有个翻译步骤**。现在这个假设开始松动了，而且是从两个方向同时松动的。

### Figma Make：设计即交付

传统流程：设计师出 Figma 稿 → 开发对着稿还原 → 两边来回扯还原度 → 合并上线。每一步都有摩擦，每一步都有信息损耗。

Figma Make 把这条链路重接了一遍。你在 Figma 里描述你想要什么，它交付的不是设计稿，而是**一个可以直接跑的代码仓库**。组件、样式、交互逻辑，一次性出来。

**「设计还原度」这个问题从根上消失了**——没有从稿到代码的翻译步骤，自然就没有翻译误差。对独立开发者来说尤其直接：不需要等设计师，不需要自己扣像素，描述想法，拿代码，改细节，收工。

传统链路 vs 现在：

步骤

传统流程

Figma Make

视觉设计

Figma 出稿，标注，导出

Figma Make 生成

开发还原

对稿写组件，调 CSS

直接拿代码仓库

还原度对齐

反复截图比对

这个步骤不存在了

换肤/迭代

改稿 → 重新还原

改 prompt / 改 token → 重新生成

### Figma MCP 与蓝湖 MCP：让 Claude 直接读设计文件

Figma Make 解决的是「从零生成」的场景。但更常见的情况是——**设计稿早就有了，是 Figma 文件或者蓝湖标注，团队每天都在用**。这时候问题不是「怎么生成」，而是「怎么把设计稿喂进 Claude」。

这就是 **Figma MCP** 和 **蓝湖 MCP** 干的事。它们是 MCP Server，挂到 Claude Code 之后，Claude 能直接读取你的设计文件：

```
// Claude 通过 Figma MCP 拿到的数据（简化）
const componentSpec = await figma.getComponent('GridCell')
// {
//   width: 96, height: 96,
//   borderRadius: 12,
//   fill: 'var(--color-surface)',
//   states: ['idle', 'active', 'prize', 'start'],
//   transition: { duration: 300, easing: 'ease-out' }
// }
```

不是截图，不是手动复制——**结构化的设计数据直接进上下文**。Claude 看到的和设计师定义的是同一份数据源。

对中国团队来说，蓝湖几乎是标配的设计交付工具。蓝湖 MCP 把标注数据接进 Claude 之后，开发打开 Claude Code，通过 MCP 拉最新标注，直接写出符合规格的组件，还原度争议在流程上不复存在。

### /distill-design：从代码仓库蒸馏出 [design.md](http://design.md)

上面两条路有个共同前提：**设计文件存在**。现实里有大量项目走的是另一条路——先有代码，没有设计稿，更没有 [design.md](http://design.md)。接手老项目、赶工出来的 MVP、临时补文档……这种情况不少见，我自己也踩过。

Fly哥在工具链里加了一个 Skill，叫 **/distill-design**，专门处理这种反向场景：**喂进去代码仓库，蒸馏出 **[**design.md**](http://design.md)。

蒸馏的比喻很准——不是凭空创造，是把已经散在代码各处的设计决策**提炼、归集、成文**。Skill 的执行流程大致是：

```
// /distill-design 的内部逻辑（伪代码）
async function distillDesign(repoPath) {
// 第一步：扫描 token 层
const tokens = await scanTokenFiles(repoPath)
// → CSS 变量、theme 文件、tailwind.config、设计常量
// 第二步：扫描组件层
const components = await scanComponents(repoPath)
// → 组件变体、props 枚举、状态类名、动画 class
// 第三步：识别隐性约定
const conventions = await inferConventions({ tokens, components })
// → 间距体系、响应式断点、命名模式、颜色语义
// 第四步：生成 design.md
return generateDesignDoc({ tokens, components, conventions })
}
```

输出的 [design.md](http://design.md) 不是自动注释的复读——它会归整成这几块：

章节

内容

**Token 系统**

颜色语义、间距量级、圆角规则，附实际值

**组件清单**

每个组件的变体、状态枚举、props 约定

**隐性约定**

从代码里推断出的设计规律（比如「所有弹窗圆角 16px」）

**待确认项**

代码里不一致或语义模糊的地方，标出来让人工决策

最后一块很关键。蒸馏不是把代码翻译成文档，而是**把代码里的不一致翻译成问题**——有 3 个地方圆角用了 8px、12px、16px，到底哪个是正确的？这些历史债，文档不记录，就永远是「靠记忆对齐」的状态。

什么时候用这个 Skill？

- 接手老项目，想让 AI 后续修改能「看懂」现有的设计体系

- MVP 跑起来了，打算开始正经维护，需要补设计文档

- 团队扩张，新人或新 AI Agent 需要一份可以冷启动的视觉规格

用了 Figma MCP 的项目，[design.md](http://design.md) 由设计文件驱动——**设计是 source of truth**。用了 /distill-design 的项目，[design.md](http://design.md) 由代码驱动——**代码是 source of truth**。两条路方向相反，但落点一样：把散在各处的设计约定，归拢成一份 AI 和人都能读懂的文件。

代码参考

```
---
name: distill-design
description: 从代码仓库反向蒸馏出 design.md 设计规范文档。适用于没有设计稿的老项目、赶工 MVP、或需要补写设计文档的场景。工作流：扫描 token 文件 → 扫描组件层 → 推断隐性约定 → 生成结构化 design.md。当用户提到「没有设计稿」「反推设计系统」「老项目补文档」「蒸馏 design.md」「从代码提取设计规范」「distill design」「代码里提取样式」「生成设计文档」「反向工程设计稿」时触发。
---
# /distill-design
从代码仓库蒸馏出 `design.md`，把散在代码各处的设计决策提炼、归集、成文。
**核心原则**：只写有证据的内容；低频值标 ⚠️；找不到数据宁可跳过，不编造。
---
## 前置：确定扫描范围
用户调用时，先确认仓库路径。若未指定，默认为当前工作区根目录。
```
目标路径：{repo_root}
输出路径：{repo_root}/design.md（或用户指定路径）
```
读取 `references/scan-patterns.md` → 获取文件扫描清单和正则模式（在 Step 1 前读取一次即可）。
---
## Step 1 — 扫描 Token 层
**目标**：提取显式定义的设计 token（颜色、圆角、间距、字体、阴影）。
### 1.1 定位 token 文件
按 `scan-patterns.md → Token 文件扫描清单` 中的优先顺序，在仓库根目录及 `src/` 下查找：
```
tailwind.config.*  →  读取 theme.extend（自定义 token）
theme.ts / tokens.ts / design-tokens.*  →  读取全部导出值
variables.css / _variables.scss  →  提取所有 --xxx: 声明
styles/globals.css / src/index.css  →  提取 :root 中的 CSS 变量
constants.ts（含颜色关键字的行）  →  提取颜色/尺寸常量
```
### 1.2 提取值
对每个找到的文件，用 `scan-patterns.md → 值提取正则模式` 中的模式提取：
- 所有颜色值（hex / rgba / hsl）
- 所有 border-radius 值
- 所有 font-size / font-family 声明
- 所有 box-shadow / drop-shadow 定义
- 所有间距常量（如 `spacing: { sm: '8px' }`）
### 1.3 记录来源
每个提取到的值记录 `{值} → {文件名}:{行号或变量名}`，供生成文档时引用。
---
## Step 2 — 扫描组件层
**目标**：从组件代码中提取隐性 token 和组件规范。
### 2.1 定位核心组件
按 `scan-patterns.md → 组件文件扫描清单` 查找组件文件。优先处理：
- 被 import ≥ 3 次的组件（高复用 = 核心组件）
- 文件名含 `Button / Card / Badge / Tag / Modal / Header / Nav / Input` 的文件
### 2.2 从组件提取
对每个组件文件，提取：
**内联 style 对象**（React/JSX）：
```jsx
style={{ borderRadius: '3px', color: '#03C3C7' }}
```
→ 用正则 `style=\{\{([^}]+)\}\}` 捕获，解析键值对
**Tailwind className**：
```jsx
className="rounded-lg text-sm font-semibold bg-primary"
```
→ 统计各 utility 出现频率；用 `scan-patterns.md → Tailwind Utility 映射表` 翻译为具体值
**状态变体**：识别以下模式的样式差异：
- 条件渲染：`isActive ? styleA : styleB`
- 状态 class：`active / selected / disabled / hover / focus`
- 伪类：`hover:` / `focus:` / `disabled:` Tailwind 前缀
**动效定义**：
```
transition: all 0.2s ease
transform: scale(0.97)
animation: fadeIn 0.3s ease
```
### 2.3 识别隐性 token
将 Step 1 + Step 2 提取到的所有值合并，统计频率：
- 某颜色值出现 ≥ 5 次 → 视为品牌色 / 功能色
- 某 border-radius 值出现 ≥ 5 次 → 视为默认圆角规则
- 某 padding 值出现 ≥ 3 次 → 视为间距节点
---
## Step 3 — 推断隐性约定
**目标**：发现没有显式声明但全局一致执行的规则。
### 3.1 间距体系
统计所有提取到的 padding / margin / gap 数值（px），找最大公约数：
- 若 8/16/24/32 出现频率最高 → 基础单位 8px
- 若 4/8/12/16 → 基础单位 4px
- 若差异很大，无规律 → 标注「间距体系不统一」
### 3.2 视觉风格分族
若发现以下信号，判断存在多套视觉体系：
- 两个明显不同的主色（非语义色），各自出现 ≥ 5 次
- 同一类元素（如按钮圆角）存在两种截然不同的值（如 `3px` 和 `24px`）
- 页面文件名暗示场景分层（`login/` vs `dashboard/`、`onboarding/` vs `main/`）
确认后：按场景分组，命名为「A 套」「B 套」或更具语义的名称。
### 3.3 命名模式
分析文件名和变量名：
- 组件命名：PascalCase / kebab-case / BEM，检查是否有 feature 前缀
- CSS 变量命名：是否有统一前缀（`--brand-` / `--color-` / `--app-`）
- 颜色变量语义：是否用 `primary/secondary/accent` 还是具体颜色名
### 3.4 特殊规则识别
检查是否存在以下模式（出现 ≥ 3 次即视为约定）：
- 所有滚动容器是否有 `scrollbarWidth: 'none'` / `overflow-scrolling: touch`
- 图片是否统一通过某个 wrapper 组件渲染（如 `ImageWithFallback`）
- 数字/价格是否统一使用特定字体（如 SF Pro、Tabular nums）
- 按钮按压是否统一用 `scale(0.97/0.98)` + transition
---
## Step 4 — 生成 design.md
**目标**：按 `references/design-md-template.md` 的结构，将 Step 1-3 的蒸馏结果写成文档。
### 4.1 读取模板
读取 `references/design-md-template.md`，按其章节顺序填充内容。
### 4.2 章节填充规则
| 章节 | 填充依据 | 无数据时 |
|------|---------|---------|
| 0. 视觉风格总览 | Step 3.2 的分族结果 | 写单套调性描述 |
| 1.1 颜色 | Step 1 + Step 2 高频色值 | 标注「未提取到显式色值定义」 |
| 1.2 圆角 | Step 1 + Step 2 border-radius | 标注 ⚠️ 或跳过 |
| 1.3 间距 | Step 3.1 推断结果 | 标注「间距体系不统一」 |
| 1.4 字体 | Step 1 font-family / font-size | 跳过 |
| 1.5 阴影 | Step 1+2 box-shadow | 标注「（未检测到自定义阴影）」 |
| 2.x 组件规范 | Step 2.2 各核心组件 | 仅列有足够数据的组件 |
| 3. 动效 | Step 2.2 transition/animation | 标注「无统一动效规范」 |
| 4. 响应式 | Step 3 @media / Tailwind 前缀 | 标注「固定宽度移动端布局」 |
| 5. 隐性约定 | Step 3.3 + Step 3.4 | 列出所有已识别规则 |
### 4.3 质量检查（写完后自查）
- [ ] 每个颜色值都有来源标注 `[来源：文件名]`
- [ ] 低频值（< 3 次）已标注 ⚠️
- [ ] 无数据的章节已标注跳过原因，没有编造内容
- [ ] 末尾「蒸馏说明」已填写实际扫描文件列表
- [ ] 若存在多套视觉体系，第 0 节有对比表格
### 4.4 输出
将生成的 design.md 写入 `{repo_root}/design.md`，并告知用户：
- 扫描了哪些文件
- 找到了几个核心组件
- 哪些章节因数据不足被跳过
- 建议人工核查的低置信度内容
```

完整的代码 这个git 链接里 [https://github.com/wzf1997/play-sdd/tree/main/.cursor/skills/distill-design](https://github.com/wzf1997/play-sdd/tree/main/.cursor/skills/distill-design)

### Claude Design：设计决策层的 AI

如果说 Figma Make 解决的是「设计 → 代码」的跨越，Claude Design 解决的是设计决策本身：配色系统、组件层级、响应式断点、动效时间曲线——这些在传统流程里靠设计师直觉，现在可以在对话里拿到有依据的方案。

实际用法上，几个工具可以串联：**Claude Design** 帮你把设计决策说清楚 → **Figma Make** 生成初版代码 → **Figma MCP / 蓝湖 MCP** 把后续迭代的变更实时同步给 Claude → **/distill-design** 在任何时刻都能把当前代码状态蒸馏成文档快照。

Fly哥觉得，这件事对「UI 先行」的意义不是「设计步骤可以跳过了」，而是**设计和代码之间的翻译层正在消失**。真正不变的是这章最核心的那句话：在动业务逻辑之前，先把界面和状态约定好。至于用什么工具——按场景选，别教条。

## 12.5 小结与下一章

UI 先行不是形式主义，是把**状态与数据契约**提前摊在桌面上。新项目用 Figma Make 直接出代码，团队项目接 Figma MCP / 蓝湖 MCP 让 Claude 读稿，老项目跑 /distill-design 把现有代码蒸馏成文档——工具不同，目的一样：让 AI 和人能从同一份规格出发，不靠记忆对齐。

下一章进入 **/opsx:propose**：把已经稳定的视觉与架构叙事，压缩成 proposal、design 决策编号、以及可审查的 [spec.md](http://spec.md)——规格提案这一步，决定后面 AI 写代码时「照着什么抄」。
