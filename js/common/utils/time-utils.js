/**
 * Time utility functions
 */

/**
 * Get current timestamp in milliseconds.
 * @returns {number}
 */
export function getTimestamp() {
  return Date.now();
}

/**
 * Get current timestamp in seconds.
 * @returns {number}
 */
export function getTimestampSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Format timestamp as ISO string.
 * @param {number} timestamp
 * @returns {string}
 */
export function formatIsoTimestamp(timestamp = Date.now()) {
  return new Date(timestamp).toISOString();
}

/**
 * Format date/time using locale settings.
 * @param {Date|string|number} value
 * @param {Object} options
 * @returns {string}
 */
export function formatLocaleDateTime(value, options = {}) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const dateObj = value instanceof Date ? value : new Date(value);
  const { locale, ...rest } = options || {};
  return dateObj.toLocaleString(locale || undefined, rest);
}

/**
 * Format a timestamp.
 * @param {number} timestamp
 * @param {string} format
 * @returns {string}
 */
export function formatDate(timestamp, format = 'relative') {
  if (!timestamp) {
    return '';
  }

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (format === 'relative') {
    return formatRelativeTime(diff);
  }

  if (format === 'zh') {
    return formatDateZh(date, now);
  }

  return formatDateStandard(date);
}

/**
 * Format a relative time string.
 * @param {number} diff
 * @returns {string}
 */
function formatRelativeTime(diff) {
  if (diff < 0) {
    return '未来';
  }

  if (diff < 60000) {
    return '刚刚';
  }

  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} 分钟前`;
  }

  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} 小时前`;
  }

  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days} 天前`;
  }

  if (diff < 2592000000) {
    const weeks = Math.floor(diff / 604800000);
    return `${weeks} 周前`;
  }

  const months = Math.floor(diff / 2592000000);
  return `${months} 个月前`;
}

/**
 * Format relative time in English.
 * @param {Date|string|number} value
 * @returns {string}
 */
export function formatRelativeTimeEn(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const dateObj = value instanceof Date ? value : new Date(value);
  const diff = Date.now() - dateObj.getTime();

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
 * Format a date in Chinese style.
 * @param {Date} date
 * @param {Date} now
 * @returns {string}
 */
function formatDateZh(date, now) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  if (year === now.getFullYear()) {
    return `${month}月${day}日 ${hour}:${minute}`;
  }

  return `${year}年${month}月${day}日 ${hour}:${minute}`;
}

/**
 * Format a date in standard format.
 * @param {Date} date
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
 * Format date only.
 * @param {number} timestamp
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
 * Format time only.
 * @param {number} timestamp
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
 * Format a duration.
 * @param {number} milliseconds
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
 * Check whether a timestamp is timed out.
 * @param {number} timestamp
 * @param {number} timeout
 * @returns {boolean}
 */
export function isTimeout(timestamp, timeout = 60000) {
  return Date.now() - timestamp > timeout;
}

/**
 * Check whether a timestamp is still valid.
 * @param {number} timestamp
 * @param {number} validity
 * @returns {boolean}
 */
export function isValidTimestamp(timestamp, validity = 300000) {
  const now = Date.now();
  const diff = Math.abs(now - timestamp);
  return diff <= validity;
}

/**
 * Get start of day.
 * @param {number} timestamp
 * @returns {number}
 */
export function getStartOfDay(timestamp = Date.now()) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Get end of day.
 * @param {number} timestamp
 * @returns {number}
 */
export function getEndOfDay(timestamp = Date.now()) {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

/**
 * Get start of week.
 * @param {number} timestamp
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
 * Get start of month.
 * @param {number} timestamp
 * @returns {number}
 */
export function getStartOfMonth(timestamp = Date.now()) {
  const date = new Date(timestamp);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Get end of month.
 * @param {number} timestamp
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
 * Parse a natural language time string.
 * @param {string} timeStr
 * @returns {number|null}
 */
export function parseTimeString(timeStr) {
  const now = Date.now();
  const str = String(timeStr).toLowerCase().trim();

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
    }
    if (direction === '前') {
      return now - offset;
    }
    return offset;
  }

  const date = new Date(str);
  if (!isNaN(date.getTime())) {
    return date.getTime();
  }

  return null;
}
