---
title: "39 RAG 检索增强生成"
pubDate: 2026-04-24
description: "import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory'"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/15-rag-pipeline/](https://aicompanion.usehook.cn/15-rag-pipeline/)

## 1. 前面几篇，终于要接成一条线了

到这里，前面几篇已经把材料都准备好了：

- 文档已经读进来了

- 文档已经切成块了

- 块已经做了 embedding

- 向量库也能查了

这一篇做的事情很简单：

把这些步骤真正接起来，变成一条能给 Agent 用的检索回答链。

也就是说，用户发来一个问题以后，不再是直接让 Agent 硬答，而是先走一圈：

- 用问题去检索资料

- 把检索结果整理成上下文

- 再把这段上下文交给 Agent

这就是我们这里要实现的 RAG。

## 2. 最小可用版本，其实就三步

最小可用版本只有三步：

- 检索

- 组上下文

- 交给 Agent

rag-minimal.ts

```typescript
import { createAgent } from 'langchain'
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory'
import { OpenAIEmbeddings } from '@langchain/openai'
import { Document } from '@langchain/core/documents'

const embeddings = new OpenAIEmbeddings({
  // 先用最常见的小模型把流程跑通。
  model: 'text-embedding-3-small',
})

// 这里先准备一份最小知识库。
// 正式项目里，这些 Document 往往来自前面几篇的 Loader + Splitter。
const vectorStore = await MemoryVectorStore.fromDocuments(
  [
    new Document({
      pageContent: '退款政策：购买后 30 天内可申请无条件退款。超过 30 天需要提供商品质量问题证明。',
      metadata: { source: 'policy.pdf' },
    }),
    new Document({
      pageContent: '配送说明：标准配送 3 到 5 个工作日，加急配送 1 到 2 个工作日。',
      metadata: { source: 'policy.pdf' },
    }),
  ],
  embeddings,
)

const agent = createAgent({
  model: 'openai:gpt-4.1-mini',
  tools: [],
})

async function answer(question: string) {
  // 1. 先从向量库里找最相关的资料。
  const docs = await vectorStore.similaritySearch(question, 2)

  // 2. 再把资料整理成一段上下文，交给后面的 Agent 使用。
  const context = docs.map((doc) => doc.pageContent).join('\n\n')

  const result = await agent.invoke({
    messages: [
      {
        // system 负责告诉 Agent：下面这段内容是外部资料，不要脱离资料乱答。
        role: 'system',
        content: `你是客服助手。

请优先根据下面的参考资料回答用户问题。
如果资料里没有明确答案，就直接说不知道，不要编造。

参考资料：
${context}`,
      },
      {
        // user 仍然保留用户原始问题。
        role: 'user',
        content: question,
      },
    ],
  })

  // 3. 最后一条消息就是这一轮回答。
  return result.messages.at(-1)?.text ?? ''
}

const answerText = await answer('买完东西多久内可以退款？')
// 这里拿到的已经是“检索 + 回答”合在一起后的最终结果。
console.log(answerText)
```

这就是一条完整的 RAG 链了。

虽然很短，但已经把“先查，再答”这件事跑通了。

## 3. 检索这一步，和 Agent 不是一回事

这一点要刻意分开。

在这条链里：

- **向量库检索** 负责找资料

- **Agent** 负责基于资料组织回答

很多人第一次写 RAG 时，会把这两件事糊成一团，最后变成：

- Agent 既要理解问题

- 又要自己决定查什么

- 还要自己整理资料

- 最后还要回答

一上来这么堆，很容易乱。

所以这里先用最直接的分工：

- 检索层先返回 `Document[]`

- 再把这些文档拼成 `context`

- 最后统一交给 Agent

这样出了问题更容易查：

- 找不到资料，是检索问题

- 资料找到了但回答不对，是 Prompt 或 Agent 问题

## 4. 把检索结果格式化一下

如果直接把 `Document[]` 丢给 Agent，不太方便。

通常会先做一层很薄的格式化。

format-docs.ts

```typescript
import { Document } from '@langchain/core/documents'

function formatDocs(docs: Document[]) {
  return docs
    .map((doc, index) => {
      // 来源信息提前拼进去，后面如果要做引用展示会方便很多。
      const source = doc.metadata.source ?? 'unknown'
      return `资料 ${index + 1}（来源：${source}）\n${doc.pageContent}`
    })
    .join('\n\n')
}
```

这一层看起来很小，但很好用。

它至少解决了两件事：

- 让上下文更好读

- 顺手把来源信息带进去

后面如果你想在回答里标注“这段内容来自哪里”，这一层就已经把材料准备好了。

## 5. 接回一条完整的 Agent 检索链

下面这段代码把检索和回答收成了一个统一入口，写起来会更接近项目里的样子。

rag-agent.ts

```typescript
import { createAgent } from 'langchain'
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory'
import { OpenAIEmbeddings } from '@langchain/openai'
import { Document } from '@langchain/core/documents'

const embeddings = new OpenAIEmbeddings({
  model: 'text-embedding-3-small',
})

// 知识库里的内容先放进向量库。
// 这一层只负责“存”和“查”，还没有开始回答。
const vectorStore = await MemoryVectorStore.fromDocuments(
  [
    new Document({
      pageContent: '退款政策：购买后 30 天内可申请无条件退款。超过 30 天需要提供商品质量问题证明。',
      metadata: { source: 'policy.pdf', topic: 'refund' },
    }),
    new Document({
      pageContent: '会员等级：消费满 1000 元升银卡，满 5000 元升金卡。',
      metadata: { source: 'policy.pdf', topic: 'membership' },
    }),
    new Document({
      pageContent: '客服工作时间：周一到周五 9 点到 18 点。',
      metadata: { source: 'policy.pdf', topic: 'support' },
    }),
  ],
  embeddings,
)

const agent = createAgent({
  model: 'openai:gpt-4.1-mini',
  tools: [],
})

function formatDocs(docs: Document[]) {
  return docs
    .map((doc, index) => {
      // 这里把检索结果转成更适合拼进 system 的格式。
      return `资料 ${index + 1}：${doc.pageContent}`
    })
    .join('\n\n')
}

async function runRAG(question: string) {
  // 1. 先检索最相关的资料块。
  const docs = await vectorStore.similaritySearch(question, 3)

  // 2. 再把检索结果转成 Agent 更容易消费的上下文。
  const context = formatDocs(docs)

  const result = await agent.invoke({
    messages: [
      {
        // 这层 system 的作用，是把回答范围限制在检索结果里。
        role: 'system',
        content: `你是公司的 AI 助手。

回答问题时，只能优先依据下面的参考资料。
如果资料不足，就明确说资料里没有，不要自己补。

参考资料：
${context}`,
      },
      {
        // 这里还是用户的原始提问，不做改写。
        role: 'user',
        content: question,
      },
    ],
  })

  return {
    answer: result.messages.at(-1)?.text ?? '',
    docs,
  }
}

const result = await runRAG('退款超过 30 天怎么办？')
// answer 是最终回答，docs 是这次检索真正命中的资料。
console.log(result.answer)
```

这段代码里，最有用的结构其实就一个：

- `runRAG(question)` 作为统一入口

里面虽然做了好几步，但对外只暴露一个函数。

后面你想加日志、缓存、查询重写、来源引用，都会比较顺。

## 6. 多轮对话里，问题常常要先补全

到了 AI 伴侣或者客服场景，用户很少每次都把问题说完整。

比如：

- 第一轮：退款政策是什么

- 第二轮：那超过 30 天呢

第二句里根本没有“退款”两个字。

如果直接拿它去检索，向量库不一定能稳稳命中对的资料。

这时候更顺手的做法是先做一步**查询重写**。

也就是结合前面的对话，把这句补完整，再去检索。

rewrite-query.ts

```typescript
import { ChatOpenAI } from '@langchain/openai'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },
})

async function rewriteQuery(history: string[], question: string) {
  // 这里不让模型直接回答，只让它补全检索问题。
  const prompt = `请根据对话历史，把用户最后一句补成一个独立完整的检索问题。

对话历史：
${history.join('\n')}

用户最后一句：
${question}

只输出改写后的问题。`

  const result = await model.invoke(prompt)
  // 只保留改写后的那一句查询文本。
  return result.text.trim()
}
```

然后把它放回 `runRAG(...)` 前面：

rag-with-rewrite.ts

```typescript
async function runRAGWithRewrite(history: string[], question: string) {
  // 1. 先把追问补完整。
  const rewrittenQuestion = await rewriteQuery(history, question)

  // 2. 再拿完整问题去检索。
  // 这里检索用的是重写后的问题，不是用户原话。
  const docs = await vectorStore.similaritySearch(rewrittenQuestion, 3)

  const context = formatDocs(docs)

  const result = await agent.invoke({
    messages: [
      {
        // system 继续吃检索结果，不直接吃 rewrittenQuestion。
        role: 'system',
        content: `参考资料：\n${context}`,
      },
      {
        // Agent 看到的 user 仍然是用户原话，这样回答会更自然。
        role: 'user',
        content: question,
      },
    ],
  })

  return result.messages.at(-1)?.text ?? ''
}
```

这里要注意，重写后的问题只用来检索。

真正交给 Agent 的用户消息，还是用户原话。

这样回答的语气会更自然一些。

## 7. 先把最小版本跑通，再往上加

RAG 很容易一开始就写得很复杂，比如：

- 查询重写

- 重排

- 多路检索

- 引用标注

- 回答后校验

这些都可以加，但不要一上来全上。

对大多数项目来说，更稳的顺序是：

- 先做最小检索链

先做到“能找到资料，再基于资料回答”

- 再看检索是否稳定

如果追问经常找偏，再补查询重写

- 再看回答是否重复或发散

这时再去调 `k`、上下文格式、Prompt

也就是说，**RAG 不是先堆功能，而是先把链路拉直。**
