---
title: "173、 LLM 配置化"
pubDate: 2026-06-08
description: "把聊天所用 LLM 配置从系统环境变量拆出来，支持用户侧本地配置、后端校验、回退策略和安全边界。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/38-llm-configuration/](https://aicompanion.usehook.cn/38-llm-configuration/)

## 1. 背景

项目最开始调通 LLM 的方式很直接：在 api 子站的环境变量里配置 DeepSeek。

apps/api/.dev.vars

```txt
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
```

这种方式适合本地开发和平台统一供给模型能力。但如果产品要支持用户自己接入三方 LLM，就会遇到一个新问题：用户可能想填自己的 OpenAI、DeepSeek、Moonshot、硅基流动、OpenRouter 或其他兼容 OpenAI Chat Completions 协议的服务。

我们希望用户可以在 web 端个人中心配置自己的 LLM，并且优先支持 OpenAI-compatible 接口，也就是 `/chat/completions` 这一类协议。用户的 API Key 不保存到后端数据库，聊天时优先使用用户自己的配置；如果用户没有配置，系统继续回退到平台侧 DeepSeek 配置。

这篇文章会按当前项目里的真实实现，把这条链路完整拆开。

## 2. 设计原则

这次实现最重要的原则是：**用户 API Key 不落库**。

也就是说，我们不会新增 D1 表，也不会把 API Key 写入用户 profile，更不会把它作为用户资料同步到后端。

当前采用的方案是把 API Key 只保存在当前浏览器的 `localStorage`。用户开启本地 LLM 配置后，聊天请求会临时带上这份配置，api 子站只在本次请求里使用它转发到三方 LLM，不会保存 API Key，也不会把 API Key 写入日志。

这里需要讲清楚一个边界：API Key 虽然不落库，但聊天时仍然会从浏览器发送到我们自己的 api 子站，由 api 子站代理调用三方 LLM。它不是 **永远不离开浏览器**，而是 **只在请求级别临时使用，不持久化**。

如果要做到完全不经过 api 子站，就需要前端直接请求三方 LLM。但那会遇到 CORS、流式协议适配、密钥暴露范围和不同服务商差异等问题。当前方案是在产品可控性和用户密钥持久化风险之间做的折中。

## 3. 整体流程

整个链路可以画成这样：

index.txt

```txt
用户在个人中心填写 LLM 配置
        ↓
web 端保存到 localStorage
        ↓
用户打开首页聊天框并发送消息
        ↓
聊天 transport 读取本地 LLM 配置
        ↓
请求 api 子站 /rpc/chat/inbox
        ↓
api 子站校验 web access token
        ↓
如果请求里带了 llmConfig，优先使用用户配置
        ↓
否则回退平台 DeepSeek 环境变量
        ↓
api 子站请求 {baseURL}/chat/completions
        ↓
读取 OpenAI-compatible SSE 流
        ↓
转换成纯文本流返回给前端
        ↓
前端继续逐字展示
```

这条链路里，真正需要改的地方主要有四块。`contracts` 要让聊天请求支持可选 `llmConfig`；`web` 要在个人中心保存本地配置，也要在聊天发送时临时带上本地配置和登录 token；`api` 则要让聊天接口优先使用请求里的 LLM 配置。

## 4. 扩展聊天请求契约

前后端共用的请求结构放在 contracts 包里。我们先给聊天请求增加一个可选的 `llmConfig`。

inbox-chat.contract.ts

