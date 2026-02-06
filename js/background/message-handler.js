/**
 * YeYing Wallet - 消息处理
 * 负责：处理来自 content script 和 popup 的消息
 */

import { MessageValidator, PORT_NAME, EventType } from '../protocol/dapp-protocol.js';
import { ApprovalMessageType, WalletMessageType, NetworkMessageType, TransactionMessageType } from '../protocol/extension-protocol.js';
import { sendResponse, sendError, registerConnection, unregisterConnection, checkSessionAndNotify } from './connection.js';
import { routeRequest } from './request-router.js';
import { unlockWallet, lockWallet } from './keyring.js';
import { signMessage, signTransaction } from './signing.js';
import { ethers } from '../../lib/ethers-6.16.esm.min.js';
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
  handleGetSiteUcanSession,
  handleRevokeSite,
  handleClearAllAuthorizations,
  handleResetWallet,
  handleGetContacts,
  handleAddContact,
  handleUpdateContact,
  handleDeleteContact,
  handleGetBackupSyncSettings,
  handleUpdateBackupSyncSettings,
  handleBackupSyncNow,
  handleBackupSyncClearRemote,
  handleBackupSyncClearLogs,
  handleBackupSyncLogEvent,
  handleGetMpcSettings,
  handleUpdateMpcSettings,
  handleMpcGetDeviceInfo,
  handleMpcCreateSession,
  handleMpcJoinSession,
  handleMpcSendSessionMessage,
  handleMpcDecryptMessage,
  handleMpcFetchSessionMessages,
  handleMpcGetSession,
  handleMpcGetSessions,
  handleMpcStartStream,
  handleMpcStopStream,
  handleMpcGetAuditLogs,
  handleMpcClearAuditLogs,
  handleMpcGetAuditExportConfig,
  handleMpcUpdateAuditExportConfig,
  handleMpcExportAuditLogs,
  handleMpcFlushAuditExportQueue,
  handleResolveBackupSyncConflict,
  changePassword
} from './wallet-operations.js';
import { state } from './state.js';
import { DEFAULT_NETWORK } from '../config/index.js';
import { normalizeChainId } from '../common/chain/index.js';
import { getTimestamp } from '../common/utils/time-utils.js';
import {
  saveSelectedNetworkName,
  updateUserSetting,
  getUserSetting,
  addNetwork,
  getNetworks,
  deleteNetwork,
  updateNetwork,
  getNetworkByChainId as getStoredNetworkByChainId,
  getNetworkConfigByKey,
  getAccountList,
  getSelectedAccount,
  addTransaction,
  updateTransaction,
  getTransactionsByAddress,
  clearTransactionsByAddress
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
      id: getTimestamp(),
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

  if (networkKey) {
    const network = await getNetworkConfigByKey(networkKey);
    if (!network) {
      return { success: false, error: 'Unknown network key' };
    }
    nextChainId = network.chainIdHex || normalizeChainId(network.chainId);
    nextRpcUrl = network.rpcUrl || network.rpc;
  } else if (chainId) {
    const normalizedChainId = normalizeChainId(chainId);
    const network = await getStoredNetworkByChainId(normalizedChainId);
    nextChainId = normalizedChainId;
    nextRpcUrl = rpcUrl || network?.rpcUrl || network?.rpc;

    if (!selectedNetworkName) {
      selectedNetworkName = network?.key || network?.id || null;
    }
  } else if (rpcUrl) {
    const resolvedChainId = await fetchChainIdFromRpc(rpcUrl);
    const normalizedChainId = normalizeChainId(resolvedChainId);
    const network = await getStoredNetworkByChainId(normalizedChainId);

    nextChainId = normalizedChainId;
    nextRpcUrl = rpcUrl;
    selectedNetworkName = network
      ? (network?.key || network?.id || null)
      : null;
  } else {
    return { success: false, error: 'rpcUrl or chainId is required' };
  }

  if (!nextRpcUrl) {
    return { success: false, error: 'rpcUrl is required' };
  }

  const prevChainId = state.currentChainId;
  if (!nextChainId) {
    const fallbackConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);
    nextChainId = fallbackConfig?.chainIdHex || (fallbackConfig?.chainId ? normalizeChainId(fallbackConfig.chainId) : null);
  }
  state.currentChainId = nextChainId || state.currentChainId;
  state.currentRpcUrl = nextRpcUrl;

  if (!selectedNetworkName && nextChainId) {
    selectedNetworkName = nextChainId;
  }
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
    const stored = await addNetwork(network);
    return { success: true, network: stored };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to add network' };
  }
}

