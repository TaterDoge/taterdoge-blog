---
title: "128 结构化输出流式 UI"
pubDate: 2026-05-21
description: "useChat 负责对话型 UI，useObject 负责另一类场景——让 UI 按一个预定义结构，随着 LLM 输出流式填充。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/13-use-object/](https://aicompanion.usehook.cn/13-use-object/)

## 1. useObject 解决什么

`useChat` 负责对话型 UI，`useObject` 负责另一类场景——让 UI 按一个预定义结构，随着 LLM 输出流式填充。

最经典的几个例子：

- AI 生成简历评分卡：标题、总分、多个维度的分项评分、每项简评。用户按发送，先看到标题，接着看到总分，接着一项一项打分填出来

- AI 生成产品周报：先标题、再摘要、再章节一、章节二……每一部分流式展开

- AI 建议的表单预填：用户上传一张名片，LLM 返回姓名、电话、公司、职位，表单字段逐个填入

- AI 规划的行程：时间线一段段出现

这种体验用 `useChat` 是做不出来的——它的数据是「文字流」，不是「结构填充流」。`useObject` 底层是后端 `streamObject` + 前端 Zod schema 类型推导的组合，用起来就像直接订阅一个「逐步完整的对象」。

## 2. 最小示例：简历评分卡

先定义共享 schema（前后端都要用）：

schemas/resume-score.ts

```typescript
import { z } from 'zod'

export const ResumeScoreSchema = z.object({
  overallScore: z.number().min(0).max(100)
    .describe('总分，0-100'),
  summary: z.string()
    .describe('一句话总结候选人画像'),
  dimensions: z.array(z.object({
    name: z.string(),
    score: z.number().min(0).max(10),
    comment: z.string(),
  }))
    .describe('各维度评分，每项有名称、0-10 分、简评'),
  recommendation: z.enum(['strong-hire', 'hire', 'lean-hire', 'no-hire']),
  risks: z.array(z.string()),
})

export type ResumeScore = z.infer<typeof ResumeScoreSchema>
```

后端用 Hono：

api-score.ts

```typescript
import { streamObject } from 'ai'
import { ResumeScoreSchema } from '@/shared/schemas/resume-score'

app.post('/api/score-resume', async (c) => {
  const { resumeText } = await c.req.json()

  const result = streamObject({
    model: models.structured,
    schema: ResumeScoreSchema,
    prompt: `评估这份简历：\n\n${resumeText}`,
  })

  return result.toTextStreamResponse()
})
```

注意这里用的是 `toTextStreamResponse`，不是 `toUIMessageStreamResponse`——`streamObject` 的协议是纯 JSON 片段流，和 UIMessageStream 不同。

前端：

score-form.tsx

```tsx
'use client'
import { experimental_useObject as useObject } from '@ai-sdk/react'
import { ResumeScoreSchema } from '@/shared/schemas/resume-score'

export function ResumeScoreCard() {
  const { object, submit, isLoading, error, stop } = useObject({
    api: '/api/score-resume',
    schema: ResumeScoreSchema,
  })

  return (
    <div>
      <button onClick={() => submit({ resumeText: '...' })} disabled={isLoading}>
        开始评分
      </button>

      {object?.overallScore != null && (
        <div className="score-card">
          <h1>总分：{object.overallScore}/100</h1>
          {object.summary && <p>{object.summary}</p>}

          <ul>
            {object.dimensions?.map((d, i) => (
              <li key={i}>
                <strong>{d?.name}</strong>：{d?.score}/10
                {d?.comment && <p>{d.comment}</p>}
              </li>
            ))}
          </ul>

          {object.recommendation && (
            <span className="recommendation">{object.recommendation}</span>
          )}

          {object.risks && object.risks.length > 0 && (
            <div className="risks">
              <h3>风险提示：</h3>
              <ul>{object.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {isLoading && <button onClick={stop}>停止</button>}
      {error && <div>出错：{error.message}</div>}
    </div>
  )
}
```

运行效果：用户点按钮，页面上先看到「总分：68」出现，接着 summary 一段段写完，接着 dimensions 一个一个弹出，每个里面的 comment 又是一段段补完，最后 recommendation 和 risks 也补上。

## 3. API 详解：DeepPartial 与返回值

`useObject` 返回的 `object` 不是完整的 `ResumeScore`，而是 `DeepPartial<ResumeScore>`：

deep-partial.ts

```typescript
type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T
```

也就是说：

- 所有字段都是 optional

- 嵌套对象里的字段也都是 optional

- 数组可能是 `undefined`，或者内部元素的部分字段缺失

所以渲染时必须做防御式判断：

safe-render.tsx

```tsx
// ✅ 正确：层层 optional chain + 判空
{object?.dimensions?.map((d, i) => (
  <li key={i}>
    {d?.name && <strong>{d.name}</strong>}
    {d?.score != null && <span>{d.score}/10</span>}
  </li>
))}

// ❌ 错误：假设字段已经到位
{object.dimensions.map(...)}  // object 可能 undefined
{object.dimensions[0].name}   // dimensions[0] 可能只完成一半，没有 name
```

