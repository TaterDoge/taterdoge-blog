---
title: "161 数据库异步封装"
pubDate: 2026-05-31
description: "数据库操作本质上也是一种异步行为，因此，我们可以像前端封装接口请求那样，把数据库操作单独封装一下，然后在 service 业务代码中使用，从而简化代码结构。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/26-db-async-tools/](https://aicompanion.usehook.cn/26-db-async-tools/)

## 1. 概述

数据库操作本质上也是一种异步行为，因此，我们可以像前端封装接口请求那样，把数据库操作单独封装一下，然后在 service 业务代码中使用，从而简化代码结构。

这里我们以登录相关的功能为例，来展开这个封装方式的学习。

## 2. Drizzle 基础 API

先看这行导入，它决定了后面查询条件和 SQL 表达式的写法：

repository.ts

```typescript
import { and, eq, isNull, sql } from 'drizzle-orm'
```

其实这里 4 个东西都不复杂。

`eq(a, b)` 表示相等条件。你可以把它理解成 SQL 里的 `a = b`。

repository.ts

```typescript
eq(applications.code, 'admin')
```

`and(...)` 表示把多个条件拼成 `AND`。

repository.ts

```typescript
and(
  eq(applications.code, 'admin'),
  eq(applications.status, 'active'),
  eq(applicationAuthMethods.provider, 'password'),
)
```

`isNull(x)` 表示 SQL 里的 `x IS NULL`。

repository.ts

```typescript
isNull(refreshTokens.usedAtMs)
```

`sql` 则是写原生 SQL 片段时用的。

repository.ts

```typescript
sql`COALESCE(${authSessions.revokedAtMs}, ${params.revokedAtMs})`
```

它适合那种 Drizzle 链式 API 不够直接，或者你本来就想写一小段 SQL 表达式的场景。

除了这 4 个条件工具，后面还反复出现这些查询 API：

- `.select(...)`：查什么列

- `.from(...)`：从哪张表开始查

- `.innerJoin(...)`：和哪张表做内连接

- `.where(...)`：过滤条件

- `.limit(1)`：只取一条

- `.get()`：拿一条结果

- `.insert(...).values(...)`：插入数据

- `.update(...).set(...)`：更新数据

- `.returning(...)`：把更新后的结果带回来

- `.batch([...])`：把多条写操作一起执行

你可以先把整套链式写法看成“在 TypeScript 里写 SQL”。只不过不是直接拼字符串，而是把 `select`、`join`、`where` 这些步骤拆成链式方法。

## 3. isPasswordLoginEnabledForAdmin

repository.ts

```typescript
export async function isPasswordLoginEnabledForAdmin(db: ApiDb): Promise<boolean> {
  const row = await db
    .select({ enabled: applicationAuthMethods.enabled })
    .from(applicationAuthMethods)
    .innerJoin(applications, eq(applications.id, applicationAuthMethods.applicationId))
    .where(
      and(
        eq(applications.code, 'admin'),
        eq(applications.status, 'active'),
        eq(applicationAuthMethods.provider, 'password'),
      ),
    )
    .limit(1)
    .get()

  return row?.enabled === 1
}
```

这个方法的目标很单纯：查 admin 这条线有没有启用密码登录。

顺着链往下读就行。

`.select({ enabled: applicationAuthMethods.enabled })` 表示只查 `enabled` 这一列，并把它取名成 `enabled`。

`.from(applicationAuthMethods)` 表示从 `application_auth_methods` 这张表开始。

`.innerJoin(applications, eq(applications.id, applicationAuthMethods.applicationId))` 表示把 `applications` 表连进来，连接条件是 application id 对上。

`.where(...)` 里又拼了 3 个条件：

- application code 是 `admin`

- application status 是 `active`

- provider 是 `password`

`.limit(1).get()` 连起来看，意思就是：只取一条，并把结果当成单条记录拿出来。

最后：

repository.ts

```typescript
return row?.enabled === 1
```

这里把数据库里的 `1 / 0` 转成真正的布尔值。

## 4. findLoginUserByNormalizedEmail

repository.ts

