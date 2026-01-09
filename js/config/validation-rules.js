/**
 * 验证规则配置
 */

// ==================== 地址验证规则 ====================
export const ADDRESS_VALIDATION = {
  ETHEREUM: {
    pattern: /^0x[a-fA-F0-9]{40}$/,
    checksum: true
  },
  BITCOIN: {
    pattern: /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
    checksum: false
  }
};

// ==================== 交易验证规则 ====================
export const TRANSACTION_VALIDATION = {
  MIN_VALUE: '0',
  MAX_VALUE: '1000000000',  // 10亿
  MIN_GAS_LIMIT: 21000,
  MAX_GAS_LIMIT: 10000000,
  MIN_GAS_PRICE: 1,         // Gwei
  MAX_GAS_PRICE: 1000,      // Gwei
  REQUIRE_DATA_FOR_CONTRACT: true,
  ALLOW_ZERO_VALUE: true
};

// ==================== 网络验证规则 ====================
export const NETWORK_VALIDATION = {
  NAME: {
    MIN_LENGTH: 1,
    MAX_LENGTH: 50,
    PATTERN: /^([a-zA-Z0-9\s\-_]|[\u4e00-\u9fff])+$/
  },
  RPC_URL: {
    PATTERN: /^https?:\/\/.+/,
    REQUIRE_HTTPS: false
  },
  CHAIN_ID: {
    MIN: 1,
    MAX: 4294967295  // 2^32 - 1
  },
  SYMBOL: {
    MIN_LENGTH: 1,
    MAX_LENGTH: 11,
    PATTERN: /^[A-Z0-9]+$/
  }
};

// ==================== 代币验证规则 ====================
export const TOKEN_VALIDATION = {
  ADDRESS: {
    PATTERN: /^0x[a-fA-F0-9]{40}$/,
    CHECKSUM: true
  },
  SYMBOL: {
    MIN_LENGTH: 1,
    MAX_LENGTH: 11,
    PATTERN: /^[A-Z0-9]+$/
  },
  NAME: {
    MIN_LENGTH: 1,
    MAX_LENGTH: 50
  },
  DECIMALS: {
    MIN: 0,
    MAX: 18
  }
};

// ==================== 输入验证规则 ====================
export const INPUT_VALIDATION = {
  ACCOUNT_NAME: {
    MIN_LENGTH: 1,
    MAX_LENGTH: 50,
    PATTERN: /^([a-zA-Z0-9\s\-_]|[\u4e00-\u9fff])+$/
  },
  CONTACT_NAME: {
    MIN_LENGTH: 1,
    MAX_LENGTH: 50,
    PATTERN: /^([a-zA-Z0-9\s\-_]|[\u4e00-\u9fff])+$/
  },
  LABEL: {
    MIN_LENGTH: 1,
    MAX_LENGTH: 30,
    PATTERN: /^([a-zA-Z0-9\s\-_]|[\u4e00-\u9fff])+$/
  },
  NOTE: {
    MIN_LENGTH: 0,
    MAX_LENGTH: 500
  }
};

// ==================== 工具函数 ====================



/**
 * 验证以太坊地址
 * @param {string} address - 地址
 * @param {boolean} requireChecksum - 是否需要校验和
 * @returns {{valid: boolean, error?: string}}
 */
export function validateEthereumAddress(address, requireChecksum = false) {
  if (!address) {
    return { valid: false, error: 'Address is required' };
  }
  
  // 基本格式检查
  if (!ADDRESS_VALIDATION.ETHEREUM.pattern.test(address)) {
    return { valid: false, error: 'Invalid address format' };
  }
  
  // 校验和检查（如果需要）
  if (requireChecksum && ADDRESS_VALIDATION.ETHEREUM.checksum) {
    // 这里需要实现 EIP-55 校验和验证
    // 简化版本，实际应该使用 ethers.js 或 web3.js
    const hasUpperCase = /[A-F]/.test(address.slice(2));
    const hasLowerCase = /[a-f]/.test(address.slice(2));
    
    if (hasUpperCase && hasLowerCase) {
      // 有大小写混合，需要验证校验和
      // 这里应该调用实际的校验和验证函数
      console.warn('Checksum validation not fully implemented');
    }
  }
  
  return { valid: true };
}

