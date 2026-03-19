/**
 * YeYing Wallet - 账户处理
 * 负责：eth_accounts、eth_requestAccounts
 */
import { EventType } from '../protocol/dapp-protocol.js';
import { ApprovalMessageType } from '../protocol/extension-protocol.js';
import { state } from './state.js';
import {
  createWalletLockedError,
  createInvalidParams,
  createUserRejectedError,
  createTimeoutError,
  createError
} from '../common/errors/index.js';
import { getSelectedAccount, saveAuthorization, getAuthorization, deleteAuthorization, isAuthorized } from '../storage/index.js';
import { resetLockTimer } from './keyring.js';
import { refreshPasswordCache } from './password-cache.js';
import { sendEvent } from './connection.js';
import { TIMEOUTS } from '../config/index.js';
import { getTimestamp } from '../common/utils/time-utils.js';
import { updateKeepAlive } from './offscreen.js';
import {
  addPendingRequest,
  findPendingRequest,
  focusApprovalSession,
  focusPendingWindow,
  hasActiveApprovalForSession,
  openApprovalWindow,
  removePendingRequest
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

/**
 * 处理 eth_accounts
 * @returns {Promise<Array<string>>} 账户地址数组
 */
export async function handleEthAccounts(origin) {
  try {
    // 检查会话是否解锁
    const unlocked = state.keyring !== null;
    if (!unlocked) {
      return [];
    }

    if (!origin) {
      return [];
    }

    const isConnected = state.connectedSites.has(origin) || await isAuthorized(origin);
    if (!isConnected) {
      return [];
    }

    // 获取选择的账户信息
    const account = await getSelectedAccount();
    if (!account) {
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
export async function handleEthRequestAccounts(origin, tabId) {
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
      console.log('🔗 eth_requestAccounts called from:', origin);

      const pending = findPendingRequest(EventType.CONNECT, origin, tabId);
      if (pending) {
        focusPendingWindow(pending);
        throw createError(-32002, 'Connection request already pending');
      }

      if (hasActiveApprovalForSession(origin, tabId)) {
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

      // 🔑 创建授权请求
      const requestId = `connect_${getTimestamp()}_${Math.random().toString(36).substr(2, 9)}`;

      addPendingRequest(requestId, {
        type: EventType.CONNECT,
        origin,
        tabId,
        reuseSession: true,
        data: {
          origin,
          accounts: [address]
        },
        timestamp: getTimestamp()
      });

      console.log('📝 Opening approval window for request:', requestId);

      // 🪟 打开授权弹窗
      return new Promise(async (resolve, reject) => {
        let approvalWindow;
        try {
          approvalWindow = await openApprovalWindow({
            requestId,
            requestType: 'connect',
            origin,
            tabId,
            reuseSession: true
          });
        } catch (error) {
          removePendingRequest(requestId);
          reject(error);
          return;
        }

        console.log('✅ Approval window opened:', approvalWindow.windowId);

        const windowRemovedListener = (windowId) => {
          if (windowId === approvalWindow.windowId) {
            console.log('🚪 Approval window closed by user');

            chrome.windows.onRemoved.removeListener(windowRemovedListener);
            chrome.runtime.onMessage.removeListener(messageListener);

            if (state.pendingRequests.has(requestId)) {
              removePendingRequest(requestId);
              reject(createUserRejectedError('User closed approval window'));
            }
          }
        };

        const messageListener = (message, sender) => {
          if (message.type === ApprovalMessageType.APPROVAL_RESPONSE && message.requestId === requestId) {
            console.log('📨 Received approval response:', message);

            chrome.windows.onRemoved.removeListener(windowRemovedListener);
            chrome.runtime.onMessage.removeListener(messageListener);

            if (message.approved) {
              // 保存连接信息
              state.connectedSites.set(origin, {
                accounts: [address],
                chainId: state.currentChainId,
                connectedAt: getTimestamp()
              });
              updateConnectedSites();

              // 持久化授权
              saveAuthorization(origin, address).catch(err => {
                console.error('Failed to save authorization:', err);
              });

              // 用户授权后才刷新锁定计时
              resetLockTimer();
              refreshPasswordCache();

              removePendingRequest(requestId, { activateNext: true });

              console.log('✅ Connection approved:', origin);
              resolve([address]);
            } else {
              removePendingRequest(requestId);
              console.log('❌ Connection rejected:', origin);
              reject(createUserRejectedError('User rejected the connection request'));
            }
          }
        };

        chrome.windows.onRemoved.addListener(windowRemovedListener);
        chrome.runtime.onMessage.addListener(messageListener);

        // 超时处理
        setTimeout(() => {
          if (state.pendingRequests.has(requestId)) {
            console.log('⏰ Approval timeout:', requestId);

            chrome.windows.onRemoved.removeListener(windowRemovedListener);
            chrome.runtime.onMessage.removeListener(messageListener);

            removePendingRequest(requestId);

            // 尝试关闭窗口
            chrome.windows.remove(approvalWindow.windowId).catch(() => { });

            reject(createTimeoutError('Approval request timeout'));
          }
        }, TIMEOUTS.REQUEST);
      });

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

    return [buildEthAccountsPermission(accounts)];
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
  if (!request || typeof request !== 'object' || !request.eth_accounts) {
    throw createInvalidParams('Only eth_accounts permission is supported');
  }

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
