---
title: "157 D1 migration 与 seed 数据"
pubDate: 2026-05-30
description: "认证的核心数据先收敛到 admin 密码登录这一条链路，后续 web / OAuth 可以继续在这套表上扩。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/22-d1-migration-seed/](https://aicompanion.usehook.cn/22-d1-migration-seed/)

## 1. 概述

在我们的实践项目中，创建了这样两个文件

0001_admin_atuh.sql第一份认证 migrationseed-admin.sql本地 admin 测试账号
admin-auth.sqlseed-admin.sql

```sql
-- 认证的核心数据先收敛到 admin 密码登录这一条链路，后续 web / OAuth 可以继续在这套表上扩。
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'deleted')),
  display_name TEXT,
  primary_email_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  last_login_at_ms INTEGER
);

...
```

`migrations/0001_admin_atuh.sql` 和 `dev/seed-admin.sql`，不只是两份 SQL

表面上看，确实都是在往数据库里执行语句。真放到项目里，它们做的事完全不同

`0001_admin_atuh.sql` 负责把数据库的骨架立起来。哪些表要有，哪些索引要有，哪些字段必须存在，`admin` 这个 application 要不要先插进去，`admin_owner` 和 `admin_operator` 这种角色要不要先准备好，这些都归它管。

`seed-admin.sql` 则不碰骨架，它做的是另一件更接地气的事：让你本地打开项目后，不用再自己手搓一批测试用户，就能直接调 admin 登录、刷新、登出。

所以这两个文件，一个是在定数据表结构，一个是在喂测试数据

把这两者的区别先分清，后面很多困惑都会少很多

## 2. migration

很多新手第一次接触 migration，会把它理解成「建表 SQL 的存档」。这个理解太轻了。

migration 真正的作用，是把某个时间点上，项目认可的数据库结构固定下来。

拿这份 `0001_admin_atuh.sql` 来说，它不是零散写了几张表，而是已经把 admin 密码登录这条链路需要的主结构收拢好了。你一眼扫过去，会发现它在做几件很实在的事：

- 建 `users`、`user_emails`、`password_credentials`

- 建 `applications`、`roles`、`user_role_bindings`

- 建 `auth_sessions`、`refresh_tokens`

- 把该有的唯一索引和普通索引补齐

- 顺手把 `admin`、`password`、`admin_owner`、`admin_operator` 这些系统基础配置插进去

也就是说，这不是「以后可能会用到的草稿」，它已经是一套能支撑 admin 认证链路落地的数据库底座了。

为什么要把它放进 migration，而不是散在代码里？原因很简单

因为数据库结构这种东西，一旦项目开始往前走，就一定会碰到这些问题：

- 新同学拉项目，怎么把库搭起来

- 本地、测试、线上，怎么保证结构一致

- 表结构改了，怎么知道是第几次改动

- 某个环境少了索引或者表，怎么补回来

没有 migration，这些问题最后都会落到「靠记忆」和「靠口头同步」。项目一小还能凑合，项目规模一大就开始出问题。

### 为什么 migration 里还会插入数据

不少人看到这份 SQL 里不仅有 `CREATE TABLE`，还有 `INSERT OR IGNORE`，第一反应会是：这不是把业务数据和结构混在一起了吗？

这里得分开看。

像 `applications` 里的 `admin`，`application_auth_methods` 里的 `password`，还有 `roles` 里的 `admin_owner` / `admin_operator`，它们虽然长得像普通数据，但本质上更接近系统配置。

这些东西不是某个用户操作出来的，也不是联调用的临时数据。只要这套认证系统存在，这些基础配置就应该存在。它们和「数据库结构」不是完全一回事，但离得很近，已经属于系统初始化的一部分。

所以把这类数据放进 migration，是合理的。真正不该放进 migration 的，是那种只为了本地方便、只为了某次联调临时准备的账号数据。

## 3. seed

再看 `dev/seed-admin.sql`，它就很典型。

这份文件里放的是：

- `Local Admin`

- `Local Staff`

- 对应邮箱

- 对应密码 hash

