/**
 * YeYing Wallet - 钱包/账户操作
 * 负责：初始化检查、钱包列表、创建/导入钱包、子账户、切换账户、
 *       账户增删改查、导出私钥/助记词、修改密码、重置钱包
 */
import { EventType } from '../../protocol/dapp-protocol.js';
import { state } from '../state.js';
import {
  createHDWallet,
  importHDWallet,
  importPrivateKeyWallet,
  deriveSubAccount,
  WALLET_TYPE,
  createWalletInstance,
  getAccountPrivateKey,
  getWalletMnemonic,
  changeWalletPassword
} from '../vault.js';
import {
  getAccount,
  setSelectedAccountId,
  getSelectedAccountId,
  getAccountList,
  getSelectedAccount,
  saveWallet,
  saveAccount,
  getWallet,
  getWallets,
  getAccounts,
  getWalletAccounts,
  updateAccount,
  deleteAccount,
  deleteWallet,
  clearSelectedAccount,
  setStorage,
  WalletStorageKeys,
  clearAllData,
  getMpcWalletList,
  clearTransactionsByAddress,
  ensureDefaultNetworks,
  saveSelectedNetworkName,
  getNetworkConfigByKey
} from '../../storage/index.js';
import { validateAccountName } from '../../config/validation-rules.js';
import { getCachedPassword, cachePassword, refreshPasswordCache, clearPasswordCache } from '../password-cache.js';
import { resetLockTimer, lockWallet } from '../keyring.js';
import { normalizeChainId } from '../../common/chain/index.js';
import { broadcastEvent } from '../connection.js';
import { TIMEOUTS, NETWORKS, DEFAULT_NETWORK } from '../../config/index.js';
import { notifyUnlocked } from '../unlock-flow.js';
import { updateKeepAlive } from '../offscreen.js';
import { getTimestamp } from '../../common/utils/time-utils.js';
import { mpcService } from '../mpc-service.js';

const MIN_PASSWORD_LENGTH = 8;

/**
 * 检查钱包是否已初始化
 * @returns {Promise<Object>} { success, initialized }
 */
