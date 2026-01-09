/**
 * 加密常量配置
 * 集中管理所有加密相关的常量
 */

// ==================== 加密算法配置 ====================

/**
 * PBKDF2 配置
 */
export const PBKDF2_CONFIG = {
  name: 'PBKDF2',
  iterations: 100000,        // 迭代次数
  hash: 'SHA-256',          // 哈希算法
  saltLength: 16            // 盐值长度（字节）
};

/**
 * AES-GCM 配置
 */
export const AES_GCM_CONFIG = {
  name: 'AES-GCM',
  length: 256,              // 密钥长度（位）
  ivLength: 12              // IV 长度（字节）
};

// ==================== 密码强度配置 ====================

/**
 * 密码要求
 */
export const PASSWORD_REQUIREMENTS = {
  minLength: 8,             // 最小长度
  recommendedLength: 12,    // 推荐长度
  strongLength: 16          // 强密码长度
};

/**
 * 密码强度等级
 */
export const PASSWORD_STRENGTH = {
  WEAK: 'weak',
  MEDIUM: 'medium',
  STRONG: 'strong',
  VERY_STRONG: 'very_strong'
};

/**
 * 密码强度规则
 */
export const PASSWORD_STRENGTH_RULES = {
  [PASSWORD_STRENGTH.WEAK]: {
    minLength: 8,
    requirements: []
  },
  [PASSWORD_STRENGTH.MEDIUM]: {
    minLength: 10,
    requirements: ['hasLetters', 'hasNumbers']
  },
  [PASSWORD_STRENGTH.STRONG]: {
    minLength: 12,
    requirements: ['hasUpperCase', 'hasLowerCase', 'hasNumbers', 'hasSpecialChars']
  },
  [PASSWORD_STRENGTH.VERY_STRONG]: {
    minLength: 16,
    requirements: ['hasUpperCase', 'hasLowerCase', 'hasNumbers', 'hasSpecialChars']
  }
};

// ==================== 助记词配置 ====================

/**
 * 助记词长度
 */
export const MNEMONIC_LENGTHS = {
  SHORT: 12,
  LONG: 24
};

/**
 * 支持的助记词长度
 */
export const VALID_MNEMONIC_LENGTHS = [
  MNEMONIC_LENGTHS.SHORT,
  MNEMONIC_LENGTHS.LONG
];

// ==================== 私钥配置 ====================

/**
 * 私钥格式
 */
export const PRIVATE_KEY_FORMAT = {
  HEX_LENGTH: 64,           // 十六进制长度（不含 0x）
  WITH_PREFIX_LENGTH: 66    // 带 0x 前缀的长度
};

// ==================== 编码配置 ====================

/**
 * 文本编码
 */
export const TEXT_ENCODING = 'utf-8';

/**
 * 加密数据格式
 * salt(16) + iv(12) + encrypted
 */
export const ENCRYPTED_DATA_FORMAT = {
  saltOffset: 0,
  saltLength: PBKDF2_CONFIG.saltLength,
  ivOffset: PBKDF2_CONFIG.saltLength,
  ivLength: AES_GCM_CONFIG.ivLength,
  dataOffset: PBKDF2_CONFIG.saltLength + AES_GCM_CONFIG.ivLength
};

// ==================== 错误消息 ====================

/**
 * 加密错误消息
 */
export const CRYPTO_ERROR_MESSAGES = {
  // 加密/解密
  ENCRYPTION_FAILED: 'Encryption failed',
  DECRYPTION_FAILED: 'Decryption failed',
  INVALID_PASSWORD: 'Invalid password or corrupted data',
  
  // 密码验证
  PASSWORD_REQUIRED: 'Password is required',
  PASSWORD_TOO_SHORT: `Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters`,
  PASSWORD_WEAK: 'Password is too weak',
  
  // 助记词验证
  MNEMONIC_REQUIRED: 'Mnemonic phrase is required',
  MNEMONIC_INVALID_LENGTH: `Mnemonic must be ${MNEMONIC_LENGTHS.SHORT} or ${MNEMONIC_LENGTHS.LONG} words`,
  MNEMONIC_INVALID_FORMAT: 'Invalid mnemonic phrase format',
  
  // 私钥验证
  PRIVATE_KEY_REQUIRED: 'Private key is required',
  PRIVATE_KEY_INVALID_FORMAT: 'Invalid private key format',
  PRIVATE_KEY_INVALID_LENGTH: 'Invalid private key length',
  
  // 密钥派生
  KEY_DERIVATION_FAILED: 'Key derivation failed',
  INVALID_SALT: 'Invalid salt value'
};

