---
title: "138 引入 Tailwind CSS"
pubDate: 2026-05-24
description: "我们的目标很明确：让 apps/web、apps/admin 和 packages/ui 一起用上 Tailwind CSS，并确认共享包里的类名在两个前端子站都能正常生效。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/3-add-tailwindcss/](https://aicompanion.usehook.cn/3-add-tailwindcss/)

## 1. 这一篇要解决什么问题

前一篇把 `web`、`admin`、`api` 跑起来了，这一篇继续补前端样式基础设施。

我们的目标很明确：让 `apps/web`、`apps/admin` 和 `packages/ui` 一起用上 Tailwind CSS，并确认共享包里的类名在两个前端子站都能正常生效。

这里有个关键前提：`@repo/ui` 直接导出源码 TSX，我们选择的方式不是先构建成产物再给应用消费。

这就决定了最合适的接入方式不是在根目录做一套统一编译，而是让每个前端应用各自负责 Tailwind 编译，同时显式扫描共享包源码。

具体的做法如下：

prompt.md

```txt
1. 在当前项目下如何引入 tailwindcss，让多个子站和共享包可以一起使用？给我建议
2. 执行你的建议，并基于 tailwindcss 创建一个组件用于验证是否生效
```

## 2. 先在 workspace 里统一 Tailwind 版本

既然这个仓库已经在 `pnpm-workspace.yaml` 里用 `catalog` 管理公共依赖版本，这一轮也继续沿用同一个做法。

在根目录的 `pnpm-workspace.yaml` 里补两项：

pnpm-workspace.yaml

```yaml
catalog:
  tailwindcss: ^4.1.15
  "@tailwindcss/postcss": ^4.1.15
```

这里放进 `catalog` 之后，后面两个前端子站都可以直接用 `catalog:` 引用版本，我们不用各写一份具体版本号。

然后分别把依赖补进两个应用：

apps/web/package.json

```json
{
  "devDependencies": {
    "tailwindcss": "catalog:",
    "@tailwindcss/postcss": "catalog:"
  }
}
```

apps/admin/package.json

```json
{
  "devDependencies": {
    "tailwindcss": "catalog:",
    "@tailwindcss/postcss": "catalog:"
  }
}
```

这一步只让两个前端应用具备编译 Tailwind 的能力，`packages/ui` 依然保持源码导出，不需要自己单独跑一套 Tailwind 构建。

## 3. 在 web 和 admin 中接入 Tailwind v4

接下来改两个前端应用自己的编译入口。

先各自补一份 PostCSS 配置：

apps/web/postcss.config.mjs

```javascript
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
```

apps/admin/postcss.config.mjs

```javascript
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
```

然后把两个应用的全局样式入口改成 Tailwind v4 的写法：

apps/web/app/globals.css

```css
@import "tailwindcss";
@import "@repo/ui/theme.css";
```

apps/admin/app/globals.css

```css
@import "tailwindcss";
@import "@repo/ui/theme.css";
```

## 4. 共享主题

光把扫描路径接上还不够，还得让共享包里真的有 Tailwind 类名和共享主题变量，这样才能真正生效。

这一步在 `packages/ui` 里补两样东西就够了。

先加共享主题变量：

packages/ui/src/theme.css

```css
@source "./**/*.{ts,tsx}";

@theme {
  --color-brand-50: #f3f7ff;
  --color-brand-100: #dce8ff;
  --color-brand-500: #4f7cff;
  --color-brand-600: #315ee8;
  --color-brand-700: #2749bb;
  --color-surface-strong: rgba(15, 23, 42, 0.78);
  --shadow-card: 0 24px 60px rgba(15, 23, 42, 0.18);
  --radius-card: 1.5rem;
}
```

这里的 `@source "./**/*.{ts,tsx}";` 是关键。

它会以 `theme.css` 自己所在的目录为基准，把 `packages/ui/src` 下面的 TS、TSX 文件显式加入 Tailwind 扫描范围。