```typescript
export async function findLoginUserByNormalizedEmail(
  db: ApiDb,
  normalizedEmail: string,
): Promise<LoginUserRecord | null> {
  const row = await db
    .select({
      userId: users.id,
      emailId: userEmails.id,
      email: userEmails.email,
      userStatus: users.status,
      passwordHash: passwordCredentials.passwordHash,
      passwordAlgo: passwordCredentials.passwordAlgo,
    })
    .from(userEmails)
    .innerJoin(users, eq(users.id, userEmails.userId))
    .innerJoin(
      passwordCredentials,
      and(
        eq(passwordCredentials.userId, users.id),
        eq(passwordCredentials.emailId, userEmails.id),
      ),
    )
    .where(eq(userEmails.normalizedEmail, normalizedEmail))
    .limit(1)
    .get()

  return row
    ? {
        ...row,
        userStatus: row.userStatus as LoginUserRecord['userStatus'],
        passwordAlgo: row.passwordAlgo as LoginUserRecord['passwordAlgo'],
      }
    : null
}
```

这个方法是登录入口里最典型的读取工具方法。

它不是只查一张表，而是把：

- `user_emails`

- `users`

- `password_credentials`

三张表串起来，一次把登录要用到的核心信息拿全。

这里的关键在 `.select({...})`。

它不是查整行，而是只挑当前登录流程真正要用的字段：

- user id

- email id

- 原始邮箱

- 用户状态

- 密码 hash

- 密码算法

这样返回值就会很聚焦，不会把没用的列也一股脑带出来。

再看 join。

第一段：

repository.ts

```typescript
.innerJoin(users, eq(users.id, userEmails.userId))
```

这是通过 `userEmails.userId` 找到对应的 `users`。

第二段：

repository.ts

```typescript
.innerJoin(
  passwordCredentials,
  and(
    eq(passwordCredentials.userId, users.id),
    eq(passwordCredentials.emailId, userEmails.id),
  ),
)
```

这里的连接条件比上一段更严。它同时要求：

- credential 属于这个 user

- credential 对应这条 email

最后 `.where(eq(userEmails.normalizedEmail, normalizedEmail))` 表示按标准化邮箱去查。

整个方法返回 `LoginUserRecord | null`，所以查不到时会明确返回 `null`。

## 5. getAdminRolesForUser

repository.ts

```typescript
export async function getAdminRolesForUser(
  db: ApiDb,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ code: roles.code })
    .from(userRoleBindings)
    .innerJoin(roles, eq(roles.id, userRoleBindings.roleId))
    .innerJoin(applications, eq(applications.id, roles.applicationId))
    .where(
      and(
        eq(userRoleBindings.userId, userId),
        eq(userRoleBindings.status, 'active'),
        eq(applications.code, 'admin'),
      ),
    )

  return rows.map((row) => row.code)
}
```

这个方法查的是 admin 角色。

它从 `user_role_bindings` 起步，再一路连到 `roles` 和 `applications`，最后把条件收窄成：

- 这个用户的绑定

- 绑定状态是 `active`

- application 是 `admin`

注意它的返回值不是整行对象，而是：

repository.ts

```typescript
return rows.map((row) => row.code)
```

也就是直接返回角色 code 数组。

这说明这个工具方法已经帮上层做了一层结果整理，调用方不用再自己去 `map`。

## 6. getAdminApplicationId

repository.ts

```typescript
export async function getAdminApplicationId(db: ApiDb): Promise<string> {
  const row = await db
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.code, 'admin'))
    .limit(1)
    .get()

  if (!row) {
    throw new Error('Admin application is missing')
  }

  return row.id
}
```

这个方法很适合拿来理解 `.limit(1).get()`。

它的意图就是：按 code 查 `admin` 这条 application，只拿一条。

如果查不到，直接抛错。

所以这类方法很像“配置读取器”：它预期这条数据就该存在，不存在就是异常状态。

## 7. createAdminSession

repository.ts

