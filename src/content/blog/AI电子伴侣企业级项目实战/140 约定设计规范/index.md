---
title: "140 约定设计规范"
pubDate: 2026-05-25
description: "同一个按钮在不同页面里出现不同圆角、不同描边、不同悬停色，是常见问题。问题的根源通常不在组件数量，而在样式决策散落在页面里：颜色靠临场判断，间距靠肉眼调整，状态样式靠复制粘贴。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/5-design-system/](https://aicompanion.usehook.cn/5-design-system/)

## 1. 概述

设计统一的界面规则，是构建可维护、可扩展的 UI 体系的关键。

同一个按钮在不同页面里出现不同圆角、不同描边、不同悬停色，是常见问题。问题的根源通常不在组件数量，而在样式决策散落在页面里：颜色靠临场判断，间距靠肉眼调整，状态样式靠复制粘贴。

这一篇文章要为大家分享的是，把高频视觉决策整理成可执行的设计规范，并写进 `packages/ui`。后面新增页面或组件时，优先复用这套规则，**不再在业务代码里临时定样式**。

设计规范在工程里主要承担四件事：

- 定义界面的层级关系

- 统一交互状态的表达方式

- 约束组件的尺寸与密度

- 把样式决策下沉到 token 和共享组件

## 2. 设计规范的边界

我们只处理产品界面里复用频率最高、最容易失控的部分，不处理品牌延展、插画风格、营销页排版这些更偏视觉设计的话题。

当前范围限定在五类规则：

- 色彩

- 字体

- 间距

- 圆角

- 阴影与状态反馈

落到代码里，这五类规则会分成三层：

- **基础令牌**：色阶、字号、间距、圆角、阴影这些原始值

- **语义令牌**：`surface`、`content`、`border`、`brand`、`state` 这些可直接消费的语义值

- **组件约束**：Button、Card、Input、Badge 具体该怎么使用这些令牌

这三层职责清楚，后面改动时也不会互相牵连。调品牌色，主要影响 `brand`；调输入框聚焦样式，主要影响组件层；调页面层级，主要影响 `surface` 和 `border`。

## 3. 基础令牌建立界面规则

### 3.1 色彩体系

深色产品界面最容易出的问题有两个：层级不清，状态色滥用

所以色彩体系先按职责分组：

- **Brand**：关键操作、选中态、聚焦态

- **Surface**：页面、卡片、浮层这些承载面

- **Content**：标题、正文、辅助信息、禁用信息

- **Border**：分隔、描边、聚焦描边、异常描边

- **State**：成功、警告、错误、信息反馈

这里有三条约束先定下来：

- 品牌色只服务于关键动作和关键状态，不拿来铺大面积背景

- 状态色只表达反馈和风险，不承担普通强调职责

- 深色层级主要靠亮度差和描边，少依赖高透明度白色叠加

### 3.2 字体体系

字体规范处理两个问题：阅读节奏和信息主次

常用界面里不需要很复杂的字号系统，保证标题、正文、辅助文字、标签文字四层关系清楚就够了。真正需要定死的是字号、字重、行高的组合关系，避免不同页面各写各的。

这一类后台或工具型界面，建议遵守下面的规则：

- 页面标题和区块标题分层明确

- 正文行高稳定，保证长文案可读性

- 标签、占位符、辅助说明的灰度和字号低于正文

- 数据密集区域优先控制一致性，少做局部放大

### 3.3 间距体系

间距的作用是建立节奏，不是把元素硬隔开。

建议统一使用 4px 基线，然后把常用步进固定下来。组件内部通常围绕 8、12、16、20、24 这些值展开，页面区块之间再使用更大的步进。这样做之后，按钮、输入框、卡片这些组件在不同页面里会自然保持同一密度。

### 3.4 圆角体系

圆角决定的是界面的亲和度和组件识别感，不是越大越高级。

这类产品界面更适合控制在三档：

- 小圆角：输入框、标签、小尺寸按钮

- 中圆角：默认按钮、卡片、下拉面板

- 大圆角：弹层、重点内容容器

一定要注意，圆角层级过多，会让组件之间失去协调感

### 3.5 阴影与边界

深色界面里，阴影承担的是层级提示，边框承担的是轮廓识别。

卡片和浮层如果只有阴影，没有描边，在低亮度背景下很容易糊成一片。所以更稳妥的做法是：

