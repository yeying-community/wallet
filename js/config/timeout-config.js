/**
 * 超时配置
 */

import { getTimestamp } from '../common/utils/time-utils.js';

// ==================== 超时设置 ====================
export const TIMEOUTS = {
  REQUEST: 60000,        // 普通请求超时（毫秒）
  TRANSACTION: 300000,   // 交易超时（5分钟）
  SIGNATURE: 300000,     // 签名超时（5分钟）
  UNLOCK: 1800000,       // 解锁超时（30分钟）
  RECONNECT: 5000,       // 重连超时
  PASSWORD: 60000,       // 密码输入超时（1分钟）
  RPC: 30000,           // RPC 请求超时
  APPROVAL: 600000,      // 审批超时（10分钟）
  SESSION: 3600000      // 会话超时（1小时）
};

// ==================== 重连配置 ====================
export const RECONNECT_CONFIG = {
  MAX_ATTEMPTS: 3,
  INITIAL_DELAY: 1000,
  MAX_DELAY: 5000,
  BACKOFF_MULTIPLIER: 2,
  RESET_TIMEOUT: 60000  // 重置重连计数器的时间
};

// ==================== 重试配置 ====================
export const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  INITIAL_DELAY: 1000,
  MAX_DELAY: 10000,
  BACKOFF_MULTIPLIER: 2,
  RETRY_ON_TIMEOUT: true,
  RETRY_ON_NETWORK_ERROR: true
};

// ==================== 轮询配置 ====================
export const POLLING_CONFIG = {
  BALANCE: 30000,           // 余额轮询间隔（30秒）
  TRANSACTION: 5000,        // 交易状态轮询间隔（5秒）
  PENDING_TX: 3000,         // 待处理交易轮询间隔（3秒）
  NETWORK_STATUS: 60000,    // 网络状态轮询间隔（1分钟）
  GAS_PRICE: 15000         // Gas 价格轮询间隔（15秒）
};

// ==================== 缓存配置 ====================
export const CACHE_CONFIG = {
  BALANCE: 30000,           // 余额缓存时间
  GAS_PRICE: 15000,         // Gas 价格缓存时间
  NETWORK_INFO: 300000,     // 网络信息缓存时间（5分钟）
  TOKEN_INFO: 3600000,      // 代币信息缓存时间（1小时）
  TRANSACTION: 60000       // 交易缓存时间
};

// ==================== 工具函数 ====================

/**
 * 获取超时时间
 * @param {string} type - 超时类型
 * @returns {number}
 */
export function getTimeout(type) {
  return TIMEOUTS[type.toUpperCase()] || TIMEOUTS.REQUEST;
}

/**
 * 计算重连延迟
 * @param {number} attempt - 尝试次数
 * @returns {number}
 */
export function calculateReconnectDelay(attempt) {
  const delay = RECONNECT_CONFIG.INITIAL_DELAY * 
    Math.pow(RECONNECT_CONFIG.BACKOFF_MULTIPLIER, attempt - 1);
  
  return Math.min(delay, RECONNECT_CONFIG.MAX_DELAY);
}

/**
 * 计算重试延迟
 * @param {number} attempt - 尝试次数
 * @returns {number}
 */
export function calculateRetryDelay(attempt) {
  const delay = RETRY_CONFIG.INITIAL_DELAY * 
    Math.pow(RETRY_CONFIG.BACKOFF_MULTIPLIER, attempt - 1);
  
  return Math.min(delay, RETRY_CONFIG.MAX_DELAY);
}

/**
 * 检查是否应该重试
 * @param {Error} error - 错误对象
 * @param {number} attempt - 当前尝试次数
 * @returns {boolean}
 */
export function shouldRetry(error, attempt) {
  if (attempt >= RETRY_CONFIG.MAX_RETRIES) {
    return false;
  }
  
  // 检查错误类型
  if (error.name === 'TimeoutError' && RETRY_CONFIG.RETRY_ON_TIMEOUT) {
    return true;
  }
  
  if (error.name === 'NetworkError' && RETRY_CONFIG.RETRY_ON_NETWORK_ERROR) {
    return true;
  }
  
  return false;
}

/**
 * 创建带超时的 Promise
 * @param {Promise} promise - 原始 Promise
 * @param {number} timeout - 超时时间
 * @param {string} errorMessage - 超时错误消息
 * @returns {Promise}
 */
export function withTimeout(promise, timeout, errorMessage = 'Operation timed out') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error(errorMessage);
        error.name = 'TimeoutError';
        reject(error);
      }, timeout);
    })
  ]);
}

/**
 * 创建带重试的函数
 * @param {Function} fn - 要执行的函数
 * @param {Object} options - 选项
 * @returns {Function}
 */
export function withRetry(fn, options = {}) {
  const config = { ...RETRY_CONFIG, ...options };
  
  return async function(...args) {
    let lastError;
    
    for (let attempt = 1; attempt <= config.MAX_RETRIES; attempt++) {
      try {
        return await fn(...args);
      } catch (error) {
        lastError = error;
        
        if (!shouldRetry(error, attempt)) {
          throw error;
        }
        
        if (attempt < config.MAX_RETRIES) {
          const delay = calculateRetryDelay(attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  };
}

/**
 * 创建轮询函数
 * @param {Function} fn - 要轮询的函数
 * @param {number} interval - 轮询间隔
 * @param {Function} shouldContinue - 是否继续轮询的判断函数
 * @returns {Object} 包含 start 和 stop 方法的对象
 */
export function createPoller(fn, interval, shouldContinue = () => true) {
  let timerId = null;
  let isRunning = false;
  
  const poll = async () => {
    if (!isRunning) return;
    
    try {
      await fn();
    } catch (error) {
      console.error('Polling error:', error);
    }
    
    if (isRunning && shouldContinue()) {
      timerId = setTimeout(poll, interval);
    }
  };
  
  return {
    start() {
      if (isRunning) return;
      isRunning = true;
      poll();
    },
    
    stop() {
      isRunning = false;
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
    },
    
    isRunning() {
      return isRunning;
    }
  };
}

/**
 * 防抖函数
 * @param {Function} fn - 要防抖的函数
 * @param {number} delay - 延迟时间
 * @returns {Function}
 */
export function debounce(fn, delay) {
  let timerId = null;
  
  return function(...args) {
    if (timerId) {
      clearTimeout(timerId);
    }
    
    timerId = setTimeout(() => {
      fn.apply(this, args);
      timerId = null;
    }, delay);
  };
}

/**
 * 节流函数
 * @param {Function} fn - 要节流的函数
 * @param {number} delay - 延迟时间
 * @returns {Function}
 */
export function throttle(fn, delay) {
  let lastCall = 0;
  
  return function(...args) {
    const now = getTimestamp();
    
    if (now - lastCall >= delay) {
      lastCall = now;
      return fn.apply(this, args);
    }
  };
}
