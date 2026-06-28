// @ts-check
/**
 * 钱包存储
 * 管理钱包数据的存储和读取
 *
 * 存储后端：chrome.storage.local。钱包/账户/网络属于关键密钥数据，必须放在
 * 扩展可靠持久的 chrome.storage.local，不能放 IndexedDB（best-effort 持久性，
 * 可能被浏览器在会话间驱逐，曾导致钱包数据丢失）。
 */

import { WalletStorageKeys } from './storage-keys.js';
import { getMap, setMapItem, getMapItem, deleteMapItem } from './storage-base.js';
import { logError } from '../common/errors/index.js';

const STORE = WalletStorageKeys.WALLETS; // 'wallets'

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
    await setMapItem(STORE, wallet.id, wallet);
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
    return await getMapItem(STORE, walletId);
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
    return await getMap(STORE);
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
    await deleteMapItem(STORE, walletId);
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
