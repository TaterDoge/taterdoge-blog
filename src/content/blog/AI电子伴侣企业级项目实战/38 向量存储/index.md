---
title: "38 向量存储"
pubDate: 2026-04-24
description: "import { OpenAIEmbeddings } from '@langchain/openai'"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/14-embedding-vectorstore/](https://aicompanion.usehook.cn/14-embedding-vectorstore/)

## 1. 文档切成块以后，还不能直接给 Agent 用

上一篇已经把文档切成了很多块。

但切完之后，这些块还只是 `Document[]`，离“可检索”还差一步。

如果现在就把几百个块直接塞给 Agent，会有两个问题：

- 一次根本塞不下

- 就算塞得下，也不知道该看哪几块

所以中间还要补一层：

- 先把每个块变成向量

- 再把这些向量存起来

- 用户提问时，先找最相关的块

- 最后再把这些块交给 Agent

这一篇处理的就是中间这两步：

- `Embedding`

- `Vector Store`

## 2. Embedding 做的事情其实很单纯

Embedding 模型不负责回答问题。

它只做一件事：把一段文本变成一组数字。

embedding-basic.ts

```typescript
import { OpenAIEmbeddings } from '@langchain/openai'

const embeddings = new OpenAIEmbeddings({
  // 这里先用最常见的小模型，把流程跑通最重要。
  model: 'text-embedding-3-small',
})

// 用户问题进入检索前，先会被转成向量。
const vector = await embeddings.embedQuery('请假流程怎么走')

// 向量维度是固定的，后面相似度比较就在这个数字空间里完成。
console.log(vector.length)
// 这里只是随便看几个值，实际项目里不会手动处理这些数字。
console.log(vector.slice(0, 5))
```

这一组数字本身没法直接拿来给人看。

它真正的用途是：**让两段意思接近的文本，在向量空间里也靠得更近。**

比如：

- 用户问“请假流程怎么走”

- 文档里写“员工需先提交请假申请，再由主管审批”

虽然两句话不完全一样，但 embedding 后，二者会比较接近。

后面的向量库就能把这段文档找出来。

## 3. 文档和查询，调用方法不一样

这里有一个细节要先记住：

- 文档建索引用 `embedDocuments(...)`

- 用户查询用 `embedQuery(...)`

embedding-docs.ts

```typescript
import { OpenAIEmbeddings } from '@langchain/openai'

const embeddings = new OpenAIEmbeddings({
  model: 'text-embedding-3-small',
})

// 这里是知识库里的文档内容，属于“提前建索引”的阶段。
const docVectors = await embeddings.embedDocuments([
  '员工提交请假申请后，需要主管审批。',
  '报销流程需要上传票据和审批单。',
])

// 这里是用户实时发来的问题，属于“查询阶段”。
const queryVector = await embeddings.embedQuery('请假要先找谁审批')

// 两条文档，所以会返回两组向量。
console.log(docVectors.length)
// 查询只有一句，所以只会得到一组向量。
console.log(queryVector.length)
```

这两个方法名字很像，但不要混着用。

这里直接按场景记最省事：

- 知识库里的内容，用 `embedDocuments`

- 用户实时发来的问题，用 `embedQuery`

第一次看到这里，通常会有两个疑问：

- 为什么同样都是“把文本变成向量”，还要分两个方法

- 项目里到底在什么地方各用一次

把时间顺序拆开看，就会清楚很多。

**第一段：建索引**

这一步发生在用户提问之前。

比如你已经有一份员工手册，准备把它做成知识库：

- 先把手册切成很多块

- 再把这些块统一做 embedding

- 最后写进向量库

这一段处理的对象，都是“知识库里的文档内容”。

所以这里走的是 `embedDocuments(...)`。

**第二段：用户开始提问**

这一步发生在运行时。

用户现在问了一句：

- 请假要先找谁审批

系统不会重新给整份手册做 embedding。

它只会把“这句问题”转成向量，再拿这个向量去向量库里做相似度比较。

这一段处理的对象，是“当前这句查询”。

所以这里走的是 `embedQuery(...)`。

也就是说，整条链其实是这样的：

embedding-usage.txt

```txt
建索引阶段：
文档块 A ─┐
文档块 B ─┼─ embedDocuments(...) ─→ 写进向量库
文档块 C ─┘

查询阶段：
用户问题 ── embedQuery(...) ─→ 去向量库里找最近的块
```

可以把它记成这样：

- `embedDocuments`：给知识库建索引时用

- `embedQuery`：用户发起检索时用

在项目里，这两个动作经常不会直接写在同一个文件里。

更常见的是下面这种分开出现的样子：

embedding-usage.ts

```typescript
// 这一步通常发生在“准备知识库”的脚本里。
// fromDocuments 内部会先对每个 Document 做文档 embedding。
const vectorStore = await MemoryVectorStore.fromDocuments(chunks, embeddings)

// 这一步通常发生在“用户提问”的运行时逻辑里。
// similaritySearch 内部会先把 question 做查询 embedding，再去比相似度。
const docs = await vectorStore.similaritySearch(question, 3)
```

所以你在业务代码里，很多时候看不到 `embedDocuments(...)` 和 `embedQuery(...)` 同时出现。

但底层做的事情并没有变：

- 文档先被转成文档向量

- 查询再被转成查询向量

- 两边进入同一个向量空间做比较

## 4. 向量库就是把这些块存起来，再负责检索

有了向量，还需要一个地方存它们。

这个地方不只是“存”，还要支持“找出最接近的几条”。

这就是向量库。

在教程里，先用 `MemoryVectorStore` 最合适。

它的优点很直接：

- 不需要额外部署

- 代码最短

- 方便先把流程跑通

memory-vectorstore.ts

```typescript
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory'
import { OpenAIEmbeddings } from '@langchain/openai'
import { Document } from '@langchain/core/documents'

const embeddings = new OpenAIEmbeddings({
  model: 'text-embedding-3-small',
})

// fromDocuments 会把文档先做 embedding，
// 再把“文档 + 向量”一起放进内存向量库。
const vectorStore = await MemoryVectorStore.fromDocuments(
  [
    new Document({
      // 这里的正文，后面会参与向量检索。
      pageContent: '员工提交请假申请后，需要直属主管审批。',
      // metadata 不参与语义匹配，但后面可以拿来显示来源或分类。
      metadata: { source: 'handbook.pdf', topic: 'leave' },
    }),
    new Document({
      pageContent: '报销时需要上传票据和审批单。',
      metadata: { source: 'handbook.pdf', topic: 'expense' },
    }),
    new Document({
      pageContent: '调休申请通过后，系统会自动更新剩余工时。',
      metadata: { source: 'handbook.pdf', topic: 'leave' },
    }),
  ],
  embeddings,
)
```

这里可以把它看成一步完成了两件事：

- 先把文档做 embedding

- 再把向量放进内存向量库

## 5. 先检索，再交给 Agent

这一步是整篇里最关键的位置。

用户提问以后，不是让 Agent 自己去翻整份手册，而是：

- 先拿用户的问题去查向量库

- 找到最相关的几个块

- 再把这些块交给 Agent

retrieve-before-agent.ts

```typescript
// 这里还是检索阶段，Agent 还没有开始回答。
const docs = await vectorStore.similaritySearch('请假要先找谁审批', 2)

docs.forEach((doc) => {
  // pageContent 是真正检索命中的正文。
  console.log(doc.pageContent)
  // metadata 方便你确认它是从哪份资料、哪个主题里取回来的。
  console.log(doc.metadata)
})
```

到这里，拿到的还是 `Document[]`。

Agent 还没出场。

但这一步已经把范围缩得很小了。

原来 Agent 面对的是整份文档，现在它只需要看最相关的两三块。

## 6. 检索结果要整理一下，再喂给 Agent

下面这段代码把前面的几步串起来了：

- 切好的文档块进向量库

- 用户提问时先检索

- 把检索结果拼成上下文

- 最后再交给 Agent

agent-with-retrieval.ts

```typescript
import { createAgent } from 'langchain'
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory'
import { OpenAIEmbeddings } from '@langchain/openai'
import { Document } from '@langchain/core/documents'

const embeddings = new OpenAIEmbeddings({
  model: 'text-embedding-3-small',
})

// 这里先准备一份很小的知识库。
// 实际项目里，这些 Document 往往来自前面那篇的切块结果。
const vectorStore = await MemoryVectorStore.fromDocuments(
  [
    new Document({
      pageContent: '员工提交请假申请后，需要直属主管审批。',
      metadata: { source: 'handbook.pdf', topic: 'leave' },
    }),
    new Document({
      pageContent: '调休申请通过后，系统会自动更新剩余工时。',
      metadata: { source: 'handbook.pdf', topic: 'leave' },
    }),
    new Document({
      pageContent: '报销时需要上传票据和审批单。',
      metadata: { source: 'handbook.pdf', topic: 'expense' },
    }),
  ],
  embeddings,
)

const agent = createAgent({
  model: 'openai:gpt-4.1-mini',
  tools: [],
})

async function answerWithKnowledge(question: string) {
  // 1. 先检索最相关的文档块。
  const docs = await vectorStore.similaritySearch(question, 2)

  // 2. 再把检索结果拼成一段可读上下文。
  // 这里不直接把 Document[] 原样塞给 Agent，是为了让 system 更清楚。
  const context = docs
    .map((doc, index) => {
      return `资料 ${index + 1}：${doc.pageContent}`
    })
    .join('\n\n')

  const result = await agent.invoke({
    messages: [
      {
        // system 负责告诉 Agent：哪些内容是参考资料，以及回答时要遵守什么边界。
        role: 'system',
        content: `你是公司的 AI 助手。

请优先根据下面的参考资料回答问题。
如果资料里没有明确答案，就直接说不知道，不要编造。

参考资料：
${context}`,
      },
      {
        // user 仍然是用户原始问题，不需要改写。
        role: 'user',
        content: question,
      },
    ],
  })

  // 3. 最后一条消息就是本轮回答。
  return result.messages.at(-1)?.text ?? ''
}

const answer = await answerWithKnowledge('请假要先找谁审批？')
// 这里看到的结果，已经是“检索 + 回答”合起来后的最终输出。
console.log(answer)
```

这段代码里，每一层的职责要分开看：

- `OpenAIEmbeddings`：负责把文本变成向量

- `MemoryVectorStore`：负责存向量和做相似度检索

- `similaritySearch(...)`：负责先把候选块找出来

- `agent.invoke(...)`：负责基于这些资料组织最终回答

这样写以后，Agent 不需要“自己会检索”，它只需要吃已经缩小范围的上下文。

## 7. 相似度搜索和 MMR，先用哪一个

向量库最常见的检索方式有两种：

- `similaritySearch`

- `maxMarginalRelevanceSearch`

刚开始直接用 `similaritySearch` 就够了。

similarity-vs-mmr.ts

```typescript
// 最直接的方式：只按相似度排序。
const similarDocs = await vectorStore.similaritySearch(
  'React 里怎么处理副作用',
  3,
)

// 如果你不想返回的 3 段资料都太像，可以试试 MMR。
const diverseDocs = await vectorStore.maxMarginalRelevanceSearch(
  'React 里怎么处理副作用',
  {
    // 最终返回 3 段。
    k: 3,
    // 先多取一些候选，再从里面挑更分散的结果。
    fetchK: 10,
    // 越接近 1 越偏向相关性，越接近 0 越偏向多样性。
    lambda: 0.5,
  },
)
```

两者区别可以简单记成：

- `similaritySearch`：只看谁最像

- `MMR`：既看谁像，也尽量别让结果太重复

如果你发现返回的 3 段资料总是在反复说同一件事，再试 MMR。

前面先把链路跑通，参数后面再慢慢调。

## 8. 什么时候该换持久化向量库

`MemoryVectorStore` 很适合教程和本地调试，但它有一个很明显的限制：

- 服务一重启，向量就没了

所以流程跑通以后，下一步通常会换成真正可持久化的方案，比如：

- Pinecone

- Chroma

- Cloudflare Vectorize

这一段先把迁移思路讲清楚就够了：

- 文档切块的代码不动

- embedding 的代码基本不动

- 主要变化发生在 vector store 这一层

也就是说，前面那条“切块 -> embedding -> 检索 -> Agent”的链不需要重画，通常只是把中间那块存储后端换掉。
