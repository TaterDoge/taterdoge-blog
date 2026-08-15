---
title: "105 基础类型"
pubDate: 2026-05-14
description: "真实项目里的数据结构看起来都很复杂：嵌套对象、数组、联合类型、可选字段……但你把它们一层层拆下去，最底层全是基础类型（Primitive Types）。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/4-primitive-types/](https://aicompanion.usehook.cn/4-primitive-types/)

## 1. 基础类型是 Zod 的地基

真实项目里的数据结构看起来都很复杂：嵌套对象、数组、联合类型、可选字段……但你把它们一层层拆下去，最底层全是**基础类型（Primitive Types）**。

- 用户名是 `string`

- 年龄是 `number`

- 是否订阅是 `boolean`

- 创建时间是 `date`

在 Zod 里，它们对应的是这 4 个最常用的 schema 构造器：

index.ts

```typescript
import { z } from 'zod'

z.string()
z.number()
z.boolean()
z.date()
```

这一篇我们把这 4 个基础类型一个个过一遍。每一个都有一些**新手非常容易踩的小坑**，我会标出来。

读完这一篇，你写 90% 的 schema 都不会卡在基础类型上。

## 2. z.string()

`z.string()` 是最常用、也是附加方法最多的一个。光是用来校验文本数据，它几乎就把你日常能想到的需求全盖了。

先看一组最常见的方法：

index.ts

```typescript
// 长度
z.string().min(1)           // 至少 1 个字符
z.string().max(100)         // 最多 100 个字符
z.string().length(11)       // 严格等于 11 个字符

// 常用格式
z.string().email()          // 邮箱
z.string().url()            // URL
z.string().uuid()           // UUID
z.string().regex(/^\d+$/)   // 自定义正则

// 字符匹配
z.string().startsWith('sk-')
z.string().endsWith('.com')
z.string().includes('@')
```

### 2.1 链式组合

Zod 的 API 设计是**链式的**：每个方法都返回一个新的 schema，你可以继续往后接。

index.ts

```typescript
const ApiKeySchema = z.string()
  .startsWith('sk-')
  .min(20)
  .max(100)
```

这份 schema 要求字符串必须以 `sk-` 开头、长度在 20~100 之间。三个规则读起来就像读一句自然语言。

### 2.2 自带的字符串变换

除了校验，`z.string()` 还带了几个会**修改**数据的方法：

index.ts

```typescript
z.string().trim()           // 去除前后空白
z.string().toLowerCase()    // 转小写
z.string().toUpperCase()    // 转大写
```

这类方法跟校验方法不同：它们会**返回修改后的数据**。

index.ts

```typescript
const schema = z.string().trim().toLowerCase()
console.log(schema.parse('  Hello  ')) // 'hello'
```

所以 parse 之后你拿到的，不一定是原始数据，可能是被 Zod 处理过的版本。这点以后讲 `transform` 还会再展开。

### 2.3 日期时间字符串

一个特别容易被忽视的点：`z.date()` **不吃**字符串。如果你要校验的是 ISO 时间字符串（前后端之间传的最多是字符串），应该用：

index.ts

```typescript
z.string().datetime()        // 2024-01-01T00:00:00Z
z.string().date()            // 2024-01-01
z.string().time()            // 14:30:00
```

这三个是 `z.string()` 下的方法，返回值仍然是字符串，只是校验了格式。

## 3. z.number()

`z.number()` 用起来和 `z.string()` 很像，也是一串链式方法：

index.ts

```typescript
// 整数
z.number().int()

// 范围
z.number().min(0).max(100)
z.number().gt(0)             // > 0
z.number().gte(0)            // >= 0（等价于 min）
z.number().lt(100)           // < 100
z.number().lte(100)          // <= 100（等价于 max）

// 正负号
z.number().positive()        // > 0
z.number().negative()        // < 0
z.number().nonnegative()     // >= 0
z.number().nonpositive()     // <= 0

// 倍数
z.number().multipleOf(5)     // 必须是 5 的倍数

// 特殊值
z.number().finite()          // 拒绝 Infinity
z.number().safe()            // 在 Number.MAX_SAFE_INTEGER 范围内
```

