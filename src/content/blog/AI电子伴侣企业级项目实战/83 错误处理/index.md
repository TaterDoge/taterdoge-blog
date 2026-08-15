---
title: "83 错误处理"
pubDate: 2026-05-08
description: "当 findUser 返回 undefined 时，代码抛出 TypeError: Cannot read properties of undefined。Hono 默认会返回一个 500 状态码的纯文本响应："
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/8-error-handling/](https://aicompanion.usehook.cn/8-error-handling/)

## 1. 不做错误处理会怎样

先看一个没有任何错误处理的路由：

index.ts

```typescript
app.get('/users/:id', (c) => {
  const user = findUser(c.req.param('id'))
  // findUser 返回 undefined，直接访问 .name 会炸
  return c.json({ name: user.name })
})
```

当 `findUser` 返回 `undefined` 时，代码抛出 `TypeError: Cannot read properties of undefined`。Hono 默认会返回一个 500 状态码的纯文本响应：

response.txt

```txt
Internal Server Error
```

前端拿到的就是这么一行字。没有 JSON，没有错误码，没有任何有用信息。前端开发者没法根据这个做任何有意义的错误提示。

这里先建立一个最重要的判断：

- **能正常返回结果**：用 `return c.json(...)`

- **遇到异常情况，需要中断当前流程**：用 `throw`

也就是说，错误处理这篇文章讨论的核心，不是"怎么返回数据"，而是"当流程不能继续时，怎么把错误用一种统一、可控的方式抛出去"。

## 2. HTTPException：Hono 内置的错误类

Hono 提供了 `HTTPException`，用来抛出带状态码的 HTTP 错误：

index.ts

```typescript
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'

const app = new Hono()

app.get('/users/:id', (c) => {
  const user = findUser(c.req.param('id'))
  if (!user) {
    throw new HTTPException(404, { message: 'User not found' })
  }
  return c.json(user)
})
```

抛出 `HTTPException` 后，Hono 会把它当成一个"带 HTTP 状态码的错误"来处理。最基础的情况下，它可以直接生成对应状态码的响应。比起让代码自然报错变成 500，这种方式能精确告诉前端「到底出了什么问题」。

`HTTPException` 的构造函数接收两个参数：

- 第一个是 HTTP 状态码（`400`、`401`、`403`、`404`、`500` 等）

- 第二个是选项对象，`message` 字段是错误描述

对新手来说，可以先这样理解：`HTTPException` 就是普通 `Error` 的 HTTP 版本。普通 `Error` 只会说"出错了"，`HTTPException` 还会顺便告诉框架"这次应该返回 404 还是 401"。

## 3. app.onError：全局错误处理器

每个路由里都写 try-catch 太啰嗦。用 `app.onError` 注册一个全局错误处理器，所有路由里抛出的错误都会走到这里：

index.ts

```typescript
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'

const app = new Hono()

app.onError((err, c) => {
  // HTTPException：业务主动抛出的错误，返回对应状态码
  if (err instanceof HTTPException) {
    return c.json(
      { success: false, error: err.message },
      err.status
    )
  }

  // 其他错误：代码 bug 或未预期的异常
  console.error(err)
  return c.json(
    { success: false, error: 'Internal Server Error' },
    500
  )
})
```

这里顺手补一个认知：`app.onError` 只会处理**抛出来**的错误。也就是说：

- `throw new HTTPException(...)` 会进入 `app.onError`

- `return c.json(...)` 不会进入 `app.onError`，因为那已经是一次正常响应了

这也是为什么很多项目会把"业务失败"统一写成 `throw`，这样所有错误都能汇总到一个地方处理。

这样做的好处：

- 所有错误响应格式统一，前端只需要处理一种结构

- `HTTPException` 和普通异常分开处理，业务错误返回具体信息，代码 bug 返回通用提示（不暴露内部细节）

- 路由处理函数里只管抛错，不用操心响应格式

## 4. app.notFound：自定义 404 响应

当请求的路径没有匹配到任何路由时，Hono 默认返回 `404 Not Found` 纯文本。用 `app.notFound` 可以自定义这个响应：

index.ts

```typescript
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: 'Not Found',
      path: c.req.path,
    },
    404
  )
})
```

注意 `app.notFound` 和 `HTTPException(404)` 的区别：

- `app.notFound`：路径压根没匹配到路由，请求连路由处理函数都没进

- `HTTPException(404)`：路径匹配到了路由，但业务逻辑判断资源不存在（比如用户 ID 在数据库里查不到）

另外要注意，`app.notFound` 是给**顶层 app** 兜底用的。你可以把它理解成"整个应用最后的 404 出口"，而不是某个单独路由模块内部的业务判断逻辑。

## 5. 自定义错误类

实际项目中，光靠 `HTTPException` 不够细。你可能需要区分认证失败、参数校验失败、权限不足等不同类型的业务错误。

可以继承 `HTTPException` 做分类：

errors.ts

```typescript
import { HTTPException } from 'hono/http-exception'

// 认证错误
export class AuthError extends HTTPException {
  constructor(message = 'Unauthorized') {
    super(401, { message })
  }
}

// 参数校验错误
export class ValidationError extends HTTPException {
  public details: Record<string, string[]>

  constructor(
    message: string,
    details: Record<string, string[]> = {}
  ) {
    super(400, { message })
    this.details = details
  }
}

// 权限不足
export class ForbiddenError extends HTTPException {
  constructor(message = 'Forbidden') {
    super(403, { message })
  }
}
```

路由里使用：

index.ts

```typescript
import { AuthError, ValidationError } from './errors'

app.post('/articles', async (c) => {
  const token = c.req.header('Authorization')
  if (!token) {
    throw new AuthError('Missing token')
  }

  const body = await c.req.json()
  if (!body.title) {
    throw new ValidationError('Validation failed', {
      title: ['title is required'],
    })
  }

  // 正常业务逻辑...
  return c.json({ success: true, data: body }, 201)
})
```

然后在全局错误处理器里针对不同类型做处理：

index.ts

```typescript
app.onError((err, c) => {
  if (err instanceof ValidationError) {
    return c.json(
      {
        success: false,
        error: err.message,
        code: 'VALIDATION_ERROR',
        details: err.details,
      },
      err.status
    )
  }

  if (err instanceof HTTPException) {
    return c.json(
      { success: false, error: err.message },
      err.status
    )
  }

  console.error(err)
  return c.json(
    { success: false, error: 'Internal Server Error' },
    500
  )
})
```

注意 `ValidationError` 的判断要放在 `HTTPException` 前面，因为 `ValidationError` 继承自 `HTTPException`，反过来写的话 `instanceof HTTPException` 会先匹配到。

## 6. 统一错误响应格式

把错误响应格式定义清楚，前后端约定好：

types.ts

```typescript
// 统一错误响应结构
interface ErrorResponse {
  success: false
  error: string
  code?: string
  details?: Record<string, string[]>
}

// 统一成功响应结构
interface SuccessResponse<T> {
  success: true
  data: T
}
```

封装一个工具函数，让响应构造更简洁：

response.ts

```typescript
import type { Context } from 'hono'

export const success = <T>(c: Context, data: T, status = 200) => {
  return c.json({ success: true, data }, status)
}

export const error = (
  c: Context,
  message: string,
  status = 400,
  code?: string
) => {
  return c.json({ success: false, error: message, code }, status)
}
```

这里用普通 `number` 做状态码参数就够用了。对新手教学来说，这样更直观，也避免一上来引入额外的类型细节。

路由里用起来就很清爽：

index.ts

```typescript
import { success } from './response'

app.get('/users/:id', (c) => {
  const user = findUser(c.req.param('id'))
  if (!user) {
    throw new HTTPException(404, { message: 'User not found' })
  }
  return success(c, user)
})
```

## 7. 和 zValidator 校验错误的配合

如果你用了 `@hono/zod-validator` 做请求校验（前面章节介绍过），校验失败默认返回 400 状态码和校验错误详情。但默认格式可能跟你的统一格式不一致。

可以通过 `hook` 参数把校验失败也接入统一的错误处理：

index.ts

```typescript
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'

const createUserSchema = z.object({
  name: z.string().min(1, 'name is required'),
  email: z.string().email('invalid email'),
})

app.post(
  '/users',
  zValidator('json', createUserSchema, (result, c) => {
    if (!result.success) {
      // 校验失败，抛 HTTPException 走全局错误处理
      throw new HTTPException(400, {
        message: 'Validation failed',
      })
    }
  }),
  (c) => {
    const data = c.req.valid('json')
    return c.json({ success: true, data }, 201)
  }
)
```

`zValidator` 的第三个参数是一个 hook 函数，在校验完成后调用。`result.success` 为 `false` 时表示校验失败，这时抛出 `HTTPException` 就能走到 `app.onError`，保持所有错误响应格式一致。

这个设计背后的思路很值得记住：**谁发现错误，谁可以先把错误整理好，再统一抛给全局错误处理器。**

这样路由本身就不用关心"校验失败时响应长什么样"，它只关心"数据已经合法了，可以继续写业务逻辑"。

如果你想带上具体的字段错误信息，可以用前面定义的 `ValidationError`：

index.ts

```typescript
import { ValidationError } from './errors'

app.post(
  '/users',
  zValidator('json', createUserSchema, (result, c) => {
    if (!result.success) {
      const details: Record<string, string[]> = {}
      result.error.issues.forEach((issue) => {
        const key = issue.path.join('.')
        if (!details[key]) details[key] = []
        details[key].push(issue.message)
      })
      throw new ValidationError('Validation failed', details)
    }
  }),
  (c) => {
    const data = c.req.valid('json')
    return c.json({ success: true, data }, 201)
  }
)
```

这样前端收到的校验错误响应长这样：

response.json

```json
{
  "success": false,
  "error": "Validation failed",
  "code": "VALIDATION_ERROR",
  "details": {
    "name": ["name is required"],
    "email": ["invalid email"]
  }
}
```

前端可以直接把 `details` 里的信息映射到对应的表单字段上，体验非常好。

## 8. 总结

错误处理的核心就三件事：用 `HTTPException` 抛业务错误，用 `app.onError` 统一捕获，用 `app.notFound` 处理 404。在此基础上，自定义错误类做分类，统一响应格式让前端好对接。

下一篇聊认证与鉴权——怎么用中间件实现 JWT 验证和权限控制。