- 常规容器用弱描边 + 轻阴影

- 浮层用更强的描边和更大的阴影

- 关键聚焦元素单独给品牌色光晕

### 3.6 交互状态

状态规范至少要覆盖 `default`、`hover`、`active`、`focus-visible`、`disabled`。

其中最容易被忽略的是 `focus-visible`。键盘导航时，聚焦环必须清楚可见，颜色和粗细也要统一。这个状态不该由页面临时写，应该收进基础组件。

## 4. 把规则写进 theme.css

前面定的是规则，接下来要把规则变成代码里的可复用令牌。

这里继续使用 `Tailwind v4 + @theme`，把设计令牌集中写进 `packages/ui/src/theme.css`：

packages/ui/src/theme.css

```css
@source "./**/*.{ts,tsx}";

@theme {
  /* Brand */
  --color-brand-50: #f3f7ff;
  --color-brand-100: #dce8ff;
  --color-brand-200: #b8d0ff;
  --color-brand-300: #8eb8ff;
  --color-brand-400: #6d9fff;
  --color-brand-500: #4f7cff;
  --color-brand-600: #315ee8;
  --color-brand-700: #2749bb;
  --color-brand-800: #1a317a;
  --color-brand-900: #111f4a;

  /* Surface */
  --color-surface-canvas: #0a0f1e;
  --color-surface-panel: #111827;
  --color-surface-elevated: #172033;
  --color-surface-overlay: rgba(10, 15, 30, 0.88);

  /* Content */
  --color-content-primary: #f8fafc;
  --color-content-secondary: #cbd5e1;
  --color-content-tertiary: #94a3b8;
  --color-content-disabled: #64748b;
  --color-content-inverse: #0f172a;

  /* Border */
  --color-border-default: rgba(255, 255, 255, 0.08);
  --color-border-strong: rgba(255, 255, 255, 0.14);
  --color-border-focus: rgba(79, 124, 255, 0.48);
  --color-border-error: rgba(239, 68, 68, 0.45);

  /* Feedback */
  --color-state-success: #22c55e;
  --color-state-success-subtle: rgba(34, 197, 94, 0.14);
  --color-state-warning: #f59e0b;
  --color-state-warning-subtle: rgba(245, 158, 11, 0.14);
  --color-state-error: #ef4444;
  --color-state-error-subtle: rgba(239, 68, 68, 0.14);
  --color-state-info: #38bdf8;
  --color-state-info-subtle: rgba(56, 189, 248, 0.14);

  /* Radius */
  --radius-sm: 0.5rem;
  --radius-md: 0.75rem;
  --radius-lg: 1rem;
  --radius-xl: 1.5rem;

  /* Shadow */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.24);
  --shadow-sm: 0 6px 16px rgba(0, 0, 0, 0.24);
  --shadow-md: 0 12px 32px rgba(0, 0, 0, 0.32);
  --shadow-lg: 0 24px 60px rgba(0, 0, 0, 0.42);
  --shadow-glow: 0 0 24px rgba(79, 124, 255, 0.18);

  /* Typography */
  --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;
}
```

这份令牌有几个关键点：

- `surface` 单独分了 `canvas`、`panel`、`elevated`、`overlay` 四层，页面层级会更稳定

- `content` 单独区分 `primary`、`secondary`、`tertiary`，文字颜色不会到处手写灰度

- `border` 和 `state` 分开，普通描边和异常反馈各走各的通道

- 阴影没有做彩色扩散，品牌光感单独放在 `shadow-glow`

到这里，设计规范才真正进入工程体系。后面组件里写的类名，不再是临时选颜色，而是在消费明确的语义令牌。

## 5. 让基础组件消费这些令牌

设计规范只有写进组件，约束力才够强。页面代码直接写样式的空间越小，规范越不容易失守。

### 5.1 Button

按钮最容易暴露规范是否统一，因为它同时涉及颜色、圆角、尺寸、交互状态和风险语义。

packages/ui/src/button.tsx

