/**
 * ID 和时间戳工具函数
 */

/**
 * 生成唯一 ID
 * @param {string} prefix - ID 前缀
 * @returns {string}
 */
export function generateId(prefix = 'id') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * 生成短唯一 ID
 * @param {string} prefix - ID 前缀
 * @returns {string}
 */
export function generateShortId(prefix = '') {
  const random = Math.random().toString(36).substring(2, 8);
  return prefix ? `${prefix}_${random}` : random;
}

/**
 * 生成 UUID v4 格式的 ID
 * @returns {string}
 */
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 生成纳米级时间戳 ID
 * @returns {string}
 */
export function generateNanoId() {
  const now = Date.now();
  const ns = process.hrtime ? process.hrtime()[1] : 0;
  return `n_${now}_${ns}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 获取当前时间戳（毫秒）
 * @returns {number}
 */
export function getTimestamp() {
  return Date.now();
}

/**
 * 获取当前时间戳（秒）
 * @returns {number}
 */
export function getTimestampSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 格式化日期时间
 * @param {number} timestamp - 时间戳（毫秒）
 * @param {string} format - 格式
 * @returns {string}
 */
export function formatDate(timestamp, format = 'relative') {
  if (!timestamp) {
    return '';
  }
  
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  // 相对时间格式
  if (format === 'relative') {
    return formatRelativeTime(diff);
  }
  
  // 中文日期格式
  if (format === 'zh') {
    return formatDateZh(date, now);
  }
  
  // 标准日期格式
  return formatDateStandard(date);
}

/**
 * 格式化相对时间
 * @param {number} diff - 时间差（毫秒）
 * @returns {string}
 */
function formatRelativeTime(diff) {
  // 如果是未来时间
  if (diff < 0) {
    return '未来';
  }
  
  // 1分钟内
  if (diff < 60000) {
    return '刚刚';
  }

  // 1小时内
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} 分钟前`;
  }
  
  // 24小时内
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} 小时前`;
  }
  
  // 7天内
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days} 天前`;
  }
  
  // 30天内
  if (diff < 2592000000) {
    const weeks = Math.floor(diff / 604800000);
    return `${weeks} 周前`;
  }
  
  // 超过30天
  const months = Math.floor(diff / 2592000000);
  return `${months} 个月前`;
}

/**
 * 格式化中文日期
 * @param {Date} date - 日期对象
 * @param {Date} now - 当前日期
 * @returns {string}
 */
function formatDateZh(date, now) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  
  // 如果是今年
  if (year === now.getFullYear()) {
    return `${month}月${day}日 ${hour}:${minute}`;
  }
  
  return `${year}年${month}月${day}日 ${hour}:${minute}`;
}

/**
 * 格式化标准日期
 * @param {Date} date - 日期对象
 * @returns {string}
 */
function formatDateStandard(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * 格式化日期（仅日期部分）
 * @param {number} timestamp - 时间戳
 * @returns {string}
 */
export function formatDateOnly(timestamp) {
  if (!timestamp) {
    return '';
  }
  
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

/**
 * 格式化时间（仅时间部分）
 * @param {number} timestamp - 时间戳
 * @returns {string}
 */
export function formatTimeOnly(timestamp) {
  if (!timestamp) {
    return '';
  }
  
  const date = new Date(timestamp);
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  
  return `${hour}:${minute}:${second}`;
}

/**
 * 格式化持续时间
 * @param {number} milliseconds - 毫秒数
 * @returns {string}
 */
export function formatDuration(milliseconds) {
  if (milliseconds < 1000) {
    return `${milliseconds}ms`;
  }
  
  if (milliseconds < 60000) {
    return `${(milliseconds / 1000).toFixed(2)}s`;
  }
  
  if (milliseconds < 3600000) {
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
  
  if (milliseconds < 86400000) {
    const hours = Math.floor(milliseconds / 3600000);
    const minutes = Math.floor((milliseconds % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  }
  
  const days = Math.floor(milliseconds / 86400000);
  const hours = Math.floor((milliseconds % 86400000) / 3600000);
  return `${days}d ${hours}h`;
}

/**
 * 检查是否超时
 * @param {number} timestamp - 开始时间戳
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {boolean}
 */
export function isTimeout(timestamp, timeout = 60000) {
  return Date.now() - timestamp > timeout;
}

/**
 * 检查时间戳是否在有效期内
 * @param {number} timestamp - 时间戳
 * @param {number} validity - 有效期（毫秒）
 * @returns {boolean}
 */
export function isValidTimestamp(timestamp, validity = 300000) {
  const now = Date.now();
  const diff = Math.abs(now - timestamp);
  return diff <= validity;
}

/**
 * 获取一天的开始时间
 * @param {number} timestamp - 时间戳
 * @returns {number}
 */
export function getStartOfDay(timestamp = Date.now()) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * 获取一天的结束时间
 * @param {number} timestamp - 时间戳
 * @returns {number}
 */
export function getEndOfDay(timestamp = Date.now()) {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

/**
 * 获取一周的开始时间
 * @param {number} timestamp - 时间戳
 * @returns {number}
 */
export function getStartOfWeek(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * 获取一个月的开始时间
 * @param {number} timestamp - 时间戳
 * @returns {number}
 */
export function getStartOfMonth(timestamp = Date.now()) {
  const date = new Date(timestamp);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * 获取一个月的结束时间
 * @param {number} timestamp - 时间戳
 * @returns {number}
 */
export function getEndOfMonth(timestamp = Date.now()) {
  const date = new Date(timestamp);
  date.setMonth(date.getMonth() + 1);
  date.setDate(0);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

/**
 * 解析自然语言时间描述
 * @param {string} timeStr - 时间描述
 * @returns {number|null}
 */
export function parseTimeString(timeStr) {
  const now = Date.now();
  const str = String(timeStr).toLowerCase().trim();
  
  // 解析相对时间
  const relativeMatch = str.match(/^(\d+)\s*(秒|分钟|小时|天|周|月|年)\s*(前|后)?$/);
  
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const direction = relativeMatch[3];
    
    const multipliers = {
      '秒': 1000,
      '分钟': 60000,
      '小时': 3600000,
      '天': 86400000,
      '周': 604800000,
      '月': 2592000000,
      '年': 31536000000
    };
    
    const multiplier = multipliers[unit] || 1000;
    const offset = value * multiplier;
    
    if (direction === '后') {
      return now + offset;
    } else if (direction === '前') {
      return now - offset;
    }
    return offset;
  }

  // 解析具体时间
  const date = new Date(str);
  if (!isNaN(date.getTime())) {
    return date.getTime();
  }
  
  return null;
}
