# 006 序列化纯函数提取 + bun test 基线

## 为何重要

全仓库除 `scripts/check-content.ts`（内容结构校验）外无任何测试。发布/管理链路的核心逻辑是纯函数（frontmatter 序列化、TS 对象序列化、路径清洗、阅读时长），但被埋在 `src/pages/api/admin/*.ts` 的 API 处理函数里无法单测。后续 001（发布校验）、004（GitHub 客户端）都会改动这些函数——没有测试就没有回归保护。

## 范围

- **新建**：`src/lib/publish-markdown.ts`（从 publish.ts 提取：`cleanDirName`、`timestampSlug`、`yamlString`、`yamlArray`、`frontmatter`、`buildMarkdown`、`toList`，导出）
- **新建**：`src/lib/serialize-data.ts`（从 manage.ts 提取：`quote`、`serializeValue`，导出）
- **新建**：`src/lib/__tests__/publish-markdown.test.ts`、`src/lib/__tests__/serialize-data.test.ts`、`src/lib/__tests__/reading-time.test.ts`
- **改**：`src/pages/api/admin/publish.ts`、`src/pages/api/admin/manage.ts`（改为 import 提取模块）
- **改**：`package.json` scripts 新增 `"test": "bun test"`（bun test 原生支持 TS，零依赖）
- **不改**：测试不触碰网络/GitHub；只测纯函数

## 步骤

1. 提取 `publish.ts` 的序列化纯函数到 `src/lib/publish-markdown.ts`。`buildMarkdown` 保持原有签名与错误消息（PublishPayload 类型移到该文件或从 types 导入——`src/types/marchen.d.ts` 若合适放 `PublishPayload`）。
2. `publish.ts` top-level 改为 `import { buildMarkdown, ... } from "@/lib/publish-markdown"`，删除本地副本。
3. 提取 `manage.ts` 的 `serializeValue`/`quote` 到 `src/lib/serialize-data.ts`；`serializeDataFile`/`targets` 留在 manage.ts（依赖 kind 映射）。
4. 新增测试（`bun test` 语法，`node:assert` + 原生 describe/it 可用可直接用 `import { describe, it, expect } from "bun:test"`）：
   - `publish-markdown`：frontmatter 输出格式（title 转义、数组 YAML、boolean）、cleanDirName 清洗、buildMarkdown blog/note/project 分支错误路径（缺 title/body/category 抛错）
   - `serialize-data`：对象/数组/字符串/布尔/null 的序列化、空数组、嵌套对象缩进、`undefined`/`""` 过滤
   - `reading-time`：纯中文/纯英文/代码块剔除/空文本
5. `bun test` 全绿。
6. `bun run check:content && bun run typecheck && bun run build`。

## 测试计划

本计划即测试计划。所有用例离线、确定性、毫秒级。

## 完成标准

- `bun test` 通过，用例数 ≥ 20（三个测试文件合计）
- `publish.ts` / `manage.ts` 不再包含被提取函数的本地定义
- `bun run typecheck` 零错误；`bun run build` 通过
- API 行为不变（错误消息、输出格式与提取前逐字一致——测试里用断言锁住）

## 维护说明

- `bun test` 用 bun 自带 runner，无需 vitest/jest 依赖；这是刻意选择（零新依赖）。
- 提取时**不要顺手重构**逻辑（比如不要改 YAML 转义方式），保持 diff 纯移动；逻辑改进由 001 计划负责。
- 若未来 publish.ts 需要校验逻辑，优先放在 `publish-markdown.ts` 内（可测），而不是 API 处理函数里。