```typescript
// packages/contracts/src/chat/inbox-chat.contract.ts
import { z } from 'zod'

const InboxChatPartSchema = z.object({
  type: z.string().min(1),
}).passthrough()

export const InboxChatMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['user', 'assistant']),
  parts: z.array(InboxChatPartSchema).min(1).max(50),
})

export const InboxChatLlmConfigSchema = z.object({
  providerName: z.string().trim().min(1).max(80).optional(),
  baseURL: z.string().trim().url().max(300),
  apiKey: z.string().trim().min(1).max(400),
  model: z.string().trim().min(1).max(120),
})

export const InboxChatRequestSchema = z.object({
  messages: z.array(InboxChatMessageSchema).min(1).max(20),
  llmConfig: InboxChatLlmConfigSchema.optional(),
  conversation: z.object({
    name: z.string().min(1).max(120),
    handle: z.string().min(1).max(120),
    headline: z.string().min(1).max(200),
    lastActive: z.string().min(1).max(80),
    status: z.string().min(1).max(80),
    relationship: z.string().min(1).max(120),
    topic: z.string().min(1).max(120),
    chemistry: z.string().min(1).max(80),
    chemistryLabel: z.string().min(1).max(80),
    rhythm: z.string().min(1).max(80),
    profileNote: z.string().min(1).max(2000),
  }),
})

export type InboxChatMessage = z.infer<typeof InboxChatMessageSchema>
export type InboxChatLlmConfig = z.infer<typeof InboxChatLlmConfigSchema>
export type InboxChatRequest = z.infer<typeof InboxChatRequestSchema>
```

这里的 `llmConfig` 是可选的。这样可以保留原来的平台默认 LLM 能力：用户没有配置自己的 LLM 时，请求结构仍然合法。

这几个字段的含义都比较直观。`providerName` 是展示用名称，比如 `OpenAI`、`DeepSeek`、`OpenRouter`；`baseURL` 是 OpenAI-compatible 服务地址，比如 `https://api.openai.com/v1`；`apiKey` 是用户自己的 API Key；`model` 是模型名，比如 `gpt-4o-mini`、`deepseek-chat`。

导出时也要把新 schema 和类型暴露出去。

index.ts

```typescript
// packages/contracts/src/index.ts
export {
  InboxChatMessageSchema,
  InboxChatLlmConfigSchema,
  InboxChatRequestSchema,
} from './chat/inbox-chat.contract'

export type {
  InboxChatMessage,
  InboxChatLlmConfig,
  InboxChatRequest,
} from './chat/inbox-chat.contract'
```

## 5. 本地保存 LLM 配置

因为用户明确要求 API Key 不存到后端，所以我们用浏览器 `localStorage` 保存。

代码放在：

index.txt

```txt
apps/web/src/auth/local-llm-config.ts
```

完整实现如下：

local-llm-config.ts

```typescript
// apps/web/src/auth/local-llm-config.ts
"use client"

import type { InboxChatLlmConfig } from "@repo/contracts"

const storageKey = "web:local-llm-config"
const localLlmConfigChangedEventName = "web-local-llm-config-changed"

export type LocalLlmConfig = InboxChatLlmConfig & {
  enabled: boolean
}

function canUseStorage() {
  return typeof window !== "undefined"
}

function notifyLocalLlmConfigChanged() {
  if (canUseStorage()) {
    window.dispatchEvent(new Event(localLlmConfigChangedEventName))
  }
}

function normalizeConfig(input: LocalLlmConfig): LocalLlmConfig {
  return {
    enabled: input.enabled,
    providerName: input.providerName?.trim() || "OpenAI Compatible",
    baseURL: input.baseURL.trim().replace(/\/$/, ""),
    model: input.model.trim(),
    apiKey: input.apiKey.trim(),
  }
}

export function readLocalLlmConfig(): LocalLlmConfig | null {
  if (!canUseStorage()) {
    return null
  }

  const rawValue = window.localStorage.getItem(storageKey)

  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as LocalLlmConfig

    if (!parsed.apiKey || !parsed.baseURL || !parsed.model) {
      window.localStorage.removeItem(storageKey)
      return null
    }

    return normalizeConfig(parsed)
  } catch {
    window.localStorage.removeItem(storageKey)
    return null
  }
}

export function readEnabledLocalLlmConfig(): InboxChatLlmConfig | null {
  const config = readLocalLlmConfig()

  if (!config?.enabled) {
    return null
  }

  return {
    providerName: config.providerName,
    baseURL: config.baseURL,
    model: config.model,
    apiKey: config.apiKey,
  }
}

export function saveLocalLlmConfig(input: LocalLlmConfig) {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(storageKey, JSON.stringify(normalizeConfig(input)))
  notifyLocalLlmConfigChanged()
}

export function clearLocalLlmConfig() {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.removeItem(storageKey)
  notifyLocalLlmConfigChanged()
}

export { localLlmConfigChangedEventName }
```

