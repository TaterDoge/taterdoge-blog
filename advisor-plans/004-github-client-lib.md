# 004 抽取共享 GitHub 客户端

## 为何重要

`src/pages/api/admin/publish.ts` 与 `src/pages/api/admin/manage.ts` 各自实现了同一套 GitHub Contents API 逻辑（约 80 行重复）：

- `readGithubSecret` + `githubConfig` + `ensureGithubConfig`（两处几乎逐字相同）
- `getExistingFile` / `getExistingSha`（两个文件各一种变体）
- `commitFile`（两处相同）
- `json()` 响应包装（两处相同）

任何 API 变更（版本头、错误处理、超时）都要改两处；两处行为已出现漂移（`getExistingFile` 404 处理不同）。

## 范围

- **新建**：`src/lib/github.ts`
- **改**：`src/pages/api/admin/publish.ts`、`src/pages/api/admin/manage.ts`
- **不改**：`src/pages/api/music/meting.ts`（无 GitHub 逻辑）、其他模块

## 当前状态

两文件的重复段：`readGithubSecret`（publish.ts:37 / manage.ts:45）、`githubConfig`（publish.ts:42 / manage.ts:49）、`ensureGithubConfig`（publish.ts:57 / manage.ts:76）、`getExistingFile`（publish.ts:99 / manage.ts:109）、`commitFile`（publish.ts:125 / manage.ts:152）、`json`（publish.ts:49 / manage.ts:60）。

## 步骤

1. 新建 `src/lib/github.ts`，导出（签名以 publish.ts 为准，两处差异取更完整的版本）：
   - `readGithubSecret(key)`
   - `githubConfig: { token, owner, repo, branch }`
   - `ensureGithubConfig()`
   - `getGithubFile(filePath): Promise<{ sha, content }>`（publish.ts 版：404 返回 `{ sha: undefined, content: undefined }` 由调用方决定）
   - `getExistingSha(filePath)`
   - `commitGithubFile(filePath, content, message, sha?)`（sha 可选则复用 publish.ts 语义）
   - `json(data, status = 200)`
2. `publish.ts` 删除本地副本，改用 lib 导出。`getExistingSha` 语义保持：404 → undefined。
3. `manage.ts` 删除本地副本，改用 lib 导出。注意 manage.ts 的 `getExistingFile` 404 会抛错（publish.ts 返回 undefined）——统一为 publish.ts 语义后，manage.ts 调用点改为：sha 缺失时抛 `GitHub file payload is invalid`。
4. `writeLocalDataFile`（DEV 本地写入）留在 manage.ts，属于本地开发行为。
5. 运行 `bun run check:content && bun run typecheck && bun test && bun run build`。

## 测试计划

- 无新测试（GitHub API 调用无法离线单测）；行为回归由 typecheck + build 保证。
- 可选手动：DEV 环境（无 GITHUB_TOKEN）调 manage API 走本地写入分支，确认 `{ local: true }` 路径不受影响。

## 完成标准

- `grep -n "getExistingFile\|commitFile\|ensureGithubConfig" src/pages/api/admin/*.ts` 只命中 lib 导入
- `bun run typecheck` 零错误；`bun run build` 通过
- 两个文件的重复段消失

## 维护说明

- 未来加第三个 API（如 content 删除）时直接 import lib。
- `getGithubFile` 的 404 语义以调用点为准：需要区分"文件不存在"与"其他错误"的场景用 `getExistingSha`。
- DEV 本地写入分支是 manage 独有行为，抽取时不要把它带进 lib。