```tsx
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas',
  {
    variants: {
      variant: {
        default: 'bg-brand-500 text-content-primary shadow-xs hover:bg-brand-600',
        secondary:
          'border border-border-default bg-surface-panel text-content-primary hover:border-border-strong hover:bg-surface-elevated',
        outline:
          'border border-border-default bg-transparent text-content-secondary hover:bg-surface-panel hover:text-content-primary',
        ghost: 'text-content-secondary hover:bg-surface-panel hover:text-content-primary',
        danger: 'bg-state-error text-content-primary shadow-xs hover:bg-red-600',
      },
      size: {
        default: 'h-11 px-5',
        sm: 'h-9 rounded-lg px-4 text-xs',
        lg: 'h-12 px-6 text-base',
        icon: 'size-10 px-0',
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

这版按钮主要落实了四个约束：

- 品牌色只用于默认主操作

- `danger` 单独占一个语义通道，不和品牌色混用

- 所有尺寸共享同一套状态规则

- 键盘聚焦样式集中在基础组件，不交给页面零散处理

### 5.2 Card

卡片组件更适合用来验证层级和边界规则。

packages/ui/src/card.tsx

```tsx
import * as React from 'react'
import { cn } from './lib/utils'

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border-default bg-surface-panel text-content-primary shadow-sm backdrop-blur-xs',
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('grid gap-1.5 p-6', className)} {...props} />
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-lg font-semibold tracking-tight', className)} {...props} />
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-sm leading-6 text-content-secondary', className)} {...props} />
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-6 pb-6', className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-3 px-6 pb-6', className)} {...props} />
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }
```

这里的重点是把层级理清楚：背景来自 `surface`，轮廓来自 `border`，浮起感来自弱阴影，内容对比来自 `content`。

### 5.3 Input

输入框要解决的是可读性、聚焦感和异常反馈。

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
        'flex h-11 w-full rounded-xl border border-border-default bg-surface-canvas px-4 text-sm text-content-primary outline-hidden transition-colors placeholder:text-content-tertiary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-brand-500/25 aria-invalid:border-border-error aria-invalid:ring-2 aria-invalid:ring-state-error/20',
        className
      )}
      {...props}
    />
  )
}

export { Input }
```

这里有两个约束值得固定下来：

- 默认背景使用 `surface-canvas`，让输入区和卡片区天然拉开层级

- 无效态使用 `aria-invalid`，表单语义和视觉反馈保持同一路径

### 5.4 Label

`Label` 很简单，但它决定了表单信息的主次关系。

packages/ui/src/label.tsx

```tsx
import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from './lib/utils'

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        'text-sm font-medium leading-none text-content-secondary peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className
      )}
      {...props}
    />
  )
}

export { Label }
```

Label 的颜色低于正文，高于占位符，这样字段名不会和用户输入抢层级。

### 5.5 Badge

标签组件最适合承载轻量状态和分类信息。

packages/ui/src/badge.tsx

```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-brand-500/14 text-brand-300',
        secondary: 'border-transparent bg-surface-elevated text-content-secondary',
        outline: 'border-border-default text-content-secondary',
        success: 'border-transparent bg-state-success-subtle text-state-success',
        warning: 'border-transparent bg-state-warning-subtle text-state-warning',
        error: 'border-transparent bg-state-error-subtle text-state-error',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

type BadgeProps = React.ComponentProps<'div'> & VariantProps<typeof badgeVariants>

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
```

Badge 的规则很直接：轻量背景、清楚前景、尺寸紧凑。状态标签要能被快速扫到，但不能抢走主操作按钮的注意力。

## 6. 用页面验收这套规范

设计规范定完之后，必须放进真实页面看层级和密度。只在组件单测页里看，很难发现组合后的问题。

### 6.1 建一个设计系统演示页

演示页的目的不是炫组件，而是集中检查基础令牌和组件约束有没有冲突。

apps/web/app/design-system/page.tsx

