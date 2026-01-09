/**
 * 钱包存储
 * 管理钱包数据的存储和读取
 */

import { WalletStorageKeys } from './storage-keys.js';
import { getMap, setMapItem, getMapItem, deleteMapItem } from './storage-base.js';
import { logError } from '../common/errors/index.js';

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

    await setMapItem(WalletStorageKeys.WALLETS, wallet.id, wallet);
    console.log('✅ Wallet saved:', wallet.id);

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
    return await getMapItem(WalletStorageKeys.WALLETS, walletId);
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
    return await getMap(WalletStorageKeys.WALLETS);
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
    await deleteMapItem(WalletStorageKeys.WALLETS, walletId);
    console.log('✅ Wallet deleted:', walletId);
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

