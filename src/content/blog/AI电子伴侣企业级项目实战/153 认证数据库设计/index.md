---
title: "153 认证数据库设计"
pubDate: 2026-05-29
description: "上一篇已经把 Cloudflare 生态下认证系统的整体分工和核心原则讲清楚了。接下来就该把这些原则真正落到数据库模型上。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/18-auth-database/](https://aicompanion.usehook.cn/18-auth-database/)

## 1. 概述

上一篇已经把 Cloudflare 生态下认证系统的整体分工和核心原则讲清楚了。接下来就该把这些原则真正落到数据库模型上。

这篇文章的目标很单纯：把 D1 里的核心表结构，一张张拆开讲清楚，让新手能理解为什么要这么设计，而不是只看到一堆 SQL 就发懵。

当前这套模型要覆盖的场景包括：

- admin：邮箱 + 密码登录

- web：邮箱 + 密码、GitHub 登录

- 后续可扩 Google 登录

- 登录后可查看、绑定、解绑第三方账号

- JWT + refresh token 会话体系

## 2. 先统一字段类型约定

在 D1 / SQLite 风格里，这套认证模型建议统一遵守下面的类型约定：

- 主键：`TEXT`

- 时间：`INTEGER`，存毫秒时间戳

- 布尔：`INTEGER` + `CHECK (IN (0,1))`

- 枚举：`TEXT` + `CHECK`

- JSON：`TEXT`

这里不用一开始就追求很花哨的类型系统，关键是保持一致。

主键建议在应用层生成，例如：

- `uuidv7`

- 或 `ulid`

当前更推荐 `uuidv7`。上一篇已经专门讲了它为什么更适合作为这套系统的默认主键策略。

## 3. users：用户主体表

认证系统最先要立住的，是用户主体。

index.sql

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'deleted')),
  display_name TEXT,
  avatar_url TEXT,
  primary_email_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  last_login_at_ms INTEGER
);
```

这张表最重要的设计原则是：**用户主体不能跟密码或 OAuth 绑死。**

因为一个真实用户以后可能同时拥有：

- 邮箱密码登录

- GitHub 绑定

- Google 绑定

所以 `users` 只负责回答一件事：这个用户是谁。

## 4. user_emails：邮箱表

一个用户未来完全可能有多个邮箱，所以邮箱不应该直接硬塞进 `users`。

index.sql

```sql
CREATE TABLE user_emails (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1)),
  verified_at_ms INTEGER,
  source TEXT NOT NULL CHECK (source IN ('password', 'github', 'google', 'manual')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

再加上索引：

index.sql

```sql
CREATE UNIQUE INDEX idx_user_emails_normalized_email_unique
ON user_emails(normalized_email);

CREATE UNIQUE INDEX idx_user_emails_user_normalized_unique
ON user_emails(user_id, normalized_email);

CREATE UNIQUE INDEX idx_user_emails_one_primary_per_user
ON user_emails(user_id)
WHERE is_primary = 1;
```

这里的关键点是 `normalized_email`。邮箱唯一性判断应该基于标准化结果，而不是原始输入。

## 5. password_credentials：本地密码凭证表

密码登录和用户主体是两回事，所以密码也要单独放表。

index.sql

```sql
CREATE TABLE password_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email_id TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_algo TEXT NOT NULL CHECK (password_algo IN ('argon2id', 'bcrypt')),
  password_updated_at_ms INTEGER NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until_ms INTEGER,
  must_reset_password INTEGER NOT NULL DEFAULT 0 CHECK (must_reset_password IN (0, 1)),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (email_id) REFERENCES user_emails(id) ON DELETE CASCADE
);
```

这张表的价值不只是存 hash，而是为后续这些能力预留空间：

- 错误次数限制

- 临时锁定

- 强制改密

- 算法迁移

## 6. oauth_identities：第三方身份绑定表

GitHub、Google 这类第三方身份，必须单独建绑定表。

index.sql

```sql
CREATE TABLE oauth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  provider_subject TEXT NOT NULL,
  email_id TEXT,
  provider_username TEXT,
  provider_email TEXT,
  profile_snapshot TEXT,
  linked_at_ms INTEGER NOT NULL,
  last_used_at_ms INTEGER,
  unlinked_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (email_id) REFERENCES user_emails(id) ON DELETE SET NULL
);
```

索引重点在这里：

index.sql

```sql
CREATE UNIQUE INDEX idx_oauth_identities_provider_subject_unique
ON oauth_identities(provider, provider_subject);
```

不要用第三方邮箱作为唯一身份标识，真正稳定的是 `(provider, provider_subject)`。

## 7. applications 和 application_auth_methods

既然 admin 和 web 的登录方式不同，就需要把“子站定义”和“子站允许的登录方式”拆出来。

### applications

index.sql

```sql
CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at_ms INTEGER NOT NULL
);
```

### application_auth_methods

index.sql

```sql
CREATE TABLE application_auth_methods (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('password', 'github', 'google')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);
```

这两张表立住以后，登录方式就是“子站策略”，不再是硬编码在业务里。

## 8. roles 和 user_role_bindings

登录成功不等于有权限，尤其是 admin。

### roles

index.sql

```sql
CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);
```

### user_role_bindings

index.sql

```sql
CREATE TABLE user_role_bindings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  granted_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);
```

这一层的作用是：把“这个用户是谁”和“这个用户在当前子站拥有怎样的权限”分开。

## 9. auth_sessions 和 refresh_tokens

这两张表是 JWT 方案能不能真正落地的关键。

### auth_sessions

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
  revoke_reason TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);
