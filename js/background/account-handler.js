/**
 * YeYing Wallet - 账户处理
 * 负责：eth_accounts、eth_requestAccounts
 */
import { EventType } from '../protocol/dapp-protocol.js';
import { state } from './state.js';
import {
  createWalletLockedError,
  createInvalidParams,
  createUserRejectedError,
  createError
} from '../common/errors/index.js';
import { getMpcWalletList, getSelectedAccount, saveAuthorization, getAuthorization, deleteAuthorization, isAuthorized } from '../storage/index.js';
import { isAccountUnlocked, resetLockTimer } from './keyring.js';
import { refreshPasswordCache } from './password-cache.js';
import { sendEvent } from './connection.js';
import { TIMEOUTS } from '../config/index.js';
import { getTimestamp } from '../common/utils/time-utils.js';
import { updateKeepAlive } from './offscreen.js';
import {
  addPendingRequest,
  ensureApprovalRequestVisible,
  ensureApprovalStateHydrated,
  findPendingRequest,
  findPendingRequestByClientKey,
  focusApprovalSession,
  focusPendingWindow,
  getClientRequestKey,
  hasActiveApprovalForSession,
  removePendingRequest,
  waitForApprovalResponse
} from './approval-flow.js';

const connectInFlight = new Map();
const RECENT_CONNECT_GRANT_WINDOW_MS = 30000;
const recentConnectApprovals = new Map();

function updateConnectedSites() {
  updateKeepAlive();
}

function getOriginTabKey(origin, tabId) {
  return `${origin || 'unknown'}:${typeof tabId === 'number' ? tabId : 'none'}`;
}

function markRecentConnectApproval(origin, tabId) {
  const key = getOriginTabKey(origin, tabId);
  recentConnectApprovals.set(key, Date.now());
  setTimeout(() => {
    if (recentConnectApprovals.get(key) <= Date.now() - RECENT_CONNECT_GRANT_WINDOW_MS) {
      recentConnectApprovals.delete(key);
    }
  }, RECENT_CONNECT_GRANT_WINDOW_MS + 1000);
}

export function hasRecentConnectApproval(origin, tabId) {
  const key = getOriginTabKey(origin, tabId);
  const approvedAt = recentConnectApprovals.get(key) || 0;
  if (Date.now() - approvedAt <= RECENT_CONNECT_GRANT_WINDOW_MS) {
    return true;
  }
  recentConnectApprovals.delete(key);
  return false;
}

function buildEthAccountsPermission(accounts) {
  return {
    parentCapability: 'eth_accounts',
    caveats: [
      {
        type: 'restrictReturnedAccounts',
        value: accounts
      }
    ]
  };
}

const ALLOWED_IDENTITY_SCOPES = new Set(['identity.basic', 'identity.wallet', 'identity.username', 'identity.email', 'identity.avatar']);

