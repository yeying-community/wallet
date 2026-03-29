/**
 * YeYing Wallet - 密钥管理（内存）
 * 负责：解锁/锁定钱包、管理内存中的私钥
 */
import { EventType } from '../protocol/dapp-protocol.js';
import { state } from './state.js';
import { createInvalidPasswordError, createAccountNotFoundError, createWalletLockedError } from '../common/errors/index.js';
import { validatePassword } from '../common/crypto/index.js';
import { createWalletInstance } from './vault.js';
import { getAccount, getAccountList, setSelectedAccountId } from '../storage/index.js';
import { cachePassword, clearPasswordCache, refreshPasswordCache } from './password-cache.js';
import { broadcastEvent } from './connection.js';
import { TIMEOUTS } from '../config/index.js';
import { notifyUnlocked } from './unlock-flow.js';
import { updateKeepAlive } from './offscreen.js';
import { backupSyncService } from './sync-service.js';
import { mpcService } from './mpc-service.js';

/**
 * 解锁钱包
 * @param {string} password - 密码
 * @param {string} accountId - 账户 ID
 * @param {string} source - 解锁来源（popup / approval / internal）
 * @returns {Promise<Object>} { success, account }
 */
export async function unlockWallet(password, accountId, source = 'unknown') {
  try {
    console.log('🔓 Unlocking wallet...');

    // 验证密码
    const result = validatePassword(password);
    if (!result.valid) {
      throw createInvalidPasswordError();
    }

    // 获取账户信息
    let account = accountId ? await getAccount(accountId) : null;
    if (!account) {
      const accounts = await getAccountList();
      if (accounts.length > 0) {
        account = accounts[0];
      }
    }

    if (!account) {
      throw createAccountNotFoundError(accountId);
    }

    // 解密并创建钱包实例
    const walletInstance = await createWalletInstance(account, password);

    // 保存到内存 keyring
    if (!state.keyring) {
      state.keyring = new Map();
    }
    state.keyring.set(accountId, walletInstance);

    // 保存当前选择的账户 ID
    await setSelectedAccountId(account.id);

    // 🔑 缓存密码（60 秒）
    cachePassword(password, TIMEOUTS.PASSWORD);

    // 启动自动锁定计时器
    resetLockTimer();

    // 通知等待解锁的请求
    notifyUnlocked(source);
    updateKeepAlive();

    backupSyncService.onUnlocked(password).catch((error) => {
      console.warn('[BackupSync] unlock hook failed:', error?.message || error);
    });
    mpcService.onUnlocked(password).catch((error) => {
      console.warn('[MPC] unlock hook failed:', error?.message || error);
    });

    console.log('✅ Wallet unlocked');

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
    console.error('❌ Unlock wallet failed:', error);
    throw error;
  }
}

/**
 * 锁定钱包
 * @returns {Promise<Object>} { success }
 */
export async function lockWallet() {
  try {
    console.log('🔒 Locking wallet...');

    // 清除内存中的私钥
    if (state.keyring) {
      state.keyring.clear();
      state.keyring = null;
    }

    // 清除密码缓存
    clearPasswordCache();

    // 清除锁定计时器
    if (state.lockTimer) {
      clearTimeout(state.lockTimer);
      state.lockTimer = null;
    }

    // 通知所有连接的页面
    broadcastEvent(EventType.ACCOUNTS_CHANGED, { accounts: [] });
    updateKeepAlive();

    backupSyncService.onLocked().catch((error) => {
      console.warn('[BackupSync] lock hook failed:', error?.message || error);
    });
    mpcService.onLocked().catch((error) => {
      console.warn('[MPC] lock hook failed:', error?.message || error);
    });

    console.log('✅ Wallet locked');

    return { success: true };

  } catch (error) {
    console.error('❌ Lock wallet failed:', error);
    throw error;
  }
}

/**
 * 重置自动锁定计时器
 */
export function resetLockTimer() {
  if (state.lockTimer) {
    clearTimeout(state.lockTimer);
  }

  state.lockTimer = setTimeout(() => {
    console.log('⏰ Auto-locking wallet...');
    lockWallet();
  }, TIMEOUTS.UNLOCK);
}

/**
 * 获取钱包实例（用于签名）
 * @param {string} accountId - 账户 ID
 * @returns {Object} Wallet 实例
 */
export function getWalletInstance(accountId) {
  if (!state.keyring || !state.keyring.has(accountId)) {
    throw createWalletLockedError();
  }

  // 更新活动时间
  resetLockTimer();

  // 刷新密码缓存时间
  refreshPasswordCache();

  return state.keyring.get(accountId);
}

/**
 * 检查钱包是否已解锁
 * @returns {boolean}
 */
export function isWalletUnlocked() {
  return state.keyring !== null;
}
