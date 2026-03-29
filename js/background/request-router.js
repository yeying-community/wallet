/**
 * YeYing Wallet - 请求路由
 * 负责：根据方法名路由到对应的处理器
 */

import { state } from './state.js';
import { ApprovalMessageType } from '../protocol/extension-protocol.js';
import {
  createWalletLockedError,
  createAccountNotFoundError,
  createInvalidParams,
  createInternalError,
  createUserRejectedError,
  createTimeoutError,
  createError,
  createUnauthorizedError
} from '../common/errors/index.js';
import { handleEthAccounts, handleEthRequestAccounts, handleWalletGetPermissions, handleWalletRequestPermissions, handleWalletRevokePermissions } from './account-handler.js';
import { handleEthChainId, handleNetVersion, handleSwitchChain, handleAddEthereumChain } from './chain-handler.js';
import { handleRpcMethod } from './rpc-handler.js';
import { signTransaction, signMessage, signTypedData } from './signing.js';
import { getSelectedAccount, isAuthorized, updateUserSetting } from '../storage/index.js';
import { requestUnlock } from './unlock-flow.js';
import { withPopupBoundsAsync } from './window-utils.js';
import { POPUP_DIMENSIONS } from '../config/index.js';
import { getTimestamp } from '../common/utils/time-utils.js';
import { handleUcanSession, handleUcanSign } from './ucan.js';
import {
  addPendingRequest,
  findPendingRequest,
  focusPendingWindow,
  openApprovalWindow,
  removePendingRequest
} from './approval-flow.js';

async function isActiveTab(tabId) {
  if (!Number.isFinite(tabId)) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.active) return false;
    if (!Number.isFinite(tab.windowId)) return Boolean(tab.active);
    const win = await chrome.windows.get(tab.windowId);
    if (win && win.focused === false) return false;
    return true;
  } catch (error) {
    return false;
  }
}

async function isWalletPopupOpen() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getContexts) {
    return false;
  }

  try {
    const popupUrl = chrome.runtime.getURL('html/popup.html');
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['POPUP'] });
    return Array.isArray(contexts) && contexts.some((context) => {
      const url = String(context?.documentUrl || '');
      return url.startsWith(popupUrl);
    });
  } catch (error) {
    return false;
  }
}

async function recordUnlockRequest(info) {
  if (!info) return;
  try {
    await updateUserSetting('lastUnlockRequest', info);
  } catch (error) {
    console.warn('[RequestRouter] Failed to record unlock request:', error?.message || error);
  }
}

async function ensureSiteAuthorized(origin) {
  if (!origin) {
    throw createUnauthorizedError('Unauthorized origin');
  }
  const authorized = state.connectedSites.has(origin) || await isAuthorized(origin);
  if (!authorized) {
    throw createUnauthorizedError('Site not connected');
  }
}

/**
 * 路由请求到对应的处理器
 * @param {string} method - RPC 方法名
 * @param {Array} params - 参数
 * @param {Object} metadata - 元数据 {origin, tabId}
 * @returns {Promise<any>} 处理结果
 */