/**
 * 验证交易参数
 * @param {Object} transaction - 交易对象
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateTransaction(transaction) {
  const errors = [];
  
  // 验证接收地址
  if (!transaction.to) {
    errors.push('Recipient address is required');
  } else {
    const addressValidation = validateEthereumAddress(transaction.to);
    if (!addressValidation.valid) {
      errors.push(addressValidation.error);
    }
  }
  
  // 验证金额
  if (transaction.value !== undefined) {
    const value = parseFloat(transaction.value);
    if (isNaN(value) || value < 0) {
      errors.push('Invalid transaction value');
    }
    
    if (!TRANSACTION_VALIDATION.ALLOW_ZERO_VALUE && value === 0) {
      errors.push('Transaction value cannot be zero');
    }
  }
  
  // 验证 Gas 限制
  if (transaction.gasLimit) {
    const gasLimit = parseInt(transaction.gasLimit);
    if (isNaN(gasLimit)) {
      errors.push('Invalid gas limit');
    } else {
      if (gasLimit < TRANSACTION_VALIDATION.MIN_GAS_LIMIT) {
        errors.push(`Gas limit must be at least ${TRANSACTION_VALIDATION.MIN_GAS_LIMIT}`);
      }
      if (gasLimit > TRANSACTION_VALIDATION.MAX_GAS_LIMIT) {
        errors.push(`Gas limit must not exceed ${TRANSACTION_VALIDATION.MAX_GAS_LIMIT}`);
      }
    }
  }
  
  // 验证 Gas 价格
  if (transaction.gasPrice) {
    const gasPrice = parseFloat(transaction.gasPrice);
    if (isNaN(gasPrice)) {
      errors.push('Invalid gas price');
    } else {
      if (gasPrice < TRANSACTION_VALIDATION.MIN_GAS_PRICE) {
        errors.push(`Gas price must be at least ${TRANSACTION_VALIDATION.MIN_GAS_PRICE} Gwei`);
      }
      if (gasPrice > TRANSACTION_VALIDATION.MAX_GAS_PRICE) {
        errors.push(`Gas price must not exceed ${TRANSACTION_VALIDATION.MAX_GAS_PRICE} Gwei`);
      }
    }
  }
  
  // 验证数据字段（合约交互）
  if (TRANSACTION_VALIDATION.REQUIRE_DATA_FOR_CONTRACT && transaction.data && transaction.data !== '0x') {
    if (!/^0x[0-9a-fA-F]*$/.test(transaction.data)) {
      errors.push('Invalid transaction data format');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 验证网络配置
 * @param {Object} network - 网络配置
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateNetworkConfig(network) {
  const errors = [];
  
  // 验证名称
  if (!network.name) {
    errors.push('Network name is required');
  } else {
    if (network.name.length < NETWORK_VALIDATION.NAME.MIN_LENGTH) {
      errors.push(`Network name must be at least ${NETWORK_VALIDATION.NAME.MIN_LENGTH} character`);
    }
    if (network.name.length > NETWORK_VALIDATION.NAME.MAX_LENGTH) {
      errors.push(`Network name must not exceed ${NETWORK_VALIDATION.NAME.MAX_LENGTH} characters`);
    }
    if (!NETWORK_VALIDATION.NAME.PATTERN.test(network.name)) {
      errors.push('Network name contains invalid characters');
    }
  }
  
  // 验证 RPC URL
  if (!network.rpcUrl && !network.rpc) {
    errors.push('RPC URL is required');
  } else {
    const rpcUrl = network.rpcUrl || network.rpc;
    if (!NETWORK_VALIDATION.RPC_URL.PATTERN.test(rpcUrl)) {
      errors.push('Invalid RPC URL format');
    }
    if (NETWORK_VALIDATION.RPC_URL.REQUIRE_HTTPS && !rpcUrl.startsWith('https://')) {
      errors.push('RPC URL must use HTTPS');
    }
  }
  
  // 验证 Chain ID
  if (!network.chainId) {
    errors.push('Chain ID is required');
  } else {
    const chainId = typeof network.chainId === 'string' && network.chainId.startsWith('0x')
      ? parseInt(network.chainId, 16)
      : parseInt(network.chainId, 10);
    
    if (isNaN(chainId)) {
      errors.push('Invalid chain ID');
    } else {
      if (chainId < NETWORK_VALIDATION.CHAIN_ID.MIN) {
        errors.push(`Chain ID must be at least ${NETWORK_VALIDATION.CHAIN_ID.MIN}`);
      }
      if (chainId > NETWORK_VALIDATION.CHAIN_ID.MAX) {
        errors.push(`Chain ID must not exceed ${NETWORK_VALIDATION.CHAIN_ID.MAX}`);
      }
    }
  }
  
  // 验证货币符号
  if (!network.symbol) {
    errors.push('Currency symbol is required');
  } else {
    if (network.symbol.length < NETWORK_VALIDATION.SYMBOL.MIN_LENGTH) {
      errors.push(`Symbol must be at least ${NETWORK_VALIDATION.SYMBOL.MIN_LENGTH} character`);
    }
    if (network.symbol.length > NETWORK_VALIDATION.SYMBOL.MAX_LENGTH) {
      errors.push(`Symbol must not exceed ${NETWORK_VALIDATION.SYMBOL.MAX_LENGTH} characters`);
    }
    if (!NETWORK_VALIDATION.SYMBOL.PATTERN.test(network.symbol)) {
      errors.push('Symbol must contain only uppercase letters and numbers');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 验证代币配置
 * @param {Object} token - 代币配置
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateTokenConfig(token) {
  const errors = [];
  
  // 验证地址
  if (!token.address) {
    errors.push('Token address is required');
  } else {
    const addressValidation = validateEthereumAddress(token.address, TOKEN_VALIDATION.ADDRESS.CHECKSUM);
    if (!addressValidation.valid) {
      errors.push(addressValidation.error);
    }
  }
  
  // 验证符号
  if (!token.symbol) {
    errors.push('Token symbol is required');
  } else {
    if (token.symbol.length < TOKEN_VALIDATION.SYMBOL.MIN_LENGTH) {
      errors.push(`Symbol must be at least ${TOKEN_VALIDATION.SYMBOL.MIN_LENGTH} character`);
    }
    if (token.symbol.length > TOKEN_VALIDATION.SYMBOL.MAX_LENGTH) {
      errors.push(`Symbol must not exceed ${TOKEN_VALIDATION.SYMBOL.MAX_LENGTH} characters`);
    }
    if (!TOKEN_VALIDATION.SYMBOL.PATTERN.test(token.symbol)) {
      errors.push('Symbol must contain only uppercase letters and numbers');
    }
  }
  
  // 验证名称
  if (token.name) {
    if (token.name.length < TOKEN_VALIDATION.NAME.MIN_LENGTH) {
      errors.push(`Name must be at least ${TOKEN_VALIDATION.NAME.MIN_LENGTH} character`);
    }
    if (token.name.length > TOKEN_VALIDATION.NAME.MAX_LENGTH) {
      errors.push(`Name must not exceed ${TOKEN_VALIDATION.NAME.MAX_LENGTH} characters`);
    }
  }
  
  // 验证小数位数
  if (token.decimals !== undefined) {
    const decimals = parseInt(token.decimals);
    if (isNaN(decimals)) {
      errors.push('Invalid decimals value');
    } else {
      if (decimals < TOKEN_VALIDATION.DECIMALS.MIN) {
        errors.push(`Decimals must be at least ${TOKEN_VALIDATION.DECIMALS.MIN}`);
      }
      if (decimals > TOKEN_VALIDATION.DECIMALS.MAX) {
        errors.push(`Decimals must not exceed ${TOKEN_VALIDATION.DECIMALS.MAX}`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 验证账户名称
 * @param {string} name - 账户名称
 * @returns {{valid: boolean, error?: string}}
 */
