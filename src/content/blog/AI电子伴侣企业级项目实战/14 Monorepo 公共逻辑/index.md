---
title: "14 Monorepo 公共逻辑"
pubDate: 2026-04-16
description: "上一篇文章确定了 Monorepo 的整体架构：三个应用（server / web / admin）+ 三个共享包（shared / ui / config），用 Turborepo + yarn workspaces 管理。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/12-monorepo-shared-packages/](https://aicompanion.usehook.cn/12-monorepo-shared-packages/)

## 1. 从蓝图到工程结构

上一篇文章确定了 Monorepo 的整体架构：仓库中包含 server、web、admin 三个应用，以及 shared、ui、config 三个共享包，并使用 Turborepo 和 yarn workspaces 统一管理。

这篇文章继续把架构落实到具体的工程结构中。我们会依次确定目录如何组织、公共逻辑放在哪里、各个子项目分别关注什么，以及日常开发和部署流程如何配合。

## 2. 目录结构

我们先看完整目录，再逐层说明每个位置承担的职责。

structure.txt

```text
ai-companion/
├── apps/
│   ├── server/                  # Hono 服务端
│   │   ├── src/
│   │   │   ├── routes/          # 路由定义
│   │   │   ├── middleware/      # 中间件
│   │   │   ├── services/        # 业务逻辑
│   │   │   └── index.ts         # 入口
│   │   ├── wrangler.toml        # CloudFlare Workers 配置
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── web/                     # Next.js 客户端
│   │   ├── src/
│   │   │   ├── app/             # App Router 页面
│   │   │   ├── components/      # 客户端专属组件
│   │   │   ├── hooks/           # 自定义 Hooks
│   │   │   ├── stores/          # Zustand stores
│   │   │   └── lib/             # 工具函数
│   │   ├── next.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── admin/                   # Next.js 后台管理
│       ├── src/
│       │   ├── app/             # App Router 页面
│       │   ├── components/      # 后台专属组件
│       │   ├── hooks/
│       │   ├── stores/
│       │   └── lib/
│       ├── next.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   ├── shared/                  # 共享类型、Schema、常量、工具
│   │   ├── src/
│   │   │   ├── schemas/         # Zod Schema
│   │   │   ├── types/           # TypeScript 类型
│   │   │   ├── constants/       # 业务常量与枚举
│   │   │   ├── utils/           # 工具函数
│   │   │   └── index.ts         # 统一导出
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── ui/                      # 共享 UI 组件
│   │   ├── src/
│   │   │   ├── components/      # 组件
│   │   │   ├── styles/          # 共享样式
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── config/                  # 共享配置
│       ├── tsconfig.base.json   # TypeScript 基础配置
│       ├── tsconfig.next.json   # Next.js 项目配置
│       ├── tsconfig.node.json   # Node/Workers 项目配置
│       └── biome.json           # Biome lint/format 配置
│
├── turbo.json                   # Turborepo 任务配置
├── package.json                 # 根 package.json
└── yarn.lock
```

`apps/` 与 `packages/` 之间有明确的职责边界。`apps/` 存放可以独立部署的应用，`packages/` 存放被这些应用引用的共享包。Turborepo、Nx 和多数 Monorepo 模板都采用类似约定，开发者可以据此区分最终部署的产物与内部依赖。

每个子项目都拥有独立的 `package.json`，这是 yarn workspaces 组织工作区的基础。应用和共享包分别声明自己的依赖与 scripts，再由 workspaces 建立它们之间的链接。

`packages/config` 不包含运行时代码，只保存 tsconfig、Biome 等配置文件，其他项目通过 `extends` 引用。公共配置集中后，只需要修改一处，就能让各子项目使用相同的工程规则。

## 3. packages/shared 公共逻辑

`packages/shared` 负责保存类型定义、验证规则、业务常量和工具函数。它不包含 UI 组件，也不依赖具体的运行时框架，内部都是纯 TypeScript 代码，因此 Hono 服务端和两个 Next.js 应用都可以直接引用，不会引入运行时兼容问题。

### 3.1 Zod Schema 与类型定义

Zod Schema 在共享包中同时承担两项职责。运行时，服务端用它校验请求参数，客户端用它检查表单输入；编译时，TypeScript 可以直接从 Schema 推导类型，不需要再维护一套对应的 `interface`。

schemas/chat.ts