这样 `web` 和 `admin` 只需要 `@import "@repo/ui/theme.css";`，就能顺带把 `tailwind-demo.tsx` 这类共享组件里的类名一起扫进去，不用在两个应用里重复写共享包扫描路径。

再加一个最小演示组件：

packages/ui/src/tailwind-demo.tsx

```tsx
type TailwindDemoProps = {
  appName: string
}

const features = [
  'Shared Tailwind utilities',
  'Shared theme tokens',
  'Rendered from @repo/ui',
]

export function TailwindDemo({ appName }: TailwindDemoProps) {
  return (
    <section className="w-full max-w-4xl rounded-card border border-white/10 bg-[linear-gradient(135deg,rgba(79,124,255,0.16),rgba(255,255,255,0.04))] p-6 shadow-card backdrop-blur md:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-4">
          <span className="inline-flex w-fit items-center rounded-full border border-brand-500/20 bg-brand-50 px-3 py-1 text-xs font-semibold tracking-[0.24em] text-brand-700 uppercase">
            shared ui
          </span>
          <div>
            <h2 className="text-3xl font-semibold text-white md:text-4xl">
              Tailwind runs in {appName} and still styles shared TSX.
            </h2>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 shadow-sm shadow-black/10"
            >
              {feature}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
```

最后别忘了把样式文件也导出去：

packages/ui/package.json

```json
{
  "exports": {
    "./theme.css": "./src/theme.css",
    "./*": "./src/*.tsx"
  }
}
```

## 6. 让两个 Next 应用消费共享包

`@repo/ui` 现在既有 TSX，又有 `theme.css`，两个前端应用还需要再补一处配置：开启共享包转译。

apps/web/next.config.js

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@repo/ui'],
}

export default nextConfig
```

apps/admin/next.config.js

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@repo/ui'],
}

export default nextConfig
```

然后在两个站点的首页把演示组件引入进来：

apps/web/app/page.tsx

```tsx
import { TailwindDemo } from '@repo/ui/tailwind-demo'

export default function Home() {
  return <TailwindDemo appName='web' />
}
```

apps/admin/app/page.tsx

```tsx
import { TailwindDemo } from '@repo/ui/tailwind-demo'

export default function Home() {
  return <TailwindDemo appName='admin' />
}
```

这一步的验证意义很直接：`TailwindDemo` 里的类名都写在 `packages/ui/src/tailwind-demo.tsx`，只要两个站点都渲染正确，就说明共享包源码已经被应用自己的 Tailwind 编译流程覆盖到了。

## 7. 验证

建议按这个顺序检查：

index.bash

```shellscript
pnpm install
pnpm --filter @repo/ui check-types
pnpm --filter web check-types
pnpm --filter admin check-types
pnpm lint
pnpm build
```

然后分别启动两个前端：

index.bash

```shellscript
pnpm --filter web dev
pnpm --filter admin dev
```

接着打开：

- `http://localhost:3005`

- `http://localhost:3006`

然后我们就可以验证：

- 两个站点都渲染出了共享演示组件

- `packages/ui` 里的 Tailwind 类名已经生效

- `theme.css` 里的共享主题变量同时作用到了两个站点

- 终端和浏览器控制台里没有 PostCSS、Tailwind、包转译相关报错

如果组件渲染出来了但没有样式，优先排查两处：

- `@source` 路径有没有写对

- 共享组件里有没有大量动态拼接类名，导致 Tailwind 扫描不到

## 8. 总结

我们以 共享 UI 为例，建立了一条后面可以一直复用的规则：

- 共享包继续保持源码导出

- 每个前端应用各自负责 Tailwind 编译

- 共享 UI 的类名通过 `@source` 被显式纳入扫描范围

- 共享设计 token 通过 `theme.css` 被两个站点一起消费

后面继续往 `packages/ui` 里加真正的业务组件，基本就沿着这套接法往前推就够了。