export async function routeRequest(method, params, metadata) {
  const { origin, tabId } = metadata;
  const paramsArray = Array.isArray(params) ? params : (params == null ? [] : [params]);
  const rpcParams = params == null ? [] : params;

  console.log(`📍 Routing request: ${method}`, { origin, params });

  // ==================== 不需要解锁的方法 ====================
  
  if (method === 'eth_accounts') {
    return handleEthAccounts(origin);
  }

  if (method === 'eth_chainId') {
    return handleEthChainId();
  }

  if (method === 'net_version') {
    return handleNetVersion();
  }

  if (method === 'wallet_getPermissions') {
    return handleWalletGetPermissions(origin);
  }

  if (method === 'wallet_revokePermissions') {
    return handleWalletRevokePermissions(origin, paramsArray);
  }

  // ==================== 需要解锁的方法 ====================

  const unlockMethods = new Set([
    'eth_requestAccounts',
    'eth_sendTransaction',
    'eth_signTransaction',
    'personal_sign',
    'eth_sign',
    'eth_signTypedData',
    'eth_signTypedData_v4',
    'yeying_ucan_session',
    'yeying_ucan_sign'
  ]);

  const blockedWhilePopupOpenMethods = new Set([
    ...unlockMethods,
    'wallet_requestPermissions',
    'wallet_watchAsset',
    'wallet_addEthereumChain',
    'wallet_switchEthereumChain'
  ]);

  if (blockedWhilePopupOpenMethods.has(method) && await isWalletPopupOpen()) {
    throw createError(-32002, 'Wallet popup is currently open. Close it and retry.');
  }

  if (!state.keyring && unlockMethods.has(method)) {
    const active = await isActiveTab(tabId);
    if (!active) {
      throw createUserRejectedError('Unlock requires active tab');
    }
    await recordUnlockRequest({
      origin: origin || '',
      method,
      tabId: Number.isFinite(tabId) ? tabId : null,
      timestamp: getTimestamp()
    });
    await requestUnlock({ origin, tabId, method });
  }

  // 检查钱包是否已解锁
  if (!state.keyring) {
    throw createWalletLockedError();
  }

  // 获取当前账户
  const account = await getSelectedAccount();
  if (!account) {
    throw createAccountNotFoundError('No account selected');
  }

  // ==================== 账户相关 ====================

  if (method === 'eth_requestAccounts') {
    return handleEthRequestAccounts(origin, tabId);
  }

  if (method === 'wallet_requestPermissions') {
    return handleWalletRequestPermissions(origin, tabId, paramsArray);
  }

  // ==================== UCAN 相关 ====================

  if (method === 'yeying_ucan_session') {
    await ensureSiteAuthorized(origin);
    return handleUcanSession(origin, account, params);
  }

  if (method === 'yeying_ucan_sign') {
    await ensureSiteAuthorized(origin);
    return handleUcanSign(origin, account, params);
  }

  // ==================== 链相关 ====================

  if (method === 'wallet_switchEthereumChain') {
    return handleSwitchChain(paramsArray);
  }

  if (method === 'wallet_addEthereumChain') {
    return handleAddEthereumChain(paramsArray);
  }

  if (method === 'wallet_watchAsset') {
    return handleWatchAsset(origin, paramsArray, tabId);
  }

  // ==================== 签名相关 ====================

  if (method === 'eth_sendTransaction') {
    return handleSendTransaction(account.id, paramsArray, origin, tabId);
  }

  if (method === 'eth_signTransaction') {
    return handleSignTransaction(account.id, paramsArray, origin, tabId);
  }

  if (method === 'personal_sign' || method === 'eth_sign') {
    return handlePersonalSign(account.id, paramsArray, origin, tabId);
  }

  if (method === 'eth_signTypedData' || method === 'eth_signTypedData_v4') {
    return handleSignTypedData(account.id, paramsArray, origin, tabId);
  }

  // ==================== RPC 转发 ====================

  // 其他方法转发到 RPC 节点
  return handleRpcMethod(method, rpcParams);
}

// ==================== 代币相关 ====================

/**
 * 处理 wallet_watchAsset
 * @param {string} origin - 来源
 * @param {Array} params - 参数 [{ type, options }]
 * @param {number} tabId - 标签页 ID
 * @returns {Promise<boolean>} 是否添加成功
 */