```typescript
// packages/shared/src/schemas/chat.ts
import { z } from 'zod'
import { emotionSchema } from './emotion'

// 对话消息 —— 用户发送
export const chatRequestSchema = z.object({
  content: z.string().min(1, '消息不能为空').max(2000, '消息过长'),
  session_id: z.string().uuid('无效的会话 ID'),
  emotion_hint: emotionSchema.optional(),
})

// 对话消息 —— AI 回复
export const chatResponseSchema = z.object({
  reply: z.string(),
  emotion: emotionSchema,
  memories_used: z.number().int().min(0),
  session_id: z.string().uuid(),
  created_at: z.string().datetime(),
})

// TypeScript 类型——从 Schema 推断，永远与验证规则同步
export type ChatRequest = z.infer<typeof chatRequestSchema>
export type ChatResponse = z.infer<typeof chatResponseSchema>
```

schemas/emotion.ts

```typescript
// packages/shared/src/schemas/emotion.ts
import { z } from 'zod'

export const emotionSchema = z.enum([
  'happy',      // 开心
  'sad',        // 难过
  'neutral',    // 平静
  'excited',    // 兴奋
  'anxious',    // 焦虑
  'calm',       // 放松
  'curious',    // 好奇
  'angry',      // 生气
  'tender',     // 温柔
  'playful',    // 调皮
])

export type Emotion = z.infer<typeof emotionSchema>

// 情绪转移规则的类型定义
export const emotionTransitionSchema = z.object({
  from: emotionSchema,
  to: emotionSchema,
  trigger: z.string(),
  probability: z.number().min(0).max(1),
})

export type EmotionTransition = z.infer<typeof emotionTransitionSchema>
```

schemas/memory.ts

```typescript
// packages/shared/src/schemas/memory.ts
import { z } from 'zod'

export const memoryTypeSchema = z.enum([
  'episodic',    // 情景记忆：具体事件
  'semantic',    // 语义记忆：归纳性知识
  'preference',  // 偏好记忆：用户喜好
])

export type MemoryType = z.infer<typeof memoryTypeSchema>

export const memorySchema = z.object({
  id: z.string(),
  user_id: z.string(),
  type: memoryTypeSchema,
  content: z.string(),
  importance: z.number().min(0).max(1),
  created_at: z.string().datetime(),
  last_accessed: z.string().datetime(),
  access_count: z.number().int().min(0),
})

export type Memory = z.infer<typeof memorySchema>
```

定义完成后，server、web 和 admin 可以按照各自的用途引用这些 Schema。

server-usage.ts

```typescript
// apps/server —— 服务端用 Zod 做请求验证
import { zValidator } from '@hono/zod-validator'
import { chatRequestSchema } from '@ai-companion/shared'

app.post('/chat', zValidator('json', chatRequestSchema), async (c) => {
  const body = c.req.valid('json')
  // body 的类型自动推断为 ChatRequest，无需手动标注
})
```

web-usage.tsx

```tsx
// apps/web —— 客户端用 Zod 做表单验证（配合 react-hook-form）
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { chatRequestSchema, type ChatRequest } from '@ai-companion/shared'

const form = useForm<ChatRequest>({
  resolver: zodResolver(chatRequestSchema),
})
// 表单验证规则与服务端完全一致，用户输入超过 2000 字时客户端就会拦截
```

admin-usage.tsx

```tsx
// apps/admin —— 后台用类型定义渲染审计表格
import type { ChatResponse } from '@ai-companion/shared'
import { EmotionBadge } from '@ai-companion/ui'

const AuditTable = ({ records }: { records: ChatResponse[] }) => {
  // records 的类型与服务端返回的结构完全一致
  return records.map(r => (
    <tr key={r.session_id}>
      <td>{r.reply}</td>
      <td><EmotionBadge emotion={r.emotion} /></td>
      <td>{r.memories_used}</td>
    </tr>
  ))
}
```

同一份 Schema 在服务端负责运行时验证，在客户端负责表单验证，在后台负责类型约束。规则发生变化后，三个应用会同时获得新的定义。

### 3.2 Hono RPC 类型导出

上一篇文章介绍了 Hono RPC 的端到端类型安全。实现时，服务端导出完整的路由类型，客户端再通过 `hc` 创建带有类型推断的调用实例。

server-routes.ts

