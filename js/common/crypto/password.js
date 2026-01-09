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
