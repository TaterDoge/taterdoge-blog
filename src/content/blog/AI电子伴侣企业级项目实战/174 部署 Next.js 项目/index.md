---
title: "174、 部署 Next.js 项目"
pubDate: 2026-06-08
description: "讲解 Next.js 子站如何在 Cloudflare Pages 上静态部署，包含环境变量、静态导出、动态参数和 CORS 配置。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/39-nextjs-cloudflare-pages-deploy/](https://aicompanion.usehook.cn/39-nextjs-cloudflare-pages-deploy/)

这篇文章记录一次真实的前端子站部署过程：把 monorepo 里的 `admin` 和 `web` 两个 Next.js 子站部署到 Cloudflare Pages。

项目结构大致如下：

index.txt

```txt
ai-agent
├── apps
│   ├── api      # Cloudflare Worker / Hono API
│   ├── admin    # 管理后台 Next.js
│   └── web      # 用户端 Next.js
├── packages
└── pnpm-workspace.yaml
```

这次部署选择的是 Cloudflare Pages Direct Upload，也就是本地构建静态产物，然后用 Wrangler 上传 `out` 目录。

## 1. 静态部署的前提

`admin` 和 `web` 都是 Next.js 子站，但它们的业务请求主要发生在浏览器端。页面由 Next.js 构建成静态 HTML 和 JS；用户登录后，浏览器通过 `NEXT_PUBLIC_API_BASE_URL` 请求 api 子站；鉴权 token 保存在浏览器侧；API、D1、R2、GitHub OAuth 等服务端能力都放在 `apps/api` 里。

所以前端子站不需要在 Pages 上运行 SSR 逻辑，直接静态导出即可。

如果你的 Next.js 页面依赖这些能力，就不能直接用本文的方式：

index.txt

```txt
cookies()
headers()
Route Handler
Server Action
动态 SSR
Node.js runtime API
```

这种情况需要使用 Cloudflare Pages Functions 或 OpenNext 这类适配方案。

## 2. 前置条件

部署前我们先把几件事确认好：Cloudflare Wrangler 已经登录，admin / web 的生产环境变量已经指向 API 的 production 地址，并且这两个 Next.js 项目都可以静态导出。

确认 Wrangler 登录：

index.bash

```shellscript
cd apps/api
pnpm wrangler whoami
```

这里要特别说明一下：此时 api 子站还没有真正部署上线。我们先使用的是即将部署到生产环境的 API 地址，也就是后面 Worker 部署完成后会对外提供服务的地址：

api-url.txt

```txt
https://api-production.1832064870.workers.dev
```

后续 admin 和 web 会把请求发到这个地址。等前端 Pages 域名确定以后，我们还要回头把这些前端域名同步到 API 的 CORS 配置里，再部署 api 子站。

## 3. 部署 Admin 子站

### 3.1 修改生产环境变量

文件位置：

index.txt

```txt
apps/admin/.env.production
```

内容示例：

apps/admin/.env.production

```txt
APP_ENV=production
API_BASE_URL=https://api-production.1832064870.workers.dev
NEXT_PUBLIC_APP_ENV=production
NEXT_PUBLIC_API_BASE_URL=https://api-production.1832064870.workers.dev
```

这里有两个 API 地址：

index.txt

```txt
API_BASE_URL
NEXT_PUBLIC_API_BASE_URL
```

这两个变量的使用位置不一样。`API_BASE_URL` 给服务端代码使用，`NEXT_PUBLIC_API_BASE_URL` 会被打包进浏览器代码。

当前 admin 是静态部署，真正关键的是 `NEXT_PUBLIC_API_BASE_URL`。但为了保持环境变量结构一致，两个都配置成同一个线上 API 地址。

### 3.2 开启静态导出

文件位置：

index.txt

```txt
apps/admin/next.config.js
```

配置如下：

apps/admin/next.config.js