async function handleWatchAsset(origin, params, tabId) {
  const [request] = params;

  if (!request || typeof request !== 'object') {
    throw createInvalidParams('Invalid watchAsset parameters');
  }

  const type = request.type || request.assetType || 'ERC20';
  if (String(type).toUpperCase() !== 'ERC20') {
    throw createInvalidParams('Only ERC20 assets are supported');
  }

  const options = request.options && typeof request.options === 'object'
    ? request.options
    : request;

  const address = options.address;
  const symbol = options.symbol;
  const decimalsRaw = options.decimals;
  const decimals = Number.isFinite(decimalsRaw) ? decimalsRaw : Number.parseInt(decimalsRaw, 10);

  if (!address || !symbol) {
    throw createInvalidParams('address and symbol are required');
  }

  const tokenInfo = {
    address,
    symbol,
    decimals: Number.isFinite(decimals) ? decimals : 18,
    image: options.image,
    name: options.name
  };

  const pending = findPendingRequest('watchAsset', origin, tabId);
  if (pending) {
    focusPendingWindow(pending);
    throw createError(-32002, 'Watch asset request already pending');
  }

  const requestId = `watch_asset_${getTimestamp()}_${Math.random().toString(36).substr(2, 9)}`;

  addPendingRequest(requestId, {
    type: 'watchAsset',
    origin,
    tabId,
    data: {
      origin,
      asset: tokenInfo,
      tokenInfo
    },
    timestamp: getTimestamp()
  });

  return new Promise(async (resolve, reject) => {
    const windowOptions = await withPopupBoundsAsync({
      url: `html/approval.html?requestId=${requestId}&type=watchAsset`,
      type: 'popup',
      width: POPUP_DIMENSIONS.width,
      height: POPUP_DIMENSIONS.height,
      focused: true
    });

    chrome.windows.create(windowOptions, (window) => {
      if (!window) {
        removePendingRequest(requestId);
        reject(createInternalError('Failed to open approval window'));
        return;
      }

      const pendingRequest = state.pendingRequests.get(requestId);
      if (pendingRequest) {
        pendingRequest.windowId = window.id;
      }

      const windowRemovedListener = (windowId) => {
        if (windowId === window.id) {
          chrome.windows.onRemoved.removeListener(windowRemovedListener);
          chrome.runtime.onMessage.removeListener(messageListener);

          if (state.pendingRequests.has(requestId)) {
            removePendingRequest(requestId);
            reject(createUserRejectedError('User closed approval window'));
          }
        }
      };

      const messageListener = (message) => {
        if (message.type === ApprovalMessageType.APPROVAL_RESPONSE && message.requestId === requestId) {
          chrome.windows.onRemoved.removeListener(windowRemovedListener);
          chrome.runtime.onMessage.removeListener(messageListener);

          removePendingRequest(requestId);

          if (message.approved) {
            resolve(true);
          } else {
            resolve(false);
          }
        }
      };

      chrome.windows.onRemoved.addListener(windowRemovedListener);
      chrome.runtime.onMessage.addListener(messageListener);

      setTimeout(() => {
        if (state.pendingRequests.has(requestId)) {
          chrome.windows.onRemoved.removeListener(windowRemovedListener);
          chrome.runtime.onMessage.removeListener(messageListener);

          removePendingRequest(requestId);
          chrome.windows.remove(window.id).catch(() => { });
          reject(createTimeoutError('Approval request timeout'));
        }
      }, 300000);
    });
  });
}

// ==================== 签名方法处理器 ====================

/**
 * 处理 eth_sendTransaction
 * @param {string} accountId - 账户 ID
 * @param {Array} params - 参数
 * @param {string} origin - 来源
 * @param {number} tabId - 标签页 ID
 * @returns {Promise<string>} 交易哈希
 */