```typescript
// apps/server/src/routes/chat.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { chatRequestSchema } from '@ai-companion/shared'

const chat = new Hono()
  .post('/', zValidator('json', chatRequestSchema), async (c) => {
    const body = c.req.valid('json')
    // ... 对话管线处理
    return c.json({
      reply: '你好呀~',
      emotion: 'happy' as const,
      memories_used: 3,
      session_id: body.session_id,
      created_at: new Date().toISOString(),
    })
  })
  .get('/history/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId')
    // ... 获取对话历史
    return c.json({ messages: [] })
  })

export { chat }
```

server-index.ts

```typescript
// apps/server/src/index.ts
import { Hono } from 'hono'
import { chat } from './routes/chat'
import { memory } from './routes/memory'
import { auth } from './routes/auth'

const app = new Hono()
  .route('/chat', chat)
  .route('/memory', memory)
  .route('/auth', auth)

export type AppType = typeof app
export default app
```

web-client.ts

```typescript
// apps/web/src/lib/api.ts
import { hc } from 'hono/client'
import type { AppType } from '@ai-companion/server'

export const api = hc<AppType>(process.env.NEXT_PUBLIC_API_URL!)

// 使用时，所有参数和返回值都有完整的类型提示
const res = await api.chat.$post({
  json: {
    content: '今天过得怎么样？',
    session_id: 'xxx-xxx-xxx',
  }
})
const data = await res.json()
// data.reply  → string
// data.emotion → 'happy' | 'sad' | 'neutral' | ...
// data.memories_used → number
```

这里需要关注 `import type { AppType } from '@ai-companion/server'`。在 Monorepo 中，这条 import 会直接解析到 `apps/server/src/index.ts` 的源码。类型从路由定义开始，经过 `zValidator` 使用的 Schema 和 `c.json()` 的返回值，最终汇总到 `AppType`。整个过程发生在编译阶段，不会增加运行时开销。

web 和 admin 都可以使用 `AppType`，不过 admin 通常还会访问额外的管理接口，因此 server 可以分别导出公共 API 和管理 API 的类型。

server-types.ts

```typescript
// apps/server/src/index.ts
export type AppType = typeof app       // 公共 API（web + admin 都能用）
export type AdminType = typeof admin   // 管理 API（仅 admin 使用）
```

### 3.3 认证与鉴权逻辑

认证与权限相关的类型需要在三个应用之间保持一致，因此也适合放进 shared。

auth.ts

```typescript
// packages/shared/src/schemas/auth.ts
import { z } from 'zod'

export const roleSchema = z.enum(['user', 'admin', 'super_admin'])
export type Role = z.infer<typeof roleSchema>

// JWT payload 的类型定义
export const jwtPayloadSchema = z.object({
  sub: z.string(),           // 用户 ID
  role: roleSchema,
  iat: z.number(),           // 签发时间
  exp: z.number(),           // 过期时间
})

export type JwtPayload = z.infer<typeof jwtPayloadSchema>

// 登录请求
export const loginRequestSchema = z.object({
  email: z.string().email('无效的邮箱格式'),
  password: z.string().min(8, '密码至少 8 位'),
})

export type LoginRequest = z.infer<typeof loginRequestSchema>

// 注册请求
export const registerRequestSchema = loginRequestSchema.extend({
  nickname: z.string().min(2, '昵称至少 2 个字').max(20, '昵称最多 20 个字'),
})

export type RegisterRequest = z.infer<typeof registerRequestSchema>
```

auth-utils.ts

```typescript
// packages/shared/src/utils/auth.ts

import type { Role } from '../schemas/auth'

// 权限检查——服务端中间件和客户端路由守卫都会用到
const ROLE_HIERARCHY: Record<Role, number> = {
  user: 0,
  admin: 1,
  super_admin: 2,
}

export function hasPermission(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole]
}

// Token 是否过期——客户端判断是否需要刷新 token
export function isTokenExpired(exp: number, bufferSeconds = 60): boolean {
  return Date.now() / 1000 > exp - bufferSeconds
}
```

服务端根据这些类型实现鉴权中间件，客户端通过 `isTokenExpired` 判断是否需要静默刷新 token，后台则用 `hasPermission` 实现前端路由守卫。三端引用同一套角色层级和判断函数，可以避免权限规则出现差异。

### 3.4 业务常量与错误码

constants.ts

