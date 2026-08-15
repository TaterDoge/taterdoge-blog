---
title: "36 记忆持久化与混合策略"
pubDate: 2026-04-23
description: "import { MemorySaver } from '@langchain/langgraph'"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/12-memory-persistence/](https://aicompanion.usehook.cn/12-memory-persistence/)

## 1. 记住刚才聊过什么，还不算持久化

上一篇讲的是多轮对话里，历史消息怎么重新回到链路里。

那还只是第一步。

如果你把服务重启一次，或者把页面关掉再打开，就会发现另一个问题：

- 这段会话还能不能接着聊

- 这个用户之前留下的重要信息还能不能找回来

这两个问题看起来都像“记忆”，但其实不是一回事。

- **短期持久化**：把这一段会话线程保存下来，下次还能接着聊

- **长期记忆**：把用户资料、偏好、重要事件单独存起来，下次还能拿来用

这一篇就围绕这两层来写。

## 2. 先把两层记忆分开

先看一个最容易混淆的地方。

用户连续发三句话：

- 我今天又加班了

- 还是因为上次那个需求

- 你还记得我刚才在说什么吗

这里需要的是**短期持久化**。

因为这三句话属于同一段会话，核心问题是：这段线程有没有继续保留下来。

但如果用户过了三天再来，说：

- 我上次跟你说过我在准备字节面试

- 你还记得我不喜欢太说教的回复吗

这时候需要的就不只是短期线程了，还需要**长期记忆**。

也就是那些跨会话仍然值得保存的资料。

可以先把职责记成这样：

- `thread_id`：区分这是哪一段会话

- `checkpointer`：保存这段会话里的短期状态

- 数据库：保存跨会话的长期资料

如果把这三层混在一起，后面会很难维护。

短期状态更新频率高，长期资料更新频率低，两者天然不是一种数据。

## 3. 短期持久化：checkpointer + thread_id

这里直接把短期记忆接到 Agent 上。

先看最小示例：

agent-short-memory.ts

```typescript
import { createAgent } from 'langchain'
import { MemorySaver } from '@langchain/langgraph'

// 这里先用 MemorySaver 演示线程状态怎么保存。
// 它适合本地调试，不适合真正的持久化部署。
const checkpointer = new MemorySaver()

const agent = createAgent({
  model: 'openai:gpt-4.1-mini',
  tools: [],
  checkpointer,
})

const config = {
  configurable: {
    // 同一个 thread_id 表示同一段会话。
    thread_id: 'companion-user-001',
  },
}

await agent.invoke(
  {
    messages: [{ role: 'user', content: '我今天加班到快 11 点。' }],
  },
  config,
)

await agent.invoke(
  {
    messages: [{ role: 'user', content: '还是上次那个需求，已经改了第三版。' }],
  },
  config,
)

const result = await agent.invoke(
  {
    messages: [{ role: 'user', content: '你还记得我刚才在烦什么吗？' }],
  },
  config,
)

console.log(result.messages.at(-1)?.text)
```

这段代码里，真正起作用的是这两个东西：

- `thread_id` 决定这三次调用是不是同一段会话

- `checkpointer` 决定这段会话状态有没有被保存下来

只要 `thread_id` 不变，后面的调用就能接住前面的上下文。

这里要特别注意一件事：

**`MemorySaver` 只是演示用的内存版 checkpointer。**

它能帮你看懂 Agent 的短期记忆怎么工作，但服务一重启，数据还是会丢。

真正要做持久化，就要把 `checkpointer` 换成能写数据库或持久存储的实现。

## 4. 真正的持久化，要分成两层

很多人第一次做这里时，会把注意力放在 Prompt 上：

- 要不要多拼几条历史消息

- 要不要做摘要

- 要不要把上轮回复重新塞进去

这些当然重要，但它们解决的是“带多少上下文进去”。

**持久化真正要解决的是：这些状态存到哪里。**

如果还是只放在进程内存里：

- 页面刷新可能没事

- 服务一重启就丢

- 多实例部署时也接不住

所以这一步的关键，不是重写 Agent，而是换掉底下的状态保存方式。

在项目里可以先这样理解：

- 本地验证：`MemorySaver`

- 生产环境：换成持久化 `checkpointer`

如果你的应用本来就跑在关系型数据库体系里，通常会选数据库型的持久化后端来保存线程状态。

如果你的主系统部署在 Cloudflare 上，也可以继续把长期资料留在 D1，把线程状态交给适合做会话状态保存的持久化后端。

这里最重要的不是先背所有后端名字，而是先记住两句话：

- **短期持久化靠 `checkpointer`，不是靠手动把历史再拼一遍。**

- **长期记忆不要塞进线程里。**

再看另一类信息：

- 用户叫小林

- 是前端开发

- 最近在准备字节面试

- 不喜欢太说教的语气

这些信息就不适合放在会话线程里一路滚下去。

原因很简单：

- 它们不是“刚才这几轮才有意义”的上下文

- 它们更新频率低

- 它们下次会话还要继续用

所以更合理的做法是：

- 线程状态交给 `checkpointer`

- 用户画像、偏好、重要事件放进数据库

- 每次调用 Agent 前，先把这些长期资料读出来，再一起带进去

如果项目部署在 Cloudflare 上，这层长期资料继续放 D1 会比较顺手。

因为它本来就适合存结构化数据，比如：

- `conversations`：会话元数据，我有哪几次会话

- `user_profiles`：用户画像，这个用户平时是什么样的人

- `memories`：长期记忆条目，哪些事情以后还值得记住

## 5. 把长期记忆接回 Agent

下面这个例子把两层放到一起：

- `thread_id + checkpointer` 负责短期持久化

- D1 里的用户资料负责长期记忆

agent-persistence.ts

```typescript
import { createAgent } from 'langchain'
import { MemorySaver } from '@langchain/langgraph'

declare const env: { DB: D1Database }

const checkpointer = new MemorySaver()

const agent = createAgent({
  model: 'openai:gpt-4.1-mini',
  tools: [],
  checkpointer,
})

async function loadUserProfile(userId: string) {
  // 这里用假数据演示。
  // 实际项目里可以从 D1 的 user_profiles / memories 表查询。
  return {
    name: '小林',
    occupation: '前端开发',
    preferences: ['回复简短一点', '不要太说教'],
    recentEvents: ['上周刚结束字节二面', '最近在补系统设计'],
  }
}

async function runAgent(input: string) {
  // 1. 先从数据库里读取这个用户的长期资料。
  const profile = await loadUserProfile('user-001')

  const result = await agent.invoke(
    {
      messages: [
        {
          role: 'system',
          content: `你是小林的 AI 伴侣。

已知信息：
- 职业：${profile.occupation}
- 回复偏好：${profile.preferences.join('、')}
- 近期事件：${profile.recentEvents.join('、')}

如果用户提到这些内容，要自然接住，不要生硬复述。`,
        },
        {
          // 2. 这一轮新消息还是普通的 user 消息。
          role: 'user',
          content: input,
        },
      ],
    },
    {
      configurable: {
        // 3. 同一个 thread_id 负责接住这段会话里的短期上下文。
        thread_id: 'companion-user-001',
      },
    },
  )

  // 4. 最后一条消息就是 Agent 这一轮生成的回复。
  return result.messages.at(-1)?.text ?? ''
}

await runAgent('我今天又在改上次那个需求。')
await runAgent('还是觉得很烦，像是一直在原地打转。')
```

这段代码里，分工要看清楚：

- `loadUserProfile()` 负责长期记忆读取

- `thread_id` 负责会话线程识别

- `checkpointer` 负责短期状态保存

- `agent.invoke()` 负责把这两层信息一起接起来

这样做有一个很直接的好处：

- 线程状态可以一直跟着这一段会话走

- 用户画像不需要每轮重新生成

- 换会话时，长期资料还能继续复用

## 6. 长期记忆要在会话后写回

只读不写，长期记忆就永远不会更新。

比较常见的做法是：在一段会话结束后，再单独跑一次提取逻辑，把值得长期保留的信息写回数据库。

extract-memory.ts

```typescript
import { ChatOpenAI } from '@langchain/openai'
import { JsonOutputParser } from '@langchain/core/output_parsers'

declare const env: { DB: D1Database }

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})

const parser = new JsonOutputParser()

async function extractLongTermMemory(conversationText: string) {
  // 这里提取的是“值得跨会话保留的信息”，
  // 不是把整段原始聊天再存一遍。
  const prompt = `请从下面这段对话里提取长期记忆。

返回 JSON，包含：
- facts: 用户事实
- events: 重要事件
- preferences: 用户偏好
- emotionSnapshot: 情绪概括

对话内容：
${conversationText}`

  const response = await model.invoke(prompt)
  return parser.invoke(response)
}

async function saveLongTermMemory(userId: string, conversationId: string, memory: any) {
  // 这里把提取出来的长期信息拆成一条条记录写进 memories 表。
  // 实际项目里可以再补 type、score、source 等字段。
  const rows = [
    ...(memory.facts ?? []).map((content: string) => ({
      type: 'fact',
      content,
    })),
    ...(memory.events ?? []).map((content: string) => ({
      type: 'event',
      content,
    })),
    ...(memory.preferences ?? []).map((content: string) => ({
      type: 'preference',
      content,
    })),
    ...(memory.emotionSnapshot ? [{
      type: 'emotion_snapshot',
      content: memory.emotionSnapshot,
    }] : []),
  ]

  for (const row of rows) {
    await env.DB.prepare(
      `INSERT INTO memories (user_id, conversation_id, type, content)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(userId, conversationId, row.type, row.content)
      .run()
  }
}