### 3.1 它不吃字符串

这是新手最常踩的一个坑：

index.ts

```typescript
z.number().parse('42')
// 💥 ZodError: Expected number, received string
```

HTTP 请求里的数字经常以字符串形式传过来（尤其是 query 参数、表单字段）。你如果期望 Zod 能自动把 `"42"` 转成 `42`，它不会。**Zod 默认是严格模式，不会做隐式类型转换。**

要让它做转换，用 `z.coerce.number()`（本篇第 6 节会讲）。

### 3.2 NaN 默认是被拒绝的

index.ts

```typescript
z.number().parse(NaN)
// 💥 ZodError: Expected number, received nan
```

虽然 `typeof NaN === 'number'` 在 JS 里是成立的，但 Zod 觉得这玩意不该被当成合法的 number 放行。这是个好默认，记住就行。

如果你确实要接受 NaN（极少见），用 `z.number().or(z.nan())` 这样显式声明。

### 3.3 小数和 AI 参数

AI 项目里会大量遇到小数参数：`temperature`、`top_p`、`frequency_penalty`。典型写法：

index.ts

```typescript
const TemperatureSchema = z.number().min(0).max(2)
const TopPSchema = z.number().min(0).max(1)
```

记得 `int()` 不要乱加——小数加了 `int()` 直接过不了。

## 4. z.boolean() 和 z.date()

这两个比较简单，放到一起讲，但都有一个必须知道的「反直觉点」。

### 4.1 z.boolean() 不吃「类真值」

index.ts

```typescript
z.boolean().parse(true)   // ✅ true
z.boolean().parse(false)  // ✅ false
z.boolean().parse(1)      // 💥 拒绝
z.boolean().parse('true') // 💥 拒绝
z.boolean().parse('')     // 💥 拒绝
```

很多 JS 老手下意识会觉得 `1` / `'true'` / `'yes'` 都算 boolean，但 Zod 不买账。这是**设计决策**：隐式转换会让数据边界变糊，Zod 宁可让你显式写出来。

需要从字符串或数字转 boolean 的时候，请用 `z.coerce.boolean()`，但注意它有个很坑的行为，第 6 节会讲。

### 4.2 z.date() 只接受 Date 对象

这个坑踩过的人才会记得：

index.ts

```typescript
z.date().parse(new Date())               // ✅
z.date().parse('2024-01-01')             // 💥 拒绝
z.date().parse(1700000000000)            // 💥 拒绝
```

HTTP 请求里几乎不会有 Date 对象——要么是字符串，要么是时间戳。所以 `z.date()` 在实际的后端校验中**用得比你想象的少**，常见用法是：

- 输入来源是字符串 → 用 `z.string().datetime()` 做格式校验，保留字符串

- 确实要得到 Date 对象 → 用 `z.coerce.date()`（第 6 节）

- 代码内部的数据模型（已经是 Date 对象） → 用 `z.date()`

### 4.3 z.date() 的范围校验

index.ts

```typescript
const FutureDate = z.date().min(new Date())            // 必须是将来
const LastYearOnly = z.date()
  .min(new Date('2024-01-01'))
  .max(new Date('2024-12-31'))
```

## 5. 所有基础类型共享的方法

Zod 里有一组方法是**所有 schema 都能用**的，不只是基础类型。你会在整个学习过程中反复见到它们：

| 方法 | 含义 | 示例 |
| --- | --- | --- |
| .optional() | 允许 undefined | z.string().optional() |
| .nullable() | 允许 null | z.string().nullable() |
| .nullish() | 允许 null 或 undefined | z.string().nullish() |
| .default(v) | 为 undefined 提供默认值 | z.string().default('anon') |
| .describe(s) | 加描述（给文档/LLM 用） | z.string().describe('user name') |
| .refine(fn) | 自定义校验 | z.string().refine(s => s.length > 3) |
| .transform(fn) | 自定义变换 | z.string().transform(s => s.trim()) |

