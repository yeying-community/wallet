/**
 * 加密/解密
 * 使用 AES-GCM 进行数据加密和解密
 */

import {
  AES_GCM_CONFIG,
  ENCRYPTED_DATA_FORMAT,
  CRYPTO_ERROR_MESSAGES
} from './crypto-constants.js';
import {
  stringToBytes,
  bytesToString,
  base64Encode,
  base64Decode,
  generateIV,
  concatBytes
} from './crypto-utils.js';
import { deriveKey, deriveKeyWithSalt } from './key-derivation.js';
import { createCryptoError, logError } from '../errors/index.js';

/**
 * 加密数据
 * @param {Uint8Array} data - 要加密的数据
 * @param {CryptoKey} key - 加密密钥
 * @param {Uint8Array} iv - 初始化向量
 * @returns {Promise<ArrayBuffer>}
 */
async function encryptData(data, key, iv) {
  try {
    return await crypto.subtle.encrypt(
      {
        name: AES_GCM_CONFIG.name,
        iv: iv
      },
      key,
      data
    );
  } catch (error) {
    logError('crypto-encrypt-data', error);
    throw createCryptoError(CRYPTO_ERROR_MESSAGES.ENCRYPTION_FAILED);
  }
}

/**
 * 解密数据
 * @param {Uint8Array} encryptedData - 加密的数据
 * @param {CryptoKey} key - 解密密钥
 * @param {Uint8Array} iv - 初始化向量
 * @returns {Promise<ArrayBuffer>}
 */
async function decryptData(encryptedData, key, iv) {
  try {
    return await crypto.subtle.decrypt(
      {
        name: AES_GCM_CONFIG.name,
        iv: iv
      },
      key,
      encryptedData
    );
  } catch (error) {
    logError('crypto-decrypt-data', error);
    throw createCryptoError(CRYPTO_ERROR_MESSAGES.INVALID_PASSWORD);
  }
}

/**
 * 加密字符串
 * @param {string} text - 要加密的文本
 * @param {string} password - 密码
 * @returns {Promise<string>} Base64 编码的加密数据
 */
export async function encryptString(text, password) {
  try {
    // 验证参数
    if (!text || typeof text !== 'string') {
      throw new Error('Text is required');
    }
    
    if (!password || typeof password !== 'string') {
      throw new Error(CRYPTO_ERROR_MESSAGES.PASSWORD_REQUIRED);
    }
    
    // 转换文本为字节
    const textBytes = stringToBytes(text);
    
    // 派生密钥（自动生成盐值）
    const { key, salt } = await deriveKeyWithSalt(password, ['encrypt']);

    // 生成 IV
    const iv = generateIV();
    
    // 加密
    const encrypted = await encryptData(textBytes, key, iv);
    
    // 组合: salt + iv + encrypted
    const result = concatBytes(
      salt,
      iv,
      new Uint8Array(encrypted)
    );
    
    // 转换为 Base64
    return base64Encode(result);

  } catch (error) {
    logError('crypto-encrypt-string', error);
    throw createCryptoError(CRYPTO_ERROR_MESSAGES.ENCRYPTION_FAILED);
  }
}

/**
 * 解密字符串
 * @param {string} encryptedBase64 - Base64 编码的加密数据
 * @param {string} password - 密码
 * @returns {Promise<string>} 解密后的文本
 */
export async function decryptString(encryptedBase64, password) {
  try {
    // 验证参数
    if (!encryptedBase64 || typeof encryptedBase64 !== 'string') {
      throw new Error('Encrypted data is required');
    }
    
    if (!password || typeof password !== 'string') {
      throw new Error(CRYPTO_ERROR_MESSAGES.PASSWORD_REQUIRED);
    }
    
    // Base64 解码
    const encrypted = base64Decode(encryptedBase64);
    
    // 提取 salt, iv, data
    const { saltOffset, saltLength, ivOffset, ivLength, dataOffset } = ENCRYPTED_DATA_FORMAT;
    
    const salt = encrypted.slice(saltOffset, saltOffset + saltLength);
    const iv = encrypted.slice(ivOffset, ivOffset + ivLength);
    const data = encrypted.slice(dataOffset);
    
    // 派生密钥
    const key = await deriveKey(password, salt, ['decrypt']);
    
    // 解密
    const decrypted = await decryptData(data, key, iv);
    
    // 转换为字符串
    return bytesToString(new Uint8Array(decrypted));
    
  } catch (error) {
    logError('crypto-decrypt-string', error);
    // 如果是解密失败，返回更友好的错误消息
    if (error.message.includes('password') || error.name === 'OperationError') {
      throw createCryptoError(CRYPTO_ERROR_MESSAGES.INVALID_PASSWORD);
    }
    
    throw createCryptoError(CRYPTO_ERROR_MESSAGES.DECRYPTION_FAILED);
  }
}

/**
 * 加密对象
 * @param {Object} obj - 要加密的对象
 * @param {string} password - 密码
 * @returns {Promise<string>} Base64 编码的加密数据
 */
export async function encryptObject(obj, password) {
  try {
    const json = JSON.stringify(obj);
    return await encryptString(json, password);
  } catch (error) {
    logError('crypto-encrypt-object', error);
    throw createCryptoError('Failed to encrypt object');
  }
}

/**
 * 解密对象
 * @param {string} encryptedBase64 - Base64 编码的加密数据
 * @param {string} password - 密码
 * @returns {Promise<Object>} 解密后的对象
 */
export async function decryptObject(encryptedBase64, password) {
  try {
    const json = await decryptString(encryptedBase64, password);
    return JSON.parse(json);
  } catch (error) {
    logError('crypto-decrypt-object', error);
    
    if (error.message.includes('password')) {
      throw error;
    }
    throw createCryptoError('Failed to decrypt object');
  }
}

/**
 * 批量加密
 * @param {string[]} texts - 要加密的文本数组
 * @param {string} password - 密码
 * @returns {Promise<string[]>} 加密后的数据数组
 */
export async function encryptBatch(texts, password) {
  try {
    return await Promise.all(
      texts.map(text => encryptString(text, password))
    );
  } catch (error) {
    logError('crypto-encrypt-batch', error);
    throw createCryptoError('Failed to encrypt batch');
  }
}

/**
 * 批量解密
 * @param {string[]} encryptedTexts - 加密的数据数组
 * @param {string} password - 密码
 * @returns {Promise<string[]>} 解密后的文本数组
 */
export async function decryptBatch(encryptedTexts, password) {
  try {
    return await Promise.all(
      encryptedTexts.map(encrypted => decryptString(encrypted, password))
    );
  } catch (error) {
    logError('crypto-decrypt-batch', error);
    throw createCryptoError('Failed to decrypt batch');
  }
}
