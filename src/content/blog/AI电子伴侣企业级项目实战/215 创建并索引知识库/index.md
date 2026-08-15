---
title: "215 创建并索引知识库"
pubDate: 2026-08-06
description: "这一篇先完成知识准备，不急着让模型回答问题。我们要创建一个名为 company-policy 的 AI Search 实例，并放入三份 Markdown 文件：年假制度、差旅报销规则和设备申领办法。"
tags: [AI编程, RAG, 向量检索, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-06
---
原文链接：[https://aicompanion.usehook.cn/11cloudflare-ai-search-indexing/](https://aicompanion.usehook.cn/11cloudflare-ai-search-indexing/)

## 1. 准备练习资料

这一篇先完成知识准备，不急着让模型回答问题。我们要创建一个名为 `company-policy` 的 AI Search 实例，并放入三份 Markdown 文件：年假制度、差旅报销规则和设备申领办法。

可以先准备下面这份年假资料：

leave-policy.md

```markdown
# 员工年假制度

## 短期年假

少于两天的年假，由直属负责人审批。

## 长期年假

连续两天及以上的年假，需要直属负责人和部门负责人共同审批。

## 提交时间

年假申请应至少提前两个工作日提交。
```

标题层级不是装饰。解析器通常会利用标题和段落边界切块，清楚的文档结构能让「长期年假」和对应规则留在同一段语义中。真实资料如果只有扫描图片、复杂表格或凌乱换行，应先检查解析结果，再讨论 Embedding 参数。

## 2. 在控制台创建实例

登录 Cloudflare 控制台后，进入 **AI > AI Search**，选择创建实例。实例名称填写 `company-policy`，命名空间暂时使用账户自带的 `default`。

数据源先选择 Built-in storage。它不要求提前创建 R2 Bucket，适合小白完成第一次练习。索引方式同时启用 Vector 与 Keyword，让实例具备混合检索能力。按照上一篇的起步方案，Embedding 先选择 `@cf/qwen/qwen3-embedding-0.6b`；后续需要比较召回效果时，再建立一个使用 `@cf/baai/bge-m3` 的对照实例。

创建时要认真确认 Embedding 模型，因为它不能在实例创建后直接替换。Chunk Size 和 Overlap 可以继续调整，修改后服务会重新处理文档；Embedding 模型选错时，更稳妥的迁移方式是创建新实例并重新索引。

实例建立后打开 Items，上传三份 Markdown 文件。每个文件会经历排队、解析、切块和索引，只有状态变为可检索后才适合测试。上传接口返回成功并不代表索引已经完成，这是第一次使用时最容易误判的地方。

## 3. 三种数据源怎样选择

内置存储适合少量上传、临时知识库和用户补充文件。文件通过 Items API 写入后会立即进入处理队列，不存在定时同步任务。

如果知识本来就是网站内容，可以在创建实例时连接 Website。Cloudflare 会按照 Sitemap 抓取页面，因此站点至少要满足下面一项：在配置中指定 Sitemap、在 `robots.txt` 中声明 Sitemap，或者能够访问 `/sitemap.xml`。没有 Sitemap 时，AI Search 不会漫无目的地扫描整个网站。

网站中通常还包含导航、页脚、按钮和推荐文章。我们可以配置 Content Selector，例如让 `**/docs/**` 只提取 `main .content`。选择器如果没有命中任何元素，该页面会得到空 Markdown 并进入错误状态，所以应先用少量路径验证，再扩大范围。[Website 数据源文档](https://developers.cloudflare.com/ai-search/configuration/data-source/website/) 还说明了 Sitemap、路径过滤和 WAF 放行方式。

R2 适合长期保存原始文件。业务系统先把文件写入 Bucket，AI Search 再按计划同步。即使以后更换检索服务，R2 里的原文件仍然存在，不会因为删除搜索实例而失去事实来源。

## 4. 创建 Worker 项目

控制台适合认识配置，应用最终还要通过代码访问。新建一个 TypeScript Worker：

terminal

```shellscript
yarn create cloudflare ai-search-demo
cd ai-search-demo
```

创建向导选择 Worker only 和 TypeScript。实例已经存在，因此我们使用 `ai_search` 把 Worker 直接绑定到 `company-policy`：

wrangler.jsonc

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "ai-search-demo",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-05",
  "ai_search": [
    {
      "binding": "COMPANY_POLICY",
      "instance_name": "company-policy",
      "remote": true
    }
  ]
}
```

`binding` 是代码里的环境变量名，`instance_name` 是刚才创建的实例。`remote: true` 表示本地执行 `wrangler dev` 时，请求仍然代理到 Cloudflare 上已经部署的 AI Search 实例。本地不会模拟一套向量索引。

如果 TypeScript 提示找不到 `AiSearch`，先检查依赖版本。新 Binding 至少需要 `wrangler@4.68.1` 和 `@cloudflare/workers-types@4.20260304.0`；C3 新建的项目通常已经满足，旧 Worker 项目则需要手动升级。

如果应用运行时需要访问很多实例，例如每个企业租户拥有独立知识库，应改用 `ai_search_namespaces`。它会暴露 `env.AI_SEARCH.get(instanceName)`，实例绑定则直接使用 `env.COMPANY_POLICY.search()`。初学阶段绑定一个实例更容易理解。

Cloudflare 已经把旧版 AutoRAG Binding 标记为旧接口。网上的 `env.AI.autorag('name')` 还能看到，但新项目应使用 `ai_search` 或 `ai_search_namespaces`，否则无法使用后续新增能力。[Binding 迁移文档](https://developers.cloudflare.com/ai-search/api/migration/workers-binding/) 列出了两套接口的差异。

## 5. 通过 Items API 上传文件

控制台上传适合手工测试，真实应用通常需要在发布文章或用户上传文件时自动写入。Items API 位于实例的 `items` 属性下：

upload-policy.ts

```typescript
interface Env {
  COMPANY_POLICY: AiSearch
}

export async function uploadPolicy(
  env: Env,
  input: {
    filename: string
    content: string
  },
) {
  return env.COMPANY_POLICY.items.upload(
    input.filename,
    input.content,
  )
}
```

文件名应当稳定。把同一篇制度每次都随机命名，会留下多份内容相近的文档，查询时新旧版本可能一起出现。生产系统可以使用 `tenant/document/version` 形式的路径，并在新版本完成索引后删除旧版本。

Items API 也接受 `ArrayBuffer` 和 `ReadableStream`，因此 PDF 不必先转成字符串：

upload-pdf.ts

```typescript
const response = await fetch('https://example.com/expense-policy.pdf')
const content = await response.arrayBuffer()

await env.COMPANY_POLICY.items.upload(
  'policies/expense-policy.pdf',
  content,
)
```

上传调用会尽快返回，文档在后台排队处理。后续如果立即执行测试，可以改用 `uploadAndPoll()` 等待处理完成：

upload-and-poll.ts

```typescript
const item = await env.COMPANY_POLICY.items.uploadAndPoll(
  'policies/leave-policy.md',
  leavePolicyContent,
  {
    pollIntervalMs: 1000,
    timeoutMs: 30_000,
  },
)

console.log(item.status, item.chunks_count)
```

默认超时并不等于索引失败，只表示客户端不再继续轮询；之后仍可通过 Item ID 查询状态。不要用固定休眠两秒来赌处理速度。[Items Workers Binding](https://developers.cloudflare.com/ai-search/api/items/workers-binding/) 还提供列出、读取和删除文件的方法。

## 6. 网站内容的同步

Website 和 R2 属于外部数据源，默认每 6 小时运行一次同步任务。可选间隔是 1、2、4、6、12 或 24 小时，也可以在内容发布后通过 Wrangler 主动触发：

terminal

```shellscript
yarn wrangler ai-search jobs create company-policy
```

同步任务会处理新增、修改和删除的文件。对于网站，Sitemap 中准确的 `<lastmod>` 可以减少无意义抓取；如果没有 `<lastmod>` 和 `<changefreq>`，页面会每天重新检查一次。

实例连续 31 天没有搜索请求时，外部数据源的计划同步会自动暂停。实例仍然可以查询，但新内容不会继续进入索引；重新出现搜索流量后会自动恢复，也可以在控制台手动恢复。[同步文档](https://developers.cloudflare.com/ai-search/configuration/indexing/syncing/) 记录了这些行为。

## 7. 检查索引结果

第一次导入资料后，不要马上只问「年假怎么请」然后根据一句回答判断效果。我们至少要检查四件事：三个文件是否全部成功、每个文件解析出的正文是否完整、切块是否把标题与规则拆开、旧文件是否仍然存在。

如果某个文件报错，先看 Indexing Error，而不是重复上传。常见原因包括文件超过 4 MB、格式不支持、网站选择器没有命中、R2 访问 Token 失效和图片转换模型调用失败。

可以准备三个最简单的冒烟问题：

smoke-questions.txt

```txt
请一天年假需要谁批准？
差旅费用最晚什么时候提交？
办公显示器由哪个部门申领？
```

三个问题分别命中三份资料，能够快速发现某个来源没有进入索引。但它们只是连通性检查，不能替代后面的中文检索评测。

## 8. 总结

这一篇完成了 AI Search 的知识准备：创建实例、选择数据源、上传文件，并通过 Workers Binding 建立代码连接。Built-in storage 适合快速开始，Website 适合公开内容，R2 更适合保留生产原文件。

下一篇会分别调用 `search()` 和 `chatCompletions()`。我们不只显示模型答案，还会把来源文件、相关片段和评分一起返回，让读者能够验证答案依据。