这段本地存储逻辑还要把几个边界处理好。`canUseStorage()` 用来判断当前是否在浏览器环境，Next.js 里即使是客户端组件，也要避免在不合适的时机直接访问 `window`。保存前会做一次 `normalizeConfig`，比如去掉 `baseURL` 末尾的 `/`，避免后面拼接接口时出现双斜杠。`readEnabledLocalLlmConfig()` 只在配置开启时返回数据，也就是说，用户可以先保存配置但不启用，聊天时不会使用它。`clearLocalLlmConfig()` 则会直接删除本地存储里的 API Key。

## 6. 个人中心配置入口

个人中心页面中新增了一个 `LLM 接入` 模块。

这个模块里会放启用开关、Provider 输入框、Base URL 输入框、Model 输入框、API Key 密码输入框，以及保存按钮和删除 Key 按钮。

默认配置是：

user-center.tsx

```typescript
function createDefaultLlmConfig(): LocalLlmConfig {
  return {
    enabled: false,
    providerName: "OpenAI Compatible",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: "",
  }
}
```

页面加载后，从本地读取已保存的配置。

user-center.tsx

```typescript
useEffect(() => {
  const savedConfig = readLocalLlmConfig()

  if (savedConfig) {
    setLlmConfig(savedConfig)
  }
}, [])
```

这里没有把读取逻辑直接放在 `useState` 初始化里，是为了避免首屏水合阶段访问浏览器存储带来不稳定行为。

保存逻辑如下：

user-center.tsx

```typescript
function handleSaveLlmConfig() {
  const nextConfig = {
    ...llmConfig,
    providerName: llmConfig.providerName?.trim() || "OpenAI Compatible",
    baseURL: llmConfig.baseURL.trim(),
    model: llmConfig.model.trim(),
    apiKey: llmConfig.apiKey.trim(),
  }

  if (!nextConfig.baseURL || !nextConfig.model || !nextConfig.apiKey) {
    setLlmConfigNotice("请完整填写 Base URL、Model 和 API Key。")
    return
  }

  saveLocalLlmConfig(nextConfig)
  setLlmConfig(nextConfig)
  setLlmConfigNotice(
    nextConfig.enabled
      ? "已保存到当前浏览器，聊天时会优先使用。"
      : "已保存到当前浏览器，开启后聊天才会使用。",
  )
}
```

删除逻辑也很直接：

user-center.tsx

```typescript
function handleClearLlmConfig() {
  clearLocalLlmConfig()
  setLlmConfig(createDefaultLlmConfig())
  setLlmConfigNotice("本地 API Key 已删除。")
}
```

输入框更新时有一个容易踩坑的地方。不要把 `event.currentTarget.value` 放进 `setState` 的 updater 回调里。

错误写法类似这样：

user-center.tsx

```tsx
setLlmConfig((current) => ({
  ...current,
  baseURL: event.currentTarget.value,
}))
```

在 React 的某些执行时机里，updater 执行时 `event.currentTarget` 可能已经是 `null`，会报：

error.txt

```txt
Cannot read properties of null (reading 'value')
```

正确写法是先同步取值：

user-center.tsx

```tsx
onChange={(event) => {
  const value = event.currentTarget.value
  setLlmConfig((current) => ({ ...current, baseURL: value }))
  setLlmConfigNotice("")
}}
```