```typescript
export async function createAdminSession(params: {
  db: ApiDb
  userId: string
  applicationId: string
  userAgent: string | null
  ip: string | null
  nowMs: number
  expiresAtMs: number
  roles: string[]
}): Promise<SessionContext> {
  const sessionId = uuidv7()

  await params.db.batch([
    params.db.insert(authSessions).values({
      id: sessionId,
      userId: params.userId,
      applicationId: params.applicationId,
      sessionType: 'admin',
      deviceName: null,
      userAgent: params.userAgent,
      ip: params.ip,
      lastSeenAtMs: params.nowMs,
      createdAtMs: params.nowMs,
      expiresAtMs: params.expiresAtMs,
      revokedAtMs: null,
      revokeReason: null,
    }),
    params.db
      .update(users)
      .set({
        lastLoginAtMs: params.nowMs,
        updatedAtMs: params.nowMs,
      })
      .where(eq(users.id, params.userId)),
  ])

  return {
    sessionId,
    userId: params.userId,
    app: 'admin',
    roles: params.roles,
    expiresAtMs: params.expiresAtMs,
  }
}
```

这个方法开始进入写操作。

第一眼先看两件事：

- `const sessionId = uuidv7()`

- `await params.db.batch([...])`

先生成 session id，再把两条写操作一起执行。

`batch([...])` 里的第一条是插入 `auth_sessions`：

repository.ts

```typescript
params.db.insert(authSessions).values({ ... })
```

这就是最标准的 Drizzle 插入写法：

- `.insert(table)` 指定插入哪张表

- `.values({...})` 指定写入哪些字段

第二条是更新 `users`：

repository.ts

```typescript
params.db
  .update(users)
  .set({
    lastLoginAtMs: params.nowMs,
    updatedAtMs: params.nowMs,
  })
  .where(eq(users.id, params.userId))
```

这就是最标准的更新写法：

- `.update(table)` 选表

- `.set({...})` 设新值

- `.where(...)` 限定更新哪一行

最后方法返回的不是数据库原始结果，而是业务层更想要的 `SessionContext`。

所以它已经不只是“写库”，还顺手把业务层后面要继续传递的 session 信息整理好了。

## 8. insertRefreshToken

repository.ts

```typescript
export async function insertRefreshToken(params: {
  db: ApiDb
  tokenId: string
  sessionId: string
  jtiHash: string
  parentTokenId: string | null
  issuedAtMs: number
  expiresAtMs: number
}): Promise<void> {
  await params.db.insert(refreshTokens).values({
    id: params.tokenId,
    sessionId: params.sessionId,
    jtiHash: params.jtiHash,
    parentTokenId: params.parentTokenId,
    issuedAtMs: params.issuedAtMs,
    expiresAtMs: params.expiresAtMs,
    usedAtMs: null,
    revokedAtMs: null,
    replacedByTokenId: null,
  })
}
```

这个方法几乎就是“纯插入”。

它没有 join，没有查询，没有额外整理，主要就是把 refresh token 这条记录写进去。

这种方法很适合单独抽出来，因为调用方只需要说一句“插入 refresh token”，不用反复关心表字段长什么样。

## 9. findRefreshTokenForSession

repository.ts

```typescript
export async function findRefreshTokenForSession(params: {
  db: ApiDb
  jtiHash: string
  sessionId: string
}): Promise<RefreshTokenRecord | null> {
  const row = await params.db
    .select({
      tokenId: refreshTokens.id,
      sessionId: refreshTokens.sessionId,
      userId: authSessions.userId,
      applicationCode: applications.code,
      expiresAtMs: refreshTokens.expiresAtMs,
      usedAtMs: refreshTokens.usedAtMs,
      revokedAtMs: refreshTokens.revokedAtMs,
      sessionRevokedAtMs: authSessions.revokedAtMs,
    })
    .from(refreshTokens)
    .innerJoin(authSessions, eq(authSessions.id, refreshTokens.sessionId))
    .innerJoin(applications, eq(applications.id, authSessions.applicationId))
    .where(
      and(
        eq(refreshTokens.jtiHash, params.jtiHash),
        eq(refreshTokens.sessionId, params.sessionId),
      ),
    )
    .limit(1)
    .get()

  return row ?? null
}
```

这个方法和前面的登录查询很像，也是“多表拼起来，一次拿全刷新流程要用的信息”。

它一口气查出了：

- 当前 refresh token 自己的状态

- 它属于哪个 session

- 这个 session 对应哪个 user

- application code 是什么

- session 是否已撤销

