---
title: "现代化开发规范：用 kebab-case 统一文件、目录与组件命名"
description: "把 kebab-case 当成默认命名约定，统一文件、目录、组件与路由，减少协作摩擦和跨平台踩坑。"
pubDate: 2026-07-20
tags: ["工程化", "命名规范", "kebab-case", "协作"]
category: "工程化"
draft: false
visibility: "public"
cover: "./cover.png"
---

命名是团队协作里最便宜、也最容易失控的约定。一个项目里如果同时出现 `UserProfile.tsx`、`user_profile.tsx`、`userProfile.tsx` 和 `user-profile.tsx`，问题通常不是“哪种更好看”，而是：新人不知道该跟哪套；工具链在大小写敏感系统上表现不一致；代码审查要反复争论风格而不是逻辑。

现代化开发规范的目标不是追求某种美学，而是让默认路径足够无聊、足够可预测。对前端、全栈和多数 monorepo 场景，**文件与目录优先使用 kebab-case**，是目前最稳的默认选项之一。

## 1. 先统一对象：命名规范不是一刀切

“全部 kebab-case”听起来干脆，但真正落地时要先分清对象：

| 对象 | 推荐风格 | 原因 |
| --- | --- | --- |
| 文件名 | `kebab-case` | 跨平台稳定，URL 友好，工具链兼容好 |
| 目录名 | `kebab-case` | 和文件规则一致，路径可预测 |
| 路由 / slug | `kebab-case` | 与 URL 习惯一致 |
| CSS class / BEM block | `kebab-case` | 与 HTML/CSS 生态一致 |
| React/Vue 组件名（代码标识符） | `PascalCase` | 语言与 JSX 约定 |
| 变量 / 函数 | `camelCase` | 语言惯例 |
| 常量 | `SCREAMING_SNAKE_CASE` | 一眼可辨 |
| 包名 / npm 包 | `kebab-case` | 生态默认 |

关键点只有一句：**文件系统路径用 kebab-case；语言标识符跟随语言惯例。**

很多人把“组件也用 kebab-case”理解成把 `UserCard` 改成 `user-card` 当变量名——这在 JS/TS 里既别扭，也不符合生态。正确做法是：

```text
src/components/user-card/user-card.tsx   # 文件与目录：kebab-case
export function UserCard() {}            # 标识符：PascalCase
```

## 2. 为什么是 kebab-case，而不是 snake_case 或 camelCase

### 跨平台更稳

macOS 默认大小写不敏感，Linux CI 通常大小写敏感。`UserList.tsx` 和 `userlist.tsx` 在本地“能跑”，一进 CI 就炸，是经典事故。kebab-case 全小写，天然绕开这类问题。

### URL 与路径天然同构

现代前端路由、文档站点、静态资源路径，几乎都以短横线分隔：

```text
/docs/getting-started
/blog/modern-naming-conventions
/assets/hero-banner.webp
```

文件名如果已经是 `getting-started.md`，从磁盘到 URL 几乎不用再做转换。camelCase 或 PascalCase 则要额外映射，映射层一多，bug 就多。

### 工具链默认友好

Git、npm、Docker、多数静态托管和 CDN 对小写路径更友好。npm 包名本身就推荐 kebab-case。把仓库内部路径也对齐，能减少“仓库里一套、发布出去另一套”的心智负担。

### 可读性不输其他风格

对比：

```text
userprofilepage.tsx      # 难读
user_profile_page.tsx   # 可读，但 URL 与前端生态不统一
userProfilePage.tsx     # 大小写风险
user-profile-page.tsx    # 可读，且路径/URL 友好
```

短横线在英文单词边界上足够清晰，又不引入大小写状态。

## 3. 落地规则：给团队一张最小清单

规范要能贴在 README 里，而不是写成 20 页手册。下面这张表通常够用：

### 文件与目录

```text
✅ user-profile.tsx
✅ auth-guard.ts
✅ api-client/
✅ get-user-by-id.ts

❌ UserProfile.tsx        # 文件名不要 PascalCase
❌ user_profile.tsx       # 不要 snake_case（除非语言/生态强制）
❌ userProfile.tsx        # 不要 camelCase 文件名
❌ user profile.tsx       # 不要空格
❌ user.profile.tsx       # 不要用点做词分隔（扩展名除外）
```

### 组件文件怎么放

两种都常见，选一种写死即可：

```text
# 方案 A：单文件
src/components/user-card.tsx

# 方案 B：目录 + 入口（组件有样式/测试/子模块时更合适）
src/components/user-card/
  index.ts
  user-card.tsx
  user-card.test.tsx
  user-card.module.css
```

导入时尽量稳定：

```ts
import { UserCard } from "@/components/user-card";
```

### 页面与路由