这个细节虽然小，但在表单里很实用。

## 7. 聊天请求带上配置

首页聊天组件使用的是 AI SDK 的 `TextStreamChatTransport`。

原来只给请求体传了 `conversation`，后来改成使用 `prepareSendMessagesRequest`，在每次发送前动态读取本地配置。

inbox-chat.tsx

```tsx
// apps/web/app/(dashboard)/_components/inbox-chat.tsx
const transport = useMemo(
  () => new TextStreamChatTransport<UIMessage>({
    api: `${getWebClientEnv().NEXT_PUBLIC_API_BASE_URL}/rpc/chat/inbox`,
    prepareSendMessagesRequest({ api, body, messages }) {
      const storedSession = readClientSession()
      const localLlmConfig = readEnabledLocalLlmConfig()

      return {
        api,
        headers: storedSession
          ? { authorization: `Bearer ${storedSession.accessToken}` }
          : undefined,
        body: {
          ...body,
          messages,
          conversation,
          ...(localLlmConfig ? { llmConfig: localLlmConfig } : {}),
        },
      }
    },
  }),
  [conversation],
)
```

这里做了两件事。我们需要显式补上 `Authorization` 请求头，因为聊天 transport 不走项目里封装的 `http` 模块，所以不会自动带 access token。如果不在这里补，后端加了鉴权以后，聊天接口会返回未登录。除此之外，还要读取当前启用的本地 LLM 配置。

inbox-chat.tsx

```typescript
const localLlmConfig = readEnabledLocalLlmConfig()
```

如果配置存在且开启，就把它放入请求体：

inbox-chat.tsx

```typescript
...(localLlmConfig ? { llmConfig: localLlmConfig } : {})
```

如果用户没有开启本地 LLM 配置，请求里就不会有 `llmConfig` 字段，后端自然回退到平台配置。

## 8. 后端校验登录态

既然聊天接口现在可能临时携带用户 API Key，那么这个接口就不能裸奔。

api 子站新增了 web access token 校验：

inbox.route.ts

```typescript
// apps/api/src/routes/chat/inbox.route.ts
async function requireWebAccessToken(c: Context<{ Bindings: ApiBindings }>) {
  const authorization = c.req.header('authorization')

  if (!authorization?.startsWith('Bearer ')) {
    throw authUnauthorizedError('Access token is required')
  }

  const token = authorization.slice('Bearer '.length).trim()

  if (!token) {
    throw authUnauthorizedError('Access token is required')
  }

  const env = getApiEnv(c.env)

  try {
    return await verifyAccessToken({
      token,
      secret: env.JWT_ACCESS_SECRET,
      expectedApp: 'web',
    })
  } catch {
    throw authUnauthorizedError('Access token is invalid')
  }
}
```

然后在聊天路由开头调用：

inbox.route.ts

```typescript
await requireWebAccessToken(c)
```

这样只有已登录的 web 用户才能请求聊天代理接口。

## 9. 后端选择 LLM 配置

后端需要同时支持两种来源：请求体里的用户本地 LLM 配置，以及平台环境变量里的 DeepSeek 配置。我们用一个小函数统一解析。

inbox.route.ts

```typescript
type ChatProviderConfig = {
  apiKey: string
  baseURL: string
  model: string
}

function resolveChatProviderConfig(params: {
  payload: {
    llmConfig?: {
      apiKey: string
      baseURL: string
      model: string
    }
  }
  env: ReturnType<typeof getApiEnv>
}): ChatProviderConfig {
  const localConfig = params.payload.llmConfig

  if (localConfig) {
    return {
      apiKey: localConfig.apiKey,
      baseURL: localConfig.baseURL,
      model: localConfig.model,
    }
  }

  if (!params.env.DEEPSEEK_API_KEY) {
    throw new AppError(BizCode.SYSTEM_INTERNAL_ERROR, 'LLM API key is not configured', 500)
  }

  return {
    apiKey: params.env.DEEPSEEK_API_KEY,
    baseURL: params.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
    model: params.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  }
}
```

