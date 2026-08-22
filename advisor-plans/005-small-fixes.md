# 005 小修复集：mailto / meting 缓存 / vendor map

## 为何重要

三个独立小问题，单个不值得计划，合批处理：

1. `src/data/site.ts:38` Email 社交链接 `href: "taterdoge.email@gmail.com"` 缺 `mailto:` 前缀，渲染成相对链接，点击 404。
2. `src/pages/music-player-frame.astro:14` 播放器 URL 带 `r=Date.now()`，且 `src/pages/api/music/meting.ts:48` 兜底 `Math.random()`——每次加载 URL 都不同，代理响应的 `cache-control: public, max-age=600` 永不命中，每次回源第三方 injahow API。
3. `public/vendor/aplayer/` 提交了 `.map` 文件（`APlayer.min.css.map` 20.9K、`APlayer.min.js.map` 168.2K），浏览器调试资源，生产无用，纯仓库死重。

## 范围

- **改**：`src/data/site.ts`
- **改**：`src/pages/music-player-frame.astro`
- **改**：`src/pages/api/music/meting.ts`
- **删**：`public/vendor/aplayer/*.map`
- **不改**：playlist 获取逻辑、播放器行为

## 步骤

1. `site.ts`：Email href 改 `mailto:taterdoge.email@gmail.com`。
2. `music-player-frame.astro`：删除 `metingApi` URL 中的 `&r=...`（`replace(":r", ...)` 整行删除）；`site.ts` 的 `metingApi` 模板同步去掉 `:r` 占位。
3. `meting.ts`：`upstream.searchParams.set("r", ...)` 删除（不向代理传 r；上游缓存策略交给 stale-while-revalidate）。兜底的 `?? String(Math.random())` 同步删除。
4. `git rm public/vendor/aplayer/APlayer.min.css.map public/vendor/aplayer/APlayer.min.js.map`。
5. 运行 `bun run check:content && bun run build`。

## 测试计划

- 播放器无法在本地无网环境全测；冒烟：`bun dev` 打开 `/music-player-frame` 页面，确认 fetch URL 无 `r=` 参数、页面无 404。
- 社交链接：构建产物中 grep `mailto:` 确认。

## 完成标准

- `grep -rn "r=:" src | wc -l` = 0（:r 占位消失）
- `git ls-files public/vendor/aplayer` 无 `.map`
- `bun run build` 通过，页面含 `mailto:taterdoge.email@gmail.com`

## 维护说明

- 若上游 injahow 因缺 r 参数返回陈旧数据，恢复方案：仅把 r 改为「每 6 小时变化一次」的稳定值（`Math.floor(Date.now()/21600000)`），不要回到每次变化。
- APlayer/Meting 整体去留是方向问题（见审计报告），本计划不决策。
