---
title: "210 LangChain 与 LangGraph RAG"
pubDate: 2026-08-01
description: "手写最小 RAG 以后，我们已经知道检索和生成分别做什么。接下来使用 LangChain 和 LangGraph，重点不再是减少几行代码，而是选择合适的执行方式。"
tags: [AI编程, RAG, 向量检索, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/6-langchain-langgraph-rag/](https://aicompanion.usehook.cn/6-langchain-langgraph-rag/)

## 1. 选择框架前先选择流程

手写最小 RAG 以后，我们已经知道检索和生成分别做什么。接下来使用 LangChain 和 LangGraph，重点不再是减少几行代码，而是选择合适的执行方式。

公司制度问答通常希望每次都先检索，调用次数和延迟容易控制，适合 2-Step RAG。研究助手面对普通闲聊时可能不需要查资料，遇到事实问题时又要在多个知识源之间选择，适合 Agentic RAG。对权限、质量和重试有明确要求的系统，则更适合用 LangGraph 把步骤固定下来。

这三种方式没有高低之分。流程越自主，灵活性越高，测试空间和故障路径也会随之增加。

## 2. 使用当前依赖

本章按照当前 LangChain JavaScript 文档使用 `createAgent()`，向量存储使用 `@langchain/classic` 中的 `MemoryVectorStore`，文本切分使用独立的 `@langchain/textsplitters` 包。LangGraph 使用 `StateSchema`、`GraphNode` 和 `StateGraph`。

terminal

```shellscript
yarn add langchain @langchain/core @langchain/classic \
  @langchain/openai @langchain/textsplitters \
  @langchain/langgraph zod
```

网上仍然能看到 `createReactAgent()`、旧版 chain helper 和 `Annotation.Root()` 等示例。它们可能对应旧版本或不同层级的 API，复制前要先核对当前官方文档和项目锁定版本。

LangChain 当前的 [Retrieval 文档](https://docs.langchain.com/oss/javascript/langchain/retrieval) 将 2-Step、Agentic 和 Hybrid 作为不同 RAG 架构；LangGraph 当前 [Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api) 使用 `StateSchema` 定义图状态。

## 3. 准备共享知识库

三种架构可以共用同一个 Retriever。我们先准备一份内存知识库：

knowledge-base.ts

```typescript
import { Document } from '@langchain/core/documents'
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory'
import { OpenAIEmbeddings } from '@langchain/openai'

const embeddings = new OpenAIEmbeddings({
  model: 'text-embedding-3-small',
})

export const vectorStore = await MemoryVectorStore.fromDocuments(
  [
    new Document({
      id: 'leave-policy:v4:1',
      pageContent:
        '少于两天的年假，由直属负责人审批。',
      metadata: {
        source: '员工考勤制度',
        version: 4,
        topic: 'leave',
      },
    }),
    new Document({
      id: 'leave-policy:v4:2',
      pageContent:
        '连续两天及以上的年假，需要直属负责人和部门负责人共同审批。',
      metadata: {
        source: '员工考勤制度',
        version: 4,
        topic: 'leave',
      },
    }),
    new Document({
      id: 'expense-policy:v2:1',
      pageContent:
        '差旅报销应在费用发生后 30 天内提交。',
      metadata: {
        source: '差旅报销制度',
        version: 2,
        topic: 'expense',
      },
    }),
  ],
  embeddings,
)

export const retriever = vectorStore.asRetriever({
  k: 6,
  searchType: 'mmr',
  searchKwargs: {
    fetchK: 20,
  },
})
```

内存向量库只用于教学。替换为持久化服务时，Retriever 以上的流程仍然可以保留。

## 4. 2-Step RAG

2-Step RAG 的检索一定发生在生成之前。它执行一次 Retriever 和一次聊天模型，最适合作为第一版。

two-step-rag.ts

```typescript
import type { Document } from '@langchain/core/documents'
import { ChatOpenAI } from '@langchain/openai'
import { retriever } from './knowledge-base'

const model = new ChatOpenAI({
  model: 'gpt-4.1-mini',
  temperature: 0,
})

function formatDocuments(documents: Document[]) {
  return documents
    .map((document, index) => {
      return [
        `[S${index + 1}]`,
        `来源：${document.metadata.source}`,
        document.pageContent,
      ].join('\n')
    })
    .join('\n\n')
}

export async function runTwoStepRag(question: string) {
  const documents = await retriever.invoke(question)
  const context = formatDocuments(documents)

  const response = await model.invoke([
    {
      role: 'system',
      content: `你是公司制度助手。
只能依据用户消息中提供的资料回答。
资料不足时说明无法确认。
回答事实时标注来源编号。`,
    },
    {
      role: 'user',
      content: `资料：
${context}

问题：
${question}`,
    },
  ])

  return {
    answer: response.content,
    documents,
  }
}
```

这段代码没有把 Retriever 藏在 Agent 内部，因此容易测试和追踪。检索失败时查看 `documents`，回答失败时再检查 Prompt 和模型。

对于公司知识库、客服 FAQ 和固定领域问答，优先使用这种结构通常更稳。

## 5. Agentic RAG

Agentic RAG 把检索变成工具。模型可以根据对话判断要不要查、用什么查询词查，以及是否再次检索。

当前 LangChain v1 使用 `tool()` 定义工具，使用 `createAgent()` 创建 Agent：

agentic-rag.ts

```typescript
import * as z from 'zod'
import { createAgent, tool } from 'langchain'
import { ChatOpenAI } from '@langchain/openai'
import { retriever } from './knowledge-base'

const searchPolicy = tool(
  async ({ query }) => {
    const documents = await retriever.invoke(query)

    if (documents.length === 0) {
      return '没有找到相关制度。'
    }

    return documents
      .map((document, index) => {
        return [
          `[S${index + 1}]`,
          `来源：${document.metadata.source}`,
          document.pageContent,
        ].join('\n')
      })
      .join('\n\n')
  },
  {
    name: 'search_company_policy',
    description:
      '查询公司的请假、考勤和报销制度。涉及公司规则时使用；普通闲聊不要调用。',
    schema: z.object({
      query: z
        .string()
        .min(2)
        .describe('独立完整、适合检索制度的中文问题'),
    }),
  },
)

const agent = createAgent({
  model: new ChatOpenAI({
    model: 'gpt-4.1-mini',
    temperature: 0,
  }),
  tools: [searchPolicy],
  systemPrompt: `你是公司助手。
涉及公司制度时，必须先调用 search_company_policy。
只能根据工具返回的资料陈述制度。
工具没有找到资料时，不要自行编造。`,
})

const result = await agent.invoke({
  messages: [
    {
      role: 'user',
      content: '我想休两天年假，需要哪些人审批？',
    },
  ],
})
```

工具描述很重要。描述过于宽泛，Agent 可能在普通聊天中频繁调用；描述过于狭窄，又会漏掉同义表达。

Agentic RAG 还要限制循环次数、工具权限和返回数据量。模型如果连续改写并检索五次，答案未必更好，延迟和成本却会明显增加。

## 6. 使用 LangGraph 固定质量流程

当流程中加入查询改写、检索判断、重试和降级后，把所有逻辑放进一个函数会越来越难读。LangGraph 适合把这些步骤明确成节点。

下面定义一个受控 RAG 状态：

rag-state.ts

```typescript
import * as z from 'zod'
import { StateSchema } from '@langchain/langgraph'

export const RagState = new StateSchema({
  question: z.string(),
  retrievalQuery: z.string().default(''),
  documents: z
    .array(
      z.object({
        id: z.string(),
        content: z.string(),
        source: z.string(),
      }),
    )
    .default(() => []),
  retrievalPassed: z.boolean().default(false),
  answer: z.string().default(''),
})
```

图状态只保存后续节点确实需要的数据。完整向量、数据库连接和模型客户端不适合塞进可持久化状态，可以通过模块依赖或 Runtime Context 传入。

接下来实现节点：

rag-nodes.ts

```typescript
import * as z from 'zod'
import type { GraphNode } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'
import { RagState } from './rag-state'
import { retriever } from './knowledge-base'

const model = new ChatOpenAI({
  model: 'gpt-4.1-mini',
  temperature: 0,
})

const rewriteQuery: GraphNode<typeof RagState> = async (state) => {
  const response = await model.invoke([
    {
      role: 'system',
      content:
        '把用户问题改写成独立、完整的制度检索问题。只输出改写结果。',
    },
    {
      role: 'user',
      content: state.question,
    },
  ])

  return {
    retrievalQuery:
      typeof response.content === 'string'
        ? response.content.trim()
        : state.question,
  }
}

const retrieve: GraphNode<typeof RagState> = async (state) => {
  const documents = await retriever.invoke(state.retrievalQuery)

  return {
    documents: documents.map((document, index) => ({
      id: document.id ?? `candidate-${index}`,
      content: document.pageContent,
      source: String(document.metadata.source ?? 'unknown'),
    })),
  }
}

const gradeSchema = z.object({
  passed: z.boolean(),
  reason: z.string(),
})

const gradeModel = model.withStructuredOutput(gradeSchema, {
  name: 'grade_retrieval',
})

const gradeRetrieval: GraphNode<typeof RagState> = async (state) => {
  if (state.documents.length === 0) {
    return { retrievalPassed: false }
  }

  const grade = await gradeModel.invoke([
    {
      role: 'system',
      content:
        '判断候选资料是否包含回答用户问题所需的信息。不要补充资料之外的知识。',
    },
    {
      role: 'user',
      content: `问题：${state.question}

候选资料：
${state.documents.map((document) => document.content).join('\n\n')}`,
    },
  ])

  return {
    retrievalPassed: grade.passed,
  }
}

const generate: GraphNode<typeof RagState> = async (state) => {
  const context = state.documents
    .map((document, index) => {
      return `[S${index + 1}] ${document.source}\n${document.content}`
    })
    .join('\n\n')

  const response = await model.invoke([
    {
      role: 'system',
      content:
        '只根据提供的资料回答，并在事实后标注来源编号。',
    },
    {
      role: 'user',
      content: `资料：
${context}

问题：
${state.question}`,
    },
  ])

  return {
    answer:
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content),
  }
}

const fallback: GraphNode<typeof RagState> = () => {
  return {
    answer: '现有制度资料不足以回答这个问题。',
  }
}

export {
  rewriteQuery,
  retrieve,
  gradeRetrieval,
  generate,
  fallback,
}
```

最后连接节点：

rag-graph.ts

```typescript
import {
  END,
  START,
  StateGraph,
} from '@langchain/langgraph'
import { RagState } from './rag-state'
import {
  rewriteQuery,
  retrieve,
  gradeRetrieval,
  generate,
  fallback,
} from './rag-nodes'

export const ragGraph = new StateGraph(RagState)
  .addNode('rewrite_query', rewriteQuery)
  .addNode('retrieve', retrieve)
  .addNode('grade_retrieval', gradeRetrieval)
  .addNode('generate', generate)
  .addNode('fallback', fallback)
  .addEdge(START, 'rewrite_query')
  .addEdge('rewrite_query', 'retrieve')
  .addEdge('retrieve', 'grade_retrieval')
  .addConditionalEdges('grade_retrieval', (state) => {
    return state.retrievalPassed ? 'generate' : 'fallback'
  })
  .addEdge('generate', END)
  .addEdge('fallback', END)
  .compile()

const result = await ragGraph.invoke({
  question: '我想休两天年假，需要哪些人审批？',
})
```

这个图仍然是固定流程，只是把质量判断显式放进状态和节点。后面可以继续增加“改写后重试一次”，但必须设置明确终止条件，避免图在低质量结果上无限循环。

## 7. 三种方式怎样选择

| 方式 | 适合场景 | 优点 | 主要风险 |
| --- | --- | --- | --- |
| 2-Step RAG | 制度、FAQ、垂直知识库 | 快、可预测、容易评测 | 每次都会检索，灵活性较低 |
| Agentic RAG | 多数据源研究助手 | Agent 能决定何时和怎样查 | 路径不稳定，成本和延迟波动 |
| LangGraph 工作流 | 有质量门禁、重试和审批 | 状态清楚，流程可控 | 节点和状态设计成本更高 |

不要因为项目名称里有 Agent，就默认选择 Agentic RAG。很多 Agent 产品中的知识问答仍然适合固定检索；Agent 可以负责更高层的任务决策，检索内部保持确定性。

## 8. 常见实现问题

### 检索工具返回太多内容

Agent 工具一次返回几十个 chunk，会迅速占满上下文。工具应当返回经过筛选的结果和来源，完整调试数据放在追踪系统中。

### 查询改写改变原意

用户问“那超过两天呢”，改写有帮助；用户问“不要查公司制度，只说一般情况”，改写模型可能擅自补成制度问题。应保留原始问题、记录改写结果，并在评测集中加入否定和边界案例。

### 质量判断只看有没有结果

向量库几乎总能返回最相近的内容，`documents.length > 0` 不代表资料足够。需要结合分数、规则或评测模型判断相关性，并允许走无答案分支。

### Agent 反复调用检索

工具描述冲突、结果格式不清或 Prompt 没有限制时，Agent 可能重复查询。应设置最大步骤数、记录工具轨迹，并让工具结果清楚表达来源与是否命中。

## 9. 面试中常见追问

**为什么不全部使用 Agentic RAG？**

固定知识问答的检索步骤明确，2-Step RAG 的延迟、成本和测试更可控。只有问题确实需要动态选择数据源或多轮探索时，Agentic RAG 的灵活性才值得额外复杂度。

**LangGraph 对 RAG 有什么价值？**

LangGraph 不负责提高向量相似度，它负责把查询改写、召回、质量判断、重试、生成和降级组织成可观察、可持久化的状态流程。

**检索结果为空才降级吗？**

不是。向量搜索通常不会真正为空，更重要的是候选是否相关、权限是否正确、分数是否达到经过校准的范围，以及资料是否覆盖问题所需事实。

## 10. 总结

LangChain 提供文档、Embedding、VectorStore、Retriever、Tool 和 Agent 抽象；LangGraph 负责把多步检索过程组织成明确状态和节点。

第一版知识库优先采用 2-Step RAG。需要动态选择检索工具时再使用 Agentic RAG；出现质量判断、重试和人工介入等稳定流程后，用 LangGraph 将它们显式建模。

下一篇不再增加框架能力，而是专门处理最棘手的问题：资料明明已经入库，为什么检索仍然不准，以及怎样用混合召回、查询改写和重排逐步改善结果。