async function handleGetNetworksMessage() {
  try {
    const networks = await getNetworks();
    return { success: true, networks };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get networks' };
  }
}

async function handleGetSupportedNetworksMessage() {
  try {
    const networks = await getNetworks();
    return { success: true, networks };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get networks' };
  }
}

async function handleGetNetworkInfoMessage() {
  try {
    let chainId = state.currentChainId;
    if (!chainId) {
      const fallbackConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);
      chainId = fallbackConfig?.chainIdHex
        || (fallbackConfig?.chainId ? normalizeChainId(fallbackConfig.chainId) : null)
        || null;
      if (chainId) {
        state.currentChainId = chainId;
      }
    }
    const network = await getStoredNetworkByChainId(chainId);
    return {
      success: true,
      network: network || {
        chainId: chainId,
        rpcUrl: state.currentRpcUrl
      }
    };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get network info' };
  }
}

async function resolveAccountIdByAddress(address) {
  if (!address) return null;
  const accounts = await getAccountList();
  const lowered = address.toLowerCase();
  const match = accounts.find(account => account?.address?.toLowerCase() === lowered);
  return match?.id || null;
}

async function handleSendTransactionMessage(data) {
  const { from, to, value, data: txData, gas, gasLimit, chainId } = data || {};
  if (!from || !to || !value) {
    return { success: false, error: 'Invalid transaction params' };
  }

  const accountId = await resolveAccountIdByAddress(from);
  if (!accountId) {
    return { success: false, error: 'Account not found' };
  }

  try {
    const tx = {
      to,
      value,
      data: txData || '0x'
    };
    const limit = gasLimit || gas;
    if (limit) {
      tx.gasLimit = limit;
    }

    const result = await signTransaction(accountId, tx);
    const txHash = result?.hash || result?.transactionHash || result?.txHash || result;
    let normalizedChainId = null;
    if (chainId) {
      try {
        normalizedChainId = normalizeChainId(chainId);
      } catch {
        normalizedChainId = String(chainId);
      }
    }
    await addTransaction({
      hash: txHash,
      from,
      to,
      value: result?.value ?? value,
      timestamp: getTimestamp(),
      status: 'pending',
      chainId: normalizedChainId || state.currentChainId || null
    });
    return {
      success: true,
      txHash
    };
  } catch (error) {
    return { success: false, error: error.message || 'Send transaction failed' };
  }
}

async function resolveRpcUrl(chainIdOverride = null) {
  const targetChainId = chainIdOverride || state.currentChainId;
  let rpcUrl = state.currentRpcUrl;
  if (targetChainId) {
    const network = await getStoredNetworkByChainId(targetChainId);
    rpcUrl = rpcUrl || network?.rpcUrl || network?.rpc;
  }
  if (!rpcUrl) {
    const fallbackConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);
    rpcUrl = fallbackConfig?.rpcUrl || fallbackConfig?.rpc || '';
  }
  return rpcUrl;
}

