---
title: "148 事务"
pubDate: 2026-05-27
description: "这些操作几乎都不是“一条 SQL 就结束”，而是一组必须一起成功、一起失败的数据库动作。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/13-transaction/](https://aicompanion.usehook.cn/13-transaction/)

## 1. 概述

在继续讲认证架构之前，必须先单独讲清楚一个基础概念：事务。

因为后面不管是：

- 创建用户

- 创建 session

- 刷新 refresh token

- 撤销会话

- 绑定第三方账号

这些操作几乎都不是“一条 SQL 就结束”，而是一组必须一起成功、一起失败的数据库动作。

如果没有事务这个概念，后面的认证系统设计就会很容易出现半成功半失败的脏状态。

所以这一篇先不讲登录流程，只把事务这件事讲透：它是什么、为什么需要它、ACID 是什么、提交和回滚在做什么、最常见的并发问题又是什么。

## 2. 什么是事务

可以先把事务理解成一句很朴素的话：

**把多步数据库操作打成一个整体，要么一起成功，要么一起失败。**

比如你要完成一笔转账：

- A 账户扣 100 元

- B 账户加 100 元

- 记录一条转账日志

如果这三步不是事务，而是三条彼此独立的 SQL，那么很容易出现这种情况：

- 第一步成功了

- 第二步失败了

- 第三步没执行

结果就是：A 的钱扣掉了，B 没收到钱。

这显然是不能接受的。

事务的作用，就是把这三步包成一个整体：

- 要么三步都成功，然后一起提交

- 要么其中任何一步出错，前面已经做过的修改也全部撤销

所以事务并不是“让数据库更快”，它的核心价值是：**保证一组相关操作不会只做一半。**

## 3. 为什么业务系统一定需要事务

很多新手第一次写后端时，会本能地把每一步操作都单独执行。

这在“只查数据”时问题不大，但一旦涉及“修改状态”，尤其是多表联动，就会马上出问题。

最典型的场景包括：

- 转账

- 下单扣库存

- 创建用户同时创建凭证

- 创建 session 同时写 refresh token

- 使用旧 refresh token 同时签发新 refresh token

这些场景有一个共同点：**它们本质上都是一个业务动作，但数据库层面往往会拆成多步。**

如果没有事务，系统就很容易出现：

- 数据做了一半

- 业务状态前后不一致

- 日志和真实状态对不上

- 后续排查成本极高

也就是说，只要你的业务里存在“多步写操作”，事务几乎就不是可选项，而是基础能力。

## 4. ACID 到底是什么意思

讲事务时，绕不开 ACID。这四个字母看起来很学术，但你完全可以把它理解成数据库事务的四条基本要求。

### 4.1 Atomicity：原子性

原子性说的是：**事务里的操作不能只做一半。**

要么全做完，要么全不做。

还是用转账举例：

- A 扣款成功

- B 加款失败

如果没有原子性，系统就会停在一个中间状态。

有了原子性，数据库会在失败时把前面的扣款也撤回去。

### 4.2 Consistency：一致性

一致性说的是：**事务执行前后，数据都要满足业务规则。**

比如：

- 账户余额不能凭空减少或增加

- 一个 refresh token 不能被重复消费

- 一个用户的 primary email 只能有一个

事务不是凭空创造这些规则，而是保证执行结果不会破坏这些规则。

### 4.3 Isolation：隔离性

隔离性说的是：**多个事务同时执行时，彼此不要互相踩坏。**

这个点和高并发关系最大。

比如两个请求同时来扣库存，如果没有隔离性，就可能都读到“库存还够”，最后超卖。

也就是说，隔离性处理的是“并发下怎么看见彼此的修改”这个问题。

### 4.4 Durability：持久性

持久性说的是：**事务一旦提交成功，结果就必须真正保存下来。**

不能出现“接口已经告诉你成功了，但数据库一重启结果又没了”。

对业务来说，这意味着：

- 提交成功就应该视为最终结果

- 后续不能悄悄丢失