async function handleSendTransaction(accountId, params, origin, tabId) {
  const [transaction] = params;

  if (!transaction || typeof transaction !== 'object') {
    throw createInvalidParams('Invalid transaction object');
  }

  const pending = findPendingRequest('transaction', origin, tabId);
  if (pending) {
    focusPendingWindow(pending);
    throw createError(-32002, 'Transaction approval already pending');
  }

  // 🔑 创建签名请求
  const requestId = `tx_${getTimestamp()}_${Math.random().toString(36).substr(2, 9)}`;

  addPendingRequest(requestId, {
    type: 'transaction',
    origin,
    tabId,
    data: {
      accountId,
      transaction,
      origin
    },
    timestamp: getTimestamp()
  });

  console.log('📝 Opening approval window for transaction:', requestId);

  // 🪟 打开授权弹窗
  return new Promise(async (resolve, reject) => {
    const windowOptions = await withPopupBoundsAsync({
      url: `html/approval.html?requestId=${requestId}&type=transaction`,
      type: 'popup',
      width: POPUP_DIMENSIONS.width,
      height: POPUP_DIMENSIONS.height,
      focused: true
    });

    chrome.windows.create(windowOptions, (window) => {
      if (!window) {
        removePendingRequest(requestId);
        reject(createInternalError('Failed to open approval window'));
        return;
      }

      const pendingRequest = state.pendingRequests.get(requestId);
      if (pendingRequest) {
        pendingRequest.windowId = window.id;
      }

      console.log('✅ Approval window opened:', window.id);

      // 监听窗口关闭（用户取消）
      const windowRemovedListener = (windowId) => {
        if (windowId === window.id) {
          console.log('🚪 Approval window closed by user');

          chrome.windows.onRemoved.removeListener(windowRemovedListener);
          chrome.runtime.onMessage.removeListener(messageListener);

          if (state.pendingRequests.has(requestId)) {
            removePendingRequest(requestId);
            reject(createUserRejectedError('User closed approval window'));
          }
        }
      };

      // 监听授权结果
      const messageListener = async (message, sender) => {
        if (message.type === ApprovalMessageType.APPROVAL_RESPONSE && message.requestId === requestId) {
          console.log('📨 Received approval response:', message);

          chrome.windows.onRemoved.removeListener(windowRemovedListener);
          chrome.runtime.onMessage.removeListener(messageListener);

          removePendingRequest(requestId);

          if (message.approved) {
            try {
              console.log('✅ Transaction approved, signing...');
              const result = await signTransaction(accountId, transaction);
              resolve(result.hash);
            } catch (error) {
              console.error('❌ Transaction signing failed:', error);
              reject(error);
            }
          } else {
            console.log('❌ Transaction rejected');
            reject(createUserRejectedError('User rejected the transaction'));
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
          chrome.windows.remove(window.id).catch(() => { });

          reject(createTimeoutError('Approval request timeout'));
        }
      }, 300000); // 5 分钟超时
    });
  });
}

/**
 * 处理 eth_signTransaction
 * @param {string} accountId - 账户 ID
 * @param {Array} params - 参数
 * @param {string} origin - 来源
 * @param {number} tabId - 标签页 ID
 * @returns {Promise<string>} 签名后的交易
 */
async function handleSignTransaction(accountId, params, origin, tabId) {
  // 与 handleSendTransaction 类似，但只返回签名后的交易，不发送
  const [transaction] = params;

  if (!transaction || typeof transaction !== 'object') {
    throw createInvalidParams('Invalid transaction object');
  }

  const pending = findPendingRequest('sign_transaction', origin, tabId);
  if (pending) {
    focusPendingWindow(pending);
    throw createError(-32002, 'Sign transaction request already pending');
  }

  // 创建签名请求
  const requestId = `sign_tx_${getTimestamp()}_${Math.random().toString(36).substr(2, 9)}`;

  addPendingRequest(requestId, {
    type: 'sign_transaction',
    origin,
    tabId,
    data: {
      accountId,
      transaction,
      origin
    },
    timestamp: getTimestamp()
  });

  // 打开授权弹窗
  return new Promise(async (resolve, reject) => {
    const windowOptions = await withPopupBoundsAsync({
      url: `html/approval.html?requestId=${requestId}&type=sign_transaction`,
      type: 'popup',
      width: POPUP_DIMENSIONS.width,
      height: POPUP_DIMENSIONS.height,
      focused: true
    });

    chrome.windows.create(windowOptions, (window) => {
      if (!window) {
        removePendingRequest(requestId);
        reject(createInternalError('Failed to open approval window'));
        return;
      }

      const pendingRequest = state.pendingRequests.get(requestId);
      if (pendingRequest) {
        pendingRequest.windowId = window.id;
      }

      const windowRemovedListener = (windowId) => {
        if (windowId === window.id) {
          chrome.windows.onRemoved.removeListener(windowRemovedListener);
          chrome.runtime.onMessage.removeListener(messageListener);

          if (state.pendingRequests.has(requestId)) {
            removePendingRequest(requestId);
            reject(createUserRejectedError('User closed approval window'));
          }
        }
      };

      const messageListener = async (message, sender) => {
        if (message.type === ApprovalMessageType.APPROVAL_RESPONSE && message.requestId === requestId) {
          chrome.windows.onRemoved.removeListener(windowRemovedListener);
          chrome.runtime.onMessage.removeListener(messageListener);

          removePendingRequest(requestId);

          if (message.approved) {
            try {
              const result = await signTransaction(accountId, transaction);
              resolve(result);
            } catch (error) {
              reject(error);
            }
          } else {
            reject(createUserRejectedError('User rejected the transaction'));
          }
        }
      };

      chrome.windows.onRemoved.addListener(windowRemovedListener);
      chrome.runtime.onMessage.addListener(messageListener);

      setTimeout(() => {
        if (state.pendingRequests.has(requestId)) {
          chrome.windows.onRemoved.removeListener(windowRemovedListener);
          chrome.runtime.onMessage.removeListener(messageListener);
          removePendingRequest(requestId);
          chrome.windows.remove(window.id).catch(() => { });
          reject(createTimeoutError('Approval request timeout'));
        }
      }, 300000);
    });
  });
}

