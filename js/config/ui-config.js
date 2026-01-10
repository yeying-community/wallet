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
