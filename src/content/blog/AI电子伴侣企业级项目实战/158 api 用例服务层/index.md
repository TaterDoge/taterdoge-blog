---
title: "158 api 用例服务层"
pubDate: 2026-05-30
description: "刚开始做接口时，把 login、refresh、logout 等接口的所有逻辑都写进同一个 admin.route.ts 是很常见的做法"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/23-fat-route-to-service/](https://aicompanion.usehook.cn/23-fat-route-to-service/)

## 1. 概述

刚开始做接口时，把 login、refresh、logout 等接口的所有逻辑都写进同一个 `admin.route.ts` 是很常见的做法

因为刚起步时，这样写确实顺手。请求进来，校验一下参数，查个用户，验个密码，回个响应，一个文件从头读到尾

你甚至会觉得，拆文件才麻烦。

可登录这类接口不会一直停在最初那几步。写着写着，`route` 里就会慢慢增加更多的逻辑：

- 失败响应

- 邮箱标准化

- 用户查询

- 密码校验

- 角色校验

- session 创建

- token 签发

- refresh token 写入

- logout revoke

- refresh rotation

- replay 检测

这些动作单看都合理。问题在于，它们一层层叠进去之后，`route` 文件就不再只是入口了。

因此，我们需要预判和识别到这些这种变化，合理的对逻辑进行拆分。

## 2. route 文件的代码逻辑是如何变大的

大多数复杂的 `route` 不是故意设计出来的。

通常是今天补一段参数校验失败响应，明天补一个邮箱标准化，后天把 session 也顺手写进去。等 refresh token 接上来，再补 revoked、used、expired 判断。每次都只是多写一点，看起来没什么。

坏处往往不会立刻冒出来。等 login 和 refresh 都写完整之后，`route` 里会同时塞着两类东西：

- HTTP 细节

- 业务主流程

一边是 `zValidator`、`c.req.valid('json')`、`c.json(...)` 这类入口代码；另一边是查用户、验密码、验角色、建 session、发 token 这种核心流程。读代码时，脑子要在这两层之间来回切，文件自然就越来越重。

## 3. 真正别扭的地方在哪

文件长一点，本身没关系。

真正让人难受的，是入口代码和业务主线搅在一起了。

打开一个 `route` 文件，眼睛先扫到的常常是状态码、校验失败分支、请求对象、响应对象。可你真正想确认的，往往是另一件事：

这次登录到底先查谁，后验谁，什么时候建 session，refresh token 在哪一步落库。

主线被夹在这些细节中间，就很难一口气读顺。

再往后走，问题会更明显。以后要加审计、限流、设备信息、cookie 策略时，你会发现代码里没有一个特别自然的落点。因为 `route` 已经把入口和业务编排都揽过去了。

## 4. 缺什么

这里缺的不是工具函数。

项目里通常已经有 repository、jwt、password 这些基础设施能力了。查库有人做，验密码有人做，签 token 也有人做。底层能力并不空。

少的是一个专门承载“完整用例”的地方。

比如：

- admin 密码登录，是一条完整流程

- admin token 刷新，是另一条完整流程

- admin 登出，也是一条独立流程

这几件事更适合各自放在一个 service 文件里。你点进去看到的，应该是一条业务线怎么往下走，而不是一堆零散动作散在 `route` 里。

所以这次拆分，更像是在已有的 route 和 infra 中间，补上一层 use-case / service 层。

## 5. 拆完之后，每一层各自负责什么

如果按这次方案落，目录大概会变成这样：

admin.route.ts薄路由层，只接线admin-password-login.ts登录主流程admin-token-refresh.ts刷新主流程admin-logout.ts登出主流程http.ts失败响应等 HTTP 小工具request-context.ts邮箱、UA、IP 这类请求上下文提取repository.ts查库与写库jwt.tstoken 签发与校验password.ts密码 hash 与校验

可以把它看成三层。

`admin.route.ts` 放在最外面，负责接请求、跑 `zValidator`、拿 `c.req.valid('json')`、调用 service、最后 `c.json(...)` 回响应。它就是入口。

`admin-password-login.ts`、`admin-token-refresh.ts`、`admin-logout.ts` 放在中间层，分别承载登录、刷新、登出这三条完整流程。这里最重要的是让主线连贯。

`repository.ts`、`jwt.ts`、`password.ts` 则继续待在底层，负责把“怎么查”“怎么验”“怎么签”这些能力兜住。

这样一来，主线和细节就分开了。

## 6. 为什么路由层变薄之后会更好读

因为阅读顺序终于顺了。

你先在 `route` 里看入口，知道这个接口收什么参数、调哪个 service、回什么响应。接着点进 service，看这条业务流程到底怎么走。只有在需要的时候，才继续往 `repository`、`jwt`、`password` 那一层追。

这种顺序对新手尤其友好。主线会先露出来，底层细节放在后面按需展开，不会一上来就把人淹住。

## 7. 拆分也别拆过头

很多人开始拆文件之后，很容易一路拆到很细。

比如把登录流程继续切成：

- `find-user.ts`

- `check-role.ts`

- `create-session.ts`

- `issue-refresh-token.ts`

- `rotate-refresh-token.ts`

这样看起来很工整，读起来却未必舒服。

因为登录本来就是一条连续流程。你把它切成五六个小文件之后，读代码的人还得自己把这些步骤重新拼起来。文件是短了，主线反而更散。

对这种场景来说，“每个完整用例一个 service 文件”通常就是比较舒服的停点。层次拆开了，流程也还在。

## 8. 如果现在就动手，最省劲的改法是什么

如果不想一上来大动结构，最省劲的改法很直接。

先把 login、refresh、logout 三个 `async (c) => { ... }` 主体分别搬到三个 service 文件里。

光做这一步，`route` 文件就会轻很多，因为最重的业务编排已经拿出去了。

再把重复出现的 `zValidator` 失败响应提成一个 helper，把那些一眼就能看出重复的 HTTP 细节先收一收。

做到这里，通常已经够了。目录不用大翻修，也不用急着引入更多抽象，先把最重、最重复、最挡阅读的部分拿出来，收益就很明显。

## 9. 以后再遇到这种文件，怎么判断该不该拆

可以记一个很朴素的标准：

**这个 `route` 文件里，是不是已经能看到一条完整业务流程从头走到尾。**

如果它只是收参数、调 service、回响应，那它就是健康的入口文件。

如果它已经自己在做这些事：

- 路由注册

- 请求校验失败响应

- 请求上下文提取

- 多步业务编排

- 安全敏感判断

- repository 调用串联

那就说明它已经开始越界了。

这时候早点把完整用例收进 service 层，后面再加审计、限流、cookie 策略、设备信息，代码都会更容易接得住。

这篇真正想讲的，不是怎么把一个大文件机械拆小，而是让路由层回到入口位置，让完整业务流程待在它该待的那一层。