export async function isWalletInitialized() {
  try {
    const wallets = await getWallets();
    const mpcWallets = await getMpcWalletList();
    const obj = wallets || {};
    const hasHdWallet = Object.keys(obj).length > 0;
    const hasMpcWallet = Array.isArray(mpcWallets) && mpcWallets.length > 0;
    return { success: true, initialized: hasHdWallet || hasMpcWallet };
  } catch (error) {
    console.error('❌ Check wallet initialization failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 获取钱包列表（按助记词分组）
 * @returns {Promise<Object>} { success, wallets, totalAccounts }
 */
export async function HandleGetWalletList() {
  try {
    const accounts = await getAccountList();
    const selectedAccountId = await getSelectedAccountId();
    const walletsData = await getWallets();
    const mpcWallets = await getMpcWalletList();

    // 按 walletId 分组
    const walletMap = new Map();

    accounts.forEach(account => {
      const walletId = account.walletId;

      if (!walletMap.has(walletId)) {
        const wallet = walletsData[walletId];
        if (!wallet) {
          return;
        }
        wallet.accounts = [];
        walletMap.set(walletId, wallet);
      }

      walletMap.get(walletId).accounts.push({
        ...account,
        isSelected: account.id === selectedAccountId
      });
    });

    Object.values(walletsData || {}).forEach(wallet => {
      if (!wallet?.id) return;
      if (walletMap.has(wallet.id)) return;
      walletMap.set(wallet.id, { ...wallet, accounts: [] });
    });

    if (Array.isArray(mpcWallets)) {
      mpcWallets.forEach(wallet => {
        if (!wallet?.id) return;
        if (walletMap.has(wallet.id)) return;
        walletMap.set(wallet.id, { ...wallet, type: 'mpc', accounts: [] });
      });
    }

    // 转换为数组并排序
    const wallets = Array.from(walletMap.values()).sort((a, b) => {
      const aTime = a?.createdAt || 0;
      const bTime = b?.createdAt || 0;
      return bTime - aTime;
    });

    return {
      success: true,
      wallets,
      totalAccounts: accounts.length
    };

  } catch (error) {
    console.error('❌ Get wallet list failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 创建 HD 钱包
 * @param {string} accountName - 账户名称
 * @param {string} password - 密码
 * @returns {Promise<Object>} { success, wallet, account, mnemonic }
 */
export async function handleCreateHDWallet(accountName, password) {
  try {
    console.log('🔄 Creating HD wallet...');

    // 调用 vault.js 创建钱包
    const { wallet, mainAccount, mnemonic } = await createHDWallet(accountName, password);

    // 保存到存储
    await saveWallet(wallet);
    await saveAccount(mainAccount);

    // 设置为当前账户
    await setSelectedAccountId(mainAccount.id);

    console.log('✅ HD wallet created and saved:', wallet.id);

    return {
      success: true,
      wallet,
      account: mainAccount,
      mnemonic // 返回助记词供用户备份
    };

  } catch (error) {
    console.error('❌ Handle create HD wallet failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 导入助记词钱包
 * @param {string} accountName - 账户名称
 * @param {string} mnemonic - 助记词
 * @param {string} password - 密码
 * @returns {Promise<Object>} { success, wallet, account }
 */
export async function handleImportHDWallet(accountName, mnemonic, password) {
  try {
    console.log('🔄 Importing HD wallet...');

    // 导入钱包
    const { wallet, mainAccount } = await importHDWallet(accountName, mnemonic, password);

    // 保存到存储
    await saveWallet(wallet);
    await saveAccount(mainAccount);

    console.log('✅ HD wallet imported and saved:', wallet.id);

    return {
      success: true,
      wallet,
      account: mainAccount
    };

  } catch (error) {
    console.error('❌ Handle import HD wallet failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 导入私钥钱包
 * @param {string} accountName - 账户名称
 * @param {string} privateKey - 私钥
 * @param {string} password - 密码
 * @returns {Promise<Object>} { success, wallet, account }
 */
export async function handleImportPrivateKeyWallet(accountName, privateKey, password) {
  try {
    console.log('🔄 Importing private key wallet...');

    // 导入钱包
    const { wallet, mainAccount } = await importPrivateKeyWallet(accountName, privateKey, password);

    // 保存到存储
    await saveWallet(wallet);
    await saveAccount(mainAccount);

    console.log('✅ Private key wallet imported and saved:', wallet.id);

    return {
      success: true,
      wallet,
      account: mainAccount
    };

  } catch (error) {
    console.error('❌ Handle import private key wallet failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 创建子账户
 * @param {string} walletId - 钱包 ID
 * @param {string} accountName - 账户名称
 * @param {string} password - 密码
 * @returns {Promise<Object>} { success, account }
 */
export async function handleCreateSubAccount(walletId, accountName, password) {
  try {
    // 检查是否已解锁
    const passwordToUse = password || state.passwordCache;
    if (!passwordToUse) {
      return {
        success: false,
        error: '需要密码以继续创建',
        requirePassword: true
      };
    }

    console.log('🔄 Creating sub account for wallet:', walletId);

    // 获取钱包信息
    const wallet = await getWallet(walletId);
    if (!wallet) {
      return { success: false, error: '钱包不存在' };
    }

    if (wallet.type !== WALLET_TYPE.HD) {
      return { success: false, error: '只有 HD 钱包支持创建子账户' };
    }

    // 计算新账户索引：取现有最大 index + 1，避免删除中间子账户后用 length 复用
    // 已存在的 index（相同 derivationPath/地址/account-id 会覆盖旧账户）。
    const walletAccounts = await getWalletAccounts(walletId);
    const maxIndex = walletAccounts.reduce(
      (max, account) => Math.max(max, Number.isFinite(account.index) ? account.index : 0),
      -1
    );
    const newIndex = maxIndex + 1;

    // 调用 vault.js 派生子账户
    const subAccount = await deriveSubAccount(
      wallet,
      newIndex,
      accountName,
      passwordToUse,
    );

    // 保存账户
    await saveAccount(subAccount);

    // 更新钱包的账户数量
    wallet.accountCount = (wallet.accountCount || 0) + 1;
    await saveWallet(wallet);

    console.log('✅ Sub account created and saved:', subAccount.name);

    if (password) {
      cachePassword(password, TIMEOUTS.PASSWORD);
    } else {
      refreshPasswordCache();
    }

    resetLockTimer();

    return {
      success: true,
      account: subAccount
    };

  } catch (error) {
    console.error('❌ Handle create sub account failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 切换账户（支持自动解锁）
 * @param {string} accountId - 要切换到的账户 ID
 * @param {string|null} password - 密码（可选，如果有缓存则不需要）
 * @returns {Promise<Object>} { success, account, requirePassword }
 */
export async function handleSwitchAccount(accountId, password = null) {
  try {
    console.log('🔄 Switching account:', accountId);

    // 获取账户信息
    const account = await getAccount(accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    // 检查 keyring 中是否有该账户的私钥
    if (!state.keyring || !state.keyring.has(accountId)) {
      console.log('🔓 Account not unlocked, attempting to unlock...');

      // 尝试使用缓存的密码
      const cachedPassword = getCachedPassword();
      const passwordToUse = password || cachedPassword;

      if (!passwordToUse) {
        // 没有密码，需要用户输入
        console.log('⚠️ No password available, user input required');
        return {
          success: false,
          error: 'Password required to unlock account',
          requirePassword: true
        };
      }

      // 使用密码解锁该账户
      try {
        console.log('🔓 Unlocking account with', password ? 'provided password' : 'cached password');
        const walletInstance = await createWalletInstance(account, passwordToUse);

        if (!state.keyring) {
          state.keyring = new Map();
        }
        state.keyring.set(accountId, walletInstance);

        // 如果使用的是缓存的密码，刷新缓存时间
        if (!password && cachedPassword) {
          refreshPasswordCache();
        }

        // 如果提供了新密码，更新缓存
        if (password) {
          cachePassword(password, TIMEOUTS.PASSWORD);
        }

        console.log('✅ Account unlocked successfully');
        notifyUnlocked('internal');

      } catch (error) {
        console.error('❌ Failed to unlock account:', error);

        // 如果使用缓存密码失败，清除缓存
        if (!password && cachedPassword) {
          console.log('🔒 Cached password invalid, clearing cache');
          clearPasswordCache();
        }

        // 返回需要密码的错误
        return {
          success: false,
          error: 'Invalid password or failed to unlock account',
          requirePassword: true
        };
      }
    } else {
      console.log('✅ Account already unlocked');

      // 刷新密码缓存时间
      refreshPasswordCache();
    }

    // 更新当前选择的账户 ID
    await setSelectedAccountId(accountId);

    // 重置锁定计时器
    resetLockTimer();

    // 通知所有连接的页面
    broadcastEvent(EventType.ACCOUNTS_CHANGED, { accounts: [account.address] });

    console.log('✅ Account switched:', account.name);

    return {
      success: true,
      account: {
        id: account.id,
        name: account.name,
        address: account.address,
        type: account.type
      }
    };

  } catch (error) {
    console.error('❌ Switch account failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 获取当前选中的账户
 * @returns {Promise<Object>} { success, account }
 */
export async function handleGetCurrentAccount() {
  try {
    let account = await getSelectedAccount();
    if (!account) {
      const accounts = await getAccountList();
      account = accounts.length > 0 ? accounts[0] : null;
    }

    return { success: true, account };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get current account' };
  }
}

/**
 * 获取账户信息
 * @param {string} accountId
 * @returns {Promise<Object>} { success, account }
 */
export async function handleGetAccountById(accountId) {
  if (!accountId) {
    return { success: false, error: 'accountId is required' };
  }

  try {
    const account = await getAccount(accountId);
    return { success: true, account: account || null };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get account' };
  }
}

/**
 * 更新账户名称
 * @param {string} accountId
 * @param {string} newName
 * @returns {Promise<Object>} { success, account }
 */
export async function handleUpdateAccountName(accountId, newName) {
  if (!accountId) {
    return { success: false, error: 'accountId is required' };
  }

  if (!newName || !newName.trim()) {
    return { success: false, error: 'newName is required' };
  }

  const nameValidation = validateAccountName(newName.trim());
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error || 'invalid account name' };
  }

  try {
    const account = await getAccount(accountId);
    if (!account) {
      return { success: false, error: 'account not found' };
    }

    const updatedAccount = {
      ...account,
      name: newName.trim(),
      nameUpdatedAt: getTimestamp()
    };

    await updateAccount(updatedAccount);

    return { success: true, account: updatedAccount };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to update account name' };
  }
}

/**
 * 删除账户
 * @param {string} accountId
 * @param {string} password
 * @returns {Promise<Object>} { success }
 */
export async function handleDeleteAccount(accountId, password) {
  if (!accountId) {
    return { success: false, error: 'accountId is required' };
  }

  if (!password) {
    return { success: false, error: 'password is required' };
  }

  try {
    const account = await getAccount(accountId);
    if (!account) {
      return { success: false, error: 'account not found' };
    }

    await getAccountPrivateKey(account, password);

    await deleteAccount(accountId);

    if (state.keyring?.has(accountId)) {
      state.keyring.delete(accountId);
      if (state.keyring.size === 0) {
        state.keyring = null;
      }
    }

    const selectedAccountId = await getSelectedAccountId();
    if (selectedAccountId === accountId) {
      const accounts = await getAccountList();
      if (accounts.length > 0) {
        await setSelectedAccountId(accounts[0].id);
      } else {
        await clearSelectedAccount();
      }
    }

    if (account.walletId) {
      const wallet = await getWallet(account.walletId);
      if (wallet) {
        const walletAccounts = await getWalletAccounts(account.walletId);
        if (walletAccounts.length === 0) {
          await deleteWallet(account.walletId);
        } else {
          wallet.accountCount = walletAccounts.length;
          await saveWallet(wallet);
        }
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to delete account' };
  }
}

/**
 * 导出账户私钥
 * @param {string} accountId
 * @param {string} password
 * @returns {Promise<Object>} { success, privateKey }
 */
export async function handleExportPrivateKey(accountId, password) {
  if (!accountId) {
    return { success: false, error: 'accountId is required' };
  }

  if (!password) {
    return { success: false, error: 'password is required' };
  }

  try {
    const account = await getAccount(accountId);
    if (!account) {
      return { success: false, error: 'account not found' };
    }

    const privateKey = await getAccountPrivateKey(account, password);
    return { success: true, privateKey };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to export private key' };
  }
}

/**
 * 导出钱包助记词
 * @param {string} walletId
 * @param {string} password
 * @returns {Promise<Object>} { success, mnemonic }
 */
export async function handleExportMnemonic(walletId, password) {
  if (!walletId) {
    return { success: false, error: 'walletId is required' };
  }

  if (!password) {
    return { success: false, error: 'password is required' };
  }

  try {
    const wallet = await getWallet(walletId);
    if (!wallet) {
      return { success: false, error: 'wallet not found' };
    }

    const mnemonic = await getWalletMnemonic(wallet, password);
    return { success: true, mnemonic };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to export mnemonic' };
  }
}

/**
 * 修改密码
 * @param {string} oldPassword
 * @param {string} newPassword
 * @returns {Promise<Object>} { success, updatedWallets, updatedAccounts }
 */
export async function changePassword(oldPassword, newPassword) {
  if (!oldPassword || oldPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error('旧密码至少需要8位字符');
  }
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error('新密码至少需要8位字符');
  }
  if (oldPassword === newPassword) {
    throw new Error('新密码不能与旧密码相同');
  }

  const walletsMap = await getWallets();
  const wallets = Object.values(walletsMap || {});
  if (wallets.length === 0) {
    throw new Error('钱包不存在');
  }

  // 1) 先在内存中重加密所有钱包与账户。任一步失败立即抛出，此时尚未写入任何存储，
  //    状态保持旧密码不变（天然回滚）。
  const nextWalletsMap = { ...walletsMap };
  const nextAccountsMap = { ...(await getAccounts()) };
  let updatedWallets = 0;
  let updatedAccounts = 0;

  for (const wallet of wallets) {
    if (!wallet?.id) continue;
    const accounts = await getWalletAccounts(wallet.id);
    if (!accounts || accounts.length === 0) {
      throw new Error('没有账户需要更新');
    }

    const updated = await changeWalletPassword(
      wallet,
      accounts,
      oldPassword,
      newPassword
    );

    if (updated?.wallet) {
      nextWalletsMap[updated.wallet.id] = updated.wallet;
      updatedWallets += 1;
    }
    for (const account of updated?.accounts || []) {
      nextAccountsMap[account.id] = account;
      updatedAccounts += 1;
    }
  }

  // 2) 一次性原子写入钱包与账户。chrome.storage.local.set 对多 key 是单次原子提交，
  //    避免逐账户写入被 Service Worker 回收打断、造成新旧密码混杂导致导出/解锁失败。
  await setStorage({
    [WalletStorageKeys.WALLETS]: nextWalletsMap,
    [WalletStorageKeys.ACCOUNTS]: nextAccountsMap
  });

  // 3) 钱包密钥一致后再迁移 MPC 设备密钥。MPC 为独立存储，失败不应回退已成功的钱包改密，
  //    仅记录告警，由 MPC 流程单独重试。
  try {
    await mpcService.reencryptDeviceKeys(oldPassword, newPassword);
  } catch (error) {
    console.warn('[ChangePassword] MPC 设备密钥重加密失败，钱包密码已更新:', error?.message || error);
  }

  cachePassword(newPassword, TIMEOUTS.PASSWORD);
  resetLockTimer();

  return { success: true, updatedWallets, updatedAccounts };
}

/**
 * 重置钱包（清空所有数据）
 * @returns {Promise<Object>} { success }
 */
export async function handleResetWallet() {
  try {
    const pendingWindowIds = new Set();
    state.pendingRequests.forEach((request) => {
      if (request?.windowId) {
        pendingWindowIds.add(request.windowId);
      }
    });
    pendingWindowIds.forEach((windowId) => {
      chrome.windows.remove(windowId).catch(() => { });
    });

    state.connectedSites.clear();

    await lockWallet();
    await clearAllData();
    await clearTransactionsByAddress();

    state.popupBounds = null;

    await ensureDefaultNetworks(NETWORKS);
    await saveSelectedNetworkName(DEFAULT_NETWORK);

    const defaultConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);
    if (defaultConfig) {
      const chainIdHex = defaultConfig.chainIdHex || normalizeChainId(defaultConfig.chainId);
      state.currentChainId = chainIdHex;
      state.currentRpcUrl = defaultConfig.rpcUrl || defaultConfig.rpc || null;
    } else {
      state.currentChainId = null;
      state.currentRpcUrl = null;
    }

    await updateKeepAlive();

    return { success: true };
  } catch (error) {
    console.error('❌ Reset wallet failed:', error);
    return { success: false, error: error.message || 'Failed to reset wallet' };
  }
}
