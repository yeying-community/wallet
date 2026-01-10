/**
 * 错误处理工具
 * 提供错误判断、日志、用户消息等功能
 */

import { ErrorCode, ErrorCodeRange, getErrorCode as extractErrorCode } from './error-codes.js';
import { ErrorMessageZH, getErrorMessageFromError } from './error-messages.js';
import { formatIsoTimestamp } from '../utils/time-utils.js';

/**
 * 获取错误名称
 * @param {Error|any} error - 错误对象
 * @returns {string}
 */
export function getErrorName(error) {
  if (!error) {
    return 'Unknown Error';
  }

  if (error.name) {
    return error.name;
  }

  const constructor = error.constructor;
  if (constructor && constructor.name) {
    return constructor.name;
  }

  return 'Error';
}

/**
 * 获取错误消息（从 Error 对象）
 * @param {Error|any} error - 错误对象
 * @returns {string}
 */
export function getErrorMessage(error) {
  return getErrorMessageFromError(error);
}

/**
 * 获取错误堆栈
 * @param {Error|any} error - 错误对象
 * @returns {string}
 */
export function getErrorStack(error) {
  if (!error) {
    return '';
  }

  if (error.stack) {
    return error.stack;
  }

  return '';
}

/**
 * 获取完整的错误信息
 * @param {Error|any} error - 错误对象
 * @returns {string}
 */
export function getFullErrorMessage(error) {
  const name = getErrorName(error);
  const message = getErrorMessage(error);
  const stack = getErrorStack(error);

  if (stack) {
    return `${name}: ${message}\n${stack}`;
  }

  return `${name}: ${message}`;
}

/**
 * 检查是否为特定类型的错误
 * @param {Error|any} error - 错误对象
 * @param {string} errorName - 错误名称
 * @returns {boolean}
 */
export function isErrorType(error, errorName) {
  if (!error) {
    return false;
  }

  return error.name === errorName || error.constructor.name === errorName;
}

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
  if (!error) {
    return false;
  }

  if (error.requirePassword) {
    return true;
  }

  if (error.code === ErrorCode.WALLET_LOCKED) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return message.includes('wallet is locked') || message.includes('钱包已锁定');
}

/**
 * 判断是否为网络错误
 */
export function isNetworkError(error) {
  if (error && ErrorCodeRange.isNetwork(error.code)) {
    return true;
  }

  if (isErrorType(error, 'NetworkError') || isErrorType(error, 'TypeError')) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return message.includes('network') ||
         message.includes('fetch') ||
         message.includes('connection');
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
  if (error && ErrorCodeRange.isValidation(error.code)) {
    return true;
  }
  return isErrorType(error, 'ValidationError');
}

/**
 * 判断是否为超时错误
 */
export function isTimeoutError(error) {
  if (!error) {
    return false;
  }

  const message = getErrorMessage(error).toLowerCase();
  return message.includes('timeout') ||
         message.includes('timed out') ||
         error.code === 'ETIMEDOUT';
}

/**
 * 判断是否为权限错误
 */
export function isPermissionError(error) {
  if (!error) {
    return false;
  }

  const message = getErrorMessage(error).toLowerCase();
  return message.includes('permission') ||
         message.includes('access denied') ||
         message.includes('unauthorized') ||
         message.includes('forbidden');
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
  return ErrorMessageZH[error.code] || error.message || getUserFriendlyError(error) || '操作失败';
}

/**
 * 记录错误日志
 * @param {string} context - 错误上下文
 * @param {Object} error - 错误对象
 * @param {Object} extra - 额外信息
 */
