---
title: "112 Schema 组合"
pubDate: 2026-05-16
description: "数据库里的 User：含 id / name / email / password / createdAt / ..."
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/11-schema-composition/](https://aicompanion.usehook.cn/11-schema-composition/)

## 1. 一份主 schema，能派生出一整套相关 schema

真实项目里有个非常常见的观察：**很多 schema 其实是同一个实体的不同视角**。

拿「用户」举例：

- 数据库里的 `User`：含 `id / name / email / password / createdAt / ...`

- 对外返回的「公开用户」：**不含 `password`**

- 注册请求体：**不含 `id / createdAt`**（由后端生成）

- 更新请求体：所有字段都**可选**（PATCH 语义）

- 登录请求体：**只要 `email + password`**

这 5 份 schema 本质都在描述同一个 `User`，只是视角不同。如果你手写 5 份独立 schema，修改时必然出现**模型分裂**（第 2 篇讲过）。

Zod 提供了一组**组合方法**，让你从一份主 schema 派生出整套相关 schema：

index.ts

```typescript
.extend({...})   // 添加 / 覆盖字段
.merge(other)    // 合并两个 object schema
.pick({...})     // 只保留指定字段
.omit({...})     // 排除指定字段
.partial()       // 所有字段变可选
.required()      // 所有字段变必填
.deepPartial()   // 递归可选
.and(other)      // schema 交集
```

这一篇我们把这 8 个方法全过一遍，并给出在真实项目里**组织 schema 目录**的推荐模式。读完这篇，你就能把「模型分裂」这件事从项目里彻底赶走。

## 2. .extend()：添加和覆盖字段

`.extend(shape)` 接收一个字段定义对象，**在现有 object schema 基础上加字段或覆盖字段**：

index.ts

```typescript
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
})

// 加字段
const UserWithEmail = UserSchema.extend({
  email: z.string().email(),
})
// { id: string; name: string; email: string }

// 覆盖字段（name 从 string 变成至少 1 字符的 string）
const UserStrict = UserSchema.extend({
  name: z.string().min(1),
})
```

### 2.1 注意：字段会被「直接替换」

extend 时如果 key 已经存在，**新的字段定义会完全覆盖旧的**，不是合并：

index.ts

```typescript
const A = z.object({ x: z.string().min(1) })
const B = A.extend({ x: z.number() })
// B 的 x 是 number，原来的 .min(1) 校验规则已经被彻底丢掉
```

这是新手会踩的一个坑：以为 extend 是「增量改」，实际是「覆盖式改」。

### 2.2 extend 的典型用途

- 在通用基础 schema 上加特定字段（`BaseResponse + { data }`）

- 在宽松 schema 上派生更严格的版本（覆盖字段加更多校验）

- 扩展公共实体（`User + { role, permissions }`）

## 3. .merge()：合并两个 object schema

`.merge(other)` 的行为是把**两个 object schema** 的字段合到一起：

index.ts

```typescript
const TimestampsSchema = z.object({
  createdAt: z.date(),
  updatedAt: z.date(),
})

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
})

const UserWithTimestamps = UserSchema.merge(TimestampsSchema)
// { id: string; name: string; createdAt: Date; updatedAt: Date }
```

### 3.1 extend vs merge 的差别

两者在「合并字段」这件事上效果很像，区别是：

| 方法 | 第二参数 | 典型场景 |
| --- | --- | --- |
| .extend(shape) | 字段定义对象 | 加几个内联字段 |
| .merge(other) | 另一个 object schema | 合并两个已有 schema |

简单记：**手里已经有一个完整 schema 就用 `merge`，只是想随手加两个字段就用 `extend`**。两者都会**覆盖重名字段**，行为一致。

### 3.2 典型模式：把「时间戳」做成公共片段

schemas/common.ts

```typescript
export const TimestampsSchema = z.object({
  createdAt: z.date(),
  updatedAt: z.date(),
})

export const SoftDeleteSchema = z.object({
  deletedAt: z.date().nullable(),
})
```

然后每个实体：

schemas/post.ts

```typescript
export const PostSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
})
  .merge(TimestampsSchema)
  .merge(SoftDeleteSchema)
```

**小片段 + merge** 的组合，比继承和 mixin 都要清爽。

## 4. .pick() 和 .omit()：从主 schema 挑选

这两个方法都是「从主 schema 挑字段出来做一个更小的子 schema」。

`.pick()` 是**正向选择**——我要这几个：

index.ts

```typescript
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  password: z.string(),
})

const LoginBody = UserSchema.pick({
  email: true,
  password: true,
})
// { email: string; password: string }
```

`.omit()` 是**反向选择**——我要除了这几个之外的：

index.ts

```typescript
const PublicUser = UserSchema.omit({
  password: true,
})
// { id: string; name: string; email: string }
```

### 4.1 什么时候该用哪个

| 场景 | 选择 |
| --- | --- |
| 要保留的字段很少 | .pick()（写起来更短） |
| 要排除的字段很少 | .omit()（写起来更短） |
| 强调「对外接口只暴露这些」 | .pick()（白名单更安全） |
| 强调「去掉敏感/内部字段」 | .omit()（黑名单更直观） |

**安全敏感场景下优先 `.pick()`**：万一主 schema 之后加了新字段，`.omit()` 会**默默把新字段带出去**，`.pick()` 则不会。比如给前端返回用户信息时：

index.ts

```typescript
// ⚠️ 后面 UserSchema 加了新字段会自动被带出去
const Public1 = UserSchema.omit({ password: true })

// ✅ 加了新字段也不会意外泄露
const Public2 = UserSchema.pick({ id: true, name: true, email: true })
```

这是个**安全考量**，不是写法偏好。

## 5. .partial() / .required() / .deepPartial()

这一组方法调整的是**字段的可选性**。

### 5.1 .partial()：所有字段变可选

index.ts

```typescript
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
})

const UpdateUserBody = UserSchema.partial()
// { id?: string; name?: string; email?: string }

UpdateUserBody.parse({})                // ✅
UpdateUserBody.parse({ name: 'Alice' }) // ✅
```

这是 **PATCH 接口**（部分更新）请求体的标准写法——一份 `UserSchema` 派生出 `UpdateUserBody`，不用手写。

### 5.2 指定只让部分字段可选

`.partial()` 可以只作用在某些字段上：

index.ts

```typescript
const schema = UserSchema.partial({
  name: true,
  email: true,
  // id 仍然必填
})
```

这在「更新接口里某些字段可选，但 ID 仍然必填」的场景里特别顺手。

### 5.3 .required()：所有字段变必填

反过来的操作：

index.ts

```typescript
const Loose = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
})

const Strict = Loose.required()
// { name: string; email: string }
```

### 5.4 .deepPartial()：递归版本的 partial

`.partial()` **不递归**——嵌套对象里的字段不受影响：

index.ts

```typescript
const schema = z.object({
  name: z.string(),
  address: z.object({
    city: z.string(),
    zip: z.string(),
  }),
})

schema.partial().parse({})
// ✅ name 可选了

schema.partial().parse({ address: {} })
// 💥 address.city / address.zip 仍然必填
```

要递归变可选，用 `.deepPartial()`：

index.ts

```typescript
schema.deepPartial().parse({ address: {} })  // ✅
```

注意这个方法在 Zod v4 里已被移除（官方建议按层手工展开 `.partial()`），但 v3 里它仍是唯一的方便写法。

## 6. .and()：schema 的交集

`.and(other)` 做的是**类型上的交集**：

index.ts

```typescript
const A = z.object({ name: z.string() })
const B = z.object({ age: z.number() })

const AB = A.and(B)
// AB 的类型：{ name: string } & { age: number }

AB.parse({ name: 'Alice', age: 18 })  // ✅
AB.parse({ name: 'Alice' })           // 💥 age 缺失
```

`.and()` 和 `.merge()` 在**两个都是 object schema** 的场景下效果接近，区别是：

| 方法 | 只能用于 | 输出 schema 的类型 |
| --- | --- | --- |
| .merge(other) | 两个都是 object | object，还能继续 .extend/.pick/.omit |
| .and(other) | 任意 schema | 交集 schema，不能再用 object 独有方法 |

**能用 merge 的时候优先用 merge**，只在需要和「非 object schema」做交集时才用 `.and()`——实际项目里这种需求很少。

## 7. 实战：为 User 模型设计整套派生 schema

我们用一份主 schema，派生出**一整套真实接口里会用到的 schema**。这是整个组织篇最核心的代码片段：

schemas/user.ts

```typescript
import { z } from 'zod'
import { TimestampsSchema } from './common'

// ========== 主 schema（数据库形态，含所有字段）==========
export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(50),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['admin', 'user']).default('user'),
  avatar: z.string().url().nullable(),
}).merge(TimestampsSchema)

export type User = z.infer<typeof UserSchema>

// ========== 派生 1：对外返回的公开用户（安全白名单）==========
export const PublicUserSchema = UserSchema.pick({
  id: true,
  name: true,
  email: true,
  avatar: true,
  role: true,
  createdAt: true,
})
export type PublicUser = z.infer<typeof PublicUserSchema>

// ========== 派生 2：注册请求体（去掉生成字段）==========
export const RegisterBodySchema = UserSchema.pick({
  name: true,
  email: true,
  password: true,
})
export type RegisterBody = z.infer<typeof RegisterBodySchema>
export type RegisterBodyInput = z.input<typeof RegisterBodySchema>

// ========== 派生 3：登录请求体 ==========
export const LoginBodySchema = UserSchema.pick({
  email: true,
  password: true,
})
export type LoginBody = z.infer<typeof LoginBodySchema>

// ========== 派生 4：更新请求体（部分字段可选，ID 通过 URL 传）==========
export const UpdateUserBodySchema = UserSchema
  .pick({ name: true, avatar: true })
  .partial()
export type UpdateUserBody = z.infer<typeof UpdateUserBodySchema>

// ========== 派生 5：改密接口 ==========
export const ChangePasswordBodySchema = z.object({
  oldPassword: z.string().min(8),
  newPassword: z.string().min(8),
}).refine(d => d.oldPassword !== d.newPassword, {
  message: '新密码不能与旧密码相同',
  path: ['newPassword'],
})
export type ChangePasswordBody = z.infer<typeof ChangePasswordBodySchema>
```

看一眼它做到的事情：

- **一份主 `UserSchema` 作为真相源**，包含所有字段

- **5 份派生 schema** 都从它 `.pick / .omit / .partial` 出来，没有手写重复定义

- 只要改 `UserSchema`（比如 `name` 长度从 50 改成 100），所有派生 schema **自动同步**

- 敏感字段 `password` 通过白名单 `.pick` 永远不会被意外暴露

- **第 5 个派生 schema 是独立新写的**——因为它和 `UserSchema` 的结构关系不大，反而更清楚

这就是上一篇讲的 SSOT 原则在真实代码里的样子。

### 7.1 目录组织建议

text

```text
schemas/
├── common.ts        # TimestampsSchema / SoftDeleteSchema 等公共片段
├── user.ts          # User 主 schema + 所有派生
├── post.ts          # Post 主 schema + 所有派生
├── chat.ts          # ChatRequest / ChatResponse
└── index.ts         # 统一 re-export
```

一条铁律：**一个实体的所有 schema 放在一个文件里**。不要把 `UserSchema` 放一个文件，`RegisterBodySchema` 又放另一个文件——一旦拆开，派生关系就隐身了，新人读代码会非常痛苦。

## 8. 总结

这一篇把 Zod 里「组合一份 schema」的全套方法讲完了：

| 方法 | 作用 | 典型场景 |
| --- | --- | --- |
| .extend({...}) | 加/覆盖字段 | 通用 + 特化 |
| .merge(other) | 合并两个 object schema | 把公共片段（时间戳）拼进实体 |
| .pick({ ... }) | 白名单挑字段 | 对外响应、登录表单 |
| .omit({ ... }) | 黑名单去字段 | 快速去掉一两个敏感字段 |
| .partial() | 所有字段可选 | PATCH 接口请求体 |
| .required() | 所有字段必填 | 从宽松 schema 派生严格版 |
| .deepPartial() | 递归可选 | 复杂嵌套对象的 PATCH |
| .and(other) | 交集 | 和非 object 做交集（少用） |

两条组织原则，比具体方法更重要：

- **一个实体一份主 schema，所有相关 schema 从它派生**——避免模型分裂

- **安全敏感场景优先 `.pick()`**——白名单比黑名单更稳妥

一句话带走：

NOTE

**不要手写 5 份 User——手写一份，另外 4 份从它派生。这才是 Zod 真正省时间的地方。**

组织篇到此结束，**你已经具备设计和维护大型项目 schema 架构的全部能力**。

从下一篇开始我们进入**实战篇**——把前面 11 篇学到的东西放到真实的 AI 应用里。第 12 篇先接最直接的场景：**Zod + Hono**，在真实 API 层里做输入输出校验。
