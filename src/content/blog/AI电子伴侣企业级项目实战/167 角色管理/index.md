---
title: "167 角色管理"
pubDate: 2026-06-03
description: "角色管理真正要解决的，不是做一个能增删改查的表格，而是把角色从静态初始化数据推进成一套可管理、可保护、还能真正影响权限链路的系统能力。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-06-03
---
原文链接：[https://aicompanion.usehook.cn/32-role-management/](https://aicompanion.usehook.cn/32-role-management/)

## 1. 概述

通常情况下，角色管理是后台系统的标配。它负责的不是某一个页面按钮，而是整条后台身份链路：谁能进后台，进来之后是什么角色，这个角色现在是否还有效。

这一阶段的角色系统，主要负责后台权限控制和基础身份归属。有了角色之后，后面的权限判断、用户分配、登录校验才有明确抓手。

所以这篇文章不想把话题拉得太大。我们先只解决一件事：把角色从 migration 里的静态初始化数据，推进成后台里可以真正管理的系统能力。

## 2. 角色要按应用隔离

我们这里至少有两个应用，一个是 `admin`，一个是 `web`。严格来说，它们以后完全可以拆成两套不同的 API 服务。但在当前这个阶段，业务还没复杂到那个程度，所以先放在同一套 API 里。

虽然代码先放在一起，但概念上一定要分开理解。

这里最底层其实只有 3 张核心表：

index.txt

```txt
applications
  记录有哪些应用
  例如：admin、web

roles
  记录某个应用下面有哪些角色
  例如：admin_owner、admin_operator、web_user

user_role_bindings
  记录哪个用户当前绑定了哪个角色
```

这 3 张表要先分清楚。

`applications` 管的是「系统里有哪些应用」。

`roles` 管的是「某个应用下面有哪些角色」。它不会直接关心用户是谁。

`user_role_bindings` 管的是「用户和角色之间的绑定关系」。也就是说，真正把用户和角色连起来的，不是 `roles` 表本身，而是这张绑定表。

所以像 `admin_owner`、`admin_operator` 这种后台角色，和 `web_user` 这种站点身份角色，从数据层就不是一回事。这一步一定要先分开。不然后面角色分配、权限判断、页面展示都会开始互相打架。

## 3. 角色不能一直靠静态初始化

如果系统里永远只有 `admin_owner` 和 `admin_operator` 两个角色，那 migration 里写死它们，其实也能跑。

问题在于，项目不可能永远停在这个阶段。你很快就会碰到新的角色需求。比如后台想补一个新的操作角色，或者 web 侧想补一个新的基础身份。这时候如果每次都要去改 migration、重新发版、再手动处理已有数据，这条链路就会越来越重。

所以更合理的做法，是把角色从**只存在于数据库初始化阶段的系统配置**，推进成**后台里可以管理的数据**。

但角色一旦能在后台里改，就不能只停在增删改查。角色本身要有状态，关键内建角色也要被保护。

## 4. 角色字段

先看 `roles` 表。和前面认证数据库那篇相比，这里最大的变化就是：角色不再只是一个静态名字，而是开始有自己的生命周期。

apps/api/src/db/schema.ts

```typescript
export const roles = sqliteTable(
  'roles',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    code: text('code').notNull(), // 机器可读的角色标识，例如 admin_owner
    name: text('name').notNull(), // 给人看的名称，例如 Admin Owner
    status: text('status').notNull(), // active / disabled / deleted
    createdAtMs: integer('created_at_ms').notNull(),
    updatedAtMs: integer('updated_at_ms').notNull(),
    disabledAtMs: integer('disabled_at_ms'), // 角色被禁用的时间
    deletedAtMs: integer('deleted_at_ms'), // 角色被逻辑删除的时间
  },
  (table) => [uniqueIndex('idx_roles_application_code_unique').on(table.applicationId, table.code)],
)
```

这里最值得注意的，就是 `status`、`updatedAtMs`、`disabledAtMs`、`deletedAtMs`。

它们在说一件很基础的事：角色不能只分**有**和**没有**，还得有生命周期。

因为角色管理里，很多时候你不是马上把一个角色从库里物理删掉，而是先停用，或者先做软删除，把历史留在库里。这样以后查审计、看历史绑定、排问题都会方便很多。

所以这里比较稳的做法，是让角色至少有 `active`、`disabled`、`deleted` 这 3 个状态。

`disabled` 表示角色还在，但现在不该继续生效。

`deleted` 则表示它已经从正常管理视角里移除了，不再展示，也不再可分配，但历史还留着。

再看 `user_role_bindings`。

apps/api/src/db/schema.ts

```typescript
export const userRoleBindings = sqliteTable(
  'user_role_bindings',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    status: text('status').notNull(), // active / revoked
    grantedAtMs: integer('granted_at_ms').notNull(),
    revokedAtMs: integer('revoked_at_ms'),
  },
  (table) => [uniqueIndex('idx_user_role_bindings_unique').on(table.userId, table.roleId)],
)
```

这张表的作用很直接：用户和角色不是一对一，而是多对多。一个用户可以有多个角色，一个角色也可以绑定给多个用户，所以中间必须有一张绑定表。

同时，绑定关系本身也有状态。也就是说，不只是角色能停用，角色和用户之间这条关系以后也可以被撤销。

## 5. 内建角色

角色一旦能在后台里操作，最容易出问题的地方反而不是新增，而是删错。

比如 `admin_owner`。这个角色如果能被禁用或者删除，很容易把系统自己锁死。因为它本来就是后台最高权限角色，真把它弄没了，你连把它恢复回来的入口都可能一起没了。

再比如 `web_user`。它虽然不是后台最高权限，但它是 web 侧最基础的身份锚点。如果把它删掉，后面用户创建、身份分配、角色判断这些基础流程都可能一起跟着乱掉。

所以这类角色不能只在前端把按钮灰掉。真正的保护一定要落在服务端。

apps/api/src/auth/role-policy.ts

```typescript
export const protectedRoleCodes = new Set(['admin_owner', 'web_user'])

export function isProtectedRole(code: string) {
  return protectedRoleCodes.has(code)
}
```

这段代码把规则收口得很清楚：哪些角色属于系统底座，普通管理动作不能改动它们。

前端当然也可以顺手把按钮禁用掉，减少误操作。但那只是体验层面的辅助。真正的边界还是在 API。因为只要服务端不拦，别人完全可以绕过页面直接调接口。

## 6. API 设计

角色管理走到这里，就已经不是在用户详情页旁边顺手补几个接口那么简单了。

它有自己的列表、创建、禁用、删除，也有自己单独的权限判断和保护规则。所以更自然的做法，是把它拆成一个独立的角色管理域。

比如角色列表接口可以这样写：

apps/api/src/routes/role/management.route.ts

```typescript
roleRoute.get('/list', async (c) => {
  // 1. 先过后台最高权限守卫
  await requireAdminOwner(c)

  // 2. 从数据库查角色列表
  const roles = await findRoleList(getDb(c.env.DB))

  // 3. 派生前端直接可用的字段
  const res = RoleListResponseSchema.parse({
    items: roles.map((role) => ({
      ...role,
      isProtected: isProtectedRole(role.code),
    })),
  })

  // 4. 返回统一响应结构
  return c.json(buildSuccess(res, createApiMeta()))
})
```

这里有两个设计点很值得记住。

一个是角色管理单独挂在 `/rpc/role` 这类前缀下，语义会比塞进 `user` 或 `profile` 下面清楚得多。

另一个是 `isProtected` 这种字段不需要进数据库。数据库只存最基础的事实，到接口层再按规则把它派生出来，前端消费会更顺手。

所以角色管理在 API 这一层，不只是 CRUD，还要把后端事实整理成前端更好消费的数据。

## 7. 所有管理动作都要先过同一套守卫

既然角色管理已经是独立管理域，那它自己的权限入口就必须收紧。

最直接的一种做法，就是把 list、create、disable、delete 都先收口到同一个守卫里，比如只有 `admin_owner` 能操作。

apps/api/src/routes/role/management.route.ts

```typescript
async function requireAdminOwner(c: Context<{ Bindings: ApiBindings }>) {
  const claims = await requireAccessTokenClaims(c)

  if (!claims.roles.includes('admin_owner')) {
    throw forbiddenError()
  }

  return claims
}
```

这样做的好处很直接：入口条件统一，后面如果还要继续细分权限，也很好扩展。

然后我们再看具体动作。

创建角色时，服务端要先根据 `applicationCode` 找到对应的 application，再去插入角色。如果碰到 `(application_id, code)` 的唯一约束冲突，就应该按业务冲突返回，而不是让数据库错误直接漏出去。

禁用和删除则还要多做一步。服务端得先查目标角色，再判断它是不是 protected role。如果是，直接拒绝。不是，才继续更新状态。

所以整个动作顺序其实很固定：先验权限，再查目标对象，再做保护判断，最后才更新数据库。

## 8. Repository 为什么要把角色读写收起来

角色管理一旦支持列表、创建、禁用、删除，route 里就不能再直接塞一堆表操作了。

这里比较自然的做法，是把角色相关的查写统一收进 repository。

我们先看角色列表到底是怎么查出来的。

apps/api/src/auth/repository.ts

```typescript
export async function findRoleList(db: ApiDb) {
  return db
    .select({
      id: roles.id,
      applicationCode: applications.code,
      code: roles.code,
      name: roles.name,
      status: roles.status,
      createdAtMs: roles.createdAtMs,
      updatedAtMs: roles.updatedAtMs,
      disabledAtMs: roles.disabledAtMs,
      deletedAtMs: roles.deletedAtMs,
    })
    .from(roles) // 从角色表开始查
    .innerJoin(applications, eq(applications.id, roles.applicationId)) // 补出角色属于哪个 application
    .where(sql`${roles.status} != 'deleted'`) // 已删除角色不进入列表
    .orderBy(sql`${applications.code} asc, ${roles.createdAtMs} desc, ${roles.id} desc`)
}
```

这个查询可以按 4 步看。

第一步，`select(...)` 只挑前端真正要展示的字段，而不是把整张表所有列都扔回去。

第二步，`from(roles)` 表示这次查询是从角色表出发。因为我们当前关心的是「有哪些角色」，不是「某个用户拥有哪些角色」。

第三步，`innerJoin(applications, ...)` 是为了把 `applicationCode` 一起查出来。否则前端只拿到 role 本身，看不出它属于 `admin` 还是 `web`。

第四步，`where(status != 'deleted')` 直接把软删除角色排除掉。这样前端点完**删除**之后，角色会从列表里消失；数据库里又还保留着历史，不会把数据真的抹掉。

再看写操作：

apps/api/src/auth/repository.ts

```typescript
export async function disableRole(params: { db: ApiDb; roleId: string; nowMs: number }) {
  await params.db
    .update(roles)
    .set({
      status: 'disabled',
      updatedAtMs: params.nowMs,
      disabledAtMs: params.nowMs,
    })
    .where(eq(roles.id, params.roleId))
}

export async function deleteRole(params: { db: ApiDb; roleId: string; nowMs: number }) {
  await params.db
    .update(roles)
    .set({
      status: 'deleted',
      updatedAtMs: params.nowMs,
      deletedAtMs: params.nowMs,
    })
    .where(eq(roles.id, params.roleId))
}
```

这里本质上都不是物理删除，而是让角色状态往前推进。这种写法对角色这种系统配置类数据会稳很多。

## 9. 角色状态还要回接鉴权

很多人做角色管理时，很容易把注意力都放在后台页面上：能创建、能列表、能禁用、能删除，看起来就像做完了。

其实还差一步，而且这一步比页面更关键。

如果某个角色在后台里被禁用了，但用户登录、refresh token、权限判断这些地方还继续把它当成有效角色，那这个禁用其实等于没生效。

所以角色管理一旦支持 `disabled`，后面的角色读取逻辑就必须同步改掉。

比如 `getAdminRolesForUser` 这种查询，就不能只查绑定关系，还得继续过滤角色状态：

apps/api/src/auth/repository.ts

```typescript
export async function getAdminRolesForUser(db: ApiDb, userId: string): Promise<string[]> {
  const rows = await db
    .select({ code: roles.code })
    .from(userRoleBindings) // 这次从绑定表出发，因为问题变成了“这个用户有哪些角色”
    .innerJoin(roles, eq(roles.id, userRoleBindings.roleId))
    .innerJoin(applications, eq(applications.id, roles.applicationId))
    .where(
      and(
        eq(userRoleBindings.userId, userId),
        eq(userRoleBindings.status, 'active'), // 绑定关系本身还有效
        eq(roles.status, 'active'), // 角色本身也还有效
        eq(applications.code, 'admin'), // 只取 admin 侧角色
      ),
    )

  return rows.map((row) => row.code)
}
```

这段查询最值得注意的是出发点。

角色列表接口是从 `roles` 表出发，因为我们在问「现在系统里有哪些角色」。

这里却要从 `user_role_bindings` 出发，因为我们现在问的是「这个用户当前拥有哪些后台角色」。问题不同，查询起点也就不同。

只要把这个思路想清楚，Drizzle 里的 `.from(...)`、`.innerJoin(...)`、`.where(...)` 就不会看起来像一坨黑盒代码。

再往前走一步，users 页面里的角色选择也不能再写死成静态枚举了，而应该动态拉取当前 `admin` 下处于 `active` 的角色。这样角色管理这条线才算真正接上业务。

## 10. 总结

角色管理真正要解决的，不是做一个能增删改查的表格，而是把角色从静态初始化数据推进成一套可管理、可保护、还能真正影响权限链路的系统能力。

更稳的落法是这样的：角色按 application 隔离，`roles` 表补状态字段，关键内建角色在服务端保护，角色管理拆成独立 route 和页面，再把角色状态真正回接到鉴权链路。

这样做完之后，后台才能真正管理角色，同时又不会把 `admin_owner`、`web_user` 这种系统底座误伤掉。更重要的是，角色状态变化还能继续传到登录、refresh、鉴权这些链路里，整套系统才算真正闭环。
