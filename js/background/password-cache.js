/**
 * YeYing Wallet - 密码缓存管理
 * 负责：限时密码缓存（60秒）
 */

import { state } from './state.js';
import { TIMEOUTS } from '../config/index.js';

/**
 * 缓存密码（带过期时间）
 * @param {string} password - 要缓存的密码
 * @param {number} ttl - 缓存时间（毫秒），默认 60 秒
 */
export function cachePassword(password, ttl = TIMEOUTS.PASSWORD) {
  console.log(`🔑 Caching password for ${ttl / 1000} seconds`);

  // 保存密码
  state.passwordCache = password;

  // 清除旧的计时器
  if (state.passwordCacheTimer) {
    clearTimeout(state.passwordCacheTimer);
  }

  // 设置新的过期计时器
  state.passwordCacheTimer = setTimeout(() => {
    console.log('🔒 Password cache expired');
    clearPasswordCache();
  }, ttl);
}

/**
 * 清除密码缓存
 */
export function clearPasswordCache() {
  state.passwordCache = null;

  if (state.passwordCacheTimer) {
    clearTimeout(state.passwordCacheTimer);
    state.passwordCacheTimer = null;
  }
}

/**
 * 获取缓存的密码
 * @returns {string|null}
 */
export function getCachedPassword() {
  return state.passwordCache;
}

/**
 * 刷新密码缓存时间（用户活动时调用）
 */
export function refreshPasswordCache() {
  if (state.passwordCache) {
    console.log('🔄 Refreshing password cache');
    cachePassword(state.passwordCache, TIMEOUTS.PASSWORD);
  }
}

