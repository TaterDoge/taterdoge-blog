---
title: "170、 接通 DeepSeek"
pubDate: 2026-06-06
description: "Web 子站右侧聊天模块接通 DeepSeek，前后端通过 Hono、LangChain、AI Elements 与流式响应完成一次完整对话链路。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/35-deepseek-chat/](https://aicompanion.usehook.cn/35-deepseek-chat/)

## 1. 概述

这一节我们把 Web 首页聊天列表右侧的 AI 对话模块接通 DeepSeek。

页面现在是左右两栏：左边是聊天列表，右边是当前聊天的 AI 对话区。用户输入问题后，前端一边接收模型返回，一边把内容流式展示出来。

这里先把边界放清楚。API 不写在 Next.js API Route 里，而是统一放到 `apps/api` 子站中处理。Web 子站负责页面、交互和发请求；模型调用、环境变量、请求校验、流式响应，都交给 API 子站。

这块能力会用到几层技术，我们可以先用一张表把关系看清楚：

| 层级 | 技术 | 作用 |
| --- | --- | --- |
| Web UI | AI Elements | 官方 AI UI 组件，比如 Conversation、Message、PromptInput |
| Web Chat State | Vercel AI SDK useChat | 管理消息、状态、停止生成、发送消息 |
| Web Transport | TextStreamChatTransport | 调用非 Next.js API 的纯文本流接口 |
| API Framework | Hono | apps/api 子站的 HTTP 路由框架 |
| Contract | Zod + @repo/contracts | 前后端共享请求结构校验 |
| Model Framework | LangChain | 后端首选 LLM 开发框架 |
| Model Provider | DeepSeek | 通过 OpenAI-compatible endpoint 接入 |

整体调用链是这样：

index.txt

```txt
apps/web Dashboard 首页
  └─ InboxChat 组件
      ├─ useChat()
      ├─ TextStreamChatTransport
      └─ POST ${NEXT_PUBLIC_API_BASE_URL}/rpc/chat/inbox

apps/api Hono 服务
  └─ /rpc/chat/inbox
      ├─ zValidator(InboxChatRequestSchema)
      ├─ ChatOpenAI({ DeepSeek env })
      ├─ LangChain messages
      ├─ model.stream(messages)
      └─ text/plain ReadableStream

DeepSeek API
  └─ OpenAI-compatible chat model
```

这套实现会避开 Next.js API Route。Web 只管 UI 和调用 API 子站，LLM 编排和模型配置都在 `apps/api` 中处理。

## 2. 环境变量与 Contract

DeepSeek 配置由 API 子站读取。涉及的核心文件有这几个：

index.txt

```txt
apps/api/src/env.ts
apps/api/src/bindings.ts
apps/api/wrangler.jsonc
apps/api/.dev.vars
```

非敏感配置可以放在 `apps/api/wrangler.jsonc`：

wrangler.jsonc

```jsonc
{
  "vars": {
    "DEEPSEEK_BASE_URL": "https://api.deepseek.com/v1",
    "DEEPSEEK_MODEL": "deepseek-chat"
  }
}
```

`DEEPSEEK_API_KEY` 是敏感信息，不要写进仓库。它应该放在本地 `apps/api/.dev.vars`，线上则放到 Wrangler secret。

.dev.vars

```txt
DEEPSEEK_API_KEY=你的 DeepSeek Key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
```

`apps/api/.dev.vars` 已经被 git ignore，不会提交。

环境变量统一在 `apps/api/src/env.ts` 里用 Zod 解析：

env.ts

```typescript
const apiEnvSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']),
  ADMIN_ORIGIN: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive(),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().positive(),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  DEEPSEEK_BASE_URL: z.string().url().optional(),
  DEEPSEEK_MODEL: z.string().min(1).optional(),
})
```

解析函数从 `bindings` 中取值，再交给 schema 校验：

env.ts

```typescript
export function getApiEnv(bindings: ApiBindings): ApiEnv {
  return apiEnvSchema.parse({
    APP_ENV: bindings.APP_ENV,
    ADMIN_ORIGIN: bindings.ADMIN_ORIGIN,
    WEB_ORIGIN: bindings.WEB_ORIGIN,
    JWT_ACCESS_SECRET: bindings.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: bindings.JWT_REFRESH_SECRET,
    ACCESS_TOKEN_TTL_SEC: bindings.ACCESS_TOKEN_TTL_SEC,
    REFRESH_TOKEN_TTL_SEC: bindings.REFRESH_TOKEN_TTL_SEC,
    DEEPSEEK_API_KEY: bindings.DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL: bindings.DEEPSEEK_BASE_URL,
    DEEPSEEK_MODEL: bindings.DEEPSEEK_MODEL,
  })
}
```

