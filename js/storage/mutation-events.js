// @ts-check
/**
 * 存储变更事件（内存 pub/sub）
 *
 * 背景：wallets/accounts/networks 迁到 IndexedDB 后，chrome.storage.onChanged 不再对
 * 这些集合触发，备份同步的脏检测会静默失效。用本模块在存储写函数成功后主动通知，
 * sync-service 订阅以标脏。两套后端（chrome / idb）统一调用，行为一致。
 *
 * 纯内存、同进程（Service Worker 内）；订阅者回调中的异常被隔离，不影响通知方。
 */

/** @typedef {'wallets'|'accounts'|'networks'} MutationCollection */

/** @type {Set<(collection: string, detail?: any) => void>} */
const listeners = new Set();

/**
 * 通知一次集合变更。绝不抛错（写路径调用，不能影响主流程）。
 * @param {MutationCollection|string} collection
 * @param {any} [detail]
 */
export function notifyMutation(collection, detail) {
  for (const listener of [...listeners]) {
    try {
      listener(collection, detail);
    } catch (error) {
      console.warn('[mutation-events] listener error:', error?.message || error);
    }
  }
}

/**
 * 订阅集合变更。
 * @param {(collection: string, detail?: any) => void} listener
 * @returns {() => void} 退订函数
 */
export function onMutation(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 仅供测试：清空所有订阅者。 */
export function _resetMutationListeners() {
  listeners.clear();
}
