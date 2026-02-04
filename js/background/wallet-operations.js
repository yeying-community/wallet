/**
 * YeYing Wallet - 钱包操作
 * 负责：创建钱包、导入钱包、切换账户、创建子账户
 */
import { EventType } from '../protocol/dapp-protocol.js';
import { state } from './state.js';
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
} from './vault.js';
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
  getWalletAccounts,
  updateAccount,
  deleteAccount,
  deleteWallet,
  clearSelectedAccount,
  getMap,
  getAuthorizationList,
  deleteAuthorization,
  clearAllAuthorizations,
  clearAllData,
  getUserSetting,
  updateUserSetting,
  updateUserSettings,
  getContactList,
  getContact,
  saveContact,
  deleteContact,
  clearTransactionsByAddress,
  ensureDefaultNetworks,
  saveSelectedNetworkName,
  getNetworkConfigByKey,
  UcanStorageKeys
} from '../storage/index.js';
import { validateAccountName, validateContactName, validateEthereumAddress, validateTokenConfig } from '../config/validation-rules.js';
import { handleRpcMethod } from './rpc-handler.js';
import { getCachedPassword, cachePassword, refreshPasswordCache, clearPasswordCache } from './password-cache.js';
import { resetLockTimer, lockWallet } from './keyring.js';
import { normalizeChainId } from '../common/chain/index.js';
import { broadcastEvent, sendEvent } from './connection.js';
import { TIMEOUTS, LIMITS, NETWORKS, DEFAULT_NETWORK, isDeveloperFeatureEnabled } from '../config/index.js';
import { notifyUnlocked } from './unlock-flow.js';
import { updateKeepAlive } from './offscreen.js';
import { getTimestamp } from '../common/utils/time-utils.js';
import { backupSyncService } from './sync-service.js';

const CUSTOM_TOKENS_KEY = 'custom_tokens';
const MIN_PASSWORD_LENGTH = 8;

/**
 * 检查钱包是否已初始化
 * @returns {Promise<boolean>} 是否已初始化
 */
