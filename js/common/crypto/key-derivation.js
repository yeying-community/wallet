/**
 * 密钥派生
 * 使用 PBKDF2 从密码派生加密密钥
 */

import { PBKDF2_CONFIG, AES_GCM_CONFIG, CRYPTO_ERROR_MESSAGES } from './crypto-constants.js';
import { stringToBytes, generateSalt } from './crypto-utils.js';
import { createCryptoError, logError } from '../errors/index.js';

/**
 * 导入密码作为密钥材料
 * @param {string} password - 密码
 * @returns {Promise<CryptoKey>}
 */
async function importPasswordKey(password) {
  try {
    const passwordBytes = stringToBytes(password);

    return await crypto.subtle.importKey(
      'raw',
      passwordBytes,
      { name: PBKDF2_CONFIG.name },
      false,
      ['deriveBits', 'deriveKey']
    );
  } catch (error) {
    logError('crypto-import-password', error);
    throw createCryptoError('Failed to import password key');
  }
}

/**
 * 派生加密密钥
 * @param {string} password - 密码
 * @param {Uint8Array} salt - 盐值
 * @param {string[]} keyUsages - 密钥用途 ['encrypt', 'decrypt']
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKey(password, salt, keyUsages = ['encrypt', 'decrypt']) {
  try {
    // 验证参数
    if (!password || typeof password !== 'string') {
      throw new Error(CRYPTO_ERROR_MESSAGES.PASSWORD_REQUIRED);
    }

    if (!salt || !(salt instanceof Uint8Array)) {
      throw new Error(CRYPTO_ERROR_MESSAGES.INVALID_SALT);
    }

    // 导入密码
    const passwordKey = await importPasswordKey(password);

    // 派生密钥
    const key = await crypto.subtle.deriveKey(
      {
        name: PBKDF2_CONFIG.name,
        salt: salt,
        iterations: PBKDF2_CONFIG.iterations,
        hash: PBKDF2_CONFIG.hash
      },
      passwordKey,
      {
        name: AES_GCM_CONFIG.name,
        length: AES_GCM_CONFIG.length
      },
      false,
      keyUsages
    );

    return key;

  } catch (error) {
    logError('crypto-derive-key', error);
    throw createCryptoError(CRYPTO_ERROR_MESSAGES.KEY_DERIVATION_FAILED);
  }
}

/**
 * 派生加密密钥（自动生成盐值）
 * @param {string} password - 密码
 * @param {string[]} keyUsages - 密钥用途
 * @returns {Promise<{key: CryptoKey, salt: Uint8Array}>}
 */
export async function deriveKeyWithSalt(password, keyUsages = ['encrypt', 'decrypt']) {
  const salt = generateSalt();
  const key = await deriveKey(password, salt, keyUsages);

  return { key, salt };
}

/**
 * 派生多个密钥（用于不同目的）
 * @param {string} password - 密码
 * @param {Uint8Array} salt - 盐值
 * @returns {Promise<{encryptKey: CryptoKey, authKey: CryptoKey}>}
 */
export async function deriveMultipleKeys(password, salt) {
  try {
    const passwordKey = await importPasswordKey(password);

    // 派生加密密钥
    const encryptKey = await crypto.subtle.deriveKey(
      {
        name: PBKDF2_CONFIG.name,
        salt: salt,
        iterations: PBKDF2_CONFIG.iterations,
        hash: PBKDF2_CONFIG.hash
      },
      passwordKey,
      {
        name: AES_GCM_CONFIG.name,
        length: AES_GCM_CONFIG.length
      },
      false,
      ['encrypt', 'decrypt']
    );

    // 使用不同的盐值派生认证密钥
    const authSalt = new Uint8Array(salt);
    authSalt[0] ^= 0xFF; // 修改第一个字节

    const authKey = await crypto.subtle.deriveKey(
      {
        name: PBKDF2_CONFIG.name,
        salt: authSalt,
        iterations: PBKDF2_CONFIG.iterations,
        hash: PBKDF2_CONFIG.hash
      },
      passwordKey,
      {
        name: 'HMAC',
        hash: PBKDF2_CONFIG.hash
      },
      false,
      ['sign', 'verify']
    );

    return { encryptKey, authKey };

  } catch (error) {
    logError('crypto-derive-multiple-keys', error);
    throw createCryptoError('Failed to derive multiple keys');
  }
}

/**
 * 派生位（用于生成其他密钥材料）
 * @param {string} password - 密码
 * @param {Uint8Array} salt - 盐值
 * @param {number} length - 位长度
 * @returns {Promise<ArrayBuffer>}
 */
export async function deriveBits(password, salt, length = 256) {
  try {
    const passwordKey = await importPasswordKey(password);

    return await crypto.subtle.deriveBits(
      {
        name: PBKDF2_CONFIG.name,
        salt: salt,
        iterations: PBKDF2_CONFIG.iterations,
        hash: PBKDF2_CONFIG.hash
      },
      passwordKey,
      length
    );

  } catch (error) {
    logError('crypto-derive-bits', error);
    throw createCryptoError('Failed to derive bits');
  }
}

