/**
 * UI 格式化与显示工具
 */

import { UI_CONFIG, COLORS, FORMAT_CONFIG } from '../../config/ui-config.js';
import { formatLocaleDateTime, formatRelativeTimeEn } from '../utils/time-utils.js';

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
  return formatLocaleDateTime(date, config);
}

/**
 * 格式化时间
 * @param {Date|string|number} date - 日期
 * @param {Object} options - 格式化选项
 * @returns {string}
 */
export function formatTime(date, options = {}) {
  const config = { ...FORMAT_CONFIG.TIME, ...options };
  return formatLocaleDateTime(date, config);
}

/**
 * 格式化相对时间
 * @param {Date|string|number} date - 日期
 * @returns {string}
 */
export function formatRelativeTime(date) {
  return formatRelativeTimeEn(date);
}