## 5. 提交和回滚分别在做什么

事务通常会围绕两个动作展开：

- commit

- rollback

### 5.1 commit

提交的意思是：

**这一组操作已经全部成功，可以正式生效。**

也就是说，只有在事务 commit 之后，前面那一组修改才算真正完成。

### 5.2 rollback

回滚的意思是：

**这一组操作中途失败了，把已经做过的修改撤回去。**

回滚最重要的价值，就是避免系统停在半完成状态。

可以把它想成数据库里的“撤销键”。只不过这个撤销不是给人手动按的，而是事务系统在失败时自动帮你做。

## 6. 没有事务时最容易出现什么问题

如果没有事务，多步写操作最常见的问题有三类。

### 6.1 半成功半失败

这是最直观的一种。

例如：

- user 插入成功

- password_credentials 插入失败

结果就是数据库里多了一个“只有用户主体、却没有密码凭证”的残缺用户。

### 6.2 日志和真实状态不一致

比如：

- session 创建成功

- refresh token 写入失败

- 日志还记录了“登录成功”

这时你排查问题会非常痛苦，因为数据库和日志看起来像是两个世界。

### 6.3 并发下重复消费

比如两个请求同时刷新同一个 refresh token，如果没有事务和后续的并发控制，很可能两个请求都觉得自己合法，最后同一个 token 被用了两次。

这就是为什么后面认证系统不仅需要事务，有些高并发场景还要进一步考虑串行控制。

## 7. 事务和并发问题是什么关系

新手很容易把事务和并发理解成两件完全无关的事。

实际上它们关系非常紧密。

事务解决的第一层问题是：

- 一组操作别只做一半

并发问题解决的则是第二层：

- 多个事务同时执行时，别互相踩坏

所以你可以把它们理解成两个层次：

- **事务**：保证单次业务动作内部完整

- **隔离 / 并发控制**：保证多次业务动作并发时仍然正确

后面认证系统里会反复遇到这两层问题：

- 创建 session + refresh token，要靠事务保证完整

- 高频 refresh token rotation，要进一步考虑并发控制

## 8. 在认证系统里，哪些地方最依赖事务

后面要做的 Cloudflare D1 认证系统里，最依赖事务的地方主要有这些：

- 创建用户 + 写入邮箱 + 写入密码凭证

- 登录成功后创建 session + 写 refresh token

- refresh token 轮换

- 撤销 session + 撤销相关 refresh token

- 绑定第三方账号 + 处理关联邮箱

这些场景有个共同点：

- 不是单表单次写入

- 任一步失败都不能留下半成品

举个最关键的例子：refresh token rotation。

一次刷新通常至少要做这些事：

- 查旧 refresh token

- 校验是否已过期 / 已使用 / 已撤销

- 把旧 token 标记为已使用

- 插入新 refresh token

- 更新 session 最后活跃时间

这几步如果不用事务包起来，随便哪一步中途失败，状态都会非常危险。

## 9. D1 里为什么更要有事务意识

D1 是 SQLite 风格数据库，本身非常适合结构化主数据。但也正因为它通常会承载关键认证状态，所以事务意识更不能松。

不要把 D1 当成“轻量数据库，所以可以随便写几条 SQL”来理解。

只要数据涉及：

- 用户身份

- 会话

- token

- 权限

就必须按事务思维来设计。

也就是说，轻量不等于可以忽略一致性，反而越是认证这种敏感系统，越要先把事务边界想清楚。

## 10. 在 D1 中，如何使用 Drizzle ORM 操作事务

前面讲的都是概念。到了真实项目里，新手最关心的问题通常会变成：

- 在 Cloudflare D1 里到底怎么写事务

- 用 Drizzle ORM 时，事务代码应该长什么样

先说结论：

- D1 本身支持事务语义

- 在 Drizzle 里，事务通常通过 `db.transaction(async (tx) => { ... })` 这种形式来写

- 回调里的 `tx` 就是这次事务的上下文

- 回调正常结束就提交，抛错或主动回滚就撤销