```text
src/pages/user-settings/index.tsx   → /user-settings
src/app/blog/[slug]/page.tsx       → /blog/:slug
content/posts/modern-naming.md      → /posts/modern-naming
```

页面目录名直接等于路由段，是最省事的约定。

### 测试、类型、样式配套命名

```text
user-card.tsx
user-card.test.tsx
user-card.stories.tsx
user-card.module.css
user-card.types.ts
```

后缀表达角色，主体仍保持 kebab-case。不要搞成 `UserCardTest.tsx` 或 `userCard.spec.ts` 混搭。

## 4. 和“组件名 PascalCase”怎么共存

这是最容易吵起来的点，提前写清楚：

```tsx
// file: src/components/order-summary/order-summary.tsx
export function OrderSummary() {
  return <section className="order-summary">...</section>;
}
```

| 层 | 名字 | 风格 |
| --- | --- | --- |
| 路径 | `order-summary/order-summary.tsx` | kebab-case |
| 导出组件 | `OrderSummary` | PascalCase |
| DOM/CSS class | `order-summary` | kebab-case |
| 实例变量 | `orderSummary` | camelCase |

同一概念在不同层用不同风格，不是混乱，而是**尊重各层既有惯例**。混乱来自同层混用，不来自跨层映射。

## 5. 后端、脚本与 monorepo 的边界

kebab-case 不是银弹，遇到语言生态默认时，以生态为准：

| 场景 | 建议 |
| --- | --- |
| Node/TS 前端、文档、配置目录 | kebab-case |
| Python 模块 | snake_case（语言强制） |
| Go 包目录 | 小写单词，通常无下划线/短横线；跨包边界仍避免大写 |
| Java/Kotlin 源文件 | 与 public class 同名，PascalCase |
| Shell 脚本 | kebab-case：`build-images.sh` |
| CI workflow 文件 | kebab-case：`deploy-preview.yml` |
| monorepo package 名 | `@scope/user-service` |

一句话：**语言标准库/编译器有硬约束时服从语言；文件系统与交付路径没有硬约束时，默认 kebab-case。**

## 6. 用自动化把规范变成“不用记”

规范如果只靠 code review 口头提醒，两周后就会退化。最小自动化就够：

### ESLint / 目录约定

前端可用文件夹/文件名 lint（按栈选型），卡死：

- `src/**` 下文件名必须匹配 `^[a-z0-9]+(-[a-z0-9]+)*(\..+)?$`
- 禁止 `PascalCase` / `camelCase` 文件名（组件文件也不例外）

### 脚手架生成，而不是手敲

```bash
# 示例：生成组件时直接产出规范路径
pnpm gen:component user-card
# → src/components/user-card/user-card.tsx
# → export function UserCard()
```

人只提供业务名，工具负责风格转换。

### Code Review 只看例外

默认路径不讨论。只有这些情况才允许例外，并在 PR 里写一句理由：

1. 框架强制约定（如某些 Java 类名=文件名）
2. 对接外部系统的固定路径
3. 历史目录暂未迁移（标注 `// TODO: rename to kebab-case`）

## 7. 存量项目怎么迁，别一口吃成胖子

全仓重命名最容易换来一场无意义的 git blame 灾难。更稳的顺序：

1. **先定规范文档**（半页纸即可）
2. **新文件强制执行**，旧文件不主动改
3. **改动文件时顺手改名**（boy scout rule）
4. **热点目录集中迁移**（`components/`、`pages/` 优先）
5. **最后处理冷门目录**

迁移时注意：

- Git 用 `git mv`，保留历史
- 同步改 import、路由、文档链接、快照测试
- 一次 PR 只迁一个边界清晰的目录，避免“顺手重构”

## 8. 一张可直接贴进仓库的约定

```text
Naming Conventions
==================

Paths (files & dirs):     kebab-case
Routes / URL slugs:       kebab-case
CSS classes:              kebab-case
React/Vue components:     PascalCase (identifiers only)
functions / variables:    camelCase
constants:                SCREAMING_SNAKE_CASE
packages:                 kebab-case

Examples
--------
src/features/user-profile/user-profile-form.tsx
export function UserProfileForm() {}

src/pages/getting-started/index.mdx  →  /getting-started
scripts/build-release.sh
.github/workflows/deploy-preview.yml
```

## 结语

现代化开发规范的价值，不在于“看起来专业”，而在于把无意义选择从日常里删掉。kebab-case 成为文件与目录默认风格之后，团队会少争论很多命名，多关注业务与结构。

如果你的仓库还在 `UserCard.tsx`、`user_card.tsx`、`userCard.tsx` 之间摇摆，不必追求一次完美重构。先写下默认规则，再让脚手架和 lint 替你执行。规范一旦变成默认路径，它就不再需要靠意志力维持。
