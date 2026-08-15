---
title: "13 三端架构与 Monorepo"
pubDate: 2026-04-16
description: "前面的文章里，我们完成了 AI 伴侣项目的理论基础和技术选型：CloudFlare Workers 作为基础设施，Hono.js 作为后端框架，Next.js 作为前端框架。每一个选择都有充分的理由，但选型只是起点——把这些技术组合成一个可"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/11-monorepo-architecture-decision/](https://aicompanion.usehook.cn/11-monorepo-architecture-decision/)

## 1. 从技术选型到工程结构

前面的文章已经确定了 AI 伴侣项目的技术方案：基础设施使用 CloudFlare Workers，服务端使用 Hono.js，前端使用 Next.js。接下来要考虑的，是如何把这些技术组织成一个便于维护、协作和持续迭代的工程项目。

这篇文章会先划分产品需要的子系统，再说明它们之间的关系。明确这些内容之后，我们才能继续判断代码应该放在一个 Monorepo 中，还是拆成多个独立仓库，以及使用什么工具管理整个项目。

## 2. 三个子系统的职责

一个完整的 AI 伴侣产品，至少需要 Hono 服务端、Next.js 客户端和 Next.js 后台管理系统三个子系统。它们面对的使用者不同，承担的任务也不同。

### 2.1 Hono 服务端

服务端负责组织所有与 AI 对话相关的处理过程。它本身不执行模型推理，但记忆、情绪、人设和上下文如何进入 Prompt，都会影响最终回复的质量。

**对话管线**是服务端最重要的部分。一条用户消息进入系统后，会依次经过接收消息、安全检查、身份验证、记忆检索、情绪状态读取和 Prompt 组装，然后以流式方式调用 LLM。拿到模型响应后，服务端还要解析情绪变化和记忆触发点，写回记忆、更新情绪状态，最后把内容流式返回给客户端。

记忆检索会从 D1 和 Vectorize 中读取相关记忆，情绪状态则来自 KV。Prompt 组装时，需要把这些数据与人设、对话历史一起整理成完整上下文。前面的文章分别讨论过其中的每一个环节，服务端负责把它们连接成一条完整的调用链路。

**用户认证与鉴权**包括 JWT 的签发和验证、用户注册登录以及会话管理。服务端需要区分普通用户和管理员两类调用者：普通用户通过客户端访问，管理员通过后台管理系统访问，两者对应不同的 API 权限。

**记忆系统 CRUD**围绕 D1、Vectorize 和 KV 展开。D1 负责关系型数据，Vectorize 负责向量检索，KV 负责需要快速读写的状态。相关接口要支持情景记忆的存储与检索、语义记忆的归纳与更新，以及用户偏好的读写。

**情绪状态管理**负责维护 AI 伴侣的情绪状态机，并提供情绪查询和状态转移 API。

除此之外，服务端还要为 admin 系统提供数据查询和系统配置接口。这些后台管理 API 会接触更敏感的数据，因此需要更严格的权限验证。

### 2.2 Next.js 客户端

客户端是用户日常使用的产品界面，设计重点是对话体验和交互响应。

**聊天界面**需要支持流式消息展示，也就是逐字输出效果，同时还要处理消息气泡、时间戳和情绪标签。它是整个产品中使用频率最高的交互区域，对响应速度和动画流畅度都有较高要求。

**用户注册与登录**负责账号体系的前端流程，包括邮箱注册和第三方登录。用户登录后，客户端还要管理 JWT token 的存储和自动刷新。

在**个人设置**中，用户可以配置 AI 伴侣的性格特征，例如温柔、理性或幽默，也可以调整记忆偏好，包括哪些话题更重要、是否允许系统记住某些信息，并管理自己的对话历史。

产品介绍页、功能说明页和定价页等入口页面需要对搜索引擎友好，因此适合使用 Next.js 的 SSG 能力生成静态页面。对话功能本身主要发生在客户端，但这些 SSR/SSG 落地页仍然承担产品介绍和搜索收录的职责。

客户端还需要提供**记忆回顾**功能，让用户查看 AI 伴侣保存了哪些与自己有关的信息，并允许用户手动删除或修正记忆。这项能力能够让记忆系统保持透明，也是建立用户信任的重要部分。

### 2.3 Next.js 后台管理系统

后台管理系统面向运营人员和开发者，用于观察产品运行状态、管理内容并调整 AI 行为。

**用户数据总览**会展示活跃用户数、日均对话轮次、记忆使用量和用户留存率等指标，帮助运营人员判断产品当前的使用情况。

**对话审计与内容安全**用于查看脱敏后的用户对话，识别不当内容并检查 AI 回复质量。这既是合规要求，也是持续改进回复效果的重要手段。

**Prompt 模板管理**允许运营人员在线编辑系统 Prompt、人设描述和情绪响应模板。模板需要支持版本管理，可以回滚到以前的版本，也要支持 A/B 测试，让两套 Prompt 同时运行并比较实际效果。这样一来，运营人员不需要修改代码，也能调整 AI 的行为。

**系统配置**包括 LLM 模型切换，例如在 GPT-4o、Claude 3.5 和开源模型之间选择；还包括记忆策略调整，例如遗忘曲线参数和记忆容量上限；情绪状态机的转移阈值和速率也需要在这里配置。

**运维监控**关注 API 请求延迟、错误率、Workers CPU 用量和 D1 查询性能等技术指标。系统出现异常时，运营人员需要尽快从这些指标中发现问题。

### 2.4 为什么拆成两个 Next.js 应用

客户端和后台管理系统都使用 Next.js，但不适合仅通过 `/app` 和 `/admin` 两组路由放进同一个应用。

首先，两者面对的用户群体完全不同。客户端可能需要承载数万到数百万终端用户，而后台通常只有几个到几十个管理员。访问规模不同，性能、缓存和部署策略也会随之变化。

其次，后台会接触用户对话和系统配置等敏感数据，需要独立的访问控制。分开部署后，可以使用不同的域名和安全策略，避免客户端出现 XSS 漏洞时，攻击者通过同一应用中的路由接触后台功能。

两套应用的发布节奏也不同。客户端会频繁迭代 UI 和产品功能，后台管理系统相对稳定。独立构建和部署，可以避免其中一方的发布影响另一方。

最后，后台通常会引入 ECharts、Recharts、表格组件和富文本编辑器等体积较大的依赖。拆成独立应用后，这些依赖不会进入客户端 bundle。

## 3. 为什么使用 Monorepo

确定三个子系统后，还需要选择仓库组织方式：把它们放进同一个 Monorepo，还是分别维护 server、web 和 admin 三个仓库。

这个项目选择 Monorepo，主要原因不是仓库数量更少，而是三个子系统之间存在紧密的类型和业务契约。

### 3.1 直接共享服务端类型

第 10 篇文章介绍了 Hono.js 的 RPC 类型安全调用。客户端可以从服务端路由中自动推导请求参数和响应类型，但前提是客户端能够直接引用服务端导出的类型。

types.ts

```typescript
// 服务端定义路由
const route = app.post('/chat',
  zValidator('json', chatSchema),
  async (c) => {
    const body = c.req.valid('json')
    return c.json({ reply: '...', emotion: 'happy' })
  }
)

// 导出类型
export type AppType = typeof route
```

client.ts

```typescript
// 客户端直接 import 服务端类型——这要求两者在同一个仓库
import type { AppType } from '@ai-companion/server'
import { hc } from 'hono/client'

const client = hc<AppType>('/api')
const res = await client.chat.$post({ json: { content: '你好' } })
// res 的类型自动推断，写错参数 TypeScript 直接报错
```

如果 server 和 web 位于不同仓库，这个 `import type` 就不能直接指向服务端源码。通常需要增加一套类型包发布流程：

- 在 server 仓库中把类型导出到 npm 包。

- 将类型包发布到 npm 或私有 registry。

- 在 web 仓库中安装这个包。

- server API 每次发生变化后，重新发布并安装新版本。

这套流程会增加维护成本，也会削弱 Hono RPC 直接引用路由定义的优势。类型经过 npm 包中转后，可能出现信息缺失或版本滞后。

在 Monorepo 中，`import type` 可以直接指向源码。API 修改后，TypeScript 编译器会立即在所有不兼容的调用位置报错，不需要额外发布类型包，就能保持端到端类型安全。

### 3.2 复用业务定义

三个子系统之间还有不少必须保持一致的业务逻辑，其中最典型的是 Zod Schema。

服务端使用 Zod 做运行时参数验证，客户端使用同一份 Schema 验证表单，后台也可以用它检查配置输入。定义只需要维护一份，三个应用会同时获得更新。

schema.ts

```typescript
// packages/shared/src/schema.ts
import { z } from 'zod'

export const chatRequestSchema = z.object({
  content: z.string().min(1).max(2000),
  session_id: z.string().uuid(),
})

export const emotionSchema = z.enum([
  'happy', 'sad', 'neutral', 'excited',
  'anxious', 'calm', 'curious', 'angry',
  'tender', 'playful'
])

export const memoryTypeSchema = z.enum([
  'episodic', 'semantic', 'preference'
])

// TypeScript 类型从 Zod 推断，不需要手动定义
export type ChatRequest = z.infer<typeof chatRequestSchema>
export type Emotion = z.infer<typeof emotionSchema>
export type MemoryType = z.infer<typeof memoryTypeSchema>
```

如果这些定义分散在三个仓库中，新增一种情绪状态时，就要分别修改、提交和发布。任何一个仓库遗漏更新，都可能在运行时产生不一致。

错误码也需要共享。服务端返回错误码后，客户端要显示对应的用户提示，后台则要按照同一套错误码做分类统计。除此之外，日期格式化、对话时间展示、记忆预览的文本截断和 ID 生成等工具函数，也会被多个应用共同使用。

### 3.3 原子提交与版本一致性

API 变更往往会同时影响多个子系统。假设对话接口新增一个 `emotion_hint` 字段，Monorepo 可以在一个 commit 中完成所有相关修改：server 增加字段处理，shared 更新 Schema，web 展示新字段，admin 在审计页面中展示对应内容。

代码审查者可以在同一个 PR 中看到完整的变更范围，确认没有遗漏后再合并。所有代码要么一起更新，要么保持原状。

在 Multirepo 中，同一项修改通常要分成四步：

- 在 shared 仓库更新 Schema 并发布新版本。

- 在 server 仓库升级依赖，实现新字段并部署。

- 在 web 仓库升级依赖，完成 UI 展示并部署。

- 在 admin 仓库升级依赖，完成审计展示并部署。

这些步骤之间存在时间差。server 已经部署而 web 还没有更新时，客户端会收到尚未处理的新字段；shared 已经发布而 server 忘记升级依赖时，运行时数据和类型定义也可能不一致。

这种版本同步成本是 Multirepo 组织方式带来的结构性问题，单靠开发者在每次发布时更加小心，很难彻底消除。

### 3.4 统一工具链

Monorepo 可以为所有子项目维护一套基础配置。例如，根目录提供一份 `tsconfig.json`，各应用通过 `extends` 继承；Biome 配置统一代码风格；一份 `yarn.lock` 保证依赖版本一致；CI/CD 则根据当前 PR 的变更范围判断需要执行哪些任务。

使用多个仓库时，每个仓库都要独立维护这些配置。升级 TypeScript、修改 lint 规则或统一代码格式时，也需要分别操作。时间久了，各仓库中的 `tsconfig` 和检查规则很容易出现配置漂移。

本地开发时，Monorepo 的反馈速度也更直接。开发者只需要克隆一个仓库并执行一条命令，就能启动三个子系统。server API 发生变化后，web 的类型检查会立即指出需要同步修改的位置。

在 Multirepo 中，开发者要分别克隆、安装和启动三个仓库。调试跨前后端问题时，需要在多个终端之间切换。shared 包需要本地联调时，还要借助 `yarn link` 或 `yalc` 建立本地包链接，而这些额外环节也可能带来环境问题。

### 3.5 与 Multirepo 对比

| 维度 | Monorepo | Multirepo |
| --- | --- | --- |
| 类型共享 | 直接 import，零延迟 | 需要发包、安装、版本对齐 |
| API 变更同步 | 原子提交，一个 PR 搞定 | 多仓库协调，存在时间差 |
| 工具链配置 | 一份配置，全局统一 | 多份配置，容易漂移 |
| 本地开发 | 一条命令启动所有服务 | 多终端、多仓库、需要 link |
| CI/CD | 一套流水线，按变更范围触发 | 多套流水线，跨仓库触发复杂 |
| 代码审查 | 一个 PR 看到完整变更 | 跨仓库 PR 关联困难 |
| 仓库体积 | 较大（但可接受） | 各自较小 |
| 权限控制 | 较粗（需要 CODEOWNERS） | 天然隔离 |

Multirepo 的仓库体积更小，权限也天然隔离，但这两点在当前项目中并不是决定性条件。AI 伴侣的代码规模不会达到 Google 或 Meta 那种大型 Monorepo 的量级，仓库权限也可以通过 GitHub 的 CODEOWNERS 文件进一步划分。

相比之下，类型共享、版本同步和本地开发体验会持续影响三个应用之间的协作，因此 Monorepo 更符合当前项目的需求。

## 4. 使用 Turborepo 管理 Monorepo

确定 Monorepo 方案后，还需要选择负责构建、测试和开发任务编排的工具。常见候选包括 Turborepo、Nx 和 Lerna。

### 4.1 为什么选择 Turborepo

Turborepo 由 Vercel 维护，与 Next.js 属于同一生态。它能够识别 Next.js 的 `.next` 构建输出、开发服务器和增量构建方式。项目中包含 web 和 admin 两个 Next.js 应用，这种集成可以减少额外配置。

它的任务配置也比较集中。一个 `turbo.json` 文件就可以描述任务之间的依赖关系：

turbo.json

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "dev": {
      "persistent": true,
      "cache": false
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "lint": {}
  }
}
```

这里的 `build` 会先构建当前项目依赖的内部包，也就是 `^build`；`dev` 是持续运行的开发服务，因此不使用缓存；`typecheck` 需要等待依赖包构建完成；`lint` 没有额外依赖，可以并行执行。

Turborepo 会根据任务输入和输出建立缓存。如果只修改 `apps/web`，`apps/admin` 和 `apps/server` 的构建可以直接命中缓存，不必重新执行。团队开启 Remote Cache 后，一名开发者已经生成的构建结果，其他开发者也可以直接复用。

Turborepo 不负责替代包管理器，而是与 yarn workspaces 配合使用。yarn workspaces 负责安装依赖并建立工作区包之间的链接，Turborepo 负责并行执行任务和管理缓存，两者的职责相互独立。

### 4.2 与 Nx、Lerna 对比

Nx 提供代码生成器、依赖图可视化和受影响项目检测等更完整的能力，适合拥有数十个子项目的大型团队。当前项目只有三个应用，它额外带来的学习和配置成本暂时没有必要。

Lerna 是较早流行的 Monorepo 工具，主要解决多个 npm 包的版本管理和发布问题。当前三个子项目都是独立部署的应用，不需要发布到 npm，因此 Lerna 的核心能力与这个项目并不匹配。

NOTE

Turborepo 不是功能最多的 Monorepo 工具，但它适合由三个子项目组成、使用 TypeScript 全栈并以 Next.js 为主的当前工程。

## 5. 整体架构

把前面的选择放在一起，可以得到整个 Monorepo 的结构关系：

`apps` 中包含 Hono 服务端、Next.js 客户端和 Next.js 后台管理系统，底层的 `packages` 提供共享类型与 Schema、公共 UI 组件，以及 `tsconfig` 和 Biome 等工程配置。Turborepo 负责组织构建和开发任务。

三个应用最终会独立部署：server 发布到 CloudFlare Workers，web 可以部署到 Vercel 或 CloudFlare Pages，admin 则可以内部部署，也可以在启用访问控制后部署到 Vercel。

## 6. 总结

AI 伴侣项目由三个职责独立的子系统组成：Hono 服务端负责对话编排，Next.js 客户端负责用户交互，Next.js 后台管理系统负责运营与维护。它们面向不同的用户群体，也拥有各自的部署策略。

选择 Monorepo，主要是为了直接共享 Hono RPC 类型和 Zod Schema，并让一次 API 变更能够通过原子提交同步修改所有调用方。统一的工具链和本地开发方式，则进一步减少了多应用协作时的维护成本。

项目会使用 Turborepo 和 yarn workspaces 管理工作区。Turborepo 负责任务编排与增量缓存，yarn workspaces 负责依赖安装和内部包链接。

下一篇文章会继续进入 Monorepo 内部，设计 `packages/shared` 和 `packages/ui` 的具体结构，说明如何抽取公共逻辑，并规划完整的开发工作流。
