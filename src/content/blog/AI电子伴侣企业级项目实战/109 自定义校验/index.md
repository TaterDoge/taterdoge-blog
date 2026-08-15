---
title: "109 自定义校验"
pubDate: 2026-05-15
description: "到目前为止，我们见到的校验规则都是单个字段独立的：长度够不够、格式对不对、值在不在枚举里。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/8-refine-and-superrefine/](https://aicompanion.usehook.cn/8-refine-and-superrefine/)

## 1. 当内置校验不够用时

到目前为止，我们见到的校验规则都是**单个字段独立**的：长度够不够、格式对不对、值在不在枚举里。

但真实业务里很多规则靠内置方法表达不出来：

- 「确认密码」必须和「密码」一致

- `endDate` 必须晚于 `startDate`

- `maxTokens` 不能超过所选模型的上限

- 角色是 `admin` 时，`department` 字段必须填

- 一个聊天会话的 `messages` 必须以 `system` 或 `user` 开头

这些规则有一个共同点：**它们描述的是「数据之间的关系」或「业务层面的约束」，而不是单个字段的形状**。

Zod 给这类场景专门准备了两个方法：

index.ts

```typescript
.refine(fn, options?)       // 自定义单个条件
.superRefine((data, ctx) => { ... })  // 多错误 + 精细控制
```

这一篇我们把这两个方法吃透——它们是 Zod 从「描述数据形状」进化到「描述业务规则」的分水岭。

## 2. .refine()：最常用的自定义校验

`.refine(fn)` 接收一个返回 `boolean` 的函数：返回 `true` 表示通过，`false` 表示不通过。

index.ts

```typescript
const PasswordSchema = z.string().refine(
  s => s.length >= 8,
  { message: '密码至少 8 位' }
)

PasswordSchema.parse('1234567')     // 💥 密码至少 8 位
PasswordSchema.parse('12345678')    // ✅
```

`.refine()` 的函数参数就是**上一层校验通过后的数据**。上面这个例子里，`s` 的类型就是 `string`——这一点很重要：

NOTE

**`.refine()` 是在内置校验之后运行的。如果前置校验没过，refine 根本不会执行。**

所以你可以在 `.refine()` 里放心地把参数当成「已经是正确类型」来用。

### 2.1 简写形式

如果只是想给错误信息，第二个参数可以直接传字符串：

index.ts

```typescript
z.string().refine(s => s.length >= 8, '密码至少 8 位')
```

两种写法效果一样。对象形式的好处是还能配 `path` 和 `params`（下一节讲）。

### 2.2 异步 refine

`.refine()` 的函数也可以是 `async`：

index.ts

```typescript
const UsernameSchema = z.string().refine(
  async (name) => {
    const exists = await db.user.findFirst({ where: { name } })
    return !exists
  },
  { message: '用户名已被占用' }
)

// 含异步 refine 的 schema 必须用 parseAsync / safeParseAsync
await UsernameSchema.parseAsync('alice')
```

这个上一篇讲过，在这里再提一下——`.refine()` 是引入异步校验的主要通道。

## 3. refine 的完整配置：message / path / params

`.refine()` 的第二个参数完整形式长这样：

index.ts

```typescript
.refine(fn, {
  message: '错误信息',
  path: ['confirmPassword'],  // 错误归属到哪个字段
  params: { code: 'PASSWORD_WEAK' },  // 任意附加数据
})
```

最关键的是 `path`，它在「跨字段校验」里**必不可少**。我们马上看它怎么用。

## 4. 跨字段校验：refine 最常见的用法

**把 refine 加在 object 外层**，就能访问多个字段：

register-schema.ts

```typescript
const RegisterSchema = z.object({
  password: z.string().min(8),
  confirmPassword: z.string(),
}).refine(
  data => data.password === data.confirmPassword,
  {
    message: '两次输入的密码不一致',
    path: ['confirmPassword'],  // 错误挂到 confirmPassword 字段上
  }
)
```

这里 `data` 的类型是 `{ password: string; confirmPassword: string }`，你可以对任意字段做判断。

### 4.1 path 为什么重要

看一下**没有 path** 的效果：

index.ts

```typescript
// 没有 path：错误挂在对象根上
const r = RegisterSchema.safeParse({ password: 'abcd1234', confirmPassword: 'xxxx' })
console.log(r.error?.issues)
// [{ path: [], message: '两次输入的密码不一致' }]
```

