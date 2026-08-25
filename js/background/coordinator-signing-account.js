import {
  getAccountList,
  getSelectedAccount
} from '../storage/index.js';
import { createWalletInstance } from './vault.js';
import { state } from './state.js';
import { cachePassword, getCachedPassword, refreshPasswordCache } from './password-cache.js';

const MPC_ACCOUNT_ID_PREFIX = 'mpc:';

export function isMpcAccount(account) {
  return String(account?.id || '').startsWith(MPC_ACCOUNT_ID_PREFIX)
    || String(account?.type || '').trim().toLowerCase() === 'mpc'
    || String(account?.walletType || '').trim().toLowerCase() === 'mpc';
}

export async function getCoordinatorSigningAccount() {
  const selected = await getSelectedAccount();
  if (selected?.id && selected?.address && !isMpcAccount(selected)) {
    return selected;
  }

  const accounts = await getAccountList();
  if (Array.isArray(accounts)) {
    const account = accounts.find((item) => item?.id && item?.address && !isMpcAccount(item));
    if (account) return account;
  }

  throw new Error('需要使用已解锁的 HD 钱包完成协调器授权');
}

export async function ensureCoordinatorSigningAccountUnlocked(account, passwordOverride) {
  if (!account?.id) {
    throw new Error('未找到当前账户');
  }
  if (state.keyring?.has(account.id)) {
    refreshPasswordCache();
    return account;
  }
  const password = String(passwordOverride || '').trim() || getCachedPassword();
  if (!password) {
    throw new Error('请先解锁钱包后再试');
  }
  const walletInstance = await createWalletInstance(account, password);
  if (!state.keyring) {
    state.keyring = new Map();
  }
  state.keyring.set(account.id, walletInstance);
  cachePassword(password);
  return account;
}

export async function getUnlockedCoordinatorSigningAccount(passwordOverride) {
  const account = await getCoordinatorSigningAccount();
  return await ensureCoordinatorSigningAccountUnlocked(account, passwordOverride);
}
