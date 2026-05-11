# SIWE 协议说明

本文档聚焦 SIWE，也就是 Sign-In with Ethereum（EIP-4361）本身。

目标有三个：

- 把 SIWE 标准消息的字段和语义讲清楚。
- 说明钱包插件在 SIWE 签名时应该展示什么、校验什么、提示什么。
- 讲清楚 SIWE 与 ReCap、UCAN 的边界，避免把认证和授权混在一起。

如果只用一句话概括：

- SIWE 解决“是谁在登录、当前站点是谁、这次登录声明何时生效和失效”。
- UCAN 解决“登录之后，被授予了哪些能力，这些能力可否继续收缩并发给具体服务”。

## 阅读导航

- 当前文档：SIWE 标准、钱包展示与风险提示、与授权协议的边界。
- 建议下一步阅读：[UCAN协议说明.md](./UCAN协议说明.md)。
- DApp 集成方式参考：[DApp接入手册.md](./DApp接入手册.md)。

## 约定示例

为了和 UCAN 文档保持一致，本文统一使用以下示例角色：

- DApp 域名：`chat.example.com`
- DApp 标识：`chat-example`
- 模型服务 DID：`did:web:router.example.com`
- 存储服务 DID：`did:web:webdav.example.com`

## 1. 什么是 SIWE

SIWE 是 EIP-4361 定义的“以太坊登录消息格式”。它允许一个以太坊地址对一段标准化文本签名，用于向服务端声明：

- 我控制这个地址
- 我正在以这个地址登录某个站点
- 这次登录消息对应哪个域名、哪个 URI、哪个时间窗口
- 这次登录消息是否附带额外资源引用

这里最重要的一点是：

- SIWE 是登录声明，不是通用授权协议

也就是说，SIWE 的核心职责是认证，不是能力委托。

## 2. SIWE 解决什么，不解决什么

### 2.1 SIWE 解决什么

SIWE 主要解决：

- 地址所有权证明
- 域名绑定
- 防重放
- 登录时间窗口控制
- 给服务端建立业务会话提供可靠输入

更具体地说，当服务端收到一份 SIWE 消息和签名后，它通常会验证：

1. 这份消息是不是被该地址签的
2. `domain` 是否符合当前站点
3. `nonce` 是否有效且未被重放
4. `issuedAt`、`expirationTime`、`notBefore` 是否合理

### 2.2 SIWE 不解决什么

SIWE 不直接解决：

- 某个 DApp 可以访问哪些后端服务
- 某个 DApp 可以写哪些资源、读哪些资源
- 一个请求令牌是否只能发给某个具体服务
- 授权链是否发生了能力衰减

这些问题已经超出 EIP-4361 本体，更适合由：

- ReCap 承载授权意图摘要
- UCAN 承载能力委托和请求级授权

这条边界要明确，否则就会把“登录声明”和“授权令牌”混成一个东西。

## 3. SIWE 与 ReCap、UCAN 的关系

这是当前钱包场景里最容易混淆的地方。

### 3.1 SIWE 与 UCAN 的边界

推荐这样理解：

- SIWE 回答“谁在登录”
- UCAN 回答“允许做什么”

因此一个更清晰的分层是：

1. 先用 SIWE 建立身份上下文
2. 再用 UCAN 表达能力集合、委托关系和请求级收缩

在当前钱包插件模型里，用户看到的一次授权确认，可能同时包含：

- SIWE 的登录语义
- ReCap 或结构化摘要表达的授权意图
- 后续 UCAN 所要承接的能力集合

但不要因此误以为：

- SIWE 本身已经替代了 UCAN

它们仍然是两层机制。

### 3.2 ReCap 在这里扮演什么角色

ReCap 可以理解成：

- 在 SIWE 语境里承载“能力摘要”的一种扩展方式

它的作用更像：

- 让用户在 SIWE 确认页里同步看见授权意图

而不是：

- 用 ReCap 直接替代后续完整的请求级授权协议

因此一个合理分工是：

- SIWE：确认身份和登录上下文
- ReCap：在登录消息中附带可展示的能力摘要
- UCAN：在登录之后真正承载能力委托和请求级令牌

## 4. SIWE 标准消息结构

EIP-4361 定义的 SIWE 消息有一套标准结构。核心组成如下：

1. 第一行：`<domain> wants you to sign in with your Ethereum account:`
2. 第二行：地址
3. 空行
4. `statement`，可选
5. 空行
6. 一组结构化字段

常见字段包括：

- `URI`
- `Version`
- `Chain ID`
- `Nonce`
- `Issued At`
- `Expiration Time`
- `Not Before`
- `Request ID`
- `Resources`

其中：

