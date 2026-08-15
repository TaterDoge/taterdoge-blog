---
title: "加餐篇 AI Native 时代的 UI 流水线：从 Figma Make 蒸馏到一键换肤"
pubDate: 2026-04-17
description: "从 Figma Make 到设计蒸馏 Skill，拆解 AI Native 时代如何把设计稿转化为可复用的 UI 生产流水线。"
tags: [AI编程, SDD, 企业级实战]
category: AI编程
draft: false
---
原文链接：[https://xiaobot.net/post/a4567dbd-6630-4c06-ae56-4cc04d9180f7](https://xiaobot.net/post/a4567dbd-6630-4c06-ae56-4cc04d9180f7)

## 一、设计交付物变了，但你还在用 2020 年的姿势接稿

先问一个扎心的问题：**2026 年了，你们团队接设计稿的流程，跟三年前有啥本质区别？**

大多数人的答案是——没啥区别。设计师丢一个 Figma 链接过来，前端点开，右边开着吸管取色、左边开着 VSCode 写 CSS，中间脑子里还得翻译"这个阴影是 4px 还是 6px"。

但实际上，交付物这两年已经悄悄换了一代：

- **2022**：Figma 设计稿 + 切图

- **2024**：Figma Dev Mode + 可复制的 CSS 片段

- **2026**：**Figma Make 直出可交付的 react + tailwind 代码**

注意最后这一行。Figma Make 吐出来的不再是"给你参考的样式片段"，而是**直接能跑起来的 React 组件**。这意味着一件事：**设计师的产出已经从"图"变成了"代码"**。

这件事意味着什么？意味着咱们前端过去擅长的那套——人肉扒稿、Token 化、写组件库——在 AI Native 范式下要重新洗牌了。

今天这篇，就聊聊在 Figma Make 这个新起点上，**蒸馏和换肤这两件老事怎么重做一遍**，以及旧项目怎么吃到这波红利。全程基于我最近跑通的一个真实流水线，代码都能复用。

---

## 二、新范式的起点：Figma Make 吐出来的是什么货？

先把这个起点讲清楚。

过去设计师发 Figma 链接给你，你看到的是图层 + 标注。Figma Make 不一样——它直接帮设计师生成一份**跑得起来的 React + Tailwind 工程**。举个例子，一个商品卡片可能长这样：

```
// Figma Make 生成的组件(近似样例)
export function ProductCard({ title, price, image, status }) {
return (
<div className="w-[109px] bg-white border border-[#EEEEEE] rounded-[3px] overflow-hidden">
<div className="relative">
<img src={image} className="w-[109px] h-[109px] object-cover bg-[#F7F7F7]" />
{status && (
<span className="absolute top-2 left-2 h-4 px-[5px] bg-[#03C3C7] text-white text-[10px] font-medium rounded-[3px]">
{status}
</span>
)}
</div>
<div className="p-2 pb-[10px]">
<p className="text-[12px] text-[#333] truncate">{title}</p>
<p className="mt-1 text-[#FF3D3D] font-bold" style={{ fontFamily: "'SF Pro Display'" }}>
<span className="text-[10px]">¥</span>
<span className="text-[15px]">{price}</span>
</p>
</div>
</div>
);
}
```

停一下，仔细看这段代码。你会发现几件有意思的事：

1. **颜色是硬编码的 hex**——#EEEEEE / #03C3C7 / #FF3D3D，不是 primary-500 之类的 Token

2. **尺寸是任意像素**——w-[109px]、h-[109px]、text-[12px]

3. **字体栈混着写**——中文跟数字字体混在 style 里

4. **没有语义**——#03C3C7 是"品牌色"还是"状态标签色"？代码不知道

**Figma Make 的产出是可运行的，但不是可复用的**。它只解决了"这一个页面能跑"，没解决"50 个页面共享一套体系"。

这就是咱们蒸馏要切入的口子。

---

## 三、蒸馏第一刀：从 N 份 Make 代码里抽出 design.md

新范式下，蒸馏的**输入**变了——不再是 UI 截图或 Figma 图层，而是**一堆 Figma Make 吐出来的 React + Tailwind 代码**。

这件事反而更好办。为什么？因为代码是结构化数据，比图层稳定一万倍。

具体流程长这样：

```
设计师用 Figma Make 生成 N 个页面(商品页/详情页/个人页...)
↓
把所有 Make 代码塞给 AI
↓
让 AI 识别"反复出现的视觉决策"
↓
蒸馏出 design.md(Token 表 + 组件规范)
↓
作为后续新页面的"设计规范源"
```

### 让 AI 蒸馏时，Prompt 怎么写最关键

Fly哥试过几十次 Prompt，最后收敛到三段式，给你直接抄：

```
const prompt = `
你是一个资深前端架构师。以下是设计师用 Figma Make 生成的 ${N} 个页面的 React + Tailwind 代码。
任务:
1. 识别反复出现的颜色,合并近似值(例如 #EEEEEE 和 #EEEEEF 视为同一个)
2. 给每个颜色打上语义标签(brand / price / divider / text-primary...)
3. 识别反复出现的圆角、字号、间距,收敛到有限档位
4. 识别存在几套并行的视觉语言(看主色、圆角、按压反馈的差异)
5. 输出 design.md,包含:
- 原子 Token(值)
- 语义 Token(用途)
- 组件级规范(可复制的参数表)
- 开发约束(白名单)
硬要求:
- 灰阶不超过 9 档
- 圆角不超过 4 档
- 禁止保留 #888 / #555 这种非白名单灰阶,强行归并到最近档位
`;
```

三个硬约束很关键：**不加约束，AI 会给你吐一份 47 种灰、18 种圆角的"规范"，等于没蒸馏**。咱们要的是收敛，不是全量描述。

### 蒸馏产物长什么样

跑完之后你会拿到一份类似这样的 design.md（我在娃衣手作项目里真实产出的片段）：

```
## B 套业务流程 · Token
### 原子层
- 灰阶(9 档): #000 / #333 / #666 / #999 / #BBB / #CCC / #EEE / #F7F7F7 / #FFF
- 主色: #03C3C7
- 价格红: #FF3D3D
- 在线绿: #00C800
### 语义层
- --brand: #03C3C7
- --price: #FF3D3D
- --text-primary: #000
- --text-regular: #333
- --text-muted: #666
- --divider: #EEE
- --page-bg: #F7F7F7
### 组件级: MiniCard(首页 109×109 商品卡)
width: 109
height: 109
background: var(--card-bg)
border: 1px solid var(--divider)
border-radius: 3
image: 109×109, object-fit: cover
status-tag: h16 / px5 / var(--brand) / white / 10px 500
price: ¥10/700 + number 15/700, SF Pro Display
```

这份 design.md 就是后续所有新页面的**设计规范源**。设计师再用 Figma Make 生成新页面时，把这份规范塞进 Prompt 一起喂给 Make——出来的代码就自动符合 Token 体系了。

这一刀砍下去，新项目的 UI 一致性问题基本解决了 80%。但旧项目呢？

---

## 四、旧项目的难题：一堆 Vue 代码怎么办？

讲到这里必然有人举手：“Fly哥，你讲的新项目起手 React 当然爽，但我们那堆老 Vue 代码怎么办？”

真实场景是这样的：

- 公司 10 个业务线，8 个在用 Vue

- 设计师全员拥抱 Figma Make，产出全是 React

- 每次加需求，前端得手动把 React 翻译成 Vue

人肉翻译一次还行，翻译 100 次就想辞职。**这里的关键破局点是：让 AI 把"翻译经验"也蒸馏成可复用的资产**。

流程是这样的：

```
设计师 Make 产出 React 代码
↓
人工/AI 把 React 翻译成 Vue(先跑几轮)
↓
收集翻译过程中的决策(class 怎么转、事件怎么转、组合式 API 怎么映射)
↓
跑到转换率 ≥ 90% 达标
↓
让 AI 把这些经验蒸馏成"转换代码 Skill"
↓
后续新页面: 调用 Figma MCP 拿 Make 数据 + 调用转换 Skill → 自动出 Vue 代码
```

这里出现了一个新概念——**“转换代码 Skill”**。它不是一份文档，是一份**可被 AI 反复调用的结构化知识**。

### "转换 Skill"里该存什么

仍然是三层结构，跟 Token 蒸馏异曲同工：

```
// 第 1 层: 语法级映射
const syntaxRules = {
'className=':          ':class=',
'onClick=':            '@click=',
'useState':            'ref',
'useEffect':           'watchEffect',
'props.xxx':           'props.xxx',   // 保持不变
'React.Fragment':      '<template>',
};
// 第 2 层: 模式级映射
const patternRules = {
'条件渲染 {x && <A />}':     'v-if="x"',
'列表渲染 arr.map(...)':      'v-for="item in arr"',
'受控输入 value + onChange':  'v-model',
};
// 第 3 层: 工程级约定
const conventions = {
'Tailwind class':            '保留原样,直接复用',
'style 内联 hex':            '统一替换为 var(--xxx)',
'数字字体 fontFamily':       '保留 SF Pro Display',
'onMouseDown/Up 交互反馈':   '改用 @pointerdown/pointerup',
};
```

这份 Skill 一旦沉淀下来，每次新需求的流程就变了：

```
// 旧流程:人肉翻译,3 小时/页
1. 看 React 代码
2. 打开 Vue 项目
3. 逐行翻译
4. 调试
// 新流程:AI 吃 Skill,3 分钟/页
const makeCode  = await figmaMcp.fetchComponent(nodeId);
const vueCode   = await ai.convert(makeCode, { skill: 'react-to-vue' });
const finalCode = applyTokens(vueCode, designTokens);
```

整条链跑通之后，旧项目也能吃到 Figma Make 的红利，而且**每转一个页面，Skill 就变强一点**（你可以把 Skill 当成一个持续长大的模型）。

这件事最爽的地方在于：**蒸馏不只是做一次，而是做成一条流水线**。规范会更新、Skill 会迭代、新老项目共享同一份 Token，换肤变成一行配置——这才是 AI Native 范式的威力。

---

## 五、把蒸馏产物接到换肤架构上

蒸馏讲完，回到老问题：怎么换肤？

答案其实比以前简单——**因为 Figma Make 吐的就是 Tailwind 代码，而 Tailwind 天生适合跟 CSS Variables 联动**。

### 第一步：把 Make 产出里的 hex 改成 Token

Figma Make 默认产出是硬编码的：

```
<div className="bg-[#03C3C7] text-white">
```

蒸馏之后，AI 帮你把所有硬编码替换成 Token 引用：

```
<div className="bg-[var(--brand)] text-[color:var(--brand-fg)]">
```

这一步可以自动化：扫 Make 代码里的所有 #[hex]，对照 Token 表映射。典型的正则加查表操作：

```
function replaceHexWithToken(code, tokenMap) {
return code.replace(/#([0-9a-fA-F]{6})/g, (match) => {
const token = tokenMap[match.toLowerCase()];
if (!token) {
console.warn(`[tokenize] 未登记的颜色: ${match}`);
return match;
}
return `var(${token})`;
});
}
const tokenMap = {
'#03c3c7': '--brand',
'#ff3d3d': '--price',
'#eeeeee': '--divider',
'#f7f7f7': '--page-bg',
// ...
};
```

跑完一遍，整个项目就"可换肤"了。

### 第二步：写主题表

一个主题就是一份 CSS Variable 的集合：

```
// themes.ts
export const themeDefault = {
'--brand':       '#03C3C7',
'--brand-fg':    '#FFFFFF',
'--price':       '#FF3D3D',
'--divider':     '#EEEEEE',
'--page-bg':     '#F7F7F7',
'--radius-base': '3px',
'--press-mode':  'opacity',
};
export const themeSpringFestival = {
'--brand':       '#D4332B',     // 节日红
'--brand-fg':    '#FFF7E6',
'--price':       '#D4332B',
'--divider':     '#F5E8D0',
'--page-bg':     '#FFF8ED',
'--radius-base': '6px',
'--press-mode':  'scale',
};
export const themeDark = {
'--brand':       '#2DDADE',
'--brand-fg':    '#0B0B0B',
'--price':       '#FF5B5B',
'--divider':     '#2A2A2A',
'--page-bg':     '#121212',
'--radius-base': '3px',
'--press-mode':  'opacity',
};
```

### 第三步：挂到根节点

```
function ThemeProvider({ theme, children }) {
const ref = useRef(null);
useEffect(() => {
const el = ref.current;
if (!el) return;
Object.entries(theme).forEach(([k, v]) => el.style.setProperty(k, v));
}, [theme]);
return <div ref={ref} style={{ minHeight: '100vh' }}>{children}</div>;
}
```

完事。

你看明白了吗？**蒸馏是苦力活，换肤反而是三行代码**。所有的难都压在前面的识别、归并、映射这一环。一旦蒸馏这步做透了，换肤永远是最后一公里的轻活。

---

## 六、把整条流水线串起来：Figma MCP + Skill + Token

讲到这儿，把所有零件装成整机看一下。

新项目的完整流水线（推荐 React）：

```
设计师在 Figma Make 里设计
↓
Figma MCP 暴露 Make 产物
↓
AI 拉取 Make 代码 + 注入 design.md 规范
↓
AI 产出符合 Token 体系的 React + Tailwind 代码
↓
自动套 ThemeProvider,支持多主题
↓
前端 Review 合入
```

旧项目的完整流水线（Vue 场景）：

```
设计师在 Figma Make 里设计(产出 React)
↓
Figma MCP 暴露 Make 产物
↓
AI 调用"react-to-vue 转换 Skill"
↓
AI 再调用 design.md,把 hex 替换成 Token
↓
产出符合 Token 体系的 Vue 代码
↓
前端 Review 合入
```

两条链的**差异只在中间那个转换节点**，前后端完全对齐。这就是为什么前面强烈建议**新项目直接用 React**——不是 React 天生好，而是**它跟设计师的产出链路最短**，少一个转换节点就少一处掉链子的地方。

如果你现在还在纠结"公司技术栈是 Vue，要不要切 React"，我的建议很直接：

- 新项目直接 React，吃满 Figma Make → 代码的零损耗红利

- 老 Vue 项目别重写，沉淀转换 Skill，让 AI 帮你翻译

- 新老项目共享同一份 design.md，换肤、主题、深色模式一次搞定

---

## 七、几个一定会踩的坑，提前告诉你

这条流水线我跑通到现在，踩过几个坑，一次性给你说完。

### 坑一：Figma Make 产出质量不稳定

同一个设计，跑两次 Make 可能出两版命名、两种结构的代码。解决方案：**让 Make 也吃 design.md**。把你的规范（组件命名、事件命名、Tailwind class 白名单）作为 prompt 传进去，稳定性能从 60% 拉到 85%。

### 坑二：Tailwind 任意值 w-[109px] 污染项目

Make 特别喜欢吐 w-[109px] text-[12px] 这种任意值。虽然能跑，但破坏了你 tailwind.config.js 里精心设计的 scale。

兜底方案：**ESLint 规则禁止业务代码里出现 -[数字px]**。蒸馏阶段就让 AI 把任意值归并到最近的 scale 档位。实在归不了的（比如某些奇怪的设计需求），单独 allow-list 放行。

### 坑三：转换 Skill 会过拟合

刚开始转 10 个页面可能 95% 准确率，转到第 50 个突然崩了——因为 Skill 被早期样本过拟合，遇到新模式就懵。

解决方案：**Skill 按场景分片**。表单类一个 Skill、列表类一个 Skill、详情类一个 Skill，各自独立迭代。别想着用一个 Skill 一把梭。

### 坑四：设计师和前端对 Token 的理解不对齐

这是最隐蔽的坑。设计师眼里的 primary 可能是"品牌色"，前端眼里的 primary 可能是"主按钮底色"。蒸馏产物再完美，两边对不齐也白搭。

解决方案：**design.md 的语义层必须由设计师和前端一起 review**。别 AI 跑完就合入，花 30 分钟对一次齐，后面省一年撕逼。

---

## 八、收尾：蒸馏这件事的底层变化

写到这里，Fly哥想说一句可能有点扎耳朵的话——

**过去三年，前端的活在被 AI 重新定义。**

以前我们拼的是"扒稿子快不快"“CSS 写得精不精”，现在拼的是：

- 你能不能识别视觉体系的骨架

- 你能不能把规范写成 AI 能吃的结构化文档

- 你能不能把团队的翻译经验沉淀成 Skill

- 你能不能把 Figma MCP、Make、Skill、Token 串成一条流水线

这些事，AI 干不了，但它们是让 AI 真正帮你干活的**前置条件**。你做得越扎实，AI 帮你省的力气越多。

换肤只是这条流水线的末端福利——蒸馏做透了，换肤、深色模式、多品牌输出、节日皮肤，全是三行代码的事。
