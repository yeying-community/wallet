# Backup & Sync（WebDAV 版）设计草案

> 目标：在**同一 SRP（助记词）**的多设备间同步账号名称、账号数量、联系人、Network IDs 与更新时间戳。
> 数据以**客户端加密文件**形式保存到 WebDAV；服务端不可读；支持 SIWE / UCAN 登录。

## 1. 范围与非目标

### 范围（MVP）
- **同步对象**：
  - 账户名称（HD 账户）
  - 账号数量（HD 派生索引）
  - 联系人（名称 / 备注 / 地址）
  - Network IDs（链 ID）
- **同步触发**：解锁、锁定、启动/关闭、关键本地变更。
- **存储介质**：WebDAV（PUT/GET/PROPFIND/DELETE）。
- **认证方式**：SIWE（challenge/verify）或 UCAN Bearer Token。

### 非目标
- 不同步私钥、助记词、硬件钱包账户、私钥导入账户。
- 不同步交易记录、授权站点、代币余额。
- 不在服务端做任何解密或合并。

## 2. 现状对齐（钱包侧）

- **HD 钱包**支持助记词派生；导入私钥钱包无法派生，不纳入同步。
- 本地存储使用 `chrome.storage.local`；可在 `settings` 内新增 `backupSyncEnabled`。
- 加密能力已存在：`encryptObject` / `decryptObject`（AES-GCM + PBKDF2）。

## 3. WebDAV 对接约束（来自 /root/code/webdav）

- WebDAV 前缀来自 `webdav.prefix`（默认 `/`）。
- WebDAV 支持 **Bearer Token** 与 **Basic Auth**。
- Web3 认证流程：`/api/v1/public/auth/challenge` → `/verify` → 拿到 `token`。
- UCAN 直接用 `Authorization: Bearer <UCAN>` 访问 WebDAV。

## 4. 命名空间与密钥派生

### 4.1 SRP 指纹（命名空间）
- `srpFingerprint = sha256("yeying-sync-id:" + mnemonic)`
- 用作 WebDAV 文件路径（同 SRP 的设备会读写同一文件）。

### 4.2 同步加密密钥
- `syncKey = sha256("yeying-sync-key:" + mnemonic)`
- 作为 `encryptObject/decryptObject` 的“password”输入（客户端派生）。
- **只在解锁后驻留内存**；锁定时清除。

## 5. WebDAV 文件布局

**路径建议：**
```
{webdav.prefix}/wallet-sync/{srpFingerprint}/payload.json.enc
```
- `wallet-sync/` 目录若不存在，用 `MKCOL` 创建。
- `payload.json.enc` 为**完整加密文件**。

**文件内容（建议 JSON envelope）：**
```json
{
  "version": 1,
  "cipher": "AES-GCM",
  "kdf": "PBKDF2",
  "ciphertext": "<base64>"
}
```
- `ciphertext` 为 `encryptObject(payload, syncKey)` 的输出。
- AES-GCM 已含完整性校验；无需额外 HMAC。

## 6. 同步载荷（Payload v1）

```json
{
  "version": 1,
  "updatedAt": 1710000000000,
  "accountCount": 3,
  "accounts": [
    { "index": 0, "address": "0x...", "name": "Account 1", "nameUpdatedAt": 1710000000000 },
    { "index": 1, "address": "0x...", "name": "Trading", "nameUpdatedAt": 1710000001000 }
  ],
  "contacts": [
    { "id": "0xabc...", "name": "Alice", "note": "", "address": "0xabc...", "updatedAt": 1710000002000 }
  ],
  "networkIds": ["0x1", "0xaa36a7"],
  "networksUpdatedAt": 1710000003000
}
```

说明：
- `accounts.index` 为 HD 派生索引，保证跨设备稳定。
- `address` 作为校验和展示；真实合并以 `index` 为主。
- `accountCount` 只增不减。

## 7. 同步流程（高层）

### 7.1 触发点
- **解锁**：`pull → merge → push`（若有变化）
- **锁定**：尝试 `push`（若 dirty）
- **启动/关闭**：`pull` / 尝试 `push`
- **本地变更**：账户命名、创建子账户、联系人变更、网络变更 → 标记 dirty，延迟合并上传

