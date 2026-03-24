# SIWE 协议说明与使用指南（Wallet 模板）

本文档定义 Wallet 侧的 SIWE（EIP-4361）使用约定，重点说明：

- DApp 如何发起标准 SIWE 登录签名
- 钱包如何展示与风险提示
- SIWE 与 UCAN 在 Chat / Router / WebDAV 架构里的关系

## 1. 适用范围

- 钱包：YeYing Wallet 浏览器扩展
- 签名方法：`personal_sign`、`eth_sign`、`eth_signTypedData(_v4)`
- 典型业务：DApp 登录、SIWE + UCAN 组合授权

## 2. SIWE 与 UCAN 的职责边界

- SIWE：证明“是谁在授权”（身份声明）
- UCAN：证明“授权了什么能力”（权限声明）

在 Chat 架构中，常见做法是：

1. 先发 SIWE 登录签名，建立身份上下文
2. 再在 statement/resources 中携带 UCAN 信息（如 `UCAN-AUTH` / `urn:recap:`）
3. 后端按 SIWE 身份 + UCAN 能力联合校验

## 3. SIWE 标准字段（EIP-4361）

标准消息核心结构：

1. 第一行：`<domain> wants you to sign in with your Ethereum account:`
2. 地址行：`0x...`
3. statement（可选）
4. 键值字段（常见）：
   - `URI`
   - `Version`
   - `Chain ID`
   - `Nonce`
   - `Issued At`
   - `Expiration Time`（可选）
   - `Not Before`（可选）
   - `Request ID`（可选）
   - `Resources`（可选，多行 `- <uri>`）

## 4. Wallet 当前实现行为

钱包审批页会自动识别 SIWE 消息并结构化展示以下信息：

- `domain`、`address`
- `URI`、`Version`、`Chain ID`
- `Nonce`、`Issued At`
- `Expiration Time`、`Not Before`、`Request ID`
- `Resources` 列表

若 `Resources` 中包含 `urn:recap:`，钱包会解析能力并展示“能力范围 + 操作 + 影响说明”。

关键代码：

- SIWE 解析：`js/app/approval.js` 的 `parseSiweMessage`
- ReCap 解析：`js/app/approval.js` 的 `parseRecapFromSiwe`
- 签名请求路由：`js/background/request-router.js`

## 5. 钱包风险提示规则（当前）

审批页会对 SIWE 内容执行基础风险检测，常见告警包括：

- `domain` 与当前页面来源不一致
- `URI` 与当前来源 host 不一致
- 缺少 `address` / `nonce` / `chainId`
- `Issued At` 在未来（明显时钟异常）
- `Expiration Time` 已过期
- `Not Before` 尚未生效

建议 DApp 把这些字段补齐，避免用户看到不必要告警。

## 6. DApp 最小接入步骤

### 6.1 先连接站点

先请求：

```ts
await provider.request({ method: "eth_requestAccounts" });
```

### 6.2 生成标准 SIWE message

示例（简化）：

```text
localhost:3020 wants you to sign in with your Ethereum account:
0x1234...

Sign in to Chat

URI: http://localhost:3020
Version: 1
Chain ID: 1
Nonce: 9f6d0d2f8a6c4bb1
Issued At: 2026-03-23T06:00:00.000Z
Expiration Time: 2026-03-24T06:00:00.000Z
Resources:
- urn:recap:...
```

### 6.3 发起签名

```ts
const signature = await provider.request({
  method: "personal_sign",
  params: [siweMessage, account],
});
```

说明：

- `personal_sign` 参数顺序为 `[message, address]`。
- 也可使用 `eth_signTypedData_v4`，但需要 DApp 与服务端统一验签方案。

### 6.4 服务端验签与登录

钱包只负责签名，不负责业务登录态。  
服务端应完成：

1. SIWE 消息验签（地址匹配）
2. `domain/nonce/time` 校验
3. 防重放（nonce 一次性）
4. 建立会话或发业务 token

## 7. 与 Chat / Router / WebDAV 的组合建议

- Chat 登录：使用 SIWE 做身份声明
- Router/WebDAV 授权：使用 UCAN 做能力控制
- 推荐把能力摘要放入 SIWE statement/resources，便于用户在钱包一次看清授权范围

对应文档：

- UCAN 能力模板与接入：`./ucan-protocol.md`

## 8. 常见问题

- “为什么偶尔还会弹签名/解锁？”
  - SIWE 或 UCAN 本身未过期，不代表钱包当前签名能力可用；钱包锁定后仍需解锁。
- “只用 SIWE 能不能替代 UCAN？”
  - 不建议。SIWE 主要解决身份，细粒度能力更适合 UCAN。
- “Resources 必填吗？”
  - SIWE 标准里可选；但若要展示 ReCap/UCAN 能力，建议携带。

## 9. 接入检查清单

- SIWE 字段完整：`domain/uri/chainId/nonce/issuedAt`
- `domain` 与页面来源一致
- `nonce` 一次一用，服务端防重放
- 时间窗口合理（`issuedAt/expiration/notBefore`）
- 如包含授权范围，确保 `Resources` 可解析且与后端策略一致