前端拿到这种错误，**没办法定位到具体输入框**——因为 `path` 是空的。

加了 `path: ['confirmPassword']`：

index.ts

```typescript
// [{ path: ['confirmPassword'], message: '两次输入的密码不一致' }]
```

前端就能把错误显示在「确认密码」那个输入框下。这是所有表单 UI 库（react-hook-form、formik）依赖的基础约定。

**原则：跨字段校验的 `path` 一定要指向「用户能理解的出错字段」。**

### 4.2 日期范围校验

date-range.ts

```typescript
const DateRangeSchema = z.object({
  startDate: z.date(),
  endDate: z.date(),
}).refine(
  data => data.endDate > data.startDate,
  {
    message: '结束日期必须晚于开始日期',
    path: ['endDate'],
  }
)
```

模式一模一样：object schema + refine 外层 + path 指向重点字段。

## 5. .superRefine()：多错误、更精细

`.refine()` 一次只能报**一个错误**，且错误 code 固定是 `custom`。真实业务里你可能需要：

- 一份数据有多个问题，要一次性全部报给用户

- 需要用不同的错误 code 区分不同问题

- 条件满足时**提前中止**后续校验

这时候就该用 `.superRefine()`。它的函数签名是 `(data, ctx) => void`：

index.ts

```typescript
const schema = z.object({
  password: z.string(),
}).superRefine((data, ctx) => {
  const pwd = data.password

  if (pwd.length < 8) {
    ctx.addIssue({
      code: 'custom',
      path: ['password'],
      message: '密码至少 8 位',
    })
  }
  if (!/[A-Z]/.test(pwd)) {
    ctx.addIssue({
      code: 'custom',
      path: ['password'],
      message: '密码必须包含大写字母',
    })
  }
  if (!/\d/.test(pwd)) {
    ctx.addIssue({
      code: 'custom',
      path: ['password'],
      message: '密码必须包含数字',
    })
  }
})
```

传入一个只有小写字母的密码，这个 schema 会一次性报**三条**错误，而不是报完第一条就停。

### 5.1 ctx 的常用方法

| 方法 | 作用 |
| --- | --- |
| ctx.addIssue({ code, path, message }) | 加一个错误，但继续后面的逻辑 |
| ctx.addIssue({ ..., fatal: true }) + return z.NEVER | 加错误并终止后续 refine |
| ctx.path | 当前 refine 所在路径（在嵌套校验里有用） |

`fatal + z.NEVER` 的典型用法是「前置条件挂了就没必要继续查」：

index.ts

```typescript
.superRefine((data, ctx) => {
  if (!data.userId) {
    ctx.addIssue({
      code: 'custom',
      path: ['userId'],
      message: 'userId 必填',
      fatal: true,
    })
    return z.NEVER
  }

  // 下面这段只有在 userId 合法时才执行
  if (data.userId.length !== 36) {
    ctx.addIssue({ ... })
  }
})
```

### 5.2 条件必填

superRefine 非常适合做「A 字段满足某条件时，B 字段必填」这类动态规则：

index.ts

```typescript
const UserSchema = z.object({
  role: z.enum(['admin', 'user']),
  department: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.role === 'admin' && !data.department) {
    ctx.addIssue({
      code: 'custom',
      path: ['department'],
      message: '管理员必须填写所属部门',
    })
  }
})
```

这种规则用 TS 的联合类型也能表达，但**运行时必须有人来检查它**——`superRefine` 就是这个角色。

## 6. refine vs superRefine 怎么选

两种方法能做的事有重叠，但各自擅长的场景不同：

| 你的需求 | 用哪个 |
| --- | --- |
| 一次只判断一个条件，一次只报一个错 | .refine() |
| 错误要挂在另一个字段上（跨字段） | .refine() + path |
| 同一个字段有多条校验规则，想全报出来 | .superRefine() |
| 需要用不同的错误 code | .superRefine() |
| 有前置依赖（A 错了不用查 B） | .superRefine() + fatal |
| 异步校验（查数据库） | .refine(async (v) => ...) |

日常 80% 的场景用 `.refine()` 就够，`.superRefine()` 是留给那 20% 复杂业务规则的。**不要一上来就 superRefine**——它更灵活，但也更啰嗦。

## 7. 实战：AI 场景的业务规则

