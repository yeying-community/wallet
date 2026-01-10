/**
 * 交易存储
 * 基于 IndexedDB 管理交易记录
 */

import { TransactionStorageKeys } from './storage-keys.js';
import { registerStore, runStoreTransaction } from './indexeddb-base.js';
import { logError } from '../common/errors/index.js';

const MAX_TRANSACTIONS = 200;
const STORE_NAME = TransactionStorageKeys.TRANSACTIONS;

registerStore(STORE_NAME, {
  keyPath: 'hash',
  indexes: [
    { name: 'timestamp', keyPath: 'timestamp' },
    { name: 'from', keyPath: 'from' },
    { name: 'to', keyPath: 'to' },
    { name: 'chainId', keyPath: 'chainId' }
  ]
});

function normalizeAddress(address) {
  return address ? String(address).toLowerCase() : '';
}

function normalizeHash(hash) {
  return hash ? String(hash).toLowerCase() : '';
}

function enforceTransactionLimit(store, txHandle) {
  const countRequest = store.count();
  countRequest.onsuccess = () => {
    const count = countRequest.result || 0;
    if (count <= MAX_TRANSACTIONS) {
      return;
    }

    const excess = count - MAX_TRANSACTIONS;
    let removed = 0;
    const index = store.index('timestamp');
    const cursorRequest = index.openCursor(null, 'next');

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || removed >= excess) {
        return;
      }
      cursor.delete();
      removed += 1;
      cursor.continue();
    };

    cursorRequest.onerror = () => txHandle.abort();
  };

  countRequest.onerror = () => txHandle.abort();
}

/**
 * 获取所有交易记录
 * @returns {Promise<Array>}
 */
export async function getAllTransactions() {
  try {
    return await runStoreTransaction(STORE_NAME, 'readonly', (store, tx, setResult) => {
      if (typeof store.getAll === 'function') {
        const request = store.getAll();
        request.onsuccess = () => setResult(request.result || []);
        request.onerror = () => tx.abort();
        return;
      }

      const list = [];
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          setResult(list);
          return;
        }
        list.push(cursor.value);
        cursor.continue();
      };
      cursorRequest.onerror = () => tx.abort();
    });
  } catch (error) {
    logError('transaction-storage-get-all', error);
    return [];
  }
}

/**
 * 保存全部交易记录
 * @param {Array} transactions
 * @returns {Promise<void>}
 */
export async function saveAllTransactions(transactions) {
  try {
    await runStoreTransaction(STORE_NAME, 'readwrite', (store, tx, setResult) => {
      const clearRequest = store.clear();
      clearRequest.onsuccess = () => {
        const list = Array.isArray(transactions) ? transactions.slice(0, MAX_TRANSACTIONS) : [];
        list.forEach((item) => {
          if (!item?.hash) return;
          const payload = {
            ...item,
            hash: normalizeHash(item.hash),
            from: normalizeAddress(item.from),
            to: normalizeAddress(item.to)
          };
          store.put(payload);
        });
        setResult();
      };
      clearRequest.onerror = () => tx.abort();
    });
  } catch (error) {
    logError('transaction-storage-save-all', error);
    throw error;
  }
}

/**
 * 添加交易记录
 * @param {Object} tx
 * @returns {Promise<Object>}
 */
export async function addTransaction(tx) {
  try {
    if (!tx || !tx.hash) {
      throw new Error('Invalid transaction');
    }
    const hashKey = normalizeHash(tx.hash);

    return await runStoreTransaction(STORE_NAME, 'readwrite', (store, txHandle, setResult) => {
      const getRequest = store.get(hashKey);
      getRequest.onsuccess = () => {
        if (getRequest.result) {
          setResult(getRequest.result);
          return;
        }

        const payload = { ...tx, hash: hashKey, from: normalizeAddress(tx.from), to: normalizeAddress(tx.to) };
        const addRequest = store.add(payload);
        addRequest.onsuccess = () => {
          setResult(payload);
          enforceTransactionLimit(store, txHandle);
        };
        addRequest.onerror = () => txHandle.abort();
      };
      getRequest.onerror = () => txHandle.abort();
    });
  } catch (error) {
    logError('transaction-storage-add', error);
    throw error;
  }
}

/**
 * 更新交易记录
 * @param {string} hash
 * @param {Object} updates
 * @returns {Promise<boolean>}
 */
export async function updateTransaction(hash, updates = {}) {
  try {
    const hashKey = normalizeHash(hash);
    if (!hashKey) return false;

    return await runStoreTransaction(STORE_NAME, 'readwrite', (store, tx, setResult) => {
      const getRequest = store.get(hashKey);
      getRequest.onsuccess = () => {
        const current = getRequest.result;
        if (!current) {
          setResult(false);
          return;
        }
        const payload = {
          ...current,
          ...updates,
          hash: hashKey,
          from: updates.from !== undefined ? normalizeAddress(updates.from) : current.from,
          to: updates.to !== undefined ? normalizeAddress(updates.to) : current.to
        };
        const putRequest = store.put(payload);
        putRequest.onsuccess = () => setResult(true);
        putRequest.onerror = () => tx.abort();
      };
      getRequest.onerror = () => tx.abort();
    });
  } catch (error) {
    logError('transaction-storage-update', error);
    return false;
  }
}

/**
 * 获取指定账户的交易记录
 * @param {string} address
 * @param {string|null} chainId
 * @returns {Promise<Array>}
 */
export async function getTransactionsByAddress(address, chainId = null) {
  try {
    return await runStoreTransaction(STORE_NAME, 'readonly', (store, tx, setResult) => {
      const list = [];
      const normalized = normalizeAddress(address);
      const chain = chainId ? String(chainId) : null;
      const cursorRequest = store.openCursor();

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          list.sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
          setResult(list);
          return;
        }
        const item = cursor.value;
        const matchAddress = normalized
          ? normalizeAddress(item?.from) === normalized || normalizeAddress(item?.to) === normalized
          : true;
        const matchChain = chain ? String(item?.chainId || '') === chain : true;
        if (matchAddress && matchChain) {
          list.push(item);
        }
        cursor.continue();
      };
      cursorRequest.onerror = () => tx.abort();
    });
  } catch (error) {
    logError('transaction-storage-get-by-address', error);
    return [];
  }
}

/**
 * 清除指定账户交易记录
 * @param {string|null} address
 * @param {string|null} chainId
 * @returns {Promise<number>} 删除数量
 */
export async function clearTransactionsByAddress(address = null, chainId = null) {
  try {
    return await runStoreTransaction(STORE_NAME, 'readwrite', (store, tx, setResult) => {
      let removed = 0;
      const normalized = normalizeAddress(address);
      const chain = chainId ? String(chainId) : null;
      const cursorRequest = store.openCursor();

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          setResult(removed);
          return;
        }
        const item = cursor.value;
        const matchAddress = normalized
          ? normalizeAddress(item?.from) === normalized || normalizeAddress(item?.to) === normalized
          : true;
        const matchChain = chain ? String(item?.chainId || '') === chain : true;
        if (matchAddress && matchChain) {
          cursor.delete();
          removed += 1;
        }
        cursor.continue();
      };
      cursorRequest.onerror = () => tx.abort();
    });
  } catch (error) {
    logError('transaction-storage-clear', error);
    return 0;
  }
}
