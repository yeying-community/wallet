/**
 * 存储模块统一导出
 * 提供所有存储相关的功能
 */

// ==================== 存储键 ====================
export {
  StorageKeys,
  WalletStorageKeys,
  NetworkStorageKeys,
  PermissionStorageKeys,
  SettingsStorageKeys,
  TransactionStorageKeys
} from './storage-keys.js';

// ==================== 基础存储 ====================
export {
  getStorage,
  setStorage,
  removeStorage,
  clearStorage,
  getAllStorage,
  getValue,
  setValue,
  getMap,
  setMap,
  getMapItem,
  setMapItem,
  deleteMapItem,
  deleteMapItems,
  getArray,
  setArray,
  onStorageChanged
} from './storage-base.js';

// ==================== IndexedDB 基础 ====================
export {
  registerStore,
  openDatabase,
  runStoreTransaction
} from './indexeddb-base.js';

// ==================== 钱包存储 ====================
export {
  saveWallet,
  getWallet,
  getWallets,
  deleteWallet,
  walletExists
} from './wallet-storage.js';

// ==================== 账户存储 ====================
export {
  saveAccount,
  getAccount,
  getAccounts,
  getAccountList,
  getWalletAccounts,
  updateAccount,
  deleteAccount,
  deleteAccounts,
  hasAccounts,
  accountExists,
  setSelectedAccountId,
  getSelectedAccountId,
  getSelectedAccount,
  clearSelectedAccount
} from './account-storage.js';

// ==================== 网络存储 ====================
export {
  saveSelectedNetworkName,
  getSelectedNetworkName,
  saveNetworks,
  getNetworks,
  addNetwork,
  deleteNetwork,
  updateNetwork,
  ensureDefaultNetworks,
  getNetworkConfigByKey,
  getAllNetworks,
  getNetworkByChainId
} from './network-storage.js';

// ==================== 权限存储 ====================
export {
  getAllAuthorizations,
  saveAuthorization,
  isAuthorized,
  getAuthorizedAddress,
  getAuthorization,
  deleteAuthorization,
  clearAllAuthorizations,
  getAuthorizationList
} from './permission-storage.js';

// ==================== 设置存储 ====================
export {
  getUserSettings,
  saveUserSettings,
  getUserSetting,
  updateUserSetting,
  deleteUserSetting,
  resetUserSettings,
  updateUserSettings
} from './settings-storage.js';

// ==================== 交易存储 ====================
export {
  getAllTransactions,
  saveAllTransactions,
  addTransaction,
  updateTransaction,
  getTransactionsByAddress,
  clearTransactionsByAddress
} from './transaction-storage.js';

// ==================== 工具方法 ====================

/**
 * 导出所有数据（备份）
 * @returns {Promise<Object>}
 */
export async function exportAllData() {
  try {
    const { getAllStorage } = await import('./storage-base.js');
    const data = await getAllStorage();

    return {
      data,
      timestamp: Date.now(),
      version: '1.0.0'
    };
  } catch (error) {
    console.error('❌ Export all data failed:', error);
    throw error;
  }
}

/**
 * 导入数据（恢复）
 * @param {Object} backup - 备份数据
 * @returns {Promise<void>}
 */
export async function importAllData(backup) {
  try {
    if (!backup || !backup.data) {
      throw new Error('Invalid backup data');
    }

    const { clearStorage, setStorage } = await import('./storage-base.js');

    // 清空现有数据
    await clearStorage();

    // 导入备份数据
    await setStorage(backup.data);

    console.log('✅ Data imported successfully');
  } catch (error) {
    console.error('❌ Import data failed:', error);
    throw error;
  }
}

/**
 * 清空所有数据（重置钱包）
 * @returns {Promise<void>}
 */
export async function clearAllData() {
  try {
    const { clearStorage } = await import('./storage-base.js');
    await clearStorage();
    console.log('✅ All data cleared');
  } catch (error) {
    console.error('❌ Clear all data failed:', error);
    throw error;
  }
}
