---
title: "208 Embedding 与向量检索"
pubDate: 2026-08-01
description: "两段文字重复的词很少，但意思非常接近。关键词搜索可能因为没有同时出现“年假”和“部门负责人”而漏掉；Embedding 则尝试把文本的语义转换成一组可以计算的数字。"
tags: [AI编程, RAG, 向量检索, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-06
---
原文链接：[https://aicompanion.usehook.cn/4-embedding-vector-retrieval/](https://aicompanion.usehook.cn/4-embedding-vector-retrieval/)

## 1. 向量如何比较语义

知识库中写着：

NOTE

连续两天及以上的年假，需要直属负责人和部门负责人共同审批。

用户问：

NOTE

我打算休两天，除了直属领导还要找谁？

两段文字重复的词很少，但意思非常接近。关键词搜索可能因为没有同时出现“年假”和“部门负责人”而漏掉；Embedding 则尝试把文本的语义转换成一组可以计算的数字。

这组数字叫向量。语义相近的文本会尽量落在向量空间中相近的位置，系统再通过距离或相似度找到候选资料。

## 2. Embedding 表示语义关系

为了方便理解，可以暂时把向量想成文本在一个高维空间中的坐标：

embedding-example.txt

```txt
“连续两天年假需要部门负责人审批”
  -> [0.031, -0.248, 0.617, ...]

“休两天假还要找哪个领导”
  -> [0.028, -0.233, 0.602, ...]
```

真实向量通常有几百到几千个维度，每个数字都没有简单、固定的人类含义。不能把第 17 维直接解释成“请假”，也不能把第 42 维解释成“负责人”。向量的意义来自模型整体训练出的空间关系。

这也解释了为什么向量维度不能随意裁剪，索引和查询也不能使用两个不兼容的模型。不同模型产生的坐标系并不相同，即使维度碰巧一致，也不代表生成的向量可以互相比较。

## 3. 文档与查询如何向量化

LangChain 的 Embeddings 接口区分 `embedDocuments()` 和 `embedQuery()`：

embeddings.ts

```typescript
import { OpenAIEmbeddings } from '@langchain/openai'

const embeddings = new OpenAIEmbeddings({
  model: 'text-embedding-3-small',
})

const documentVectors = await embeddings.embedDocuments([
  '连续两天及以上的年假，需要直属负责人和部门负责人共同审批。',
  '差旅报销应当在费用发生后 30 天内提交。',
])

const queryVector = await embeddings.embedQuery(
  '我打算休两天，除了直属领导还要找谁？',
)
```

有些模型对文档和查询使用相同的编码过程，有些检索模型则会为两类输入使用不同的提示前缀或训练目标。通过 LangChain 的统一接口调用，可以把这些差异留在集成层处理。

建立索引时批量调用 `embedDocuments()`，在线请求使用 `embedQuery()`。不要在用户请求中逐条重新计算全部文档向量。

## 4. 向量索引保存哪些信息

最小向量记录包含 ID 和 values：

vector-record.ts

```typescript
type VectorRecord = {
  id: string
  values: number[]
  metadata: {
    sourceId: string
    sourceVersion: number
    chunkId: string
    tenantId: string
    visibility: string
  }
}
```

是否把完整 Chunk 文本放进 metadata，需要权衡。直接返回文本可以减少一次数据库查询，但向量库通常对 metadata 大小有限制，权限、编辑和审计也更难统一。

更清晰的职责分配是：

- 业务数据库或对象存储保存权威正文；

- 向量索引保存向量、检索过滤字段和正文定位 ID；

- 检索命中后，根据 ID 批量读取当前有效正文。

小型演示可以把文本放在 metadata 中。正式项目则要明确哪一份数据才是 Source of Truth。

## 5. 相似度指标

文本向量常见的比较方式有余弦相似度、点积和欧氏距离。

余弦相似度关注两个向量方向是否接近：

cos⁡(θ)=A⋅B∥A∥∥B∥\cos(\theta)=\frac{A\cdot B}{\|A\|\|B\|}cos(θ)=∥A∥∥B∥A⋅B​

直观上，两段文本的语义方向越接近，余弦值通常越高。点积同时受到方向和向量长度影响；欧氏距离衡量两个点之间的直线距离，数值越小通常表示越接近。

选择哪种指标，应当遵循 Embedding 模型和向量数据库的建议。余弦值看起来像一个百分比，但不能把 `0.8` 解释成 80% 的正确率。

不同向量库对 score 的定义也可能不同。有的返回相似度，数值越大越好；有的返回距离，数值越小越好。切换供应商后直接复用旧阈值，是线上很常见的问题。

## 6. 用 LangChain 建立内存索引

学习阶段可以使用 `MemoryVectorStore` 跑通流程。当前 LangChain JavaScript 文档将它放在 `@langchain/classic` 包中：

terminal

```shellscript
yarn add @langchain/core @langchain/classic @langchain/openai
```

memory-vector-store.ts

```typescript
import { Document } from '@langchain/core/documents'
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory'
import { OpenAIEmbeddings } from '@langchain/openai'

const embeddings = new OpenAIEmbeddings({
  model: 'text-embedding-3-small',
})

const vectorStore = new MemoryVectorStore(embeddings)

await vectorStore.addDocuments([
  new Document({
    id: 'leave-policy:v4:1',
    pageContent:
      '连续两天及以上的年假，需要直属负责人和部门负责人共同审批。',
    metadata: {
      sourceId: 'leave-policy',
      sourceVersion: 4,
      topic: 'leave',
    },
  }),
  new Document({
    id: 'expense-policy:v2:1',
    pageContent: '差旅报销应当在费用发生后 30 天内提交。',
    metadata: {
      sourceId: 'expense-policy',
      sourceVersion: 2,
      topic: 'expense',
    },
  }),
])

const results = await vectorStore.similaritySearch(
  '我休两天假需要谁审批？',
  4,
)
```

`MemoryVectorStore` 适合教学和测试：进程结束后数据不会保留，也不适合大规模近邻搜索。换成 Cloudflare Vectorize、Qdrant 或其他服务时，LangChain 上层仍然可以通过 VectorStore 和 Retriever 接口保持相似用法。

## 7. 选择 Top-K

`k` 表示取回多少个候选。设置太小，正确资料可能排在第 5 名，却只取了前 3 名；设置太大，无关内容和重复 Chunk 会进入上下文，增加 Token 成本，也可能干扰模型。

更常见的做法，是把召回阶段和最终上下文分开：

retrieval-stages.txt

```txt
向量召回 20 条
  -> 权限与版本校验
  -> 去重
  -> 重排
  -> 选 4～6 条进入模型上下文
```

召回阶段的 `k` 可以稍大，用来覆盖更多正确资料；最终进入模型的数量，则要根据相关性、完整性和上下文预算控制。

面试中如果被问到“Top-K 应该设多少”，可以从三方面回答：评测集上的 Recall@K、重排成本和最终上下文预算。只给一个固定数字，无法适用于不同文档和问题。

## 8. 选择相似度阈值

系统经常需要判断最高分过低时是否应该拒绝回答。阈值很有用，但不能直接照搬别人的 `0.75` 或 `0.8`。

阈值会受到 Embedding 模型、距离指标、向量库实现、文本长度、语言和数据分布影响。即使使用同一个模型，公司制度和短聊天记忆的分数分布也可能不同。

比较可靠的做法是准备三类问题：

- 明确有答案的问题；

- 与资料接近但没有答案的问题；

- 完全无关的问题。

记录它们的最高分和候选排名，再选择能够平衡漏召回与错误召回的阈值。上线后继续观察“被拒绝但其实有答案”和“低质量结果仍然进入生成”的比例。

还要确认 score 的方向。若供应商返回距离，使用 `score < threshold` 才可能表示相近；如果返回相似度，通常是 `score > threshold`。接口字段都叫 `score`，语义却未必相同。

## 9. 先执行 metadata 过滤

假设同一个向量索引保存着多家公司的制度。用户属于 company-a，但 Top-K 全库检索先返回了 company-b 的高相似内容，之后再删除无权结果。这样一来，正确资料即使在全库排名第 8，也根本没有机会进入前 5 名。

权限和业务范围应该在向量搜索时就参与过滤：

retrieval-filter.ts

```typescript
type RetrievalScope = {
  tenantId: string
  sourceVersion: number
  visibility: 'employee' | 'manager'
}
```

Cloudflare Vectorize 当前支持 namespace 和 metadata filter 来缩小查询范围。它们属于查询过滤机制，不应把 namespace 描述成独立的物理数据库。敏感数据是否需要不同索引、账号或存储边界，还要依据安全要求单独设计。[Cloudflare Vectorize Metadata Filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/)

## 10. 补充语义之外的检索信号

向量检索擅长处理语义相似性，但真实问题往往还包含编号、时间、权限和多个主题等信号。

用户问“制度第 3.2 条是什么”，编号匹配比语义更重要；问“上周更新的报销规则”，时间过滤不能只靠向量；问“ERR_AUTH_017 如何处理”，错误码适合关键词搜索；问“请假和调休有什么区别”，需要同时找回两个主题，单一向量近邻可能只返回其中一类。

所以，检索不准时不要只归因于 Embedding 模型不够好。常见的改进方向包括：

- metadata 预过滤；

- 关键词与向量混合召回；

- 查询改写或多查询召回；

- MMR 增加候选多样性；

- Cross-Encoder 或 LLM Rerank；

- Parent-Child Retrieval 补充完整上下文。

## 11. 用 MMR 减少重复候选

相似度搜索容易返回多个内容几乎一样的 Chunk。MMR，也就是 Maximum Marginal Relevance，会在相关性和候选多样性之间做平衡。

mmr-retriever.ts

```typescript
const retriever = vectorStore.asRetriever({
  k: 6,
  searchType: 'mmr',
  searchKwargs: {
    fetchK: 20,
  },
})

const documents = await retriever.invoke(
  '连续休假两天需要哪些审批？',
)
```

这里先召回 20 条，再选择 6 条相对相关且不完全重复的结果。MMR 不能替代重排，也不能修复错误切块，但在相邻 Chunk 大量重复时很有帮助。

## 12. 保存检索调试信息

一次在线请求至少应当能够看到：

retrieval-trace.ts

```typescript
type RetrievalTrace = {
  originalQuery: string
  rewrittenQuery?: string
  filters: Record<string, unknown>
  embeddingModel: string
  indexVersion: string
  candidates: Array<{
    chunkId: string
    score: number
    rank: number
  }>
  selectedChunkIds: string[]
}
```

普通日志不要直接记录完整的私有文档和用户问题。可以保存 ID、分数、版本和经过脱敏的查询，详细内容放在有权限控制的追踪系统中。

有了这些信息，才能判断正确 Chunk 是没有被召回、被过滤掉、在重排时掉队，还是进入上下文后被模型忽略。

## 13. 总结

Embedding 把文本映射到可比较的向量空间，向量数据库负责从大量记录中寻找近邻。它适合处理表达不同但语义接近的问题，却不能替代权限过滤、精确匹配、时间条件和业务查询。

使用向量检索时，需要保证文档和查询处在同一 Embedding 空间，先确认 score 的含义，再通过评测选择 Top-K 和阈值。下一篇暂时不使用 LangChain 的 RAG 封装，而是亲手把索引、检索、上下文组装和生成连接起来。
