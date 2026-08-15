---
title: "68 共享代码怎么拆"
pubDate: 2026-05-03
description: "前面几篇把仓库结构、workspace 和Turborepo 这一层都搭起来以后，项目已经不再是“只有一个目录能跑”的状态了。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/7-splitting-apps-and-packages/](https://aicompanion.usehook.cn/7-splitting-apps-and-packages/)

## 1. 目录已经能跑起来以后，新的问题通常不是工具，而是东西到底该放哪

前面几篇把仓库结构、workspace 和`Turborepo` 这一层都搭起来以后，项目已经不再是“只有一个目录能跑”的状态了。

但这时候真正麻烦的事情，往往才刚开始。

你会开始不断碰到这种判断：

一个类型是不是该提到 `packages/shared`。一个组件是不是该放进 `packages/ui`。一个接口适配层、一个 prompt 生成函数、一个表单校验规则，到底应该继续留在 `apps/web` 里，还是现在就抽出去。

monorepo 真正容易长歪的地方，往往不是搭不起来，而是共享代码抽得太早，或者一直不抽。

## 2. 先有一个最容易出错的判断：不是“能复用”就应该立刻共享

很多人第一次上 monorepo，会很自然地把它理解成：

既然已经有 `packages` 了，那重复一点的东西就应该尽快往外提。

这一步最容易出问题。

因为“看起来可能会复用”和“现在已经形成稳定共享边界”，其实不是一回事。

一个东西刚开始在两个地方都出现，并不代表它已经适合抽成共享包。有时候它只是业务还没完全长定，名字相似、写法相似，但变化节奏并不一样。如果这时候太早提到 `packages` 里，后面最常见的结果不是更干净，而是共享包里开始堆满只服务某一个应用的代码。

所以这一篇真正要解决的问题，不是“怎么抽共享”，而是“什么时候别急着抽”。

## 3. 先留在 apps 里的，通常是业务还没稳定下来的东西

如果一个模块还明显带着具体页面、具体业务流程、具体产品策略，那它通常更适合先留在 `apps` 里。

比如：

index.ts

```typescript
export function buildHomeFeedRequest(userId: string) {
  return {
    path: '/api/feed/home',
    params: {
      userId,
      includePinned: true,
      scene: 'home'
    }
  }
}
```

这类函数虽然也可能会在别的地方用到，但它明显还带着很强的页面语义。它服务的是首页 feed 这条具体业务线，而不是一个已经稳定下来的通用能力。

再比如页面上的一个组合组件：

index.tsx

```tsx
export function HomeHeroCard() {
  return (
    <section>
      <HeroBanner />
      <QuickEntryList />
      <RecommendationBlock />
    </section>
  )
}
```

这种东西就算写得很工整，也不等于应该马上提到 `packages/ui`。因为它本质上还是业务页面的一部分，不是一个已经独立成型的共享组件。

## 4. 适合进 packages 的，往往是边界已经稳定下来的东西

真正适合提到 `packages` 里的，通常有一个共同特点：

它已经不再只依赖某一个页面、某一个具体入口，而是已经形成了比较稳定的复用边界。

最常见的几类就是：

共享组件：

index.tsx

```tsx
interface ButtonProps {
  variant?: 'primary' | 'secondary'
  children: React.ReactNode
}

export function Button({ variant = 'primary', children }: ButtonProps) {
  return <button data-variant={variant}>{children}</button>
}
```

共享类型：

index.ts

```typescript
export interface UserProfile {
  id: string
  nickname: string
  avatar: string
}
```

共享工具函数：

index.ts

```typescript
export function formatPrice(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY'
  }).format(value)
}
```

这些东西一旦被提到 `packages`，往往是因为它们已经不再绑定某一个具体业务页面，而是可以被多个应用稳定地消费。

## 5. 最容易写歪的一种共享，是“看起来通用，其实全是业务细节”

monorepo 里还有一种很常见的坑，就是表面上抽了共享，实际上只是把业务代码搬了个家。

比如你建了一个叫 `packages/shared` 的包，后面慢慢塞进去这些东西：

- 首页专用的接口拼装

- 只服务某一个业务活动的状态逻辑

- 只在一个应用里用到的埋点字段

- 某个页面临时抽出来的 hooks

这时候目录虽然看起来更整齐了，但边界其实更乱了。

因为 `packages` 里的代码一旦被大家默认成“共享层”，后面别人看到这些名字，就会误以为它们是仓库里稳定的公共能力。结果真正改动时，才发现里面装的还是某一个应用自己的业务细节。

所以比“该不该共享”更重要的，是共享以后别人对它的预期会不会变掉。

## 6. 一个更稳的顺序，通常是先放在 apps，再观察它是不是真的稳定

很多时候，一个模块最稳的走法不是一开始就抽出去，而是先在应用里长一段时间。

等它经历过几轮改动以后，你会更容易看清几件事：

它是不是已经被多个地方稳定使用了。

它的命名是不是已经不再绑定具体页面。

它的输入输出是不是已经比较固定。

它后面的变化，是不是开始更多地像“公共能力演进”，而不是“某个业务在反复试错”。

如果这些条件都已经慢慢成立了，这时候再把它提到 `packages`，通常会稳很多。

也就是说，monorepo 里的共享，更像是一次“晚一点但更准确”的提炼，而不是越早越好。

## 7. 真正好用的边界，通常会让目录和心智一起变轻

如果一个共享拆分是对的，你后面通常会感受到两件事同时变轻。

第一件是目录更清楚了。你知道某一类东西该去哪找，不需要在几个应用里来回翻。

第二件是心智也更轻了。因为大家会慢慢形成共识：哪些代码属于业务层，哪些代码已经是仓库级的公共能力。

如果只是目录更整齐了，但每次写代码还是在反复争论“这个到底该放哪”，那多半说明边界还没有真的摆对。

下一篇就接着往下看：当应用、共享包、任务调度这几层都已经有了以后，怎么在一个 monorepo 里同时管理前端、后端、AI 服务和共享配置。

## 8. 总结

monorepo 并不会自动帮你把共享边界变清楚，它只是给了你一个可以把边界摆清楚的地方。

所以这一篇真正想讲的不是“怎么把东西尽快抽到 `packages`”，而是另一句更重要的话：只有当一段代码已经形成稳定边界时，它才适合真的进入共享层。
