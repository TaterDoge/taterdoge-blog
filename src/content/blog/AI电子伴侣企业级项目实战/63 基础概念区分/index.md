---
title: "63 基础概念区分"
pubDate: 2026-05-01
description: "monorepo、workspace、pnpm、Turborepo——第一次接触时，这几个词会同时涌过来。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/2-monorepo-vs-turborepo/](https://aicompanion.usehook.cn/2-monorepo-vs-turborepo/)

## 1. 这几个词经常一起出现，但不是一回事

monorepo、workspace、pnpm、Turborepo——第一次接触时，这几个词会同时涌过来。

有人把 Turborepo 当成 monorepo 本身，有人觉得用了 workspace 就等于上了 monorepo，还有人觉得 pnpm 能把多个包装到一起，那就不需要 Turborepo 了。

混淆的原因很简单：它们在真实项目里总是同时出现。但它们解决的是不同层次的问题，搞清楚各自的位置，后面学什么都不会乱。

## 2. monorepo：仓库怎么组织

最外面一层。

以前三个项目放三个仓库——前端一个，后端一个，组件库一个。monorepo 就是把它们放回同一个仓库。

**monorepo 回答的问题：这些项目要不要放在一个仓库里。**

它不管依赖怎么装、包怎么互相引用、任务怎么跑。这些都是下面几层的事。

## 3. workspace 和包管理器：包怎么装、怎么连

决定放在一个仓库以后，第一个实际问题就来了：`apps/web` 想用 `packages/ui`，`apps/api` 想用 `packages/shared`，怎么让它们互相认识？

这就是 workspace 做的事。它让同一仓库里的多个 package 能按本地包关系一起安装依赖、互相引用。

**workspace 回答的问题：仓库里的这些包怎么连起来。**

pnpm workspace、yarn workspaces、npm workspaces，说的都是这一层。

这里容易混的一点：**pnpm、yarn、npm 首先是包管理器**，它们最基本的工作是装依赖、解析依赖、管 lockfile，workspace 只是它们提供的一项能力。

所以完全可以有：

- 用 pnpm 管依赖的 monorepo

- 用 yarn 管依赖的 monorepo

- 没有 Turborepo，但已经是 monorepo 的项目

只从包管理层看，项目已经能跑起来了。但仓库里 app 和 package 一多，任务怎么跑就成了新问题。

## 4. Turborepo：任务怎么跑

到了这一层，Turborepo 的位置就很好放了。它不决定仓库要不要合并，也不管依赖怎么装。它管的是：**仓库里这么多 app 和 package，任务怎么安排。**

具体来说：

- 开发时哪些任务要一起启动

- build 时谁先跑谁后跑

- 哪些任务之间有依赖关系

- 哪些结果可以缓存，下次不用重来

**Turborepo 回答的问题：任务怎么编排、结果怎么缓存。**

它处理的不是"仓库长什么样"，而是"这个仓库里的活怎么安排"。

记住这个顺序就行：**先有仓库组织，再有本地包关系，最后才有任务编排。**

## 5. 放回项目里看

在一个真实项目里，这几层各自对应不同的文件：

pnpm-workspace.yaml声明 workspace 范围package.json安装依赖和定义脚本turbo.json任务编排和缓存配置

每个文件回答不同的问题：

- `apps/` 和 `packages/` → 这是一个 monorepo

- `pnpm-workspace.yaml` → workspace 范围怎么划

- `package.json` → 依赖怎么装、脚本怎么定义

- `turbo.json` → 任务怎么编排和缓存

## 6. 总结

四个词，四层事情：

| 概念 | 解决什么 |
| --- | --- |
| monorepo | 仓库怎么组织 |
| workspace | 本地包怎么连起来 |
| 包管理器 | 依赖怎么安装 |
| Turborepo | 任务怎么编排、怎么缓存 |

它们是配合关系，不是同一个概念的不同名字。下一篇看 AI 应用为什么比普通项目更容易走到 monorepo。