这段代码的优先级很明确：请求里带了 `llmConfig`，就使用用户配置；没带 `llmConfig`，就使用平台 DeepSeek；如果平台也没有配置 API Key，再返回服务端配置错误。

这样就不会破坏已有功能。

## 10. 调用 OpenAI-compatible 接口

OpenAI-compatible 的核心约定是：

index.txt

```txt
POST {baseURL}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json
```

请求体一般长这样：

index.json

```json
{
  "model": "gpt-4o-mini",
  "messages": [],
  "stream": true
}
```

当前后端实现：

inbox.route.ts

```typescript
const upstream = await fetch(`${providerConfig.baseURL.replace(/\/$/, '')}/chat/completions`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${providerConfig.apiKey}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: providerConfig.model,
    messages,
    stream: true,
  }),
  signal: c.req.raw.signal,
})
```

这里用 `replace(/\/$/, '')` 去掉 `baseURL` 尾部斜杠，避免出现：

index.txt

```txt
https://api.openai.com/v1//chat/completions
```

`signal: c.req.raw.signal` 的作用是：如果前端取消请求，后端也能中断上游请求。

## 11. 处理上游错误

如果三方 LLM 返回错误，不能把上游响应原文直接透传给前端。

原因是有些服务商的错误信息可能包含敏感上下文，甚至有可能出现和鉴权相关的信息。我们的实现只记录状态码，不记录响应正文，也不把正文放进 API 响应。

inbox.route.ts

```typescript
if (!upstream.ok) {
  console.warn('Chat completion stream failed', {
    status: upstream.status,
  })

  throw new AppError(
    BizCode.SYSTEM_INTERNAL_ERROR,
    'Chat completion stream failed',
    500,
  )
}
```

这个处理虽然会让前端错误信息不那么详细，但安全边界更清楚。

## 12. SSE 转纯文本流

OpenAI-compatible 的流式接口一般返回 SSE，格式类似：

index.txt

```txt
data: {"choices":[{"delta":{"content":"你"}}]}
data: {"choices":[{"delta":{"content":"好"}}]}
data: [DONE]
```

前端当前使用的是 `TextStreamChatTransport`，它期望后端返回纯文本流。因此 api 子站需要把 SSE 里的 `delta.content` 抽出来，再逐段写入 `ReadableStream`。

核心逻辑如下：

inbox.route.ts

```typescript
const textStream = new ReadableStream<Uint8Array>({
  async start(controller) {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const reader = upstream.body?.getReader()
    let buffer = ''
    let closed = false

    if (!reader) {
      controller.close()
      return
    }

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done || closed) {
          break
        }

        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()

          if (!trimmed.startsWith('data:')) {
            continue
          }

          const data = trimmed.slice(5).trim()

          if (!data) {
            continue
          }

          if (data === '[DONE]') {
            closed = true
            controller.close()
            break
          }

          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: unknown } }>
          }
          const content = parsed.choices?.[0]?.delta?.content

          if (typeof content === 'string' && content) {
            controller.enqueue(encoder.encode(content))
          }
        }

        if (closed) {
          break
        }
      }

      if (!closed) {
        controller.close()
      }
    } catch (error) {
      controller.error(error)
    }
  },
})
```

最后返回纯文本流：

inbox.route.ts

```typescript
return new Response(textStream, {
  headers: {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-cache',
    'x-accel-buffering': 'no',
  },
})
```

这样前端不用关心上游 SSE 的细节，仍然只接收一段连续文本流。

## 13. 保留平台回退

用户自定义 LLM 是增强能力，但不能让它变成聊天功能的唯一入口。

