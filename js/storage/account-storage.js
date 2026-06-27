// @ts-check
/**
 * 账户存储
 * 管理账户数据的存储和读取
 *
 * 双后端（chrome.storage / IndexedDB）：默认 chrome，由 getStorageBackend() 决定。
 * 写成功后 notifyMutation('accounts')，sync-service 据此标脏。
 *
 * 选中账户（SELECTED_ACCOUNT_ID）保留在 chrome.storage —— 单标量、不迁移、保留
 * chrome.storage.onChanged 路径以兼容 popup-controller 监听。
 */

import { WalletStorageKeys } from './storage-keys.js';
import {
  getMap,
  setMapItem,
  getMapItem,
  deleteMapItem,
  deleteMapItems,
  getValue,
  setValue
} from './storage-base.js';
import { registerStore, runStoreTransaction } from './indexeddb-base.js';
import { getStorageBackend } from './backend.js';
import { notifyMutation } from './mutation-events.js';
import { logError } from '../common/errors/index.js';

const STORE = WalletStorageKeys.ACCOUNTS; // 'accounts', IDB store keyPath='id', index='by_wallet'(walletId)
const SELECTED_KEY = WalletStorageKeys.SELECTED_ACCOUNT_ID; // chrome.storage 保留

registerStore(STORE, { keyPath: 'id', indexes: [{ name: 'by_wallet', keyPath: 'walletId' }] });

// ==================== chrome.storage 实现（默认） ====================

async function saveAccountChrome(account) {
  await setMapItem(STORE, account.id, account);
}

async function getAccountChrome(accountId) {
  return await getMapItem(STORE, accountId);
}

async function getAccountsChrome() {
  return await getMap(STORE);
}

async function updateAccountChrome(account) {
  await setMapItem(STORE, account.id, account);
}

async function deleteAccountChrome(accountId) {
  await deleteMapItem(STORE, accountId);
}

async function deleteAccountsChrome(accountIds) {
  await deleteMapItems(STORE, accountIds);
}

// ==================== IndexedDB 实现 ====================

async function saveAccountIdb(account) {
  await runStoreTransaction(STORE, 'readwrite', (store) => {
    store.put(account);
  });
}

async function getAccountIdb(accountId) {
  let result = null;
  await runStoreTransaction(STORE, 'readonly', (store, _tx, setResult) => {
    const req = store.get(accountId);
    req.onsuccess = () => {
      result = req.result || null;
      setResult(result);
    };
  });
  return result;
}

async function getAccountsIdb() {
  let result = {};
  await runStoreTransaction(STORE, 'readonly', (store, _tx, setResult) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const records = Array.isArray(req.result) ? req.result : [];
      for (const a of records) {
        if (a && a.id) result[a.id] = a;
      }
      setResult(result);
    };
  });
  return result;
}

async function updateAccountIdb(account) {
  await runStoreTransaction(STORE, 'readwrite', (store) => {
    store.put(account);
  });
}

async function deleteAccountIdb(accountId) {
  await runStoreTransaction(STORE, 'readwrite', (store) => {
    store.delete(accountId);
  });
}

async function deleteAccountsIdb(accountIds) {
  if (!Array.isArray(accountIds) || accountIds.length === 0) return;
  await runStoreTransaction(STORE, 'readwrite', (store) => {
    for (const id of accountIds) {
      store.delete(id);
    }
  });
}

async function getWalletAccountsIdb(walletId) {
  let result = [];
  await runStoreTransaction(STORE, 'readonly', (store, _tx, setResult) => {
    const index = store.index('by_wallet');
    const req = index.getAll(IDBKeyRange.only(walletId));
    req.onsuccess = () => {
      result = Array.isArray(req.result) ? req.result : [];
      setResult(result);
    };
  });
  return result;
}

// ==================== 公共 API ====================

function isIdb() {
  return getStorageBackend() === 'idb';
}

/**
 * 保存账户
 * @param {Object} account - 账户对象
 * @returns {Promise<void>}
 */
export async function saveAccount(account) {
  try {
    if (!account || !account.id) {
      throw new Error('Invalid account object');
    }
    if (isIdb()) await saveAccountIdb(account);
    else await saveAccountChrome(account);
    console.log('✅ Account saved:', account.id);
    notifyMutation('accounts', { id: account.id });
  } catch (error) {
    logError('account-storage-save', error);
    throw error;
  }
}