### 7.2 Pull
1. `GET payload.json.enc`（不存在则跳过）
2. `decryptObject(ciphertext, syncKey)`
3. `mergePayload(remote, local)`
4. 如果合并后本地变化 → 更新本地存储

### 7.3 Push
1. 本地构建 payload
2. `encryptObject(payload, syncKey)`
3. `PUT payload.json.enc`（可附 `If-Match`/`If-None-Match` 做并发保护）

## 8. 冲突合并规则

- **账户名称**：以 `nameUpdatedAt` 作为 LWW（最后写入胜）
  - 若时间戳相同但名称不同：记录 `conflicts`（由 UI 提示用户）
- **联系人**：按 `updatedAt` LWW；同上记录冲突
- **账号数量**：`max(local, remote)`；只扩展，不收缩
- **Network IDs**：取并集；时间戳仅用于展示/日志

## 9. 账号补齐（HD 派生）

当 `remote.accountCount > local.accountCount`：
- 解锁状态下：用助记词派生缺失账户并保存（需要密码）
- 锁定状态下：记录待补齐标记，待下次解锁完成派生

## 10. 认证与 Token 策略

### 10.1 SIWE（推荐给普通用户）
- `GET /api/v1/public/auth/challenge?address=0x...`
- `POST /api/v1/public/auth/verify`（address + signature）
- 拿到 `token` 后作为 `Authorization: Bearer <token>` 访问 WebDAV
- 过期用 `/auth/refresh` 刷新

### 10.2 UCAN（高级/去中心化授权）
- 客户端生成 UCAN，携带 `cap` 满足服务器 `required_resource/action`
- 直接 `Authorization: Bearer <UCAN>` 访问 WebDAV
 - 钱包内可生成 UCAN（基于 SIWE 根证明 + Ed25519 UCAN invocation）

## 11. 本地存储与配置（建议新增）

- `settings.backupSyncEnabled`（默认 true）
- `settings.backupSyncEndpoint`（WebDAV Base URL，默认 `https://webdav.yeying.pub`）
- `settings.backupSyncAuthMode`（siwe | ucan | basic）
- `settings.backupSyncLastPullAt` / `LastPushAt`
- `settings.backupSyncDirty`（是否有待推送变更）
- `settings.backupSyncConflicts`（冲突记录，可选）

## 12. UI 建议

- 设置页开关：Backup & Sync
- 显示最近同步时间
- “立即同步”按钮
- 冲突提示入口（若存在）

## 13. 落地实现拆解（建议阶段）

### 阶段 A：最小可用（仅账号名+数量）
- 加入同步服务模块（background）
- 支持 SIWE 登录获取 token
- 实现 WebDAV PUT/GET
- 完成账号名称与 accountCount 同步

### 阶段 B：联系人 + Network IDs
- 新增联系人存储与 UI
- Network IDs 同步并集

### 阶段 C：冲突 UI 与操作日志
- 可视化冲突并允许用户选择

#### 调试说明（本地）
- 若需快速验证冲突 UI，可在 `js/config/feature-flags.js` 中启用：
  - `FEATURES.ENABLE_DEVELOPER_MODE = true`
  - `DEVELOPER_FEATURES.ENABLE_DEBUG_MODE = true`
- 设置页会出现“模拟冲突”按钮，点击会生成一条账户冲突（以及可用时的联系人冲突）。

## 14. 待确认清单（请逐项确认）

1) WebDAV 路径：是否采用 `wallet-sync/{srpFingerprint}/payload.json.enc`？
2) 认证优先级：默认 SIWE 还是 UCAN？是否保留 Basic 作为备用？
3) Payload 字段：是否需要同步联系人与 Network IDs 在 MVP？
4) 冲突策略：是否允许“保留双版本”还是只记录冲突供用户处理？
5) 多钱包场景：同一设备多个 HD 钱包是否都开启同步？
6) 是否需要对 payload 进行版本化迁移（v1 → v2）？

---

如果你确认上述决策，我可以按阶段 A 开始落地到代码里（先最小可用）。
