// @ts-check
/**
 * 账户存储
 * 管理账户数据的存储和读取
 *
 * 存储后端：chrome.storage.local（关键密钥数据，不放 IndexedDB）。
 *
 * 阶段 0 起（schemaVersion=2），账户对象附带链身份字段 namespace/chainKey/
 * coinType/publicKey，读路径对老数据（无这些字段）做惰性补全，**写不改密文**；
 * publicKey 由私钥在 vault 层派生后落库，老数据若无则回填为空串（不抛错）。
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
import { getMpcWallet } from './mpc-storage.js';
import { logError } from '../common/errors/index.js';
import {
  DEFAULT_CHAIN_KEY,
  DEFAULT_COIN_TYPE,
  DEFAULT_NAMESPACE
} from '../chain/chain-key.js';

const STORE = WalletStorageKeys.ACCOUNTS; // 'accounts'
const SELECTED_KEY = WalletStorageKeys.SELECTED_ACCOUNT_ID;
const MPC_ACCOUNT_ID_PREFIX = 'mpc:';
// schemaVersion=3：阶段 1 Tron 加入后，account.namespace/chainKey/coinType 可以
// 是 'tron' / 'tron:<ref>' / 195；若用户既有账户缺这三字段，回填 EVM 默认。
const SCHEMA_VERSION = 3;

function getMpcWalletIdFromAccountId(accountId) {
  return String(accountId || '').startsWith(MPC_ACCOUNT_ID_PREFIX)
    ? String(accountId || '').slice(MPC_ACCOUNT_ID_PREFIX.length).trim()
    : '';
}

/**
 * 读时补全账户的链身份字段。无 namespace/chainKey/coinType/publicKey 时填入
 * 阶段 0 默认（EVM, eip155:1, coinType 60），publicKey 缺省为空串。
 *
 * @param {Object|null|undefined} account
 * @returns {Object|null}
 */
function withAccountDefaults(account) {
  if (!account || typeof account !== 'object') return account;
  const next = { ...account };
  if (typeof next.namespace !== 'string' || !next.namespace) {
    next.namespace = DEFAULT_NAMESPACE;
  }
  if (typeof next.chainKey !== 'string' || !next.chainKey) {
    next.chainKey = DEFAULT_CHAIN_KEY;
  }
  if (!Number.isInteger(next.coinType)) {
    next.coinType = DEFAULT_COIN_TYPE;
  }
  if (typeof next.publicKey !== 'string') {
    next.publicKey = '';
  }
  return next;
}

function buildMpcAccountView(wallet) {
  if (!wallet?.id || !String(wallet?.address || '').trim()) {
    return null;
  }
  return {
    id: `${MPC_ACCOUNT_ID_PREFIX}${wallet.id}`,
    walletId: wallet.id,
    walletType: 'mpc',
    type: 'mpc',
    name: wallet.name || 'MPC Wallet',
    address: wallet.address,
    status: wallet.status || '',
    publicKey: wallet.publicKey || '',
    namespace: DEFAULT_NAMESPACE,
    chainKey: DEFAULT_CHAIN_KEY,
    coinType: DEFAULT_COIN_TYPE,
    keygenSessionId: wallet.keygenSessionId || '',
    keyVersion: wallet.keyVersion,
    shareVersion: wallet.shareVersion,
  };
}

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
    const enriched = { ...withAccountDefaults(account), schemaVersion: SCHEMA_VERSION };
    await setMapItem(STORE, account.id, enriched);
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
    return withAccountDefaults(await getMapItem(STORE, accountId));
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
    const raw = await getMap(STORE);
    const out = {};
    for (const [id, account] of Object.entries(raw || {})) {
      out[id] = withAccountDefaults(account);
    }
    return out;
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
    const enriched = { ...withAccountDefaults(account), schemaVersion: SCHEMA_VERSION };
    await setMapItem(STORE, account.id, enriched);
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
    const mpcWalletId = getMpcWalletIdFromAccountId(accountId);
    if (mpcWalletId) {
      return buildMpcAccountView(await getMpcWallet(mpcWalletId));
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