这就是抽数据库工具方法的一个现实好处：service 层不需要自己分两三次查，工具方法内部可以一次把后面要判断的字段凑齐。

## 10. markRefreshTokenUsed

repository.ts

```typescript
export async function markRefreshTokenUsed(params: {
  db: ApiDb
  tokenId: string
  usedAtMs: number
}): Promise<boolean> {
  const updated = await params.db
    .update(refreshTokens)
    .set({ usedAtMs: params.usedAtMs })
    .where(
      and(
        eq(refreshTokens.id, params.tokenId),
        isNull(refreshTokens.usedAtMs),
        isNull(refreshTokens.revokedAtMs),
      ),
    )
    .returning({ id: refreshTokens.id })

  return updated.length === 1
}
```

这个方法最值得看的地方是 `.where(...)` 和 `.returning(...)`。

先看条件：

- id 必须对上

- `usedAtMs` 还必须是 `NULL`

- `revokedAtMs` 也必须是 `NULL`

也就是说，它不是无脑更新，而是“只有当前 token 还没被用过、也没被撤销时，才允许把它标记成已使用”。

再看：

repository.ts

```typescript
.returning({ id: refreshTokens.id })
```

这里表示把更新成功的结果带回来。

最后：

repository.ts

```typescript
return updated.length === 1
```

这就把数据库层的更新结果，转换成了一个很适合上层判断的布尔值。

## 11. updateRefreshRotation

repository.ts

```typescript
export async function updateRefreshRotation(params: {
  db: ApiDb
  oldTokenId: string
  newTokenId: string
  sessionId: string
  lastSeenAtMs: number
}): Promise<void> {
  await params.db.batch([
    params.db
      .update(refreshTokens)
      .set({ replacedByTokenId: params.newTokenId })
      .where(eq(refreshTokens.id, params.oldTokenId)),
    params.db
      .update(authSessions)
      .set({ lastSeenAtMs: params.lastSeenAtMs })
      .where(eq(authSessions.id, params.sessionId)),
  ])
}
```

这个方法没有查询，只有两条更新。

第一条把旧 token 指向新 token：

- `replacedByTokenId = newTokenId`

第二条更新 session 的 `lastSeenAtMs`。

因为两条更新是一起发生的，所以继续用 `batch([...])` 收在一个方法里很自然。

## 12. revokeSession

repository.ts

```typescript
export async function revokeSession(params: {
  db: ApiDb
  sessionId: string
  revokedAtMs: number
  reason: string
}): Promise<void> {
  await params.db.batch([
    params.db
      .update(authSessions)
      .set({
        revokedAtMs: sql`COALESCE(${authSessions.revokedAtMs}, ${params.revokedAtMs})`,
        revokeReason: sql`COALESCE(${authSessions.revokeReason}, ${params.reason})`,
      })
      .where(eq(authSessions.id, params.sessionId)),
    params.db
      .update(refreshTokens)
      .set({
        revokedAtMs: sql`COALESCE(${refreshTokens.revokedAtMs}, ${params.revokedAtMs})`,
      })
      .where(
        and(
          eq(refreshTokens.sessionId, params.sessionId),
          isNull(refreshTokens.revokedAtMs),
        ),
      ),
  ])
}
```

这个方法最适合拿来理解 `sql`。

看这句：

repository.ts

```typescript
sql`COALESCE(${authSessions.revokedAtMs}, ${params.revokedAtMs})`
```

`COALESCE(a, b)` 的意思可以先记成：如果 `a` 不是 `NULL`，就用 `a`；否则用 `b`。

所以这里的作用就是：

- 如果 `revokedAtMs` 本来已经有值，就保留原值

- 如果原来是 `NULL`，才写入这次的撤销时间

`revokeReason` 也是同样的思路。

这时链式 API 不够直接，`sql` 就很合适。它允许你在 Drizzle 语句里嵌一段原生 SQL 表达式。

后半段更新 `refreshTokens` 时，又结合了：

- `eq(...)`

- `and(...)`

- `isNull(...)`

也就是只撤销当前 session 下、且还没被撤销的 refresh token。

## 13. 抽离数据库方法的意义

读完这些方法之后，再回头看这篇的核心思想，其实已经很清楚了。

