/**
 * 交易配置
 */

// ==================== 交易配置 ====================
export const TRANSACTION_CONFIG = {
  DEFAULT_GAS_LIMIT: 21000,
  TOKEN_TRANSFER_GAS_LIMIT: 65000,
  CONTRACT_INTERACTION_GAS_LIMIT: 100000,
  CONFIRMATION_BLOCKS: 1,
  MAX_CONFIRMATIONS: 12
};

// ==================== Gas 配置 ====================
export const GAS_CONFIG = {
  // Gas 价格级别（Gwei）
  PRICE_LEVELS: {
    slow: {
      label: 'Slow',
      multiplier: 0.8,
      estimatedTime: '> 10 min'
    },
    standard: {
      label: 'Standard',
      multiplier: 1.0,
      estimatedTime: '~ 5 min'
    },
    fast: {
      label: 'Fast',
      multiplier: 1.2,
      estimatedTime: '< 2 min'
    },
    instant: {
      label: 'Instant',
      multiplier: 1.5,
      estimatedTime: '< 30 sec'
    }
  },

  // Gas 限制
  MIN_GAS_LIMIT: 21000,
  MAX_GAS_LIMIT: 10000000,
  
  // Gas 价格限制（Gwei）
  MIN_GAS_PRICE: 1,
  MAX_GAS_PRICE: 1000,
  
  // EIP-1559 配置
  EIP1559: {
    MIN_PRIORITY_FEE: 1,
    MAX_PRIORITY_FEE: 100,
    MIN_MAX_FEE: 1,
    MAX_MAX_FEE: 1000
  }
};

// ==================== 交易类型 ====================
export const TRANSACTION_TYPES = {
  SEND: 'send',
  TOKEN_TRANSFER: 'token_transfer',
  CONTRACT_INTERACTION: 'contract_interaction',
  APPROVE: 'approve',
  SWAP: 'swap'
};

// ==================== 交易状态 ====================
export const TRANSACTION_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REPLACED: 'replaced'
};

// ==================== 工具函数 ====================

/**
 * 获取默认 Gas 限制
 * @param {string} type - 交易类型
 * @returns {number}
 */
export function getDefaultGasLimit(type = TRANSACTION_TYPES.SEND) {
  switch (type) {
    case TRANSACTION_TYPES.SEND:
      return TRANSACTION_CONFIG.DEFAULT_GAS_LIMIT;
    case TRANSACTION_TYPES.TOKEN_TRANSFER:
      return TRANSACTION_CONFIG.TOKEN_TRANSFER_GAS_LIMIT;
    case TRANSACTION_TYPES.CONTRACT_INTERACTION:
      return TRANSACTION_CONFIG.CONTRACT_INTERACTION_GAS_LIMIT;
    default:
      return TRANSACTION_CONFIG.DEFAULT_GAS_LIMIT;
  }
}

/**
 * 计算 Gas 价格
 * @param {number} basePrice - 基础价格（Gwei）
 * @param {string} level - 价格级别
 * @returns {number}
 */
export function calculateGasPrice(basePrice, level = 'standard') {
  const config = GAS_CONFIG.PRICE_LEVELS[level];
  if (!config) return basePrice;
  
  return Math.ceil(basePrice * config.multiplier);
}

/**
 * 验证 Gas 限制
 * @param {number} gasLimit - Gas 限制
 * @returns {{valid: boolean, error?: string}}
 */
export function validateGasLimit(gasLimit) {
  if (gasLimit < GAS_CONFIG.MIN_GAS_LIMIT) {
    return {
      valid: false,
      error: `Gas limit must be at least ${GAS_CONFIG.MIN_GAS_LIMIT}`
    };
  }

  if (gasLimit > GAS_CONFIG.MAX_GAS_LIMIT) {
    return {
      valid: false,
      error: `Gas limit must not exceed ${GAS_CONFIG.MAX_GAS_LIMIT}`
    };
  }
  
  return { valid: true };
}

/**
 * 验证 Gas 价格
 * @param {number} gasPrice - Gas 价格（Gwei）
 * @returns {{valid: boolean, error?: string}}
 */
export function validateGasPrice(gasPrice) {
  if (gasPrice < GAS_CONFIG.MIN_GAS_PRICE) {
    return {
      valid: false,
      error: `Gas price must be at least ${GAS_CONFIG.MIN_GAS_PRICE} Gwei`
    };
  }

  if (gasPrice > GAS_CONFIG.MAX_GAS_PRICE) {
    return {
      valid: false,
      error: `Gas price must not exceed ${GAS__CONFIG.MAX_GAS_PRICE} Gwei`
    };
  }
  
  return { valid: true };
}