保留平台回退之后，新用户不配置 LLM，也能立即体验聊天；用户配置错误时，也可以关闭本地 LLM，回到平台默认模型。本地开发仍然可以继续用 `.dev.vars` 里的 DeepSeek 配置调试，后端代码也只有一个聊天入口，不需要拆成两套路由。

回退逻辑就是前面这段：

inbox.route.ts

```typescript
if (localConfig) {
  return {
    apiKey: localConfig.apiKey,
    baseURL: localConfig.baseURL,
    model: localConfig.model,
  }
}

return {
  apiKey: params.env.DEEPSEEK_API_KEY,
  baseURL: params.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  model: params.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
}
```

这就是配置化设计里很重要的一点：新能力应该接入现有链路，而不是把现有链路直接打断。

## 14. 安全边界

这套方案的安全边界，我们可以拆开来看。

用户 API Key 不保存到后端数据库。当前没有新增 D1 表，也没有把 API Key 放进用户 profile，它只存在当前浏览器的 `localStorage`。

聊天时 API Key 会临时发送到 api 子站，这是为了由 api 子站统一处理鉴权、上下文拼装、上游流式协议解析和响应格式转换。

api 子站不记录 API Key。上游失败时只记录 HTTP 状态码，不记录响应正文，也不把上游详情透传给前端。

聊天代理接口也必须鉴权。因为它可以代理请求三方 LLM，所以不能允许未登录用户直接调用。

## 15. 常见问题

### 1. API Key 为什么不用 D1 加密保存

因为当前需求明确要求 **不存储用户的 API Key，就像添加到本地 web 配置一样**。

所以这次没有使用 D1，也没有新增加密存储逻辑。浏览器本地保存更符合这个产品决策。

### 2. localStorage 保存 API Key 安全吗

它不是最高安全级别的存储方案。

localStorage 里的数据可以被同源脚本读取，因此要特别注意 XSS 防护。当前方案的定位是 **本机配置**，适合用户自愿在当前浏览器保存自己的 key。

如果未来要做企业级或多设备同步，就应该改成服务端加密存储、访问审计、权限管理和密钥轮换，而不是继续用 localStorage。

### 3. 为什么不让前端直接请求 OpenAI-compatible 服务

主要原因有几个。很多服务商未必允许浏览器跨域请求；不同服务商虽然都说兼容 OpenAI，但流式响应细节仍可能有差异，后端代理更容易统一适配；前端直连还会让业务上下文、系统提示词、模型协议处理都散落到浏览器里，不利于统一维护。

### 4. 为什么请求里还要带 access token

聊天接口现在相当于一个 LLM 代理接口。如果不鉴权，任何人都可以请求它，甚至可能借平台默认 DeepSeek 配置消耗资源。

所以聊天 transport 里必须显式带上：

inbox-chat.tsx

```typescript
headers: storedSession
  ? { authorization: `Bearer ${storedSession.accessToken}` }
  : undefined
```

后端也必须校验：

inbox.route.ts

```typescript
await requireWebAccessToken(c)
```

### 5. 用户关闭本地 LLM 后会怎样

`readEnabledLocalLlmConfig()` 会返回 `null`，聊天请求就不会带 `llmConfig`。

后端收到请求后找不到本地配置，就会使用平台 DeepSeek 配置。

## 总结

这次 LLM 配置化实现的核心不是多几个输入框，而是把模型调用链路从 **平台固定 DeepSeek** 改造成 **用户请求级配置优先，平台配置兜底**。

我们把 `contracts` 增加了可选 `llmConfig`，让 web 端可以把用户配置保存到当前浏览器，并在聊天请求里临时带上启用的本地 LLM 配置。api 子站优先使用请求里的 OpenAI-compatible 配置；用户未配置时，再继续回退平台 DeepSeek。

这套设计让产品先具备了开放接入三方 LLM 的能力，同时又避免把用户 API Key 持久化到后端。对一个正在快速迭代的 AI Agent 产品来说，这是一个足够轻、也足够清晰的落地方案。