function normalizeIdentityScopes(scopes) {
  const normalized = [...new Set(
    (Array.isArray(scopes) ? scopes : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )];
  if (normalized.length === 0 || normalized.some((scope) => !ALLOWED_IDENTITY_SCOPES.has(scope))) {
    throw createInvalidParams('Invalid wallet_identity.scopes');
  }
  if (!normalized.includes('identity.basic')) {
    normalized.unshift('identity.basic');
  }
  return normalized;
}

function buildIdentityPermission(scopes) {
  return {
    parentCapability: 'wallet_identity',
    caveats: [{ type: 'restrictIdentityScopes', value: scopes }]
  };
}

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function dedupeAddresses(addresses = []) {
  const seen = new Set();
  const result = [];
  for (const address of addresses) {
    const value = String(address || '').trim();
    const key = normalizeAddress(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function isMpcWalletAddressReady(wallet) {
  if (!wallet?.address) {
    return false;
  }
  const status = String(wallet?.status || '').trim();
  return !['failed', 'keygen_interrupted', 'cancelled', 'canceled'].includes(status);
}

async function getAvailableAccountAddresses(selectedAccount = null) {
  const addresses = [];
  if (selectedAccount?.address) {
    addresses.push(selectedAccount.address);
  }
  const mpcWallets = await getMpcWalletList();
  for (const wallet of Array.isArray(mpcWallets) ? mpcWallets : []) {
    if (isMpcWalletAddressReady(wallet)) {
      addresses.push(wallet.address);
    }
  }
  return dedupeAddresses(addresses);
}

function filterAvailableAuthorizedAccounts(authorizedAccounts = [], availableAccounts = []) {
  const available = new Map(availableAccounts.map((address) => [normalizeAddress(address), address]));
  return dedupeAddresses(authorizedAccounts)
    .map((address) => available.get(normalizeAddress(address)))
    .filter(Boolean);
}

/**
 * 处理 eth_accounts
 * @returns {Promise<Array<string>>} 账户地址数组
 */
export async function handleEthAccounts(origin) {
  try {
    // 获取选择的账户信息
    const account = await getSelectedAccount();
    if (!account || !isAccountUnlocked(account.id)) {
      return [];
    }

    if (!origin) {
      return [];
    }

    const isConnected = state.connectedSites.has(origin) || await isAuthorized(origin);
    if (!isConnected) {
      return [];
    }

    const availableAccounts = await getAvailableAccountAddresses(account);
    const connected = state.connectedSites.get(origin);
    const stored = await getAuthorization(origin);
    const authorizedAccounts = Array.isArray(connected?.accounts) && connected.accounts.length
      ? connected.accounts
      : (Array.isArray(stored?.accounts) && stored.accounts.length ? stored.accounts : [stored?.address]);
    return filterAvailableAuthorizedAccounts(authorizedAccounts, availableAccounts);

  } catch (error) {
    console.error('❌ Handle eth_accounts failed:', error);
    return [];
  }
}

/**
 * 处理 eth_requestAccounts
 * @param {string} origin - 请求来源
 * @param {number} tabId - 标签页 ID
 * @returns {Promise<Array<string>>} 账户地址数组
 */
export async function handleEthRequestAccounts(origin, tabId, clientRequestId = null) {
  const key = getOriginTabKey(origin, tabId);

  if (connectInFlight.has(key)) {
    const pending = findPendingRequest(EventType.CONNECT, origin, tabId);
    if (pending) {
      focusPendingWindow(pending);
    }
    return connectInFlight.get(key);
  }

  const requestPromise = (async () => {
    try {
      await ensureApprovalStateHydrated();
      console.log('🔗 eth_requestAccounts called from:', origin);

      const pending = findPendingRequest(EventType.CONNECT, origin, tabId);
      const clientRequestKey = getClientRequestKey(origin, tabId, 'eth_requestAccounts', clientRequestId);
      const resumablePending = findPendingRequestByClientKey(clientRequestKey);
      if (pending && !resumablePending) {
        focusPendingWindow(pending);
        throw createError(-32002, 'Connection request already pending');
      }

      if (hasActiveApprovalForSession(origin, tabId) && !resumablePending) {
        focusApprovalSession(origin, tabId);
        throw createError(-32002, 'Approval request already pending');
      }

      // 获取当前账户
      const account = await getSelectedAccount();
      if (!account) {
        throw createWalletLockedError();
      }

      const accounts = await getAvailableAccountAddresses(account);
      const address = account.address;

      // 如果已经连接过，直接返回
      if (state.connectedSites.has(origin)) {
        console.log('✅ Site already connected:', origin);
        const connected = state.connectedSites.get(origin);
        return filterAvailableAuthorizedAccounts(connected?.accounts || [address], accounts);
      }

      const requestId = resumablePending?.requestId || `connect_${getTimestamp()}_${Math.random().toString(36).substr(2, 9)}`;

      if (!resumablePending) {
        addPendingRequest(requestId, {
          type: EventType.CONNECT,
          approvalType: 'connect',
          origin,
          tabId,
          reuseSession: true,
          clientRequestKey,
          expiresAt: Date.now() + TIMEOUTS.REQUEST,
          data: {
            origin,
            accounts,
            requestedPermissions: {
              eth_accounts: true
            }
          },
          timestamp: getTimestamp()
        });
      }

      console.log('📝 Opening approval window for request:', requestId);
      await ensureApprovalRequestVisible(requestId, {
        requestType: 'connect',
        origin,
        tabId,
        reuseSession: true
      });

      const approvalResponse = await waitForApprovalResponse(requestId);
      if (!approvalResponse?.approved) {
        removePendingRequest(requestId);
        console.log('❌ Connection rejected:', origin);
        throw createUserRejectedError('User rejected the connection request');
      }

      state.connectedSites.set(origin, {
        accounts,
        chainId: state.currentChainId,
        connectedAt: getTimestamp()
      });
      updateConnectedSites();
      markRecentConnectApproval(origin, tabId);

      await saveAuthorization(origin, address, undefined, accounts);

      resetLockTimer();
      refreshPasswordCache();

      removePendingRequest(requestId, { activateNext: true });

      console.log('✅ Connection approved:', origin);
      return accounts;

    } catch (error) {
      console.error('❌ Handle eth_requestAccounts failed:', error);
      throw error;
    }
  })();

  connectInFlight.set(key, requestPromise);

  try {
    return await requestPromise;
  } finally {
    connectInFlight.delete(key);
  }
}

/**
 * 处理 wallet_getPermissions
 * @param {string} origin - 请求来源
 * @returns {Promise<Array>} 权限列表
 */
export async function handleWalletGetPermissions(origin) {
  try {
    const stored = await getAuthorization(origin);
    const connected = state.connectedSites.get(origin);
    const accounts = Array.isArray(stored?.accounts) && stored.accounts.length
      ? stored.accounts
      : stored?.address
      ? [stored.address]
      : Array.isArray(connected?.accounts)
        ? connected.accounts
        : [];

    if (accounts.length === 0) {
      return [];
    }

    const permissions = [buildEthAccountsPermission(accounts)];
    if (Array.isArray(stored?.identityScopes) && stored.identityScopes.length > 0) {
      permissions.push(buildIdentityPermission(stored.identityScopes));
    }
    return permissions;
  } catch (error) {
    console.error('❌ Handle wallet_getPermissions failed:', error);
    return [];
  }
}

export async function requestIdentityScopeApproval(
  origin,
  tabId,
  requestedScopes,
  account = null,
  includeAccountPermission = false
) {
  const identityScopes = normalizeIdentityScopes(requestedScopes);
  await ensureApprovalStateHydrated();
  const pending = findPendingRequest(EventType.CONNECT, origin, tabId);
  if (pending) {
    focusPendingWindow(pending);
    throw createError(-32002, 'Permission request already pending');
  }

  const selectedAccount = account || await getSelectedAccount();
  if (!selectedAccount) {
    throw createWalletLockedError();
  }
  const accounts = await getAvailableAccountAddresses(selectedAccount);
  const requestId = `connect_${getTimestamp()}_${Math.random().toString(36).substr(2, 9)}`;
  addPendingRequest(requestId, {
    type: EventType.CONNECT,
    approvalType: 'connect',
    origin,
    tabId,
    reuseSession: true,
    expiresAt: Date.now() + TIMEOUTS.REQUEST,
    data: {
      origin,
      accounts,
      identityScopes,
      requestedPermissions: {
        eth_accounts: includeAccountPermission,
        wallet_identity: true
      }
    },
    timestamp: getTimestamp()
  });

  try {
    await ensureApprovalRequestVisible(requestId, {
      requestType: 'connect',
      origin,
      tabId,
      reuseSession: true
    });

    const response = await waitForApprovalResponse(requestId);
    if (!response?.approved) {
      removePendingRequest(requestId);
      throw createUserRejectedError('User rejected the permission request');
    }

    const stored = await getAuthorization(origin);
    const granted = await grantIdentityScopes(origin, identityScopes, selectedAccount, {
      accounts,
      profileFields: stored?.profileFields
    });
    removePendingRequest(requestId, { activateNext: true });
    refreshPasswordCache();
    markRecentConnectApproval(origin, tabId);
    return {
      accounts,
      identityScopes: granted.identityScopes
    };
  } catch (error) {
    removePendingRequest(requestId);
    throw error;
  }
}

export async function grantIdentityScopes(origin, requestedScopes, account = null, options = {}) {
  const identityScopes = normalizeIdentityScopes(requestedScopes);
  const selectedAccount = account || await getSelectedAccount();
  if (!selectedAccount) {
    throw createWalletLockedError();
  }
  const accounts = Array.isArray(options.accounts)
    ? options.accounts
    : await getAvailableAccountAddresses(selectedAccount);
  const stored = await getAuthorization(origin);
  const granted = Array.from(new Set([...(stored?.identityScopes || []), ...identityScopes]));
  state.connectedSites.set(origin, {
    accounts,
    chainId: state.currentChainId,
    connectedAt: getTimestamp(),
    identityScopes: granted
  });
  updateConnectedSites();
  await saveAuthorization(
    origin,
    selectedAccount.address,
    options.profileFields !== undefined ? options.profileFields : stored?.profileFields,
    accounts,
    granted
  );
  refreshPasswordCache();
  return {
    accounts,
    identityScopes: granted
  };
}

/**
 * 处理 wallet_requestPermissions
 * @param {string} origin - 请求来源
 * @param {number} tabId - 标签页 ID
 * @param {Array} params - 参数
 * @returns {Promise<Array>} 权限列表
 */
export async function handleWalletRequestPermissions(origin, tabId, params) {
  const request = params?.[0];
  if (!request || typeof request !== 'object') {
    throw createInvalidParams('Permission request is required');
  }

  const identityRequest = request.wallet_identity;
  if (identityRequest) {
    const includeAccountPermission = 'eth_accounts' in request;
    const granted = await requestIdentityScopeApproval(
      origin,
      tabId,
      identityRequest?.scopes,
      null,
      includeAccountPermission
    );
    return request.eth_accounts
      ? [buildEthAccountsPermission(granted.accounts), buildIdentityPermission(granted.identityScopes)]
      : [buildIdentityPermission(granted.identityScopes)];
  }

  if (!request.eth_accounts) throw createInvalidParams('Unsupported permission');

  const pending = findPendingRequest(EventType.CONNECT, origin, tabId);
  if (pending) {
    focusPendingWindow(pending);
    throw createError(-32002, 'Permission request already pending');
  }

  const accounts = await handleEthRequestAccounts(origin, tabId);
  return [buildEthAccountsPermission(accounts)];
}

/**
 * 处理 wallet_revokePermissions
 * @param {string} origin - 请求来源
 * @param {Array} params - 参数
 * @returns {Promise<Array>} 已撤销权限
 */
export async function handleWalletRevokePermissions(origin, params) {
  const request = params?.[0];
  if (request && typeof request === 'object' && 'wallet_identity' in request) {
    const stored = await getAuthorization(origin);
    if (!stored?.address || !Array.isArray(stored.identityScopes) || stored.identityScopes.length === 0) return [];
    const revoked = buildIdentityPermission(stored.identityScopes);
    await saveAuthorization(origin, stored.address, stored.profileFields, stored.accounts, []);
    return [revoked];
  }
  if (request && typeof request === 'object' && !('eth_accounts' in request)) {
    return [];
  }

  try {
    const stored = await getAuthorization(origin);
    const accounts = stored?.address ? [stored.address] : [];

    state.connectedSites.delete(origin);
    updateConnectedSites();
    await deleteAuthorization(origin).catch(() => { });

    // 通知该站点断开连接
    state.connections.forEach(({ port, origin: connOrigin }) => {
      if (connOrigin === origin) {
        sendEvent(port, EventType.ACCOUNTS_CHANGED, { accounts: [] });
      }
    });

    return accounts.length > 0 ? [buildEthAccountsPermission(accounts)] : [];
  } catch (error) {
    console.error('❌ Handle wallet_revokePermissions failed:', error);
    return [];
  }
}