/**
 * 处理 personal_sign
 * @param {string} accountId - 账户 ID
 * @param {Array} params - 参数
 * @param {string} origin - 来源
 * @param {number} tabId - 标签页 ID
 * @returns {Promise<string>} 签名
 */
async function handlePersonalSign(accountId, params, origin, tabId) {
  // personal_sign 参数顺序: [message, address]
  // eth_sign 参数顺序: [address, message]
  let messageToSign, address;

  if (params.length === 2) {
    // 尝试判断参数顺序
    if (params[0].startsWith('0x') && params[0].length === 42) {
      // eth_sign 格式
      [address, messageToSign] = params;
    } else {
      // personal_sign 格式
      [messageToSign, address] = params;
    }
  } else {
    throw createInvalidParams('Invalid parameters for personal_sign');
  }

  const pending = findPendingRequest('sign_message', origin, tabId);
  if (pending) {
    focusPendingWindow(pending);
    throw createError(-32002, 'Sign message request already pending');
  }

  // 创建签名请求
  const requestId = `sign_msg_${getTimestamp()}_${Math.random().toString(36).substr(2, 9)}`;

  addPendingRequest(requestId, {
    type: 'sign_message',
    origin,
    tabId,
    reuseSession: true,
    data: {
      accountId,
      message: messageToSign,
      origin
    },
    timestamp: getTimestamp()
  });

  // 打开授权弹窗
  return new Promise(async (resolve, reject) => {
    let approvalWindow;
    try {
      approvalWindow = await openApprovalWindow({
        requestId,
        requestType: 'sign_message',
        origin,
        tabId,
        reuseSession: true
      });
    } catch (error) {
      removePendingRequest(requestId);
      reject(error);
      return;
    }

    const windowRemovedListener = (windowId) => {
      if (windowId === approvalWindow.windowId) {
        chrome.windows.onRemoved.removeListener(windowRemovedListener);
        chrome.runtime.onMessage.removeListener(messageListener);

        if (state.pendingRequests.has(requestId)) {
          removePendingRequest(requestId);
          reject(createUserRejectedError('User closed approval window'));
        }
      }
    };

    const messageListener = async (responseMessage, sender) => {
      if (responseMessage.type === ApprovalMessageType.APPROVAL_RESPONSE && responseMessage.requestId === requestId) {
        chrome.windows.onRemoved.removeListener(windowRemovedListener);
        chrome.runtime.onMessage.removeListener(messageListener);

        removePendingRequest(requestId);

        if (responseMessage.approved) {
          try {
            const signature = await signMessage(accountId, messageToSign);
            resolve(signature);
          } catch (error) {
            reject(error);
          }
        } else {
          reject(createInternalError('User rejected the signature request'));
        }
      }
    };

    chrome.windows.onRemoved.addListener(windowRemovedListener);
    chrome.runtime.onMessage.addListener(messageListener);

    setTimeout(() => {
      if (state.pendingRequests.has(requestId)) {
        chrome.windows.onRemoved.removeListener(windowRemovedListener);
        chrome.runtime.onMessage.removeListener(messageListener);
        removePendingRequest(requestId);
        chrome.windows.remove(approvalWindow.windowId).catch(() => { });
        reject(createTimeoutError('Approval request timeout'));
      }
    }, 300000);
  });
}

