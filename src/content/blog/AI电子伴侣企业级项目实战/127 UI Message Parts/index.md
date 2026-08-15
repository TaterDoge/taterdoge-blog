---
title: "127 UI Message Parts"
pubDate: 2026-05-21
description: "消息协议https://aicompanion.usehook.cn/5messageprotocol 介绍过 UIMessage.parts 的概念：一条消息是一个 part 数组，每个 part 有自己的 type 和渲染策略。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/12-ui-message-parts/](https://aicompanion.usehook.cn/12-ui-message-parts/)

## 1. 一条消息不再是「一段文字」

[消息协议](/5-message-protocol) 介绍过 `UIMessage.parts` 的概念：一条消息是一个 part 数组，每个 part 有自己的 type 和渲染策略。

这一篇要把「怎么把 parts 渲染成好看的 UI」讲透。聊天 UI 的质感差距，80% 都在 parts 的渲染细节上：

- 流式文字是一股脑出来，还是有光标效果

- LLM 思考时有没有一个小气泡展示它的推理过程

- 调工具时有没有「正在检索…」的卡片

- RAG 引用有没有点击可跳转的来源徽章

- 代码块有没有 highlight 和复制按钮

- Markdown 有没有流式增量解析

协议层这些东西 AI SDK 全给你了，渲染层得你自己用 React 组件实现。好在协议是统一的，所以渲染组件可以做成 npm 包在多个项目里复用。

## 2. Part 类型与渲染分发

先把 UIMessagePart 可能遇到的所有 type 列一下：

ui-message-part.ts

```typescript
type UIMessagePart<DATA> =
  | TextUIPart
  | ReasoningUIPart
  | SourceUrlUIPart
  | SourceDocumentUIPart
  | FileUIPart
  | StepStartUIPart
  | ToolUIPart<string>      // type: `tool-${ToolName}`
  | DynamicToolUIPart       // type: 'dynamic-tool'（动态工具，如 MCP）
  | DataUIPart<DATA>        // type: `data-${DataKey}`
```

每种的具体字段：

part-shapes.ts

```typescript
interface TextUIPart {
  type: 'text'
  text: string
  state?: 'streaming' | 'done'
}

interface ReasoningUIPart {
  type: 'reasoning'
  text: string
  state?: 'streaming' | 'done'
}

interface SourceUrlUIPart {
  type: 'source-url'
  sourceId: string
  url: string
  title?: string
}

interface SourceDocumentUIPart {
  type: 'source-document'
  sourceId: string
  mediaType: string
  title: string
  filename?: string
}

interface FileUIPart {
  type: 'file'
  mediaType: string
  filename?: string
  url: string            // data: URL 或公网 URL
}

interface StepStartUIPart {
  type: 'step-start'     // 多步 Agent 里 step 的开始标记
}

interface ToolUIPart<NAME extends string> {
  type: `tool-${NAME}`
  toolCallId: string
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
  input?: unknown
  output?: unknown
  errorText?: string
}

interface DynamicToolUIPart {
  type: 'dynamic-tool'
  toolName: string
  toolCallId: string
  state: ...
  input?: unknown
  output?: unknown
}

interface DataUIPart<DATA> {
  type: `data-${string}`
  data: DATA
  id?: string
}
```

有了类型清单，就能搭一个按 type 分发的渲染入口：

message-renderer.tsx

```tsx
import type { UIMessage } from 'ai'

function Message({ message }: { message: UIMessage }) {
  return (
    <div className={`message message--${message.role}`}>
      <Avatar role={message.role} />
      <div className="message-body">
        {message.parts.map((part, i) => <Part key={i} part={part} />)}
      </div>
    </div>
  )
}

function Part({ part }: { part: UIMessage['parts'][number] }) {
  switch (part.type) {
    case 'text':            return <TextPart part={part} />
    case 'reasoning':       return <ReasoningPart part={part} />
    case 'source-url':      return <SourceUrlPart part={part} />
    case 'source-document': return <SourceDocPart part={part} />
    case 'file':            return <FilePart part={part} />
    case 'step-start':      return <StepDivider />
    case 'dynamic-tool':    return <DynamicToolPart part={part} />
    default:
      // tool-xxx 和 data-xxx 都要前缀匹配
      if (part.type.startsWith('tool-'))  return <ToolPart part={part} />
      if (part.type.startsWith('data-'))  return <DataPart part={part} />
      return null
  }
}
```

