# advisor-plans 索引

> 基线提交：`dc36c57`（2026，审计时 HEAD）
> 定位：`plans/` 已被「原站文章更新对比报告」占用，审计计划改放本目录。

## 状态表

| 计划 | 标题 | 优先级 | 依赖 | 状态 |
| --- | --- | --- | --- | --- |
| 001 | 发布链路校验：防「发布即红构建」 | P0 | 006 | ✅ 已完成 |
| 002 | 修复 astro check（TypeScript 降级到 6.x） | P0 | 无 | ✅ 已完成 |
| 003 | 依赖漏洞升级（bun update + audit 复查） | P0 | 无 | ✅ 已完成 |
| 004 | 抽取共享 GitHub 客户端 | P1 | 无 | ✅ 已完成 |
| 005 | 小修复集：mailto / meting 缓存 / vendor map | P1 | 无 | ✅ 已完成 |
| 006 | 序列化纯函数提取 + bun test 基线 | P1 | 无 | ✅ 已完成 |

## 执行结果（2026-08 审计会话）

- 全部 6 个计划已实施并验证：`check:content` / `typecheck`（0 errors）/ `bun test`（28 通过）/ `build` 全绿。
- 003 补充：`package.json` overrides 新增 js-yaml/brace-expansion/nanoid/path-to-regexp/sharp，漏洞从 11 → 6（0 high）。
- 残留 4 moderate（astro <7.0.6 的 XSS 修复）+ 2 low（esbuild dev-only），等待 Astro 7 迁移时清除。

## 推荐执行顺序

005 → 002 → 003 → 006 → 001 → 004

理由：

- 005/002/003 是独立低风险改动，先行清场。
- 006 先提取并测试序列化纯函数，001 的校验逻辑改动才有回归保护。
- 001 的 `cleanDirName` / frontmatter 逻辑与 004 的抽取互不重叠，可顺序执行。

## 验证命令（每个计划通用）

```bash
bun run check:content     # 内容结构校验
bun run build             # 完整构建（字体子集 + 内容 + astro + pagefind）
bun test                  # 006 之后生效
bun run typecheck         # 002 之后生效（astro check）
```
