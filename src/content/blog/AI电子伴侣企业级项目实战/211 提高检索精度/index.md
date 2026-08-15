---
title: "211 提高检索精度"
pubDate: 2026-08-01
description: "做到这里，我们已经有了一条能运行的 RAG 链：用户提问，Retriever 返回文档，模型参考文档生成答案。但真实项目很快会遇到一个反直觉的问题：向量库几乎每次都能返回内容，答案却不一定可靠。"
tags: [AI编程, RAG, 向量检索, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/7-retrieval-quality/](https://aicompanion.usehook.cn/7-retrieval-quality/)

## 1. 能返回结果，不代表检索正确

做到这里，我们已经有了一条能运行的 RAG 链：用户提问，Retriever 返回文档，模型参考文档生成答案。但真实项目很快会遇到一个反直觉的问题：向量库几乎每次都能返回内容，答案却不一定可靠。

假设知识库里同时有《员工考勤制度》《差旅报销制度》和《办公设备申领办法》。用户问：

NOTE

我明天想休一天，需要谁批准？

如果检索结果的第一名是“差旅申请由直属负责人审批”，系统并不会报错。它只是把语义上“申请、审批”比较接近的错误资料交给模型。模型再把这段话组织得很通顺，用户看到的便是一条听起来可信、事实却不对的答案。

提高 RAG 质量，第一步不是把 `topK` 从 4 改成 8，也不是在 Prompt 里再写一遍“请准确回答”，而是先判断错误发生在哪一层：

| 现象 | 更可能的问题 |
| --- | --- |
| 正确资料没有进入候选集 | 切块、查询表达、过滤条件或召回策略 |
| 正确资料在候选中但排得很后 | 排序、混合检索权重或重排 |
| 候选资料正确，答案仍然写错 | 上下文组织、生成约束或模型能力 |
| 测试时正常，线上偶尔引用别人的资料 | 租户和权限过滤 |
| 新制度已经发布，仍然回答旧版本 | 索引更新、版本过滤或缓存 |

这张表看起来朴素，却是排查 RAG 问题时最重要的分界。检索错了，继续调 Prompt 通常没有意义；检索正确而回答错了，才应该检查生成阶段。

## 2. 先准备一组不会骗人的问题

没有评测集时，所谓“精度提升”往往只是挑几个熟悉的问题反复尝试。参数对这几个问题变好了，换一种问法就可能退化。

以公司制度知识库为例，可以先收集 30 到 50 个真实问题。每个问题至少记录：

rag-evaluation-case.ts

```typescript
interface RetrievalCase {
  id: string
  question: string
  expectedDocumentIds: string[]
  forbiddenDocumentIds?: string[]
  expectedAnswer?: string
  tags: string[]
}

const cases: RetrievalCase[] = [
  {
    id: 'leave-approval-01',
    question: '我明天请一天年假，需要谁批？',
    expectedDocumentIds: ['leave-policy:v4:approval-short'],
    forbiddenDocumentIds: ['leave-policy:v3:approval'],
    tags: ['同义表达', '版本过滤', '请假'],
  },
  {
    id: 'follow-up-01',
    question: '那两天以上呢？',
    expectedDocumentIds: ['leave-policy:v4:approval-long'],
    tags: ['多轮指代', '请假'],
  },
  {
    id: 'unknown-01',
    question: '公司能给宠物报销体检费吗？',
    expectedDocumentIds: [],
    tags: ['知识库无答案'],
  },
]
```

`expectedDocumentIds` 用来检查正确资料是否进入候选，`forbiddenDocumentIds` 用来防止旧版本或无权限资料混进来。`tags` 则方便我们按问题类型看结果，而不是只看一个总分。

评测问题不能只有“年假审批规则是什么”这种与文档标题高度重合的标准问法。真实用户会使用口语、简称、错别字和上下文指代，也会把两个问题写在一句话里。面试中如果被问到“怎样证明你的 RAG 变好了”，一组有标注、能重复运行的检索用例，比“肉眼看起来不错”更有说服力。

## 3. 查询并不总是适合直接检索

用户消息是为了和人交流，不一定是为了匹配知识库。下面几类问题尤其容易让 Retriever 失去方向。

### 多轮对话中的指代

用户先问“年假由谁审批”，接着问“那超过两天呢”。如果第二轮只拿“那超过两天呢”去生成向量，它几乎没有领域信息。检索前应结合必要的对话上下文，把它改写成：

NOTE

连续请两天以上年假时，需要哪些人审批？

改写结果必须和原问题一起保留。这样检索异常时，才能判断是原始表达太短，还是改写模型改变了用户意思。

rewrite-query.ts

```typescript
import { ChatOpenAI } from '@langchain/openai'

const rewriteModel = new ChatOpenAI({
  model: 'gpt-4.1-mini',
  temperature: 0,
})

export async function rewriteRetrievalQuery(input: {
  question: string
  recentMessages: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
}) {
  const response = await rewriteModel.invoke([
    {
      role: 'system',
      content: `把最后一个用户问题改写成可独立检索的问题。
只补充对话中已经明确的信息，不要猜测用户身份、时间或意图。
如果问题本身已经完整，原样返回。`,
    },
    {
      role: 'user',
      content: JSON.stringify(input),
    },
  ])

  return typeof response.content === 'string'
    ? response.content.trim()
    : input.question
}
```

不要把完整聊天记录直接送去改写。对话越长，旧话题越容易污染当前查询。通常保留最近几轮，再加上已经结构化的会话主题就够了。

### 一个问题包含多个子问题

“年假怎么申请，三天需要谁审批，剩余天数在哪里看？”实际上包含申请步骤、审批规则和余额查询三个信息需求。只生成一个向量时，最强的语义可能压过另外两个问题。

这类查询适合先拆成三个子查询，各自召回少量候选，再合并、去重和重排。需要注意，查询分解会增加调用次数，不能把每个句子都机械拆开。只有评测证明复合问题确实漏召回时，才值得引入。

### 精确词被语义相似掩盖

错误码、产品型号、接口名、法规条款号通常更适合精确匹配。用户搜索 `ERR_AUTH_1042` 时，向量模型可能返回一段关于“认证失败”的说明，却漏掉真正包含该错误码的排障文档。

因此，语义检索不应该替代关键词检索。向量擅长理解“请一天假要找谁”与“短期年假审批人”接近；关键词检索擅长识别错误码、专有名词和原文短语。二者解决的是不同问题。

## 4. 混合检索比单一路径更稳

混合检索通常包含两路候选：

- 向量检索负责语义相似；

- BM25 或全文检索负责关键词命中。

两路分数不能直接相加。向量相似度可能落在 `0.7` 到 `0.9`，BM25 分数可能是十几甚至几十，数值没有共同尺度。更稳妥的做法是按各自排名进行融合，例如 Reciprocal Rank Fusion，简称 RRF。

假设某段资料在向量结果中排第 1，在关键词结果中排第 4，它的融合分数是：

RRF⁡(d)=1k+1+1k+4\operatorname{RRF}(d) =
\frac{1}{k + 1} +
\frac{1}{k + 4}RRF(d)=k+11​+k+41​

`k` 是用来减小头部排名差距的常数，工程中常从 `60` 开始，再用自己的评测集调整。

reciprocal-rank-fusion.ts

```typescript
interface RankedDocument {
  id: string
  content: string
  metadata: Record<string, unknown>
}

export function reciprocalRankFusion(
  rankings: RankedDocument[][],
  options: {
    k?: number
    limit: number
  },
) {
  const k = options.k ?? 60
  const scores = new Map<
    string,
    {
      document: RankedDocument
      score: number
    }
  >()

  for (const ranking of rankings) {
    ranking.forEach((document, index) => {
      const current = scores.get(document.id)
      const score = 1 / (k + index + 1)

      scores.set(document.id, {
        document,
        score: (current?.score ?? 0) + score,
      })
    })
  }

  return [...scores.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, options.limit)
}
```

真实调用时，可以让 LangChain Retriever 返回向量候选，让搜索服务返回关键词候选，然后把两路结果交给这个函数。融合前必须使用稳定的文档 ID 去重，否则同一个 chunk 会占据多个位置。

## 5. 先过滤，再相似度搜索

检索精度不仅取决于“像不像”，还取决于“能不能看”和“是不是当前版本”。

用户询问年假制度时，可以先限制：

metadata-filter.ts

```typescript
interface RetrievalFilter {
  tenantId: string
  allowedDepartmentIds: string[]
  status: 'published'
  effectiveAt: string
  documentTypes?: string[]
}
```

租户、权限、发布状态和生效时间属于硬条件。它们应该在向量数据库或搜索引擎选候选时就参与过滤，不能先查全库 Top-K，再在应用层删除。

原因很容易被忽略。假设 Top-5 全是用户无权查看的文档，后置过滤会得到空数组；真正有权限且相关的资料排在第 6，却永远没有机会进入结果。更严重的是，如果无权文档已经被发送给重排模型或聊天模型，即使最终答案没有展示，也已经发生数据越界。

业务主题、语言和文档类型则需要通过评测决定是否作为硬过滤。过滤过严也会漏召回。例如用户问“出差期间受伤如何处理”，内容可能横跨差旅制度和员工保障，强制只搜某一类文档反而会丢信息。

## 6. 先多召回，再精细重排

向量索引擅长快速从大量文档中找出大致相关的候选，不一定擅长在相近候选中排出最正确的一条。生产检索常分两段：

第一段从向量和关键词索引中召回较多候选，例如各取 20 条；第二段使用更精细的重排模型，把合并后的 30 到 40 条压缩成最终 5 条。

重排模型会同时阅读“问题”和“候选文本”，判断这段文本是否真正回答问题。它比只比较两个独立向量更精细，计算也更贵，所以不适合扫描整个知识库。

rerank.ts

```typescript
interface RetrievalCandidate {
  id: string
  content: string
  metadata: Record<string, unknown>
  recallScore: number
}

interface Reranker {
  rerank(input: {
    query: string
    documents: string[]
    topN: number
  }): Promise<Array<{
    index: number
    relevanceScore: number
  }>>
}

export async function rerankCandidates(
  reranker: Reranker,
  query: string,
  candidates: RetrievalCandidate[],
) {
  const rankings = await reranker.rerank({
    query,
    documents: candidates.map((item) => item.content),
    topN: 6,
  })

  return rankings.map((ranking) => ({
    ...candidates[ranking.index],
    rerankScore: ranking.relevanceScore,
  }))
}
```

这个接口故意没有绑定某个重排供应商。无论使用专用 Cross Encoder、云端 Rerank API 还是受控的 LLM 评分，流程都一样：召回阶段争取别漏，重排阶段争取别错。

重排也会失败。候选文本被截断、问题语言混杂、模型不熟悉企业缩写，都会影响排序。因此要保留召回排名和重排排名，不能只记录最终结果。

## 7. 给切块补回必要上下文

一段 chunk 可能只写着“由部门负责人审批”，却没有说明它指的是连续两天以上的年假。它与问题中的“谁审批”很相似，但脱离标题和父级章节后，含义不完整。

常见处理有两种。

第一种是在生成 Embedding 时，把文档标题、章节路径和正文拼在一起：

code.ts

```txt
文档：员工考勤制度
章节：年假 > 审批权限
正文：连续两天及以上，由直属负责人和部门负责人共同审批。
```

第二种是父子块检索。小块用于向量匹配，命中后取回它所属的较大父块交给模型。这样既保留小块的检索精度，又避免生成阶段缺少上下文。

但父块不能无限大。命中一句话后把整本员工手册塞给模型，会重新引入噪声。比较实用的方式是扩展到当前小节，或者取命中块前后各一个相邻块，再进行去重和长度控制。

## 8. 不是每个问题都应该回答

向量搜索会返回“最相近”的内容，即使全库没有答案。用户问宠物体检报销，系统仍可能找到员工体检或医疗报销制度。如果模型被要求“尽量帮助用户”，就可能据此编出一条不存在的规则。

因此 RAG 需要无答案判断。它不能只写成：

code.ts

```typescript
if (documents.length === 0) {
  return '没有答案'
}
```

更合理的判断会综合：

- 权限过滤后是否还有候选；

- 第一名和后续候选的分数分布；

- 重排分数是否达到经过评测校准的范围；

- 候选是否覆盖问题中的关键约束；

- 多个来源是否互相冲突；

- 当前索引是否完整、是否正在迁移。

不同查询类型的阈值也可能不同。错误码精确命中可以要求更严格；自然语言同义问法的向量分数分布则更宽。不要从网上抄一个 `0.8` 当作通用真理，分数还会随 Embedding 模型、距离算法和数据分布变化。

更稳妥的策略是把“资料不足”当成正常结果，而不是异常。系统可以请用户补充问题、建议联系制度负责人，或者展示最接近的文档供用户自行确认。

## 9. 上下文不是越多越好

把 Top-20 全部交给模型，看似降低了漏信息的概率，实际上可能产生三种新问题：

- 旧版本和新版本同时出现，模型难以判断该信谁；

- 重复 chunk 占用大量上下文，关键句被淹没；

- 不同主题的相似资料混入，答案被无关细节带偏。

进入 Prompt 前还需要一次上下文整理：按稳定 ID 去重，优先保留当前版本，合并连续相邻块，控制每个来源的占比，并在总 token 预算内选择覆盖不同证据的内容。

如果多条资料互相冲突，不要悄悄选一条。可以将冲突作为状态写入 LangGraph，让流程进入“版本判定”“人工确认”或“明确告知用户存在冲突”的分支。

## 10. 用分层指标定位问题

检索阶段最常用的几个指标并不复杂。

`Recall@K` 关心正确资料是否进入前 K 名：

Recall@K⁡=前 K 名中命中的相关文档数该问题全部相关文档数\operatorname{Recall@K} =
\frac{\text{前 K 名中命中的相关文档数}}
{\text{该问题全部相关文档数}}Recall@K=该问题全部相关文档数前 K 名中命中的相关文档数​

`Precision@K` 关心前 K 名里有多少是真正相关的：

Precision@K⁡=前 K 名中命中的相关文档数K\operatorname{Precision@K} =
\frac{\text{前 K 名中命中的相关文档数}}
{K}Precision@K=K前 K 名中命中的相关文档数​

如果一个问题只标注了一条核心文档，还可以看 Hit Rate：正确文档是否至少出现一次。MRR 则关注第一条正确文档排得有多靠前。

这些指标要和生成质量分开。`Recall@5` 很高但答案错误，说明问题可能在重排、上下文或生成；`Recall@5` 很低，再好的模型也缺少证据。

## 11. 一套实际的调优顺序

面对“RAG 不准”，可以按下面的顺序处理：

- 复现问题，保存原始查询、改写查询、过滤条件和完整候选；

- 确认正确原文确实存在，并且当前用户有权访问；

- 检查解析结果和切块边界，排除脏数据；

- 运行评测集，确认问题属于哪一类，而不是只修单个样例；

- 先尝试查询改写、元数据过滤和关键词召回；

- 候选足够但排序不稳时，再加入 RRF 和重排；

- 最后调整上下文组织、阈值和生成 Prompt；

- 对比修改前后的分层指标、延迟和费用。

顺序很重要。如果正确内容根本没有被解析出来，换重排模型没有用；如果召回已经正确，盲目增加多查询只会抬高成本。

## 12. 面试中怎样讲检索精度

面试官问“你怎样提高 RAG 准确率”时，只回答“调 chunk size 和 topK”通常不够。一个更完整的回答可以是：

NOTE

我先用带文档标注的评测集把召回和生成分开。召回侧检查解析、切块、查询改写、关键词与向量混合检索、元数据预过滤；正确文档已经进入候选但排序较差时，再用 RRF 和重排。进入生成前会去重、补父级上下文并控制版本。最后用 Recall@K、MRR、答案忠实度和无答案准确率一起判断，而不是只看模型回答是否顺眼。

如果继续被追问“为什么不直接提高 Top-K”，可以说明：更大的 K 可能提高召回，却会增加噪声、上下文费用和版本冲突。正确做法通常是召回阶段适当扩大候选，经过重排和上下文压缩后，再把少量高质量资料交给模型。

## 13. 总结

RAG 检索精度不是一个旋钮，而是一连串可以单独观察的决策。查询要适合检索，候选要经过权限与版本过滤，关键词和向量各自发挥优势，重排负责从候选中挑出真正回答问题的内容，最后还要允许系统承认资料不足。

下一篇会把视角从一次查询扩大到整个生产系统：文档怎样可靠更新，索引怎样迁移，权限怎样不越界，指标怎样长期监控，以及如何用 LangSmith 组织离线与线上评测。