```typescript
// packages/shared/src/constants/index.ts

// 记忆系统参数
export const MEMORY = {
  MAX_EPISODIC: 1000,        // 单用户最大情景记忆数
  MAX_SEMANTIC: 200,         // 单用户最大语义记忆数
  IMPORTANCE_THRESHOLD: 0.3, // 低于此阈值的记忆可能被遗忘
  RETRIEVAL_TOP_K: 5,        // 语义检索返回的最大记忆数
  EMBEDDING_DIMENSION: 768,  // 向量维度（BGE base）
} as const

// 对话参数
export const CHAT = {
  MAX_HISTORY_TURNS: 20,     // 上下文窗口中保留的最大对话轮数
  MAX_MESSAGE_LENGTH: 2000,  // 单条消息最大长度
  STREAM_CHUNK_SIZE: 10,     // 流式传输的 chunk 大小（token 数）
} as const

// 情绪系统参数
export const EMOTION = {
  DECAY_RATE: 0.1,           // 情绪衰减速率（趋向 neutral 的速度）
  TRANSITION_THRESHOLD: 0.6, // 触发情绪转移的最低概率
  UPDATE_INTERVAL: 300,      // 情绪状态更新间隔（秒）
} as const
```

errors.ts

```typescript
// packages/shared/src/constants/errors.ts

export const ERROR_CODES = {
  // 认证错误 1xxx
  AUTH_INVALID_TOKEN: { code: 1001, message: 'token 无效或已过期' },
  AUTH_INSUFFICIENT_ROLE: { code: 1002, message: '权限不足' },
  AUTH_EMAIL_EXISTS: { code: 1003, message: '邮箱已注册' },

  // 对话错误 2xxx
  CHAT_CONTENT_TOO_LONG: { code: 2001, message: '消息内容超过长度限制' },
  CHAT_SESSION_NOT_FOUND: { code: 2002, message: '会话不存在' },
  CHAT_RATE_LIMITED: { code: 2003, message: '发送过于频繁，请稍后再试' },
  CHAT_UNSAFE_CONTENT: { code: 2004, message: '消息内容不合规' },

  // 记忆错误 3xxx
  MEMORY_NOT_FOUND: { code: 3001, message: '记忆不存在' },
  MEMORY_LIMIT_EXCEEDED: { code: 3002, message: '记忆数量已达上限' },

  // 系统错误 5xxx
  INTERNAL_ERROR: { code: 5001, message: '系统内部错误' },
  LLM_TIMEOUT: { code: 5002, message: 'AI 响应超时' },
  LLM_UNAVAILABLE: { code: 5003, message: 'AI 服务暂时不可用' },
} as const

export type ErrorCode = keyof typeof ERROR_CODES
```

服务端根据错误码返回标准化响应，客户端把错误码转换成相应的用户提示，例如收到 `CHAT_RATE_LIMITED` 时显示“发送太快了”，后台则使用同一套错误码进行分类统计和告警配置。这样可以保证三个应用对同一类错误使用一致的含义。

### 3.5 工具函数

utils.ts

```typescript
// packages/shared/src/utils/index.ts
import { nanoid } from 'nanoid'

// ID 生成——统一长度和字符集
export function generateId(prefix?: string): string {
  const id = nanoid(16)
  return prefix ? `${prefix}_${id}` : id
}

// 日期格式化——对话时间展示
export function formatChatTime(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`

  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`

  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay} 天前`

  return date.toLocaleDateString('zh-CN')
}

// 文本截断——记忆预览、消息摘要
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 1) + '…'
}

// 安全的 JSON 解析——避免 LLM 返回格式异常时崩溃
export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}
```

这些工具函数本身并不复杂，但如果由三个子项目分别实现，细节很容易逐渐偏离。例如，时间展示格式可能不一致，ID 的长度和字符集可能不同，JSON 解析也可能只有部分应用处理了异常。集中维护可以让这些基础行为始终保持一致。

### 3.6 统一导出

index.ts

```typescript
// packages/shared/src/index.ts

// Schemas
export * from './schemas/chat'
export * from './schemas/emotion'
export * from './schemas/memory'
export * from './schemas/auth'

// Constants
export * from './constants'
export * from './constants/errors'

