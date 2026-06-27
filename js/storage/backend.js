// @ts-check
/**
 * 存储后端开关 + 一次性迁移（chrome.storage → IndexedDB）
 *
 * 安全第一原则：默认后端为 'chrome'（旧行为）。仅当一次性迁移**确认成功**才切到 'idb'。
 * 迁移失败 / IDB 不可用 → 保持 'chrome'，用户资产始终可见、绝不因迁移 bug 丢失访问。
 *
 * 迁移决策为纯状态机，IO 通过依赖注入，便于在无真实 IndexedDB 的 Node 环境单测。
 */

import { getMap, getArray, getValue, setValue } from './storage-base.js';
import { runStoreTransaction } from './indexeddb-base.js';
import { WalletStorageKeys, NetworkStorageKeys } from './storage-keys.js';

const MIGRATION_FLAG = 'idb_migrated_v2';

/** IDB store 名（与迁移的集合键同名，commit b 在 indexeddb-base 注册）。 */
const STORE = {
  wallets: WalletStorageKeys.WALLETS,   // 'wallets'
  accounts: WalletStorageKeys.ACCOUNTS, // 'accounts'
  networks: NetworkStorageKeys.NETWORKS // 'networks'
};

/** @type {'chrome'|'idb'} */
let storageBackend = 'chrome';

/** @returns {'chrome'|'idb'} */
export function getStorageBackend() {
  return storageBackend;
}

/** 仅供测试/重置：强制设置后端。 */
export function _setStorageBackend(backend) {
  storageBackend = backend === 'idb' ? 'idb' : 'chrome';
}

// ==================== 默认 IO 依赖（真实实现） ====================

/** 从 chrome.storage 读取三集合的当前数据。 */
async function defaultReadChromeCollections() {
  const [wallets, accounts, networks] = await Promise.all([
    getMap(STORE.wallets),
    getMap(STORE.accounts),
    getArray(STORE.networks)
  ]);
  return {
    wallets: wallets || {},
    accounts: accounts || {},
    networks: Array.isArray(networks) ? networks : []
  };
}

/** 把一组记录批量 put 进某个 IDB store（单事务）。 */
async function bulkPut(storeName, records) {
  if (!records.length) return;
  await runStoreTransaction(storeName, 'readwrite', (store) => {
    for (const record of records) {
      store.put(record);
    }
  });
}

/** 把三集合写入 IDB。 */
async function defaultWriteIdbCollections(data) {
  await bulkPut(STORE.wallets, Object.values(data.wallets || {}));
  await bulkPut(STORE.accounts, Object.values(data.accounts || {}));
  await bulkPut(STORE.networks, Array.isArray(data.networks) ? data.networks : []);
}

/** 回读 IDB 条目数，与源数据计数比对，全部一致才算迁移成功。 */
async function defaultVerifyIdb(data) {
  const counts = await Promise.all([
    countStore(STORE.wallets),
    countStore(STORE.accounts),
    countStore(STORE.networks)
  ]);
  const expected = [
    Object.keys(data.wallets || {}).length,
    Object.keys(data.accounts || {}).length,
    Array.isArray(data.networks) ? data.networks.length : 0
  ];
  return counts[0] >= expected[0] && counts[1] >= expected[1] && counts[2] >= expected[2];
}

async function countStore(storeName) {
  let count = 0;
  await runStoreTransaction(storeName, 'readonly', (store, _tx, setResult) => {
    const req = store.getAllKeys();
    req.onsuccess = () => {
      count = Array.isArray(req.result) ? req.result.length : 0;
      setResult(count);
    };
  });
  return count;
}

async function defaultGetFlag() {
  return Boolean(await getValue(MIGRATION_FLAG, false));
}

async function defaultSetFlag(value) {
  await setValue(MIGRATION_FLAG, Boolean(value));
}

/**
 * @typedef {Object} MigrationDeps
 * @property {() => Promise<boolean>} [getFlag]
 * @property {(v: boolean) => Promise<void>} [setFlag]
 * @property {() => Promise<{wallets: Object, accounts: Object, networks: any[]}>} [readChrome]
 * @property {(data: any) => Promise<void>} [writeIdb]
 * @property {(data: any) => Promise<boolean>} [verify]
 * @property {(error: any) => void} [onError]
 */

/**
 * 一次性迁移状态机。返回应使用的后端；绝不抛错。
 * - 已迁（flag）→ 'idb'，跳过 IO。
 * - 迁移并回读校验成功 → 设 flag、返回 'idb'。
 * - 任意异常 / 校验失败 → 返回 'chrome'（不设 flag，下次重试）。
 * @param {MigrationDeps} [deps]
 * @returns {Promise<'chrome'|'idb'>}
 */
export async function migrateCollectionsToIdb(deps = {}) {
  const getFlag = deps.getFlag || defaultGetFlag;
  const setFlag = deps.setFlag || defaultSetFlag;
  const readChrome = deps.readChrome || defaultReadChromeCollections;
  const writeIdb = deps.writeIdb || defaultWriteIdbCollections;
  const verify = deps.verify || defaultVerifyIdb;
  const onError = deps.onError;

  try {
    if (await getFlag()) {
      return 'idb';
    }
    const data = await readChrome();
    await writeIdb(data);
    const ok = await verify(data);
    if (!ok) {
      throw new Error('IDB migration verification mismatch');
    }
    await setFlag(true);
    return 'idb';
  } catch (error) {
    if (typeof onError === 'function') {
      try { onError(error); } catch { /* ignore */ }
    } else {
      console.warn('[storage/backend] migration failed, staying on chrome.storage:', error?.message || error);
    }
    return 'chrome';
  }
}

/**
 * background 启动时调用：跑迁移并设置模块级后端。
 * @param {MigrationDeps} [deps]
 * @returns {Promise<'chrome'|'idb'>}
 */
export async function initStorageBackend(deps = {}) {
  storageBackend = await migrateCollectionsToIdb(deps);
  return storageBackend;
}