这个主结构在 [重构端到端 AI Chat](/21-practice-end-to-end) 里就是 AI 伴侣聊天窗口的骨架。

## 3. 文本与思考渲染

文本是最常见也最重要的 part。要做到「像打字机一样出现 + Markdown 格式一到位就立刻生效」，不能偷懒写 `<span>{part.text}</span>`。

推荐用 `react-markdown` + `remark-gfm` 做流式增量解析：

text-part.tsx

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function TextPart({ part }: { part: TextUIPart }) {
  return (
    <div className="prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {part.text}
      </ReactMarkdown>
      {part.state === 'streaming' && <Caret />}
    </div>
  )
}

function Caret() {
  return <span className="animate-pulse">▍</span>
}
```

几个关键点：

- `part.state === 'streaming'` 是区分「还在流」和「已完成」的标志，展示光标时用它

- `react-markdown` 每次都会全量重解析，流式场景下 CPU 开销较大。如果消息会很长，可以做节流（debounce）更新，或者换成 `@uiw/react-markdown-preview` 这类优化实现

- 代码块要有语法高亮，可以用 `rehype-highlight` 或 `shiki`。流式场景建议 `rehype-highlight`（便宜），或者 shiki 的 code-highlighter-html（一次性解析）

### 代码块内的复制按钮

生产里几乎都会给代码块加一个「复制」：

code-copy.tsx

```tsx
<ReactMarkdown
  components={{
    pre: ({ children }) => (
      <div className="code-block">
        <CopyButton content={extractCodeText(children)} />
        <pre>{children}</pre>
      </div>
    ),
  }}
>
  {part.text}
</ReactMarkdown>
```

### reasoning part：思考气泡

o1 / o3 / Claude thinking / DeepSeek R1 这些推理模型，会在生成最终回复前先流式吐一段「思考」。`reasoning` part 承载这段内容。

它通常不是用户想看的主内容，但能让产品有「AI 在认真想」的质感。典型的交互是默认折叠，用户点击展开：

reasoning-part.tsx

```tsx
function ReasoningPart({ part }: { part: ReasoningUIPart }) {
  const [expanded, setExpanded] = useState(false)
  const preview = part.text.slice(0, 40)
  const streaming = part.state === 'streaming'

  return (
    <details
      className={`reasoning ${streaming ? 'reasoning--streaming' : ''}`}
      open={expanded || streaming}
    >
      <summary onClick={() => setExpanded(!expanded)}>
        {streaming ? '正在思考…' : `思考了一会儿：${preview}…`}
      </summary>
      <pre className="reasoning-body">{part.text}</pre>
    </details>
  )
}
```

几个实战经验：

- 流式时默认展开，用户能看到思考过程，体验更生动

- 完成后自动折叠，避免占屏

- 点击交互用原生 `<details>` / `<summary>`，能省一个 state

## 4. tool part：工具调用卡片

工具调用的可视化，最能把「AI 能干活」这件事展示出来。tool part 的 type 是动态的（`tool-searchMemory` / `tool-updateEmotion` / ...），state 有四种：

| state | 含义 | UI 态 |
| --- | --- | --- |
| input-streaming | 参数正在流式构造 | 「准备中…」+ 闪烁 |
| input-available | 参数已就绪，但还没执行 | 「即将执行…」 |
| output-available | 工具已执行并返回 | 展示结果卡片 |
| output-error | 工具执行出错 | 展示错误 |

一个通用卡片组件：

tool-part.tsx

```tsx
function ToolPart({ part }: { part: ToolUIPart<string> }) {
  const toolName = part.type.slice('tool-'.length)

  return (
    <div className={`tool tool--${part.state}`}>
      <header>
        <Icon name={toolName} />
        <span>{displayName(toolName)}</span>
        <StateBadge state={part.state} />
      </header>

      {part.state === 'input-streaming' && (
        <div className="tool-input-streaming">
          <Shimmer />
          正在构造参数…
        </div>
      )}

      {part.state === 'input-available' && (
        <details>
          <summary>参数</summary>
          <pre>{JSON.stringify(part.input, null, 2)}</pre>
        </details>
      )}

      {part.state === 'output-available' && (
        <ToolOutputCard name={toolName} output={part.output} />
      )}

      {part.state === 'output-error' && (
        <div className="tool-error">
          执行出错：{part.errorText}
        </div>
      )}
    </div>
  )
}
```

然后针对每个工具做定制卡片（`ToolOutputCard`）：

tool-cards.tsx

```tsx
function ToolOutputCard({ name, output }: { name: string; output: unknown }) {
  switch (name) {
    case 'searchMemory':
      return <MemoryList memories={output as Memory[]} />
    case 'updateEmotion':
      return <EmotionIndicator emotion={(output as any).emotion} />
    case 'checkIntimacy':
      return <IntimacyBar value={(output as any).intimacy} />
    default:
      // 兜底：格式化 JSON
      return <pre>{JSON.stringify(output, null, 2)}</pre>
  }
}
```

这个模式让每个工具的结果都能以最合适的视觉形态呈现，而不是一堆 JSON。

## 5. source part：RAG 引用徽章

RAG 场景里，模型的回复往往基于若干文档。`source-url` 和 `source-document` 两种 part 表达「这段回复参考了这些来源」。

渲染策略：

source-part.tsx

```tsx
function SourceUrlPart({ part }: { part: SourceUrlUIPart }) {
  return (
    <a href={part.url} target="_blank" className="source-badge">
      <LinkIcon />
      <span>{part.title ?? new URL(part.url).hostname}</span>
    </a>
  )
}

