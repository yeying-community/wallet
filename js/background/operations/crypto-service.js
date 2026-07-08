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
import { base64Encode, normalizeBinaryInput, stringToBytes } from '../../common/crypto/crypto-utils.js';
import { getWalletInstance } from '../keyring.js';

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

function hexToBytes(hex) {
  const normalized = String(hex || '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw createInvalidParams('wallet private key is unavailable');
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    out[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return out;
}

function normalizePasswordSource(value) {
  const source = String(value || 'manual').trim();
  if (source === 'manual' || source === 'wallet' || source === 'wallet+password') {
    return source;
  }
  throw createInvalidParams('unsupported passwordSource');
}

function normalizePasswordContext(origin, account, value) {
  const context = String(value || '').trim();
  const address = String(account?.address || '').trim().toLowerCase();
  return [
    'yeying-wallet-encryption-v1',
    `origin:${String(origin || '').trim()}`,
    `account:${address}`,
    `context:${context || 'default'}`
  ].join('\n');
}

async function derivePasswordFromWallet(origin, account, passwordContext, extraPassword = '') {
  if (!account?.id) {
    throw createInvalidParams('account is required');
  }
  const wallet = getWalletInstance(account.id);
  const privateKey = wallet?.privateKey;
  if (typeof privateKey !== 'string' || privateKey.length === 0) {
    throw createInvalidParams('wallet private key is unavailable');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    hexToBytes(privateKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const message = normalizePasswordContext(origin, account, passwordContext) +
    `\nextra:${String(extraPassword || '')}`;
  const signature = await crypto.subtle.sign('HMAC', key, stringToBytes(message));
  return base64Encode(new Uint8Array(signature));
}

async function resolveEncryptionPassword(origin, account, options) {
  const source = normalizePasswordSource(options.passwordSource);
  const password = typeof options.password === 'string' ? options.password : '';

  if (source === 'manual') {
    if (!password) {
      throw createInvalidParams('password is required');
    }
    return { password, passwordSource: source };
  }

  if (source === 'wallet+password' && !password) {
    throw createInvalidParams('password is required');
  }

  return {
    password: await derivePasswordFromWallet(origin, account, options.passwordContext, password),
    passwordSource: source
  };
}

/**
 * yeying_encrypt
 * @param {string} origin
 * @param {Object} account
 * @param {Array|Object} params
 * @returns {Promise<{ciphertext: string, suite: string}>}
 */
export async function handleYeyingEncrypt(origin, account, params) {
  const options = getOptions(params);
  const { data, suite } = options;
  if (data == null) throw createInvalidParams('data is required');
  const normalizedData = normalizeBinaryInput(data);
  if (normalizedData == null) {
    throw createInvalidParams('data must be string or Uint8Array');
  }
  const { password, passwordSource } = await resolveEncryptionPassword(origin, account, options);
  const ciphertext = await encryptData({ data: normalizedData, password, suite });
  return { ciphertext, suite: suite || 'aes-256-gcm', passwordSource };
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
  const options = getOptions(params);
  const { ciphertext } = options;
  if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
    throw createInvalidParams('ciphertext is required');
  }
  const { password } = await resolveEncryptionPassword(origin, account, options);
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