// Utils
export * from './utils'
export * from './utils/auth'
```

统一导出之后，调用方只需要从包入口引入所需内容：

example.ts

```typescript
import {
  chatRequestSchema,
  type ChatRequest,
  type Emotion,
  ERROR_CODES,
  MEMORY,
  formatChatTime,
  hasPermission,
} from '@ai-companion/shared'
```

## 4. packages/ui 共享组件

web 和 admin 都使用 Next.js，其中一部分展示组件可以复用，这些组件统一放在 `packages/ui` 中。

共享范围需要保持克制。如果一个组件只在 web 中使用，就继续放在 `apps/web/src/components/`；只有 web 和 admin 都需要时，才把它移动到 `packages/ui`。这样可以复用稳定的公共部分，同时避免过早抽象。

emotion-badge.tsx

```tsx
// packages/ui/src/components/emotion-badge.tsx
import type { Emotion } from '@ai-companion/shared'

const EMOTION_CONFIG: Record<Emotion, { label: string; color: string }> = {
  happy: { label: '开心', color: 'bg-yellow-100 text-yellow-800' },
  sad: { label: '难过', color: 'bg-blue-100 text-blue-800' },
  neutral: { label: '平静', color: 'bg-gray-100 text-gray-800' },
  excited: { label: '兴奋', color: 'bg-orange-100 text-orange-800' },
  anxious: { label: '焦虑', color: 'bg-purple-100 text-purple-800' },
  calm: { label: '放松', color: 'bg-green-100 text-green-800' },
  curious: { label: '好奇', color: 'bg-cyan-100 text-cyan-800' },
  angry: { label: '生气', color: 'bg-red-100 text-red-800' },
  tender: { label: '温柔', color: 'bg-pink-100 text-pink-800' },
  playful: { label: '调皮', color: 'bg-amber-100 text-amber-800' },
}

export const EmotionBadge = ({ emotion }: { emotion: Emotion }) => {
  const config = EMOTION_CONFIG[emotion]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.color}`}>
      {config.label}
    </span>
  )
}
```

chat-bubble.tsx

```tsx
// packages/ui/src/components/chat-bubble.tsx
import { formatChatTime } from '@ai-companion/shared'
import { EmotionBadge } from './emotion-badge'
import type { Emotion } from '@ai-companion/shared'

interface ChatBubbleProps {
  content: string
  isAI: boolean
  emotion?: Emotion
  createdAt: string
}

export const ChatBubble = ({ content, isAI, emotion, createdAt }: ChatBubbleProps) => {
  return (
    <div className={`flex ${isAI ? 'justify-start' : 'justify-end'} mb-4`}>
      <div className={`max-w-100 rounded-2xl px-4 py-3 ${
        isAI
          ? 'bg-gray-100 dark:bg-gray-800 rounded-tl-none'
          : 'bg-blue-500 text-white rounded-tr-none'
      }`}>
        <p className="text-sm leading-relaxed">{content}</p>
        <div className="mt-1.5 flex items-center gap-2">
          {isAI && emotion && <EmotionBadge emotion={emotion} />}
          <span className="text-xs opacity-50">{formatChatTime(createdAt)}</span>
        </div>
      </div>
    </div>
  )
}
```

web 使用 `ChatBubble` 渲染聊天界面，admin 则用同一个组件展示对话审计详情。用户端和管理端因此能够按照相同的样式呈现消息，减少两边展示结果不一致带来的理解偏差。

## 5. packages/config 共享配置

配置包仍然不包含运行时代码，只保存供其他项目通过 `extends` 继承的配置文件。

tsconfig.base.json

