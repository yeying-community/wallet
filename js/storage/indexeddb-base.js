/**
 * IndexedDB 基础操作
 * 提供统一的数据库连接与事务处理
 */

import { logError } from '../common/errors/index.js';

const DB_NAME = 'yeying_wallet_db';
const DB_VERSION = 1;
const storeRegistry = new Map();

function ensureIndexedDb() {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is not available');
  }
}

function applyStoreDefinition(db, transaction, definition) {
  const { name, options, indexes } = definition;
  let store;
  if (!db.objectStoreNames.contains(name)) {
    store = db.createObjectStore(name, options);
  } else {
    store = transaction.objectStore(name);
  }

  (indexes || []).forEach((index) => {
    if (!index?.name || !index?.keyPath) return;
    if (!store.indexNames.contains(index.name)) {
      store.createIndex(index.name, index.keyPath, index.options || {});
    }
  });
}

/**
 * 注册对象仓库（需要在首次打开数据库前注册）
 * 如需新增/修改索引，请提升 DB_VERSION
 * @param {string} name
 * @param {Object} options
 * @param {string} options.keyPath
 * @param {boolean} options.autoIncrement
 * @param {Array} options.indexes
 */
export function registerStore(name, options = {}) {
  if (!name) {
    throw new Error('store name is required');
  }

  const definition = {
    name,
    options: {
      keyPath: options.keyPath || 'id',
      autoIncrement: Boolean(options.autoIncrement)
    },
    indexes: Array.isArray(options.indexes) ? options.indexes : []
  };

  storeRegistry.set(name, definition);
}

/**
 * 打开数据库连接
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase() {
  ensureIndexedDb();

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;
      storeRegistry.forEach((definition) => {
        applyStoreDefinition(db, transaction, definition);
      });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      const error = request.error || new Error('Failed to open IndexedDB');
      logError('indexeddb-open', error);
      reject(error);
    };
  });
}

/**
 * 执行对象仓库事务
 * @param {string} storeName
 * @param {'readonly'|'readwrite'} mode
 * @param {Function} handler
 * @returns {Promise<any>}
 */
export async function runStoreTransaction(storeName, mode, handler) {
  if (!storeRegistry.has(storeName)) {
    const error = new Error(`IndexedDB store not registered: ${storeName}`);
    logError('indexeddb-store-missing', error);
    throw error;
  }
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;

    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      const error = tx.error || new Error('IndexedDB transaction failed');
      logError('indexeddb-transaction', error);
      db.close();
      reject(error);
    };
    tx.onabort = () => {
      const error = tx.error || new Error('IndexedDB transaction aborted');
      logError('indexeddb-transaction', error);
      db.close();
      reject(error);
    };

    try {
      handler(store, tx, (value) => {
        result = value;
      });
    } catch (error) {
      tx.abort();
      db.close();
      reject(error);
    }
  });
}
