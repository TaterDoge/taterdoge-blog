---
title: "102 Zod 是什么"
pubDate: 2026-05-13
description: "假设你在写一个 AI 聊天接口，前端会把用户的输入 POST 过来，你在后端把它交给 LLM。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/1-what-is-zod/](https://aicompanion.usehook.cn/1-what-is-zod/)

1. 先从一个真实的坑说起
假设你在写一个 AI 聊天接口，前端会把用户的输入 POST 过来，你在后端把它交给 LLM。
最朴素的写法长这样：index.ts1app.post('/chat', async (c) => {
2  const body = await c.req.json()
3  const reply = await callLLM(body.prompt, body.temperature)
4  return c.json({ reply })
5})只要跑起来没报错，看上去很美好。但你只要上线一段时间，就会陆续撞上这些问题：
前端漏传 prompt，body.prompt 是 undefined，LLM 报错
前端把 temperature 传成了字符串 "0.7"，模型调用 SDK 直接抛错
某个客户端恶意传了一个 50 万字的 prompt，Token 账单瞬间爆掉
另一个前端把字段名打错成 promt，你排查了两小时
如果你是从前端转过来的，你可能会下意识地觉得：NOTE
「我写了 TypeScript 啊，body.prompt 类型不就是 string 吗？」
这是新手最常见的一个错觉。我们来把这层误会讲清楚。2. TypeScript 的类型在运行时是不存在的TypeScript 的类型只在编译时有效。代码一旦被编译成 JavaScript，所有类型信息会被完全抹掉。也就是说，你写的这段代码：index.ts1interface ChatBody {
2  prompt: string
3  temperature: number
4}
5
6app.post('/chat', async (c) => {
7  const body = await c.req.json() as ChatBody
8  // 这里 TypeScript 以为 body.prompt 是 string
9})只是在骗编辑器开心。实际运行时，c.req.json() 返回的是一个普通的 JS 对象，里面是什么字段、是什么类型，完全由 HTTP 请求决定。如果前端传了 { foo: 1 }，body.prompt 就是 undefined，body.temperature 同理。这里有一个新手一定要记住的结论：NOTE
TypeScript 负责的是「你写代码时看到的类型」，运行时请求进来的数据长什么样，TypeScript 一无所知。
所以，任何「从外部世界进来的数据」——HTTP 请求、localStorage、第三方 API、LLM 返回的 JSON——都需要一个运行时的守门员来检查它是不是真的符合你预期的结构。这个守门员，就是 Zod 要做的事。3. Zod 是什么一句话定义：NOTE
Zod 是一个用 TypeScript 写的 Schema 校验库，它让你用一份定义同时完成「运行时校验」和「静态类型推导」。
这句话有三个关键词，我们一个个拆开。3.1 Schema 是什么Schema 就是一份「数据规则说明书」。它描述的不是数据本身，而是「合格数据应该长什么样」。对应到前面的聊天接口，用 Zod 写 schema 大概是这样：index.ts1import { z } from 'zod'
2
3const ChatSchema = z.object({
4  prompt: z.string().min(1).max(4000),
5  temperature: z.number().min(0).max(2),
6})读起来几乎就是自然语言：
请求体应该是一个对象
prompt 必须是字符串，长度 1~4000
temperature 必须是数字，取值 0~2
3.2 运行时校验有了 schema，你就可以让它在运行时真的去检查数据：index.ts1const body = await c.req.json()
2const data = ChatSchema.parse(body)
3// 到这一行，data 里的字段一定符合 schema 描述
4// 否则 parse 会抛错，根本不会执行到这一行这和 TypeScript 不同。TypeScript 只能保证「你写代码时没写错」，Zod 保证「运行时进来的数据没错」。3.3 静态类型推导Zod 还做了一件让新手经常惊叹的事：schema 可以直接反推出 TypeScript 类型。index.ts1type ChatBody = z.infer<typeof ChatSchema>
2// 等价于：
3// type ChatBody = {
4//   prompt: string
5//   temperature: number
6// }你不再需要「手写一份 interface + 手写一份校验规则」这种重复劳动。一份 schema，一边给校验器用，一边给 TypeScript 用。这是 Zod 最核心的卖点。请你先把它记下来：NOTE
Schema 是单一真实来源（Single Source of Truth），校验和类型都从它派生。
2. 一个最小可运行的例子光说概念太虚，我们看一段最小可运行的例子。index.ts01import { z } from 'zod'
02
03// 1. 声明 schema
04const UserSchema = z.object({
05  name: z.string().min(1),
06  age: z.number().int().min(0),
07  email: z.string().email(),
08})
09
10// 2. 推导 TS 类型
11type User = z.infer<typeof UserSchema>
12
13// 3. 校验一个合法数据
14const ok = UserSchema.parse({
15  name: 'Alice',
16  age: 18,
17  email: '<alice@example.com>',
18})
19// ok 的类型是 User，且数据一定合法
20
21// 4. 校验一个非法数据
22try {
23  UserSchema.parse({
24    name: '',
25    age: -1,
26    email: 'not-an-email',
27  })
28} catch (err) {
29  // err 是 ZodError，里面有详细的错误信息
30  console.log(err)
31}你可以把它理解成：
没有 Zod 时，你得写一堆 if (!body.name || typeof body.name !== 'string') ...
有了 Zod，你只要声明「合格数据长什么样」，剩下交给它
3. 为什么 AI 项目特别需要 Zod在普通后端里，Zod 已经很香。到了 AI 项目，它的价值会再放大一层。因为 AI 项目里「不可信数据」特别多：
用户输入：prompt、上下文、工具参数
LLM 返回：模型输出的 JSON 经常缺字段、多字段、字段名大小写不对
工具调用：Agent 给工具传的参数，常常和你声明的 schema 对不上
环境变量：API Key、模型名、温度上限，这些运行时值只要一错全盘崩
RAG 检索元数据：向量库返回的 payload 结构可能在某次迁移后悄悄变了
这些地方都有一个共同特点：你以为是什么结构，和它实际是什么结构，经常不是一回事。Zod 在这些场景下的作用是：
在数据跨边界时统一加一道校验
从同一份 schema 生成 TypeScript 类型
校验失败能拿到结构化错误，方便记录日志、返回给前端
配合 transform 还能做类型安全的「脏数据清洗」
后面的章节会围绕这些场景一个个展开。你现在只需要记住：NOTE
AI 项目里的不可信数据远比传统后端多，Zod 不是锦上添花，而是刚需。
4. 和其他方案的对比为了给你一个更完整的心智模型，这里简单对比一下常见方案。你可能没听过 io-ts / Joi / Yup，没关系，这里只是让你看到 Zod 在 TS 生态中的坐标，不用深究每一个。手写校验Joi / Yupio-tsZod运行时校验✅✅✅✅自动推导 TS 类型❌有限✅✅错误信息可读性取决于自己写一般较弱很好TypeScript 一等支持无所谓一般强但心智重强且直观生态（Hono、RHF、LLM）无部分少最广学习曲线极低（但越写越痛）中陡平缓如果你不是为了维护老项目，新项目直接选 Zod 基本不会错。尤其是它和 Hono、React Hook Form、OpenAI Structured Output 的集成，都是官方或社区一等方案。7. 安装与版本说明index.bash1yarn add zod截至 2026-04，Zod v4 已稳定发布一段时间，但本专栏默认使用 Zod v3（项目依赖锁定在 ^3.24.1）的主流 API。v4 与 v3 大体兼容，主要差异（如 z.string().email() 改为顶层 z.email()、错误格式化 API 的变化等）会在后续专题里单独讲。你现在先把 v3 的心智打牢，之后迁到 v4 成本很小。安装完可以写一段最小代码验证一下：index.ts1import { z } from 'zod'
2
3const schema = z.string().min(3)
4console.log(schema.parse('hello'))     // 'hello'
5console.log(schema.safeParse('hello'))  // { success: true, data: 'hello' }
6console.log(schema.safeParse('a'))      // { success: false, error: ZodError }能跑通就说明安装没问题。8. 总结这一篇我们没有急着讲具体语法，而是先把三件事讲清楚：
运行时数据不可信：TypeScript 的类型在运行时是不存在的，外部数据必须有一道运行时校验
Zod 的定位：用一份 schema 同时完成「运行时校验」和「静态类型推导」，避免重复定义
AI 项目为什么更需要 Zod：用户输入、LLM 输出、工具调用、环境变量、RAG 元数据，这些边界点全都不可信
如果让你用一句话记住 Zod，可以是这样：NOTE
Zod 让 TypeScript 的类型不再「只停留在编译时」，而是一路延伸到运行时的每一个数据入口。
下一篇我们会专门展开「单一真实来源」这条原则，看看它在真实项目里是怎么把校验、类型、文档、接口契约串成一条链路的。
