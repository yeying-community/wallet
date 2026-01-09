/**
 * 密码相关功能
 * 密码验证、强度检查等
 */

import {
  PASSWORD_REQUIREMENTS,
  PASSWORD_STRENGTH,
  PASSWORD_STRENGTH_RULES,
  CRYPTO_ERROR_MESSAGES
} from './crypto-constants.js';
import { hashHex } from './crypto-utils.js';

/**
 * 检查密码是否包含大写字母
 * @param {string} password - 密码
 * @returns {boolean}
 */
function hasUpperCase(password) {
  return /[A-Z]/.test(password);
}

/**
 * 检查密码是否包含小写字母
 * @param {string} password - 密码
 * @returns {boolean}
 */
function hasLowerCase(password) {
  return /[a-z]/.test(password);
}

/**
 * 检查密码是否包含数字
 * @param {string} password - 密码
 * @returns {boolean}
 */
function hasNumbers(password) {
  return /[0-9]/.test(password);
}

/**
 * 检查密码是否包含字母
 * @param {string} password - 密码
 * @returns {boolean}
 */
function hasLetters(password) {
  return /[A-Za-z]/.test(password);
}

/**
 * 检查密码是否包含特殊字符
 * @param {string} password - 密码
 * @returns {boolean}
 */
function hasSpecialChars(password) {
  return /[^A-Za-z0-9]/.test(password);
}

/**
 * 检查密码要求
 * @param {string} password - 密码
 * @param {string[]} requirements - 要求列表
 * @returns {boolean}
 */
function checkRequirements(password, requirements) {
  const checks = {
    hasUpperCase: () => hasUpperCase(password),
    hasLowerCase: () => hasLowerCase(password),
    hasNumbers: () => hasNumbers(password),
    hasLetters: () => hasLetters(password),
    hasSpecialChars: () => hasSpecialChars(password)
  };

  return requirements.every(req => checks[req] && checks[req]());
}

/**
 * 计算密码强度
 * @param {string} password - 密码
 * @returns {string} 强度等级
 */
export function calculatePasswordStrength(password) {
  if (!password || password.length < PASSWORD_REQUIREMENTS.minLength) {
    return PASSWORD_STRENGTH.WEAK;
  }

  // 从最强到最弱检查
  const strengths = [
    PASSWORD_STRENGTH.VERY_STRONG,
    PASSWORD_STRENGTH.STRONG,
    PASSWORD_STRENGTH.MEDIUM,
    PASSWORD_STRENGTH.WEAK
  ];

  for (const strength of strengths) {
    const rule = PASSWORD_STRENGTH_RULES[strength];
    if (password.length >= rule.minLength && checkRequirements(password, rule.requirements)) {
      return strength;
    }
  }

  return PASSWORD_STRENGTH.WEAK;
}

/**
 * 验证密码
 * @param {string} password - 密码
 * @param {Object} options - 验证选项
 * @param {number} options.minLength - 最小长度
 * @param {string} options.minStrength - 最小强度
 * @returns {{valid: boolean, error?: string, strength?: string}}
 */
export function validatePassword(password, options = {}) {
  const {
    minLength = PASSWORD_REQUIREMENTS.minLength,
    minStrength = PASSWORD_STRENGTH.WEAK
  } = options;

  // 检查是否为空
  if (!password || typeof password !== 'string') {
    return {
      valid: false,
      error: CRYPTO_ERROR_MESSAGES.PASSWORD_REQUIRED
    };
  }

  // 检查长度
  if (password.length < minLength) {
    return {
      valid: false,
      error: `Password must be at least ${minLength} characters`
    };
  }

  // 计算强度
  const strength = calculatePasswordStrength(password);

  // 检查最小强度要求
  const strengthLevels = [
    PASSWORD_STRENGTH.WEAK,
    PASSWORD_STRENGTH.MEDIUM,
    PASSWORD_STRENGTH.STRONG,
    PASSWORD_STRENGTH.VERY_STRONG
  ];

  const currentLevel = strengthLevels.indexOf(strength);
  const requiredLevel = strengthLevels.indexOf(minStrength);

  if (currentLevel < requiredLevel) {
    return {
      valid: false,
      error: `Password is too weak.Required: ${minStrength}, Current: ${strength}`,
      strength
    };
  }

  return {
    valid: true,
    strength
  };
}

