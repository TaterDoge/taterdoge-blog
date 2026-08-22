# 001 发布链路校验：防「发布即红构建」

## 为何重要

`/admin/publish` 是作者发布内容的唯一入口，但 `src/pages/api/admin/publish.ts` 把 frontmatter 直接 commit 到 GitHub，不做任何服务端校验。三类输入会导致 Vercel 构建失败（错误只在 CI 暴露，API 却返回"成功"）：

1. `cover` 填远程 URL（表单提示"封面 URL"）→ `content.config.ts:18` 的 `image()` schema 拒绝远程 URL（Astro issue #11010 确认）→ 构建红。
2. `pubDate` 任意字符串 → `z.coerce.date()` 校验失败。
3. `category`/`slug` 含 `..` / `#` / `%` → `cleanDirName` 只过滤 `/\\:*?"<>|`（`publish.ts:59`），`..` 可通过 `new URL` 规范化逃逸到仓库任意路径；`#` 截断 URL。

## 范围

- **改**：`src/pages/api/admin/publish.ts`
- **改**：`src/lib/publish-markdown.ts`（006 提取的序列化模块，若已存在）
- **不改**：`src/content.config.ts` 的 schema（`image()` 保留，本地封面语义不变）
- **不改**：`src/components/publish/PublishApp.tsx`（仅更新 placeholder 文案提示本地路径）

## 当前状态

`publish.ts:59-66`：

```ts
function cleanDirName(value: string | undefined, fallback: string) {
 const name = (value || fallback)
  .trim()
  .replace(/[/\\:*?"<>|]+/g, "")
  .replace(/\s+/g, " ")
  .slice(0, 80)
  .trim();
 return name || fallback;
}
```

`publish.ts:158-166`（buildMarkdown 内）：

```ts
const cover = payload.cover?.trim();
// ...
["cover", payload.cover?.trim()],
```

## 步骤

1. 收紧 `cleanDirName`：替换规则不变，追加三项拒绝：
   - 清洗后为 `.` 或 `..` → 抛错（或回退 fallback 时同时拒绝）
   - 含 `#`、`%`、控制字符（`[\u0000-\u001f\u007f]`）→ 替换为空
   - 结果为空 → 抛错而不是静默 fallback（fallback 只在 slug 为空时使用）
2. `buildMarkdown` 增加校验：
   - `pubDate`：`new Date(pubDate)` 后 `Number.isNaN(...)` → 抛错 `Invalid pubDate`
   - `cover`：非空且以 `http://` / `https://` 开头 → 抛错，提示"封面必须是本地图片路径（相对文章目录，如 ./cover.png）"
3. `POST` 入口保持现有错误流：所有校验错误走统一 `json({ error }, 400)`，消息可读。
4. `PublishApp.tsx` 封面输入 placeholder 改为「本地路径如 ./cover.png，需与正文一起放文章目录」。
5. 运行 `bun run check:content && bun test`。

## 测试计划

在 `scripts/publish-markdown.test.ts`（或 006 建立的测试目录）追加用例：

- `cleanDirName("..", "fallback")` 抛错
- `cleanDirName("a#b", "f")` 结果为 `ab`（或按实现断言）
- cover 为 `https://example.com/x.png` → 抛错；`./cover.png` → 通过
- `pubDate: "not-a-date"` → 抛错；`2026-03-23` → 通过

## 完成标准

- `bun test` 全绿，含上述 4 类用例
- `bun run build` 通过
- 手动：curl 带伪造 cookie 调 POST，非法 cover/pubDate 返回 400 且消息明确

## 维护说明

- 发布校验规则与 `check-content.ts`、`content.config.ts` 三方共享"什么算合法内容"的语义，后续改 schema 时同步更新这里。
- `image()` schema 若未来改为接受远程 URL（`z.string()`），本计划的 cover 拒绝逻辑可移除——但 `getImage` 调用点（`[...slug].astro`、`blog-archive.ts`）也要同步改造，属更大变更。
