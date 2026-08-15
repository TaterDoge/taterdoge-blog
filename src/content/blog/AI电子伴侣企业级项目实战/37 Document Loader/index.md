---
title: "37 Document Loader"
pubDate: 2026-04-23
description: "这里处理的不是 Agent 每一轮实时调用，而是 Agent 背后的知识准备阶段。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/13-document-splitting/](https://aicompanion.usehook.cn/13-document-splitting/)

## 1. 概述

接下来，我们要学习关于向量查询的知识。

在前面的学习中，Agent 还回答不了如下这些问题：

- 公司内部文档里怎么规定请假流程？

- 用户上传的日记里提到过哪件事？

- 产品手册里某个配置项是什么意思？

这些内容不在会话线程里，也不适合直接塞进 `system` 消息中。

文档太长，一次塞进去没有意义

通常我们的做法是：先读进来，再切块，然后存入向量数据库，用到的时候再检索出来。

- 先把文档读进来

- 再把长文档切成小块

- 后面做检索时，只拿最相关的几块给 Agent

这篇先不讲向量库，先把第一步做好：**文档怎么切**

## 2. 文本分割在整条链里放在哪

把位置先看清楚，后面代码就不容易乱。

这里处理的不是 Agent 每一轮实时调用，而是 **Agent 背后的知识准备阶段**。

流程可以先记成这样：

- Loader 把文件读进来

- Splitter 把长文档切成小块

- 每个块再去做 embedding

- 向量库保存这些块

- 用户提问时，先检索相关块

- 最后把检索结果交给 Agent 回答

也就是说，**文本分割发生在检索之前，发生在 Agent 真正回答之前。**

如果这一步做得太粗，后面检索很难准。

如果这一步做得太碎，后面检索出来的内容又会不完整。

## 3. 先认识 Document

Loader 读完文件以后，往后传的不是原始文件，而是 `Document[]`。

document.ts

```typescript
import { Document } from '@langchain/core/documents'

// Document 是后面整条检索链里最基础的数据结构。
// 不管原始内容来自 PDF、Markdown 还是网页，读进来以后都会先变成它。
const doc = new Document({
  // pageContent 放真正要参与 embedding 和检索的正文。
  pageContent: '这是文档正文',
  metadata: {
    // metadata 不直接参与语义匹配，但后面可以拿来标记来源、页码、时间等信息。
    source: 'notes.txt',
    page: 1,
  },
})
```

这里先记两个字段就够了：

- `pageContent`：真正要参与检索的文字

- `metadata`：这段文字从哪里来

后面不管你是读 PDF、Markdown、网页，最终都会变成 `Document[]`。

Splitter 处理的也是这个结构。

## 4. 先把文档读进来

先看一个最小例子，把产品手册读出来，准备后面切块：

load-docs.ts

```typescript
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'

// 这里先把原始 PDF 接进来。
// 这一步只负责“读文件”，还没有开始切块。
const loader = new PDFLoader('./data/product-handbook.pdf')

// 这里拿到的是按页拆开的 Document[]。
const docs = await loader.load()

// 先看一眼整体数量，通常等于 PDF 页数。
console.log(docs.length)
// 再看正文内容，确认 Loader 真的把文字读出来了。
console.log(docs[0].pageContent.slice(0, 80))
// metadata 里通常会带 source、页码之类的信息，后面检索结果回显时会很有用。
console.log(docs[0].metadata)
```

如果你的知识来源不是 PDF，也可以换别的 Loader：

- `TextLoader`：读纯文本

- `CSVLoader`：读表格类问答数据

- `CheerioWebBaseLoader`：读网页正文

这一层不用想太复杂。

Loader 负责“读”，Splitter 负责“切”，两件事先分开。

## 5. RecursiveCharacterTextSplitter

大多数场景下，切割文档直接使用 `RecursiveCharacterTextSplitter` 就够了。

它的做法不是“每 500 个字符硬砍一刀”，而是先尝试沿着更自然的边界切：

- 先按段落

- 不够再按换行

- 还不够再按空格

- 最后才按字符硬切

这样切出来的块，通常会比固定长度硬切更完整。

split-basic.ts

```typescript
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

const splitter = new RecursiveCharacterTextSplitter({
  // 每个块的最大长度。
  // 这里不是越大越好，太大了后面检索出来会不够聚焦。
  chunkSize: 800,
  // 相邻两个块保留一小段重叠，减少一句话刚好被切断的情况。
  chunkOverlap: 120,
})

// createDocuments 适合直接从纯文本字符串开始切。
// 如果前面已经有 Loader 产出的 Document[]，后面更常用的是 splitDocuments。
const chunks = await splitter.createDocuments([
  `请假流程分为三步。

第一步，员工需要在系统里提交申请。
第二步，直属主管审批。
第三步，人事确认并归档。`,
])

console.log(chunks.length)
// 看一眼切出来的第一块，确认它是不是一个完整的小段，而不是半句话。
console.log(chunks[0].pageContent)
```

这里两个参数最重要：

- `chunkSize`：每块最多多大

- `chunkOverlap`：相邻两块重叠多少

