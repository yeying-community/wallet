# Web3 应用集成手册

> 状态：当前集成指南。
>
> 适用版本：Wallet `1.4.22+` 钱包身份方案。
>
> 目标读者：接入 EIP-1193、SIWE、UCAN 和钱包身份的 DApp 前后端开发者。

## 1. 推荐接入顺序

1. 只需要钱包地址：使用 EIP-1193 连接和 SIWE 登录。
2. 需要已验证邮箱、用户名或可与无钱包登录收敛的身份：使用钱包身份 presentation。
3. 需要访问 Router、Warehouse、WebDAV 等资源服务：在登录后申请 UCAN 或服务端 scoped credential。
4. 没有钱包插件的浏览器：使用 Node 钱包身份授权码流程，由 Passkey 作为认证器确认同一个钱包身份。

推荐前端 SDK 是 `@yeying-community/web3-bs`。业务应用应优先使用 SDK 封装，而不是直接拼接 Wallet RPC。

## 2. 钱包身份模型

正式身份主键：

```text
did:yeying:wid_*
```

字段含义：

- `did`：`did:yeying:wid_*`，跨系统身份主键。
- `walletAddress`：已验证关联的钱包账户，不是身份主键。
- `UsernameCredential`：Node 签发的用户名 JWT-VC。
- `EmailCredential`：Node 签发的邮箱 JWT-VC。
- Passkey：身份认证器，用于无钱包插件登录或高风险确认。

## 3. 有钱包插件登录

DApp 前端先通过连接请求一次性申请钱包账户和身份权限：

```text
wallet_requestPermissions
```

示例参数：

```json
{
  "eth_accounts": {},
  "wallet_identity": {
    "scopes": ["identity.basic", "identity.wallet", "identity.email"]
  }
}
```

Wallet 会在同一个连接请求页展示账户权限和身份 scope，用户只确认一次。连接完成后，再请求 Wallet 出示：

```text
wallet_identity_presentation
```

请求需要包含：

- `appId`
- `audience`
- `nonce`
- `scopes`
- `expiresAt`

常用 scope：

```text
identity.basic
identity.wallet
identity.username
identity.email
```

`identity.email` 只有在用户已在 Wallet 中完成钱包身份验证和邮箱验证码确认，且可获得有效 `EmailCredential` 时才可出示。正常登录直接使用 Wallet 本地有效凭证，不访问 Node。Wallet 不会把过期或临近过期的凭证放进 presentation；如果应用登录 session 提供 `issuerEndpoint`，Wallet 仅在需要续签时用 identity controller proof 向 Node 自动换取新的短期 JWT-VC。只有 Node 没有可续签事实、凭证已撤销或 proof 校验失败时，才提示用户回到 Wallet 完成邮箱验证。

后端必须校验：

1. presentation holder 是 `did:yeying:wid_*`。
2. 身份文档 controller 处于 active，且具备 authentication 用途。
3. presentation Ed25519 签名有效。
4. `audience`、`nonce`、scope 和有效期与本地登录 session 一致。
5. `identity.wallet` 的账户已由 Node 账户关联 proof 验证过。
6. 如使用邮箱或用户名，必须验证 JWT-VC issuer、JWKS、`sub`、type 和有效期；credential status 按业务撤销策略使用本地缓存或在线 Node 查询，高风险流程必须在线查询。

## 4. 无钱包插件登录

应用后端创建授权请求：

```text
POST /api/v1/public/identity/authorize/request
```

Node 返回 `verifyUrl`。前端可展示二维码，也可直接跳转。用户在 Node 页面用 Passkey 确认后，应用后端换码：

```text
POST /api/v1/public/identity/authorize/exchange
```

exchange 返回：

```json
{
  "did": "did:yeying:wid_example",
  "walletAddress": "0x...",
  "scopes": ["identity.basic", "identity.wallet", "identity.email"],
  "credentials": []
}
```

这个结果与 Wallet presentation 收敛到同一 DID 和同一组凭证。Passkey 只证明用户控制该钱包身份，不产生新的外部身份。

## 5. Wallet 设置页要求

用户需要在 Wallet 中完成：

1. 创建或选择钱包身份。
2. 关联当前钱包账户。
3. 填写用户名和邮箱。
4. 确认邮箱验证码。
5. 保存 `UsernameCredential` 和 `EmailCredential`。
6. 支持 WebAuthn 的环境中注册身份级 Passkey。

完成后，钱包插件登录和无钱包插件登录都可以按相同 scope 获取同一钱包身份资料。

## 6. 与 UCAN 的关系

钱包身份用于认证用户是谁，以及用户授权应用读取哪些身份资料。UCAN 用于资源访问授权。两者不要混用：

- 登录态：DApp 后端基于钱包身份 DID 创建本地 session。
- 资源访问：DApp 或 Wallet 申请 UCAN / scoped credential，资源服务校验 `aud`、`with`、`can`、`exp`。

## 7. 常见错误

| 错误 | 处理 |
| --- | --- |
| `IDENTITY_SCOPE_NOT_GRANTED:identity.email` | 用户尚未完成邮箱凭证验证，或自动续签失败后仍没有有效 `EmailCredential`，提示回 Wallet 完成钱包身份和邮箱验证 |
| `IDENTITY_EMAIL_REQUIRED` | Node 无钱包授权时发现该 DID 没有有效 `EmailCredential`，提示回 Wallet 重新验证 |
| `IDENTITY_PRESENTATION_CONTEXT_INVALID` | `audience` 或 `nonce` 不匹配，重新创建登录 session |
| `IDENTITY_PASSKEY_CREDENTIAL_NOT_FOUND` | 当前设备未注册该钱包身份的 Passkey，使用 Wallet 登录后重新注册 |

## 8. 验收清单

1. 普通 SIWE 登录仍可用于只需要地址的 DApp。
2. 钱包身份登录可以拿到 DID、钱包地址和已验证邮箱。
3. 未验证邮箱时，应用拒绝登录并给出可操作提示。
4. 无钱包插件时，`verifyUrl -> Passkey -> exchange` 能返回同一 DID。
5. nonce 重放、audience 不匹配、过期 presentation、缺少 scope 都会被拒绝。
6. 应用后端以 DID 作为身份主键，不以钱包地址、邮箱或用户名替代。
