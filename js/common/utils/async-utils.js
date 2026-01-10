/**
 * 异步工具函数
 */

import { getTimestamp } from './time-utils.js';

/**
 * 延迟执行
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>}
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 延迟执行（可取消）
 * @param {number} ms - 延迟毫秒数
 * @returns {{ promise: Promise<void>, cancel: Function }}
 */
export function cancellableDelay(ms) {
  let timeoutId;
  let rejectFn;
  
  const promise = new Promise((resolve, reject) => {
    timeoutId = setTimeout(resolve, ms);
    rejectFn = reject;
  });
  
  const cancel = () => {
    clearTimeout(timeoutId);
    rejectFn(new Error('Delay cancelled'));
  };
  
  return { promise, cancel };
}

/**
 * 等待直到条件满足
 * @param {Function} condition - 条件函数
 * @param {number} interval - 检查间隔（毫秒）
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<boolean>}
 */
export async function waitUntil(condition, interval = 100, timeout = 5000) {
  const startTime = getTimestamp();
  
  while (!condition()) {
    if (getTimestamp() - startTime > timeout) {
      return false;
    }
    
    await delay(interval);
  }
  
  return true;
}

/**
 * 等待直到条件满足或超时
 * @param {Function} condition - 条件函数
 * @param {number} timeout - 超时时间（毫秒）
 * @param {number} interval - 检查间隔（毫秒）
 * @returns {Promise<boolean>}
 */
export async function waitUntilOrTimeout(condition, timeout = 5000, interval = 100) {
  return waitUntil(condition, interval, timeout);
}

/**
 * 异步重试
 * @param {Function} fn - 要重试的函数
 * @param {number} retries - 重试次数
 * @param {number} delayMs - 重试间隔（毫秒）
 * @param {Function} onRetry - 重试回调
 * @returns {Promise<any>}
 */
export async function retry(fn, retries = 3, delayMs = 1000, onRetry = null) {
  let lastError;
  
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (i < retries) {
        if (onRetry) {
          onRetry(error, i + 1, retries);
        }
        await delay(delayMs * Math.pow(2, i)); // 指数退避
      }
    }
  }
  
  throw lastError;
}

/**
 * 异步重试（带指数退避和随机抖动）
 * @param {Function} fn - 要重试的函数
 * @param {Object} options - 选项
 * @returns {Promise<any>}
 */
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    factor = 2,
    jitter = true,
    onRetry = null
  } = options;
  
  let lastError;
  
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (i < maxRetries) {
        if (onRetry) {
          onRetry(error, i + 1, maxRetries);
        }
        
        let delayMs = initialDelay * Math.pow(factor, i);
        delayMs = Math.min(delayMs, maxDelay);
        
        if (jitter) {
          delayMs = delayMs * (0.5 + Math.random() * 0.5);
        }
        
        await delay(delayMs);
      }
    }
  }
  
  throw lastError;
}

/**
 * 并行执行多个 Promise
 * @param {Function[]} tasks - 任务函数数组
 * @returns {Promise<any[]>}
 */
export async function parallel(tasks) {
  return Promise.all(tasks.map(task => task()));
}

/**
 * 并行执行多个 Promise（带错误处理）
 * @param {Function[]} tasks - 任务函数数组
 * @returns {Promise<Array<{success: boolean, result?: any, error?: Error}>}
 */
export async function parallelWithErrors(tasks) {
  const results = await Promise.allSettled(tasks.map(task => task()));
  
  return results.map(result => {
    if (result.status === 'fulfilled') {
      return { success: true, result: result.value };
    } else {
      return { success: false, error: result.reason };
    }
  });
}

/**
 * 限制并发数量的并行执行
 * @param {Function[]} tasks - 任务函数数组
 * @param {number} concurrency - 并发限制
 * @returns {Promise<any[]>}
 */
export async function parallelLimit(tasks, concurrency = 5) {
  const results = [];
  const executing = new Set();
  
  for (const task of tasks) {
    const wrappedTask = async () => {
      const result = await task();
      results.push(result);
      executing.delete(wrappedTask);
    };
    
    executing.add(wrappedTask);
    
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
    
    wrappedTask();
  }
  
  while (executing.size > 0) {
    await Promise.race(executing);
  }
  
  return results;
}

/**
 * 顺序执行多个 Promise
 * @param {Function[]} tasks - 任务函数数组
 * @returns {Promise<any[]>}
 */
export async function sequence(tasks) {
  const results = [];
  
  for (const task of tasks) {
    results.push(await task());
  }
  
  return results;
}

/**
 * 超时控制
 * @param {Promise} promise - Promise 对象
 * @param {number} timeout - 超时时间（毫秒）
 * @param {Error} timeoutError - 超时错误
 * @returns {Promise<any>}
 */
export function withTimeout(promise, timeout = 5000, timeoutError = null) {
  const error = timeoutError || new Error(`Operation timed out after ${timeout}ms`);
  
  const timeoutId = setTimeout(() => {
    throw error;
  }, timeout);
  
  return promise.finally(() => {
    clearTimeout(timeoutId);
  });
}

/**
 * 超时控制（返回超时错误而非抛出）
 * @param {Promise} promise - Promise 对象
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<{success: boolean, result?: any, error?: Error}>}
 */