- `statement` 是人类可读文本，用来说明本次登录意图
- `Resources` 是资源 URI 列表，每一行是 `- <uri>`

## 5. 字段逐项说明

### 5.1 `domain`

`domain` 是第一行中的站点标识。

示例：

```text
chat.example.com wants you to sign in with your Ethereum account:
```

它告诉用户：

- 当前是谁在请求登录

它也告诉服务端：

- 这份登录消息声明的目标域名是什么

因此，`domain` 应与当前页面来源一致，至少不能让用户明显误解。

### 5.2 地址

第二行是以太坊地址，例如：

```text
0x1234...
```

它表示：

- 用户要以哪个地址完成本次登录声明

服务端最终会结合签名结果验证：

- 这份消息是不是由这个地址控制者签出的

### 5.3 `statement`

`statement` 是可选的人类可读说明。

它的作用不是替代结构化字段，而是告诉用户：

- 这次登录大致是为了什么

示例：

```text
Sign in to Chat and review requested access
```

如果要结合 ReCap 或授权摘要，`statement` 很适合承担：

- 概括说明
- 给用户提供高层语义

但不建议把过于复杂的机器结构直接塞进 `statement` 正文里。

### 5.4 `URI`

`URI` 表示本次登录关联的资源标识，通常是当前应用地址。

示例：

```text
URI: https://chat.example.com
```

钱包和服务端通常会把它与：

- 当前页面来源
- `domain`

一起对照检查。

### 5.5 `Version`

示例：

```text
Version: 1
```

对 EIP-4361 来说，当前常见值就是 `1`。

### 5.6 `Chain ID`

示例：

```text
Chain ID: 1
```

它表示：

- 本次登录消息所声明的链上下文

这有助于避免不同链上下文之间的歧义。

### 5.7 `Nonce`

示例：

```text
Nonce: 9f6d0d2f8a6c4bb1
```

`nonce` 的职责是防重放。

服务端至少应保证：

- `nonce` 由服务端生成或强校验
- 一次使用后不能再次接受

这是 SIWE 安全性里非常关键的一项。

### 5.8 `Issued At`

示例：

```text
Issued At: 2026-05-04T06:00:00.000Z
```

表示这条登录声明的签发时间。

服务端通常会校验：

- 时间格式正确
- 不明显晚于当前时间

### 5.9 `Expiration Time`

示例：

```text
Expiration Time: 2026-05-05T06:00:00.000Z
```

表示这份登录声明到什么时候失效。

如果超时，服务端应拒绝把它当作有效登录输入。

### 5.10 `Not Before`

示例：

```text
Not Before: 2026-05-04T06:00:00.000Z
```

表示这份消息在某个时间点之前还不能生效。

这适合处理：

- 延迟生效
- 时间窗口控制

### 5.11 `Request ID`

`Request ID` 是可选字段，用于给当前请求附加一个业务标识。

它可以帮助服务端做：

- 审计
- 幂等
- 请求关联

### 5.12 `Resources`

`Resources` 是可选字段，每一行都是一个 URI。

示例：

```text
Resources:
- urn:recap:...
```

这里很重要的一点是：

- `Resources` 本身只是资源引用列表
- 它并不自动等于“请求已经获得这些资源的访问权限”

如果 `Resources` 中包含 `urn:recap:`，钱包可以把它解析成授权摘要展示给用户，但真正的能力控制仍应由后续授权协议来承接。

## 6. 钱包当前实现里的展示与解析

当前钱包审批页会自动识别 SIWE 消息，并结构化展示以下信息：

- `domain`
- 地址
- `URI`
- `Version`
- `Chain ID`
- `Nonce`
- `Issued At`
- `Expiration Time`
- `Not Before`
- `Request ID`
- `Resources`

如果 `Resources` 中包含 `urn:recap:`，钱包还会进一步解析能力摘要，并展示：

- 能力范围
- 操作类型
- 影响说明

对应代码：

- SIWE 解析：[js/app/approval.js](/Users/liuxin2/Workspace/opensource/wallet/js/app/approval.js)
- 请求路由：[js/background/request-router.js](/Users/liuxin2/Workspace/opensource/wallet/js/background/request-router.js)

## 7. 钱包风险提示应该关注什么

钱包在展示 SIWE 时，至少应关注以下风险点：

- `domain` 与当前页面来源明显不一致
- `URI` 与当前页面来源不一致
- 缺少关键字段，例如地址、`nonce`、`chainId`
- `Issued At` 明显在未来
- `Expiration Time` 已经过期
- `Not Before` 还未生效

这些检查的目的不是替代服务端验签，而是帮助用户在签名前识别明显异常。

## 8. 标准最小示例