我们用三个 AI 项目里真实会遇到的规则，把这一篇的东西串起来。

### 7.1 messages 必须以 system 或 user 开头

这是 OpenAI 和 Anthropic 的通用约束：

index.ts

```typescript
const ChatRequest = z.object({
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  })).min(1),
}).refine(
  data => {
    const first = data.messages[0].role
    return first === 'system' || first === 'user'
  },
  {
    message: '对话必须以 system 或 user 消息开头',
    path: ['messages', 0],  // 指向第一条消息
  }
)
```

注意 `path: ['messages', 0]`——它指向**数组的第一个元素**，这是 Zod path 的标准表达。

### 7.2 maxTokens 不能超过模型上限

不同模型有不同的 context window，这是一个经典的「跨字段 + 外部知识」规则：

index.ts

```typescript
const MODEL_LIMITS: Record<string, number> = {
  'claude-opus-4-6': 200000,
  'claude-haiku-4-5': 200000,
  'gpt-4o': 128000,
}

const ChatRequest = z.object({
  model: z.enum(['claude-opus-4-6', 'claude-haiku-4-5', 'gpt-4o']),
  maxTokens: z.number().int().positive(),
}).refine(
  data => data.maxTokens <= MODEL_LIMITS[data.model],
  data => ({
    message: `${data.model} 的 maxTokens 上限是 ${MODEL_LIMITS[data.model]}`,
    path: ['maxTokens'],
  })
)
```

这里第二个参数是**一个函数**，可以根据数据动态生成错误信息——这是 refine 的一个小技巧。

### 7.3 工具调用的参数必须匹配工具声明

一个更复杂的例子——前面还不合法，后面没必要校验。用 `superRefine` + `fatal`：

index.ts

```typescript
const TOOL_ARG_SCHEMAS: Record<string, z.ZodTypeAny> = {
  search: z.object({ query: z.string().min(1), topK: z.number().int().min(1) }),
  fetch:  z.object({ url: z.string().url() }),
}

const ToolCallSchema = z.object({
  name: z.string(),
  args: z.record(z.unknown()),
}).superRefine((data, ctx) => {
  const argSchema = TOOL_ARG_SCHEMAS[data.name]
  if (!argSchema) {
    ctx.addIssue({
      code: 'custom',
      path: ['name'],
      message: `未知工具：${data.name}`,
      fatal: true,
    })
    return z.NEVER
  }

  const result = argSchema.safeParse(data.args)
  if (!result.success) {
    result.error.issues.forEach(issue => {
      ctx.addIssue({
        code: 'custom',
        path: ['args', ...issue.path],
        message: issue.message,
      })
    })
  }
})
```

这个例子有三个亮点：

- 用 `fatal + z.NEVER` 在「未知工具名」时提前中止

- 把 `argSchema.safeParse` 的结果**转发**进 `ctx.addIssue`——这是「组合 schema」的常见模式

- `path` 用展开运算拼接：既保留「是 `args` 下出的错」，又保留内部具体路径

日后你写 Agent、MCP、插件系统时，这个模式会反复出现。

## 8. 总结

这一篇我们从 Zod 的「描述形状」推进到了「描述规则」：

- **`.refine()`** — 单条件校验，写法直观，配 `path` 支持跨字段

- **`.superRefine()`** — 多错误、自定义 code、fatal 中止，适合复杂业务规则

- **核心原则**：refine 只在前置校验通过后运行，函数参数的类型已经被 Zod 收窄

- **path 不是装饰**——它决定了错误在前端或日志里被挂到哪里，表单类场景尤其关键

一张能带走的选择表：

| 场景 | 方法 |
| --- | --- |
| 「值必须满足 xxx」 | .refine(v => xxx) |
| 「A 字段必须等于/大于 B 字段」 | .refine(data => ..., { path: [...] }) |
| 「同一字段多条规则都要报」 | .superRefine() 多个 addIssue |
| 「前置挂了后面不用查」 | .superRefine() + fatal + z.NEVER |
| 「查数据库再决定」 | .refine(async) + parseAsync |

一句话带走：

NOTE

**refine 让 schema 从「是什么类型」进化到「符合什么规则」——而规则里才藏着真正的业务。**

下一篇我们讲 Zod 另一个让新手开眼的能力——**`transform`**：不仅校验数据，还能在 parse 过程中把它变成你真正想要的形态。
