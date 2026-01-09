/**
 * UI 配置
 */

// ==================== 基础 UI 配置 ====================
export const UI_CONFIG = {
  DEFAULT_THEME: 'light',      // UI 设置
  STATUS_TIMEOUT: 5000,        // 状态消息显示时间（毫秒）
  BALANCE_DECIMALS: 4,         // 余额显示小数位数
  ADDRESS_SHORT_LENGTH: 10,    // 地址缩短显示长度
  TOAST_DURATION: 3000,        // Toast 消息持续时间
  ANIMATION_DURATION: 300,     // 动画持续时间
  DEBOUNCE_DELAY: 300          // 防抖延迟
};

// ==================== 窗口尺寸 ====================
export const POPUP_DIMENSIONS = {
  width: 380,
  height: 600
};

// ==================== 主题配置 ====================
export const THEME = {
  DEFAULT: 'light',
  AVAILABLE: ['light', 'dark', 'auto']
};

export const COLORS = {
  primary: '#4F46E5',
  secondary: '#10B981',
  danger: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',
  success: '#10B981',

  // 状态颜色
  pending: '#F59E0B',
  confirmed: '#10B981',
  failed: '#EF4444',

  // 网络颜色
  mainnet: '#627EEA',
  testnet: '#FF6B6B',
  custom: '#9CA3AF'
};

// ==================== 格式化配置 ====================
export const FORMAT_CONFIG = {
  // 数字格式化
  NUMBER: {
    locale: 'en-US',
    minimumFractionDigits: 0,
    maximumFractionDigits: 18
  },

  // 货币格式化
  CURRENCY: {
    locale: 'en-US',
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  },

  // 日期格式化
  DATE: {
    locale: 'en-US',
    dateStyle: 'medium',
    timeStyle: 'short'
  },

  // 时间格式化
  TIME: {
    locale: 'en-US',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }
};

// ==================== 分页配置 ====================
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 10,
  PAGE_SIZE_OPTIONS: [10, 20, 50, 100],
  MAX_PAGE_SIZE: 100
};

// ==================== 表单配置 ====================
export const FORM_CONFIG = {
  AUTO_SAVE_DELAY: 1000,       // 自动保存延迟
  VALIDATION_DELAY: 300,       // 验证延迟
  MAX_INPUT_LENGTH: 1000,      // 最大输入长度
  MAX_TEXTAREA_LENGTH: 5000    // 最大文本域长度
};

// ==================== 通知配置 ====================
export const NOTIFICATION_CONFIG = {
  MAX_NOTIFICATIONS: 5,        // 最大通知数
  DEFAULT_DURATION: 5000,      // 默认持续时间
  POSITION: 'top-right',       // 位置
  ANIMATION: 'slide'           // 动画类型
};

// ==================== 工具函数 ====================

/**
 * 格式化余额显示
 * @param {string|number} balance - 余额
 * @param {number} decimals - 小数位数
 * @returns {string}
 */
export function formatBalance(balance, decimals = UI_CONFIG.BALANCE_DECIMALS) {
  const num = parseFloat(balance);
  if (isNaN(num)) return '0';

  return num.toFixed(decimals).replace(/\.?0+$/, '');
}

/**
 * 缩短地址显示
 * @param {string} address - 地址
 * @param {number} length - 显示长度
 * @returns {string}
 */
export function shortenAddress(address, length = UI_CONFIG.ADDRESS_SHORT_LENGTH) {
  if (!address) return '';
  if (address.length <= length) return address;

  const start = Math.floor(length / 2);
  const end = length - start;

  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

/**
 * 格式化交易哈希
 * @param {string} hash - 交易哈希
 * @returns {string}
 */
export function formatTxHash(hash) {
  return shortenAddress(hash, 16);
}

/**
 * 获取状态颜色
 * @param {string} status - 状态
 * @returns {string}
 */
export function getStatusColor(status) {
  return COLORS[status] || COLORS.info;
}

/**
 * 获取网络颜色
 * @param {string} networkType - 网络类型
 * @returns {string}
 */
export function getNetworkColor(networkType) {
  if (networkType === 'mainnet') return COLORS.mainnet;
  if (networkType === 'testnet') return COLORS.testnet;
  return COLORS.custom;
}

/**
 * 格式化数字
 * @param {number} value - 数值
 * @param {Object} options - 格式化选项
 * @returns {string}
 */
export function formatNumber(value, options = {}) {
  const config = { ...FORMAT_CONFIG.NUMBER, ...options };
  return new Intl.NumberFormat(config.locale, config).format(value);
}

/**
 * 格式化货币
 * @param {number} value - 数值
 * @param {string} symbol - 货币符号
 * @param {Object} options - 格式化选项
 * @returns {string}
 */
export function formatCurrency(value, symbol = '', options = {}) {
  const config = { ...FORMAT_CONFIG.CURRENCY, ...options };
  const formatted = new Intl.NumberFormat(config.locale, config).format(value);
  return symbol ? `${formatted} ${symbol}` : formatted;
}

/**
 * 格式化日期
 * @param {Date|string|number} date - 日期
 * @param {Object} options - 格式化选项
 * @returns {string}
 */
export function formatDate(date, options = {}) {
  const config = { ...FORMAT_CONFIG.DATE, ...options };
  const dateObj = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat(config.locale, config).format(dateObj);
}

/**
 * 格式化时间
 * @param {Date|string|number} date - 日期
 * @param {Object} options - 格式化选项
 * @returns {string}
 */
export function formatTime(date, options = {}) {
  const config = { ...FORMAT_CONFIG.TIME, ...options };
  const dateObj = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat(config.locale, config).format(dateObj);
}

/**
 * 格式化相对时间
 * @param {Date|string|number} date - 日期
 * @returns {string}
 */
export function formatRelativeTime(date) {
  const dateObj = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const diff = now - dateObj;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'Just now';
}

/**
 * 复制到剪贴板
 * @param {string} text - 文本
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Failed to copy:', error);
    return false;
  }
}

/**
 * 显示 Toast 消息
 * @param {string} message - 消息
 * @param {string} type - 类型 ('success' | 'error' | 'warning' | 'info')
 * @param {number} duration - 持续时间
 */
export function showToast(message, type = 'info', duration = UI_CONFIG.TOAST_DURATION) {
  // 这个函数需要在实际的 UI 层实现
  console.log(`[${type.toUpperCase()}] ${message}`);
}