function SourceDocPart({ part }: { part: SourceDocumentUIPart }) {
  return (
    <div className="source-badge">
      <FileIcon />
      <span>{part.title}</span>
      <small>{part.mediaType}</small>
    </div>
  )
}
```

设计上有两条经验：

- 源一般在消息底部成组显示，不是行内嵌入。可以在 `Message` 组件里把所有 source part 抽出来最后渲染

- 如果想做「脚注样式」（正文里带 `[1]` 链到底部来源），需要从 part 数组构造脚注编号 map，再用 Markdown 自定义渲染去替换

source-group.tsx

```tsx
function Message({ message }: { message: UIMessage }) {
  const sources = message.parts.filter((p) =>
    p.type === 'source-url' || p.type === 'source-document'
  )
  const nonSources = message.parts.filter((p) =>
    p.type !== 'source-url' && p.type !== 'source-document'
  )

  return (
    <div>
      {nonSources.map((p, i) => <Part key={i} part={p} />)}
      {sources.length > 0 && (
        <footer className="sources">
          <small>参考：</small>
          {sources.map((s, i) => <SourceBadge key={i} part={s} />)}
        </footer>
      )}
    </div>
  )
}
```

## 6. file 与 data part

LLM 可能主动输出图片（DALL-E 代出图）、音频（TTS）、甚至代码文件。`file` part 统一表达这些：

file-part.tsx

```tsx
function FilePart({ part }: { part: FileUIPart }) {
  if (part.mediaType.startsWith('image/')) {
    return <img src={part.url} alt={part.filename} className="file-image" />
  }

  if (part.mediaType.startsWith('audio/')) {
    return (
      <audio controls src={part.url}>
        {part.filename}
      </audio>
    )
  }

  if (part.mediaType.startsWith('video/')) {
    return <video controls src={part.url} />
  }

  // 其他文件，做成下载链接
  return (
    <a href={part.url} download={part.filename} className="file-download">
      📎 {part.filename ?? '下载文件'}
    </a>
  )
}
```

URL 可能是 `data:` URI（小文件）也可能是公网 URL（大文件存 R2/S3），两种都能直接给 `<img src>`。

### data part：业务自定义

data part 是 AI SDK 留给业务的扩展点。[UIMessageStream](/7-stream-text) 讲过后端怎么 write data part，这里讲前端怎么渲染。

AI 伴侣项目里的几个典型：

data-part.tsx

```tsx
function DataPart({ part }: { part: DataUIPart<any> }) {
  // part.type 形如 'data-emotion' / 'data-memories-used' / 'data-intimacy-delta'
  switch (part.type) {
    case 'data-emotion':
      return <EmotionBadge emotion={part.data.primary} intensity={part.data.intensity} />

    case 'data-memories-used':
      return <MemoriesHint count={part.data.count} />

    case 'data-intimacy-delta':
      return <IntimacyDeltaToast delta={part.data.delta} />

    default:
      return null // 未知 data part 静默忽略
  }
}
```

给 UIMessage 加一层类型约束，泛型写法让你在编辑器里就能看到 data part 的具体形状：

typed-ui-message.ts

```typescript
type CompanionData = {
  emotion: { primary: string; intensity: number }
  'memories-used': { count: number }
  'intimacy-delta': { delta: number }
}

