---
title: "110 数据变换"
pubDate: 2026-05-16
description: "但真实项目里，很多时候你希望 parse 不只是看门，还顺手帮你把数据整理成真正想要的形态。举几个例子："
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/9-transform-and-pipe/](https://aicompanion.usehook.cn/9-transform-and-pipe/)

## 1. Zod 不只是校验，它也能「搬运 + 加工」

到目前为止，我们用 Zod 做的事都只有一个：**判断数据合不合法**。

合法就放行，不合法就报错。**数据本身没被改动过。**

但真实项目里，很多时候你希望 parse 不只是看门，还顺手帮你把数据**整理成真正想要的形态**。举几个例子：

- 前端传来 `"tag1,tag2,tag3"`，你想直接拿到 `["tag1", "tag2", "tag3"]`

- 请求里有 `"2024-01-01T00:00:00Z"`，你想直接拿到 `Date` 对象

- 环境变量里有 `FEATURES='["chat","rag"]'`，你想直接拿到字符串数组

- 用户输入的邮箱 `"  Alice@Example.COM  "`，你希望自动 `trim + toLowerCase`

这些场景的共同特点是：**输入格式**和**你想要的形式**不一样。

Zod 为这一类场景准备了三个方法：

index.ts

```typescript
.transform(fn)              // 校验之后变形
z.preprocess(fn, schema)    // 校验之前预处理
.pipe(nextSchema)           // 把上一步的输出接给下一个 schema
```

这一篇我们把它们讲清——也顺便第一次正面遇到 Zod 里一个重要概念：**input 类型和 output 类型可以是不一样的**。

## 2. .transform()：校验之后再变形

`.transform(fn)` 接收一个函数，函数的输入是**通过了前面所有校验的**数据，输出是你想要的形态。

index.ts

```typescript
const TagsSchema = z.string().transform(
  s => s.split(',').map(t => t.trim())
)

TagsSchema.parse('ai, zod, hono')
// ['ai', 'zod', 'hono']
```

注意推导出的类型：

index.ts

```typescript
type Tags = z.infer<typeof TagsSchema>
// string[]  ← 不是 string！
```

虽然输入是 `string`，但 parse 之后的数据是 `string[]`，TS 类型也自动跟着变。这是 Zod 最「神奇」的能力之一。

### 2.1 transform 不做校验

一个容易误会的点：**transform 不判断对错，只做变形**。它假设输入已经是合法数据（因为前置校验都过了）。

index.ts

```typescript
// 这是个 bad smell：把校验逻辑塞进 transform
const BadEmail = z.string().transform(s => {
  if (!s.includes('@')) throw new Error('not email')  // ❌ 不该在这里做
  return s.toLowerCase()
})

// 正确做法：校验用 refine 或内置方法，变形用 transform
const GoodEmail = z.string()
  .email()                        // 校验
  .transform(s => s.toLowerCase()) // 变形
```

一句话：**transform 做的是「加工」，不是「质检」。**

### 2.2 transform 也可以是 async

index.ts

```typescript
const UserIdSchema = z.string().transform(
  async (id) => {
    const user = await db.user.findUnique({ where: { id } })
    return user
  }
)

// 含异步 transform 的 schema 必须用 parseAsync
const user = await UserIdSchema.parseAsync('u_xxx')
// user 的类型是 await 之后的结果类型
```

这让你可以在 parse 过程中顺带把 ID 换成实体对象——不过这种用法要克制，会让 schema 职责变模糊。

## 3. .preprocess()：校验之前先预处理

`.transform()` 是「校验通过后变形」。那如果数据**连校验都过不了**呢？

比如你有一个 query 参数 `?page=2`——HTTP 里它天然是字符串 `"2"`。你想用 `z.number()` 校验，会直接失败。

这时候上 `z.preprocess()`：

index.ts

```typescript
const PageSchema = z.preprocess(
  v => Number(v),     // 第一步：预处理
  z.number().int()    // 第二步：用这个 schema 校验
)

PageSchema.parse('2')    // ✅ 2
PageSchema.parse('abc')  // 💥 Number('abc') 是 NaN，schema 会拒绝
```

两个参数：

- 预处理函数：接收原始输入，返回加工后的值

- 目标 schema：拿加工后的值去校验

### 3.1 preprocess 和 coerce 的关系

你应该记得上一篇讲过 `z.coerce.number()`？

index.ts

```typescript
z.coerce.number()
// 等价于：
z.preprocess(v => Number(v), z.number())
```

**`z.coerce.*` 本质上就是 preprocess 的语法糖**，Zod 内置了几种常见的类型转换。需要更复杂的预处理时就用 preprocess。

### 3.2 什么时候该用 preprocess

preprocess 适合处理「**格式不对，但能修**」的场景：

- 数字字符串 → 数字

- JSON 字符串 → 对象

- `'true'` / `'false'` → 布尔

- 前后有空格的值 → 去空格

一个特别好用的场景——**从环境变量加载 JSON 配置**：

env.ts

```typescript
const FeaturesSchema = z.preprocess(
  v => typeof v === 'string' ? JSON.parse(v) : v,
  z.array(z.enum(['chat', 'rag', 'agent']))
)

// process.env.FEATURES = '["chat","rag"]'
FeaturesSchema.parse(process.env.FEATURES)
// ['chat', 'rag']
```

这类代码在工程化章节里会反复出现，你提前有印象就好。

## 4. .pipe()：把输出接给下一个 schema

`.pipe(nextSchema)` 的含义：**把上一个 schema 的输出，作为下一个 schema 的输入**。

它乍看像是 preprocess 反过来，其实更像一条「流水线」——**把若干个 schema 串起来，每一段处理自己的环节**。

最典型的用法是和 `coerce` 组合：

index.ts

```typescript
const schema = z.string()
  .pipe(z.coerce.number().int().min(0))

// 输入必须先是字符串，然后被 coerce 成数字并校验
schema.parse('42')   // ✅ 42
schema.parse(42)     // 💥 第一段就挂了（不是字符串）
schema.parse('abc')  // 💥 coerce 成 NaN，被 z.number() 拒绝（NaN 不合法）
```

这比 `z.coerce.number()` 多了一道「必须先是字符串」的保护——在 query 参数、环境变量这种**明确知道输入是字符串**的场景里，这个保护很有用。

### 4.1 pipe 让 transform 后还能继续校验

transform 后你拿到的是加工后的新类型，但这个新类型**还没被校验过**。用 pipe 可以接着校验：

index.ts

```typescript
const NormalizedEmail = z.string()
  .transform(s => s.trim().toLowerCase())   // 第一步：清洗
  .pipe(z.string().email())                 // 第二步：校验清洗后的结果
```

没有 pipe 的话，你的 transform 只能假设输入合法；有了 pipe，你可以**先变形、再基于变形后的值做严格校验**。这是 transform + pipe 最常见的搭档模式。

### 4.2 pipe vs preprocess 的心智差别

这两个方法从效果上看很像，但方向不同：

| 方法 | 心智 |
| --- | --- |
| z.preprocess(fn, schema) | 从外部灌一个修复函数进来 |
| schema.pipe(nextSchema) | 像 Linux 管道一样，一段输出接一段输入 |

日常推荐选择：

- 只是想做**类型转换**（string → number） → 用 `z.coerce.*`

- 需要**自定义的预处理逻辑** → 用 `z.preprocess()`

- 想**把 transform 的输出继续校验** → 用 `.transform().pipe()`

- 想**把几个独立 schema 串成流水线** → 用 `.pipe()`

## 5. input 类型和 output 类型不一样了

前面的例子里，有一个概念一直在偷偷出现：**输入类型和输出类型可能不同**。我们把它说清。

`z.infer<typeof schema>` 默认给你的是**输出类型**，但 Zod 其实维护了两个：

index.ts

```typescript
type In  = z.input<typeof schema>   // parse 能接受的类型
type Out = z.output<typeof schema>  // parse 返回的类型
// z.infer<T> 是 z.output<T> 的别名
```

几个例子：

index.ts

```typescript
const A = z.string()
// input: string, output: string

const B = z.string().default('anon')
// input: string | undefined, output: string

const C = z.string().transform(s => s.length)
// input: string, output: number

const D = z.preprocess(v => Number(v), z.number())
// input: unknown, output: number

const E = z.coerce.number()
// input: unknown, output: number
```

**什么时候你需要关心这两个类型的差别？** 主要是接口场景：

- 定义请求体类型时，你要的是 `z.input<>`（前端发过来的原始形态）

- 定义业务函数参数时，你要的是 `z.output<>`（parse 后的成熟形态）

举个接口例子：

index.ts

```typescript
const CreatePostSchema = z.object({
  title: z.string(),
  tags: z.string().transform(s => s.split(',').map(t => t.trim())),
  publishAt: z.coerce.date().default(() => new Date()),
})

// 前端要发的 JSON 长这样：
type CreatePostRequest = z.input<typeof CreatePostSchema>
// { title: string; tags: string; publishAt?: string | number | Date | undefined }

// 业务函数内部拿到的对象长这样：
type CreatePost = z.output<typeof CreatePostSchema>
// { title: string; tags: string[]; publishAt: Date }
```

**input 是给外面用的契约，output 是给内部用的结果。** 一旦 schema 里出现了 `default / transform / coerce`，这两个类型就一定会不一样。

第 10 篇会专门讲这三者的完整关系，这里你先建立印象就行。

## 6. 常见实战模式

把这一篇学的东西整理成几个可以直接抄的模式。

### 6.1 字符串清洗 + 严格校验

index.ts

```typescript
const CleanEmail = z.string()
  .transform(s => s.trim().toLowerCase())
  .pipe(z.string().email())
```

### 6.2 CSV 字符串转数组

index.ts

```typescript
const TagsFromCsv = z.string()
  .transform(s => s.split(',').map(t => t.trim()).filter(Boolean))
  .pipe(z.array(z.string().min(1)))
```

### 6.3 环境变量 JSON 解析

index.ts

```typescript
const JsonConfig = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    v => typeof v === 'string' ? JSON.parse(v) : v,
    schema
  )

const Features = JsonConfig(z.array(z.string()))
Features.parse('["chat","rag"]')  // ['chat', 'rag']
```

这个泛型工厂函数在环境变量校验里非常好用。

### 6.4 LLM 返回的代码围栏剥离

LLM 经常把 JSON 包在 ````json ... ```` 代码围栏里返回，我们一边剥壳一边校验：

index.ts

```typescript
const stripFence = (s: string) =>
  s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

const LLMJsonSchema = <T extends z.ZodTypeAny>(shape: T) =>
  z.string()
    .transform(stripFence)
    .transform(s => JSON.parse(s))
    .pipe(shape)

// 用法：
const AnalysisSchema = LLMJsonSchema(z.object({
  summary: z.string(),
  keywords: z.array(z.string()),
}))

AnalysisSchema.parse('```json\n{"summary":"hi","keywords":["a"]}\n```')
// { summary: 'hi', keywords: ['a'] }
```

这套模式在做 Structured Output 时会反复用到，第 13 篇会专门展开。

## 7. 陷阱清单

| 场景 | 错误做法 | 正确做法 |
| --- | --- | --- |
| 在 transform 里做校验 | throw new Error | 用 .refine() 或内置方法 |
| transform 后还想校验加工结果 | 什么都不做 | 加 .pipe(nextSchema) |
| 以为 z.input<> 和 z.output<> 永远一样 | 直接用 z.infer<> | 遇到 default/transform/coerce 时要分清 |
| 用 preprocess 做简单类型转换 | 手写 preprocess | 优先用 z.coerce.* |
| transform 返回 Promise 却用 parse | 同步 parse 会报错 | 改用 parseAsync / safeParseAsync |
| 用 transform 做数据库查询 | 让 schema 同时承担 I/O | schema 只做纯函数变形，I/O 放 refine 或业务层 |

最后一条尤其重要：**transform 最好保持纯函数**。涉及 I/O、副作用的事情放到业务层去做，schema 只负责「从一个值变成另一个值」。

## 8. 总结

这一篇带你看见了 Zod 的另一面：**它不只是质检员，还可以是流水线**。

- **`.transform()`** — 校验之后变形，是「加工工序」

- **`z.preprocess()`** — 校验之前预处理，适合「格式不对但能修」的情况

- **`.pipe()`** — 把上一个 schema 的输出接给下一个，串流水线

- **input vs output** — 一旦出现 default / transform / coerce，parse 前后的类型就可能不同

一张选择表：

| 你想做的事 | 用什么 |
| --- | --- |
| 清洗字符串（trim、toLowerCase） | .transform() |
| 字符串转数字、日期 | z.coerce.* |
| 自定义的预处理（带条件逻辑） | z.preprocess() |
| 变形后再严格校验 | .transform().pipe() |
| 几个 schema 串成流水线 | .pipe() |

一句话带走：

NOTE

**Zod 不只告诉你「数据对不对」——它还能把「原始输入」变成「你真正要用的形态」，而且一路保持类型安全。**

下一篇是进阶篇最后一篇——《类型推导：z.infer / z.input / z.output》。我们会正面把这三个类型工具讲透，以及它们在真实项目里应该怎么用、怎么导出给别的模块。这一篇会把你从「能写 schema」正式推进到「能设计 schema 架构」。