/**
* 获取密码强度详情
* @param {string} password - 密码
* @returns {Object} 强度详情
*/
export function getPasswordStrengthDetails(password) {
  if (!password) {
    return {
      strength: PASSWORD_STRENGTH.WEAK,
      score: 0,
      checks: {},
      suggestions: ['Enter a password']
    };
  }
  const checks = {
    length: password.length >= PASSWORD_REQUIREMENTS.minLength,
    hasUpperCase: hasUpperCase(password),
    hasLowerCase: hasLowerCase(password),
    hasNumbers: hasNumbers(password),
    hasSpecialChars: hasSpecialChars(password),
    isLongEnough: password.length >= PASSWORD_REQUIREMENTS.recommendedLength
  };

  // 计算分数
  let score = 0;
  if (checks.length) score += 20;
  if (checks.hasUpperCase) score += 15;
  if (checks.hasLowerCase) score += 15;
  if (checks.hasNumbers) score += 15;
  if (checks.hasSpecialChars) score += 20;
  if (checks.isLongEnough) score += 15;

  // 生成建议
  const suggestions = [];
  if (!checks.length) {
    suggestions.push(`Use at least ${PASSWORD_REQUIREMENTS.minLength} characters`);
  }
  if (!checks.hasUpperCase) {
    suggestions.push('Add uppercase letters (A-Z)');
  }
  if (!checks.hasLowerCase) {
    suggestions.push('Add lowercase letters (a-z)');
  }
  if (!checks.hasNumbers) {
    suggestions.push('Add numbers (0-9)');
  }
  if (!checks.hasSpecialChars) {
    suggestions.push('Add special characters (!@#%^&*)');
  }
  if (!checks.isLongEnough) {
    suggestions.push(`Use at least ${PASSWORD_REQUIREMENTS.recommendedLength} characters for better security`);
  }

  const strength = calculatePasswordStrength(password);

  return {
    strength,
    score,
    checks,
    suggestions
  };
}

/**
* 生成随机密码
* @param {number} length - 密码长度
* @param {Object} options - 选项
* @returns {string}
*/
export function generateRandomPassword(length = 16, options = {}) {
  const {
    includeUpperCase = true,
    includeLowerCase = true,
    includeNumbers = true,
    includeSpecialChars = true
  } = options;
  let charset = '';
  if (includeUpperCase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (includeLowerCase) charset += 'abcdefghijklmnopqrstuvwxyz';
  if (includeNumbers) charset += '0123456789';
  if (includeSpecialChars) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

  if (charset.length === 0) {
    throw new Error('At least one character type must be included');
  }

  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);

  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset[randomValues[i] % charset.length];
  }

  return password;
}

/**
* 验证密码确认
* @param {string} password - 密码
* @param {string} confirmPassword - 确认密码
* @returns {{valid: boolean, error?: string}}
*/
export function validatePasswordConfirmation(password, confirmPassword) {
  if (!confirmPassword) {
    return {
      valid: false,
      error: 'Please confirm your password'
    };
  }
  if (password !== confirmPassword) {
    return {
      valid: false,
      error: 'Passwords do not match'
    };
  }

  return { valid: true };
}

/**
* 哈希密码（用于存储密码验证）
* @param {string} password - 密码
* @returns {Promise<string>} 密码哈希
*/
export async function hashPassword(password) {
  return await hashHex(password, 'SHA-256');
}

/**
* 验证密码哈希
* @param {string} password - 密码
* @param {string} hash - 密码哈希
* @returns {Promise<boolean>}
*/
export async function verifyPasswordHash(password, hash) {
  const passwordHash = await hashPassword(password);
  return passwordHash === hash;
}

/**
* 检查密码是否在常见密码列表中
* @param {string} password - 密码
* @returns {boolean}
*/
export function isCommonPassword(password) {
  const commonPasswords = [
    'password', '123456', '12345678', 'qwerty', 'abc123',
    'monkey', '1234567', 'letmein', 'trustno1', 'dragon',
    'baseball', 'iloveyou', 'master', 'sunshine', 'ashley',
    'bailey', 'passw0rd', 'shadow', '123123', '654321'
  ];
  return commonPasswords.includes(password.toLowerCase());
}

/**
* 获取密码强度颜色
* @param {string} strength - 强度等级
* @returns {string} 颜色代码
*/
export function getPasswordStrengthColor(strength) {
  const colors = {
    [PASSWORD_STRENGTH.WEAK]: '#ff4444',
    [PASSWORD_STRENGTH.MEDIUM]: '#ffaa00',
    [PASSWORD_STRENGTH.STRONG]: '#00cc66',
    [PASSWORD_STRENGTH.VERY_STRONG]: '#00aa44'
  };
  return colors[strength] || colors[PASSWORD_STRENGTH.WEAK];
}

/**
* 获取密码强度文本
* @param {string} strength - 强度等级
* @returns {string} 文本描述
*/
export function getPasswordStrengthText(strength) {
  const texts = {
    [PASSWORD_STRENGTH.WEAK]: 'Weak',
    [PASSWORD_STRENGTH.MEDIUM]: 'Medium',
    [PASSWORD_STRENGTH.STRONG]: 'Strong',
    [PASSWORD_STRENGTH.VERY_STRONG]: 'Very Strong'
  };
  return texts[strength] || texts[PASSWORD_STRENGTH.WEAK];
}