/**
 * 计算交易费用
 * @param {number} gasLimit - Gas 限制
 * @param {number} gasPrice - Gas 价格（Gwei）
 * @returns {string} 费用（ETH）
 */
export function calculateTransactionFee(gasLimit, gasPrice) {
  // gasPrice 是 Gwei，需要转换为 Wei
  const gasPriceWei = gasPrice * 1e9;
  const feeWei = gasLimit * gasPriceWei;
  const feeEth = feeWei / 1e18;
  
  return feeEth.toString();
}

/**
 * 计算 EIP-1559 交易费用
 * @param {number} gasLimit - Gas 限制
 * @param {number} maxFeePerGas - 最大费用（Gwei）
 * @param {number} maxPriorityFeePerGas - 最大优先费用（Gwei）
 * @returns {Object}
 */
export function calculateEIP1559Fee(gasLimit, maxFeePerGas, maxPriorityFeePerGas) {
  const maxFeeWei = maxFeePerGas * 1e9;
  const priorityFeeWei = maxPriorityFeePerGas * 1e9;
  
  const maxFeeTotal = (gasLimit * maxFeeWei) / 1e18;
  const priorityFeeTotal = (gasLimit * priorityFeeWei) / 1e18;

  return {
    maxFee: maxFeeTotal.toString(),
    priorityFee: priorityFeeTotal.toString(),
    estimatedFee: maxFeeTotal.toString()
  };
}

/**
 * 验证 EIP-1559 费用
 * @param {number} maxFeePerGas - 最大费用（Gwei）
 * @param {number} maxPriorityFeePerGas - 最大优先费用（Gwei）
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateEIP1559Fee(maxFeePerGas, maxPriorityFeePerGas) {
  const errors = [];
  
  if (maxPriorityFeePerGas < GAS_CONFIG.EIP1559.MIN_PRIORITY_FEE) {
    errors.push(`Priority fee must be at least ${GAS_CONFIG.EIP1559.MIN_PRIORITY_FEE} Gwei`);
  }
  
  if (maxPriorityFeePerGas > GAS_CONFIG.EIP1559.MAX_PRIORITY_FEE) {
    errors.push(`Priority fee must not exceed ${GAS_CONFIG.EIP1559.MAX_PRIORITY_FEE} Gwei`);
  }
  
  if (maxFeePerGas < GAS_CONFIG.EIP1559.MIN_MAX_FEE) {
    errors.push(`Max fee must be at least ${GAS_CONFIG.EIP1559.MIN_MAX_FEE} Gwei`);
  }

  if (maxFeePerGas > GAS_CONFIG.EIP1559.MAX_MAX_FEE) {
    errors.push(`Max fee must not exceed ${GAS_CONFIG.EIP1559.MAX_MAX_FEE} Gwei`);
  }
  
  if (maxPriorityFeePerGas > maxFeePerGas) {
    errors.push('Priority fee cannot exceed max fee');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 格式化交易状态
 * @param {string} status - 状态
 * @returns {Object}
 */
export function formatTransactionStatus(status) {
  const statusMap = {
    [TRANSACTION_STATUS.PENDING]: {
      label: 'Pending',
      color: 'warning',
      icon: 'clock'
    },
    [TRANSACTION_STATUS.CONFIRMED]: {
      label: 'Confirmed',
      color: 'success',
      icon: 'check'
    },
    [TRANSACTION_STATUS.FAILED]: {
      label: 'Failed',
      color: 'danger',
      icon: 'x'
    },
    [TRANSACTION_STATUS.CANCELLED]: {
      label: 'Cancelled',
      color: 'secondary',
      icon: 'ban'
    },
    [TRANSACTION_STATUS.REPLACED]: {
      label: 'Replaced',
      color: 'info',
      icon: 'refresh'
    }
  };
  
  return statusMap[status] || statusMap[TRANSACTION_STATUS.PENDING];
}

/**
 * 估算交易确认时间
 * @param {string} level - Gas 价格级别
 * @returns {string}
 */
export function estimateConfirmationTime(level = 'standard') {
  const config = GAS_CONFIG.PRICE_LEVELS[level];
  return config ? config.estimatedTime : '~ 5 min';
}

/**
 * 获取所有 Gas 价格级别
 * @returns {Array<Object>}
 */
export function getGasPriceLevels() {
  return Object.entries(GAS_CONFIG.PRICE_LEVELS).map(([key, value]) => ({
    key,
    ...value
  }));
}
