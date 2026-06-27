// @ts-check
/**
 * 钱包存储
 * 管理钱包数据的存储和读取
 *
 * 双后端（chrome.storage / IndexedDB）：默认 chrome，由 getStorageBackend() 决定。
 * 写成功后 notifyMutation('wallets')，sync-service 据此标脏（IDB 路径下
 * chrome.storage.onChanged 不再触发，须走 mutation-events）。
 */

import { WalletStorageKeys } from './storage-keys.js';
import { getMap, setMapItem, getMapItem, deleteMapItem } from './storage-base.js';
import { registerStore, runStoreTransaction } from './indexeddb-base.js';
import { getStorageBackend } from './backend.js';
import { notifyMutation } from './mutation-events.js';
import { logError } from '../common/errors/index.js';

const STORE = WalletStorageKeys.WALLETS; // 'wallets', IDB store keyPath='id'

registerStore(STORE, { keyPath: 'id' });

// ==================== chrome.storage 实现（默认） ====================

async function saveWalletChrome(wallet) {
  await setMapItem(STORE, wallet.id, wallet);
}

async function getWalletChrome(walletId) {
  return await getMapItem(STORE, walletId);
}

async function getWalletsChrome() {
  return await getMap(STORE);
}

async function deleteWalletChrome(walletId) {
  await deleteMapItem(STORE, walletId);
}

// ==================== IndexedDB 实现 ====================

async function saveWalletIdb(wallet) {
  await runStoreTransaction(STORE, 'readwrite', (store) => {
    store.put(wallet);
  });
}

async function getWalletIdb(walletId) {
  let result = null;
  await runStoreTransaction(STORE, 'readonly', (store, _tx, setResult) => {
    const req = store.get(walletId);
    req.onsuccess = () => {
      result = req.result || null;
      setResult(result);
    };
  });
  return result;
}

async function getWalletsIdb() {
  let result = {};
  await runStoreTransaction(STORE, 'readonly', (store, _tx, setResult) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const records = Array.isArray(req.result) ? req.result : [];
      for (const w of records) {
        if (w && w.id) result[w.id] = w;
      }
      setResult(result);
    };
  });
  return result;
}

async function deleteWalletIdb(walletId) {
  await runStoreTransaction(STORE, 'readwrite', (store) => {
    store.delete(walletId);
  });
}

// ==================== 公共 API ====================

/**
 * 保存钱包
 * @param {Object} wallet - 钱包对象
 * @returns {Promise<void>}
 */
export async function saveWallet(wallet) {
  try {
    if (!wallet || !wallet.id) {
      throw new Error('Invalid wallet object');
    }

    if (getStorageBackend() === 'idb') {
      await saveWalletIdb(wallet);
    } else {
      await saveWalletChrome(wallet);
    }
    console.log('✅ Wallet saved:', wallet.id);
    notifyMutation('wallets', { id: wallet.id });

  } catch (error) {
    logError('wallet-storage-save', error);
    throw error;
  }
}

/**
 * 获取钱包
 * @param {string} walletId - 钱包 ID
 * @returns {Promise<Object|null>}
 */
export async function getWallet(walletId) {
  try {
    return getStorageBackend() === 'idb'
      ? await getWalletIdb(walletId)
      : await getWalletChrome(walletId);
  } catch (error) {
    logError('wallet-storage-get', error);
    return null;
  }
}

/**
 * 获取所有钱包
 * @returns {Promise<Object>} Map<walletId, Wallet>
 */
export async function getWallets() {
  try {
    return getStorageBackend() === 'idb'
      ? await getWalletsIdb()
      : await getWalletsChrome();
  } catch (error) {
    logError('wallet-storage-get-all', error);
    return {};
  }
}

/**
 * 删除钱包
 * @param {string} walletId - 钱包 ID
 * @returns {Promise<void>}
 */
export async function deleteWallet(walletId) {
  try {
    if (getStorageBackend() === 'idb') {
      await deleteWalletIdb(walletId);
    } else {
      await deleteWalletChrome(walletId);
    }
    console.log('✅ Wallet deleted:', walletId);
    notifyMutation('wallets', { id: walletId, op: 'delete' });
  } catch (error) {
    logError('wallet-storage-delete', error);
    throw error;
  }
}

/**
 * 检查钱包是否存在
 * @param {string} walletId - 钱包 ID
 * @returns {Promise<boolean>}
 */
export async function walletExists(walletId) {
  try {
    const wallet = await getWallet(walletId);
    return wallet !== null;
  } catch (error) {
    logError('wallet-storage-exists', error);
    return false;
  }
}