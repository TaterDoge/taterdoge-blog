---
title: "150 access token 与 refresh token"
pubDate: 2026-05-28
description: "设计登录时，access token 和 refresh token 是我们绕不开的概念。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/15-auth-tokens/](https://aicompanion.usehook.cn/15-auth-tokens/)

## 1. 概述

设计登录时，`access token` 和 `refresh token` 是我们绕不开的概念。

我们需要分清楚：

- 这两个到底有什么区别

- 为什么不能只发一个 token

- 它们和 session、cookie、JWT 分别是什么关系

## 2. 先记住一句话

可以先直接记这三句：

- `session`：一次登录状态

- `access token`：拿来访问接口的短期凭证

- `refresh token`：拿来续 access token 的长期凭证

## 3. access token 是干什么的

access token 的作用很单纯：

**后续请求接口时，用它证明“我已经登录了”。**

比如用户登录成功之后，后面再请求：

- 获取用户资料

- 获取订单列表

- 修改设置

服务端总得知道“这个请求是谁发的”。

access token 就是干这个用的。

它一般会很短命，比如 5 分钟、10 分钟、15 分钟。

为什么要短？因为它会跟着请求频繁传来传去，一旦泄漏，风险比较高，所以寿命不能太长。

你可以把 access token 理解成：

- 当前请求随身带的临时通行证

- 用得很频繁

- 过期也快

## 4. refresh token 又是干什么的

refresh token 不是拿来频繁访问业务接口的。

它的作用只有一个：

**当 access token 过期之后，用它去换一个新的 access token。**

这就像你的 access token 是门禁卡，过一会儿就失效；refresh token 更像服务台的续卡凭证。

所以 refresh token 和 access token 的差别不是“小一点、大一点”这种区别，而是职责完全不同：

- access token：负责访问接口

- refresh token：负责续 access token

它通常会活得更久，比如 7 天、14 天、30 天。

但也正因为它活得久，所以它更敏感，服务端必须更严格地管理它。

## 5. 为什么不能只发一个 token

假设系统只发一个 token，会有两种情况：

1、这个 token 活得很短，那安全性会比较好。

但问题是，用户体验会很差。用户可能过几分钟就要重新登录一次。

2、这个 token 活得很长，那用户体验变好了。

那问题又来了，只要这个 token 泄漏，攻击者就能长时间冒用，而且服务端很难收回来。

所以真正的问题不是“一个 token 行不行”，而是一个 token 很难同时兼顾安全和体验。因此，我们需要设计两层 token，一个用于短期高频访问，它经常暴露在网络中，一个用于长期续期，它不经常暴露在网络中。

## 6. 它们和 session 的关系是什么

这里一定要分清。

`session` 不是 token，token 也不是 session。

更准确地说：

- session 是服务端记录的一次登录状态

- access token 是这次登录状态下的短期访问凭证

- refresh token 是这次登录状态下的续期凭证

也就是说，session 才是主轴。

可以把关系理解成这样：

- 用户登录成功

- 服务端先创建一条 session

- 然后围绕这条 session 发 access token 和 refresh token

所以后面不管是续期、登出、撤销设备，其实最终操作的核心对象还是 session。

## 7. 它们和 cookie 的关系是什么

cookie 只是浏览器保存数据的容器，和 session、token 不是一回事。

也就是说：

- token 可以放 cookie 里

- token 也可以存放在 local storage 里

## 8. 为什么当前项目里 access token 可以无状态，refresh token 必须有状态

当前这套方案里，access token 用的是 JWT 思路，也就是偏无状态。

它的优势很明显：

- 校验快

- 请求过来时不一定要先查数据库

- 很适合高频接口访问

所以 access token 很适合做成短期、无状态的身份凭证。

但 refresh token 不一样。

如果 refresh token 也完全无状态，那你很快就会失去这些能力：

- 注销

- 单设备下线

- refresh token 轮换

- replay 检测

所以 refresh token 必须落库，而且通常只存 hash，不存明文。

这样服务端才能知道：

- 它有没有过期

- 它有没有被使用过

- 它有没有被撤销

- 它是不是已经被新的 token 替换掉了

## 9. 放到当前项目里，完整链路是什么

当前项目里，这条链路可以这样理解：

- 用户登录成功

- 服务端创建一条 session

- 服务端签发一个短效 access token

- 服务端签发一个长效 refresh token

- access token 用来访问业务接口

- access token 过期后，用 refresh token 去换新的 access token

- refresh token 每次刷新都轮换

所以真正的顺序不是：

- 先有 token

而是：

- 先有 session

- 再有围绕 session 生成出来的 token

## 10. refresh token rotation

既然 refresh token 活得久，那它一旦泄漏，风险天然就更高。

如果同一个 refresh token 可以被反复使用很多次，那攻击者只要拿到一次，就能长期续命。

所以更安全的方案是：

- 每次刷新都让旧 refresh token 失效

- 同时签发一个新的 refresh token

这就叫 refresh token rotation。

这样做的好处很直接：

- 旧 token 被偷后，价值会迅速下降

- 服务端更容易发现重复使用

- 同一个 session 的续期链路更可控

这也是为什么当前项目里会专门为 refresh token 建表，并且保留：

- `used_at_ms`

- `revoked_at_ms`

- `replaced_by_token_id`

- `parent_token_id`

这些字段本质上都是为了管理 refresh token 的生命周期。

## 11. 新手最容易搞混的几个点

### 11.1 误以为 access token 和 refresh token 只是过期时间不同

不只是过期时间不同，它们的职责完全不同。

### 11.2 误以为 access token 过期就等于用户退出登录

不一定。只要 refresh token 还有效，用户通常可以无感续期。

### 11.3 误以为 refresh token 也应该跟着每个接口请求一起发

不应该。refresh token 只应该出现在专门的刷新流程里。

### 11.4 误以为用了 JWT 就不需要数据库状态

access token 可以偏无状态，但 refresh token、session 撤销、设备管理这些能力还是要靠数据库。
