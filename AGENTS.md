# 内容编写约束

写 blog / 碎念 / 项目前先读本文件。生成内容后必须跑 `bun run check:content`（或完整 `bun run build`）。

## 博客 `src/content/blog`

### 目录规则（强制）

1. **分类必须有对应目录**：目录名直接用中文/可读名称，与 `category` 一致或一眼能对应。
2. **每篇文章必须是独立目录**：禁止单文件文章；统一用 `index.md`。
3. **文章目录名用中文短名**：从标题提炼，打开目录就能认出是哪篇。
4. **本地资源放在文章目录内**：封面、配图与正文同目录。

```text
src/content/blog/
  Flutter/
    把 pubspec.yaml 管成工程资产/
      index.md
      cover.png                         # 推荐；暂无可用全局占位
      diagram.svg                       # 可选正文配图
  学习笔记/
    Go 并发入门/
      index.md
      cover.png
```

正文本地资源用相对路径：`![说明](./diagram.svg)`

### 命名约定

| 层级 | 规则 | 示例 |
| --- | --- | --- |
| 分类目录 | 与 `category` 同名或可直接对应 | `Flutter`、`学习笔记` |
| 文章目录 | 中文短名，能辨认内容；可保留专有名词 | `把 pubspec.yaml 管成工程资产` |
| 禁止 | 纯英文 slug 堆砌、无意义哈希、过长整句标题 | `pubspec-as-engineering-asset` |

- 新分类先建目录，再写文章
- 目录名避免 `/ \ : * ? " < > |`
- 专有技术词可保留英文（如 `pubspec.yaml`、`Flutter`）

### 封面 cover

- 推荐每篇提供 `cover.png` / `cover.jpg` / `cover.webp`
- frontmatter：`cover: "./cover.png"`
- **暂无封面时可省略 `cover`**，列表/卡片会走全局占位图 `/images/image-placeholder.svg`
- 有本地 cover 时必须放在该文章目录内，不要放到 `public/` 或 blog 根目录

### 禁止

- `src/content/blog/*.md` 单文件文章
- `src/content/blog/<分类>/*.md`（分类目录下直接放 md）
- `文章名.md` + `文章名.assets/` 并列
- 在 `src/content/blog/` 或分类根目录直接放媒体文件
- 编造事实、日期、链接、技术细节；缺素材先问

### frontmatter

```yaml
---
title: "标题"
description: "一句话摘要"   # 必填
pubDate: 2026-03-23
updatedDate: 2026-03-24     # 可选
tags: ["Go"]
category: "Flutter"         # 必填；对应分类目录名
draft: false
visibility: "public"        # public | private
cover: "./cover.png"        # 推荐；暂无封面可省略
syncToKb: false             # 可选
---
```

- 新稿默认 `draft: true`，确认后再改 `false`
- Schema 真相源：`src/content.config.ts`

### 新文章落盘模板

```text
src/content/blog/<分类中文名>/<文章中文短名>/
  index.md
  cover.png   # 有素材再放；没有就先不写 cover 字段
```

## 碎念 `src/content/notes`

单文件 Markdown：

```yaml
---
title: "标题"
pubDate: 2026-03-23
mood: "安静"                # 可选
tags: ["想法"]
visibility: "public"
images: []                  # 远程 URL 列表；碎念不使用本地资源目录
---
```

短文即可，不需要 description / category / draft。

## 项目 `src/data/projects.ts`

在 `projects` 数组追加对象，不要新建 md：

```ts
{
  name: "项目名",
  description: "简介",
  techStack: ["Python"],
  tags: ["Python"],
  category: "自动化工具",
  cover: "/images/project-default.svg",
  github: "https://github.com/...",
  demo: "#",
  status: "维护中", // 或 "已发布"
  featured: false,
}
```

## 生成流程

1. 确认类型：blog / note / project
2. 缺 title、要点、分类、素材时先问，不瞎补
3. blog：确认/创建分类目录（中文名）→ 创建文章目录（中文短名）→ 写 `index.md`
4. `bun run check:content`
5. 需要时再 `bun run build`
