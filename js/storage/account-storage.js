/**
 * 账户存储
 * 管理账户数据的存储和读取
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

    await setMapItem(WalletStorageKeys.ACCOUNTS, account.id, account);
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
    return await getMapItem(WalletStorageKeys.ACCOUNTS, accountId);
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
    return await getMap(WalletStorageKeys.ACCOUNTS);
  } catch (error) {
    logError('account-storage-get-all', error);
    return {};
  }
}

/**
 * 获取所有账户列表
 * @returns {Promise<Array>}
 */
export async function getAccountList() {
  try {
    const accounts = await getAccounts();
    return Object.values(accounts);
  } catch (error) {
    logError('account-storage-get-list', error);
    return [];
  }
}

/**
 * 获取钱包的所有账户
 * @param {string} walletId - 钱包 ID
 * @returns {Promise<Array>}
 */
export async function getWalletAccounts(walletId) {
  try {
    const accounts = await getAccountList();
    return accounts.filter(account => account.walletId === walletId);
  } catch (error) {
    logError('account-storage-get-wallet-accounts', error);
    return [];
  }
}

/**
 * 更新账户
 * @param {Object} account - 账户对象
 * @returns {Promise<void>}
 */
export async function updateAccount(account) {
  return await saveAccount(account);
}

/**
 * 删除账户
 * @param {string} accountId - 账户 ID
 * @returns {Promise<void>}
 */
export async function deleteAccount(accountId) {
  try {
    await deleteMapItem(WalletStorageKeys.ACCOUNTS, accountId);
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
    await deleteMapItems(WalletStorageKeys.ACCOUNTS, accountIds);
    console.log('✅ Accounts deleted:', accountIds.length);
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

/**
 * 设置选中的账户 ID
 * @param {string} accountId - 账户 ID
 * @returns {Promise<void>}
 */
export async function setSelectedAccountId(accountId) {
  try {
    await setValue(WalletStorageKeys.SELECTED_ACCOUNT_ID, accountId);
    console.log('✅ Selected account ID saved:', accountId);
  } catch (error) {
    logError('account-storage-set-selected', error);
    throw error;
  }
}

/**
 * 获取选中的账户 ID
 * @returns {Promise<string|null>}
 */
export async function getSelectedAccountId() {
  try {
    return await getValue(WalletStorageKeys.SELECTED_ACCOUNT_ID, null);
  } catch (error) {
    logError('account-storage-get-selected-id', error);
    return null;
  }
}

/**
 * 获取选中的账户
 * @returns {Promise<Object|null>}
 */
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

/**
 * 清除选中的账户
 * @returns {Promise<void>}
 */
export async function clearSelectedAccount() {
  try {
    await setValue(WalletStorageKeys.SELECTED_ACCOUNT_ID, null);
    console.log('✅ Selected account cleared');
  } catch (error) {
    logError('account-storage-clear-selected', error);
    throw error;
  }
}
