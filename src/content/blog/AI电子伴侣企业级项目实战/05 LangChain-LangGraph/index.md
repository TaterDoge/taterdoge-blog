---
title: "05 LangChain/LangGraph"
pubDate: 2026-04-14
description: "在上一节我们介绍了 AI 伴侣的内存调度架构。在具体的工程实现中，LangChain 和 LangGraph 并非必需品，但它们提供了强大的抽象和编排能力。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-07-28
---
原文链接：[https://aicompanion.usehook.cn/3langchain-langgraph/](https://aicompanion.usehook.cn/3langchain-langgraph/)

## 1. 为什么选择 LangChain 和 LangGraph

在上一节我们介绍了 AI 伴侣的内存调度架构。在具体的工程实现中，**LangChain** 和 **LangGraph** 并非必需品，但它们提供了强大的抽象和编排能力。

如果把构建 AI 电子女友比作「造人」，那么 **LangChain 是她的「器官和肢体」**（负责具体功能的执行），而 **LangGraph 则是她的「神经中枢和大脑皮层」**（负责决策、记忆调度和状态维持）

在「上下文管理的调度机制」中，两者的分工非常明确

## 2. LangGraph：核心调度器（大脑与神经系统）

在没有 LangGraph 之前，使用 LangChain 构建的 Agent 通常是线性的（Chain），很难处理复杂的来回跳转。而在 AI 电子女友场景中，**LangGraph 的核心作用是构建一个“有状态的循环图”**，它是调度机制的**宿主**。

**全局状态管理（The State Schema）**

这是调度机制的基石。LangGraph 允许你定义一个 `State` 对象，这个对象不仅仅包含“对话历史”，还包含所有的元数据。它就像一个流动的档案袋，在对话的每一步流转。

代码概念示例如下：

index.ts

```typescript
import { BaseMessage } from "@langchain/core/messages";

// 定义 Agent 的状态结构
interface AgentState {
  // 对话历史
  messages: BaseMessage[];
  // 用户画像（姓名、喜好）
  userProfile: Record<string, any>;
  // 当前女友心情（开心/生气/抑郁）
  npcMood: 'happy' | 'angry' | 'depressed';
  // 亲密度数值
  intimacyLevel: number;
  // 这一轮对话中检索到的相关长期记忆
  longTermMemories: string[];
  // 调度器决定的下一步动作
  nextStep: string;
}
```

如果没有 LangGraph，你需要自己写大量的全局变量或数据库读写逻辑来在不同函数间传递这些参数。

**决策路由（Conditional Edges as Dispatcher）**

这是调度机制的**核心逻辑体现**。LangGraph 允许你定义“条件边”，根据当前的状态决定下一步走哪个节点。例如如下场景：

- 如果 `npcMood === 'Angry'` -> 路由到 `ColdReplyNode`（冷淡回复节点）。

- 如果 `userInput` 包含“还记得吗” -> 路由到 `RAGRetrievalNode`（记忆检索节点）。

- 如果 `time === 'LateNight'` -> 路由到 `SleepCheckNode`（晚安检查节点）。

它将复杂的逻辑解耦。你不需要写一个 5000 行的 Prompt 让 LLM 既扮演女友又扮演数据库管理员，而是将它们拆分成不同的**Node（节点）**。

**持久化与记忆连续性（Checkpointers）**

AI 女友最怕“断片”。LangGraph 内置了 Checkpointer 机制（通常基于 SQLite, Postgres 或 Redis）。当用户关闭 App，明天再打开时，LangGraph 会从数据库加载昨天的 `AgentState`。这意味着她不仅记得聊天记录，还记得昨天聊完后的 `npcMood` 是“害羞”。

所以，调度器不需要每次都重新计算好感度，直接读取持久化状态即可。

## 3. LangChain：执行具体能力

LangGraph 负责安排下一步要做什么，LangChain 则把这一步真正执行出来。对内存调度器来说，这些能力主要集中在长期记忆检索、动态 Prompt 组装和工具调用上。

先来看长期记忆检索。当 `MemoryNode` 判断当前问题需要回忆过去时，它可以把已经配置好的 Pinecone、Milvus 或 Cloudflare Vectorize 向量库转换成 Retriever。Retriever 本身遵循 Runnable 接口，接收一个字符串查询，并返回相关的 `Document` 数组，因此检索时可以直接调用 `retriever.invoke()`：

memory-node.ts

```typescript
const retriever = vectorStore.asRetriever({
  k: 3,
})

const documents = await retriever.invoke('第一次约会')

const memory = documents
  .map((document) => document.pageContent)
  .join('\n\n')
```

这段代码会取回相似度最高的三条记忆。查询文本的向量化和相似度搜索由已经配置好 Embeddings 的 VectorStore 完成，`MemoryNode` 只需要关心查询内容以及如何使用返回的文档。

拿到记忆以后，还要把它和当前情绪、用户输入一起整理成模型可以理解的消息。`ChatPromptTemplate.fromMessages()` 仍然是当前可用的 Prompt Template 写法，而 LCEL 可以通过 `pipe()` 把模板和模型连接起来：

reply-chain.ts

```typescript
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { initChatModel } from 'langchain'

const model = await initChatModel('gpt-4.1-mini', {
  modelProvider: 'openai',
})

const prompt = ChatPromptTemplate.fromMessages([
  ['system', '你现在的状态是 {mood}。相关回忆：{memory}。'],
  ['human', '{input}'],
])

const replyChain = prompt.pipe(model)

const response = await replyChain.invoke({
  mood: 'happy',
  memory: '喜欢吃辣',
  input: '今晚想吃点什么？',
})
```

在这段调用中，LangGraph 只需要把状态里的 `mood`、`memory` 和 `input` 交给 Chain。LangChain 会先完成模板变量替换，再把生成的消息发送给模型。这样可以把状态判断留在图里，把消息格式化和模型调用留在 Chain 中，两边的职责不会混在一起。

工具调用的边界也需要分清。假设用户问“明天我生日是周几？”，可以先用 LangChain 的 `tool()` 定义日历工具，再把同一份工具同时交给模型和 LangGraph 的 `ToolNode`：

calendar-tool.ts

```typescript
import * as z from 'zod'
import { initChatModel, tool } from 'langchain'
import { ToolNode } from '@langchain/langgraph/prebuilt'

const model = await initChatModel('gpt-4.1-mini', {
  modelProvider: 'openai',
})

const calendarTool = tool(
  async ({ date }) => {
    return new Intl.DateTimeFormat('zh-CN', {
      weekday: 'long',
      timeZone: 'Asia/Shanghai',
    }).format(new Date(`${date}T00:00:00+08:00`))
  },
  {
    name: 'get_calendar_weekday',
    description: '查询指定日期是星期几',
    schema: z.object({
      date: z.string().describe('需要查询的日期，格式为 YYYY-MM-DD'),
    }),
  },
)

const tools = [calendarTool]
const modelWithTools = model.bindTools(tools)
const toolsNode = new ToolNode(tools)
```

`bindTools()` 只是让模型知道有哪些工具可以调用，并不会真正执行函数。当模型返回 `tool_calls` 后，LangGraph 可以通过 `toolsCondition` 把流程路由到 `ToolNode`。`ToolNode` 执行 `calendarTool`，把结果转换成 `ToolMessage` 写回状态，然后流程再回到模型节点生成最终回复。

## 4. 一次完整协作

我们继续使用“吵架后用户求和”的场景，把前面的能力串起来。用户发来一句：“宝宝别生气了，我给你买了你最爱的草莓蛋糕。”

LangGraph 收到消息后，先根据当前会话的 `thread_id` 加载 Checkpoint。恢复出的状态表明，`npcMood` 仍然是 `angry`，上一件重要事件是 `fight`。这些信息会和本轮用户输入一起进入 `Router`，由轻量级 LLM 或分类器识别出 `Apology`（道歉）和 `Gift_Giving`（送礼）两个意图。

此时系统还不能直接生成回复。路由器发现用户带来了礼物，于是把流程交给 `EvaluateGiftNode`。这个节点继续调用 `MemoryNode`，通过 LangChain Retriever 在向量库中检索“最爱的蛋糕”。检索结果显示，用户曾在 2023 年说过自己最喜欢的是巧克力蛋糕，而不是草莓蛋糕。

这条记忆会改变后续判断。业务上可以把 `npcMood` 从 `angry` 提升为 `furious`，同时在 `Context` 中加入“礼物不对版”的标记。前文示例中的 `npcMood` 联合类型还没有 `furious`，实际写入这个值之前需要先扩展 State Schema，否则 TypeScript 会拒绝这次状态更新。这里更新的是图状态，后面的节点可以直接读取，不需要把相同判断反复写进 Prompt。

流程进入 `Generator` 后，LangChain 根据新的状态组装 Prompt：加载“暴怒女友”的 System Prompt，再补入“草莓蛋糕与巧克力蛋糕不一致”这条记忆。模型最终回复：“草莓？我们要分手了你都不知道我只吃巧克力蛋糕吗？！”

回复生成后，LangGraph 把最新的 `furious` 状态写入 Checkpoint，结束本轮运行。下一次用户继续道歉时，图会从这个状态恢复，而不是重新把整段冲突从头判断一遍。

## 5. 总结

LangChain 负责模型调用、Prompt 组装、记忆检索和外部工具执行，这些都是可以在单个节点中复用的具体能力。LangGraph 负责保存状态、连接节点和选择分支，决定当前应该先检索还是先回复、情绪变化后进入哪段逻辑，以及本轮状态如何延续到下一次会话。

两者都不是构建 Agent 的强制依赖，简单流程完全可以自行实现。随着状态字段、分支和工具逐渐增多，它们的价值才会变得明显：LangChain 减少具体能力的重复封装，LangGraph 则让调度过程保持清楚，避免所有判断都挤进一个巨大 Prompt 或一组彼此嵌套的条件语句中。