/**
 * 获取账户
 * @param {string} accountId - 账户 ID
 * @returns {Promise<Object|null>}
 */
export async function getAccount(accountId) {
  try {
    return isIdb() ? await getAccountIdb(accountId) : await getAccountChrome(accountId);
  } catch (error) {
    logError('account-storage-get', error);
    return null;
  }
}

/**
 * 获取所有账户
 * @returns {Promise<Object>} Map<accountId, Account>
 */
export async function getAccounts() {
  try {
    return isIdb() ? await getAccountsIdb() : await getAccountsChrome();
  } catch (error) {
    logError('account-storage-get-all', error);
    return {};
  }
}

/**
 * 获取所有账户列表（数组）
 * @returns {Promise<Array>}
 */
export async function getAccountList() {
  return Object.values(await getAccounts());
}

/**
 * 获取钱包的所有账户
 * @param {string} walletId - 钱包 ID
 * @returns {Promise<Array>}
 */
export async function getWalletAccounts(walletId) {
  try {
    if (isIdb()) {
      return await getWalletAccountsIdb(walletId);
    }
    const all = await getAccountsChrome();
    return Object.values(all).filter((account) => account.walletId === walletId);
  } catch (error) {
    logError('account-storage-get-wallet-accounts', error);
    return [];
  }
}

/**
 * 更新账户
 * @param {Object} account - 完整账户对象
 * @returns {Promise<void>}
 */
export async function updateAccount(account) {
  try {
    if (!account || !account.id) {
      throw new Error('Invalid account object');
    }
    if (isIdb()) await updateAccountIdb(account);
    else await updateAccountChrome(account);
    console.log('✅ Account updated:', account.id);
    notifyMutation('accounts', { id: account.id, op: 'update' });
  } catch (error) {
    logError('account-storage-update', error);
    throw error;
  }
}

/**
 * 删除账户
 * @param {string} accountId - 账户 ID
 * @returns {Promise<void>}
 */
export async function deleteAccount(accountId) {
  try {
    if (isIdb()) await deleteAccountIdb(accountId);
    else await deleteAccountChrome(accountId);
    console.log('✅ Account deleted:', accountId);
    notifyMutation('accounts', { id: accountId, op: 'delete' });
  } catch (error) {
    logError('account-storage-delete', error);
    throw error;
  }
}

/**
 * 批量删除账户
 * @param {string[]} accountIds - 账户 ID 列表
 * @returns {Promise<void>}
 */
export async function deleteAccounts(accountIds) {
  try {
    if (isIdb()) await deleteAccountsIdb(accountIds);
    else await deleteAccountsChrome(accountIds);
    console.log('✅ Accounts deleted:', accountIds?.length || 0);
    notifyMutation('accounts', { op: 'delete-batch', count: accountIds?.length || 0 });
  } catch (error) {
    logError('account-storage-delete-batch', error);
    throw error;
  }
}

/**
 * 检查是否有账户
 * @returns {Promise<boolean>}
 */
export async function hasAccounts() {
  try {
    const accounts = await getAccountList();
    return accounts.length > 0;
  } catch (error) {
    logError('account-storage-has-accounts', error);
    return false;
  }
}

/**
 * 检查账户是否存在
 * @param {string} accountId - 账户 ID
 * @returns {Promise<boolean>}
 */
export async function accountExists(accountId) {
  try {
    const account = await getAccount(accountId);
    return account !== null;
  } catch (error) {
    logError('account-storage-exists', error);
    return false;
  }
}

// ==================== 选中账户管理（始终 chrome.storage） ====================

export async function setSelectedAccountId(accountId) {
  try {
    await setValue(SELECTED_KEY, accountId);
    console.log('✅ Selected account ID saved:', accountId);
  } catch (error) {
    logError('account-storage-set-selected', error);
    throw error;
  }
}

export async function getSelectedAccountId() {
  try {
    return await getValue(SELECTED_KEY, null);
  } catch (error) {
    logError('account-storage-get-selected-id', error);
    return null;
  }
}

export async function getSelectedAccount() {
  try {
    const accountId = await getSelectedAccountId();
    if (!accountId) {
      return null;
    }
    return await getAccount(accountId);
  } catch (error) {
    logError('account-storage-get-selected', error);
    return null;
  }
}

export async function clearSelectedAccount() {
  try {
    await setValue(SELECTED_KEY, null);
    console.log('✅ Selected account cleared');
  } catch (error) {
    logError('account-storage-clear-selected', error);
    throw error;
  }
}