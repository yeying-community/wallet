/**
 * 错误处理工具
 * 提供错误判断、日志、用户消息等功能
 */

import { ErrorCode, ErrorCodeRange } from './error-codes.js';
import { ErrorMessageZH } from './error-messages.js';

/**
 * 判断是否为用户拒绝错误
 */
export function isUserRejectedError(error) {
  return error && error.code === ErrorCode.USER_REJECTED;
}

/**
 * 判断是否为钱包锁定错误
 */
export function isWalletLockedError(error) {
  return error && error.code === ErrorCode.WALLET_LOCKED;
}

/**
 * 判断是否为网络错误
 */
export function isNetworkError(error) {
  return error && ErrorCodeRange.isNetwork(error.code);
}

/**
 * 判断是否为交易错误
 */
export function isTransactionError(error) {
  return error && ErrorCodeRange.isTransaction(error.code);
}

/**
 * 判断是否为余额不足错误
 */
export function isInsufficientFundsError(error) {
  return error && error.code === ErrorCode.INSUFFICIENT_FUNDS;
}

/**
 * 判断是否为验证错误
 */
export function isValidationError(error) {
  return error && ErrorCodeRange.isValidation(error.code);
}

/**
 * 获取用户友好的错误消息（中文）
 * @param {Object} error - 错误对象
 * @returns {string}
 */
export function getUserFriendlyMessage(error) {
  if (!error) {
    return '未知错误';
  }

  // 用户拒绝
  if (isUserRejectedError(error)) {
    return '您已取消操作';
  }

  // 钱包锁定
  if (isWalletLockedError(error)) {
    return '钱包已锁定，请先解锁';
  }

  // 余额不足
  if (isInsufficientFundsError(error)) {
    return '余额不足';
  }

  // 网络错误
  if (isNetworkError(error)) {
    return '网络连接失败，请检查网络设置';
  }

  // 交易错误
  if (isTransactionError(error)) {
    return error.message || '交易失败';
  }

  // 返回中文消息或原始消息
  return ErrorMessageZH[error.code] || error.message || '操作失败';
}

/**
 * 记录错误日志
 * @param {string} context - 错误上下文
 * @param {Object} error - 错误对象
 * @param {Object} extra - 额外信息
 */
export function logError(context, error, extra = {}) {
  const logData = {
    context,
    error: {
      code: error.code,
      message: error.message,
      data: error.data
    },
    timestamp: new Date().toISOString(),
    ...extra
  };

  console.error(`[Error] ${context}:`, logData);

  // TODO: 可以在这里添加错误上报逻辑
  // 例如：发送到 Sentry、LogRocket 等服务
}

/**
 * 安全执行函数，捕获错误
 * @param {Function} fn - 要执行的函数
 * @param {string} context - 上下文
 * @returns {Promise<{success: boolean, data?: any, error?: Object}>}
 */
export async function safeExecute(fn, context) {
  try {
    const result = await fn();
    return { success: true, data: result };
  } catch (error) {
    logError(context, error);
    return {
      success: false,
      error: error.code ? error : { code: ErrorCode.UNKNOWN_ERROR, message: error.message }
    };
  }
}

/**
 * 重试执行函数
 * @param {Function} fn - 要执行的函数
 * @param {number} maxRetries - 最大重试次数
 * @param {number} delay - 重试延迟（毫秒）
 * @returns {Promise<any>}
 */
export async function retryExecute(fn, maxRetries = 3, delay = 1000) {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      // 如果是用户拒绝或验证错误，不重试
      if (isUserRejectedError(error) || isValidationError(error)) {
        throw error;
      }

      // 最后一次重试失败，直接抛出
      if (i === maxRetries - 1) {
        throw error;
      }

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }

  throw lastError;
}