- 对应角色绑定

这些数据没有任何结构层意义。你删掉它们，数据库骨架一点都不会塌，表还是那些表，索引还是那些索引，关系约束也都还在。

它存在的理由只有一个：让本地联调快一点。

比如现在只想验证 admin 登录接口。如果没有 seed，你至少得自己插一套 `users`、`user_emails`、`password_credentials`、`user_role_bindings`。而且这些表之间还有外键关系，插错一个 id，整条链路就断了。

有了 seed，事情就简单很多了。先跑 migration，把结构立起来；再跑 seed，把可登录账号塞进去；然后你就可以直接拿邮箱和密码去调接口。

这个差别，开发阶段体感很明显。

所以 seed 的价值不在于「多了一份 SQL」，而在于它把本地环境从「空库」推进成「可联调状态」。

### 为什么它放在 dev/ 目录里

这个目录名本身就在提醒你：这不是正式结构的一部分。

`dev/seed-admin.sql` 里的账号数据，只适合开发环境。

- 邮箱是演示账号

- 密码 hash 是固定的

- 数据目的只是联调，不是正式业务数据

它存在的边界非常清楚：方便本地调试，别带进生产

## 4. 本地开发时，这两个文件怎么一起用

如果把本地 D1 的链路完整走一遍，顺序其实非常自然。

先跑 migration：

index.bash

```shellscript
npx wrangler d1 execute ai-agent-local-auth --local --file=./migrations/0001_admin_atuh.sql
```

这一步做完，本地库里已经有表、有索引、有 application、有 role，结构已经站住了。

再跑 seed：

index.bash

```shellscript
npx wrangler d1 execute ai-agent-local-auth --local --file=./dev/seed-admin.sql
```

这一步做完，本地库里就不只是有结构了，还多了现成可登录的测试账号。

所以这两步连起来，等于先把房子盖起来，再把样板间家具摆好。顺序不能反。

如果先跑 seed，表还没建出来，SQL 自然会失败。因为 seed 从头到尾都默认一件事：基础结构已经存在。

## 5. 到了生产环境，应该怎么做

到了生产环境，这两个文件就不能再用同一种态度看了。

最核心的一条原则是：

**migration 可以进生产，dev seed 不能直接照搬进生产。**

原因非常直接。

migration 里定义的是数据库结构和系统基础配置。生产环境本来就必须有这些东西。没有 `users` 表，没有 `auth_sessions` 表，没有 `admin` application，没有 `admin_owner` 这种角色，线上系统根本跑不起来。

所以生产部署时，migration 本来就是该执行的。

常见顺序也比较固定：

- 先创建生产 D1 数据库

- 配好生产环境的 D1 binding

- 执行 migration

- 再部署业务代码

这样做的目的很简单：应用代码起来时，数据库结构已经在那儿了。

真正执行到生产环境时，命令通常会像这样：

index.bash

```shellscript
npx wrangler d1 create ai-agent-prod-auth
```

先拿到生产库的 `database_id`，再回填到生产环境对应的 `wrangler.jsonc` 或 CI 配置里。

然后执行生产 migration：

index.bash

```shellscript
npx wrangler d1 execute ai-agent-prod-auth --remote --file=./migrations/0001_admin_atuh.sql
```

如果后面又新增了 `0002`、`0003`，就继续按顺序执行：

index.bash

```shellscript
npx wrangler d1 execute ai-agent-prod-auth --remote --file=./migrations/0002_add_avatar_url.sql
```

这里的重点只有两个：

- 生产环境打的是 `--remote`

- 生产环境跑的是 migration，不是 `dev/seed-admin.sql`

反过来看 `dev/seed-admin.sql`。这类文件明显就不该直接打进生产。里面的邮箱、密码 hash、测试账号，都是开发便利产物。你把它灌到生产环境，等于主动往线上塞一批默认账号，风险太大，而且没有任何正当收益。

### 那生产环境的管理员账号怎么办

这时候很多人会追问：如果 dev seed 不能进生产，那第一个管理员账号怎么来？

这个问题问得对。

