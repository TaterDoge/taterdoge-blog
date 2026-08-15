---
title: "139 引入 shadcn/ui"
pubDate: 2026-05-25
description: "shadcn/ui 不是一个装完就直接用的完整组件库，它更像一套「可复制、可改造、可放进自己代码库」的组件源码方案。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/4-add-shadcn-ui/](https://aicompanion.usehook.cn/4-add-shadcn-ui/)

## 1. 概述

`shadcn/ui` 不是一个装完就直接用的完整组件库，它更像一套「可复制、可改造、可放进自己代码库」的组件源码方案。

它的价值不在于帮你藏住实现细节，而在于把实现权交还给你：样式是 Tailwind，交互底座是 Radix，组件源码本身就在项目里，后面要改结构、改 class、改交互都可以直接改。

放到这个 monorepo 里，它特别合适。

因为我们已经有了 `Tailwind v4 + @repo/ui` 这条共享组件链路，这时候再引入 `shadcn/ui`，目标就不该是让 `web` 和 `admin` 各自再生成一份按钮和表单组件，而是把首批基础组件直接沉淀到 `packages/ui`，让两个子站一起复用。

这样做有三个好处：

- 组件 API 统一，两个子站不会各写各的

- 共享包继续掌握源码，后面要改样式和交互不用绕远路

- 可以基于共享包的 tailwindcss 顺手验证 `cva`、`cn`、Radix 基础依赖

因此，我们先按下面这个目标推进：

prompt.md

```txt
在现有 Tailwind v4 + @repo/ui 共享包方案之上，引入第一批 shadcn/ui 基础组件，并在 apps/web 与 apps/admin 中实际使用这些组件完成验证。

本次首批组件：
- Button
- Card
- Input
- Label
- Separator
```

## 2. 接入边界

这里继续把 `packages/ui` 当成唯一组件来源，不在 `apps/web` 和 `apps/admin` 各自生成一套 shadcn 组件，确保两个子站使用的是同一个组件库。

也就是说，应用侧继续保持这种导入方式：

index.tsx

```tsx
import { Button } from '@repo/ui/button'
import { Card } from '@repo/ui/card'
```

这条规则有两个直接作用。

一是避免组件源码散落到多个子站，后面改一个按钮要追三份代码。二是保持共享包出口稳定，先用最小改动把首批组件接起来，暂时不额外引入更深的目录分层和导出规则。

继续沿用 `packages/ui/src/theme.css` 里已有的 token、`@theme` 和 Tailwind 扫描方式，先把基础组件接入、API 统一和跨应用验证做完。

## 3. 补充 workspace 依赖

shadcn 风格组件真正依赖的不多，核心依赖就是三类东西：

- `class-variance-authority` 负责变体管理

- `clsx` + `tailwind-merge` 负责类名合并

- Radix 的轻量 primitives 提供 `Slot`、`Label`、`Separator` 这些底座

因为这个仓库已经在根目录用 `catalog` 管理共享版本，所以这里继续保持一致，把公共依赖收进 `pnpm-workspace.yaml`：

pnpm-workspace.yaml

```yaml
catalog:
  class-variance-authority: ^0.7.1
  clsx: ^2.1.1
  tailwind-merge: ^3.3.1
  "@radix-ui/react-slot": ^1.2.3
  "@radix-ui/react-label": ^2.1.7
  "@radix-ui/react-separator": ^1.1.7
```

然后在 `packages/ui/package.json` 里把这些依赖放进 `dependencies`：

packages/ui/package.json

```json
{
  "dependencies": {
    "@radix-ui/react-label": "catalog:",
    "@radix-ui/react-separator": "catalog:",
    "@radix-ui/react-slot": "catalog:",
    "class-variance-authority": "catalog:",
    "clsx": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "tailwind-merge": "catalog:"
  }
}
```

## 4. 在共享包里补 cn 工具

shadcn 风格组件几乎都会复用一个 `cn` 工具，所以先在共享包里把它补上。

