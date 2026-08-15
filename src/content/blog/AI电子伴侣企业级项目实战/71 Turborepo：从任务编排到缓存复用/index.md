---
title: "71 Turborepo：从任务编排到缓存复用"
pubDate: 2026-05-04
description: "如果仓库里已经有 apps/web、apps/api，还有 packages/shared、packages/ui 这样的共享包，那开发时到底该怎么启动，构建时谁应该先跑谁应该后跑，lint 和 test 又该由谁来统一调度。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/9-what-turborepo-does/](https://aicompanion.usehook.cn/9-what-turborepo-does/)

## 1. workspace 把包连起来以后，下一步卡住的通常是任务怎么一起跑

前面几篇把 workspace 这层讲清楚了。

仓库里的本地包已经能互相引用，依赖管理和共享边界也有了基本方向。

到了这里，一个新的问题会很自然地出现。

如果仓库里已经有 `apps/web`、`apps/api`，还有 `packages/shared`、`packages/ui` 这样的共享包，那开发时到底该怎么启动，构建时谁应该先跑谁应该后跑，`lint` 和 `test` 又该由谁来统一调度。

这时候就该看 Turborepo 了。它接手的不是包和包之间的引用关系——那一层已经由 workspace 处理了。它接手的是另一件事：**这些包已经存在以后，日常的任务怎么一起跑。**

## 2. 真正让任务跑起来的，是三层东西

如果先把场景收到最小，真正参与这件事的通常是三层。

**第一层是每个包自己的 `package.json`。** 任务本身还是在各自包里声明：

package.json

```json
{
  "name": "@acme/web",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "lint": "next lint"
  }
}
```

package.json

```json
{
  "name": "@acme/shared",
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs",
    "lint": "eslint src --ext .ts"
  }
}
```

**第二层是仓库根目录的 `package.json`，** 它只是把常用入口收成统一命令：

package.json

```json
{
  "name": "acme-monorepo",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "test": "turbo run test"
  },
  "devDependencies": {
    "turbo": "^2.0.0"
  }
}
```

**第三层才是 `turbo.json`，** 它负责把这些任务之间的关系说清楚：

turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "outputs": []
    }
  }
}
```

三层关系很清楚：包自己声明任务，根目录统一给入口，Turborepo 负责调度。

## 3. 任务编排：这次到底该拉谁进来

很多人第一次看 `turbo run build`，直觉会把它理解成"把所有包的 build 都跑一遍"。

不完全对。Turborepo 会先看这次运行的入口是什么，再结合过滤条件、任务定义和包之间的依赖关系，决定到底把哪些任务拉进来。

所以任务编排解决的不是"批量跑命令"，而是：这次运行到底影响到谁，哪些任务值得现在跑，哪些根本不用拉进来。

比如你只想构建某个应用：

index.bash

```shellscript
turbo run build --filter=@acme/web
```

这时候它不是机械地把仓库里所有 `build` 都跑一遍，而是围绕 `@acme/web` 这个目标，把真正相关的任务范围收出来。

## 4. 依赖关系：为什么 build 要先看上游包

`turbo.json` 里最核心的一个字段就是 `dependsOn`：

turbo.json

```json
"build": {
  "dependsOn": ["^build"]
}
```

这里的 `^` 前缀是关键。`"^build"` 的意思是：**当前包在跑 build 之前，先把它依赖的上游包的 build 都跑完。**

具体来说：如果 `apps/web` 依赖了 `packages/shared`，而 `packages/shared` 也有自己的 `build` 任务，那执行时会先构建 `packages/shared`，再构建 `apps/web`。

这层关系一旦成立，仓库里包越来越多，构建顺序也不会跟着变乱——顺序已经不是靠人脑记住"这个包要先编"，而是交给任务图自动处理。

## 5. 缓存：别把已经确认过的结果再算一遍

Turborepo 最容易被误解的一层就是缓存。

很多人第一次听到它有缓存，会本能觉得这是一种"跳过执行"的小技巧。其实它更像是：一次已经算过的结果被正式保存下来，后面如果输入没变，就不再重复算。

这也是为什么 `outputs` 很重要：

turbo.json

```json
"build": {
  "dependsOn": ["^build"],
  "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
}
```

`outputs` 告诉 Turborepo：这个任务真正产出的结果在哪。后面缓存命中时，它才知道该复用什么；任务重新执行时，也才知道哪些产物属于这次任务的一部分。

如果 `outputs` 没写或写得不准确，缓存命中时可能不会正确恢复产物——你会看到 Turborepo 显示 "cache hit"，但 `dist/` 目录却是空的。

## 6. 为什么 dev 和 build 的写法不一样

很多人第一次看 `turbo.json` 时会奇怪：为什么 `build` 要配 `outputs`，但 `dev` 却是：

turbo.json

```json
"dev": {
  "cache": false,
  "persistent": true
}
```

因为这两类任务的性质完全不同。

`build` 是一次有明确产物的任务——跑完以后留下 `dist`、`.next` 这类结果，后面可以复用。

`dev` 不是——开发服务要一直挂着，等待文件变化、持续响应请求。它不是那种"算出一个结果然后结束"的任务。对这类任务来说，缓存没有意义，所以用 `cache: false` 关掉。`persistent: true` 则告诉 Turborepo 这是一个长时间运行的进程，不要把它当成"运行完就结束"的任务来处理。

一句话概括：**是否缓存，取决于这个任务是在"产出结果"还是在"持续服务"。**

## 7. 日常开发里最先感受到的变化

如果前面的配置已经对上了，日常开发里最先感受到的变化不是语法，而是入口变少了。

以前你可能要分别进不同目录，手动启动不同应用，或者自己记住哪个共享包需要先构建。现在更常见的做法是直接在仓库根目录运行：

index.bash

```shellscript
pnpm dev
```

或者在需要时只跑某一部分：

index.bash

```shellscript
turbo run build --filter=@acme/web
```

你会慢慢感觉到几件事同时成立：改动范围能收住，相关任务会自己按顺序排好，已经确认过的结果会被尽量复用。

这时候 Turborepo 带来的就不只是"命令统一"，而是一套真正能随着仓库变大继续撑下去的任务系统。

## 8. 总结

workspace 把本地目录连成了一套正式的包关系，Turborepo 则在这套关系之上，接手了三层事情：

- **任务编排**——这次运行到底影响到谁

- **依赖排序**——哪些上游任务需要先完成

- **缓存复用**——已经确认过的结果不再重复计算

这三层一起成立以后，monorepo 才不会在仓库继续变大时，退回到"动一点就整仓重跑"的状态。

下一篇继续往深走：`turbo.json` 里还有哪些字段直接决定了缓存是否真正可信。
