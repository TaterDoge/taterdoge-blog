---
title: "104 parse 与 safeParse"
pubDate: 2026-05-14
description: "要让这份说明书真的去工作，你需要调用它的两个核心方法之一：parse 或者 safeParse。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/3-parse-and-safeparse/](https://aicompanion.usehook.cn/3-parse-and-safeparse/)

## 1. 写你的第一个 Zod Schema

前两篇都在讲道理，这一篇开始动手。

Zod 里最小的那个例子是这样的：

index.ts

```typescript
import { z } from 'zod'

const schema = z.string()
```

这一行代码做的事情，用大白话翻译就是：

NOTE

「我声明一个规则，这个规则要求数据必须是字符串。」

它就是一个 schema。还没真正校验任何东西，只是一份**规则说明书**。

要让这份说明书真的去工作，你需要调用它的两个核心方法之一：**`parse`** 或者 **`safeParse`**。

这两个方法是 Zod 里最高频的 API，几乎所有校验场景都离不开它们。我们一个个来看。

## 2. parse：严格模式，失败就抛错

`parse` 的行为非常直白：

- **数据合法** → 返回处理后的数据

- **数据不合法** → 抛出 `ZodError`

index.ts

```typescript
import { z } from 'zod'

const schema = z.string()

// 合法：返回 'hello'
const a = schema.parse('hello')
console.log(a) // 'hello'

// 不合法：抛出 ZodError
const b = schema.parse(123)
// 💥 这一行会抛错，后面的代码根本执行不到
```

你可以把 `parse` 想成机场安检的「严格通道」：**数据能过，就原样放行；过不了，直接报警，后面的流程都停掉。**

### 2.1 parse 之后的数据是「可信的」

这里有一个新手特别容易忽视的细节：**`parse` 返回的数据，TypeScript 会给它一个准确的类型。**

index.ts

```typescript
const schema = z.string()

const a = schema.parse(someUnknownValue)
// a 的类型是 string，哪怕 someUnknownValue 是 unknown
```

也就是说，`parse` 不仅做运行时校验，还顺手帮你把 `unknown` 类型「窄化」成了具体类型。

这是为什么前面说 Zod 把 TypeScript 的类型**一路延伸到运行时入口**：外部世界进来时是 `unknown`，经过 `parse` 之后就是一个你可以放心使用的具体类型。

### 2.2 什么时候适合用 parse

`parse` 适合一个典型场景：**你非常确信数据应该是合法的，不合法就是异常情况。**

比如：

- 解析你自己写进数据库、刚刚读出来的配置

- 解析一个你自己定义的、从受信环境来的 JSON

- Hono / Express 里，通常让框架帮你抓 `parse` 抛出的错误，然后统一返回 400

换句话说：**你希望「不合法」走异常分支，而不是走业务分支时，用 `parse`。**

## 3. safeParse：安全模式，永远不抛错

`safeParse` 的设计刚好相反。它永远不抛错，而是返回一个「结果对象」：

index.ts

```typescript
const schema = z.string()

const result = schema.safeParse('hello')

if (result.success) {
  // 成功分支
  console.log(result.data) // 'hello'，类型是 string
} else {
  // 失败分支
  console.log(result.error) // ZodError 实例
}
```

`safeParse` 的返回值是一个**可辨识联合（discriminated union）**，靠 `success` 字段区分：

| success | 字段 | 类型 |
| --- | --- | --- |
| true | result.data | 你期望的类型 |
| false | result.error | ZodError |

TypeScript 会根据你是否判断了 `result.success`，自动给你正确的类型。这就是为什么上面代码里 `result.data` 被识别成 `string`。

### 3.1 什么时候适合用 safeParse

`safeParse` 适合所有**希望把失败当作一个正常业务分支来处理**的场景，比如：

- 表单校验：字段错了要显示错误提示，而不是抛异常

- LLM 返回的 JSON 校验：模型返回脏数据是家常便饭，不应该当成崩溃事件

- 用户输入解析：一定有错，要给用户友好提示

- 定时任务里批量处理数据：一条脏数据不应该让整批任务挂掉

用一句话概括：

NOTE

**「失败是预期之内的事」 → 用 `safeParse`；「失败是异常情况」 → 用 `parse`。**

## 4. parse vs safeParse：决策地图

新手最常见的一个误用是：**无脑用 `parse` 再包一层 `try/catch`。**

index.ts

```typescript
// ❌ 别这么写
try {
  const data = schema.parse(input)
  // 处理 data
} catch (err) {
  // 处理错误
}

// ✅ 这时候应该用 safeParse
const result = schema.safeParse(input)
if (!result.success) {
  // 处理错误
  return
}
// 处理 result.data
```

两种写法运行时表现差不多，但**代码风格完全不同**：

- `try/catch` 适合「异常控制流」——少见、意外的情况

- `if (!result.success)` 适合「普通控制流」——预期内的分支

一个简单的判断标准：

| 场景 | 选择 |
| --- | --- |
| 数据理论上一定合法，不合法就是 bug | parse |
| 数据经常会不合法，要给出反馈 | safeParse |
| 框架（如 Hono）会自动捕获异常并返回 400 | parse（交给框架处理） |
| 要把错误信息展示给用户 | safeParse（方便拿到 error） |

## 5. 看懂 ZodError

无论用哪个方法，失败的时候你都会拿到一个 `ZodError`。读懂它是 Zod 的基本功。