async function refreshTransactionStatuses(transactions, chainId = null) {
  const pending = (transactions || []).filter(tx => tx?.status === 'pending' && tx?.hash);
  if (pending.length === 0) {
    return transactions || [];
  }

  const rpcUrl = await resolveRpcUrl(chainId);
  if (!rpcUrl) {
    return transactions || [];
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  for (const tx of pending) {
    try {
      const receipt = await provider.getTransactionReceipt(tx.hash);
      if (!receipt || receipt.blockNumber == null) {
        continue;
      }
      const status = receipt.status === 1 ? 'confirmed' : 'failed';
      if (tx.status !== status) {
        await updateTransaction(tx.hash, {
          status,
          confirmedAt: getTimestamp(),
          blockNumber: receipt.blockNumber
        });
        tx.status = status;
      }
    } catch (error) {
      console.warn('[Background] 更新交易状态失败:', error);
    }
  }

  return transactions || [];
}

async function handleGetTransactionsMessage(data) {
  const { address, chainId } = data || {};
  let normalizedChainId = null;
  if (chainId) {
    try {
      normalizedChainId = normalizeChainId(chainId);
    } catch {
      normalizedChainId = String(chainId);
    }
  }
  if (!normalizedChainId) {
    normalizedChainId = state.currentChainId;
  }
  const transactions = await getTransactionsByAddress(address, normalizedChainId || null);
  const refreshed = await refreshTransactionStatuses(transactions, normalizedChainId || null);
  return { success: true, transactions: refreshed };
}

async function handleClearTransactionsMessage(data) {
  const { address, chainId } = data || {};
  let normalizedChainId = null;
  if (chainId) {
    try {
      normalizedChainId = normalizeChainId(chainId);
    } catch {
      normalizedChainId = String(chainId);
    }
  }
  if (!normalizedChainId) {
    normalizedChainId = state.currentChainId;
  }
  const removed = await clearTransactionsByAddress(address || null, normalizedChainId || null);
  return { success: true, removed };
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
    await deleteNetwork(normalizedChainId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to remove network' };
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
    await updateNetwork(normalizedChainId, updates);

    if (state.currentChainId === normalizedChainId) {
      state.currentRpcUrl = updates.rpcUrl;
    }

      return { success: true, network: updates };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to update network' };
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
        const subAccountResult = await handleCreateSubAccount(data.walletId, data.accountName, data.password);
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
        const lastUnlockRequest = await getUserSetting('lastUnlockRequest', null);
        response({
          success: true,
          unlocked: state.keyring !== null,
          chainId: state.currentChainId,
          lastUnlockRequest
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
        if (!state.currentChainId) {
          const fallbackConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);
          state.currentChainId = fallbackConfig?.chainIdHex
            || (fallbackConfig?.chainId ? normalizeChainId(fallbackConfig.chainId) : null)
            || state.currentChainId;
        }
        response({
          success: true,
          chainId: state.currentChainId
        });
        break;

      case NetworkMessageType.GET_CURRENT_RPC_URL:
        {
          let rpcUrl = state.currentRpcUrl;
          if (!rpcUrl) {
            const fallbackConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);
            rpcUrl = fallbackConfig?.rpcUrl || fallbackConfig?.rpc || '';
            if (rpcUrl) {
              state.currentRpcUrl = rpcUrl;
            }
          }
          response({ success: true, rpcUrl });
        }
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

      case NetworkMessageType.GET_SUPPORTED_NETWORKS:
        response(await handleGetSupportedNetworksMessage());
        break;

      case NetworkMessageType.GET_NETWORK_INFO:
        response(await handleGetNetworkInfoMessage());
        break;

      case NetworkMessageType.GET_CUSTOM_NETWORKS:
        response(await handleGetNetworksMessage());
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

      case WalletMessageType.GET_SITE_UCAN_SESSION:
        response(await handleGetSiteUcanSession(data?.origin, data?.address));
        break;

      case WalletMessageType.REVOKE_SITE:
        response(await handleRevokeSite(data?.origin));
        break;

      case WalletMessageType.CLEAR_ALL_AUTHORIZATIONS:
        response(await handleClearAllAuthorizations());
        break;

      case WalletMessageType.RESET_WALLET:
        response(await handleResetWallet());
        break;

      case WalletMessageType.GET_CONTACTS:
        response(await handleGetContacts());
        break;

      case WalletMessageType.ADD_CONTACT:
        response(await handleAddContact(data));
        break;

      case WalletMessageType.UPDATE_CONTACT:
        response(await handleUpdateContact(data));
        break;

      case WalletMessageType.DELETE_CONTACT:
        response(await handleDeleteContact(data?.id));
        break;

      case WalletMessageType.GET_BACKUP_SYNC_SETTINGS:
        response(await handleGetBackupSyncSettings());
        break;

      case WalletMessageType.UPDATE_BACKUP_SYNC_SETTINGS:
        response(await handleUpdateBackupSyncSettings(data?.updates));
        break;

      case WalletMessageType.BACKUP_SYNC_NOW:
        response(await handleBackupSyncNow());
        break;

      case WalletMessageType.BACKUP_SYNC_CLEAR_REMOTE:
        response(await handleBackupSyncClearRemote());
        break;

      case WalletMessageType.BACKUP_SYNC_CLEAR_LOGS:
        response(await handleBackupSyncClearLogs());
        break;

      case WalletMessageType.BACKUP_SYNC_LOG_EVENT:
        response(await handleBackupSyncLogEvent(data));
        break;

      case WalletMessageType.GET_MPC_SETTINGS:
        response(await handleGetMpcSettings());
        break;

      case WalletMessageType.UPDATE_MPC_SETTINGS:
        response(await handleUpdateMpcSettings(data?.updates));
        break;

      case WalletMessageType.MPC_GET_DEVICE_INFO:
        response(await handleMpcGetDeviceInfo());
        break;

      case WalletMessageType.MPC_CREATE_SESSION:
        response(await handleMpcCreateSession(data));
        break;

      case WalletMessageType.MPC_JOIN_SESSION:
        response(await handleMpcJoinSession(data));
        break;

      case WalletMessageType.MPC_SEND_SESSION_MESSAGE:
        response(await handleMpcSendSessionMessage(data));
        break;

      case WalletMessageType.MPC_DECRYPT_MESSAGE:
        response(await handleMpcDecryptMessage(data));
        break;

      case WalletMessageType.MPC_FETCH_SESSION_MESSAGES:
        response(await handleMpcFetchSessionMessages(data));
        break;

      case WalletMessageType.MPC_GET_SESSION:
        response(await handleMpcGetSession(data?.sessionId));
        break;

      case WalletMessageType.MPC_GET_SESSIONS:
        response(await handleMpcGetSessions());
        break;

      case WalletMessageType.MPC_START_STREAM:
        response(await handleMpcStartStream(data));
        break;

      case WalletMessageType.MPC_STOP_STREAM:
        response(await handleMpcStopStream(data));
        break;

      case WalletMessageType.MPC_GET_AUDIT_LOGS:
        response(await handleMpcGetAuditLogs());
        break;

      case WalletMessageType.MPC_CLEAR_AUDIT_LOGS:
        response(await handleMpcClearAuditLogs());
        break;

      case WalletMessageType.MPC_GET_AUDIT_EXPORT_CONFIG:
        response(await handleMpcGetAuditExportConfig());
        break;

      case WalletMessageType.MPC_UPDATE_AUDIT_EXPORT_CONFIG:
        response(await handleMpcUpdateAuditExportConfig(data?.updates));
        break;

      case WalletMessageType.MPC_EXPORT_AUDIT_LOGS:
        response(await handleMpcExportAuditLogs(data));
        break;

      case WalletMessageType.MPC_FLUSH_AUDIT_EXPORT_QUEUE:
        response(await handleMpcFlushAuditExportQueue());
        break;

      case WalletMessageType.RESOLVE_BACKUP_SYNC_CONFLICT:
        response(await handleResolveBackupSyncConflict(data));
        break;

      // ==================== 交易 ====================

      case TransactionMessageType.SEND_TRANSACTION:
        response(await handleSendTransactionMessage(data));
        break;

      case TransactionMessageType.GET_TRANSACTIONS:
        response(await handleGetTransactionsMessage(data));
        break;

      case TransactionMessageType.CLEAR_TRANSACTIONS:
        response(await handleClearTransactionsMessage(data));
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
          const account = await getSelectedAccount();
          if (!account?.id) {
            throw new Error('Account not found');
          }
          if (!state.keyring || !state.keyring.has(account.id)) {
            if (!data?.password) {
              response({
                success: false,
                error: 'Wallet is locked',
                requirePassword: true
              });
              break;
            }
            await unlockWallet(data.password, account.id);
          }
          const signature = await signMessage(account.id, data.message);
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
          const account = await getSelectedAccount();
          if (!account?.id) {
            throw new Error('Account not found');
          }
          if (!state.keyring || !state.keyring.has(account.id)) {
            if (!data?.password) {
              response({
                success: false,
                error: 'Wallet is locked',
                requirePassword: true
              });
              break;
            }
            await unlockWallet(data.password, account.id);
          }
          const signedTransaction = await signTransaction(account.id, data.transaction);
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
    const origin = resolveOrigin(sender?.url);

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
    if (message?.type === 'KEEP_ALIVE') {
      const isExtensionSender = sender?.id === chrome.runtime.id;
      const senderUrl = sender?.url || '';
      const baseUrl = chrome.runtime.getURL('');
      if (!isExtensionSender || (senderUrl && !senderUrl.startsWith(baseUrl))) {
        response({ success: false });
        return false;
      }
      response({ success: true });
      return false;
    }
    handlePopupMessage(message, response);
    return true; // 保持消息通道开启
  });

  console.log('✅ Message listeners initialized');
}

function resolveOrigin(senderUrl) {
  if (!senderUrl) return 'unknown';
  try {
    const url = new URL(senderUrl);
    if (url.protocol === 'file:') {
      return stripUrlHashAndQuery(url.href);
    }
    const origin = url.origin;
    if (origin === 'null') {
      return stripUrlHashAndQuery(url.href);
    }
    return origin;
  } catch (error) {
    return senderUrl;
  }
}

function stripUrlHashAndQuery(url) {
  return url.split('#')[0].split('?')[0];
}