两种判空习惯看需求：

- `value != null` 判空，但 0、空字符串、false 这些有效 falsy 值允许通过

- `value && ...` 用在你确实不想渲染 falsy 值的时候

`useObject` 的完整返回值：

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| object | DeepPartial<T> \| undefined | 当前已收到的对象快照 |
| submit | (input) => void | 触发生成，input 会作为 body POST 给后端 |
| isLoading | boolean | 正在流式生成 |
| stop | () => void | 中止 |
| error | Error \| undefined | 错误 |
| clear | () => void | 清空 object（回到初始） |
| id | string | 这次 object 生成的 ID |

有几个 API 细节值得注意：

- `submit` 的参数会被 `fetch` 当 body 发出去，后端用 `await c.req.json()` 读

- `isLoading` 是个布尔值，不像 `useChat` 有四态。因为对象生成过程更线性，没有「submitted」这个中间态

- `object` 在 `submit` 之前是 `undefined`，之后每次流片段到达都会刷新

## 4. 前后端 schema 共享

schema 必须前后端共用同一份。原因：

- 后端 `streamObject({ schema })` 用来约束 LLM 输出

- 前端 `useObject({ schema })` 用来做类型推导和 runtime 校验

在 monorepo 里最自然的做法就是放在共享包：

resume-score.ts简历评分meeting-summary.ts会议摘要trip-plan.ts行程规划

前后端都用 `import { XxxSchema } from '@shared/schemas/xxx'`。这是第 4 章 Monorepo 讲的经典共享模式。

关于 tree-shake：Zod 包本身在客户端不算小（大约 15 KB gzipped）。如果每个页面都 `import` 一堆 schema，体积会慢慢累加。缓解方案：按需 import（每个组件只引用它用到的 schema，不要用 `schemas/index.ts` 全量 barrel export），或者借助 Next.js App Router 的 RSC 天然分 chunk（页面用到哪个 schema 就只打哪个）。

## 5. 与 generateObject 的选择

`useObject` 用在需要「在 UI 里看到流式填充」的场景。如果你只是想拿到对象做后续处理（存库、加密、发另一个请求），`generateObject`（非流式）更合适：

| 场景 | 推荐 |
| --- | --- |
| 用户在看着界面等结果 | streamObject + useObject（流式 UI） |
| 后台批处理、ETL | generateObject |
| 对象体积小（< 10 字段），生成很快 | generateObject + 前端 loading 状态就够 |
| 对象体积大（20+ 字段、嵌套深） | streamObject + useObject（避免用户等太久） |

## 6. 错误恢复与 Zod 方案对照

`useObject` 暴露 `error` 字段，但重试逻辑要自己写：

retry.tsx

```tsx
const { object, submit, isLoading, error, clear } = useObject({
  api: '/api/score',
  schema: ResumeScoreSchema,
  onError: (err) => {
    console.error('object error:', err)
    // 可以发埋点
  },
})

async function handleSubmit() {
  clear()                   // 清上次的部分结果
  submit({ resumeText })    // 新请求
}

// 出错时显示重试按钮
{error && (
  <button onClick={handleSubmit}>
    出错了，重试（{error.message}）
  </button>
)}
```

后端如果抛 `NoObjectGeneratedError`，前端的 `error` 会收到。这种情况一般是 LLM 不稳定，换模型或简化 schema 通常能解决。

## 7. 在 AI 伴侣里的用武之地

AI 伴侣核心链路走的是 `useChat`，但产品里有一些非对话式的结构化输出场景，这些就适合 `useObject`：

- 「每周情感报告」：AI 生成本周情绪趋势图 + 关键事件 + 建议

- 「关系画像」：AI 分析用户和自己的相处风格、性格标签、兴趣匹配度

- 「纪念日回顾卡片」：精选过去一段时间的对话亮点，做成可分享卡片

- 「用户侧 Profile 预填」：用户第一次登录时，AI 根据几个问题生成初始画像

这些场景有一个共同点：结构化、多字段，而且希望用户能看着一边填充。用 `useObject` 能让体验比传统「等几秒 → 跳转 → 看到结果」快得多。

## 8. 小结

- `useObject` 把 `streamObject` 变成 React Hook，返回流式填充的 `DeepPartial<T>` 对象

- schema 前后端共享，放 monorepo 共享包

- 渲染时要防御式判空，用 `?.` / `!= null` 层层保护

- `submit` 参数会当 body 发给后端

- 选型：用户看着等的结构化场景用 `useObject`；后台批处理用 `generateObject`

- 和 Zod ch13 的关系：同一思路的流式版本，体验更好

- AI 伴侣里的用处：情感报告、关系画像、纪念卡片、Profile 预填

下一篇是前端集成最后一篇——**`ai/rsc`**：React Server Components 的流式 UI 玩法。这是本专栏主线不用的，但作为独立能力值得看一眼，知道它的优劣，以后遇到合适场景能识别出来。
