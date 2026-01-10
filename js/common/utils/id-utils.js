/**
 * ID 工具函数
 */

import { getTimestamp } from './time-utils.js';

/**
 * 生成唯一 ID
 * @param {string} prefix - ID 前缀
 * @returns {string}
 */
export function generateId(prefix = 'id') {
  const timestamp = getTimestamp();
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
  const now = getTimestamp();
  const ns = typeof process !== 'undefined' && process.hrtime ? process.hrtime()[1] : 0;
  return `n_${now}_${ns}_${Math.random().toString(36).substring(2, 9)}`;
}