```json
// packages/config/tsconfig.base.json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

tsconfig.next.json

```json
// packages/config/tsconfig.next.json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "allowJs": true,
    "noEmit": true
  }
}
```

tsconfig.node.json

```json
// packages/config/tsconfig.node.json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "outDir": "./dist"
  }
}
```

各子项目的 tsconfig 通过 `extends` 引用对应配置：

tsconfig.json

```json
// apps/web/tsconfig.json
{
  "extends": "@ai-companion/config/tsconfig.next.json",
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*", "next-env.d.ts"],
  "exclude": ["node_modules"]
}
```

后续升级 TypeScript、调整 strict 规则或增加编译选项时，只需要修改 `packages/config` 中的文件，所有引用该配置的子项目都会同步生效。

## 6. 各子项目的独立关注点

公共能力放入 packages 之后，各应用仍然要保留与自身运行环境和产品职责相关的实现。

server 主要关注请求处理和 CloudFlare Workers 的运行环境：

- **中间件编排。** 处理安全检查、认证、限流、日志和耗时统计，并明确各中间件的执行顺序。

- **CloudFlare Bindings。** 管理 `wrangler.toml` 中的 KV / D1 / Vectorize / AI 绑定，以及 `c.env` 的类型声明。

- **流式响应。** 维护 SSE 连接，逐 token 转发 LLM 输出，并处理连接异常中断。

- **后台任务。** 定期把情景记忆归纳为语义记忆，并让情绪状态逐渐衰减到 neutral。

web 主要处理面向用户的渲染、状态和设备适配：

- **SSR / ISR 策略。** 落地页使用 SSG，对话页使用纯客户端渲染，用户设置页使用 SSR 和客户端水合。

- **客户端状态管理。** 通过 Zustand store 管理对话状态、用户信息和 SSE 连接状态。

- **流式消息渲染。** 接收 SSE 推送，将内容逐字追加到消息气泡中，形成连续的打字机效果。

- **移动端适配。** 处理响应式布局、触摸手势，以及虚拟键盘弹出后的界面调整。

- **离线体验。** 使用 Service Worker 缓存关键资源，并在弱网环境下维护消息队列和重试机制。

admin 主要处理权限、数据展示和管理操作：

- **权限路由守卫。** 根据管理员角色动态展示菜单项，并拦截无权限的页面访问。

- **数据可视化。** 使用 ECharts / Recharts 渲染统计图表。

- **表格与表单。** 处理大量数据的分页表格，以及 Prompt 编辑器、参数调优面板等复杂配置表单。

- **操作审计日志。** 记录管理员修改配置、删除记忆和查看对话等操作。

## 7. 开发与部署工作流

### 7.1 根 package.json 与 workspace 配置

根目录的 `package.json` 负责声明 workspaces，并统一提供开发、构建和检查命令：

package.json

```json
{
  "name": "ai-companion",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "typecheck": "turbo typecheck",
    "lint": "turbo lint",
    "lint:fix": "turbo lint:fix",
    "format": "turbo format"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.5.0"
  },
  "packageManager": "yarn@4.12.0"
}
```

### 7.2 日常开发流程

dev.bash

```shellscript
# 克隆仓库后，一条命令安装所有依赖
yarn install

# 一条命令启动所有子项目的开发服务器
yarn dev
# Turborepo 并行启动：
#   server  → wrangler dev (localhost:8787)
#   web     → next dev (localhost:3000)
#   admin   → next dev (localhost:3001)

# 只启动某个子项目
yarn dev --filter=@ai-companion/web

# 全仓库类型检查
yarn typecheck

# 全仓库 lint
yarn lint
```

`turbo dev` 会并行启动三个开发服务器。修改 `packages/shared` 后，依赖它的 server、web 和 admin 都会自动触发热更新，因此一份 Schema 的变化可以立即反映到三个应用中。

### 7.3 部署策略

三个应用会部署到不同的平台，并分别维护自己的发布路径：

- **server** 通过 `wrangler deploy` 部署到 CloudFlare Workers。

- **web** 可以由 Vercel 自动部署，在检测到 `apps/web` 变更时触发，也可以部署到 CloudFlare Pages。

- **admin** 部署到内部环境，或者部署到带访问控制的 Vercel 项目，并使用 `vercel --scope internal`。

Turborepo 缓存在 CI 中同样有效。如果一次 PR 只修改 `apps/web`，`apps/server` 和 `apps/admin` 的构建可以直接命中缓存，从而减少不必要的 CI 执行时间。

## 8. 总结

这套工程结构把可部署应用和内部依赖分开管理：`apps/` 包含 server、web 和 admin，`packages/` 包含 shared、ui 和 config。每个子项目都保留清晰的职责边界，同时能够通过工作区依赖共享公共能力。

其中，`packages/shared` 负责统一 Zod Schema、Hono RPC 类型、错误码和业务常量；`packages/ui` 只接收确实被多个应用复用的组件；`packages/config` 则保证各项目使用一致的 TypeScript 和 Biome 配置。

日常开发时，`yarn dev` 可以同时启动三个应用，共享 Schema 的变化会触发相关项目热更新，`yarn typecheck` 则负责检查整个仓库的类型。部署阶段，Turborepo 根据变更范围调度各应用的构建任务，并利用缓存减少重复执行。

下一篇文章会进入具体实现，先搭建 Hono 服务端的基础结构，包括路由组织、中间件管线，以及与 CloudFlare Workers 的部署联调。