```text
chat.example.com wants you to sign in with your Ethereum account:
0x1234...

Sign in to Chat and review requested access

URI: https://chat.example.com
Version: 1
Chain ID: 1
Nonce: 9f6d0d2f8a6c4bb1
Issued At: 2026-05-04T06:00:00.000Z
Expiration Time: 2026-05-05T06:00:00.000Z
Resources:
- urn:recap:...
```

这个示例表达的是：

- 用户以 `0x1234...` 地址登录 `chat.example.com`
- 登录消息只在有限时间窗口内有效
- 消息附带了一份可展示的授权摘要引用

但它并不等于：

- Router 和 WebDAV 已经自动拿到了可直接调用的请求令牌

这一步仍应交给 UCAN。

## 9. DApp 最小接入步骤

### 9.1 先连接站点

```ts
await provider.request({ method: "eth_requestAccounts" });
```

### 9.2 生成标准 SIWE message

示例：

```text
chat.example.com wants you to sign in with your Ethereum account:
0x1234...

Sign in to Chat and review requested access

URI: https://chat.example.com
Version: 1
Chain ID: 1
Nonce: 9f6d0d2f8a6c4bb1
Issued At: 2026-05-04T06:00:00.000Z
Expiration Time: 2026-05-05T06:00:00.000Z
Resources:
- urn:recap:...
```

### 9.3 发起签名

```ts
const signature = await provider.request({
  method: "personal_sign",
  params: [siweMessage, account],
});
```

说明：

- `personal_sign` 参数顺序是 `[message, address]`
- 如果使用 `eth_signTypedData_v4`，前后端要统一验签方式

### 9.4 服务端验签与登录

钱包只负责签名，不负责业务登录态。服务端应至少完成：

1. SIWE 消息验签
2. 地址匹配
3. `domain` 校验
4. `nonce` 一次性校验
5. 时间窗口校验
6. 建立业务会话或签发业务 token

## 10. 与 UCAN 的推荐组合方式

推荐分层如下：

1. DApp 先通过 SIWE 建立身份上下文
2. 如果需要展示授权意图，可在 `statement` 或 `Resources` 中附带 ReCap 摘要
3. 后续真正面向 Router、WebDAV 等服务的能力控制，交由 UCAN 处理

换句话说：

- SIWE 负责“登录”
- ReCap 负责“授权意图摘要展示”
- UCAN 负责“正式能力委托与请求级授权”

这三者可以出现在同一个用户流程里，但不要把它们视为同一层协议。

## 11. 常见问题

- “只用 SIWE 能不能替代 UCAN？”
  - 不建议。SIWE 主要解决身份声明，不适合承载完整能力委托链。
- “Resources 里有 `urn:recap:`，是不是就已经授权成功了？”
  - 不应这么理解。它更像授权摘要或能力提示，不等于后端已经获得正式请求令牌。
- “为什么偶尔还会弹签名或要求解锁？”
  - SIWE 本身是否过期，与钱包当前是否处于可签名状态不是同一件事。钱包锁定后仍可能要求解锁。

## 12. 接入检查清单

- SIWE 字段完整：`domain`、`URI`、`Version`、`Chain ID`、`Nonce`、`Issued At`
- `domain` 与当前页面来源一致
- `URI` 与当前应用地址一致
- `nonce` 一次一用，服务端防重放
- `issuedAt / expirationTime / notBefore` 时间窗口合理
- 如使用 `Resources`，确保它们可解释、可展示，不误导用户
- 如需要正式能力控制，不要只停留在 SIWE，继续接入 UCAN

## 13. 代码参考

- 钱包 SIWE 展示与解析：[js/app/approval.js](/Users/liuxin2/Workspace/opensource/wallet/js/app/approval.js)
- 钱包签名请求路由：[js/background/request-router.js](/Users/liuxin2/Workspace/opensource/wallet/js/background/request-router.js)
- UCAN 说明：[UCAN协议说明.md](/Users/liuxin2/Workspace/opensource/wallet/docs/UCAN协议说明.md)
- DApp 接入说明：[DApp接入手册.md](/Users/liuxin2/Workspace/opensource/wallet/docs/DApp接入手册.md)

## 14. 官方参考

- EIP-4361: Sign-In with Ethereum：<https://eips.ethereum.org/EIPS/eip-4361>
- EIP-5573: ReCap (ReCapable Sessions)：<https://eips.ethereum.org/EIPS/eip-5573>

本文中的“SIWE 负责认证、UCAN 负责能力委托”的分层，是结合 EIP-4361、ReCap 扩展和当前钱包插件实现给出的推荐实践，目的是让登录、展示和授权三层语义保持清晰。