```javascript
/** @type {import('next').NextConfig} */

const nextConfig = {
  output: "export",
  transpilePackages: ["@repo/ui", "@repo/contracts", "@repo/api"]
};

export default nextConfig;
```

关键配置是：

next.config.js

```javascript
output: "export"
```

它会让 `next build` 生成 `out` 目录，里面是可以被 Cloudflare Pages 托管的静态资源。

### 3.3 构建 Admin

在仓库根目录执行：

index.bash

```shellscript
pnpm --filter admin build
```

构建成功后会生成：

index.txt

```txt
apps/admin/out
```

### 3.4 创建 Cloudflare Pages 项目

本项目 Wrangler 安装在 `apps/api` 子站里，所以进入 `apps/api` 执行 Wrangler 命令：

index.bash

```shellscript
cd apps/api
pnpm wrangler pages project create ai-agent-admin --production-branch main
```

创建成功后，Cloudflare 会提示项目默认域名，例如：

pages-url.txt

```txt
https://ai-agent-admin.pages.dev
```

### 3.5 上传 Admin 静态产物

继续在 `apps/api` 目录执行：

index.bash

```shellscript
pnpm wrangler pages deploy ../admin/out \
  --project-name ai-agent-admin \
  --branch main \
  --commit-dirty=true
```

部署成功后会看到类似输出：

index.txt

```txt
Deployment complete!
https://d27879cc.ai-agent-admin.pages.dev
```

这里要区分生产域名和预览部署地址：

pages-url.txt

```txt
生产域名: https://ai-agent-admin.pages.dev
预览部署: https://d27879cc.ai-agent-admin.pages.dev
```

日常访问建议用生产域名。

## 4. 部署 Web 子站

Web 子站和 Admin 子站整体流程相同，但多了两个注意点。Web 使用了 `next/image`，静态导出时需要关闭图片优化；同时 Web 有动态路由 `/discover/[roleId]`，静态导出时需要补上 `generateStaticParams()`。

### 4.1 修改生产环境变量

文件位置：

index.txt

```txt
apps/web/.env.production
```

内容示例：

apps/web/.env.production

```txt
APP_ENV=production
API_BASE_URL=https://api-production.1832064870.workers.dev
NEXT_PUBLIC_APP_ENV=production
NEXT_PUBLIC_API_BASE_URL=https://api-production.1832064870.workers.dev
```

### 4.2 开启静态导出和图片非优化

文件位置：

index.txt

```txt
apps/web/next.config.js
```

配置如下：

apps/web/next.config.js

```javascript
/** @type {import('next').NextConfig} */

const nextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@repo/ui", "@repo/contracts", "@repo/api"]
};

export default nextConfig;
```

这里需要加 `images.unoptimized`。

因为 Next.js 默认图片优化需要服务端能力，而 `output: "export"` 输出的是纯静态资源。关闭图片优化后，`next/image` 会以静态方式工作，适合 Pages 托管。

### 4.3 给动态详情页补静态参数

Web 里有一个角色详情页：

index.txt

```txt
apps/web/app/(dashboard)/discover/[roleId]/page.tsx
```

静态导出时，Next.js 必须提前知道要生成哪些 `roleId` 页面，因此需要增加：

page.tsx

```typescript
export function generateStaticParams() {
  return Object.keys(roleProfiles).map((roleId) => ({ roleId }))
}
```

如果不加，构建会报错：

error.txt

```txt
Page "/discover/[roleId]" is missing "generateStaticParams()"
so it cannot be used with "output: export" config.
```

### 4.4 构建 Web

在仓库根目录执行：

index.bash

```shellscript
pnpm --filter web build
```

构建成功后会生成：

index.txt

```txt
apps/web/out
```

### 4.5 创建 Cloudflare Pages 项目

进入 `apps/api`：

index.bash

```shellscript
cd apps/api
pnpm wrangler pages project create ai-agent-web --production-branch main
```

这次 Cloudflare 实际分配的生产域名是：

