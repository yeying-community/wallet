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
import { getSelectedAccount, saveAuthorization, getAuthorization, deleteAuthorization, isAuthorized } from '../storage/index.js';
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

function updateConnectedSites() {
  updateKeepAlive();
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

function buildProfilePermission(fields) {
  return {
    parentCapability: 'yeying_profile',
    caveats: [{ type: 'restrictProfileFields', value: fields }]
  };
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

    return [account.address];

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
  const key = `${origin || 'unknown'}:${typeof tabId === 'number' ? tabId : 'none'}`;

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

      const address = account.address;

      // 如果已经连接过，直接返回
      if (state.connectedSites.has(origin)) {
        console.log('✅ Site already connected:', origin);
        return [address];
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
            accounts: [address]
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
        accounts: [address],
        chainId: state.currentChainId,
        connectedAt: getTimestamp()
      });
      updateConnectedSites();

      saveAuthorization(origin, address).catch(err => {
        console.error('Failed to save authorization:', err);
      });

      resetLockTimer();
      refreshPasswordCache();

      removePendingRequest(requestId, { activateNext: true });

      console.log('✅ Connection approved:', origin);
      return [address];

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
    const accounts = stored?.address
      ? [stored.address]
      : Array.isArray(connected?.accounts)
        ? connected.accounts
        : [];

    if (accounts.length === 0) {
      return [];
    }

    const permissions = [buildEthAccountsPermission(accounts)];
    if (Array.isArray(stored?.profileFields) && stored.profileFields.length > 0) {
      permissions.push(buildProfilePermission(stored.profileFields));
    }
    return permissions;
  } catch (error) {
    console.error('❌ Handle wallet_getPermissions failed:', error);
    return [];
  }
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

  if (request.yeying_profile) {
    const stored = await getAuthorization(origin);
    if (!stored?.address) throw createError(4100, 'Connect the site before requesting profile access');
    const requestedFields = request.yeying_profile?.fields;
    if (!Array.isArray(requestedFields) || requestedFields.length === 0) {
      throw createInvalidParams('yeying_profile.fields is required');
    }
    const fields = Array.from(new Set(requestedFields.map(String)));
    if (fields.some(field => field !== 'username' && field !== 'email')) {
      throw createInvalidParams('Only username and email profile fields are supported');
    }

    const requestId = `profile_${getTimestamp()}_${Math.random().toString(36).slice(2, 11)}`;
    addPendingRequest(requestId, {
      type: 'profile', approvalType: 'profile', origin, tabId,
      expiresAt: Date.now() + TIMEOUTS.REQUEST,
      data: { origin, fields }, timestamp: getTimestamp()
    });
    await ensureApprovalRequestVisible(requestId, { requestType: 'profile', origin, tabId });
    const response = await waitForApprovalResponse(requestId);
    if (!response?.approved) {
      removePendingRequest(requestId);
      throw createUserRejectedError('User rejected profile access');
    }
    const granted = Array.from(new Set([...(stored.profileFields || []), ...fields]));
    await saveAuthorization(origin, stored.address, granted);
    removePendingRequest(requestId, { activateNext: true });
    return [buildProfilePermission(granted)];
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
  if (request && typeof request === 'object' && 'yeying_profile' in request) {
    const stored = await getAuthorization(origin);
    if (!stored?.address || !Array.isArray(stored.profileFields) || stored.profileFields.length === 0) return [];
    const revoked = buildProfilePermission(stored.profileFields);
    await saveAuthorization(origin, stored.address, []);
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