前后端请求结构放在 contract 里：

index.txt

```txt
packages/contracts/src/chat/inbox-chat.contract.ts
```

这里有个容易忽略的地方。前端用了 Vercel AI SDK 的 `useChat`，它传给后端的消息不是简单的 `{ role, content }`，而是 `UIMessage`，大概长这样：

index.ts

```typescript
{
  id: string
  role: 'user' | 'assistant'
  parts: Array<UIMessagePart>
}
```

`parts` 不一定只有文本，还可能有 `step-start`、tool part、data part、file part。后端 contract 如果只认 `{ type: 'text', text: string }`，后面很容易因为 AI SDK 附带的 part 类型变化而校验失败。

所以当前 schema 只要求每个 part 至少有 `type`，其他字段允许透传：

inbox-chat.contract.ts

```typescript
const InboxChatPartSchema = z.object({
  type: z.string().min(1),
}).passthrough()

export const InboxChatMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['user', 'assistant']),
  parts: z.array(InboxChatPartSchema).min(1).max(50),
})
```

完整请求结构里除了 `messages`，还带上了当前聊天上下文 `mail`。这样后端调用模型时，才能把当前聊天主题、发送方、摘要一起交给 DeepSeek。

inbox-chat.contract.ts

```typescript
export const InboxChatRequestSchema = z.object({
  messages: z.array(InboxChatMessageSchema).min(1).max(20),
  mail: z.object({
    subject: z.string().min(1).max(200),
    sender: z.string().min(1).max(120),
    senderEmail: z.string().email(),
    teaser: z.string().min(1).max(2000),
  }),
})
```

## 3. API 子站实现

API 核心文件是：

index.txt

```txt
apps/api/src/routes/chat/inbox.route.ts
```

路由挂载在：

index.txt

```txt
POST /rpc/chat/inbox
```

挂载文件是：

index.txt

```txt
apps/api/src/routes/index.ts
```

index.ts

```typescript
.route('/rpc/chat/inbox', inboxChatRoute)
```

请求体先用 `zValidator` 校验：

inbox.route.ts

```typescript
inboxChatRoute.post(
  '/',
  zValidator(
    'json',
    InboxChatRequestSchema,
    buildValidationErrorHandler('Invalid chat payload'),
  ),
  async (c) => {
    // handler
  },
)
```

这样 Web 和 API 共用同一份 schema。AI SDK 的消息结构以后有变化，也先改 contract。校验失败时，也会走项目已有的 API failure 结构。

因为 `UIMessage.parts` 里可能混着非文本 part，真正进入 LangChain 前，只提取文本内容：

inbox.route.ts

```typescript
function extractText(message: { parts: Array<{ type: string; text?: unknown }> }) {
  return message.parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim()
}
```

这样可以跳过 `step-start` 等 part，避免 LangChain 收到空消息或非法消息。

DeepSeek 这里通过 LangChain 的 `ChatOpenAI` 接入。DeepSeek 提供 OpenAI-compatible API，所以我们只要把 `baseURL` 指到 DeepSeek 即可。

inbox.route.ts

```typescript
const model = new ChatOpenAI({
  apiKey: env.DEEPSEEK_API_KEY,
  model: env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  configuration: {
    baseURL: env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})
```

如果没有配置 `DEEPSEEK_API_KEY`，不要让请求继续往下走，而是直接返回明确错误：

inbox.route.ts

```typescript
if (!env.DEEPSEEK_API_KEY) {
  throw new AppError(
    BizCode.SYSTEM_INTERNAL_ERROR,
    'DeepSeek API key is not configured',
    500,
  )
}
```

调用模型前，API 会先构造系统提示词和当前聊天上下文：

inbox.route.ts

```typescript
const messages: BaseMessage[] = [
  new SystemMessage([
    '你是 AI Agent Web 控制台里的聊天助手。',
    '请基于当前聊天上下文，用简洁、自然的中文回答用户。',
    '如果用户要求起草回复，请直接给出可发送的回复内容。',
  ].join('\n')),
  new HumanMessage([
    `聊天主题：${payload.mail.subject}`,
    `发送方：${payload.mail.sender} <${payload.mail.senderEmail}>`,
    `聊天摘要：${payload.mail.teaser}`,
  ].join('\n')),
]
```

