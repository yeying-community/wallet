/**
 * 加密模块统一导出
 * 提供所有加密相关的功能
 */

// ==================== 常量 ====================
export {
  PBKDF2_CONFIG,
  AES_GCM_CONFIG,
  PASSWORD_REQUIREMENTS,
  PASSWORD_STRENGTH,
  PASSWORD_STRENGTH_RULES,
  MNEMONIC_LENGTHS,
  VALID_MNEMONIC_LENGTHS,
  PRIVATE_KEY_FORMAT,
  CRYPTO_ERROR_MESSAGES
} from './crypto-constants.js';

// ==================== 工具函数 ====================
export {
  generateRandomBytes,
  generateSalt,
  generateIV,
  stringToBytes,
  bytesToString,
  base64Encode,
  base64Decode,
  concatBytes,
  constantTimeEqual,
  secureWipe,
  hash,
  hashHex,
  verifyIntegrity
} from './crypto-utils.js';

// ==================== 密钥派生 ====================
export {
  deriveKey,
  deriveKeyWithSalt,
  deriveMultipleKeys,
  deriveBits
} from './key-derivation.js';

// ==================== 加密/解密 ====================
export {
  encryptString,
  decryptString,
  encryptObject,
  decryptObject,
  encryptBatch,
  decryptBatch
} from './encryption.js';

// ==================== 密码 ====================
export {
  calculatePasswordStrength,
  validatePassword,
  getPasswordStrengthDetails,
  generateRandomPassword,
  validatePasswordConfirmation,
  hashPassword,
  verifyPasswordHash,
  isCommonPassword,
  getPasswordStrengthColor,
  getPasswordStrengthText
} from './password.js';

// ==================== 验证 ====================
export {
  validateMnemonic,
  validatePrivateKey,
  validateAddress,
  isValidMnemonicWord,
  getMnemonicSuggestions,
  validateDerivationPath,
  generateEthereumPath,
  validateSignature
} from './validation.js';

// ==================== 便捷方法 ====================

/**
 * 快速加密（使用默认配置）
 * @param {string} text - 文本
 * @param {string} password - 密码
 * @returns {Promise<string>}
 */
export async function encrypt(text, password) {
  const { encryptString } = await import('./encryption.js');
  return await encryptString(text, password);
}

/**
 * 快速解密（使用默认配置）
 * @param {string} encrypted - 加密数据
 * @param {string} password - 密码
 * @returns {Promise<string>}
 */
export async function decrypt(encrypted, password) {
  const { decryptString } = await import('./encryption.js');
  return await decryptString(encrypted, password);
}

/**
 * 验证并加密
 * @param {string} text - 文本
 * @param {string} password - 密码
 * @param {Object} options - 验证选项
 * @returns {Promise<{success: boolean, encrypted?: string, error?: string}>}
 */
export async function validateAndEncrypt(text, password, options = {}) {
  try {
    const { validatePassword } = await import('./password.js');
    const { encryptString } = await import('./encryption.js');
    
    // 验证密码
    const validation = validatePassword(password, options);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error
      };
    }
    
    // 加密
    const encrypted = await encryptString(text, password);
    
    return {
      success: true,
      encrypted
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 验证并解密
 * @param {string} encrypted - 加密数据
 * @param {string} password - 密码
 * @returns {Promise<{success: boolean, decrypted?: string, error?: string}>}
 */
export async function validateAndDecrypt(encrypted, password) {
  try {
    const { decryptString } = await import('./encryption.js');
    
    // 解密
    const decrypted = await decryptString(encrypted, password);
    
    return {
      success: true,
      decrypted
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 生成安全密码
 * @param {Object} options - 选项
 * @returns {string}
 */
export function generateSecurePassword(options = {}) {
  const { generateRandomPassword } = require('./password.js');
  return generateRandomPassword(16, {
    includeUpperCase: true,
    includeLowerCase: true,
    includeNumbers: true,
    includeSpecialChars: true,
    ...options
  });
}