export function logError(context, error = null, extra = {}) {
  if (typeof context === 'string') {
    const logData = {
      context,
      error: {
        code: error?.code,
        message: error?.message,
        data: error?.data
      },
      timestamp: formatIsoTimestamp(),
      ...extra
    };

    console.error(`[Error] ${context}:`, logData);
    return;
  }

  const level = typeof error === 'string' ? error : 'error';
  const message = getFullErrorMessage(context);

  switch (level) {
    case 'warn':
      console.warn(message);
      break;
    case 'info':
      console.info(message);
      break;
    case 'debug':
      console.debug(message);
      break;
    default:
      console.error(message);
  }

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

/**
 * 格式化错误用于日志
 * @param {Error|any} error - 错误对象
 * @param {Object} context - 上下文信息
 * @returns {Object}
 */
export function formatErrorForLog(error, context = {}) {
  return {
    timestamp: formatIsoTimestamp(),
    name: getErrorName(error),
    message: getErrorMessage(error),
    stack: getErrorStack(error),
    context: context,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
  };
}

/**
 * 安全的错误处理函数
 * @param {Function} fn - 要执行的函数
 * @param {Function} errorHandler - 错误处理函数
 * @returns {any}
 */
export function safeCall(fn, errorHandler = null) {
  try {
    return fn();
  } catch (error) {
    if (errorHandler) {
      errorHandler(error);
    }
    return null;
  }
}

/**
 * 异步安全的错误处理函数
 * @param {Function} asyncFn - 异步函数
 * @param {Function} errorHandler - 错误处理函数
 * @returns {Promise<any>}
 */
export async function safeAsyncCall(asyncFn, errorHandler = null) {
  try {
    return await asyncFn();
  } catch (error) {
    if (errorHandler) {
      errorHandler(error);
    }
    return null;
  }
}

/**
 * 包装函数以捕获错误
 * @param {Function} fn - 要包装的函数
 * @param {Function} errorHandler - 错误处理函数
 * @returns {Function}
 */
export function wrapWithErrorHandler(fn, errorHandler = null) {
  return function (...args) {
    try {
      return fn.apply(this, args);
    } catch (error) {
      if (errorHandler) {
        errorHandler(error);
      }
      return null;
    }
  };
}

/**
 * 包装异步函数以捕获错误
 * @param {Function} asyncFn - 要包装的异步函数
 * @param {Function} errorHandler - 错误处理函数
 * @returns {Function}
 */
export function wrapWithAsyncErrorHandler(asyncFn, errorHandler = null) {
  return async function (...args) {
    try {
      return await asyncFn.apply(this, args);
    } catch (error) {
      if (errorHandler) {
        errorHandler(error);
      }
      return null;
    }
  };
}

/**
 * 显示错误提示
 * @param {Error|any} error - 错误对象
 * @param {Function} showToast - 显示提示的函数
 * @returns {string}
 */
export function showErrorToast(error, showToast = null) {
  const message = getErrorMessage(error);

  if (showToast) {
    showToast(message);
  }

  return message;
}

/**
 * 获取用户友好的错误消息（通用）
 * @param {Error|any} error - 错误对象
 * @returns {string}
 */
export function getUserFriendlyError(error) {
  const message = getErrorMessage(error).toLowerCase();

  if (isNetworkError(error)) {
    return '网络连接失败，请检查您的网络连接后重试';
  }

  if (isTimeoutError(error)) {
    return '请求超时，请稍后重试';
  }

  if (isPermissionError(error)) {
    return '您没有权限执行此操作';
  }

  if (message.includes('insufficient funds') || message.includes('余额不足')) {
    return '余额不足，请确保钱包有足够的余额';
  }

  if (message.includes('cancel') || message.includes('取消')) {
    return '操作已取消';
  }

  return '操作失败，请稍后重试';
}

/**
 * 提取错误代码
 * @param {Error|any} error - 错误对象
 * @returns {number|string|null}
 */
export function getErrorCode(error) {
  return extractErrorCode(error);
}

/**
 * 检查是否为已知错误类型
 * @param {Error|any} error - 错误对象
 * @returns {boolean}
 */
export function isKnownError(error) {
  if (!error) {
    return false;
  }

  const knownTypes = [
    'ValidationError',
    'NetworkError',
    'ApiError',
    'AuthenticationError',
    'AuthorizationError',
    'TimeoutError',
    'TypeError',
    'ReferenceError',
    'SyntaxError',
    'RangeError'
  ];

  return knownTypes.includes(error.name) || knownTypes.includes(error.constructor.name);
}