先别急着背参数表，先记一件事：

**切块的目标不是“切得整齐”，而是“切出来的每一块尽量自己能说清一件事”。**

## 6. 给 Agent 准备知识库时，代码一般这样写

下面这段更接近项目里的样子。

它不是最终的检索代码，而是 Agent 知识库的预处理步骤。

prepare-knowledge.ts

```typescript
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

// 这一层还是知识准备阶段，不是实时问答阶段。
// 所以代码目标很明确：先把文档整理成适合后面建索引的 chunks。
const loader = new PDFLoader('./data/employee-handbook.pdf')

const splitter = new RecursiveCharacterTextSplitter({
  // 每块不要太大，后面检索出来才容易聚焦。
  chunkSize: 900,
  // 留一点重叠，避免一句完整的话刚好被切断。
  chunkOverlap: 120,
})

async function prepareKnowledgeBase() {
  // 1. 先把原始文档读成 Document[]。
  const rawDocs = await loader.load()

  // 2. 再把长文档切成更小的块。
  // splitDocuments 会保留原来每个 Document 的 metadata。
  const chunks = await splitter.splitDocuments(rawDocs)

  // 3. 这里顺手把每个块整理成我们自己更容易处理的结构。
  // 后面做 embedding、写向量库、调试来源信息，都会用到这些字段。
  return chunks.map((doc, index) => ({
    // id 先用顺序号演示，真实项目里通常会拼 source + chunkIndex。
    id: `handbook-${index}`,
    // pageContent 是后面真正要做 embedding 的正文。
    pageContent: doc.pageContent,
    // metadata 则继续保留来源信息，方便后面回溯这块是从哪里切出来的。
    metadata: doc.metadata,
  }))
}

// 真正执行一次知识准备流程。
// 走完这里以后，chunks 就已经是后面做 embedding 和写向量库的输入了。
const chunks = await prepareKnowledgeBase()

// 先看总量，确认这份手册最终被切成了多少块。
console.log(chunks.length)
// 再看第一块长什么样，顺手检查正文和 metadata 有没有一起保留下来。
console.log(chunks[0])
```

这段代码里，最值得看清的是分工：

- Loader 负责把文件变成 `Document[]`

- Splitter 负责把 `Document[]` 切成更小的 `Document[]`

- Agent 现在还没有出场

Agent 真正出场是在后面：

- 用户提问

- 先从向量库检索 chunks

- 再把检索结果塞给 Agent

所以这一步虽然不是 `createAgent(...)`，但它就是在给 Agent 备料。

## 7. 不同文档，分割方式不一样

不是所有文档都用同一个分割器。

### Markdown 文档

如果你切的是技术文档、产品说明、知识库页面，Markdown 结构本身就很有用。

这时候优先沿着标题来切，通常更稳。

split-markdown.ts

```typescript
import { MarkdownTextSplitter } from '@langchain/textsplitters'

const splitter = new MarkdownTextSplitter({
  // Markdown 文档通常希望尽量沿着标题结构切。
  chunkSize: 900,
  chunkOverlap: 120,
})

const chunks = await splitter.createDocuments([
  `# 员工手册

## 请假流程

员工提交申请后，需要主管审批。

## 报销流程

报销需要上传票据和审批单。`,
])

// 这里切出来的块，通常会比普通分割更容易保持章节完整。
```

### 代码文档

如果你的知识库里有很多代码片段，最好按代码结构来切，不要只按自然语言段落来切。

split-code.ts

```typescript
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

// 代码文档不要只按自然语言段落切。
// fromLanguage 会优先参考函数、代码块这些更像“代码边界”的位置。
const splitter = RecursiveCharacterTextSplitter.fromLanguage('js', {
  chunkSize: 1200,
  chunkOverlap: 150,
})

const chunks = await splitter.createDocuments([
  `function login() {
  // ...
}

function logout() {
  // ...
}`,
])

// 这样切出来的块，后面做代码类检索时通常更稳定。
```

如果你现在没有把握，先这样用就够了：

- 通用文本：`RecursiveCharacterTextSplitter`

- Markdown：`MarkdownTextSplitter`

- 代码：`fromLanguage(...)`

## 8. 参数先怎么定

新手最容易在这里卡住：

`chunkSize` 到底该设多少，`chunkOverlap` 到底该留多少。

可以先用一组不太容易出错的起步值：

| 文档类型 | chunkSize | chunkOverlap |
| --- | --- | --- |
| 通用文档 | 700~1000 | 80~150 |
| Markdown 文档 | 700~1000 | 80~150 |
| 代码文档 | 1000~1500 | 120~200 |
| FAQ / 问答对 | 200~500 | 20~60 |

如果你不知道怎么判断好不好，用最直接的办法：

- 准备 5 到 10 个真实问题

- 跑一次检索

- 看返回的块是不是完整

一般只会遇到两种问题：

- 检索出来的信息总像缺半句

这通常是块太小，或者 overlap 不够

- 检索出来的内容什么都沾一点

这通常是块太大，几个话题混在一起了

调参数时，不要追求一开始就“最优”。

先让检索结果看起来像是能回答问题的，再继续细调。