随后把前端传来的历史消息转换为 LangChain 消息。用户消息变成 `HumanMessage`，助手消息变成 `AIMessage`。

inbox.route.ts

```typescript
for (const message of payload.messages) {
  const text = extractText(message)

  if (!text) {
    continue
  }

  messages.push(
    message.role === 'user'
      ? new HumanMessage(text)
      : new AIMessage(text),
  )
}
```

模型调用使用 LangChain 的流式接口：

inbox.route.ts

```typescript
const stream = await model.stream(messages)
```

接下来把 LangChain stream 转成 Web 标准 `ReadableStream<Uint8Array>`：

inbox.route.ts

```typescript
const textStream = new ReadableStream<Uint8Array>({
  async start(controller) {
    const encoder = new TextEncoder()

    try {
      for await (const chunk of stream) {
        const content = typeof chunk.content === 'string'
          ? chunk.content
          : chunk.content.map((part) => {
            if (typeof part === 'string') {
              return part
            }

            if ('text' in part && typeof part.text === 'string') {
              return part.text
            }

            return ''
          }).join('')

        if (content) {
          controller.enqueue(encoder.encode(content))
        }
      }

      controller.close()
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
  },
})
```

这里用 `text/plain`，是为了配合前端的 `TextStreamChatTransport`。

## 4. Web 侧实现

Web 聊天入口文件是：

index.txt

```txt
apps/web/app/(dashboard)/_components/inbox-chat.tsx
```

首页把当前选中的聊天传进去：

page.tsx

```tsx
<InboxChat mail={selectedMail} />
```

当前首页文件是：

index.txt

```txt
apps/web/app/(dashboard)/page.tsx
```

Web 侧使用 `useChat` 管理对话状态：

inbox-chat.tsx

```typescript
const { messages, sendMessage, status, error, stop } = useChat({
  transport,
  messages: initialMessages,
})
```

`useChat` 会帮我们保存消息列表、发送用户消息、接收并合并流式 assistant 回复。它还会给出 `submitted`、`streaming` 等状态，并提供 `stop()` 用来中断生成。

因为 API 不在 Next.js API Route，而是在 `apps/api` 子站，所以这里不能走默认 `/api/chat`。我们要用 `TextStreamChatTransport` 指向 API 子站：

inbox-chat.tsx

```typescript
const transport = useMemo(
  () => new TextStreamChatTransport<UIMessage>({
    api: `${getWebClientEnv().NEXT_PUBLIC_API_BASE_URL}/rpc/chat/inbox`,
    body: {
      mail,
    },
  }),
  [mail],
)
```

这里的 `NEXT_PUBLIC_API_BASE_URL` 是 Web 子站调用 API 子站的 base URL。`body.mail` 会被附加到每次聊天请求中，`messages` 则由 AI SDK 自动放进请求体。

实际发出的请求体大致是这样：

index.json

```json
{
  "mail": {
    "subject": "Meeting Tomorrow",
    "sender": "William Smith",
    "senderEmail": "williamsmith@example.com",
    "teaser": "Hi team..."
  },
  "id": "chat-id",
  "messages": [
    {
      "id": "...",
      "role": "user",
      "parts": [
        { "type": "text", "text": "请帮我起草回复" }
      ]
    }
  ],
  "trigger": "submit-message"
}
```

后端 schema 使用 passthrough 和宽松 part 结构，所以可以兼容 AI SDK 附带的额外字段。

UI 组件使用 vercel 提供的 AI Elements 组件库

index.txt

```txt
apps/web/src/components/ai-elements/conversation.tsx
apps/web/src/components/ai-elements/message.tsx
apps/web/src/components/ai-elements/prompt-input.tsx
```

安装命令是：

index.bash

```shellscript
pnpm dlx shadcn@latest add @ai-elements/conversation @ai-elements/message @ai-elements/prompt-input -c apps/web -y
```

同时新增 web 子站本地配置：

index.txt

```txt
apps/web/components.json
```

registry 配置为：

components.json

```json
{
  "registries": {
    "@ai-elements": "https://ai-sdk.dev/elements/api/registry/{name}.json"
  }
}
```

Conversation 渲染部分使用这些组件：`Conversation`、`ConversationContent`、`ConversationScrollButton`、`Message`、`MessageContent`、`MessageResponse`。

inbox-chat.tsx