export function validateAccountName(name) {
  if (!name) {
    return { valid: false, error: 'Account name is required' };
  }
  
  if (name.length < INPUT_VALIDATION.ACCOUNT_NAME.MIN_LENGTH) {
    return { valid: false, error: `Name must be at least ${INPUT_VALIDATION.ACCOUNT_NAME.MIN_LENGTH} character` };
  }
  
  if (name.length > INPUT_VALIDATION.ACCOUNT_NAME.MAX_LENGTH) {
    return { valid: false, error: `Name must not exceed ${INPUT_VALIDATION.ACCOUNT_NAME.MAX_LENGTH} characters` };
  }
  
  if (!INPUT_VALIDATION.ACCOUNT_NAME.PATTERN.test(name)) {
    return { valid: false, error: 'Name contains invalid characters' };
  }
  
  return { valid: true };
}

/**
 * 验证联系人名称
 * @param {string} name - 联系人名称
 * @returns {{valid: boolean, error?: string}}
 */
export function validateContactName(name) {
  if (!name) {
    return { valid: false, error: 'Contact name is required' };
  }
  
  if (name.length < INPUT_VALIDATION.CONTACT_NAME.MIN_LENGTH) {
    return { valid: false, error: `Name must be at least ${INPUT_VALIDATION.CONTACT_NAME.MIN_LENGTH} character` };
  }
  
  if (name.length > INPUT_VALIDATION.CONTACT_NAME.MAX_LENGTH) {
    return { valid: false, error: `Name must not exceed ${INPUT_VALIDATION.CONTACT_NAME.MAX_LENGTH} characters` };
  }
  
  if (!INPUT_VALIDATION.CONTACT_NAME.PATTERN.test(name)) {
    return { valid: false, error: 'Name contains invalid characters' };
  }
  
  return { valid: true };
}

