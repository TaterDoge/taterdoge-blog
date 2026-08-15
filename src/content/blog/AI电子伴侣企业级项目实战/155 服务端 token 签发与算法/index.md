---
title: "155 服务端 token 签发与算法"
pubDate: 2026-05-30
description: "大多数业务系统里的 access token，走的是 JWS。payload 能看到，服务端靠签名判断内容有没有被改过。"
tags: [AI编程, Agent, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
---
原文链接：[https://aicompanion.usehook.cn/20-token-signing/](https://aicompanion.usehook.cn/20-token-signing/)

## 1. 先把几个词分开

一聊 token，这几个词很容易搅在一起：

- 编码

- 哈希

- 签名

- 加密

- JWT

- access token

- refresh token

先把边界立住，后面就不容易乱。

JWT 这个词，工程里经常同时指两类东西：

- **JWS**：签名后的 token

- **JWE**：加密后的 token

大多数业务系统里的 access token，走的是 JWS。payload 能看到，服务端靠签名判断内容有没有被改过。

JWE 走的是另一条路。payload 看不到，服务端要先解密，拿到明文后再继续处理。

refresh token 通常又是第三种东西。它很多时候既不是 JWS，也不是 JWE，而是一枚高熵随机字符串。

这 3 类东西长得都像 token，服务端处理方式差别很大。

## 2. access token 是怎么生成的

先看理论，再看代码。

服务端生成 access token，本质上是在做一件事：

**把一条已经确认过的登录状态，压成一份后面能快速校验的凭证。**

这里最重要的不是「生成一个字符串」，而是这张票以后怎么被用。

顺着登录流程看，access token 的生成逻辑大致就是：

- 用户登录成功

- 服务端确认身份没问题

- 服务端创建 session

- 服务端决定这张 token 代表谁、属于哪个 session、给哪个子站用

- 服务端决定这张 token 活多久

- 服务端选好签名算法和密钥

- 服务端把这些信息签成一张 JWS

所以 access token 的生成，不是孤立动作，它是登录链路里的最后一步收口。

如果再往里拆，服务端其实是在同时决定 4 件事：

- **身份**：这张票代表谁

- **边界**：这张票能在哪个子站使用

- **时效**：这张票什么时候过期

- **可信度**：服务端后面怎么证明它没被改过

前 3 件事决定 payload 里放什么，最后一件事决定你要用什么算法和密钥来签。

### payload 该放什么

最常见的 JWT 长这样：

index.txt

```txt
xxxxx.yyyyy.zzzzz
```

三段分别是 Header、Payload、Signature。

Header 常见长这样：

index.json

```json
{
  "alg": "HS256",
  "typ": "JWT",
  "kid": "access-hs256-v1"
}
```

Payload 常见长这样：

index.json

```json
{
  "sub": "user_123",
  "sid": "session_123",
  "app": "web",
  "roles": ["web_user"],
  "iss": "keepzml-api",
  "aud": "web",
  "jti": "token_123",
  "iat": 1710000000,
  "exp": 1710000900
}
```

这里面的字段都带着明确用途。

- `sub`：这个 token 属于谁

- `sid`：它挂在哪条 session 上

- `app`：它属于哪个子站

- `roles`：后面权限判断要不要用到

- `iss`：谁签的

- `aud`：给谁用的

- `jti`：这张票自己的 id

- `iat` / `exp`：签发时间和过期时间

- `kid`：当前用的是哪把 key，后面轮换密钥时会用到

payload 的原则很简单：

**只放后续恢复身份必须用到的最小信息。**

这些东西别塞进去：

- 明文密码

- refresh token 明文

- 银行卡号、身份证号这类高敏感数据

- 用户完整资料

- 很大的权限树

- 临时请求上下文

还有一个很容易搞错的点：

**JWS 里的 Header 和 Payload 默认只是 base64url 编码。**

也就是说，别人拿到 token，通常能把前两段解出来看。JWS 在认证场景里最常见的价值，是让服务端知道内容有没有被改过。

### 代码里怎么实现

把前面的理论落到代码里，做的事情就清楚很多了：先准备好 payload，再准备好算法和密钥，最后签出来。

如果用 `jose` 来写，一版常见代码大概这样：

apps/api/src/modules/auth/issue-access-token.ts

```typescript
import { SignJWT } from 'jose'

const accessSecret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET)

interface IssueAccessTokenParams {
  userId: string
  sessionId: string
  application: 'web' | 'admin'
  roles: string[]
}

export const issueAccessToken = async (params: IssueAccessTokenParams) => {
  return new SignJWT({
    sid: params.sessionId,
    app: params.application,
    roles: params.roles,
  })
    .setProtectedHeader({
      alg: 'HS256',
      typ: 'JWT',
      kid: 'access-hs256-v1',
    })
    .setSubject(params.userId)
    .setIssuer('keepzml-api')
    .setAudience(params.application)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(accessSecret)
}
```

这段代码对应的动作其实很直接：

- 用 `SignJWT` 组 payload

- 用 `setProtectedHeader()` 声明算法和 key id

- 用 `setSubject()`、`setIssuer()`、`setAudience()` 补标准声明

- 用 `setIssuedAt()` 和 `setExpirationTime()` 控制时效

- 最后用 `.sign(accessSecret)` 把它签出来

所以真正要看的，不是 `.sign()` 这一行本身，而是它前面已经把什么信息定死了：

- 用哪把密钥签

- 用什么算法签

- payload 里放什么

- 这张票活多久

这几件事定偏了，后面整条认证链路都会歪。

## 3. token 加密和解密原理

签名和加密是两条路。

签名的重点是「防篡改」，加密的重点是「看不懂」。

### JWE 长什么样

JWE 的 compact 形态有 5 段：

index.txt

```txt
header.encryptedKey.iv.ciphertext.tag
```

几段东西各干各的：

- `header`：说明这次怎么加密，比如 `alg`、`enc`

- `encryptedKey`：内容密钥如果还包了一层，就放这里

- `iv`：初始化向量

- `ciphertext`：真正的密文

- `tag`：认证标签，用来校验密文和附加数据有没有被改过

### 加密时到底发生了什么

拿一个最容易理解的例子，`alg=dir`，`enc=A256GCM`。

- `alg=dir` 表示直接用现成的对称密钥，不再额外包一层内容密钥

- `enc=A256GCM` 表示真正加密 payload 时，用的是 AES-GCM

顺着这条路看，加密动作大概就是：

- 服务端准备好 payload

- 服务端准备好一把对称密钥

- 运行时生成一段随机 `iv`

- 用 AES-GCM 把 payload 加密成 `ciphertext`

- 同时生成 `tag`

- 最后把 `header`、`iv`、`ciphertext`、`tag` 这些东西拼成 JWE

如果 `alg` 换成 `RSA-OAEP` 或 `ECDH-ES`，中间还会多一步：先把内容加密要用到的 key 包起来，或者推导出来，再去加密 payload。

### 解密时到底发生了什么

解密就是把前面的步骤反过来。

- 服务端拿到 JWE

- 先读 `header`

- 根据 `alg` 和 `enc` 决定怎么处理

- 恢复出真正用于解 payload 的 key

- 拿 `iv`、`ciphertext`、`tag` 去做 AES-GCM 解密

- `tag` 校验通过，才能拿到 payload

- 再继续检查 `iss`、`aud`、`exp` 这些声明

这里要注意一个细节：

**解密成功，只能说明密文能被正确打开。业务上能不能信，还得继续验声明。**

### 用 jose 写 JWE，大概是什么样

如果真的要做加密 token，一版常见代码可以写成这样：

apps/api/src/modules/auth/issue-encrypted-token.ts

```typescript
import { EncryptJWT, jwtDecrypt } from 'jose'

const encryptionKey = new TextEncoder().encode(process.env.JWT_ENCRYPTION_KEY)

export const issueEncryptedToken = async (payload: Record<string, unknown>) => {
  return new EncryptJWT(payload)
    .setProtectedHeader({
      alg: 'dir',
      enc: 'A256GCM',
      typ: 'JWT',
    })
    .setIssuer('keepzml-api')
    .setAudience('web')
    .setIssuedAt()
    .setExpirationTime('15m')
    .encrypt(encryptionKey)
}

export const decryptToken = async (token: string) => {
  const { payload, protectedHeader } = await jwtDecrypt(token, encryptionKey, {
    issuer: 'keepzml-api',
    audience: 'web',
  })

  return { payload, protectedHeader }
}
```

这段代码看起来比 JWS 多不了多少，背后语义已经换了：

- `SignJWT` / `jwtVerify` 处理的是签名 token

- `EncryptJWT` / `jwtDecrypt` 处理的是加密 token

### 为什么大多数 access token 不走加密路线

原因不复杂。

- 每次请求都要先解密，再继续处理，逻辑会变得复杂

- 密钥分发和管理会更重

- 很多中间件场景，只需要快速恢复身份，并不需要把 payload 整段藏起来

所以业务系统里，access token 常见组合还是 JWS。确实有密文需求时，再上 JWE。

## 4. 哈希、签名、HS256、RS256、ES256 到底差在哪

哈希、签名、加密已经分开了，下面再看签名算法这层。

先把哈希和签名理清楚。

**哈希** 会把任意长度输入变成固定长度摘要。

index.txt

```txt
sha256("hello") = 2cf24dba5fb0a...
```

它的特点很稳定：同样输入总是同样输出，输入改一点结果会变很多，不能从结果反推出原文。

它常见用途也很固定：

- 存密码摘要

- 存 refresh token 摘要

- 做完整性校验

**签名** 会把「数据 + 密钥」一起卷进去，产出一段可校验结果。重点在真实性和完整性。

所以 `HS256`、`RS256`、`ES256` 说的都是签名方案，不是普通哈希。

| 算法 | 本质 | 密钥类型 | 典型特点 |
| --- | --- | --- | --- |
| HS256 | HMAC + SHA-256 | 对称密钥 | 实现简单，签名和验签都用同一把密钥 |
| RS256 | RSA + SHA-256 | 非对称密钥 | 私钥签名，公钥验签，多服务验签更方便 |
| ES256 | ECDSA P-256 + SHA-256 | 非对称密钥 | 私钥签名，公钥验签，密钥和签名通常更小 |

**HS256** 用的是对称密钥。签名用这把钥匙，验签也用这把钥匙。实现很直接，性能通常也不错，单体应用或者少量内部服务里很常见。

它最大的边界也很明显：

**谁能验签，谁通常也就能签名。**

**RS256** 用的是 RSA 非对称密钥。私钥签名，公钥验签。这样签发权可以只留在认证服务手里，别的服务只拿公钥验签，不碰私钥。

它很适合：

- 多个服务都要验签

- 想把签发权收得更紧

- 后面可能对接外部系统

**ES256** 也是非对称方案，只不过底层从 RSA 换成了椭圆曲线 ECDSA。常见特点就是密钥更小，签名结果通常更短，也是私钥签名、公钥验签。

工程上怎么选，先按这条线理解就够了：

- 单服务、结构简单：`HS256` 很常见

- 多服务验签、想把签发权和验签权分开：`RS256` 更常见

- 已经明确采用椭圆曲线体系：再考虑 `ES256`

这里还要补一句。很多人看到 `HS256` 里的 `SHA-256`，就会误以为它只是把 payload 做了一次 SHA-256 哈希。其实不是。

`HS256` 的本质是 **HMAC-SHA-256**。它会把密钥也卷进去，所以才能用于签名校验。

## 5. 代码里用什么库，为什么用它

这篇代码里其实用了两套东西：

- `jose`

- Web Crypto API，也就是 `crypto.subtle`、`crypto.getRandomValues()` 这一套

### 为什么签名、验签、加密、解密用 jose

原因很直接，`jose` 刚好把这条链路上要用到的能力放在一套 API 里了：

- `SignJWT`：签 JWS

- `jwtVerify`：验 JWS

- `EncryptJWT`：产出 JWE

- `jwtDecrypt`：解 JWE

- `importJWK`、`exportJWK`：管 key

放到当前项目上下文里，它有几个实际好处：

- API 比较统一，JWS 和 JWE 都能覆盖

- 支持 `kid`、`iss`、`aud` 这些常用声明和校验

- 跟 Web Crypto 很贴近，Cloudflare Workers、Edge Runtime 这类环境里更顺手

- ESM 友好，不用为了老式 Node 用法额外绕一圈

如果只做最基本的 JWS，别的库也能写。这里更适合 `jose`，原因主要就在：**签名、验签、加密、解密、key 管理这几件事，它能一套收口。**

### 为什么 refresh token 摘要和随机数用 Web Crypto API

refresh token 这块真正要用到的能力其实很少：

- 生成高熵随机数

- 算摘要

- 有需要的话再做 HMAC

这些能力运行时本身就有，直接用就够了：

- `crypto.getRandomValues()` 生成随机字节

- `crypto.subtle.digest()` 计算 SHA-256

- `crypto.subtle.sign()` 可以做 HMAC

这样做有几个直接好处：

- 不用额外装一层纯工具库

- 跟运行时原生能力对齐

- Node、Workers、Edge 这类现代环境思路一致

- 对 refresh token 这种场景，能力刚好够用

所以这篇里库的分工很清楚：

- JWT 相关能力交给 `jose`

- 随机数、哈希、HMAC 交给 Web Crypto API

## 6. refresh token 为什么常做成随机串 + hash

access token 常做成带签名的 JWT，refresh token 往往不是这条路。

服务端更常见的处理方式是：生成一枚高熵随机字符串，把明文给客户端，服务端自己只存 hash，等 refresh 时再拿客户端带回来的明文做 hash 比对。

常见实现大概这样：

apps/api/src/modules/auth/issue-refresh-token.ts

```typescript
const sha256Hex = async (value: string) => {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)

  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('')
}

const generateRefreshToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))

  return Array.from(bytes)
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('')
}

export const issueRefreshToken = async (sessionId: string) => {
  const token = generateRefreshToken()
  const tokenHash = await sha256Hex(token)

  await db.insert(refreshTokens).values({
    sessionId,
    jtiHash: tokenHash,
    expiresAtMs: Date.now() + 1000 * 60 * 60 * 24 * 14,
  })

  return token
}
```

这里的重点不是「为什么不用 JWT」，而是 refresh token 的目标本来就和 access token 不一样。它关心的是 rotation、revoke、replay 检测、session 级控制，这些能力都很依赖服务端状态。

### 为什么服务端通常只存 hash，不存明文

因为 refresh token 是长期凭证。

数据库一旦泄漏：

- 存明文，攻击者拿到就能直接走 refresh

- 只存 hash，攻击者拿不到原始 token，没法直接拿去用

它和密码摘要的思路很像：服务端不需要反推出原文，只需要做比对。既然只要比对，就没必要留明文。

### 为什么这里通常不用 bcrypt / argon2

因为 refresh token 不是用户自己输入的弱口令，它通常是服务端生成的高熵随机值。

高熵随机 token 和人类密码，威胁模型不一样。对 refresh token 来说，直接做 `SHA-256` 或 `HMAC-SHA-256` 这类摘要，本来就是很常见的做法。

如果还想再加一层服务器侧秘密，可以把「直接 hash」换成「带 secret 的 HMAC」。思路还是一样：客户端拿明文，服务端不留明文，服务端只留可比对摘要。

## 7. 总结

放到当前这套认证设计里，顺手的一套组合可以直接这样理解：

- access token：服务端签成 JWS，给业务请求做快速鉴权

- 真有密文需求：再单独上 JWE

- refresh token：服务端生成随机串，客户端拿明文，服务端只存 hash

- `jose`：管 JWS / JWE / key 相关能力

- Web Crypto API：管随机数、哈希、HMAC

密钥这块，遵循以下原则，后面会省很多麻烦：

- access token 签名 key、加密 key、refresh token 摘要 secret 分开

- 不同环境不要共用同一套 key

- key 不要写死进仓库，放进 Worker Secrets 或环境变量

- JWS / JWE 的 header 最好带 `kid`，给后续轮换留口子

- 日志里不要打印完整 token，更不要打印 key

- payload 只放最小必要信息，不要把敏感数据塞进 token