export async function withTimeoutResult(promise, timeout = 5000) {
  let timeoutId;
  
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({ success: false, error: new Error(`Operation timed out after ${timeout}ms`) });
    }, timeout);
  });
  
  const resultPromise = promise.then(
    result => ({ success: true, result }),
    error => ({ success: false, error })
  );
  
  const result = await Promise.race([timeoutPromise, resultPromise]);
  clearTimeout(timeoutId);
  
  return result;
}

/**
 * 竞速执行（返回最先完成的结果）
 * @param {Promise[]} promises - Promise 数组
 * @returns {Promise<any>}
 */
export function race(promises) {
  return Promise.race(promises);
}

/**
 * 全部完成（无论成功或失败）
 * @param {Promise[]} promises - Promise 数组
 * @returns {Promise<PromiseSettledResult<any>[]>}
 */
export function settle(promises) {
  return Promise.allSettled(promises);
}

/**
 * 将回调函数转换为 Promise
 * @param {Function} fn - 回调函数
 * @returns {Function}
 */
export function promisify(fn) {
  return function (...args) {
    return new Promise((resolve, reject) => {
      fn.call(this, ...args, (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });
    });
  };
}

/**
 * 将 Node.js 风格回调转换为 Promise
 * @param {Function} fn - Node.js 风格函数
 * @returns {Function}
 */
export function promisifyNodeStyle(fn) {
  return function (...args) {
    return new Promise((resolve, reject) => {
      const callback = (error, ...results) => {
        if (error) {
          reject(error);
        } else {
          resolve(results.length === 1 ? results[0] : results);
        }
      };
      
      fn.call(this, ...args, callback);
    });
  };
}

/**
 * 睡眠函数
 * @param {number} seconds - 秒数
 * @returns {Promise<void>}
 */
export function sleep(seconds) {
  return delay(seconds * 1000);
}

/**
 * 异步映射
 * @param {Array} array - 数组
 * @param {Function} mapper - 映射函数
 * @param {number} concurrency - 并发限制
 * @returns {Promise<Array>}
 */
export async function asyncMap(array, mapper, concurrency = 10) {
  const results = new Array(array.length);
  const executing = new Set();
  
  const run = async (item, index) => {
    const wrappedMapper = async () => {
      const result = await mapper(item, index, array);
      results[index] = result;
      executing.delete(wrappedMapper);
    };
    
    executing.add(wrappedMapper);
    
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
    
    wrappedMapper();
  };
  
  for (let i = 0; i < array.length; i++) {
    await run(array[i], i);
  }
  
  while (executing.size > 0) {
    await Promise.race(executing);
  }
  
  return results;
}

/**
 * 异步过滤器
 * @param {Array} array - 数组
 * @param {Function} filterer - 过滤器函数
 * @param {number} concurrency - 并发限制
 * @returns {Promise<Array>}
 */
export async function asyncFilter(array, filterer, concurrency = 10) {
  const results = await asyncMap(array, async (item, index) => {
    const shouldKeep = await filterer(item, index, array);
    return { item, shouldKeep };
  }, concurrency);
  
  return results
    .filter(result => result.shouldKeep)
    .map(result => result.item);
}

/**
 * 异步归约
 * @param {Array} array - 数组
 * @param {Function} reducer - 归约函数
 * @param {any} initialValue - 初始值
 * @returns {Promise<any>}
 */
export async function asyncReduce(array, reducer, initialValue) {
  let accumulator = initialValue;
  
  for (let i = 0; i < array.length; i++) {
    accumulator = await reducer(accumulator, array[i], i, array);
  }
  
  return accumulator;
}

/**
 * 异步队列
 */
export class AsyncQueue {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 1;
    this.queue = [];
    this.executing = 0;
    this.paused = false;
  }
  
  /**
   * 添加任务到队列
   * @param {Function} task - 任务函数
   * @returns {Promise<any>}
   */
  enqueue(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.process();
    });
  }
  
  /**
   * 处理队列
   */
  async process() {
    if (this.paused || this.executing >= this.concurrency || this.queue.length === 0) {
      return;
    }
    
    this.executing++;
    
    const { task, resolve, reject } = this.queue.shift();
    
    try {
      const result = await task();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.executing--;
      this.process();
    }
  }
  
  /**
   * 暂停队列
   */
  pause() {
    this.paused = true;
  }
  
  /**
   * 恢复队列
   */
  resume() {
    this.paused = false;
    this.process();
  }
  
  /**
   * 清空队列
   */
  clear() {
    this.queue.forEach(({ reject }) => {
      reject(new Error('Queue cleared'));
    });
    this.queue = [];
  }
  
  /**
   * 获取队列长度
   */
  get length() {
    return this.queue.length;
  }
}

/**
 * 信号量
 */
export class Semaphore {
  constructor(maxConcurrency) {
    this.maxConcurrency = maxConcurrency;
    this.currentCount = 0;
    this.waitQueue = [];
  }
  
  /**
   * 获取信号量
   * @returns {Promise<void>}
   */
  async acquire() {
    if (this.currentCount < this.maxConcurrency) {
      this.currentCount++;
      return;
    }
    
    return new Promise(resolve => {
      this.waitQueue.push(resolve);
    });
  }
  
  /**
   * 释放信号量
   */
  release() {
    this.currentCount--;
    
    if (this.waitQueue.length > 0 && this.currentCount < this.maxConcurrency) {
      this.currentCount++;
      const next = this.waitQueue.shift();
      next();
    }
  }
  
  /**
   * 使用信号量执行任务
   * @param {Function} task - 任务函数
   * @returns {Promise<any>}
   */
  async withLock(task) {
    await this.acquire();
    
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}