可以先看最基础的形态：

index.ts

```typescript
const result = await db.transaction(async (tx) => {
  // 先在事务里读取用户，确认这次后续写入是否有继续执行的前提。
  const user = await tx.query.users.findFirst({
    where: eq(users.id, userId),
  })

  // 只要前置条件不成立，就立刻回滚。
  // 这里的 rollback 会让当前事务里已经做过的修改全部撤销。
  if (!user) {
    tx.rollback()
  }

  // 第一步：创建会话。
  // 注意这里不是用外层 db，而是用 tx，表示这条写入属于当前事务。
  await tx.insert(authSessions).values({
    id: sessionId,
    userId,
    applicationId,
    createdAtMs: now,
    expiresAtMs: expiresAt,
  })

  // 第二步：创建 refresh token。
  // 这一步必须和 session 创建放在同一个事务里，避免只写入 session、却没有 refresh token。
  await tx.insert(refreshTokens).values({
    id: refreshTokenId,
    sessionId,
    jtiHash,
    issuedAtMs: now,
    expiresAtMs: refreshExpiresAt,
  })

  // 回调正常返回时，Drizzle 会提交这次事务。
  // 只有走到这里，前面的 insert 才会真正生效。
  return { sessionId, refreshTokenId }
})
```

这段代码里有几个要点。

**第一，`tx` 不是普通的 `db`。**

它代表“当前这次事务里的数据库上下文”。你在里面做的查询和写入，不再是彼此独立的数据库操作，而是被包进了同一个事务里。

**第二，事务里不只有写，也可以先读再写。**

这点在认证系统里特别常见。比如：

- 先查旧 refresh token 是否存在

- 再判断它是不是过期

- 再更新它的状态

- 再插入新的 refresh token

这些步骤必须放在同一个事务里，不能拆散。

**第三，回调正常结束才会提交。**

也就是说，只有整个回调函数顺利跑完，前面的插入和更新才会正式生效。

**第四，抛异常或手动回滚都会撤销。**

例如你发现某个关键条件不满足，可以直接抛错：

index.ts

```typescript
await db.transaction(async (tx) => {
  const token = await tx.query.refreshTokens.findFirst({
    where: eq(refreshTokens.id, refreshTokenId),
  })

  if (!token) {
    throw new Error('Refresh token not found')
  }

  if (token.usedAtMs) {
    throw new Error('Refresh token already used')
  }

  await tx.update(refreshTokens)
    .set({ usedAtMs: Date.now() })
    .where(eq(refreshTokens.id, refreshTokenId))
})
```

只要抛错，前面还没提交的修改就不会留下来。

### 10.1 在认证系统里，事务代码通常长什么样

放到当前这套 D1 认证系统里，最典型的事务场景之一，就是“登录成功后同时创建 session 和 refresh token”。

可以把它写成这种结构：

index.ts

```typescript
await db.transaction(async (tx) => {
  // 第一步：先创建 session。
  // 只要这一步还没提交，数据库外部就不应该把它当成最终完成状态。
  await tx.insert(authSessions).values({
    id: sessionId,
    userId,
    applicationId,
    sessionType: 'web',
    createdAtMs: now,
    expiresAtMs: sessionExpiresAt,
  })

  // 第二步：再创建 refresh token。
  // 如果这里失败，前面已经插入的 session 也要一起撤销，不能留下半成品。
  await tx.insert(refreshTokens).values({
    id: refreshTokenId,
    sessionId,
    jtiHash,
    issuedAtMs: now,
    expiresAtMs: refreshExpiresAt,
  })

  // 整个回调顺利结束后，事务才会统一提交。
})
```

这里为什么必须用事务？

因为如果：

- session 写入成功

- refresh token 写入失败

那数据库里就会留下一个“已经登录，但拿不到 refresh token”的半成品会话。

### 10.2 refresh token rotation 为什么更依赖事务

再看一个更关键的场景：refresh token rotation。

它通常至少会包含这些动作：

- 查旧 token