pages-url.txt

```txt
https://ai-agent-web-66e.pages.dev
```

注意：不要想当然以为一定是 `https://ai-agent-web.pages.dev`。如果项目名冲突或 Cloudflare 做了后缀处理，最终域名要以 Wrangler 输出或 Pages 项目列表为准。

查看 Pages 项目：

index.bash

```shellscript
pnpm wrangler pages project list
```

### 4.6 上传 Web 静态产物

index.bash

```shellscript
pnpm wrangler pages deploy ../web/out \
  --project-name ai-agent-web \
  --branch main \
  --commit-dirty=true
```

部署成功后会看到类似：

index.txt

```txt
Deployment complete!
https://3b146b17.ai-agent-web-66e.pages.dev
```

对应关系可以这样看：

pages-url.txt

```txt
生产域名: https://ai-agent-web-66e.pages.dev
预览部署: https://3b146b17.ai-agent-web-66e.pages.dev
```

## 5. 同步 API 的 CORS 配置

前端部署完成后，还需要回到 `apps/api/wrangler.jsonc`，同步生产环境的来源域名。这一步是给后续 api 子站部署做准备，因为此时我们已经知道 Admin 和 Web 在 Cloudflare Pages 上的真实生产域名。

文件位置：

index.txt

```txt
apps/api/wrangler.jsonc
```

生产环境变量示例：

wrangler.jsonc

```jsonc
{
  "env": {
    "production": {
      "vars": {
        "ADMIN_ORIGIN": "https://ai-agent-admin.pages.dev",
        "WEB_ORIGIN": "https://ai-agent-web-66e.pages.dev"
      }
    }
  }
}
```

这一步必须同步。

因为 API 里 CORS 是按这两个变量判断的：

cors.ts

```typescript
const allowedOrigins = new Set([env.ADMIN_ORIGIN, env.WEB_ORIGIN])
```

如果 Pages 实际域名和 API 配置不一致，浏览器请求会被 CORS 拦住。

Web 部署后，我们把：

wrangler.vars

```txt
WEB_ORIGIN=https://ai-agent-web-66e.pages.dev
```

写入 API production 配置。因为此时 api 子站还没有正式上线，所以这里更准确地说，是带着最新的 CORS 配置去部署 API：

index.bash

```shellscript
cd apps/api
pnpm wrangler deploy --env production --dry-run
pnpm wrangler deploy --env production --minify
```

## 6. GitHub OAuth 回调地址

Web 子站上线后，GitHub OAuth App 的回调地址应该指向 API 子站，而不是 Web 子站。即使 api 子站此时还没部署完成，GitHub 里也要按即将上线的 API callback 地址来配置。

本次准备部署的 API production 地址是：

api-url.txt

```txt
https://api-production.1832064870.workers.dev
```

所以 GitHub OAuth callback URL 应该填：

callback-url.txt

```txt
https://api-production.1832064870.workers.dev/auth/web/github/callback
```

原因是 GitHub 授权完成后，会先回到 API：

index.txt

```txt
GitHub
  -> API /auth/web/github/callback
  -> API 生成登录 ticket
  -> 跳回 WEB_ORIGIN /login/github/callback
```

因此 API 需要知道 `WEB_ORIGIN`，GitHub 需要知道 API callback。

## 总结

Admin：

pages-url.txt

```txt
https://ai-agent-admin.pages.dev
```

Web：

pages-url.txt

```txt
https://ai-agent-web-66e.pages.dev
```

API：

api-url.txt

```txt
https://api-production.1832064870.workers.dev
```

这套部署方式可以这样理解：`admin/web` 只负责静态页面和浏览器端交互，`api` 承担所有服务端能力。Cloudflare Pages 托管前端静态资源，Cloudflare Workers 托管 API。Pages 域名变化后，我们还要同步更新 API 的 CORS origin，否则浏览器请求会在跨域校验时被拦下来。
