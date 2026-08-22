# 002 修复 astro check（TypeScript 降级到 6.x）

## 为何重要

`package.json` devDependencies 是 `"typescript": "^7.0.2"`。TypeScript 7.0 的原生编译器不再提供 `@astrojs/language-server` 依赖的 programmatic API，实测：

```
The TypeScript module loaded (found 7.0.2) does not expose the programmatic API that `astro check` relies on.
```

结果：项目唯一类型检查通道完全不可用，`tsconfig.json` 的 `strict` 形同虚设，任何类型错误都会静默进构建。

## 范围

- **改**：`package.json`（typescript 版本、新增 typecheck 脚本）
- **改**：`bun.lock`（bun install 后自动更新）
- **不改**：`tsconfig.json`、任何源码

## 步骤

1. `package.json` devDependencies：`"typescript": "^7.0.2"` → `"typescript": "^6.1.0"`（6.x 保留 programmatic API；Astro 官方跟踪 TS7 支持，恢复后另行升级）。
2. scripts 新增：`"typecheck": "astro check"`。
3. `bun install` 更新 lockfile。
4. 运行 `bun run typecheck`，修复暴露出的存量类型错误（严格模式下组件/API 代码的 `any` 缺口按文件内最小改动处理）。
5. `bun run build` 验证。

## 测试计划

无新测试；验收即 typecheck 零错误。

## 完成标准

- `bun run typecheck` 退出码 0，无 error
- `bun run build` 通过
- `bun install` 无警告

## 维护说明

- 等 Astro 支持 TS7 后（roadmap discussion #1321），可升回 `^7` 并删除本计划的降级理由。
- 若 `astro check` 后续报告大量与视图无关的库类型噪声，可在 `astro check` 命令后追加 `--minimumSeverity error`（当前不启用，保持默认）。
