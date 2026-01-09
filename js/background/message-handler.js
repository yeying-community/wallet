/**
 * YeYing Wallet - 消息处理
 * 负责：处理来自 content script 和 popup 的消息
 */

import { MessageValidator, PORT_NAME, ApprovalMessageType, WalletMessageType, NetworkMessageType, EventType } from '../protocol/protocol.js';
import { sendResponse, sendError, registerConnection, unregisterConnection, checkSessionAndNotify } from './connection.js';
import { routeRequest } from './request-router.js';
import { unlockWallet, lockWallet } from './keyring.js';
import {
  isWalletInitialized,
  HandleGetWalletList,
  handleCreateHDWallet,
  handleImportHDWallet,
  handleImportPrivateKeyWallet,
  handleCreateSubAccount,
  handleSwitchAccount,
  handleGetCurrentAccount,
  handleGetAccountById,
  handleUpdateAccountName,
  handleDeleteAccount,
  handleGetBalance,
  handleAddToken,
  handleGetTokenBalances,
  handleExportPrivateKey,
  handleExportMnemonic,
  handleGetAuthorizedSites,
  handleRevokeSite,
  handleClearAllAuthorizations
} from './wallet-operations.js';
import { state } from './state.js';
import { DEFAULT_NETWORK, NETWORKS, getNetworkByChainId } from '../config/index.js';
import { normalizeChainId } from '../common/utils/index.js';
import {
  saveSelectedNetworkName,
  updateUserSetting,
  addCustomNetwork,
  getCustomNetworks,
  deleteCustomNetwork,
  updateCustomNetwork
} from '../storage/index.js';
import { validateNetworkConfig } from '../config/validation-rules.js';
import { broadcastEvent } from './connection.js';
import { normalizePopupBounds } from './window-utils.js';

async function persistPopupBounds(bounds) {
  const normalized = normalizePopupBounds(bounds);
  if (!normalized) {
    return;
  }
  if (!Number.isFinite(normalized.left) || !Number.isFinite(normalized.top)) {
    return;
  }

  state.popupBounds = normalized;
  try {
    await updateUserSetting('popupBounds', normalized);
  } catch (error) {
    console.warn('[Background] Failed to persist popup bounds:', error);
  }
}

async function fetchChainIdFromRpc(rpcUrl) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'eth_chainId',
      params: []
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'RPC error');
  }

  return data.result;
}

async function handleSwitchNetworkMessage(data) {
  const { chainId, rpcUrl, networkKey } = data || {};

  let nextChainId = null;
  let nextRpcUrl = null;
  let selectedNetworkName = networkKey;

  if (networkKey && NETWORKS[networkKey]) {
    const network = NETWORKS[networkKey];
    nextChainId = network.chainIdHex;
    nextRpcUrl = network.rpcUrl || network.rpc;
  } else if (chainId) {
    const normalizedChainId = normalizeChainId(chainId);
    const network = getNetworkByChainId(normalizedChainId);
    nextChainId = normalizedChainId;
    nextRpcUrl = rpcUrl || network?.rpcUrl || network?.rpc;

    if (!selectedNetworkName) {
      selectedNetworkName = Object.entries(NETWORKS)
        .find(([_, config]) => config.chainIdHex === normalizedChainId)?.[0];
    }
  } else if (rpcUrl) {
    const resolvedChainId = await fetchChainIdFromRpc(rpcUrl);
    const normalizedChainId = normalizeChainId(resolvedChainId);
    const network = getNetworkByChainId(normalizedChainId);

    nextChainId = normalizedChainId;
    nextRpcUrl = rpcUrl;
    selectedNetworkName = network
      ? Object.entries(NETWORKS).find(([_, config]) => config.chainIdHex === normalizedChainId)?.[0]
      : null;
  } else {
    return { success: false, error: 'rpcUrl or chainId is required' };
  }

  if (!nextRpcUrl) {
    return { success: false, error: 'rpcUrl is required' };
  }

  const prevChainId = state.currentChainId;
  state.currentChainId = nextChainId || NETWORKS[DEFAULT_NETWORK].chainIdHex;
  state.currentRpcUrl = nextRpcUrl;

  if (selectedNetworkName) {
    await saveSelectedNetworkName(selectedNetworkName);
  }

  if (prevChainId !== state.currentChainId) {
    broadcastEvent(EventType.CHAIN_CHANGED, { chainId: state.currentChainId });
  }

  return {
    success: true,
    chainId: state.currentChainId,
    rpcUrl: state.currentRpcUrl
  };
}