这些方法如果散在 route 或 service 里，业务主线会被大量数据库细节打断。你一边想看登录流程，一边却总要切去读 `join`、`where`、`batch`、`returning`。

单独抽出来之后，层次就顺了：

- route 负责接请求

- service 负责业务流程

- 数据库工具方法负责具体读写

而且抽出来还有两个很实在的好处。

第一，重复查询模式只写一遍。以后谁要按标准化邮箱查登录用户，就直接调 `findLoginUserByNormalizedEmail(...)`。

第二，service 层会更像业务代码。你读 service 时看到的是“检查密码登录是否启用”“查登录用户”“创建 session”“插入 refresh token”，而不是每一步都重新展开 SQL 细节。

所以这组方法的真正价值，不只是“把代码拆文件”，而是把数据库读写从业务主线里剥出来，让上层代码更容易顺着读。

## 14. 完整代码

repository.ts

```typescript
import { and, eq, isNull, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { ApiDb } from '@/db/client'
import {
  applicationAuthMethods,
  applications,
  authSessions,
  passwordCredentials,
  refreshTokens,
  roles,
  userEmails,
  userRoleBindings,
  users,
} from '@/db/schema'
import type {
  LoginUserRecord,
  RefreshTokenRecord,
  SessionContext,
} from './types'

export async function isPasswordLoginEnabledForAdmin(db: ApiDb): Promise<boolean> {
  const row = await db
    .select({ enabled: applicationAuthMethods.enabled })
    .from(applicationAuthMethods)
    .innerJoin(applications, eq(applications.id, applicationAuthMethods.applicationId))
    .where(
      and(
        eq(applications.code, 'admin'),
        eq(applications.status, 'active'),
        eq(applicationAuthMethods.provider, 'password'),
      ),
    )
    .limit(1)
    .get()

  return row?.enabled === 1
}

export async function findLoginUserByNormalizedEmail(
  db: ApiDb,
  normalizedEmail: string,
): Promise<LoginUserRecord | null> {
  const row = await db
    .select({
      userId: users.id,
      emailId: userEmails.id,
      email: userEmails.email,
      userStatus: users.status,
      passwordHash: passwordCredentials.passwordHash,
      passwordAlgo: passwordCredentials.passwordAlgo,
    })
    .from(userEmails)
    .innerJoin(users, eq(users.id, userEmails.userId))
    .innerJoin(
      passwordCredentials,
      and(
        eq(passwordCredentials.userId, users.id),
        eq(passwordCredentials.emailId, userEmails.id),
      ),
    )
    .where(eq(userEmails.normalizedEmail, normalizedEmail))
    .limit(1)
    .get()

  return row
    ? {
        ...row,
        userStatus: row.userStatus as LoginUserRecord['userStatus'],
        passwordAlgo: row.passwordAlgo as LoginUserRecord['passwordAlgo'],
      }
    : null
}

export async function getAdminRolesForUser(
  db: ApiDb,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ code: roles.code })
    .from(userRoleBindings)
    .innerJoin(roles, eq(roles.id, userRoleBindings.roleId))
    .innerJoin(applications, eq(applications.id, roles.applicationId))
    .where(
      and(
        eq(userRoleBindings.userId, userId),
        eq(userRoleBindings.status, 'active'),
        eq(applications.code, 'admin'),
      ),
    )

  return rows.map((row) => row.code)
}

export async function getAdminApplicationId(db: ApiDb): Promise<string> {
  const row = await db
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.code, 'admin'))
    .limit(1)
    .get()

  if (!row) {
    throw new Error('Admin application is missing')
  }

  return row.id
}

export async function createAdminSession(params: {
  db: ApiDb
  userId: string
  applicationId: string
  userAgent: string | null
  ip: string | null
  nowMs: number
  expiresAtMs: number
  roles: string[]
}): Promise<SessionContext> {
  const sessionId = uuidv7()

  await params.db.batch([
    params.db.insert(authSessions).values({
      id: sessionId,
      userId: params.userId,
      applicationId: params.applicationId,
      sessionType: 'admin',
      deviceName: null,
      userAgent: params.userAgent,
      ip: params.ip,
      lastSeenAtMs: params.nowMs,
      createdAtMs: params.nowMs,
      expiresAtMs: params.expiresAtMs,
      revokedAtMs: null,
      revokeReason: null,
    }),
    params.db
      .update(users)
      .set({
        lastLoginAtMs: params.nowMs,
        updatedAtMs: params.nowMs,
      })
      .where(eq(users.id, params.userId)),
  ])

  return {
    sessionId,
    userId: params.userId,
    app: 'admin',
    roles: params.roles,
    expiresAtMs: params.expiresAtMs,
  }
}

export async function insertRefreshToken(params: {
  db: ApiDb
  tokenId: string
  sessionId: string
  jtiHash: string
  parentTokenId: string | null
  issuedAtMs: number
  expiresAtMs: number
}): Promise<void> {
  await params.db.insert(refreshTokens).values({
    id: params.tokenId,
    sessionId: params.sessionId,
    jtiHash: params.jtiHash,
    parentTokenId: params.parentTokenId,
    issuedAtMs: params.issuedAtMs,
    expiresAtMs: params.expiresAtMs,
    usedAtMs: null,
    revokedAtMs: null,
    replacedByTokenId: null,
  })
}

export async function findRefreshTokenForSession(params: {
  db: ApiDb
  jtiHash: string
  sessionId: string
}): Promise<RefreshTokenRecord | null> {
  const row = await params.db
    .select({
      tokenId: refreshTokens.id,
      sessionId: refreshTokens.sessionId,
      userId: authSessions.userId,
      applicationCode: applications.code,
      expiresAtMs: refreshTokens.expiresAtMs,
      usedAtMs: refreshTokens.usedAtMs,
      revokedAtMs: refreshTokens.revokedAtMs,
      sessionRevokedAtMs: authSessions.revokedAtMs,
    })
    .from(refreshTokens)
    .innerJoin(authSessions, eq(authSessions.id, refreshTokens.sessionId))
    .innerJoin(applications, eq(applications.id, authSessions.applicationId))
    .where(
      and(
        eq(refreshTokens.jtiHash, params.jtiHash),
        eq(refreshTokens.sessionId, params.sessionId),
      ),
    )
    .limit(1)
    .get()

  return row ?? null
}

export async function markRefreshTokenUsed(params: {
  db: ApiDb
  tokenId: string
  usedAtMs: number
}): Promise<boolean> {
  const updated = await params.db
    .update(refreshTokens)
    .set({ usedAtMs: params.usedAtMs })
    .where(
      and(
        eq(refreshTokens.id, params.tokenId),
        isNull(refreshTokens.usedAtMs),
        isNull(refreshTokens.revokedAtMs),
      ),
    )
    .returning({ id: refreshTokens.id })

  return updated.length === 1
}

export async function updateRefreshRotation(params: {
  db: ApiDb
  oldTokenId: string
  newTokenId: string
  sessionId: string
  lastSeenAtMs: number
}): Promise<void> {
  await params.db.batch([
    params.db
      .update(refreshTokens)
      .set({ replacedByTokenId: params.newTokenId })
      .where(eq(refreshTokens.id, params.oldTokenId)),
    params.db
      .update(authSessions)
      .set({ lastSeenAtMs: params.lastSeenAtMs })
      .where(eq(authSessions.id, params.sessionId)),
  ])
}

export async function revokeSession(params: {
  db: ApiDb
  sessionId: string
  revokedAtMs: number
  reason: string
}): Promise<void> {
  await params.db.batch([
    params.db
      .update(authSessions)
      .set({
        revokedAtMs: sql`COALESCE(${authSessions.revokedAtMs}, ${params.revokedAtMs})`,
        revokeReason: sql`COALESCE(${authSessions.revokeReason}, ${params.reason})`,
      })
      .where(eq(authSessions.id, params.sessionId)),
    params.db
      .update(refreshTokens)
      .set({
        revokedAtMs: sql`COALESCE(${refreshTokens.revokedAtMs}, ${params.revokedAtMs})`,
      })
      .where(
        and(
          eq(refreshTokens.sessionId, params.sessionId),
          isNull(refreshTokens.revokedAtMs),
        ),
      ),
  ])
}
```
