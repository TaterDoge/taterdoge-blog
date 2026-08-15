---
title: "65 搭一个最小 monorepo"
pubDate: 2026-05-02
description: "搭 monorepo 最先要做的不是去写 turbo.json，而是决定：仓库里哪些东西算应用，哪些算共享包，哪些配置放在根目录。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/4-minimal-monorepo-structure/](https://aicompanion.usehook.cn/4-minimal-monorepo-structure/)

## 1. 第一步不是写配置，是决定目录怎么摆

前三篇把认知层的东西讲完了。

从这里开始动手。

搭 monorepo 最先要做的不是去写 `turbo.json`，而是决定：仓库里哪些东西算应用，哪些算共享包，哪些配置放在根目录。

第一次搭目录，最常见的两个极端：

- **太保守**——还是按单仓库项目的方式组织，后面长起来又要整体搬一次

- **太激进**——一上来就分出一堆目录和包，项目还没长起来，结构先复杂了

这一篇只搭一个最小可工作的版本，不追求完整。

## 2. 最小 monorepo：先把三层分开

一个最小版 monorepo 要摆清楚的就是三层：对外运行的应用、跨应用共享的代码、仓库公共配置。

package.json仓库根脚本和依赖pnpm-workspace.yaml声明 workspace 范围turbo.json任务编排和缓存规则

`apps` 放能独立启动、独立运行的东西。`packages` 放不会自己对外跑、但会被多个应用复用的东西。

## 3. 为什么第一刀切在 apps 和 packages 之间

这一刀看着普通，但它提前解决了后面最容易打架的边界问题。

不切这一刀会怎样：

- 应用里的业务代码被"顺手共享"出去，共享包里塞满了只服务某一个应用的东西

- 共享代码一直没地方放，每个应用各复制一份，改一处要跟好多处

先分开，规则就很简单：**应用代码先待在应用里，只有真正跨应用复用的，才往 `packages` 里提。**

## 4. 根目录只放全仓库共用的东西

根目录该放什么：根 `package.json`、workspace 配置、`turbo.json`、根 `tsconfig`、lint/format 这类全局配置。

根目录该像一个"仓库层"，而不是某个具体应用的业务目录。**如果根目录里开始混进只属于某一个 app 的东西，说明有东西放错了位置。**

## 5. 不要一次把未来的目录全建出来

一上来就把 `apps/web`、`apps/admin`、`apps/docs`、`apps/worker`，再加 `packages/ui`、`packages/shared`、`packages/config`、`packages/prompts`、`packages/schemas`、`packages/ai-core` 全分出来——如果项目现在还很小，这样做只会让仓库先变复杂。

**先把真正已经存在的边界放出来，后面按需长，比一开始把架子搭满更稳。**

## 6. 这套结构什么时候够用

如果你的项目里前端和 API 已经是两个明确的应用，又开始出现重复使用的类型、工具函数或组件，不想再靠复制代码维护共享逻辑——这套最小结构就够起步了。

它最大的好处不是"看起来专业"，而是后面的 workspace、本地包引用、Turborepo 任务编排，都有了一个清晰的落点。

## 7. 总结

第一次搭 monorepo，最重要的不是目录分多细，而是**先把最容易长期演进的边界摆出来**。

`apps` + `packages` + 根目录公共配置，三层分开，就够往下走了。下一篇看 workspace 怎么把这些本地包连起来。