type CompanionMessage = UIMessage<unknown, CompanionData>

const { messages } = useChat<CompanionMessage>({ transport: ... })
// messages[0].parts 里的 data-* part 现在有类型
```

## 7. step 分隔与组合演示

Agent 循环里有多个 step，用户能看到一次调用里好像调了几次工具、思考了几次、再输出文本。`step-start` part 出现在每个新 step 的开始，用它做一个视觉分隔：

step-divider.tsx

```tsx
function StepDivider() {
  return (
    <div className="step-divider">
      <span className="step-line" />
      <small className="step-label">继续分析</small>
      <span className="step-line" />
    </div>
  )
}
```

step-divider.css

```css
.step-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  opacity: 0.5;
}
.step-line {
  flex: 1;
  height: 1px;
  background: currentColor;
}
```

把上面所有组件组装起来，一条 AI 伴侣的 assistant 消息可能长这样：

example.txt

```text
┌─ 小舟 ─────────────────────────────────────────┐
│ [情绪标签 🙂 平静 · 0.6 ]                        │
│                                                │
│ ▾ 思考了一会儿：用户提到了周五的事，我应该…      │
│                                                │
│ ━━━ 继续分析 ━━━                                │
│                                                │
│ ┌ 🔍 searchMemory ▸ 已完成 ───────────┐         │
│ │ • 上周五你说工作压力大 (0.87)         │         │
│ │ • 周六去了公园走走 (0.42)            │         │
│ └──────────────────────────────────┘         │
│                                                │
│ 我记得你上周五说工作压力很大，今天的夕阳可以      │
│ 一起看看吗？▍                                  │
│                                                │
│ 参考：                                           │
│ [📄 2025-10-07 的对话]                          │
└────────────────────────────────────────────────┘
```

对应的 parts 数组：

parts-array.ts

```typescript
[
  { type: 'data-emotion',         data: { primary: 'calm', intensity: 0.6 } },
  { type: 'reasoning',            text: '用户提到了周五…', state: 'done' },
  { type: 'step-start' },
  { type: 'tool-searchMemory',    toolCallId: 'c1', state: 'output-available', output: [...] },
  { type: 'text',                 text: '我记得你上周五…', state: 'streaming' },
  { type: 'source-document',      sourceId: 's1', mediaType: 'application/json', title: '2025-10-07 的对话' },
]
```

这就是 UI Parts 的威力：一条消息里可以同时装下信息密度很高的多种内容，每种都按最合适的方式渲染。

## 8. 小结

- UIMessage.parts 是前端渲染的唯一数据源，按 `type` 分发给不同的渲染组件

- 文本 part 配合 Markdown + 光标做流式打字效果

- reasoning part 默认流式展开、完成后折叠

- tool part 四个 state（input-streaming / input-available / output-available / output-error）各有 UI，针对每个工具做定制卡片

- source part 一般在消息底部集中展示

- file part 根据 mediaType 渲染成图 / 音 / 视频 / 下载链接

- data part 是业务自定义扩展点，用泛型 `UIMessage<unknown, DATA>` 约束类型

- step-start part 做多 step Agent 的视觉分隔线

下一篇进入 **`useObject`**——结构化输出的流式 UI。表单、评分卡、报告这类场景的最佳实践。
