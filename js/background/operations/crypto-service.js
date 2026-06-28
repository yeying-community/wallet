/**
 * YeYing Wallet - 加密服务（DApp-facing）
 *
 * 暴露三个 EIP-1193 自定义方法给已授权站点：
 *   - yeying_encrypt          : 用命名安全套件加密
 *   - yeying_decrypt          : 解密密文
 *   - yeying_getCipherSuites  : 列出可用套件
 *
 * 模式同 ucan.js：站点已授权 + 钱包已解锁后静默执行（unlockMethods 兜底）。
 * 安全模型：站点授权即信任（DApp 责任，UCAN 同模型）；数据密码与钱包密码独立。
 */

import { createInvalidParams } from '../../common/errors/index.js';
import { encryptData, decryptData, getSupportedSuites } from '../../common/crypto/index.js';

function getOptions(params) {
  return Array.isArray(params) ? params[0] || {} : params || {};
}

function toBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(str) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(str, 'base64'));
  }
  const binary = atob(str);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * yeying_encrypt
 * @param {string} origin
 * @param {Object} account
 * @param {Array|Object} params
 * @returns {Promise<{ciphertext: string, suite: string}>}
 */
export async function handleYeyingEncrypt(origin, account, params) {
  const { data, password, suite } = getOptions(params);
  if (data == null) throw createInvalidParams('data is required');
  if (typeof password !== 'string' || password.length === 0) {
    throw createInvalidParams('password is required');
  }
  if (typeof data !== 'string' && !(data instanceof Uint8Array)) {
    throw createInvalidParams('data must be string or Uint8Array');
  }
  const ciphertext = await encryptData({ data, password, suite });
  return { ciphertext, suite: suite || 'aes-256-gcm' };
}

/**
 * yeying_decrypt
 * 返回的 plaintext 是明文 Uint8Array 的 base64 字符串，由 SDK 端还原。
 * @param {string} origin
 * @param {Object} account
 * @param {Array|Object} params
 * @returns {Promise<{plaintext: string, encoding: 'base64'}>}
 */
export async function handleYeyingDecrypt(origin, account, params) {
  const { ciphertext, password } = getOptions(params);
  if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
    throw createInvalidParams('ciphertext is required');
  }
  if (typeof password !== 'string' || password.length === 0) {
    throw createInvalidParams('password is required');
  }
  const plaintextBytes = await decryptData({ ciphertext, password });
  return { plaintext: toBase64(plaintextBytes), encoding: 'base64' };
}

/**
 * yeying_getCipherSuites
 * @returns {Promise<{suites: Array<{name: string, description: string, mode: string}>}>}
 */
export async function handleYeyingGetCipherSuites(origin, account, params) {
  return { suites: getSupportedSuites() };
}

// 导出 base64 工具供测试使用
export { toBase64, fromBase64 };
