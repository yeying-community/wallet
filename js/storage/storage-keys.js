// @ts-check
/**
 * 存储键定义
 * 集中管理所有存储键，避免硬编码
 */

/**
 * HD/导入钱包（密钥容器）。HD 钱包含加密助记词，导入钱包仅含账户私钥。
 * @typedef {Object} StoredWallet
 * @property {string} id
 * @property {string} name
 * @property {'hd'|'imported'} type
 * @property {string} [encryptedMnemonic] HD 钱包：AES-GCM 加密的助记词（Base64）
 * @property {number} createdAt
 * @property {number} accountCount
 */

/**
 * 钱包下的一个账户（地址）。
 * @typedef {Object} StoredAccount
 * @property {string} id  形如 `${walletId}_${index}`
 * @property {string} walletId
 * @property {string} name
 * @property {number} index
 * @property {string} [derivationPath]
 * @property {string} address
 * @property {string} encryptedPrivateKey AES-GCM 加密的私钥（Base64）
 * @property {number} createdAt
 * @property {number} [nameUpdatedAt]
 * @property {string} [username] Public username shared with approved DApps
 * @property {number} [usernameUpdatedAt]
 */

/**
 * 站点授权记录（connected_sites 的值）。
 * @typedef {Object} StoredPermission
 * @property {string} origin
 * @property {string[]} [accounts]
 * @property {number} [connectedAt]
 */

/**
 * 联系人。
 * @typedef {Object} StoredContact
 * @property {string} id
 * @property {string} name
 * @property {string} address
 * @property {string} [note]
 * @property {number} createdAt
 * @property {number} updatedAt
 */

// ==================== 钱包相关 ====================
export const WalletStorageKeys = {
  WALLETS: 'wallets',                      // 钱包列表 Map<walletId, Wallet>
  ACCOUNTS: 'accounts',                    // 账户列表 Map<accountId, Account>
  SELECTED_ACCOUNT_ID: 'current_account_id' // 当前选中的账户 ID
};

// ==================== 网络相关 ====================
export const NetworkStorageKeys = {
  SELECTED_NETWORK: 'selectedNetwork',     // 选中的网络名称
  NETWORKS: 'networks'                     // 网络列表
};

// ==================== 权限相关 ====================
export const PermissionStorageKeys = {
  CONNECTED_SITES: 'connected_sites'       // 已连接的网站 Map<origin, Permission>
};

// ==================== 设置相关 ====================
export const SettingsStorageKeys = {
  USER_SETTINGS: 'user_settings'           // 用户设置
};

// ==================== 交易相关 ====================
export const TransactionStorageKeys = {
  TRANSACTIONS: 'transactions'            // 交易记录
};

// ==================== 联系人相关 ====================
export const ContactsStorageKeys = {
  CONTACTS: 'contacts'                    // 联系人 Map<contactId, Contact>
};

// ==================== UCAN 相关 ====================
export const UcanStorageKeys = {
  UCAN_SESSIONS: 'ucan_sessions'          // UCAN 会话 Map<origin:address:sessionId, Session>
};

// ==================== MPC 相关 ====================
export const MpcStorageKeys = {
  MPC_DEVICE_ID: 'mpc_device_id',
  MPC_DEVICE_KEYS: 'mpc_device_keys',
  MPC_WALLETS: 'mpc_wallets',
  MPC_PARTICIPANTS: 'mpc_participants',
  MPC_KEY_SHARES: 'mpc_key_shares',
  MPC_SESSIONS: 'mpc_sessions',
  MPC_SIGN_REQUESTS: 'mpc_sign_requests',
  MPC_MESSAGES: 'mpc_messages',
  MPC_AUDIT_LOGS: 'mpc_audit_logs',
  MPC_AUDIT_EXPORT_CONFIG: 'mpc_audit_export_config',
  MPC_AUDIT_EXPORT_QUEUE: 'mpc_audit_export_queue'
};

// ==================== 统一导出 ====================
export const StorageKeys = {
  ...WalletStorageKeys,
  ...NetworkStorageKeys,
  ...PermissionStorageKeys,
  ...SettingsStorageKeys,
  ...TransactionStorageKeys,
  ...ContactsStorageKeys,
  ...UcanStorageKeys,
  ...MpcStorageKeys
};
