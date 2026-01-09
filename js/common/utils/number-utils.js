/**
 * 数值格式化工具函数
 */

/**
 * 格式化数字（添加千位分隔符）
 * @param {string|number} num - 数字
 * @param {number} decimals - 小数位数
 * @returns {string}
 */
export function formatNumber(num, decimals = 0) {
  const number = parseFloat(num);
  
  if (isNaN(number)) {
    return '0';
  }
  
  const options = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  };
  
  return number.toLocaleString('en-US', options);
}

/**
 * 格式化数字（中文格式）
 * @param {string|number} num - 数字
 * @param {number} decimals - 小数位数
 * @returns {string}
 */
export function formatNumberZh(num, decimals = 0) {
  const number = parseFloat(num);
  
  if (isNaN(number)) {
    return '0';
  }
  
  const options = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  };
  
  return number.toLocaleString('zh-CN', options);
}

/**
 * 格式化货币
 * @param {string|number} amount - 金额
 * @param {string} currency - 货币代码
 * @param {string} locale - 区域设置
 * @returns {string}
 */
export function formatCurrency(amount, currency = 'USD', locale = 'en-US') {
  const number = parseFloat(amount);
  
  if (isNaN(number)) {
    return formatCurrency(0, currency, locale);
  }
  
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency
  }).format(number);
}

/**
 * 格式化百分比
 * @param {string|number} value - 值
 * @param {number} decimals - 小数位数
 * @returns {string}
 */
export function formatPercent(value, decimals = 2) {
  const number = parseFloat(value);
  
  if (isNaN(number)) {
    return '0%';
  }
  
  return `${number.toFixed(decimals)}%`;
}

/**
 * 格式化百分比（带颜色）
 * @param {string|number} value - 值
 * @param {number} decimals - 小数位数
 * @returns {{text: string, color: string}}
 */
export function formatPercentWithColor(value, decimals = 2) {
  const number = parseFloat(value);
  
  if (isNaN(number)) {
    return { text: '0%', color: 'neutral' };
  }
  
  const text = `${number >= 0 ? '+' : ''}${number.toFixed(decimals)}%`;
  const color = number > 0 ? 'positive' : number < 0 ? 'negative' : 'neutral';
  
  return { text, color };
}

/**
 * 格式化科学计数法
 * @param {string|number} num - 数字
 * @param {number} decimals - 小数位数
 * @returns {string}
 */
export function formatScientific(num, decimals = 4) {
  const number = parseFloat(num);
  
  if (isNaN(number)) {
    return '0';
  }
  
  if (number === 0) {
    return '0';
  }
  
  return number.toExponential(decimals);
}

/**
 * 格式化大数字（K、M、B、T）
 * @param {string|number} num - 数字
 * @param {number} decimals - 小数位数
 * @returns {string}
 */
export function formatCompact(num, decimals = 1) {
  const number = parseFloat(num);
  
  if (isNaN(number)) {
    return '0';
  }
  
  if (number === 0) {
    return '0';
  }
  
  const absNumber = Math.abs(number);
  const sign = number < 0 ? '-' : '';
  
  const suffixes = [
    { value: 1e12, suffix: 'T' },
    { value: 1e9, suffix: 'B' },
    { value: 1e6, suffix: 'M' },
    { value: 1e3, suffix: 'K' }
  ];
  
  for (const { value, suffix } of suffixes) {
    if (absNumber >= value) {
      const formatted = (absNumber / value).toFixed(decimals);
      return sign + removeTrailingZeros(formatted) + suffix;
    }
  }
  
  return sign + number.toString();
}

/**
 * 格式化大数字（中文）
 * @param {string|number} num - 数字
 * @param {number} decimals - 小数位数
 * @returns {string}
 */
export function formatCompactZh(num, decimals = 1) {
  const number = parseFloat(num);
  
  if (isNaN(number)) {
    return '0';
  }
  
  if (number === 0) {
    return '0';
  }
  
  const absNumber = Math.abs(number);
  const sign = number < 0 ? '-' : '';
  
  const suffixes = [
    { value: 1e12, suffix: '万亿' },
    { value: 1e8, suffix: '亿' },
    { value: 1e4, suffix: '万' }
  ];
  
  for (const { value, suffix } of suffixes) {
    if (absNumber >= value) {
      const formatted = (absNumber / value).toFixed(decimals);
      return sign + removeTrailingZeros(formatted) + suffix;
    }
  }
  
  return sign + number.toString();
}

/**
 * 移除尾部零
 * @param {string} str - 字符串
 * @returns {string}
 */
function removeTrailingZeros(str) {
  if (!str.includes('.')) {
    return str;
  }
  
  return str.replace(/\.?0+$/, '');
}

/**
 * 格式化字节大小
 * @param {number} bytes - 字节数
 * @param {number} decimals - 小数位数
 * @returns {string}
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) {
    return '0 B';
  }
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * 格式化时间长度
 * @param {number} seconds - 秒数
 * @returns {string}
 */
export function formatTimeLength(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  }
  
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

/**
 * 格式化距离
 * @param {number} meters - 米
 * @returns {string}
 */
export function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * 格式化百分比变化
 * @param {number} oldValue - 旧值
 * @param {number} newValue - 新值
 * @returns {string}
 */
export function formatPercentChange(oldValue, newValue) {
  if (oldValue === 0) {
    return newValue === 0 ? '0%' : '+∞';
  }
  
  const change = ((newValue - oldValue) / oldValue) * 100;
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}

