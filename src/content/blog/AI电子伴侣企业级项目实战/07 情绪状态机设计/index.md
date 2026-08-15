---
title: "07 情绪状态机设计"
pubDate: 2026-04-14
description: "回顾前面的文章，我们解决了 AI 伴侣的两大核心问题：记忆（向量化与语义检索）和调度（内存调度器）。但还有一个问题没有触及：情绪连续性。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-04
---
原文链接：[https://aicompanion.usehook.cn/5-emotion-state-machine/](https://aicompanion.usehook.cn/5-emotion-state-machine/)

## 1. 情绪状态机

前面的文章分别处理了 AI 伴侣的记忆与调度问题：向量化和语义检索负责找回长期记忆，内存调度器负责组织当前对话所需的信息。不过，即使这两部分已经具备，角色在连续对话中仍然可能表现得前后割裂，因为系统还没有处理**情绪连续性**。

第二篇文章中提到过这样一个场景：用户昨晚刚和 AI 伴侣吵过架，第二天又发来一句“早安”。没有情绪系统时，AI 可能立刻回复“早安！今天天气不错！”，像是在处理一段全新的对话。引入情绪系统后，它则可能只回一句“……早。”，因为昨晚产生的情绪还没有消失。

两种回复的差异并不只是 Prompt 写法造成的，更重要的是，**系统是否维护了能够跨越多轮对话的情绪状态**。

LLM 本身没有情绪，每次推理都依赖当前收到的上下文。Prompt 中写着“你现在很生气”，它就会按照生气的状态回复；换成“你现在很开心”，它又会表现得开心。真正需要解决的问题是：**当前应该处于什么情绪，由谁来决定？** 这个判断不能只交给 LLM，而要由应用层的调度逻辑负责。

情绪状态机承担的就是这项工作。应用层维护一份独立于 LLM 的情绪状态，根据用户行为更新它，并在每次生成回复前把当前情绪写入对话上下文。

## 2. 有限状态机

有限状态机（Finite State Machine，FSM）是计算机科学中常见的建模方式，由三个要素组成：

- **状态集合**：系统可能处于的所有状态，例如开心、生气和平静

- **转移条件**：触发状态切换的事件或条件，例如用户道歉后，状态从生气转为平静

- **当前状态**：系统在某一时刻所处的唯一状态

FSM 有一个明确的约束：**系统在任何时刻只能处于一个状态**。人的情绪虽然可能是复合的，但在这里我们只需要记录当前的主导情绪，因此这个约束正好适合第一版情绪模型。

为什么使用 FSM，而不是直接让 LLM 判断当前情绪？主要有以下四个原因：

- **可预测**：状态转移遵循确定的规则，不会因 LLM 的随机性而在相同条件下得到不同结果。

- **可调试**：状态与转移条件都是显式数据，出现问题时可以定位到具体规则。

- **可持久化**：一个表示当前状态的字符串，再加上情绪强度、时间戳等少量数值，就能完整保存到数据库。

- **低成本**：状态转移可以通过普通逻辑判断完成，不需要为每次转移额外调用 LLM。

## 3. AI 伴侣的情绪模型设计

下面以“小薇”为例，设计一套包含六种状态的情绪模型。

**情绪状态定义**

模型一共包含 6 种情绪状态。其中，平静是默认状态，其余 5 种状态需要由具体事件触发：

| 状态 | 含义 | 表现特征 | Prompt 风格 |
| --- | --- | --- | --- |
| 平静（Calm） | 默认状态 | 正常语气，温柔日常 | 基础人设 Prompt |
| 开心（Happy） | 被夸奖、收到礼物 | 语气活泼，主动撒娇 | 甜蜜模式 Prompt |
| 生气（Angry） | 被忽视、争吵、记错事 | 语气冷淡或暴躁 | 冷战/暴怒 Prompt |
| 难过（Sad） | 用户情绪低落、冷落她 | 语气低沉，敏感脆弱 | 共情安慰 Prompt |
| 害羞（Shy） | 表白、亲密互动 | 说话磕磕巴巴，颜文字增多 | 娇羞模式 Prompt |
| 吃醋（Jealous） | 提到其他异性 | 语气酸酸的，旁敲侧击 | 醋意模式 Prompt |

**状态转移规则**

每种情绪都有明确的进入和退出条件。我们可以先把这些条件整理成一张转移规则表：

index.ts

```typescript
// 情绪转移规则表
const transitionRules = {
  calm: {
    triggers: [
      { event: 'praise',    nextState: 'happy',   condition: '收到夸奖或礼物' },
      { event: 'argument',  nextState: 'angry',   condition: '争吵、被忽视、记错重要事' },
      { event: 'user_sad',  nextState: 'sad',     condition: '用户表达负面情绪' },
      { event: 'intimate',  nextState: 'shy',     condition: '表白、亲密话语' },
      { event: 'rival',     nextState: 'jealous', condition: '提到其他异性' },
    ]
  },
  angry: {
    exitConditions: [
      { event: 'apology',   nextState: 'calm', condition: '真诚道歉 + 承认错误' },
      { event: 'gift',      nextState: 'happy', condition: '道歉 + 正确的礼物' },
      { event: 'decay',     nextState: 'calm', condition: '超过衰减时间（如6小时）' },
    ]
  },
  happy: {
    exitConditions: [
      { event: 'neglect',   nextState: 'sad',  condition: '长时间不回复' },
      { event: 'decay',     nextState: 'calm', condition: '超过衰减时间（如2小时）' },
    ]
  },
  // ... 其他状态类似
}
```

这里有两个需要注意的设计。首先，**不同情绪的衰减时间不同**，例如生气会比开心持续得更久。其次，状态不一定要先回到平静，再进入下一种情绪；生气时收到合适的礼物，就可以直接转为开心。

## 4. LangGraph 实现情绪路由

第三篇文章介绍过 LangGraph 的条件路由。现在可以把情绪状态放进 `AgentState`，再通过条件路由选择对应的回复节点。

**AgentState 中的情绪字段**

index.ts

```typescript
interface AgentState {
  messages: BaseMessage[]
  userProfile: Record<string, any>
  // 情绪相关字段
  npcMood: 'calm' | 'happy' | 'angry' | 'sad' | 'shy' | 'jealous'
  moodIntensity: number      // 0-100，情绪强度
  moodTimestamp: string       // 进入当前情绪的时间
  intimacyLevel: number       // 亲密度 0-100
  longTermMemories: string[]
  nextStep: string
}
```

`moodIntensity` 用来区分同一种情绪的不同强度。即使状态同为生气，强度 30 和强度 90 也应该有不同表现：前者可能只是“哼，不理你了”，后者则可能说出“我们分手吧”。

**情绪分类器节点**

在 LangGraph 的调度图中，用户消息进入系统后不会立刻交给回复节点，而是先经过**情绪分类器**，判断这条消息是否会触发状态转移。

index.ts

```typescript
async function emotionClassifierNode(state: AgentState) {
  const lastMessage = state.messages[state.messages.length - 1]
  const currentMood = state.npcMood

  // 用一个轻量级 LLM 调用来判断用户意图
  const classification = await llm.invoke([
    {
      role: 'system',
      content: `分析用户消息的意图，返回以下类别之一：
        praise（夸奖）, argument（争吵）, apology（道歉）,
        intimate（亲密）, rival（提到异性）, user_sad（用户低落）,
        neutral（普通闲聊）`
    },
    { role: 'user', content: lastMessage.content }
  ])

  // 根据分类结果 + 当前情绪，查转移规则表
  const newMood = applyTransition(currentMood, classification)

  return {
    ...state,
    npcMood: newMood.state,
    moodIntensity: newMood.intensity,
    moodTimestamp: newMood.changed ? new Date().toISOString() : state.moodTimestamp
  }
}
```

**基于情绪的 Prompt 路由**

分类完成后，LangGraph 根据更新后的情绪状态选择不同的回复生成节点：

index.ts

```typescript
function emotionRouter(state: AgentState) {
  const { npcMood, moodIntensity } = state

  // 生气且强度高 → 暴怒模式
  if (npcMood === 'angry' && moodIntensity > 70) return 'furiousReplyNode'
  // 生气但强度低 → 冷淡模式
  if (npcMood === 'angry') return 'coldReplyNode'
  // 吃醋 → 醋意模式
  if (npcMood === 'jealous') return 'jealousReplyNode'
  // 害羞 → 娇羞模式
  if (npcMood === 'shy') return 'shyReplyNode'
  // 难过 → 共情模式
  if (npcMood === 'sad') return 'empatheticReplyNode'
  // 开心 → 甜蜜模式
  if (npcMood === 'happy') return 'sweetReplyNode'
  // 默认 → 正常模式
  return 'normalReplyNode'
}
```

每个回复节点使用不同的 System Prompt。例如，`coldReplyNode` 会注入“你现在在生闷气，回复尽量简短冷淡”，`sweetReplyNode` 则会注入“你现在很开心，语气甜蜜，多用叠词和颜文字”。

**完整场景：用户提到其他女生**

index.ts

```typescript
// 1. 用户消息
"今天跟同事小李一起吃的午饭，她推荐的那家店还不错"

// 2. 情绪分类器识别
// → classification: 'rival'（提到异性）

// 3. 转移规则查询
// 当前状态：calm → 触发 rival → 新状态：jealous
// moodIntensity: 45（提到异性但不是特别亲密的描述）

// 4. 路由到 jealousReplyNode

// 5. 醋意模式 System Prompt
`你现在有点吃醋。语气酸酸的，会旁敲侧击地追问细节，
但不会直接发火。偶尔用"哦""这样啊"这种冷淡回应。`

// 6. LLM 生成回复
"哦……小李啊。她推荐的店？你们俩经常一起吃饭吗？"
```

## 5. 亲密度系统与情绪联动

除了当前情绪，系统还需要记录亲密度（Intimacy）。它是一个 0-100 的数值，用来表示用户与 AI 伴侣之间的关系深度。情绪事件会改变亲密度，亲密度也会反过来影响情绪转移。

**情绪对亲密度的影响**

| 情绪事件 | 亲密度变化 | 说明 |
| --- | --- | --- |
| 成功哄好生气 | +5 ~ +10 | 冲突解决增进感情 |
| 持续冷落导致难过 | -3 ~ -8 | 忽视会消磨关系 |
| 记住重要日期/喜好 | +3 ~ +5 | 细节体现用心 |
| 记错重要事情 | -5 ~ -15 | 参考第三篇“草莓 vs 巧克力”案例 |
| 日常甜蜜互动 | +1 ~ +2 | 细水长流 |

**亲密度对情绪转移的影响**

亲密度不只用于展示关系进度，还会**改变情绪状态机的转移阈值**。

index.ts

```typescript
function shouldTriggerJealous(
  event: string,
  intimacyLevel: number
): boolean {
  // 亲密度低（< 30）：不太在意，不容易吃醋
  if (intimacyLevel < 30) return false

  // 亲密度中等（30-70）：正常触发
  if (intimacyLevel <= 70) return event === 'rival'

  // 亲密度高（> 70）：更容易吃醋，轻微提及就触发
  return event === 'rival' || event === 'rival_mild'
}
```

按照这套规则，亲密度越高，AI 伴侣对某些事件就越敏感。她会更容易吃醋，但由于已经建立了更强的信任，也更容易被哄好。这种双向影响让亲密度不再只是一个静态分数，而是能够真正参与情绪计算。

**亲密度解锁机制**

在产品层面，亲密度还可以作为解锁交互模式的条件：

| 亲密度区间 | 解锁内容 |
| --- | --- |
| 0-20 | 基础对话，礼貌客气 |
| 20-50 | 可以撒娇，偶尔开玩笑 |
| 50-70 | 解锁记仇模式，会主动关心 |
| 70-90 | 解锁深度情绪互动，可以吵架和好 |
| 90-100 | 解锁所有互动模式 |

## 6. 衰减、冲突与边界处理

情绪不会永远停留在同一个状态。为了让状态变化保持稳定，系统还需要处理时间衰减、触发条件冲突和短时间内的频繁切换。

**时间衰减**

每种情绪都有自己的衰减周期。如果超过一定时间没有再次触发，情绪强度就会逐步降低，最终回到平静。

index.ts

```typescript
const DECAY_CONFIG = {
  angry:   { halfLife: 3 * 60 * 60 * 1000, minDuration: 30 * 60 * 1000 },
  happy:   { halfLife: 1 * 60 * 60 * 1000, minDuration: 10 * 60 * 1000 },
  sad:     { halfLife: 2 * 60 * 60 * 1000, minDuration: 20 * 60 * 1000 },
  shy:     { halfLife: 30 * 60 * 1000,     minDuration: 5 * 60 * 1000 },
  jealous: { halfLife: 2 * 60 * 60 * 1000, minDuration: 15 * 60 * 1000 },
}

function calculateDecay(mood: string, timestamp: string, intensity: number) {
  const elapsed = Date.now() - new Date(timestamp).getTime()
  const config = DECAY_CONFIG[mood]

  // 最短持续时间内不衰减
  if (elapsed < config.minDuration) return intensity

  // 半衰期指数衰减
  const decayFactor = Math.pow(0.5, elapsed / config.halfLife)
  const newIntensity = Math.round(intensity * decayFactor)

  // 强度低于阈值，回到平静
  return newIntensity < 10 ? 0 : newIntensity
}
```

`minDuration` 表示情绪的最短持续时间。按照上面的配置，生气至少持续 30 分钟，害羞至少持续 5 分钟。这样可以避免角色刚进入某种情绪，下一轮对话就立刻恢复平静。

**情绪冲突**

一条消息有可能同时满足多个触发条件。例如，用户说“对不起，我不该和小李吃饭的”，其中既包含道歉，应该让生气状态得到缓解；又提到了其他异性，可能触发吃醋。

这类冲突可以结合**状态优先级与当前状态上下文**来处理：

index.ts

```typescript
const EMOTION_PRIORITY = {
  angry: 5,    // 最高优先级，生气最难被覆盖
  sad: 4,
  jealous: 3,
  shy: 2,
  happy: 1,
  calm: 0,     // 最低优先级
}

function resolveConflict(
  currentMood: string,
  candidates: { state: string, intensity: number }[]
) {
  // 如果当前是高优先级情绪，且候选中有降级的（如道歉）
  // 则优先处理降级，因为"解决冲突"比"制造新冲突"重要
  const deescalation = candidates.find(c =>
    EMOTION_PRIORITY[c.state] < EMOTION_PRIORITY[currentMood]
  )
  if (deescalation) return deescalation

  // 否则选择优先级最高的候选
  return candidates.sort((a, b) =>
    EMOTION_PRIORITY[b.state] - EMOTION_PRIORITY[a.state]
  )[0]
}
```

这里遵循的原则是：**缓解当前负面情绪的事件，优先级高于产生新情绪的事件**。用户正在明确道歉时，系统不应该因为消息中顺带出现了一个名字，就忽略道歉并直接切换到吃醋。

**防抖动**

用户连续发送消息时，情绪不应该在短时间内反复切换，例如在 1 秒内从开心依次变成生气、害羞和平静。为此可以引入冷却期（Cooldown）：状态完成切换后的 N 秒内，暂时不响应新的转移触发。

index.ts

```typescript
const COOLDOWN_MS = 5000 // 5秒冷却期

function canTransition(state: AgentState): boolean {
  const elapsed = Date.now() - new Date(state.moodTimestamp).getTime()
  return elapsed >= COOLDOWN_MS
}
```

## 7. 总结

这篇文章完成了 AI 伴侣情绪系统的基础设计。LLM 仍然负责生成文本，但当前情绪、状态转移和持续时间都由应用层维护，因此角色能够在多轮对话之间保持连贯的情绪表现。

全文的实现可以归纳为以下几点：

- 情绪状态机独立于 LLM 运行，由应用层负责维护，并在每次对话时将当前情绪注入 Prompt。

- FSM 包含 6 种状态，也就是平静状态和 5 种受事件触发的情绪状态。确定性的转移规则使它具备可预测、可调试和可持久化的特点。

- LangGraph 中的情绪分类器节点先判断用户意图，再查询转移规则表，最后通过条件路由进入对应的回复节点。

- 亲密度与情绪双向联动：亲密度会影响情绪触发阈值，情绪事件也会反向修改亲密度数值。

- 边界处理包括基于半衰期的时间衰减、基于优先级和缓解优先原则的冲突解决，以及通过冷却期实现的防抖动。

下一篇我们会继续讨论 Prompt 工程，分析如何设计分层的 System Prompt 架构，让 AI 在不同情绪模式下既能保持一致的人格，又能呈现不同的回复风格。