生产环境的管理员初始化，通常要单独做。常见思路大概就三种：

- 部署完成后，用一次性内部脚本创建首个管理员

- 通过受控后台或内部管理命令手动创建

- 单独准备一份生产初始化脚本，但内容和 dev seed 完全分开，而且不会带演示账号逻辑

这里重点不在于具体选哪种，重点在边界。

开发 seed 的目标是方便本地调试。生产初始化的目标是安全地把真实管理员建进去。这两件事不能混。

## 6. 如果表字段变了，应该怎么处理

这部分其实才是 migration 最像「工程工具」的时候。

假设现在要给 `users` 表新增一个字段，比如 `avatar_url`。或者给 `auth_sessions` 表新增一个 `device_id`。这时候最容易犯的错，就是回头去改 `0001_admin_atuh.sql`，把新字段补进去，然后假装世界一直就是这样。

这在只有你一个人、本地还没执行过的草稿阶段，问题不大。只要这个 migration 已经被别的环境执行过，它就不该再被回改。

正确做法是新增一个 migration，例如：

index.txt

```txt
migrations/
  0001_admin_atuh.sql
  0002_add_avatar_url.sql
```

然后在 `0002_add_avatar_url.sql` 里只写这次变更要补的内容：

index.sql

```sql
ALTER TABLE users ADD COLUMN avatar_url TEXT;
```

这样做的好处不是形式规范，而是历史清楚。

你能知道库是怎么一步步变成今天这个样子的。新环境可以从 0001 一路执行到最新，老环境也知道下一步该补哪一份。以后真出了问题，排查的时候也能快速定位是哪个结构变更带来的。

### 为什么不要轻易回改旧 migration

因为旧 migration 一旦被执行过，它就不只是文件，而是一段已经发生过的历史。

如果你现在把 `0001` 改了，就会出现一个尴尬局面：

- 新环境跑的是新版 0001

- 老环境实际经历过的是旧版 0001

表面上大家都叫 `0001_admin_atuh.sql`，实际内容却不是同一个东西。后面再讨论数据库状态时，就会越来越乱。

所以常规原则很简单：

- 还在草稿阶段，没人执行过，可以改

- 只要已经被执行过，后面就新增 migration，不回改历史

## 7. 字段一变，不只是 migration 要跟着变

很多人第一次改表字段，只盯着 SQL。其实 SQL 只是第一层。

真到项目里，字段变更通常要一起看 4 层：

- migration 文件

- seed 文件

- 业务代码

- 旧数据怎么兼容

比如给 `users` 增加一个 `NOT NULL` 字段：

index.sql

```sql
ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL;
```

这时候马上就会碰到两个实际问题。

一个是旧数据怎么办。库里已经存在的用户行，没有这个字段的值。

另一个是 `seed-admin.sql` 怎么办。它里面那些插入语句如果还按旧字段列表写，本地一跑就会失败。

所以字段变更之后，至少要顺手检查这些地方：

- seed 要不要补字段

- 代码里的插入和更新逻辑要不要补字段

- 返回类型和校验逻辑要不要更新

- 旧数据要不要 backfill

### 稳一点的改法是什么

如果字段变更稍微重要一点，通常会按更稳的顺序来：

- 先新增可空字段，或者带默认值字段

- 跑 migration

- 回填旧数据

- 更新代码读写逻辑

- 最后再收紧约束

这种做法看起来慢一步，实际上能少踩很多线上坑。特别是 `NOT NULL`、唯一约束、外键这类收紧动作，最好别一步到位硬上。

## 8. 总结

以后再看到这类文件，最简单的分法就是这样。

`migrations/0001_admin_atuh.sql` 回答的是：这套认证数据库结构是什么，系统级基础配置有哪些，一个新环境第一次建库该跑什么。

`dev/seed-admin.sql` 回答的是：本地联调时有哪些现成账号，怎么让登录 / 刷新 / 登出直接可测，怎么避免每次开发都重复造测试数据。

这样一分，边界就很清楚了。

一个是结构历史，一个是开发辅助数据
