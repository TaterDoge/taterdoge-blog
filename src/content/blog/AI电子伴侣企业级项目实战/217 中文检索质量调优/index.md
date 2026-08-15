---
title: "217 中文检索质量调优"
pubDate: 2026-08-06
description: "AI Search 提供向量检索、BM25、查询改写、过滤、权重调整和重排。第一次看到这些开关，很容易产生一个想法：全部启用，效果应该最好。"
tags: [AI编程, RAG, 向量检索, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-06
---
原文链接：[https://aicompanion.usehook.cn/13cloudflare-ai-search-quality/](https://aicompanion.usehook.cn/13cloudflare-ai-search-quality/)

1. 打开所有功能并不会自动变准
AI Search 提供向量检索、BM25、查询改写、过滤、权重调整和重排。第一次看到这些开关，很容易产生一个想法：全部启用，效果应该最好。
真实情况恰好相反。每个环节都会改变候选结果，也会增加延迟和费用。如果一次同时修改 Chunk Size、Embedding、检索方式和阈值，答案变好后也不知道是哪一步起作用；答案变差时，更不知道应该撤回哪一项。
调优应该从一组固定问题开始。我们先保存每个问题期望命中的文档，再逐项观察解析、召回、融合和重排。
2. 准备中文评测问题员工制度知识库可以先准备 30 到 50 道问题。数量不必很大，但表达要接近真实用户：
ai-search-case.ts01interface AiSearchCase {
02  id: string
03  question: string
04  expectedSources: string[]
05  forbiddenSources?: string[]
06  tags: string[]
07}
08
09export const cases: AiSearchCase[] = [
10  {
11    id: 'leave-short',
12    question: '我明天想休一天，找直属领导就够了吗？',
13    expectedSources: ['leave-policy.md'],
14    tags: ['中文口语', '数量边界'],
15  },
16  {
17    id: 'leave-follow-up',
18    question: '那两天以上呢？',
19    expectedSources: ['leave-policy.md'],
20    tags: ['多轮指代'],
21  },
22  {
23    id: 'error-code',
24    question: 'ERR_AUTH_1042 怎么处理？',
25    expectedSources: ['auth-errors.md'],
26    tags: ['精确关键词'],
27  },
28  {
29    id: 'unknown',
30    question: '宠物体检可以走员工报销吗？',
31    expectedSources: [],
32    tags: ['知识库无答案'],
33  },
34]
标准问法只能证明文章标题能被搜到。评测集中还要包含简称、错别字、英文缩写、代码标识、多轮指代、时间条件和无答案问题。每次配置变更后运行同一批问题，结果才具有可比性。不要只保存模型回答。至少记录原问题、改写结果、过滤条件、返回 Chunk、score、scoring_details 和最终来源。答案错误时，我们先判断正确文档有没有进入候选，再决定处理检索还是生成。
3. 先检查解析和切块如果正确内容没有进入索引，任何检索参数都救不了它。PDF 的两栏排版可能被交叉读取，表格中的字段和值可能分开，网页导航也可能混入正文。调优前先在 Items 中查看转换后的文本。AI Search 使用递归切块，优先在段落和句子等自然边界处分割，过长时再继续拆分。我们可以配置 Chunk Size 和 0% 到 30% 的 Overlap。Chunking 文档 解释了这两个参数对索引和生成上下文的影响。Chunk 太小时，「连续两天及以上」可能与「直属负责人和部门负责人共同审批」落入两段，问题中的条件与答案失去联系。Chunk 太大时，年假、病假和调休规则混在一起，向量表达变得模糊，生成阶段也会收到更多噪声。中文制度文档可以从 400 到 700 Token 开始测试，Overlap 先取 10% 到 15%。这不是通用最佳值，只是合理起点。代码文档可能需要保留完整函数，FAQ 则更适合按问答对切分。评测结果应按文档类型分别观察，不能让平均分掩盖某一类资料完全失效。
4. 选择适合中文的 EmbeddingEmbedding 决定文本在向量空间中的位置。英文模型即使能够接收中文，也不代表它能稳定区分「少于两天」与「两天及以上」这种中文约束。Cloudflare 当前提供 @cf/baai/bge-m3 和 @cf/qwen/qwen3-embedding-0.6b。BGE-M3 是多语言、多粒度模型，Qwen3 Embedding 也面向文本检索与排序。选择时应在同一份中文评测集上比较 Recall@K，而不是只比较模型参数量。Embedding 模型在实例创建后不能修改。需要更换时，创建 company-policy-v2，使用新模型重新索引，让 v1 和 v2 同时跑评测。确认质量、延迟和费用后再切换应用 Binding，最后删除旧实例。这样不会让一半文档使用旧向量、一半文档使用新向量。
5. 使用混合检索向量检索擅长同义表达，关键词检索擅长精确标识。中文技术知识库通常同时需要两者：
问题更有帮助的检索方式「请一天假找谁签字」向量检索ERR_AUTH_1042关键词检索useTransition 卡顿原因混合检索「两天以上年假审批」混合检索
创建实例时同时启用 Vector 和 Keyword，查询时指定 hybrid：
hybrid-search.ts01const result = await env.COMPANY_POLICY.search({
02  messages: [{ role: 'user', content: question }],
03  ai_search_options: {
04    retrieval: {
05      retrieval_type: 'hybrid',
06      fusion_method: 'rrf',
07      max_num_results: 20,
08    },
09  },
10})
RRF 按两路结果中的排名融合，适合大多数场景。max 会采用归一化后的较高分，当其中一种检索方式长期明显更可靠时才值得评测。开启混合检索后，要分别查看 keyword_rank 和 vector_rank，确认正确文档究竟由哪一路召回。关键词索引还允许配置 Tokenizer 和匹配模式。中文不像英文天然使用空格分词，技术文章又包含 API、路径和版本号，因此必须用真实数据测试。若准确标识经常被切散，可以在文档中保留完整代码格式，并加入标题、别名或错误码字段，而不是只提高 Top-K。
6. 过滤必须早于召回用户只能看当前公司、当前版本和已发布制度，这些是硬条件，不是相关度偏好。AI Search 会在检索前应用 Metadata Filter，因此无权文档不会进入候选。内置元数据包括 filename、folder 和 timestamp。我们还可以定义最多 5 个自定义字段，例如：
custom-metadata.ts01const customMetadata = [
02  { field_name: 'tenant_id', data_type: 'text' },
03  { field_name: 'category', data_type: 'text' },
04  { field_name: 'version', data_type: 'number' },
05  { field_name: 'is_public', data_type: 'boolean' },
06  { field_name: 'effective_at', data_type: 'datetime' },
07]
查询时由服务端生成过滤条件：
filtered-search.ts01const result = await env.COMPANY_POLICY.search({
02  messages: [{ role: 'user', content: question }],
03  ai_search_options: {
04    retrieval: {
05      retrieval_type: 'hybrid',
06      filters: {
07        tenant_id: tenantId,
08        category: { $in: ['leave', 'attendance'] },
09        version: { $gte: 4 },
10        is_public: true,
11      },
12    },
13  },
14})
tenantId 不能直接相信请求体。Hono 应从已验证的 Session 中取得租户，再与用户允许访问的知识库求交集。把全库 Top-20 查出来后再在 JavaScript 中删除无权内容，会让真正有权限的第 21 条永远没有机会出现，也可能已经把敏感片段发送给重排模型。自定义元数据 Schema 发生变化时，AI Search 会重新索引全部文档。字段数量有限，应优先留给权限、版本和业务范围，不要把仅用于界面展示的信息全部设成可过滤字段。Metadata 文档 说明了字段类型和限制。
7. Boost 与 Filter 的区别Filter 决定一段资料有没有资格进入候选，Boost 只调整已经召回的候选顺序。例如旧版文档必须排除，应使用版本过滤；新闻搜索希望新文章略微靠前，可以按 timestamp Boost。
boost-recent.ts01const result = await env.COMPANY_POLICY.search({
02  messages: [{ role: 'user', content: question }],
03  ai_search_options: {
04    retrieval: {
05      boost_by: [
06        {
07          field: 'timestamp',
08          direction: 'desc',
09        },
10      ],
11    },
12  },
13})
Boost 发生在初始搜索之后、重排之前。它最多影响已经召回的 50 个候选，无法把候选集之外的文档拉进来。如果正确资料从未出现，继续增加 Boost 没有意义。Relevance Boosting 对执行顺序有明确说明。
8. 用重排缩小候选混合检索负责尽量找全，Reranker 负责在相近候选中判断哪一段真正回答问题。它同时阅读查询和候选文本，比只比较两个独立向量更细致。
reranked-search.ts01const result = await env.COMPANY_POLICY.search({
02  messages: [{ role: 'user', content: question }],
03  ai_search_options: {
04    retrieval: {
05      retrieval_type: 'hybrid',
06      max_num_results: 8,
07    },
08    reranking: {
09      enabled: true,
10      model: '@cf/baai/bge-reranker-base',
11    },
12  },
13})
重排会增加一次模型调用和延迟，不应替代基础召回。正确文档完全没有进入候选时，Reranker 无法创造资料；候选足够但前几名经常排错时，它才最有价值。Cloudflare 默认关闭重排，需要在实例设置或单次请求中明确启用。Reranking 文档 介绍了这一阶段。
9. 谨慎使用查询改写多轮对话中，用户会问「那两天以上呢」。单独检索这句话几乎没有主题，查询改写可以结合前文补成「连续请两天以上年假需要哪些人审批」。
rewritten-search.ts1const result = await env.COMPANY_POLICY.search({
2  messages: recentMessages,
3  ai_search_options: {
4    query_rewrite: {
5      enabled: true,
6    },
7  },
8})
改写也可能改变原意。原问题中的版本号、否定词和数量条件如果丢失，后续检索会非常流畅地回答另一个问题。因此 Trace 要同时保存原始问题和实际检索查询，并把「改写是否保持约束」加入评测。完整问题不一定需要改写。每次无条件调用会增加延迟和费用，也可能把本来清楚的错误码改成自然语言。可以根据对话指代、问题长度和评测标签决定是否启用。
10. 调整阈值和返回数量max_num_results 决定最终返回多少 Chunk，match_threshold 决定低于什么分数的结果被丢弃。Top-K 太小容易漏掉正确资料，太大则会把重复、旧版和旁支内容交给模型。比较稳妥的做法是先扩大候选观察 Recall@20，再启用重排压缩到 5 到 8 条用于生成。阈值则根据有答案和无答案问题的分数分布选择，不能照搬网上的 0.8。如果模型上下文包含 max_num_results × chunk size 个 Token，再加系统提示词、对话历史和输出预算，返回数量会直接影响费用与上下文上限。检索精度和生成成本应当一起评测。
11. 一套可复现的调优顺序当某个中文问题检索错误时，先确认正确原文存在且解析完整，再检查切块是否保留条件与答案。之后依次比较向量、关键词和混合检索，加入服务端过滤；正确文档已进入候选但排序不稳时，再启用 Boost 或 Reranker。多轮指代确实造成漏召回时，最后增加查询改写。每次只修改一组变量，并保存配置版本、评测结果、P95 延迟与模型费用。这样我们得到的是一套可以解释的检索策略，而不是一组偶然对当前三个问题有效的开关。
12. 总结AI Search 提供了完整的检索工具，但质量仍然来自数据、评测和有顺序的调优。解析与切块决定知识是否完整，Embedding 与混合检索决定能否召回，Filter 负责权限和版本，Boost 与 Reranker负责排序，查询改写只解决需要上下文的表达。下一篇会把 search() 包装成 LangChain Runnable，再放进 LangGraph 的检索节点。AI Search 继续负责候选搜索，应用负责证据判断、降级和最终生成。