文件位置放在 `packages/ui/src/lib/utils.ts`：

packages/ui/src/lib/utils.ts

```typescript
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

这里有两个细节。

**第一，组件内部统一走相对路径导入。**

这一步先不对外暴露 `@repo/ui/lib/*`，避免还没稳定就把内部工具路径变成公共 API。

**第二，`clsx` 和 `tailwind-merge` 要一起用。**

单独用 `clsx` 只能解决条件拼接，处理不了 Tailwind 冲突类合并；加上 `twMerge` 之后，像 `px-4 px-6`、`rounded-xl rounded-2xl` 这类冲突才能按预期收敛。

## 5. 先升级 Button 和 Card

优先复用共享包里已有文件，直接原位升级。

### 5.1 Button

`packages/ui/src/button.tsx` 之前只是一个非常简单的演示按钮，这一轮把它改成 shadcn 风格的 Button。

核心点有三个：

- 用 `cva` 定义 `variant` 和 `size`

- 用 `Slot` 支持 `asChild`

- 保持导出路径不变，应用侧导入方式不用改

packages/ui/src/button.tsx

```tsx
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
  {
    variants: {
      variant: {
        default: 'bg-brand-500 text-white hover:bg-brand-600',
        secondary: 'bg-white/10 text-white hover:bg-white/15',
        outline: 'border border-white/15 bg-transparent text-slate-100 hover:bg-white/10',
        ghost: 'text-slate-100 hover:bg-white/10',
      },
      size: {
        default: 'h-11 px-5',
        sm: 'h-9 px-4 text-xs',
        lg: 'h-12 px-6 text-base',
        icon: 'size-10 rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'

  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { Button, buttonVariants }
```

这里的 `asChild` 很关键。

后面如果要让按钮直接包住 `a`、`Link` 或别的组件，就不用额外再写一层 `LinkButton`。在共享组件里先把这个能力补齐，后面会很省事。

### 5.2 Card

`Card` 也不再保留原来那种单文件、单组件、强绑定 `title` 和 `href` 的结构，而是改成一组更标准的组合式子组件：

- `Card`

- `CardHeader`

- `CardTitle`

- `CardDescription`

- `CardContent`

- `CardFooter`

packages/ui/src/card.tsx

```tsx
import * as React from 'react'
import { cn } from './lib/utils'

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-[2rem] border border-white/10 bg-slate-950/45 text-slate-50 shadow-card backdrop-blur',
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-xl font-semibold tracking-tight', className)} {...props} />
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-sm leading-6 text-slate-300', className)} {...props} />
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-6 pb-6', className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center px-6 pb-6', className)} {...props} />
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }
```

这种结构更适合共享包。

因为它不再替你预设内容结构，应用侧可以自由拼装：表单卡片、信息卡片、操作卡片都能沿用同一套基础组件。

## 6. 再补 Input、Label、Separator

首批组件里剩下三个都比较直接，但验证意义很强。

- `Input` 验证表单类组件的共享样式

- `Label` 验证 Radix primitive 与语义绑定

- `Separator` 验证基础结构组件和横向视觉分隔

packages/ui/src/input.tsx

```tsx
import * as React from 'react'
import { cn } from './lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-11 w-full rounded-2xl border border-white/12 bg-white/5 px-4 py-2 text-sm text-slate-50 outline-none transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-brand-500/60 focus-visible:ring-2 focus-visible:ring-brand-500/40',
        className
      )}
      {...props}
    />
  )
}

export { Input }
```

packages/ui/src/label.tsx

```tsx
import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from './lib/utils'

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn('text-sm font-medium leading-none text-slate-200', className)}
      {...props}
    />
  )
}

export { Label }
```

packages/ui/src/separator.tsx

```tsx
import * as React from 'react'
import * as SeparatorPrimitive from '@radix-ui/react-separator'
import { cn } from './lib/utils'

function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-white/10',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className
      )}
      {...props}
    />
  )
}

export { Separator }
```

这里最值得关注的是 `Label` 的验证价值。

只要页面里 `htmlFor` 和 `id` 对得上，点 `Label` 能聚焦对应的 `Input`，就说明共享组件除了样式正常，基础语义和交互关系也没丢。

## 7. 复用共享演示入口做第一轮验证

为了验证两个子站是否能够正确消费这批新组件，最省事的方式就是直接修改现有的 `packages/ui/src/tailwind-demo.tsx`

因为 `web` 和 `admin` 已经在首页接了这个演示组件，所以一旦这里改成新组件，两个子站就会自动开始帮我们验证共享包编译、Tailwind 扫描和导入导出是否都正常。

packages/ui/src/tailwind-demo.tsx

```tsx
import { Button } from './button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card'
import { Input } from './input'
import { Label } from './label'
import { Separator } from './separator'

type TailwindDemoProps = {
  appName: string
}

const features = [
  'Shared Tailwind utilities',
  'Shadcn-style primitives',
  'Rendered from @repo/ui',
]

export function TailwindDemo({ appName }: TailwindDemoProps) {
  return (
    <Card className="w-full max-w-5xl overflow-hidden bg-[linear-gradient(135deg,rgba(79,124,255,0.18),rgba(15,23,42,0.92))]">
      <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <span className="inline-flex w-fit items-center rounded-full border border-brand-500/20 bg-brand-50 px-3 py-1 text-xs font-semibold tracking-[0.24em] text-brand-700 uppercase">
            shared ui package
          </span>
          <div className="space-y-2">
            <CardTitle className="text-2xl text-white md:text-3xl">
              Tailwind and shadcn primitives are active in {appName}
            </CardTitle>
            <CardDescription className="max-w-2xl text-slate-200">
              This section is rendered from <code className="rounded bg-white/10 px-2 py-1 text-slate-100">packages/ui</code> and now uses reusable Button, Card, Input, Label, and Separator components.
            </CardDescription>
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
      </CardHeader>

      <CardContent className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-4 rounded-[1.5rem] border border-white/10 bg-slate-950/35 p-5">
          <div className="space-y-2">
            <Label htmlFor={`${appName}-workspace`}>Workspace label</Label>
            <Input id={`${appName}-workspace`} defaultValue={`${appName}.workspace.local`} />
          </div>
          <Separator />
          <div className="flex flex-wrap gap-3">
            <Button>Primary action</Button>
            <Button variant="secondary">Secondary action</Button>
            <Button variant="outline">Outline action</Button>
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5 text-sm leading-6 text-slate-200">
          <p>
            The same primitives can now be imported from the shared package and reused in both sub-apps without adding separate component copies.
          </p>
        </div>
      </CardContent>

      <CardFooter className="flex-wrap gap-3 border-t border-white/10 pt-6">
        <Button asChild variant="ghost">
          <a href="https://ui.shadcn.com/docs/components/button" target="_blank" rel="noopener noreferrer">
            View shadcn button reference
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href="https://ui.shadcn.com/docs/components/card" target="_blank" rel="noopener noreferrer">
            View card reference
          </a>
        </Button>
      </CardFooter>
    </Card>
  )
}
```

这一步能顺带验证三件事：

- 新增组件文件确实被 `packages/ui/src/theme.css` 扫描到了

- `@repo/ui/*` 顶层子路径导入方式仍然成立

- 共享包里的组件样式和结构在两个子站都能正确落地

## 8. 两个子站都要写一段更贴近业务的用法

只有共享演示块还不够。

因为它本质上还是一个通用展示区，没法完全说明组件进入真实页面结构后是否依旧正常。

所以这里分别在 `apps/web/app/page.tsx` 和 `apps/admin/app/page.tsx` 再加一段更贴近业务的基础用法。

### 8.1 web

`web` 首页可以放一个简洁表单区块，重点验证 `Label + Input + Button + Card + Separator` 这一套组合：

apps/web/app/page.tsx

```tsx
import { Button } from '@repo/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/card'
import { Input } from '@repo/ui/input'
import { Label } from '@repo/ui/label'
import { Separator } from '@repo/ui/separator'
import { TailwindDemo } from '@repo/ui/tailwind-demo'

export default function Home() {
  return (
    <>
      <TailwindDemo appName="web" />

      <Card>
        <CardHeader>
          <CardTitle>Primitive validation in web</CardTitle>
          <CardDescription>
            This section imports shared Button, Input, Label, Card, and Separator components directly from <code className="rounded bg-white/10 px-2 py-1 text-slate-100">@repo/ui</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-2">
            <Label htmlFor="project-name">Project name</Label>
            <Input id="project-name" placeholder="AI Agent workspace" />
          </div>
          <Separator />
          <div className="flex flex-wrap gap-3">
            <Button>Save draft</Button>
            <Button variant="secondary">Preview</Button>
            <Button variant="outline">Open docs</Button>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
```

这段的价值在于它更接近真实业务页面：有表单项、有分隔、有操作按钮，而且所有组件都直接从共享包导入。

### 8.2 admin

`admin` 首页则更适合做一个操作区，重点验证不同按钮尺寸和变体：

apps/admin/app/page.tsx

```tsx
import { Button } from '@repo/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/card'
import { Input } from '@repo/ui/input'
import { Label } from '@repo/ui/label'
import { Separator } from '@repo/ui/separator'
import { TailwindDemo } from '@repo/ui/tailwind-demo'

export default function Home() {
  return (
    <>
      <TailwindDemo appName="admin" />

      <Card>
        <CardHeader>
          <CardTitle>Admin primitive validation</CardTitle>
          <CardDescription>
            This block checks the same shared primitives in a second app with a slightly different layout and button sizing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-2 md:max-w-md">
            <Label htmlFor="tenant-id">Tenant identifier</Label>
            <Input id="tenant-id" placeholder="team-enterprise-01" />
          </div>
          <Separator />
          <div className="flex flex-wrap gap-3">
            <Button size="sm">Queue sync</Button>
            <Button variant="secondary">Inspect</Button>
            <Button size="lg" variant="outline">Publish changes</Button>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
```

两个页面分开这样验证之后，能更明确地确认一件事：共享包里的基础组件不是只在一个演示块里可用，而是真的能跨应用消费。

## 9. 总结

这次不急着上 `Dialog`、`Popover`、`DropdownMenu` 这类更重的交互组件，原因很现实。

因为一旦开始做这类组件，主题变量、客户端边界、Portal、焦点管理、可访问性细节都会一起进来，文章复杂度会立刻上升。

当前阶段先把下面这些基础能力跑通，更值：

- 按钮变体和尺寸

- 表单输入与标签绑定

- 结构容器和分隔线

- `cva`、`cn`、Radix primitives 的接入链路

- 共享包被多个应用消费时的编译与样式稳定性

这批组件已经足够覆盖「共享包接入 shadcn 风格组件」最核心的路径。

处理完之后，我们可以按照下面的命令进行验证：

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

浏览器里打开：

- `http://localhost:3005`

- `http://localhost:3006`

检查：

- 两个子站都能看到新的共享演示区和页面内业务区块

- `Button` 的不同 `variant` 和 `size` 样式确实有差异

- 点击 `Label` 可以聚焦对应 `Input`

- `Separator` 可见，`Card` 结构正常

- 控制台没有 hydration、module resolution、Tailwind class 丢失这类报错

如果出问题，优先排查下面几项。

**共享组件样式缺失**

先看新增组件文件是不是都位于 `packages/ui/src` 下面，因为 `theme.css` 的 `@source "./**/*.{ts,tsx}";` 只会扫描这个范围。

**Button 的 `asChild` 类型或导入报错**

优先看 `@radix-ui/react-slot` 有没有装上，以及 `Button` 的 props 类型是不是包含 `asChild?: boolean`。

**应用侧导入失败**

先核对顶层文件名和共享包导出规则是不是对应得上，重点看 `@repo/ui/button`、`@repo/ui/card` 这类现有子路径有没有被破坏。