export async function isWalletInitialized() {
  try {
    const wallets = await getWallets();
    const obj = wallets || {};
    return { success: true, initialized: Object.keys(obj).length > 0 };
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

    // 按 walletId 分组
    const walletMap = new Map();

    accounts.forEach(account => {
      const walletId = account.walletId;

      if (!walletMap.has(walletId)) {
        const wallet = walletsData[walletId];
        wallet.accounts = [];
        walletMap.set(walletId, wallet);
      }

      walletMap.get(walletId).accounts.push({
        ...account,
        isSelected: account.id === selectedAccountId
      });
    });
        // 转换为数组并排序
    const wallets = Array.from(walletMap.values()).sort((a, b) => {
      const aTime = walletsData[a.id]?.createdAt || 0;
      const bTime = walletsData[b.id]?.createdAt || 0;
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

    // 计算新账户索引
    const walletAccounts = await getWalletAccounts(walletId);
    const newIndex = walletAccounts.length;

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
        notifyUnlocked();

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
 * 获取余额（ETH）
 * @param {string} address
 * @returns {Promise<Object>} { success, balance }
 */
export async function handleGetBalance(address) {
  if (!address) {
    return { success: false, error: 'address is required' };
  }

  const addressValidation = validateEthereumAddress(address);
  if (!addressValidation.valid) {
    return { success: false, error: addressValidation.error || 'invalid address' };
  }

  try {
    const balanceHex = await handleRpcMethod('eth_getBalance', [address, 'latest']);
    const balance = formatEtherForDisplay(balanceHex, 4);
    return { success: true, balance };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get balance' };
  }
}

/**
 * 添加通证
 * @param {Object} token
 * @returns {Promise<Object>} { success, token }
 */
export async function handleAddToken(token) {
  if (!token || typeof token !== 'object') {
    return { success: false, error: 'token is required' };
  }

  const validation = validateTokenConfig(token);
  if (!validation.valid) {
    return { success: false, error: validation.errors?.[0] || 'invalid token' };
  }

  const chainId = token.chainId || state.currentChainId || '0x1';
  const normalizedAddress = token.address.toLowerCase();
  const decimals = Number.isFinite(token.decimals)
    ? token.decimals
    : parseInt(token.decimals ?? '18', 10);

  const normalizedToken = {
    address: normalizedAddress,
    symbol: token.symbol,
    name: token.name || token.symbol,
    decimals: Number.isFinite(decimals) ? decimals : 18,
    image: token.image || null,
    chainId
  };

  try {
    const allTokens = await getUserSetting(CUSTOM_TOKENS_KEY, {});
    const list = Array.isArray(allTokens[chainId]) ? [...allTokens[chainId]] : [];
    const existingIndex = list.findIndex(item => item?.address?.toLowerCase() === normalizedAddress);

    if (existingIndex >= 0) {
      list[existingIndex] = { ...list[existingIndex], ...normalizedToken };
    } else {
      if (list.length >= LIMITS.MAX_TOKENS_PER_ACCOUNT) {
        return { success: false, error: 'token limit reached' };
      }
      list.push(normalizedToken);
    }

    allTokens[chainId] = list;
    await updateUserSetting(CUSTOM_TOKENS_KEY, allTokens);

    return { success: true, token: normalizedToken };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to add token' };
  }
}

/**
 * 获取通证余额列表
 * @param {string} address
 * @returns {Promise<Object>} { success, tokens }
 */
export async function handleGetTokenBalances(address) {
  if (!address) {
    return { success: false, error: 'address is required' };
  }

  const addressValidation = validateEthereumAddress(address);
  if (!addressValidation.valid) {
    return { success: false, error: addressValidation.error || 'invalid address' };
  }

  const chainId = state.currentChainId || '0x1';

  try {
    const allTokens = await getUserSetting(CUSTOM_TOKENS_KEY, {});
    const tokens = Array.isArray(allTokens[chainId]) ? allTokens[chainId] : [];

    if (tokens.length === 0) {
      return { success: true, tokens: [] };
    }

    const balances = await Promise.all(tokens.map(async (token) => {
      try {
        const balanceHex = await getTokenBalanceHex(token.address, address);
        const balance = formatTokenBalance(balanceHex, token.decimals ?? 18, 4);
        return {
          ...token,
          balance
        };
      } catch (error) {
        return {
          ...token,
          balance: '0'
        };
      }
    }));

    return { success: true, tokens: balances };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get token balances' };
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

  const updates = [];

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
    updates.push(updated);
  }

  let updatedWallets = 0;
  let updatedAccounts = 0;
  for (const updated of updates) {
    if (updated?.wallet) {
      await saveWallet(updated.wallet);
      updatedWallets += 1;
    }
    for (const account of updated?.accounts || []) {
      await updateAccount(account);
      updatedAccounts += 1;
    }
  }

  cachePassword(newPassword, TIMEOUTS.PASSWORD);
  resetLockTimer();

  return { success: true, updatedWallets, updatedAccounts };
}

/**
 * 获取授权网站列表
 * @returns {Promise<Object>} { success, sites }
 */
export async function handleGetAuthorizedSites() {
  try {
    const sites = await getAuthorizationList();
    return { success: true, sites };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get authorized sites' };
  }
}

/**
 * 获取指定网站的 UCAN 会话信息（当前有效优先，否则最近一次）
 * @param {string} origin
 * @param {string} address
 * @returns {Promise<Object>} { success, session }
 */
export async function handleGetSiteUcanSession(origin, address) {
  if (!origin) {
    return { success: false, error: 'origin is required' };
  }

  try {
    const sessionsMap = await getMap(UcanStorageKeys.UCAN_SESSIONS);
    const records = Object.values(sessionsMap || {});
    const filtered = records.filter(record => {
      if (!record) return false;
      if (origin && record.origin !== origin) return false;
      if (address && record.address !== address) return false;
      return true;
    });

    if (!filtered.length) {
      return { success: true, session: null };
    }

    const now = Date.now();
    const active = filtered.filter(record => record.expiresAt && record.expiresAt > now);
    const pickFrom = active.length ? active : filtered;
    pickFrom.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const selected = pickFrom[0];
    if (!selected) {
      return { success: true, session: null };
    }

    const isActive = selected.expiresAt ? selected.expiresAt > now : true;

    return {
      success: true,
      session: {
        id: selected.id,
        did: selected.did,
        createdAt: selected.createdAt,
        expiresAt: selected.expiresAt,
        isActive
      }
    };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get UCAN session' };
  }
}

/**
 * 撤销指定网站授权
 * @param {string} origin
 * @returns {Promise<Object>} { success }
 */
export async function handleRevokeSite(origin) {
  if (!origin) {
    return { success: false, error: 'origin is required' };
  }

  try {
    await deleteAuthorization(origin);
    state.connectedSites.delete(origin);
    updateKeepAlive();

    state.connections.forEach(({ port, origin: connOrigin }) => {
      if (connOrigin === origin) {
        sendEvent(port, EventType.ACCOUNTS_CHANGED, { accounts: [] });
      }
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to revoke site' };
  }
}

/**
 * 清除所有授权
 * @returns {Promise<Object>} { success }
 */
export async function handleClearAllAuthorizations() {
  try {
    await clearAllAuthorizations();
    state.connectedSites.clear();
    updateKeepAlive();

    state.connections.forEach(({ port }) => {
      sendEvent(port, EventType.ACCOUNTS_CHANGED, { accounts: [] });
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to clear authorizations' };
  }
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

// ==================== 联系人管理 ====================

function normalizeContactAddress(address) {
  return String(address || '').trim();
}

function createContactId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `contact_${Date.now()}_${random}`;
}

function findDuplicateContact(contacts, address, excludeId = null) {
  const normalized = String(address || '').toLowerCase();
  if (!normalized) return null;
  return contacts.find(contact => {
    if (!contact) return false;
    if (excludeId && contact.id === excludeId) return false;
    const existing = String(contact.address || '').toLowerCase();
    return existing === normalized;
  });
}

export async function handleGetContacts() {
  try {
    const contacts = await getContactList();
    contacts.sort((a, b) => (a?.name || '').localeCompare(b?.name || '', 'zh-CN'));
    return { success: true, contacts };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get contacts' };
  }
}

export async function handleAddContact(data = {}) {
  const name = String(data?.name || '').trim();
  const address = normalizeContactAddress(data?.address);
  const note = String(data?.note || '').trim();

  const nameValidation = validateContactName(name);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error || 'Invalid contact name' };
  }

  const addressValidation = validateEthereumAddress(address);
  if (!addressValidation.valid) {
    return { success: false, error: addressValidation.error || 'Invalid address' };
  }

  try {
    const contacts = await getContactList();
    const duplicate = findDuplicateContact(contacts, address);
    if (duplicate) {
      return { success: false, error: '该地址已存在于联系人中' };
    }

    const now = Date.now();
    const contact = {
      id: createContactId(),
      name,
      address,
      note,
      createdAt: now,
      updatedAt: now
    };

    await saveContact(contact);
    return { success: true, contact };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to add contact' };
  }
}

export async function handleUpdateContact(data = {}) {
  const contactId = String(data?.id || '').trim();
  if (!contactId) {
    return { success: false, error: 'contactId is required' };
  }

  const existing = await getContact(contactId);
  if (!existing) {
    return { success: false, error: 'Contact not found' };
  }

  const name = data?.name != null ? String(data.name).trim() : existing.name;
  const address = data?.address != null ? normalizeContactAddress(data.address) : existing.address;
  const note = data?.note != null ? String(data.note).trim() : existing.note || '';

  const nameValidation = validateContactName(name);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error || 'Invalid contact name' };
  }

  const addressValidation = validateEthereumAddress(address);
  if (!addressValidation.valid) {
    return { success: false, error: addressValidation.error || 'Invalid address' };
  }

  try {
    const contacts = await getContactList();
    const duplicate = findDuplicateContact(contacts, address, contactId);
    if (duplicate) {
      return { success: false, error: '该地址已存在于联系人中' };
    }

    const updated = {
      ...existing,
      name,
      address,
      note,
      updatedAt: Date.now()
    };

    await saveContact(updated);
    return { success: true, contact: updated };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to update contact' };
  }
}

export async function handleDeleteContact(contactId) {
  if (!contactId) {
    return { success: false, error: 'contactId is required' };
  }
  try {
    await deleteContact(contactId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to delete contact' };
  }
}

// ==================== Backup & Sync ====================

const DEFAULT_BACKUP_SYNC_ENDPOINT = 'https://webdav.yeying.pub/api';
const BACKUP_SYNC_MODES = new Set(['siwe', 'ucan', 'basic']);

function normalizeBackupSyncEndpoint(value) {
  const trimmed = String(value || '').trim();
  return trimmed || DEFAULT_BACKUP_SYNC_ENDPOINT;
}

export async function handleGetBackupSyncSettings() {
  try {
    const settings = {
      enabled: await getUserSetting('backupSyncEnabled', true),
      endpoint: await getUserSetting('backupSyncEndpoint', DEFAULT_BACKUP_SYNC_ENDPOINT),
      authMode: await getUserSetting('backupSyncAuthMode', 'ucan'),
      authToken: await getUserSetting('backupSyncAuthToken', ''),
      authTokenExpiresAt: await getUserSetting('backupSyncAuthTokenExpiresAt', null),
      ucanToken: await getUserSetting('backupSyncUcanToken', ''),
      ucanResource: await getUserSetting('backupSyncUcanResource', ''),
      ucanAction: await getUserSetting('backupSyncUcanAction', ''),
      ucanAudience: await getUserSetting('backupSyncUcanAudience', ''),
      basicAuth: await getUserSetting('backupSyncBasicAuth', ''),
      lastPullAt: await getUserSetting('backupSyncLastPullAt', null),
      lastPushAt: await getUserSetting('backupSyncLastPushAt', null),
      pendingDelete: await getUserSetting('backupSyncPendingDelete', false),
      networkIds: await getUserSetting('backupSyncNetworkIds', []),
      conflicts: await getUserSetting('backupSyncConflicts', []),
      logs: await getUserSetting('backupSyncLogs', [])
    };

    return { success: true, settings };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get backup sync settings' };
  }
}

export async function handleUpdateBackupSyncSettings(updates = {}) {
  try {
    const sanitized = {};

    if ('enabled' in updates) {
      sanitized.backupSyncEnabled = Boolean(updates.enabled);
    }

    if ('endpoint' in updates) {
      sanitized.backupSyncEndpoint = normalizeBackupSyncEndpoint(updates.endpoint);
    }

    if ('authMode' in updates) {
      const mode = String(updates.authMode || '').toLowerCase();
      if (BACKUP_SYNC_MODES.has(mode)) {
        sanitized.backupSyncAuthMode = mode;
      }
    }

    if ('authToken' in updates) {
      sanitized.backupSyncAuthToken = String(updates.authToken || '');
    }

    if ('authTokenExpiresAt' in updates) {
      sanitized.backupSyncAuthTokenExpiresAt = updates.authTokenExpiresAt ?? null;
    }

    if ('ucanToken' in updates) {
      sanitized.backupSyncUcanToken = String(updates.ucanToken || '');
    }

    if ('ucanResource' in updates) {
      sanitized.backupSyncUcanResource = String(updates.ucanResource || '');
    }

    if ('ucanAction' in updates) {
      sanitized.backupSyncUcanAction = String(updates.ucanAction || '');
    }

    if ('ucanAudience' in updates) {
      sanitized.backupSyncUcanAudience = String(updates.ucanAudience || '');
    }

    if ('basicAuth' in updates) {
      sanitized.backupSyncBasicAuth = String(updates.basicAuth || '');
    }

    if ('conflicts' in updates) {
      if (isDeveloperFeatureEnabled('ENABLE_DEBUG_MODE')) {
        sanitized.backupSyncConflicts = Array.isArray(updates.conflicts) ? updates.conflicts : [];
      }
    }

    if (Object.keys(sanitized).length > 0) {
      await updateUserSettings(sanitized);
    }

    if (sanitized.backupSyncEnabled === false) {
      await backupSyncService.disableSync();
    }

    if (
      sanitized.backupSyncEnabled === true ||
      'backupSyncAuthToken' in sanitized ||
      'backupSyncUcanToken' in sanitized ||
      'backupSyncBasicAuth' in sanitized
    ) {
      await backupSyncService.tryStartAutoSync();
    }

    return await handleGetBackupSyncSettings();
  } catch (error) {
    return { success: false, error: error.message || 'Failed to update backup sync settings' };
  }
}

export async function handleBackupSyncNow() {
  try {
    await backupSyncService.syncAll('manual');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to sync now' };
  }
}

export async function handleBackupSyncClearRemote() {
  try {
    await backupSyncService.clearRemoteNow();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to clear remote backup' };
  }
}

export async function handleBackupSyncClearLogs() {
  try {
    await backupSyncService.clearActivityLogs();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to clear sync logs' };
  }
}

export async function handleResolveBackupSyncConflict(options = {}) {
  const conflictId = String(options?.id || '').trim();
  const action = String(options?.action || '').trim();
  if (!conflictId || !action) {
    return { success: false, error: 'conflict id and action are required' };
  }

  try {
    const conflicts = await getUserSetting('backupSyncConflicts', []);
    const list = Array.isArray(conflicts) ? conflicts : [];
    const target = list.find(item => item?.id === conflictId);
    if (!target) {
      return { success: false, error: 'conflict not found' };
    }

    if (target.type === 'account' && target.accountId) {
      const account = await getAccount(target.accountId);
      if (!account) {
        return { success: false, error: 'account not found' };
      }
      const nextName = action === 'remote' ? target.remoteName : target.localName;
      const nextTimestamp = action === 'remote'
        ? (target.timestamp || getTimestamp())
        : getTimestamp();
      await updateAccount({
        ...account,
        name: nextName,
        nameUpdatedAt: nextTimestamp
      });
    } else if (target.type === 'contact' && target.contactId) {
      const contact = await getContact(target.contactId);
      if (!contact) {
        return { success: false, error: 'contact not found' };
      }
      const nextName = action === 'remote' ? target.remoteName : target.localName;
      const nextNote = action === 'remote' ? (target.remoteNote || '') : (target.localNote || '');
      const nextTimestamp = action === 'remote'
        ? (target.timestamp || Date.now())
        : Date.now();
      await saveContact({
        ...contact,
        name: nextName,
        note: nextNote,
        updatedAt: nextTimestamp
      });
    }

    const nextConflicts = list.filter(item => item?.id !== conflictId);
    await updateUserSetting('backupSyncConflicts', nextConflicts);
    backupSyncService.markDirty('conflict-resolved');

    return { success: true, conflicts: nextConflicts };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to resolve conflict' };
  }
}

function formatEtherForDisplay(balanceHex, decimals = 4) {
  try {
    if (!balanceHex) return '0.0000';
    const wei = BigInt(balanceHex);
    const base = 10n ** 18n;
    const integer = wei / base;
    const fraction = wei % base;
    if (decimals <= 0) {
      return integer.toString();
    }
    const fractionStr = fraction.toString().padStart(18, '0');
    const displayFraction = fractionStr.slice(0, decimals).padEnd(decimals, '0');
    return `${integer.toString()}.${displayFraction}`;
  } catch (error) {
    return '0.0000';
  }
}

function formatTokenBalance(balanceHex, decimals = 18, displayDecimals = 4) {
  try {
    if (!balanceHex) return '0';
    const value = BigInt(balanceHex);
    const base = 10n ** BigInt(decimals);
    const integer = value / base;
    const fraction = value % base;

    if (displayDecimals <= 0) {
      return integer.toString();
    }

    const fractionStr = fraction.toString().padStart(decimals, '0').slice(0, displayDecimals);
    let formatted = `${integer.toString()}.${fractionStr}`;
    formatted = formatted.replace(/\.?0+$/, '');
    return formatted || '0';
  } catch (error) {
    return '0';
  }
}

async function getTokenBalanceHex(tokenAddress, accountAddress) {
  const normalizedToken = tokenAddress?.toLowerCase();
  const normalizedAccount = accountAddress?.toLowerCase();
  if (!normalizedToken || !normalizedAccount) {
    throw new Error('invalid token or account');
  }

  const addressData = normalizedAccount.replace(/^0x/, '').padStart(64, '0');
  const data = `0x70a08231${addressData}`;

  return handleRpcMethod('eth_call', [
    {
      to: normalizedToken,
      data
    },
    'latest'
  ]);
}