```tsx
import { Badge } from '@repo/ui/badge'
import { Button } from '@repo/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card'
import { Input } from '@repo/ui/input'
import { Label } from '@repo/ui/label'
import { Separator } from '@repo/ui/separator'

export default function DesignSystemPage() {
  return (
    <main className="mx-auto flex max-w-250 flex-col gap-8 p-8">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold text-content-primary">Design System</h1>
        <p className="text-content-secondary">
          用于校验颜色、层级、表单状态和按钮变体的一组基础页面。
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>色彩与状态</CardTitle>
          <CardDescription>检查品牌色、状态色和文字层级是否清楚。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-3">
            <Label>Brand</Label>
            <div className="flex gap-3">
              <div className="size-12 rounded-xl bg-brand-400" />
              <div className="size-12 rounded-xl bg-brand-500" />
              <div className="size-12 rounded-xl bg-brand-600" />
            </div>
          </div>

          <Separator />

          <div className="grid gap-3">
            <Label>State</Label>
            <div className="flex flex-wrap gap-3">
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="error">Error</Badge>
              <Badge variant="default">Info</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>按钮与操作层级</CardTitle>
          <CardDescription>检查主操作、次操作和风险操作的区分是否稳定。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
          </div>

          <Separator />

          <div className="flex flex-wrap gap-3">
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>表单状态</CardTitle>
          <CardDescription>检查输入区层级、聚焦环和异常态。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="project-name">项目名称</Label>
            <Input id="project-name" placeholder="输入项目名称" />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="project-slug">项目标识</Label>
            <Input id="project-slug" aria-invalid defaultValue="ai companion" />
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
```

这个页面重点看三件事：

- 组件单独展示时是否协调

- 组件组合后层级是否仍然清楚

- 风险态、聚焦态、禁用态是否和普通态明显区分

### 6.2 更新共享演示组件

`tailwind-demo.tsx` 可以继续保留，但它的职责要更清楚：用来验证共享包组件在不同应用里都能正确消费，不承担完整规范说明。

packages/ui/src/tailwind-demo.tsx

```tsx
import { Badge } from './badge'
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

export function TailwindDemo({ appName }: TailwindDemoProps) {
  return (
    <Card className="w-full max-w-250 overflow-hidden">
      <CardHeader className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
        <div className="grid gap-3">
          <Badge>shared ui package</Badge>
          <div className="grid gap-2">
            <CardTitle className="text-2xl md:text-3xl">
              Design system is active in {appName}
            </CardTitle>
            <CardDescription className="max-w-160">
              基础组件已经统一消费设计令牌，颜色、层级、圆角和状态反馈保持一致。
            </CardDescription>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border-default bg-surface-canvas px-4 py-3 text-sm text-content-secondary">
            Shared tokens
          </div>
          <div className="rounded-xl border border-border-default bg-surface-canvas px-4 py-3 text-sm text-content-secondary">
            Shared primitives
          </div>
          <div className="rounded-xl border border-border-default bg-surface-canvas px-4 py-3 text-sm text-content-secondary">
            Shared states
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="grid gap-4 rounded-xl border border-border-default bg-surface-canvas p-5">
          <div className="grid gap-2">
            <Label htmlFor={`${appName}-workspace`}>Workspace</Label>
            <Input id={`${appName}-workspace`} defaultValue={`${appName}.workspace.local`} />
          </div>
          <Separator />
          <div className="flex flex-wrap gap-3">
            <Button>Primary action</Button>
            <Button variant="secondary">Secondary action</Button>
            <Button variant="outline">Outline action</Button>
          </div>
        </div>

        <div className="rounded-xl border border-border-default bg-surface-canvas p-5 text-sm leading-6 text-content-secondary">
          所有应用都通过同一套共享组件输出界面，后续调整主题或组件状态时，只需要维护一处。
        </div>
      </CardContent>

      <CardFooter className="flex-wrap gap-3 border-t border-border-default pt-6">
        <Button asChild variant="ghost">
          <a href="/design-system" target="_blank" rel="noopener noreferrer">
            View design system
          </a>
        </Button>
      </CardFooter>
    </Card>
  )
}
```

## 7. 组件使用约束

设计规范落地之后，团队还需要几条明确约束，避免页面代码重新把体系写散。

**颜色约束**

- 页面代码不直接写 `#xxxxxx` 或 `rgba(...)`，先补 token

- 文本颜色优先使用 `content-*`

- 背景颜色优先使用 `surface-*`

- 风险、成功、警告等反馈统一使用 `state-*`

**组件约束**

- 主按钮、次按钮、风险按钮都从 `Button` 变体中选

- 表单容器优先用 `Card` 组合，不重新手写面板结构

- 标签和状态优先用 `Badge`，不临时拼一段颜色 class

- 表单标签和输入框配对使用 `Label` + `Input`

**扩展约束**

- 新增颜色、圆角、阴影，先更新 `theme.css`

- 新增组件变体，优先扩展共享组件

- 页面局部特殊样式要有明确原因，避免把例外写成常态
