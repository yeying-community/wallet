/**
 * 存储键名配置
 */

// ==================== Local Storage Keys ====================
// 持久化存储，浏览器关闭后仍然保留

export const LOCAL_KEYS = {
  // 钱包数据（加密）
  ENCRYPTED_WALLET: 'encrypted_wallet',              // 加密的钱包数据
  WALLET_ACCOUNTS: 'wallet_accounts',                // 账户列表
  
  // 用户设置
  SETTINGS: 'settings',                              // 用户设置
  CURRENT_NETWORK: 'current_network',                // 当前网络
  CUSTOM_NETWORKS: 'custom_networks',                // 自定义网络列表
  LANGUAGE: 'language',                              // 语言设置
  THEME: 'theme',                                    // 主题设置
  
  // 地址簿
  ADDRESS_BOOK: 'address_book',                      // 地址簿
  
  // 代币
  CUSTOM_TOKENS: 'custom_tokens',                    // 自定义代币
  HIDDEN_TOKENS: 'hidden_tokens',                    // 隐藏的代币

  // 交易历史
  TRANSACTION_HISTORY: 'transaction_history',        // 交易历史
  PENDING_TRANSACTIONS: 'pending_transactions',      // 待处理交易
  
  // 连接的网站
  CONNECTED_SITES: 'connected_sites',                // 已连接的网站
  SITE_PERMISSIONS: 'site_permissions',              // 网站权限
  
  // 其他
  LAST_BACKUP_TIME: 'last_backup_time',             // 最后备份时间
  ONBOARDING_COMPLETED: 'onboarding_completed',     // 是否完成引导
  TERMS_ACCEPTED: 'terms_accepted',                 // 是否接受条款
  ANALYTICS_ENABLED: 'analytics_enabled'            // 是否启用分析
};

// ==================== Session Storage Keys ====================
// 临时存储，浏览器关闭后清除

export const SESSION_KEYS = {
  // 钱包会话（敏感信息）
  WALLET_ADDRESS: 'wallet_address',                  // 当前地址
  WALLET_PRIVATE_KEY: 'wallet_privateKey',           // 私钥（加密）
  CURRENT_ACCOUNT_ID: 'current_account_id',          // 当前账户 ID

  // 会话状态
  SESSION_ACTIVE: 'session_active',                  // 会话是否激活
  LAST_ACTIVITY: 'last_activity',                    // 最后活动时间
  UNLOCK_TIME: 'unlock_time',                        // 解锁时间
  
  // 临时数据
  PENDING_REQUEST: 'pending_request',                // 待处理请求
  TEMP_MNEMONIC: 'temp_mnemonic',                    // 临时助记词（仅创建时）
  TEMP_ACTION: 'temp_action',                        // 临时操作类型
  TEMP_PASSWORD: 'temp_password',                    // 临时密码（仅导入时）

  // 缓存数据
  CACHED_BALANCE: 'cached_balance',                  // 缓存的余额
  CACHED_GAS_PRICE: 'cached_gas_price',             // 缓存的 Gas 价格
  CACHED_NETWORK_INFO: 'cached_network_info'        // 缓存的网络信息
};

// ==================== Chrome Storage Keys ====================
// Chrome 扩展专用存储

export const CHROME_KEYS = {
  // 同步存储（跨设备同步）
  SYNC: {
    SETTINGS: 'sync_settings',
    CUSTOM_NETWORKS: 'sync_custom_networks',
    ADDRESS_BOOK: 'sync_address_book'
  },

  // 本地存储
  LOCAL: {
    WALLET_DATA: 'chrome_wallet_data',
    TRANSACTION_HISTORY: 'chrome_transaction_history'
  }
};

// ==================== 存储键前缀 ====================
export const KEY_PREFIXES = {
  ACCOUNT: 'account_',
  NETWORK: 'network_',
  TOKEN: 'token_',
  TRANSACTION: 'tx_',
  SITE: 'site_',
  CACHE: 'cache_'
};

// ==================== 工具函数 ====================

/**
 * 生成账户存储键
 * @param {string} accountId - 账户 ID
 * @param {string} key - 键名
 * @returns {string}
 */
export function getAccountKey(accountId, key) {
  return `${KEY_PREFIXES.ACCOUNT}${accountId}_${key}`;
}

/**
 * 生成网络存储键
 * @param {string} networkId - 网络 ID
 * @param {string} key - 键名
 * @returns {string}
 */
export function getNetworkKey(networkId, key) {
  return `${KEY_PREFIXES.NETWORK}${networkId}_${key}`;
}

/**
 * 生成代币存储键
 * @param {string} tokenAddress - 代币地址
 * @param {string} networkId - 网络 ID
 * @returns {string}
 */
export function getTokenKey(tokenAddress, networkId) {
  return `${KEY_PREFIXES.TOKEN}${networkId}_${tokenAddress}`;
}

/**
 * 生成交易存储键
 * @param {string} txHash - 交易哈希
 * @returns {string}
 */
export function getTransactionKey(txHash) {
  return `${KEY_PREFIXES.TRANSACTION}${txHash}`;
}

/**
 * 生成网站存储键
 * @param {string} origin - 网站来源
 * @returns {string}
 */
export function getSiteKey(origin) {
  return `${KEY_PREFIXES.SITE}${origin}`;
}

/**
 * 生成缓存存储键
 * @param {string} key - 键名
 * @returns {string}
 */
export function getCacheKey(key) {
  return `${KEY_PREFIXES.CACHE}${key}`;
}

/**
 * 检查键是否为敏感数据
 * @param {string} key - 键名
 * @returns {boolean}
 */
export function isSensitiveKey(key) {
  const sensitiveKeys = [
    SESSION_KEYS.WALLET_PRIVATE_KEY,
    SESSION_KEYS.TEMP_MNEMONIC,
    SESSION_KEYS.TEMP_PASSWORD,
    LOCAL_KEYS.ENCRYPTED_WALLET
  ];
  
  return sensitiveKeys.includes(key);
}

/**
 * 检查键是否应该在会话结束时清除
 * @param {string} key - 键名
 * @returns {boolean}
 */
export function shouldClearOnSessionEnd(key) {
  return Object.values(SESSION_KEYS).includes(key);
}

/**
 * 获取所有敏感键
 * @returns {string[]}
 */
export function getSensitiveKeys() {
  return [
    SESSION_KEYS.WALLET_PRIVATE_KEY,
    SESSION_KEYS.TEMP_MNEMONIC,
    SESSION_KEYS.TEMP_PASSWORD,
    LOCAL_KEYS.ENCRYPTED_WALLET
  ];
}

/**
 * 获取所有会话键
 * @returns {string[]}
 */
export function getSessionKeys() {
  return Object.values(SESSION_KEYS);
}

/**
 * 获取所有本地存储键
 * @returns {string[]}
 */
export function getLocalKeys() {
  return Object.values(LOCAL_KEYS);
}