- 判断它是否已使用 / 已撤销 / 已过期

- 标记旧 token 为已使用

- 插入新 token

- 更新 session 最后活跃时间

这类逻辑如果拆成多段独立 SQL，就特别容易在中途失败时留下脏状态。

所以在 Drizzle 里，最合理的写法仍然是：

index.ts

```typescript
await db.transaction(async (tx) => {
  // 第一步：读取旧 refresh token 当前状态。
  // 这一步必须放在事务里，后续更新和插入才能跟这次读取保持同一个上下文。
  const oldToken = await tx.query.refreshTokens.findFirst({
    where: eq(refreshTokens.id, oldRefreshTokenId),
  })

  // 第二步：校验旧 token 是否还能继续使用。
  // 只要已经用过、撤销过，或者根本不存在，就直接抛错，让事务整体回滚。
  if (!oldToken || oldToken.usedAtMs || oldToken.revokedAtMs) {
    throw new Error('Refresh token is invalid')
  }

  // 第三步：把旧 token 标记为已使用，并记录它被哪个新 token 替换。
  // 这一步和后面的“插入新 token”必须绑定在同一个事务里。
  await tx.update(refreshTokens)
    .set({ usedAtMs: now, replacedByTokenId: newRefreshTokenId })
    .where(eq(refreshTokens.id, oldRefreshTokenId))

  // 第四步：插入新的 refresh token，形成 rotation 链条。
  await tx.insert(refreshTokens).values({
    id: newRefreshTokenId,
    sessionId: oldToken.sessionId,
    jtiHash: newJtiHash,
    issuedAtMs: now,
    expiresAtMs: newExpiresAt,
    parentTokenId: oldRefreshTokenId,
  })

  // 第五步：顺手更新 session 的最后活跃时间。
  // 这样同一次 refresh 相关状态会一起提交，而不是散在多次写入里。
  await tx.update(authSessions)
    .set({ lastSeenAtMs: now })
    .where(eq(authSessions.id, oldToken.sessionId))

  // 回调结束后，以上三次写操作会一起提交。
  // 中途任一步抛错，前面的状态修改都会一起撤销。
})
```

这就是前面讲的“多步写操作必须作为一个整体”的最典型例子。

### 10.3 D1 + Drizzle 在事务上的理解边界

这里再补一个很重要的理解边界。

Drizzle ORM 是你写事务代码的方式，D1 是最终执行这些事务的数据库。

也就是说：

- D1 决定事务语义是否成立

- Drizzle 负责把事务 API 组织成更清晰的代码结构

所以不要把 Drizzle 理解成“它自己发明了事务”，它只是把事务写法变得更工程化、更可维护。

## 11. 新手写事务时最容易犯的错

最后补几个最常见的坑。

**第一，把事务里的步骤拆出去。**

比如前两步用 `tx`，后两步又直接用外面的 `db`。这样就等于把一个事务拆坏了。

**第二，在事务里只写更新，不先做校验。**

很多认证逻辑的关键不只是写，而是“先查当前状态，再决定能不能写”。

**第三，把事务当成并发控制的全部。**

事务能保证“单次业务动作内部完整”，但高并发下同一个对象的竞争问题，后面有时还要结合更严格的串行控制来看。

所以更准确的理解是：

- 事务先保证一组操作不做一半

- 并发控制再保证很多组操作同时来时不互相踩坏

## 12. 新手可以怎么记住事务

如果要用一句最容易记住的话概括事务，可以直接记成：

**一次业务动作拆成多步数据库写入时，这几步必须被当成一个整体来处理。**

再压缩一点，就是：

- 要么一起成功

- 要么一起失败

只要脑子里一直带着这个判断标准，后面在设计登录、session、refresh token、OAuth 绑定这些流程时，你就很容易看出来：哪些地方必须用事务，哪些地方只是普通查询。

下一篇就会正式进入认证架构设计。到那时，你会看到事务不是一个抽象概念，而是整套认证系统能不能稳定工作的底座之一。