```

### refresh_tokens

index.sql

```sql
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  jti_hash TEXT NOT NULL,
  parent_token_id TEXT,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  used_at_ms INTEGER,
  revoked_at_ms INTEGER,
  replaced_by_token_id TEXT,
  FOREIGN KEY (session_id) REFERENCES auth_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_token_id) REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  FOREIGN KEY (replaced_by_token_id) REFERENCES refresh_tokens(id) ON DELETE SET NULL
);
```

`access token` 不落库，但会话和 refresh token 必须落库。否则：

- 无法做注销

- 无法做单设备下线

- 无法做 token rotation

- 无法做 replay 检测

## 10. 辅助表和迁移顺序

后续还会有两类辅助能力：

- 邮箱验证

- 密码重置

它们可以继续拆成独立 token 表，例如：

- `email_verification_tokens`

- `password_reset_tokens`

- 二期再补 `oauth_tokens`

迁移顺序也建议分批做。

第一批先上核心表：

- users

- user_emails

- password_credentials

- oauth_identities

- applications

- application_auth_methods

- roles

- user_role_bindings

- auth_sessions

- refresh_tokens

第二批再补辅助表：

- email_verification_tokens

- password_reset_tokens

- oauth_tokens

## 11. 初始化数据怎么准备

数据库建完还不够，初始化数据也要跟着落。

首先是 `applications`，至少插入两条：

- web

- admin

然后是 `application_auth_methods`：

admin：

- password = 1

- github = 0

- google = 0

web：

- password = 1

- github = 1

- google = 0

最后是 `roles`，至少初始化：

admin：

- admin_owner

- admin_operator

web：

- web_user

这些初始化数据决定了后面每条登录链路的边界。

## 12. 这一篇的落点是什么

这篇最重要的不是让你背下每一张表，而是理解这套 D1 模型的拆分原则：

- 用户主体独立

- 登录方式独立

- 子站策略独立

- 角色权限独立

- 会话与 refresh token 独立

只要这几个边界立住，后面再扩 GitHub、Google、邮箱验证、重置密码、设备会话管理时，数据库结构都不会乱。

下一篇会继续往下，把 JWT、refresh token、OAuth 绑定、Durable Objects 的适用时机、接口设计和最终落地顺序系统串起来。