async function persistConversationMemory() {
  const extracted = await extractLongTermMemory(`
用户：我今天又在准备字节的二面，还是有点焦虑。
助手：你更担心面试本身，还是等结果这段时间？
用户：主要是等结果，而且我还是不喜欢别人一直给我灌鸡汤。
  `)

  // 先提取，再写库。
  await saveLongTermMemory('user-001', 'conversation-20260330', extracted)
}
```

这一步做完以后，下次 `loadUserProfile()` 读到的就不只是老数据了，还会包含这次会话沉淀下来的新信息。

所以这篇里真正的闭环是：

- 进入会话前，读长期记忆

- 会话过程中，用 `thread_id + checkpointer` 接住短期状态

- 会话结束后，再把值得保留的信息写回长期记忆

## 7. classic 资料怎么看

你在很多旧文章里还是会看到这些写法：

- `BufferMemory`

- `ConversationSummaryBufferMemory`

- `CloudflareD1MessageHistory`

- `PostgresChatMessageHistory`

它们不是不能用，但更适合放在两种场景里看：

- 你在维护旧项目

- 你在理解历史资料

如果是从头搭一套新的 Agent 应用，前面的优先顺序更稳一些：

- Agent 的短期上下文先走 `checkpointer`

- 长期记忆单独存数据库

- classic memory 当兼容知识，不当正文重点
