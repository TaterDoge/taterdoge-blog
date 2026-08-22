# 003 依赖漏洞升级（bun update + audit 复查）

## 为何重要

`bun audit --production` 报告 11 个漏洞（5 high / 4 moderate / 2 low）：

| 漏洞 | 依赖链 | 性质 |
| --- | --- | --- |
| js-yaml <4.3.1（CVE-2026-59870） | astro → @astrojs/internal-helpers | omap 解析 CPU DoS |
| nanoid（GHSA-2v37-7h3g-55p8） | vite/postcss 等 | 生成器循环 |
| brace-expansion <5.0.9 | @astrojs/vercel → nft → glob | DoS |
| sharp <0.35（libvips CVE 群） | astro → sharp | 图片处理链 |
| path-to-regexp <6.3.0 | @astrojs/vercel → routing-utils | 回溯 DoS |

多数在构建/部署链，不直接暴露给读者；sharp 服务于 `astro:assets` 图片优化，值得优先清。

## 范围

- **改**：`package.json` / `bun.lock`（由 bun 自动更新，尽量不手改版本）
- **不改**：源码

## 步骤

1. `bun update`（semver 兼容范围内升级）。
2. `bun audit --production` 复查：预期 high 数量下降；残留项记录原因。
3. `bun install` 确认 lockfile 一致。
4. `bun run check:content && bun run build` 验证。
5. 若 `astro` 主版本不升无法清除某 high（如 astro <7.0.6 的 advisory）：在 README/索引中记录"待 Astro 7 迁移"即可，**不要**在本计划中升级 astro major。
6. 对照 `git diff bun.lock | wc -l` 确认变更规模可控（千行以内属正常）。

## 测试计划

- 构建全绿即验收；图片优化链验证方式：`bun run build` 中任意页面含 `_image` 路径即可确认 sharp 正常。
- 可选：`bun run preview` 后请求一个文章页确认图片处理无回归。

## 完成标准

- `bun audit --production` 无 high（或残留项有明确记录与不可行理由）
- `bun run build` 通过
- dev 服务器可启动（`bun dev` 冒烟）

## 维护说明

- Vercel 构建环境以 `vercel-build` 拉取依赖，本地 lockfile 变更会直接作用于部署。
- `overrides: { vite: ^7 }` 存在，后续 astro 升级时确认 vite 7 兼容性再移除。
