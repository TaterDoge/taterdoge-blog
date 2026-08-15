---
title: "149 session"
pubDate: 2026-05-28
updated: 2026-06-05
description: "讲登录和鉴权时，session 是一个绕不过去的词。可它也是最容易把新手搞晕的词之一。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/14-session/](https://aicompanion.usehook.cn/14-session/)

## 1. 概述

讲登录和鉴权时，`session` 是一个绕不过去的词。可它也是最容易把新手搞晕的词之一。

很多人第一次接触登录系统时，会把下面这些东西混在一起：

- session

- cookie

- access token

- refresh token

- JWT

结果就是：明明每个词都见过，但一到真正设计系统时，脑子里还是一团糊。

所以这篇文章先不急着讲具体代码，而是先把 `session` 这个概念讲透：它到底是什么、它为什么存在、它和 cookie / token 分别是什么关系，以及放到当前这个 Cloudflare + D1 + JWT + refresh token 的项目里，session 在整套认证系统里处于什么位置。

## 2. session 到底是什么

可以先用一句最容易记住的话理解它：

**session 是服务端用来表示「一次登录状态」的会话对象。**

这里的关键词不是“用户”，而是“这一次登录”。

比如同一个用户：

- 在电脑浏览器登录一次

- 在手机浏览器再登录一次

- 在平板再登录一次

从“用户是谁”这个角度看，还是同一个用户。

但从“登录状态”这个角度看，其实已经有了三次不同的会话，也就是三条不同的 session。

所以 session 不是用户本身，也不是密码，更不是 token。它更像是服务端对一次登录状态的记录。

## 3. 为什么登录系统里一定会有 session

只要系统不是一次性请求，而是“登录后持续保持身份”，就一定会遇到一个问题：

**服务端怎么知道当前这个请求，还是刚才那个已经登录的人发来的？**

这就是 session 要解决的事情。

它承担的是“把多次请求串成同一段登录状态”的职责。

没有 session 这个概念，服务端就很难清楚地表达下面这些事：

- 这个用户当前有几个登录中的设备

- 某一个设备的登录状态能不能单独撤销

- 这个 access token 属于哪一次登录

- refresh token 刷新时，到底是在延续哪一个会话

也就是说，只要你的系统需要“持续登录态”，session 几乎就会自然出现。只是有的系统把它显式建成数据库表，有的系统把它藏在别的结构里。

## 4. session 和 cookie 到底是什么关系

这是最容易混淆的地方。

很多新手会以为：

- cookie 就是 session

这个理解不对。

更准确的说法是：

- **session 是服务端的会话概念**

- **cookie 是浏览器端保存信息的一种载体**

也就是说，cookie 只是“浏览器拿来存东西”的容器，而 session 是“服务端认定的一次登录状态”。

在传统 session-based 登录里，最常见的模式是：

- 用户登录成功

- 服务端创建一条 session 记录

- 服务端把 session id 放进 cookie

- 浏览器后续每次带着 cookie 过来

- 服务端拿 cookie 里的 session id 去查 session

这时看起来像是“cookie 保存了登录状态”，但其实 cookie 保存的只是一个指针，真正的登录状态仍然在服务端 session 里。

## 5. session 和 JWT / token 又是什么关系

再往下走一步，很多现代系统不再直接把 session id 放 cookie 里，而是改成：

- access token

- refresh token

这时又容易产生第二个误解：

- 既然已经有 token 了，是不是就不需要 session 了？

答案通常是：**不是。**

原因很简单。

access token 负责的是：

- 当前请求是谁

- 属于哪个子站

- 带了哪些角色

它更像“当前请求的身份凭证”。

但 session 负责的是：

- 这次登录本身是不是还有效

- 这个用户当前一共有几个设备在登录

- 这一串 refresh token 属于哪一次登录

- 这次登录要不要被单独撤销

也就是说：

- token 更偏“请求级身份”

- session 更偏“登录级状态”

所以在很多 JWT 方案里，session 并没有消失，只是换了一种和 token 配合的方式存在。

## 6. 用一个具体例子理解这几个概念

假设用户 A 登录了 web 子站。

登录成功后，系统通常会同时产生几样东西：

- 一个 `user_id`

- 一条 `session`

- 一个 `access token`

- 一个 `refresh token`

它们各自管的事情完全不同：

- `user_id`：这个人是谁

- `session`：这是哪一次登录

- `access token`：当前请求怎么快速证明身份

- `refresh token`：access token 过期后，怎么续期

如果把它们混成一个概念，后面设计数据库和接口时一定会乱。

## 7. 当前项目里，session 应该长什么样

