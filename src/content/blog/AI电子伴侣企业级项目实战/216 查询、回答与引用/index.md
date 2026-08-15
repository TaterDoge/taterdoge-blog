---
title: "216 查询、回答与引用"
pubDate: 2026-08-06
description: "知识库已经索引完成，现在可以查询了。小白最容易从控制台的 Chat 页面开始，因为输入问题后马上能看到答案。不过在代码里，我们最好先认识 search：它只返回资料，不会用一段流畅回答掩盖检索问题。"
tags: [AI编程, RAG, 向量检索, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-06
---
原文链接：[https://aicompanion.usehook.cn/12cloudflare-ai-search-query/](https://aicompanion.usehook.cn/12cloudflare-ai-search-query/)

1. 先取回资料，再决定怎样回答
知识库已经索引完成，现在可以查询了。小白最容易从控制台的 Chat 页面开始，因为输入问题后马上能看到答案。不过在代码里，我们最好先认识 search()：它只返回资料，不会用一段流畅回答掩盖检索问题。
假设用户问：
NOTE
我想休两天年假，需要找谁？
理想结果应该命中「连续两天及以上」的规则，而不是只看到「少于两天」。这个例子特意放在边界上，可以检查检索结果是否保留了数量条件。
2. 使用 search 检索 Chunk实例绑定可以直接调用 search()：
search-policy.ts01interface Env {
02  COMPANY_POLICY: AiSearch
03}
04
05export async function searchPolicy(env: Env, question: string) {
06  return env.COMPANY_POLICY.search({
07    messages: [
08      {
09        role: 'user',
10        content: question,
11      },
12    ],
13    ai_search_options: {
14      retrieval: {
15        retrieval_type: 'hybrid',
16        match_threshold: 0.4,
17        max_num_results: 8,
18      },
19    },
20  })
21}
也可以传入简单的 query 字符串，但 query 与 messages 只能选择一种。多轮问答需要结合前文理解「那两天以上呢」这类指代时，messages 更合适。retrieval_type 可以是 vector、keyword 或 hybrid。当前接口默认使用混合检索，代码仍然明确写出它，是为了让 Trace 能够还原这次查询采用的策略。match_threshold 范围是 0 到 1，默认值为 0.4；这个数字只是起点，不能未经评测直接当成业务置信度。
返回值的核心是 chunks：
inspect-search-result.ts01const result = await searchPolicy(
02  env,
03  '我想休两天年假，需要找谁？',
14)

05
06for (const chunk of result.chunks) {
07  console.log({
08    id: chunk.id,
09    text: chunk.text,
10    source: chunk.item.key,
11    score: chunk.score,
12    vectorScore: chunk.scoring_details?.vector_score,
13    keywordScore: chunk.scoring_details?.keyword_score,
14    rerankingScore:
15      chunk.scoring_details?.reranking_score,
16  })
17}
item.key 是来源文件路径或网页 URL，text 是实际命中的片段，score 是最终相关度。启用混合检索和重排后，scoring_details 会告诉我们各阶段的分数与排名。排查问题时，这些字段比最终答案更有价值。
3. 使用 chatCompletions 生成答案如果希望 AI Search 同时完成检索和生成，可以调用 chatCompletions()：
answer-policy.ts01export async function answerPolicy(
02  env: Env,
03  question: string,
04) {
05  const response = await env.COMPANY_POLICY.chatCompletions({
06    messages: [
07      {
08        role: 'system',
09        content: `你是员工制度助手。
10只能依据检索资料回答。
11资料不足时明确说明无法确认。`,
12      },
13      {
14        role: 'user',
15        content: question,
16      },
17    ],
18    ai_search_options: {
19      retrieval: {
20        retrieval_type: 'hybrid',
21        max_num_results: 6,
22      },
23      reranking: {
24        enabled: true,
25        model: '@cf/baai/bge-reranker-base',
26      },
27    },
28  })
29
30  return {
31    answer: response.choices[0]?.message?.content ?? '',
32    chunks: response.chunks,
33  }
34}
生成模型可以使用实例设置中的默认值，也可以通过 model 参数为单次请求指定 Workers AI 模型。外部 OpenAI、Anthropic 或 Google 模型可以通过 AI Gateway 接入；另一种做法是只调用 search()，再把资料交给自己的 LangChain 模型。前一种方式代码更短，后一种方式更容易插入质量门禁、业务 Prompt 和成本控制。两种都合理，取决于应用是否需要控制检索与生成之间的步骤。
4. 返回可核对的引用知识库答案如果没有来源，读者只能相信模型语气。AI Search 会把生成时使用的 Chunk 一起返回，我们可以把它们整理成引用：
build-citations.ts01interface Citation {
02  source: string
03  score: number
04  snippets: string[]
05}
06
07interface CitationChunk {
08  item: {
09    key: string
10  }
11  score: number
12  text: string
13}
14
15export function buildCitations(chunks: CitationChunk[]) {
16  const sources = new Map<string, Citation>()
17
18  for (const chunk of chunks) {
19    const source = chunk.item.key
20    const existing = sources.get(source)
21
22    if (existing) {
23      existing.score = Math.max(existing.score, chunk.score)
24      existing.snippets.push(chunk.text.slice(0, 200))
25      continue
26    }
27
28    sources.set(source, {
29      source,
30      score: chunk.score,
31      snippets: [chunk.text.slice(0, 200)],
32    })
33  }
34
35  return [...sources.values()]
36}
同一个文件可能命中多个 Chunk，因此引用应按 item.key 去重。界面可以显示文件名、最高相关度和一两段摘要，点击后跳到原文。不要把 score > 0.8 直接翻译成「80% 正确」，它只反映当前检索配置下的相关度，不是答案正确概率。Cloudflare 的 引用指南 列出了 Chunk 的完整字段，包括向量得分、关键词排名、重排得分和融合方式。
5. 用 Hono 暴露问答接口AI 电子伴侣的 API 子站使用 Hono，我们可以把实例绑定放在 Hono 环境类型中：
app.ts01import { Hono } from 'hono'
02import { z } from 'zod'
03
04interface Bindings {
05  COMPANY_POLICY: AiSearch
06}
07
08const querySchema = z.object({
09  question: z.string().trim().min(2).max(1000),
10})
11
12const app = new Hono<{ Bindings: Bindings }>()
13
14app.post('/api/knowledge/query', async (c) => {
15  const input = querySchema.parse(await c.req.json())
16  const result = await answerPolicy(
17    c.env,
18    input.question,
19  )
20
21  return c.json({
22    answer: result.answer,
23    citations: buildCitations(result.chunks),
24  })
25})
26
27export default app
这里没有让浏览器直接持有 Cloudflare API Token。Worker Binding 只存在服务端，Hono 在调用前还可以检查登录态、订阅状态和访问范围。即使开启 AI Search Public Endpoint，包含私密资料的实例也不应该让前端绕过业务鉴权直接请求。
6. 流式回答中的引用chatCompletions() 设置 stream: true 后会返回 SSE。AI Search 先发送一个名为 chunks 的事件，再发送模型生成的文本片段：
ai-search-stream.txt1event: chunks
2data: [{ "id": "chunk-1", "text": "...", "item": { "key": "leave-policy.md" } }]
3
4data: { "choices": [{ "delta": { "content": "连续两天" } }] }
5data: { "choices": [{ "delta": { "content": "及以上需要" } }] }
6data: [DONE]
这意味着界面可以先展示「正在参考：员工年假制度」，随后逐字显示回答。解析时不能假设一个网络数据块恰好对应一行 SSE；需要保留未完成的尾部字符串，按空行切分完整事件。前面的流式输出章节已经解释过这个边界，这里只需要新增对 event: chunks 的处理。流式模式下也要处理用户取消。浏览器断开连接后，应把 AbortSignal 传到可取消的上游调用，并记录请求是否已经产生模型用量，不能只停止界面渲染。
7. 没有结果时怎样处理AI Search 即使找不到真正答案，也可能返回全库中最相似的资料。用户问「宠物体检能报销吗」，员工医疗制度可能得到一个不低的相似度。因此，空数组不是唯一的无答案信号。应用还要结合最高分、重排分、候选之间的一致性和问题中的关键条件判断。第一版可以采用保守策略：没有 Chunk 或所有候选低于评测得到的阈值时，不调用生成模型，直接说明现有资料不足。
retrieval-gate.ts1export function hasUsableEvidence(
2  chunks: Array<{ score: number }>,
3  threshold: number,
4) {
5  return chunks.length > 0 && chunks[0].score >= threshold
6}
阈值必须来自自己的问题集。换 Embedding、开启重排或调整 Chunk Size 后，分数分布都会变化。生产环境应保存当次策略版本，避免用新阈值解释旧日志。
8. REST API 的使用边界非 Worker 服务也可以调用 REST API。实例级搜索地址为：
ai-search-endpoint.txt1POST <https://api.cloudflare.com/client/v4/accounts/{account_id}/ai-search/instances/{instance_name}/search>
API Token 需要 AI Search:Edit 和 AI Search:Run 权限。Token 只能保存在服务端 Secret 中，不能写进 Next.js Client Component 或提交到仓库。旧文章可能使用 /autorag/rags/ 路径。Cloudflare 仍然兼容旧接口，但新功能只会加入 /ai-search/instances/。新项目应直接使用当前 API，避免刚完成接入就开始迁移。REST API 文档 给出了实例和命名空间两种路径。
9. 总结search() 负责返回可观察的检索证据，chatCompletions() 在此基础上继续生成回答。真实应用应当把来源 Chunk 一起交给界面，而不是只返回一段没有依据的文本。下一篇会围绕中文检索质量继续调整 Chunk、混合检索、过滤、权重和重排。我们会先找出错误发生在哪一层，再修改对应参数，而不是同时打开所有功能碰运气。
