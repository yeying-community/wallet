# 客户端浏览器插件

## 本地插件安装

1. 克隆代码到本地
2. 在浏览器中输入：chrome://extensions/
3. 打开右上角“开发者模式”开关
4. 点击“加载未打包的扩展程序”，并指定代码目录，即完成安装


## 标准 / EIP 支持矩阵

> 说明：此列表用于持续维护，新增或调整标准支持时请同步更新。

| 标准 | 状态 | 说明 |
| --- | --- | --- |
| EIP-1193 Provider API | ✅ 已支持 | `request` + 连接/链/账户事件（`connect`/`disconnect`/`accountsChanged`/`chainChanged`） |
| EIP-1193 错误码 | ✅ 已支持 | 标准化错误返回 |
| EIP-2255 Permissions | ✅ 已支持 | `wallet_requestPermissions` / `wallet_getPermissions` / `wallet_revokePermissions`（仅 `eth_accounts`） |
| EIP-3326 | ✅ 已支持 | `wallet_switchEthereumChain` |
| EIP-3085 | ✅ 已支持 | `wallet_addEthereumChain` |
| EIP-712 | ✅ 已支持 | `eth_signTypedData` / `eth_signTypedData_v4` |
| EIP-747 | ✅ 已支持 | `wallet_watchAsset` |
| EIP-1559 | ✅ 已支持 | EIP-1559 费用字段与计算 |
| EIP-681 | ✅ 已支持 | 以太坊 URI 二维码 |
| EIP-4361 (SIWE) | ✅ 已支持 | 解析并展示 SIWE 文本 |
| EIP-5573 (ReCap) | ✅ 已支持 | 解析 `urn:recap:` 并结构化展示能力 |
| ERC-20 | ✅ 基础支持 | 添加代币 + 余额展示 |
| EIP-55 | ⚠️ 部分支持 | 校验和校验尚未完整实现 |

### 标准支持更新约定
- 新增/变更 EIP 或标准时，请在此矩阵补充条目并写明状态与说明。
- 若仅部分支持，请在“说明”里标注限制范围。

## 功能说明

✅ 已实现功能：

✅ 创建新钱包
✅ 导入钱包（通过私钥）
✅ 查看余额
✅ 发送交易
✅ 切换网络（主网/测试网）
✅ 导出私钥
✅ 复制地址
✅ 密码保护
✅ 交易历史记录
✅ 更好的二维码生成
✅ 添加助记词支持
✅ 多账户管理

🔧 可扩展功能：
- NFT 支持（ERC-721 / ERC-1155）
- 更多链与协议扩展

## 下载依赖包
curl -L -o lib/ethers-6.16.esm.min.js https://cdn.jsdelivr.net/npm/ethers@6/dist/ethers.min.js
curl -o qrcode.min.js https://unpkg.com/qrcodejs@1.0.0/qrcode.min.js
