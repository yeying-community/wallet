/**
 * 错误处理工具函数
 */

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
 * 获取错误消息
 * @param {Error|any} error - 错误对象
 * @returns {string}
 */
export function getErrorMessage(error) {
  if (!error) {
    return 'Unknown error occurred';
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  if (error.message) {
    return error.message;
  }
  
  return String(error);
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
 * 创建自定义错误
 * @param {string} message - 错误消息
 * @param {string} name - 错误名称
 * @param {Object} extra - 额外属性
 * @returns {Error}
 */
export function createError(message, name = 'CustomError', extra = {}) {
  const error = new Error(message);
  error.name = name;
  
  for (const key in extra) {
    if (extra.hasOwnProperty(key)) {
      error[key] = extra[key];
    }
  }

  return error;
}

/**
 * 创建验证错误
 * @param {string} message - 错误消息
 * @param {Object} fieldErrors - 字段错误
 * @returns {Error}
 */
export function createValidationError(message, fieldErrors = {}) {
  const error = new Error(message);
  error.name = 'ValidationError';
  error.fieldErrors = fieldErrors;
  return error;
}

/**
 * 创建 API 错误
 * @param {string} message - 错误消息
 * @param {number} code - 错误代码
 * @param {Object} details - 错误详情
 * @returns {Error}
 */
export function createApiError(message, code = 500, details = {}) {
  const error = new Error(message);
  error.name = 'ApiError';
  error.code = code;
  error.details = details;
  return error;
}

/**
 * 创建网络错误
 * @param {string} message - 错误消息
 * @param {Object} networkInfo - 网络信息
 * @returns {Error}
 */
export function createNetworkError(message, networkInfo = {}) {
  const error = new Error(message);
  error.name = 'NetworkError';
  error.networkInfo = networkInfo;
  return error;
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
 * 检查是否为验证错误
 * @param {Error|any} error - 错误对象
 * @returns {boolean}
 */
export function isValidationError(error) {
  return isErrorType(error, 'ValidationError');
}

/**
 * 检查是否为网络错误
 * @param {Error|any} error - 错误对象
 * @returns {boolean}
 */
export function isNetworkError(error) {
  if (!error) {
    return false;
  }
  
  // 检查错误名称
  if (error.name === 'NetworkError' || error.name === 'TypeError') {
    return true;
  }

  // 检查错误消息
  const message = getErrorMessage(error).toLowerCase();
  return message.includes('network') || 
         message.includes('fetch') || 
         message.includes('connection');
}

/**
 * 检查是否为超时错误
 * @param {Error|any} error - 错误对象
 * @returns {boolean}
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
 * 检查是否为权限错误
 * @param {Error|any} error - 错误对象
 * @returns {boolean}
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
 * 格式化错误用于日志
 * @param {Error|any} error - 错误对象
 * @param {Object} context - 上下文信息
 * @returns {Object}
 */
export function formatErrorForLog(error, context = {}) {
  return {
    timestamp: new Date().toISOString(),
    name: getErrorName(error),
    message: getErrorMessage(error),
    stack: getErrorStack(error),
    context: context,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
  };
}

/**
 * 记录错误到控制台
 * @param {Error|any} error - 错误对象
 * @param {string} level - 日志级别
 */
export function logError(error, level = 'error') {
  const message = getFullErrorMessage(error);
  
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
 * 获取用户友好的错误消息
 * @param {Error|any} error - 错误对象
 * @returns {string}
 */
export function getUserFriendlyError(error) {
  const message = getErrorMessage(error).toLowerCase();
  
  // 网络错误
  if (isNetworkError(error)) {
    return '网络连接失败，请检查您的网络连接后重试';
  }
  
  // 超时错误
  if (isTimeoutError(error)) {
    return '请求超时，请稍后重试';
  }

  // 权限错误
  if (isPermissionError(error)) {
    return '您没有权限执行此操作';
  }
  
  // 余额不足
  if (message.includes('insufficient funds') || message.includes('余额不足')) {
    return '余额不足，请确保钱包有足够的余额';
  }
  
  // 用户取消
  if (message.includes('cancel') || message.includes('取消')) {
    return '操作已取消';
  }

  // 默认消息
  return '操作失败，请稍后重试';
}

/**
 * 提取错误代码
 * @param {Error|any} error - 错误对象
 * @returns {number|string|null}
 */
export function getErrorCode(error) {
  if (!error) {
    return null;
  }

  if (error.code) {
    return error.code;
  }
  
  if (error.status) {
    return error.status;
  }
  
  if (error.statusCode) {
    return error.statusCode;
  }
  
  return null;
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
