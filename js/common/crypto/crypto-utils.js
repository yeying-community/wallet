/**
 * 加密工具函数
 * 提供基础的加密相关工具
 */

import { PBKDF2_CONFIG, AES_GCM_CONFIG, TEXT_ENCODING } from './crypto-constants.js';
import { createCryptoError, logError } from '../errors/index.js';

/**
 * 生成随机字节
 * @param {number} length - 字节长度
 * @returns {Uint8Array}
 */
export function generateRandomBytes(length) {
  try {
    return crypto.getRandomValues(new Uint8Array(length));
  } catch (error) {
    logError('crypto-generate-random', error);
    throw createCryptoError('Failed to generate random bytes');
  }
}

/**
 * 生成盐值
 * @returns {Uint8Array}
 */
export function generateSalt() {
  return generateRandomBytes(PBKDF2_CONFIG.saltLength);
}

/**
 * 生成 IV（初始化向量）
 * @returns {Uint8Array}
 */
export function generateIV() {
  return generateRandomBytes(AES_GCM_CONFIG.ivLength);
}

/**
 * 字符串转 Uint8Array
 * @param {string} str - 字符串
 * @returns {Uint8Array}
 */
export function stringToBytes(str) {
  try {
    const encoder = new TextEncoder();
    return encoder.encode(str);
  } catch (error) {
    logError('crypto-string-to-bytes', error);
    throw createCryptoError('Failed to convert string to bytes');
  }
}

/**
 * Uint8Array 转字符串
 * @param {Uint8Array} bytes - 字节数组
 * @returns {string}
 */
export function bytesToString(bytes) {
  try {
    const decoder = new TextDecoder(TEXT_ENCODING);
    return decoder.decode(bytes);
  } catch (error) {
    logError('crypto-bytes-to-string', error);
    throw createCryptoError('Failed to convert bytes to string');
  }
}

/**
 * Base64 编码
 * @param {Uint8Array} bytes - 字节数组
 * @returns {string}
 */
export function base64Encode(bytes) {
  try {
    return btoa(String.fromCharCode(...bytes));
  } catch (error) {
    logError('crypto-base64-encode', error);
    throw createCryptoError('Failed to encode base64');
  }
}

/**
 * Base64 解码
 * @param {string} base64 - Base64 字符串
 * @returns {Uint8Array}
 */
export function base64Decode(base64) {
  try {
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  } catch (error) {
    logError('crypto-base64-decode', error);
    throw createCryptoError('Failed to decode base64');
  }
}

/**
 * 合并字节数组
 * @param {...Uint8Array} arrays - 字节数组
 * @returns {Uint8Array}
 */
export function concatBytes(...arrays) {
  try {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    
    return result;
  } catch (error) {
    logError('crypto-concat-bytes', error);
    throw createCryptoError('Failed to concatenate bytes');
  }
}

/**
 * 比较两个字节数组是否相等（常量时间比较）
 * @param {Uint8Array} a - 字节数组 A
 * @param {Uint8Array} b - 字节数组 B
 * @returns {boolean}
 */
export function constantTimeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  
  return result === 0;
}

/**
 * 安全清除敏感数据
 * @param {Uint8Array} data - 要清除的数据
 */
export function secureWipe(data) {
  if (data instanceof Uint8Array) {
    crypto.getRandomValues(data);
    data.fill(0);
  }
}

/**
 * 生成哈希
 * @param {string|Uint8Array} data - 数据
 * @param {string} algorithm - 哈希算法（默认 SHA-256）
 * @returns {Promise<Uint8Array>}
 */
export async function hash(data, algorithm = 'SHA-256') {
  try {
    const bytes = typeof data === 'string' ? stringToBytes(data) : data;
    const hashBuffer = await crypto.subtle.digest(algorithm, bytes);
    return new Uint8Array(hashBuffer);
  } catch (error) {
    logError('crypto-hash', error);
    throw createCryptoError('Failed to generate hash');
  }
}

/**
 * 生成哈希（十六进制字符串）
 * @param {string|Uint8Array} data - 数据
 * @param {string} algorithm - 哈希算法
 * @returns {Promise<string>}
 */
export async function hashHex(data, algorithm = 'SHA-256') {
  const hashBytes = await hash(data, algorithm);
  return Array.from(hashBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 验证数据完整性
 * @param {string|Uint8Array} data - 数据
 * @param {string} expectedHash - 期望的哈希值
 * @param {string} algorithm - 哈希算法
 * @returns {Promise<boolean>}
 */
export async function verifyIntegrity(data, expectedHash, algorithm = 'SHA-256') {
  try {
    const actualHash = await hashHex(data, algorithm);
    return actualHash === expectedHash;
  } catch (error) {
    logError('crypto-verify-integrity', error);
    return false;
  }
}

