---
title: "238 执行计划"
pubDate: 2026-08-12
description: "上一篇得到的执行计划，只是说明了应该查询上海天气、整理行程需求、生成物品清单并检查结果。计划里的每一步仍然是待办事项，天气工具还没有运行，用户也还没有拿到最终清单。"
tags: [AI编程, 学习心法]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-12
---
原文链接：[https://aicompanion.usehook.cn/4execute-the-plan/](https://aicompanion.usehook.cn/4execute-the-plan/)

## 1. 计划执行器

上一篇得到的执行计划，只是说明了应该查询上海天气、整理行程需求、生成物品清单并检查结果。计划里的每一步仍然是待办事项，天气工具还没有运行，用户也还没有拿到最终清单。

执行计划时，Agent 需要反复完成三个动作：找到依赖已经满足的步骤，选择负责这一步的工具或模型，再把步骤结果保存起来供后续步骤使用。直到验证步骤确认结果满足 `goal`，整个任务才算真正完成。

这就是执行器要干的活

## 2. 读取计划

计划调度器拿到计划后，不应该把所有步骤一次塞给模型。它需要逐项读取 `type` 和 `dependsOn`，决定当前可以运行什么。

图中有两条不同的数据通道。上方的结果通道保存工具和模型真正产生的数据，最后只输出经过验证的结果；下方的状态通道只发送「正在查询天气」「正在生成清单」这类状态，不携带天气详情或模型草稿。

## 3. 案例

下面的演示加载了一份固定计划快照，它对应上一篇案例期望产生的四个步骤。点击「开始执行」后，状态栏会依次切换当前步骤，但不会把中间结果追加成回复。四步全部完成后，页面才展示最终物品清单。

天气工具在本篇中使用明确标注的模拟数据，这样学习者每次运行都能得到稳定结果。真实项目只需要替换 `tools.ts` 中的工具实现，计划调度器、状态协议和结果组件不需要跟着改写；只有工具返回结构发生变化时，对应步骤执行器才需要调整写入 `memory` 的逻辑。

### 执行上海出差计划

上一步计划已加载 · 4 个步骤

- 查询天气工具
- 整理需求代码
- 生成清单模型
- 验证结果代码
等待执行计划plan.tsagent.tssteps.tsstatus.tstools.tsmodel.tsschema.tsprompt.tsdemo.tsx

```typescript
export const EXECUTION_PLAN = {
  goal: '得到一份适合乘坐高铁去上海出差的物品清单',
  context: {
    time: '明天',
    destination: '上海',
    duration: '三天',
    transport: '高铁',
    workScenes: ['产品评审', '客户拜访'],
  },
  steps: [
    {
      id: 'step-1',
      title: '查询上海天气',
      type: 'tool',
      dependsOn: [],
    },
    {
      id: 'step-2',
      title: '整理行程与工作需求',
      type: 'reasoning',
      dependsOn: [],
    },
    {
      id: 'step-3',
      title: '生成分组物品清单',
      type: 'reasoning',
      dependsOn: ['step-1', 'step-2'],
    },
    {
      id: 'step-4',
      title: '检查清单是否满足目标',
      type: 'validation',
      dependsOn: ['step-3'],
    },
  ],
} as const

```

**到这里，我们会发现，Agent 其实就是一系列异步任务在依次执行。这个理解，是我们对 Agent 祛魅的核心关键。也就意味着，Agent 开发，跟我们以前的编程开发，并没有本质的区别**

异步任务有串行、并行、前有依赖等概念，而 Agent 中的节点编排，实际上也是这些概念。我们后续的更复杂概念的学习，都是基于异步任务的基础概念来扩展的，

其他额外说明如下「可跳过」：

## 4. 中间状态

前几篇的教学案例把每一步输出都追加到聊天消息中，方便学习者观察数据如何传递。但真实产品如果也这样做，用户会先看到意图对象、缺口数组、工具原始响应和验证日志，最后才看到真正需要的答案。

这不仅显得拥挤，还会带来三个问题：中间数据结构会泄露实现细节，工具结果可能在验证前就被误认为最终结论，多次更新同一条长消息也会让界面难以稳定渲染。

更合适的做法是把三类信息分开：

| 数据 | 面向谁 | 是否进入最终回复 |
| --- | --- | --- |
| 状态事件 | 界面状态栏 | 否 |
| 步骤结果 | 后续执行步骤 | 否 |
| 最终结果 | 用户 | 是 |

状态事件只需要 `step` 和 `message`。例如执行天气步骤时，Agent 发送 `{ step: 'weather', message: '正在调用天气工具' }`，界面把「查询天气」切换为运行中。天气工具返回的温度和降雨信息则保留在 Agent 内部，直到它参与生成并通过验证。

## 5. 状态回调

`runExecutionAgent` 没有使用异步生成器逐段 `yield` 文本，而是接收一个 `onStatus` 回调。它依次读取计划步骤，确认 `dependsOn` 中的前置步骤已经完成，再从 `STEP_EXECUTORS` 找到对应执行器。计划调度器在运行每个执行器之前调用一次状态回调；真正的工具结果则由步骤执行器写入共享的 `memory`。

这种接口形成了很清楚的边界：

index.ts

```typescript
onStatus({ step: 'weather', message: '正在调用天气工具' })
const weather = await queryShanghaiWeather()

onStatus({ step: 'generate', message: '正在生成最终清单' })
const completed = new Set()
const memory = {}

for (const step of EXECUTION_PLAN.steps) {
  ensureDependenciesCompleted(step, completed)
  const executor = STEP_EXECUTORS[step.id]

  onStatus(executor.status)
  await executor.run(memory)
  completed.add(step.id)
}

if (!memory.weather || !memory.validated) {
  throw new Error('执行计划结束，但没有得到完整结果')
}

return { ...memory.validated, weather: memory.weather }
```

这段伪代码里的 `memory` 是 Agent 的工作台，而不是用户消息。天气结果会先写入 `memory.weather`，整理出的需求写入 `memory.requirements`，后面的步骤可以读取它们，但 UI 不会直接渲染它们。

UI 只订阅 `onStatus` 来更新当前步骤。`await runExecutionAgent()` 得到返回值之前，结果区域保持为空；异步函数完成后，React 才一次性渲染 `ExecutionResult`。因此，即使以后增加更多工具，聊天内容也不会随着内部步骤数量不断膨胀。

## 6. 最后验证

模型生成了结构正确的清单，不代表内容一定完整。它可能漏掉身份证、电脑充电器，也可能看到了小雨却忘记加入雨具。

这些检查具有明确答案，更适合交给普通代码。案例中的 `ensureRequiredItems` 会汇总所有分组，检查身份证、电脑、充电器和雨天必需品；发现遗漏时，把它们放进「验证补充」分组。Zod 负责保证结果形状，验证函数负责保证关键业务条件，两者处理的是不同问题。

执行失败时也不应该伪造最终结果。界面会把当前步骤切换为失败并显示错误，已经完成的步骤仍然保持完成状态。下一篇再进一步讨论工具超时、重试、回退和重新规划。