这一组方法后面都会有专题。这里你只要知道**它们是通用的**，不需要死记每个基础类型单独支持哪些。

## 6. z.coerce：接受「脏数据」的开关

前面反复提到：Zod 默认严格，不做隐式转换。但现实里有很多**你没办法控制输入**的场景：

- 表单提交（HTML input 天生是字符串）

- URL query 参数（`?page=2` 里的 `2` 是字符串）

- 环境变量（`process.env.PORT` 一定是字符串）

这时候就该请出 `z.coerce.*`：

index.ts

```typescript
z.coerce.string()   // 先调用 String(input)
z.coerce.number()   // 先调用 Number(input)
z.coerce.boolean()  // 先调用 Boolean(input)
z.coerce.date()     // 先调用 new Date(input)
```

举几个例子：

index.ts

```typescript
z.coerce.number().parse('42')          // ✅ 42
z.coerce.number().parse('abc')         // 💥 Number('abc') 是 NaN，被拒绝
z.coerce.date().parse('2024-01-01')    // ✅ Date 对象
```

### 6.1 coerce.boolean() 的大坑（必看）

`z.coerce.boolean()` 的行为是 **`Boolean(input)`**，这意味着：

index.ts

```typescript
z.coerce.boolean().parse('false')  // ⚠️ 返回 true！
z.coerce.boolean().parse('0')      // ⚠️ 返回 true！
z.coerce.boolean().parse('')       // ✅ 返回 false
```

原因是 JS 的 `Boolean('false')` 就是 `true`——任何**非空字符串**都是 truthy。

如果你要把字符串 `'true'` / `'false'` 转成对应 boolean，应该**自己写逻辑**：

index.ts

```typescript
const StrictBool = z.enum(['true', 'false'])
  .transform(v => v === 'true')

StrictBool.parse('true')   // true
StrictBool.parse('false')  // false
StrictBool.parse('yes')    // 💥 拒绝
```

这个坑在环境变量校验里特别常见，专门拎出来提醒一下。

## 7. 常见陷阱速查表

把前面所有容易踩的坑收成一张表，方便你之后回头查：

| 场景 | 错误写法 | 正确做法 |
| --- | --- | --- |
| 校验 "42" 这样的数字字符串 | z.number() | z.coerce.number() |
| 校验 ISO 时间字符串 | z.date() | z.string().datetime() |
| 接受 1 / "yes" 作为 true | z.boolean() | 显式用 z.enum+transform |
| 把 "false" 字符串转成 false | z.coerce.boolean() | 自己写 transform |
| 希望允许缺省 | 手动判断 undefined | .optional() / .default() |
| 允许 null | 手动判断 | .nullable() / .nullish() |
| 希望 NaN 合法 | z.number() | 显式 .or(z.nan()) |
| 希望数字不超过安全整数 | z.number() | 加 .safe() |

## 8. 总结

这一篇把 Zod 的 4 个基础类型和它们周边的方法梳理了一遍。你现在应该能把下面这张图在脑子里画出来：

text

```text
基础类型
├── z.string()  ── .min / .max / .email / .url / .regex / .datetime ...
├── z.number()  ── .int / .min / .max / .positive / .finite ...
├── z.boolean() ── 只接受真 boolean
├── z.date()    ── 只接受 Date 对象

所有 schema 共享
├── .optional() / .nullable() / .nullish()
├── .default() / .describe()
├── .refine() / .transform()

需要隐式转换时
├── z.coerce.string / number / boolean / date
    └── ⚠️ coerce.boolean 有坑，字符串 'false' 会被转成 true
```

一句话带走：

NOTE

**Zod 默认是严格的——不转换、不容忍、不猜测。如果你要「宽松」，必须显式用 `coerce` 或 `transform`。**

下一篇进入 `z.object()` 和 `z.array()`——真实项目里，你 80% 的 schema 都是这两个的组合。
