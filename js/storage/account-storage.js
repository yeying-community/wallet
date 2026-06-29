// @ts-check
/**
 * 账户存储
 * 管理账户数据的存储和读取
 *
 * 存储后端：chrome.storage.local（关键密钥数据，不放 IndexedDB）。
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
import { logError } from '../common/errors/index.js';

const STORE = WalletStorageKeys.ACCOUNTS; // 'accounts'
const SELECTED_KEY = WalletStorageKeys.SELECTED_ACCOUNT_ID;

// ==================== 公共 API ====================

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
    await setMapItem(STORE, account.id, account);
    console.log('✅ Account saved:', account.id);
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
    return await getMapItem(STORE, accountId);
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
    return await getMap(STORE);
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
    const all = await getAccounts();
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
    await setMapItem(STORE, account.id, account);
    console.log('✅ Account updated:', account.id);
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
    await deleteMapItem(STORE, accountId);
    console.log('✅ Account deleted:', accountId);
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
    await deleteMapItems(STORE, accountIds);
    console.log('✅ Accounts deleted:', accountIds?.length || 0);
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

// ==================== 选中账户管理 ====================

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