async function handleAddCustomNetworkMessage(data) {
  const { chainName, chainId, rpcUrl, explorer, symbol, decimals } = data || {};
  if (!chainName) {
    return { success: false, error: 'chainName is required' };
  }
  if (!chainId) {
    return { success: false, error: 'chainId is required' };
  }
  if (!rpcUrl) {
    return { success: false, error: 'rpcUrl is required' };
  }

  let normalizedChainId;
  try {
    normalizedChainId = normalizeChainId(chainId);
  } catch (error) {
    return { success: false, error: error.message || 'invalid chainId' };
  }

  const validation = validateNetworkConfig({
    name: chainName,
    rpcUrl,
    chainId: normalizedChainId,
    symbol: symbol || 'ETH'
  });
  if (!validation.valid) {
    return { success: false, error: validation.errors?.[0] || 'invalid network' };
  }

  const network = {
    chainId: normalizedChainId,
    chainName,
    rpcUrl,
    explorer: explorer || '',
    symbol: symbol || 'ETH',
    decimals: Number.isFinite(decimals) ? decimals : 18
  };

  try {
    await addCustomNetwork(network);
    return { success: true, network };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to add custom network' };
  }
}

async function handleGetCustomNetworksMessage() {
  try {
    const networks = await getCustomNetworks();
    return { success: true, networks };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get custom networks' };
  }
}