```tsx
<Conversation>
  <ConversationContent>
    {messages.map((message) => (
      <Message from={message.role} key={message.id}>
        <MessageContent>
          <MessageResponse>{getMessageText(message)}</MessageResponse>
        </MessageContent>
      </Message>
    ))}
    {status === 'submitted' ? (
      <Message from="assistant">
        <MessageContent>
          <MessageResponse>正在连接模型...</MessageResponse>
        </MessageContent>
      </Message>
    ) : null}
    {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
  </ConversationContent>
  <ConversationScrollButton />
</Conversation>
```

输入区使用 `PromptInput`、`PromptInputTextarea`、`PromptInputSubmit`。

inbox-chat.tsx

```tsx
<PromptInput
  onSubmit={(message) => {
    sendMessage({ text: message.text })
  }}
>
  <PromptInputTextarea
    defaultValue="请帮我起草一段简洁专业的回复。"
    disabled={isSending}
    placeholder="输入回复内容..."
  />
  <PromptInputSubmit
    disabled={isSending}
    onStop={stop}
    status={status}
  />
</PromptInput>
```

## 5. 样式、依赖与踩坑

AI Elements 官方 Message 组件依赖 `streamdown`，所以 web 全局样式里要加 source 配置。

文件是：

index.txt

```txt
apps/web/app/globals.css
```

globals.css

```css
@source "../node_modules/streamdown/dist/*.js";
```

Web 子站新增依赖包括：

| 依赖 | 说明 |
| --- | --- |
| @ai-sdk/react | React 侧 AI SDK 能力 |
| ai | AI SDK 核心包 |
| streamdown | 流式 Markdown/文本渲染相关依赖 |
| @streamdown/cjk | CJK 支持 |
| @streamdown/code | 代码渲染支持 |
| @streamdown/math | 数学公式支持 |
| @streamdown/mermaid | Mermaid 支持 |
| use-stick-to-bottom | 对话滚动到底部 |
| cmdk | 命令面板相关依赖 |
| nanoid | ID 生成 |
| shadcn/ui 相关依赖 | AI Elements 组件依赖的基础 UI |

API 子站新增依赖包括：

| 依赖 | 说明 |
| --- | --- |
| @langchain/core | LangChain 核心能力 |
| @langchain/openai | 通过 ChatOpenAI 接 DeepSeek OpenAI-compatible API |

接入时有几个地方要提前处理好。

**不要把 API 写在 Next.js API Route。**
本项目要求 API 服务统一写在 `apps/api` 子站中，所以 Web 不能依赖默认 `/api/chat`。

inbox-chat.tsx

```typescript
new TextStreamChatTransport({
  api: `${NEXT_PUBLIC_API_BASE_URL}/rpc/chat/inbox`,
})
```

**DeepSeek Key 不能写入仓库。**
`DEEPSEEK_API_KEY` 只能放在本地 `apps/api/.dev.vars` 或线上 Wrangler secret。不要写进 `wrangler.jsonc`、源码、Markdown 文档，也不要写进前端环境变量。

**AI SDK 的 parts 不是只有 text。**
如果 schema 一开始只允许 `{ type: 'text', text: string }`，可能会遇到这样的错误：

index.json

```json
{
  "message": "Invalid chat payload",
  "details": [
    {
      "path": ["messages", 2, "parts", 0, "type"],
      "message": "Invalid input: expected \"text\""
    }
  ]
}
```

原因是 AI SDK 可能发送 `step-start` 等非文本 part。最终修复是允许 part 透传：

inbox-chat.contract.ts

```typescript
const InboxChatPartSchema = z.object({
  type: z.string().min(1),
}).passthrough()
```

然后后端只在进入 LangChain 前提取文本：

inbox.route.ts

```typescript
.filter((part) => part.type === 'text' && typeof part.text === 'string')
```

**API 返回协议要匹配 Transport。**
当前前端使用的是 `TextStreamChatTransport`，所以 API 返回 `text/plain; charset=utf-8`。

index.http

```http
content-type: text/plain; charset=utf-8
```

如果以后改用默认 `DefaultChatTransport`，后端就需要返回 AI SDK UI message stream，而不是纯文本流。

## 总结

接通 DeepSeek 不能只看模型 API 是否能返回内容，还要把 Web、API、Contract、LangChain、DeepSeek 和流式 UI 的边界放清楚。

Web 负责聊天 UI 和请求入口，API 子站负责参数校验、聊天上下文拼接、LangChain 调用和纯文本流返回。AI SDK 用 `useChat` 管消息和状态，AI Elements 负责对话组件，`TextStreamChatTransport` 把 Web 请求接到 API 子站。

这样接入后，项目原有边界不会被打乱。后面继续做动态聊天、会话持久化、工具调用和鉴权，也都有位置可以往下加。
