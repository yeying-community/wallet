/**
 * 存储键定义
 * 集中管理所有存储键，避免硬编码
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

// ==================== 统一导出 ====================
export const StorageKeys = {
  ...WalletStorageKeys,
  ...NetworkStorageKeys,
  ...PermissionStorageKeys,
  ...SettingsStorageKeys,
  ...TransactionStorageKeys,
  ...ContactsStorageKeys,
  ...UcanStorageKeys
};