async function handleRemoveCustomNetworkMessage(chainId) {
  if (!chainId) {
    return { success: false, error: 'chainId is required' };
  }

  let normalizedChainId;
  try {
    normalizedChainId = normalizeChainId(chainId);
  } catch (error) {
    return { success: false, error: error.message || 'invalid chainId' };
  }

  try {
    await deleteCustomNetwork(normalizedChainId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to remove custom network' };
  }
}

async function handleUpdateCustomNetworkMessage(data) {
  const { chainId, chainName, rpcUrl, explorer, symbol, decimals } = data || {};
  if (!chainId) {
    return { success: false, error: 'chainId is required' };
  }

  let normalizedChainId;
  try {
    normalizedChainId = normalizeChainId(chainId);
  } catch (error) {
    return { success: false, error: error.message || 'invalid chainId' };
  }

  if (!rpcUrl) {
    return { success: false, error: 'rpcUrl is required' };
  }

  if (!chainName) {
    return { success: false, error: 'chainName is required' };
  }

  const validation = validateNetworkConfig({
    name: chainName,
    rpcUrl,
    chainId: normalizedChainId,
    symbol: symbol || 'ETH'
  });
  if (!validation.valid) {
    return { success: false, error: validation.errors?.[0] || 'invalid network' };
  }

  const updates = {
    chainId: normalizedChainId,
    chainName,
    rpcUrl,
    explorer: explorer || '',
    symbol: symbol || 'ETH',
    decimals: Number.isFinite(decimals) ? decimals : 18
  };

  try {
    await updateCustomNetwork(normalizedChainId, updates);

    if (state.currentChainId === normalizedChainId) {
      state.currentRpcUrl = updates.rpcUrl;
    }

    return { success: true, network: updates };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to update custom network' };
  }
}

/**
 * 处理来自 content script 的消息
 * @param {Object} message - 消息对象
 * @param {Object} port - Chrome runtime port
 * @param {string} origin - 来源
 * @param {number} tabId - 标签页 ID
 */
export async function handleContentMessage(message, port, origin, tabId) {
  // 验证消息
  const validation = MessageValidator.validateRequest(message);
  if (!validation.valid) {
    console.error('❌ Invalid message:', validation.error);
    sendError(
      { code: -32600, message: validation.error },
      port,
      message.metadata?.id
    );
    return;
  }

  const { method, params } = message.payload;
  const requestId = message.metadata.id;

  try {
    // 路由请求
    const result = await routeRequest(method, params, { origin, tabId });
    // 发送响应
    sendResponse(port, requestId, result);

  } catch (error) {
    console.error(`❌ Error handling ${method}:`, error);
    sendError(error, port, requestId);
  }
}

/**
 * 处理来自 popup 的消息
 * @param {Object} message - 消息对象
 * @param {Function} response - 响应函数
 */
export async function handlePopupMessage(message, response) {
  const { type, data } = message;

  console.log('📨 Received popup message:', type);

  try {
    switch (type) {
      // ==================== 钱包管理 ====================
      case 'IS_WALLET_INITIALIZED':
        const intializeResult = await isWalletInitialized();
        response(intializeResult);
        break;
      case 'GET_ALL_WALLETS':
        const getWalletsResult = await HandleGetWalletList();
        response(getWalletsResult);
        break;

      case 'CREATE_HD_WALLET':
        const createResult = await handleCreateHDWallet(data.accountName, data.password);
        response(createResult);
        break;

      case 'IMPORT_HD_WALLET':
        const importHDResult = await handleImportHDWallet(data.accountName, data.mnemonic, data.password);
        response(importHDResult);
        break;

      case 'IMPORT_PRIVATE_KEY_WALLET':
        const importPKResult = await handleImportPrivateKeyWallet(data.accountName, data.privateKey, data.password);
        response(importPKResult);
        break;

      case 'CREATE_SUB_ACCOUNT':
        const subAccountResult = await handleCreateSubAccount(data.walletId, data.accountName);
        response(subAccountResult);
        break;

      case 'SWITCH_ACCOUNT':
        const switchResult = await handleSwitchAccount(data.accountId, data.password);
        response(switchResult);
        break;

      // ==================== 解锁/锁定 ====================

      case 'UNLOCK_WALLET':
        const unlockResult = await unlockWallet(data.password, data.accountId);
        response(unlockResult);
        break;

      case 'LOCK_WALLET':
        const lockResult = await lockWallet();
        response(lockResult);
        break;

      // ==================== 状态查询 ====================

      case 'GET_WALLET_STATE':
        response({
          success: true,
          unlocked: state.keyring !== null,
          chainId: state.currentChainId
        });
        break;

      case WalletMessageType.UPDATE_POPUP_BOUNDS:
        if (data) {
          await persistPopupBounds(data);
        }
        response({ success: true });
        break;

      case WalletMessageType.GET_CURRENT_ACCOUNT:
        response(await handleGetCurrentAccount());
        break;

      case NetworkMessageType.GET_CURRENT_CHAIN_ID:
        response({
          success: true,
          chainId: state.currentChainId
        });
        break;

      case NetworkMessageType.GET_CURRENT_RPC_URL:
        response({
          success: true,
          rpcUrl: state.currentRpcUrl || NETWORKS[DEFAULT_NETWORK].rpc
        });
        break;

      case NetworkMessageType.SWITCH_NETWORK:
        response(await handleSwitchNetworkMessage(data));
        break;

      case NetworkMessageType.ADD_CUSTOM_NETWORK:
        response(await handleAddCustomNetworkMessage(data));
        break;

      case NetworkMessageType.UPDATE_CUSTOM_NETWORK:
        response(await handleUpdateCustomNetworkMessage(data));
        break;

      case NetworkMessageType.GET_CUSTOM_NETWORKS:
        response(await handleGetCustomNetworksMessage());
        break;

      case NetworkMessageType.REMOVE_CUSTOM_NETWORK:
        response(await handleRemoveCustomNetworkMessage(data?.chainId));
        break;

      case ApprovalMessageType.GET_PENDING_REQUEST:
        const pendingRequest = state.pendingRequests.get(data.requestId);
        response({
          success: true,
          request: pendingRequest || null
        });
        break;

      case WalletMessageType.GET_ACCOUNT_BY_ID:
        response(await handleGetAccountById(data?.accountId));
        break;

      case WalletMessageType.UPDATE_ACCOUNT_NAME:
        response(await handleUpdateAccountName(data?.accountId, data?.newName));
        break;

      case WalletMessageType.DELETE_ACCOUNT:
        response(await handleDeleteAccount(data?.accountId, data?.password));
        break;

      case WalletMessageType.GET_BALANCE:
        response(await handleGetBalance(data?.address));
        break;

      case WalletMessageType.GET_TOKEN_BALANCES:
        response(await handleGetTokenBalances(data?.address));
        break;

      case WalletMessageType.ADD_TOKEN:
        response(await handleAddToken(data?.token));
        break;

      case WalletMessageType.GET_AUTHORIZED_SITES:
        response(await handleGetAuthorizedSites());
        break;

      case WalletMessageType.REVOKE_SITE:
        response(await handleRevokeSite(data?.origin));
        break;

      case WalletMessageType.CLEAR_ALL_AUTHORIZATIONS:
        response(await handleClearAllAuthorizations());
        break;

      // ==================== 导出密钥 ====================

      case WalletMessageType.EXPORT_PRIVATE_KEY:
        response(await handleExportPrivateKey(data?.accountId, data?.password));
        break;

      case WalletMessageType.EXPORT_MNEMONIC:
        response(await handleExportMnemonic(data?.walletId, data?.password));
        break;

      // ==================== 密码管理 ====================

      case 'CHANGE_PASSWORD':
        try {
          await changePassword(data.oldPassword, data.newPassword);
          response({
            success: true
          });
        } catch (error) {
          response({
            success: false,
            error: error.message
          });
        }
        break;

      // ==================== 网络管理 ====================

      case 'SWITCH_NETWORK':
        try {
          await switchNetwork(data.networkKey);
          response({
            success: true
          });
        } catch (error) {
          response({
            success: false,
            error: error.message
          });
        }
        break;

      // ==================== 签名 ====================

      case 'SIGN_MESSAGE':
        try {
          const signature = await signMessage(data.message);
          response({
            success: true,
            signature
          });
        } catch (error) {
          response({
            success: false,
            error: error.message
          });
        }
        break;

      case 'SIGN_TRANSACTION':
        try {
          const signedTransaction = await signTransaction(data.transaction);
          response({
            success: true,
            signedTransaction
          });
        } catch (error) {
          response({
            success: false,
            error: error.message
          });
        }
        break;

      // ==================== 默认 ====================

      default:
        console.warn('⚠️ Unknown message type:', type);
        response({ success: false, error: 'Unknown message type' });
    }

  } catch (error) {
    console.error(`❌ Error handling popup message ${type}:`, error);
    response({
      success: false,
      error: error.message || 'Unknown error'
    });
  }
}

/**
 * 初始化消息监听器
 */
export function initMessageListeners() {
  // 监听来自 content script 的长连接
  chrome.runtime.onConnect.addListener((port) => {
    console.log('🔌 New connection:', port.name);

    if (port.name !== PORT_NAME) {
      return;
    }

    const sender = port.sender;
    const tabId = sender.tab?.id;
    const origin = new URL(sender.url).origin;

    // 注册连接
    registerConnection(port, tabId, origin);

    // 检查会话并通知
    checkSessionAndNotify(port, origin);

    // 监听消息
    port.onMessage.addListener((message) => {
      handleContentMessage(message, port, origin, tabId);
    });

    // 监听断开
    port.onDisconnect.addListener(() => {
      unregisterConnection(tabId);
    });
  });

  // 监听来自 popup 的一次性消息
  chrome.runtime.onMessage.addListener((message, sender, response) => {
    handlePopupMessage(message, response);
    return true; // 保持消息通道开启
  });

  console.log('✅ Message listeners initialized');
}

