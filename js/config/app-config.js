/**
 * 应用基础配置
 */

// ==================== 应用信息 ====================
export const APP_NAME = 'YeYing Wallet';
export const VERSION = '1.0.0';
export const PROTOCOL_VERSION = '1.0.0';

// ==================== 应用元数据 ====================
export const APP_METADATA = {
  name: APP_NAME,
  version: VERSION,
  protocolVersion: PROTOCOL_VERSION,
  description: 'A secure Ethereum wallet extension',
  author: 'YeYing Team',
  homepage: 'https://wallet.yeying.pub',
  supportEmail: 'support@yeying.pub'
};

// ==================== 日志配置 ====================
export const LOG_LEVEL = 'info'; // 'debug' | 'info' | 'warn' | 'error' | 'none'

export const LOG_CONFIG = {
  level: LOG_LEVEL,
  enableConsole: true,
  enableStorage: false,
  maxStorageSize: 1000, // 最大日志条数
  includeTimestamp: true,
  includeStackTrace: true
};

// ==================== 限制配置 ====================
export const LIMITS = {
  MAX_ACCOUNTS: 10,                    // 最大账户数
  MAX_ADDRESS_BOOK: 100,               // 地址簿最大条目
  MAX_TRANSACTION_HISTORY: 1000,       // 最大交易历史
  MAX_CUSTOM_NETWORKS: 20,             // 最大自定义网络数
  MAX_TOKENS_PER_ACCOUNT: 100,         // 每个账户最大代币数
  MAX_PENDING_REQUESTS: 10             // 最大待处理请求数
};

// ==================== 环境配置 ====================
/**
 * 获取应用版本信息
 * @returns {Object}
 */
export function getVersionInfo() {
  return {
    version: VERSION,
    protocolVersion: PROTOCOL_VERSION,
    buildDate: new Date().toISOString()
  };
}

/**
 * 检查版本兼容性
 * @param {string} requiredVersion - 需要的版本
 * @returns {boolean}
 */
export function isVersionCompatible(requiredVersion) {
  const [reqMajor, reqMinor] = requiredVersion.split('.').map(Number);
  const [curMajor, curMinor] = VERSION.split('.').map(Number);
  
  // 主版本必须相同，次版本必须大于等于要求
  return curMajor === reqMajor && curMinor >= reqMinor;
}

/**
 * 获取日志级别优先级
 * @param {string} level - 日志级别
 * @returns {number}
 */
export function getLogLevelPriority(level) {
  const priorities = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    none: 4
  };
  return priorities[level] ?? 1;
}

/**
 * 检查是否应该记录日志
 * @param {string} level - 日志级别
 * @returns {boolean}
 */
export function shouldLog(level) {
  const currentPriority = getLogLevelPriority(LOG_LEVEL);
  const messagePriority = getLogLevelPriority(level);
  return messagePriority >= currentPriority;
}