/**
 * 处理 eth_signTypedData
 * @param {string} accountId - 账户 ID
 * @param {Array} params - 参数
 * @param {string} origin - 来源
 * @param {number} tabId - 标签页 ID
 * @returns {Promise<string>} 签名
 */
async function handleSignTypedData(accountId, params, origin, tabId) {
  // eth_signTypedData_v4 参数: [address, typedData]
  const [address, typedDataJson] = params;

  if (!typedDataJson) {
    throw createInvalidParams('Invalid typed data');
  }

  let typedData;
  try {
    typedData = typeof typedDataJson === 'string' ? JSON.parse(typedDataJson) : typedDataJson;
  } catch (error) {
    throw createInvalidParams('Invalid JSON for typed data');
  }

  const pending = findPendingRequest('sign_typed_data', origin, tabId);
  if (pending) {
    focusPendingWindow(pending);
    throw createError(-32002, 'Sign typed data request already pending');
  }

  // 创建签名请求
  const requestId = `sign_typed_${getTimestamp()}_${Math.random().toString(36).substr(2, 9)}`;

  addPendingRequest(requestId, {
    type: 'sign_typed_data',
    origin,
    tabId,
    reuseSession: true,
    data: {
      accountId,
      typedData,
      origin
    },
    timestamp: getTimestamp()
  });

  // 打开授权弹窗
  return new Promise(async (resolve, reject) => {
    let approvalWindow;
    try {
      approvalWindow = await openApprovalWindow({
        requestId,
        requestType: 'sign_typed_data',
        origin,
        tabId,
        reuseSession: true
      });
    } catch (error) {
      removePendingRequest(requestId);
      reject(error);
      return;
    }

    const windowRemovedListener = (windowId) => {
      if (windowId === approvalWindow.windowId) {
        chrome.windows.onRemoved.removeListener(windowRemovedListener);
        chrome.runtime.onMessage.removeListener(messageListener);

        if (state.pendingRequests.has(requestId)) {
          removePendingRequest(requestId);
          reject(createUserRejectedError('User closed approval window'));
        }
      }
    };

    const messageListener = async (message, sender) => {
      if (message.type === ApprovalMessageType.APPROVAL_RESPONSE && message.requestId === requestId) {
        chrome.windows.onRemoved.removeListener(windowRemovedListener);
        chrome.runtime.onMessage.removeListener(messageListener);

        removePendingRequest(requestId);

        if (message.approved) {
          try {
            const { domain, types, message: value } = typedData;
            const signature = await signTypedData(accountId, domain, types, value);
            resolve(signature);
          } catch (error) {
            reject(error);
          }
        } else {
          reject(createUserRejectedError('User rejected the signature request'));
        }
      }
    };

    chrome.windows.onRemoved.addListener(windowRemovedListener);
    chrome.runtime.onMessage.addListener(messageListener);

    setTimeout(() => {
      if (state.pendingRequests.has(requestId)) {
        chrome.windows.onRemoved.removeListener(windowRemovedListener);
        chrome.runtime.onMessage.removeListener(messageListener);
        removePendingRequest(requestId);
        chrome.windows.remove(approvalWindow.windowId).catch(() => { });
        reject(createTimeoutError('Approval request timeout'));
      }
    }, 300000);
  });
}