/**
 * 格式化精度（避免浮点数精度问题）
 * @param {string|number} num - 数字
 * @param {number} decimals - 小数位数
 * @returns {string}
 */
export function formatPrecision(num, decimals = 8) {
  const number = typeof num === 'string' ? parseFloat(num) : num;
  
  if (isNaN(number)) {
    return '0';
  }
  
  // 使用科学计数法处理极小数
  if (number !== 0 && Math.abs(number) < 1e-8) {
    return number.toExponential(decimals);
  }
  
  return removeTrailingZeros(number.toFixed(decimals));
}

/**
 * 随机数范围
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number}
 */
export function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * 随机整数
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number}
 */
export function randomInt(min, max) {
  return Math.floor(randomRange(min, max + 1));
}

/**
 * 随机布尔值
 * @param {number} probability - 为 true 的概率（0-1）
 * @returns {boolean}
 */
export function randomBool(probability = 0.5) {
  return Math.random() < probability;
}

/**
 * 随机颜色
 * @returns {string}
 */
export function randomColor() {
  const letters = '0123456789ABCDEF';
  let color = '#';
  
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  
  return color;
}

/**
 * 随机字符串
 * @param {number} length - 长度
 * @param {string} chars - 字符集
 * @returns {string}
 */
export function randomString(length = 8, chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
  let result = '';
  
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return result;
}

/**
 * 数字补零
 * @param {number} num - 数字
 * @param {number} length - 长度
 * @returns {string}
 */
export function padNumber(num, length = 2) {
  const str = num.toString();
  return str.padStart(length, '0');
}

/**
 * 数字缩放
 * @param {string|number} num - 数字
 * @param {number} scale - 缩放因子
 * @param {number} decimals - 小数位数
 * @returns {string}
 */
export function scaleNumber(num, scale = 1, decimals = 4) {
  const number = parseFloat(num);
  
  if (isNaN(number)) {
    return '0';
  }
  
  const scaled = number * scale;
  return removeTrailingZeros(scaled.toFixed(decimals));
}

/**
 * 限制数字范围
 * @param {number} num - 数字
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number}
 */
export function clampNumber(num, min, max) {
  return Math.min(Math.max(num, min), max);
}

/**
 * 检查数字是否在范围内
 * @param {number} num - 数字
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {boolean}
 */
export function isInRange(num, min, max) {
  return num >= min && num <= max;
}

/**
 * 数字转中文大写
 * @param {string|number} num - 数字
 * @returns {string}
 */
export function numberToChinese(num) {
  const number = parseFloat(num);
  
  if (isNaN(number) || number < 0) {
    return '零';
  }
  
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const units = ['', '十', '百', '千'];
  const bigUnits = ['', '万', '亿', '兆'];
  
  let result = '';
  let numStr = Math.floor(number).toString();
  let unitIndex = 0;
  
  // 处理每一位
  for (let i = numStr.length - 1; i >= 0; i--) {
    const digit = parseInt(numStr[i]);
    
    if (digit !== 0) {
      result = digits[digit] + units[unitIndex] + result;
    } else if (!result.startsWith('零')) {
      result = '零' + result;
    }
    
    unitIndex++;
    
    // 每4位换一个大单位
    if (unitIndex === 4) {
      unitIndex = 0;
      result = bigUnits[Math.floor(numStr.length / 4) - Math.floor(i / 4)] + result;
    }
  }
  
  // 移除末尾的零
  result = result.replace(/零+$/, '');
  
  // 处理十的特殊情况
  if (result.startsWith('一十')) {
    result = result.replace('一十', '十');
  }
  
  return result || '零';
}

/**
 * 罗马数字转换
 * @param {number} num - 数字
 * @returns {string}
 */
export function toRoman(num) {
  if (num < 1 || num > 3999) {
    return '';
  }
  
  const romanNumerals = [
    { value: 1000, numeral: 'M' },
    { value: 900, numeral: 'CM' },
    { value: 500, numeral: 'D' },
    { value: 400, numeral: 'CD' },
    { value: 100, numeral: 'C' },
    { value: 90, numeral: 'XC' },
    { value: 50, numeral: 'L' },
    { value: 40, numeral: 'XL' },
    { value: 10, numeral: 'X' },
    { value: 9, numeral: 'IX' },
    { value: 5, numeral: 'V' },
    { value: 4, numeral: 'IV' },
    { value: 1, numeral: 'I' }
  ];
  
  let result = '';
  
  for (const { value, numeral } of romanNumerals) {
    while (num >= value) {
      result += numeral;
      num -= value;
    }
  }
  
  return result;
}

/**
 * 数字转字母（Excel 风格）
 * @param {number} num - 数字
 * @returns {string}
 */
export function numberToLetter(num) {
  if (num < 1) {
    return '';
  }
  
  let result = '';
  
  while (num > 0) {
    const remainder = (num - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    num = Math.floor((num - 1) / 26);
  }
  
  return result;
}

/**
 * 数字转基数词（1st, 2nd, 3rd）
 * @param {number} num - 数字
 * @returns {string}
 */
export function toOrdinal(num) {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = num % 100;
  const suffix = suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0];
  return num + suffix;
}

/**
 * 数字转中文序数词
 * @param {number} num - 数字
 * @returns {string}
 */
export function toChineseOrdinal(num) {
  const ordinals = ['第零', '第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九', '第十'];
  
  if (num <= 10) {
    return ordinals[num];
  }
  
  return '第' + numberToChinese(num);
}