我们用一个稍微复杂的 schema 触发一个错误：

index.ts

```typescript
const UserSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().min(0),
  email: z.string().email(),
})

const result = UserSchema.safeParse({
  name: '',
  age: -1,
  email: 'not-an-email',
})

if (!result.success) {
  console.log(result.error.issues)
}
```

打印出来大概长这样（精简过）：

index.json

```json
[
  {
    "code": "too_small",
    "minimum": 1,
    "type": "string",
    "path": ["name"],
    "message": "String must contain at least 1 character(s)"
  },
  {
    "code": "too_small",
    "minimum": 0,
    "type": "number",
    "path": ["age"],
    "message": "Number must be greater than or equal to 0"
  },
  {
    "code": "invalid_string",
    "validation": "email",
    "path": ["email"],
    "message": "Invalid email"
  }
]
```

这个 `issues` 数组就是 ZodError 的核心。每一条都带这几个最常用的字段：

| 字段 | 含义 |
| --- | --- |
| path | 出错字段的路径，例如 ['user', 'address', 'zip'] |
| code | 错误类型，例如 too_small / invalid_type / invalid_string |
| message | 人类可读的错误信息（默认英文，后面章节会讲本地化） |

### 5.1 给前端返回结构化错误

在 API 场景里，一个常见模式是把 `issues` 直接返回给前端，让前端能逐字段显示：

index.ts

```typescript
app.post('/register', async (c) => {
  const result = RegisterSchema.safeParse(await c.req.json())
  if (!result.success) {
    return c.json({
      ok: false,
      errors: result.error.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    }, 400)
  }
  // 合法数据
  return c.json({ ok: true })
})
```

前端拿到的结构是这样的，可以直接喂给表单组件：

index.json

```json
{
  "ok": false,
  "errors": [
    { "field": "name", "message": "String must contain at least 1 character(s)" },
    { "field": "email", "message": "Invalid email" }
  ]
}
```

### 5.2 快速格式化：flatten 和 format

如果你不想手动遍历 `issues`，Zod 提供了两个常用的格式化方法：

index.ts

```typescript
if (!result.success) {
  // flatten：按字段聚合，适合表单
  console.log(result.error.flatten())
  // {
  //   formErrors: [],
  //   fieldErrors: {
  //     name: ['String must contain at least 1 character(s)'],
  //     email: ['Invalid email'],
  //   }
  // }

  // format：保留嵌套结构，适合嵌套对象
  console.log(result.error.format())
}
```

新手选型建议：

- 扁平结构（普通表单）→ `flatten()`

- 嵌套结构（对象里套对象）→ `format()`

- 要最大灵活性 → 直接用 `issues`

## 6. 异步版本：parseAsync 与 safeParseAsync

有些校验规则是异步的（比如「用户名是否已被占用」要查数据库）。这种场景下必须用异步版本：

index.ts

```typescript
const UsernameSchema = z.string().refine(
  async (name) => {
    const exists = await db.user.findFirst({ where: { name } })
    return !exists
  },
  { message: '用户名已被占用' }
)

// 同步版本会直接抛错：含异步校验，必须用 async 版本
const ok = await UsernameSchema.parseAsync('alice')
const result = await UsernameSchema.safeParseAsync('alice')
```

规则也很简单：

NOTE

**schema 里有任何异步逻辑（`refine` 返回 Promise、`transform` 是 async），就必须用 `parseAsync` / `safeParseAsync`。**

同步的 `parse` / `safeParse` 遇到异步校验会直接报错提醒你。

## 7. 动手练一下

看完这一篇，建议你花 5 分钟在本地跑一下下面三段代码，观察输出：

index.ts

```typescript
import { z } from 'zod'

// 练习 1：用 parse 校验一个数字
const NumSchema = z.number().int().min(0)
console.log(NumSchema.parse(42))
// console.log(NumSchema.parse('42'))  // 放开这行看会发生什么

// 练习 2：用 safeParse 校验一个邮箱
const EmailSchema = z.string().email()
const r = EmailSchema.safeParse('not-an-email')
console.log(r.success ? r.data : r.error.issues)

// 练习 3：校验一个对象，拿 flatten 输出
const PersonSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().min(0),
})
const r2 = PersonSchema.safeParse({ name: '', age: -1 })
if (!r2.success) console.log(r2.error.flatten())
```

当你能读懂每一段的输出，parse / safeParse 的心智就已经建立起来了。

## 8. 总结

这一篇我们把 Zod 最核心的两个 API 讲完了：

- **`parse`** — 严格模式，合法返回数据，不合法抛 `ZodError`。适合「数据应该合法，不合法是异常」的场景

- **`safeParse`** — 安全模式，永远返回 `{ success, data } | { success, error }`。适合「失败是预期之内」的场景

- **`ZodError.issues`** — 错误信息的核心，包含 `path / code / message`，配合 `flatten` / `format` 快速拿到可用结构

- **异步校验** — 用 `parseAsync` / `safeParseAsync`，规则是：schema 里有异步逻辑就必须用异步版本

记住这句话，你之后 90% 的 Zod 场景都能稳定选对工具：

NOTE

**「失败是异常」用 `parse`，「失败是业务分支」用 `safeParse`。**

下一篇开始，我们系统过一遍 Zod 的基础类型：`string`、`number`、`boolean`、`date`，每一个都有一些新手很容易踩的小坑。