放到当前这个 Cloudflare + D1 + JWT + refresh token 的项目里，session 最合理的定位，是一张独立的会话表。

例如：

index.sql

```sql
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('web', 'admin')),
  device_name TEXT,
  user_agent TEXT,
  ip TEXT,
  last_seen_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER,
  revoke_reason TEXT
);
```

这张表表达的不是“用户资料”，而是“一次登录实例”。

你可以把它理解成：

- 某个用户

- 在某个子站

- 用某种设备

- 在某个时间点

- 发起了一次登录

这个登录状态后面会被 access token、refresh token、登出、刷新、撤销这些动作反复引用。

## 8. 为什么当前项目里 session 不能省略

当前这套方案里，access token 是短期无状态的，refresh token 是长期有状态的。

只要 refresh token 需要落库，session 几乎就一定要存在。

原因有三个。

### 8.1 需要知道 refresh token 属于哪一次登录

一个用户可能同时在多个设备上登录。

如果没有 session，你就很难表达：

- 这个 refresh token 是哪台设备的

- 这个 refresh token 刷新的是哪段登录状态

- 某次注销到底该撤销哪一串 token

### 8.2 需要支持单设备下线

用户很常见的需求不是“退出所有设备”，而是：

- 只退出这台电脑

- 只踢掉那台旧手机

这类能力本质上依赖的就是 session，而不是 user。

### 8.3 需要给 access token 一个稳定的会话锚点

当前 access token 里通常会带一个 `sid`，也就是 session id。

例如：

index.json

```json
{
  "sub": "user_id",
  "sid": "session_id",
  "app": "web",
  "roles": ["web_user"]
}
```

这里的 `sid` 不是装饰字段，它是“当前请求属于哪次登录”的锚点。

## 9. session 和 refresh token 是怎么配合的

这两个概念经常一起出现，但它们不是一回事。

更准确的关系是：

- session 是一段登录状态

- refresh token 是这段登录状态下的续期凭证

一个 session 下面，可以关联一串 refresh token 记录。

例如：

- 第一次登录，签发 refresh token A

- A 用来刷新时，签发 refresh token B

- B 再刷新时，签发 refresh token C

这整条链条，实际上都属于同一个 session。

所以后面当你看到 refresh token rotation 时，最核心的问题不是“token 怎么换”，而是“它们都挂在哪个 session 下面”。

## 10. session 和子站又是什么关系

当前项目里有两个子站：

- web

- admin

它们的登录方式不同，权限边界也不同。

所以 session 不能只知道“这是谁的会话”，还必须知道“这是哪个子站的会话”。

也就是说，session 至少要带：

- user_id

- application_id

- session_type

这样才能区分：

- 这个 session 是 web 登录产生的

- 还是 admin 登录产生的

否则后面在做鉴权时，很容易把不同子站的登录状态混到一起。

## 11. session 在当前架构里的完整位置

如果把这套系统串起来，session 在其中的位置可以这样理解：

- 用户通过密码或 OAuth 登录

- 服务端完成身份校验

- 服务端创建一条 session

- 服务端签发 access token 和 refresh token

- access token 负责后续请求快速认证

- refresh token 负责续期

- session 负责承接整段登录状态

所以 session 是这整套体系里的“状态中心”。

它不像 access token 那么频繁出现在接口校验里，也不像 refresh token 那么经常在刷新流程里被讨论，但它其实是把整段登录生命周期串起来的主轴。

## 12. 新手最容易踩的几个误区

讲到这里，新手最容易踩的误区通常有四个。

### 12.1 误把 session 当成 cookie

cookie 只是浏览器存数据的容器，不等于 session 本身。

### 12.2 误把 session 当成 token

token 是凭证，session 是登录状态。

### 12.3 误以为用了 JWT 就不需要 session

JWT 解决的是无状态身份表达，不自动解决设备管理、会话撤销、refresh token 归属这些问题。

### 12.4 误把 session 当成用户主体

同一个用户可以有多个 session，所以 session 表达的是“一次登录”，不是“这个用户是谁”。

## 13. 这一篇的落点是什么

如果要用一句最适合新手记住的话收住 session，可以直接记成：

**session 是服务端对“一次登录状态”的记录。**

它解决的不是“用户是谁”，而是：

- 这次登录是什么时候产生的

- 属于哪个子站

- 关联了哪些 token

- 现在是否仍然有效

- 能不能被单独撤销

理解了这一点，后面再看 JWT、refresh token、logout、token rotation、设备管理这些设计时，脑子里就会非常顺。

下一篇继续往下讲 access token 和 refresh token 的职责边界，会更容易串起来。