/**
 * 验证标签
 * @param {string} label - 标签
 * @returns {{valid: boolean, error?: string}}
 */
export function validateLabel(label) {
  if (!label) {
    return { valid: true }; // 标签是可选的
  }
  
  if (label.length < INPUT_VALIDATION.LABEL.MIN_LENGTH) {
    return { valid: false, error: `Label must be at least ${INPUT_VALIDATION.LABEL.MIN_LENGTH} character` };
  }
  
  if (label.length > INPUT_VALIDATION.LABEL.MAX_LENGTH) {
    return { valid: false, error: `Label must not exceed ${INPUT_VALIDATION.LABEL.MAX_LENGTH} characters` };
  }
  
  if (!INPUT_VALIDATION.LABEL.PATTERN.test(label)) {
    return { valid: false, error: 'Label contains invalid characters' };
  }
  
  return { valid: true };
}

/**
 * 验证备注
 * @param {string} note - 备注
 * @returns {{valid: boolean, error?: string}}
 */
export function validateNote(note) {
  if (!note) {
    return { valid: true }; // 备注是可选的
  }
  
  if (note.length > INPUT_VALIDATION.NOTE.MAX_LENGTH) {
    return { valid: false, error: `Note must not exceed ${INPUT_VALIDATION.NOTE.MAX_LENGTH} characters` };
  }
  
  return { valid: true };
}

/**
 * 清理输入字符串
 * @param {string} input - 输入字符串
 * @returns {string}
 */
export function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  
  return input
    .trim()
    .replace(/\s+/g, ' ')  // 多个空格替换为单个
    .replace(/[<>]/g, ''); // 移除潜在的 HTML 标签
}

/**
 * 验证 URL
 * @param {string} url - URL
 * @returns {{valid: boolean, error?: string}}
 */
export function validateUrl(url) {
  if (!url) {
    return { valid: false, error: 'URL is required' };
  }
  
  try {
    new URL(url);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/**
 * 验证数字范围
 * @param {number} value - 值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {{valid: boolean, error?: string}}
 */
export function validateNumberRange(value, min, max) {
  if (typeof value !== 'number' || isNaN(value)) {
    return { valid: false, error: 'Invalid number' };
  }
  
  if (value < min) {
    return { valid: false, error: `Value must be at least ${min}` };
  }
  
  if (value > max) {
    return { valid: false, error: `Value must not exceed ${max}` };
  }
  
  return { valid: true };
}
