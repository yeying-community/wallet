/**
 * YeYing Wallet - 消息处理
 * 负责：处理来自 content script 和 popup 的消息
 */

import { MessageValidator, PORT_NAME, EventType } from '../protocol/dapp-protocol.js';
import { APPROVAL_PORT_NAME, ApprovalMessageType, WalletMessageType, NetworkMessageType, TransactionMessageType } from '../protocol/extension-protocol.js';
import { sendResponse, sendError, registerConnection, unregisterConnection, checkSessionAndNotify } from './connection.js';
import { routeRequest } from './request-router.js';
import { unlockWallet, lockWallet, isAccountUnlocked } from './keyring.js';
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
  handleUpdateAccountUsername,
  handleGetProfile,
  handleUpdateProfileEmail,
  handleExportAccountsFile,
  handleImportAccountsFile,
  handleDeleteAccount,
  handleExportPrivateKey,
  handleExportMnemonic,
  handleResetWallet,
  changePassword
} from './operations/wallet.js';
import {
  handleGetBalance,
  handleAddToken,
  handleGetTokenBalances
} from './operations/tokens.js';
import {
  handleGetAuthorizedSites,
  handleGetSiteUcanSession,
  handleRevokeSite,
  handleClearAllAuthorizations
} from './operations/sites.js';
import {
  handleGetContacts,
  handleAddContact,
  handleUpdateContact,
  handleDeleteContact
} from './operations/contacts.js';
import {
  handleGetBackupSyncSettings,
  handleUpdateBackupSyncSettings,
  handleBackupSyncNow,
  handleBackupSyncClearRemote,
  handleBackupSyncClearLogs,
  handleBackupSyncLogEvent,
  handleResolveBackupSyncConflict
} from './operations/backup-sync.js';
import {
  handleCreateMpcWallet,
  handleGetMpcSettings,
  handleUpdateMpcSettings,
  handleGenerateMpcCoordinatorUcan,
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
  handleMpcFlushAuditExportQueue
} from './operations/mpc.js';
import {
  handleGetCustodySettings,
  handleUpdateCustodySettings,
  handleGetCustodyStatus,
  handleEnableCustody,
  handleDisableCustody
} from './operations/custody.js';
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
import {
  ensureApprovalStateHydrated,
  getPendingRequestById,
  getActiveApprovalSummary,
  recordApprovalResponse,
  registerApprovalChannel
} from './approval-flow.js';
import { diagnostics } from './diagnostics.js';

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
  const { from, to, value, data: txData, gas, gasLimit, chainId, token } = data || {};
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
      token: token || null,
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

async function handleEstimateGasMessage(data) {
  const { from, to, value, data: txData, gas, gasLimit, chainId, rpcUrl } = data || {};
  if (!from || !to) {
    return { success: false, error: 'Invalid transaction params' };
  }

  try {
    const estimateRpcUrl = await resolveTransactionRpcUrl({ chainId, rpcUrl });
    const tx = {
      from,
      to,
      value: value || '0x0',
      data: txData || '0x'
    };
    const limit = gasLimit || gas;
    if (limit) {
      tx.gas = limit;
    }
    const gasEstimate = await callJsonRpc(estimateRpcUrl, 'eth_estimateGas', [tx]);
    return { success: true, gas: gasEstimate };
  } catch (error) {
    return { success: false, error: normalizeRpcUiError(error, 'Estimate gas failed') };
  }
}

async function handleGetGasPriceMessage(data = {}) {
  try {
    const { chainId, rpcUrl } = data || {};
    const gasRpcUrl = await resolveTransactionRpcUrl({ chainId, rpcUrl });
    const gasPrice = await callJsonRpc(gasRpcUrl, 'eth_gasPrice', []);
    return { success: true, gasPrice };
  } catch (error) {
    return { success: false, error: normalizeRpcUiError(error, 'Failed to get gas price') };
  }
}

async function resolveTransactionRpcUrl({ chainId = null, rpcUrl = null } = {}) {
  if (rpcUrl) {
    return rpcUrl;
  }

  if (chainId) {
    const network = await getStoredNetworkByChainId(chainId);
    const networkRpcUrl = network?.rpcUrl || network?.rpc;
    if (networkRpcUrl) {
      return networkRpcUrl;
    }
  }

  const resolvedRpcUrl = await resolveRpcUrl();
  if (!resolvedRpcUrl) {
    throw new Error('RPC URL not configured');
  }
  return resolvedRpcUrl;
}

async function callJsonRpc(rpcUrl, method, params) {
  if (!rpcUrl) {
    throw new Error('RPC URL not configured');
  }

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: getTimestamp(),
      method,
      params
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || 'RPC error');
  }

  return payload.result;
}

function normalizeRpcUiError(error, fallbackMessage) {
  const rawMessage = String(error?.reason || error?.shortMessage || error?.message || error || fallbackMessage || '').trim();
  const reason = extractRpcRevertReason(rawMessage);
  const message = reason || rawMessage || fallbackMessage;
  return truncateRpcUiError(message);
}

function extractRpcRevertReason(message) {
  if (!message) return '';
  const reasonMatch = message.match(/reason="([^"]+)"/);
  if (reasonMatch?.[1]) return reasonMatch[1];
  const revertedQuotedMatch = message.match(/execution reverted:\s*"([^"]+)"/i);
  if (revertedQuotedMatch?.[1]) return revertedQuotedMatch[1];
  const revertedTextMatch = message.match(/execution reverted:?\s*([^(]+)?/i);
  if (revertedTextMatch?.[1]) return revertedTextMatch[1].trim();
  const argsMatch = message.match(/"args":\s*\[\s*"([^"]+)"/);
  if (argsMatch?.[1]) return argsMatch[1];
  return '';
}

function truncateRpcUiError(message) {
  const cleaned = String(message || '')
    .replace(/\s*\(action=.*$/i, '')
    .replace(/\s*\{.*$/s, '')
    .trim();
  if (!cleaned) {
    return 'RPC error';
  }
  return cleaned.length > 120 ? `${cleaned.slice(0, 120)}...` : cleaned;
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
    const result = await routeRequest(method, params, {
      origin,
      tabId,
      clientRequestId: requestId
    });

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
/**
 * Popup message handler registry.
 * 每个 handler 签名：async (data, ctx) => any，其中 ctx.message 是完整消息对象（用于读取非 data 字段）。
 * 返回值直接作为 response body 发送。抛错由外层 handlePopupMessage 的 try/catch 统一兜底。
 */
const popupHandlers = new Map([
  // ==================== 钱包管理 ====================
  ['IS_WALLET_INITIALIZED', async () => await isWalletInitialized()],
  ['GET_ALL_WALLETS', async () => await HandleGetWalletList()],
  ['CREATE_HD_WALLET', async (data) => await handleCreateHDWallet(data.accountName, data.password)],
  ['IMPORT_HD_WALLET', async (data) => await handleImportHDWallet(data.accountName, data.mnemonic, data.password)],
  ['IMPORT_PRIVATE_KEY_WALLET', async (data) => await handleImportPrivateKeyWallet(data.accountName, data.privateKey, data.password)],
  ['CREATE_MPC_WALLET', async (data) => await handleCreateMpcWallet(data)],
  ['CREATE_SUB_ACCOUNT', async (data) => await handleCreateSubAccount(data.walletId, data.accountName, data.password)],
  ['SWITCH_ACCOUNT', async (data) => await handleSwitchAccount(data.accountId, data.password)],

  // ==================== 解锁/锁定 ====================
  ['UNLOCK_WALLET', async (data) => {
    const unlockSource = typeof data?.source === 'string' ? data.source : 'unknown';
    return await unlockWallet(data.password, data.accountId, unlockSource);
  }],
  ['LOCK_WALLET', async () => await lockWallet()],

  // ==================== 状态查询 ====================
  ['GET_WALLET_STATE', async () => {
    const lastUnlockRequest = await getUserSetting('lastUnlockRequest', null);
    const account = await getSelectedAccount();
    return {
      success: true,
      unlocked: isAccountUnlocked(account?.id),
      chainId: state.currentChainId,
      lastUnlockRequest
    };
  }],
  [WalletMessageType.UPDATE_POPUP_BOUNDS, async (data) => {
    if (data) {
      await persistPopupBounds(data);
    }
    return { success: true };
  }],
  [WalletMessageType.GET_CURRENT_ACCOUNT, async () => await handleGetCurrentAccount()],

  [NetworkMessageType.GET_CURRENT_CHAIN_ID, async () => {
    if (!state.currentChainId) {
      const fallbackConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);
      state.currentChainId = fallbackConfig?.chainIdHex
        || (fallbackConfig?.chainId ? normalizeChainId(fallbackConfig.chainId) : null)
        || state.currentChainId;
    }
    return { success: true, chainId: state.currentChainId };
  }],
  [NetworkMessageType.GET_CURRENT_RPC_URL, async () => {
    let rpcUrl = state.currentRpcUrl;
    if (!rpcUrl) {
      const fallbackConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);
      rpcUrl = fallbackConfig?.rpcUrl || fallbackConfig?.rpc || '';
      if (rpcUrl) {
        state.currentRpcUrl = rpcUrl;
      }
    }
    return { success: true, rpcUrl };
  }],
  [NetworkMessageType.SWITCH_NETWORK, async (data) => await handleSwitchNetworkMessage(data)],
  [NetworkMessageType.ADD_CUSTOM_NETWORK, async (data) => await handleAddCustomNetworkMessage(data)],
  [NetworkMessageType.UPDATE_CUSTOM_NETWORK, async (data) => await handleUpdateCustomNetworkMessage(data)],
  [NetworkMessageType.GET_SUPPORTED_NETWORKS, async () => await handleGetSupportedNetworksMessage()],
  [NetworkMessageType.GET_NETWORK_INFO, async () => await handleGetNetworkInfoMessage()],
  [NetworkMessageType.GET_CUSTOM_NETWORKS, async () => await handleGetNetworksMessage()],
  [NetworkMessageType.REMOVE_CUSTOM_NETWORK, async (data) => await handleRemoveCustomNetworkMessage(data?.chainId)],

  // ==================== 审批 ====================
  [ApprovalMessageType.GET_PENDING_REQUEST, async (data) => {
    await ensureApprovalStateHydrated();
    const pendingRequest = getPendingRequestById(data.requestId);
    return { success: true, request: pendingRequest || null };
  }],
  [ApprovalMessageType.GET_ACTIVE_APPROVAL, async () => {
    await ensureApprovalStateHydrated();
    const approval = getActiveApprovalSummary();
    if (approval?.windowId) {
      chrome.windows.update(approval.windowId, { focused: true }).catch(() => { });
    }
    return { success: true, approval };
  }],
  [ApprovalMessageType.APPROVAL_RESPONSE, async (_data, ctx) => {
    await ensureApprovalStateHydrated();
    const { message } = ctx;
    return {
      success: recordApprovalResponse(message.requestId, {
        approved: message.approved,
        account: message.account || null
      })
    };
  }],
  // background -> approval 页面提示消息；若回流到 background，直接忽略
  [ApprovalMessageType.APPROVAL_QUEUE_UPDATE, async () => ({ success: true })],
  // ==================== 账户 / 授权 ====================
  [WalletMessageType.GET_ACCOUNT_BY_ID, async (data) => await handleGetAccountById(data?.accountId)],
  [WalletMessageType.UPDATE_ACCOUNT_NAME, async (data) => await handleUpdateAccountName(data?.accountId, data?.newName)],
  [WalletMessageType.UPDATE_ACCOUNT_USERNAME, async (data) => await handleUpdateAccountUsername(data?.accountId, data?.username)],
  [WalletMessageType.GET_PROFILE, async () => await handleGetProfile()],
  [WalletMessageType.UPDATE_PROFILE_EMAIL, async (data) => await handleUpdateProfileEmail(data?.email)],
  [WalletMessageType.EXPORT_ACCOUNTS_FILE, async (data) => await handleExportAccountsFile(data?.password)],
  [WalletMessageType.IMPORT_ACCOUNTS_FILE, async (data) => await handleImportAccountsFile(data?.file, data?.password)],
  [WalletMessageType.DELETE_ACCOUNT, async (data) => await handleDeleteAccount(data?.accountId, data?.password)],
  [WalletMessageType.GET_BALANCE, async (data) => await handleGetBalance(data?.address)],
  [WalletMessageType.GET_TOKEN_BALANCES, async (data) => await handleGetTokenBalances(data?.address)],
  [WalletMessageType.ADD_TOKEN, async (data) => await handleAddToken(data?.token)],
  [WalletMessageType.GET_AUTHORIZED_SITES, async () => await handleGetAuthorizedSites()],
  [WalletMessageType.GET_SITE_UCAN_SESSION, async (data) => await handleGetSiteUcanSession(data?.origin, data?.address)],
  [WalletMessageType.REVOKE_SITE, async (data) => await handleRevokeSite(data?.origin)],
  [WalletMessageType.CLEAR_ALL_AUTHORIZATIONS, async () => await handleClearAllAuthorizations()],
  [WalletMessageType.RESET_WALLET, async () => await handleResetWallet()],

  // ==================== 联系人 ====================
  [WalletMessageType.GET_CONTACTS, async () => await handleGetContacts()],
  [WalletMessageType.ADD_CONTACT, async (data) => await handleAddContact(data)],
  [WalletMessageType.UPDATE_CONTACT, async (data) => await handleUpdateContact(data)],
  [WalletMessageType.DELETE_CONTACT, async (data) => await handleDeleteContact(data?.id)],

  // ==================== 备份同步 ====================
  [WalletMessageType.GET_BACKUP_SYNC_SETTINGS, async () => await handleGetBackupSyncSettings()],
  [WalletMessageType.UPDATE_BACKUP_SYNC_SETTINGS, async (data) => await handleUpdateBackupSyncSettings(data?.updates)],
  [WalletMessageType.BACKUP_SYNC_NOW, async () => await handleBackupSyncNow()],
  [WalletMessageType.BACKUP_SYNC_CLEAR_REMOTE, async () => await handleBackupSyncClearRemote()],
  [WalletMessageType.BACKUP_SYNC_CLEAR_LOGS, async () => await handleBackupSyncClearLogs()],
  [WalletMessageType.BACKUP_SYNC_LOG_EVENT, async (data) => await handleBackupSyncLogEvent(data)],
  [WalletMessageType.RESOLVE_BACKUP_SYNC_CONFLICT, async (data) => await handleResolveBackupSyncConflict(data)],

  // ==================== MPC ====================
  [WalletMessageType.GET_MPC_SETTINGS, async () => await handleGetMpcSettings()],
  [WalletMessageType.UPDATE_MPC_SETTINGS, async (data) => await handleUpdateMpcSettings(data?.updates)],
  [WalletMessageType.GENERATE_MPC_COORDINATOR_UCAN, async (data) => await handleGenerateMpcCoordinatorUcan(data)],
  [WalletMessageType.MPC_GET_DEVICE_INFO, async () => await handleMpcGetDeviceInfo()],
  [WalletMessageType.MPC_CREATE_SESSION, async (data) => await handleMpcCreateSession(data)],
  [WalletMessageType.MPC_JOIN_SESSION, async (data) => await handleMpcJoinSession(data)],
  [WalletMessageType.MPC_SEND_SESSION_MESSAGE, async (data) => await handleMpcSendSessionMessage(data)],
  [WalletMessageType.MPC_DECRYPT_MESSAGE, async (data) => await handleMpcDecryptMessage(data)],
  [WalletMessageType.MPC_FETCH_SESSION_MESSAGES, async (data) => await handleMpcFetchSessionMessages(data)],
  [WalletMessageType.MPC_GET_SESSION, async (data) => await handleMpcGetSession(data?.sessionId)],
  [WalletMessageType.MPC_GET_SESSIONS, async () => await handleMpcGetSessions()],
  [WalletMessageType.MPC_START_STREAM, async (data) => await handleMpcStartStream(data)],
  [WalletMessageType.MPC_STOP_STREAM, async (data) => await handleMpcStopStream(data)],
  [WalletMessageType.MPC_GET_AUDIT_LOGS, async () => await handleMpcGetAuditLogs()],
  [WalletMessageType.MPC_CLEAR_AUDIT_LOGS, async () => await handleMpcClearAuditLogs()],
  [WalletMessageType.MPC_GET_AUDIT_EXPORT_CONFIG, async () => await handleMpcGetAuditExportConfig()],
  [WalletMessageType.MPC_UPDATE_AUDIT_EXPORT_CONFIG, async (data) => await handleMpcUpdateAuditExportConfig(data?.updates)],
  [WalletMessageType.MPC_EXPORT_AUDIT_LOGS, async (data) => await handleMpcExportAuditLogs(data)],
  [WalletMessageType.MPC_FLUSH_AUDIT_EXPORT_QUEUE, async () => await handleMpcFlushAuditExportQueue()],

  // ==================== 密钥托管 ====================
  [WalletMessageType.CUSTODY_GET_SETTINGS, async () => await handleGetCustodySettings()],
  [WalletMessageType.CUSTODY_UPDATE_SETTINGS, async (data) => await handleUpdateCustodySettings(data?.updates)],
  [WalletMessageType.CUSTODY_GET_STATUS, async (data) => await handleGetCustodyStatus(data)],
  [WalletMessageType.CUSTODY_ENABLE, async (data) => await handleEnableCustody(data)],
  [WalletMessageType.CUSTODY_DISABLE, async (data) => await handleDisableCustody(data)],

  // ==================== 交易 ====================
  [TransactionMessageType.SEND_TRANSACTION, async (data) => await handleSendTransactionMessage(data)],
  [TransactionMessageType.ESTIMATE_GAS, async (data) => await handleEstimateGasMessage(data)],
  [TransactionMessageType.GET_GAS_PRICE, async (data) => await handleGetGasPriceMessage(data)],
  [TransactionMessageType.GET_TRANSACTIONS, async (data) => await handleGetTransactionsMessage(data)],
  [TransactionMessageType.CLEAR_TRANSACTIONS, async (data) => await handleClearTransactionsMessage(data)],

  // ==================== 导出密钥 ====================
  [WalletMessageType.EXPORT_PRIVATE_KEY, async (data) => await handleExportPrivateKey(data?.accountId, data?.password)],
  [WalletMessageType.EXPORT_MNEMONIC, async (data) => await handleExportMnemonic(data?.walletId, data?.password)],

  // ==================== 诊断（可观测） ====================
  [WalletMessageType.GET_DIAGNOSTICS, async () => ({ success: true, enabled: diagnostics.isEnabled(), entries: diagnostics.getEntries() })],
  [WalletMessageType.CLEAR_DIAGNOSTICS, async () => { diagnostics.clear(); return { success: true }; }],
  [WalletMessageType.GET_DIAGNOSTICS_SETTINGS, async () => ({ success: true, enabled: diagnostics.isEnabled() })],
  [WalletMessageType.UPDATE_DIAGNOSTICS_SETTINGS, async (data) => ({ success: true, enabled: await diagnostics.setEnabled(Boolean(data?.enabled)) })],

  // ==================== 密码管理（含内层 try/catch，与原行为一致） ====================
  ['CHANGE_PASSWORD', async (data) => {
    try {
      await changePassword(data.oldPassword, data.newPassword);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }],

  // 注：原 switch 中另有一个 case 'SWITCH_NETWORK'（调用未定义的 switchNetwork），
  // 因与 NetworkMessageType.SWITCH_NETWORK 同值（'SWITCH_NETWORK'）且位于其后，
  // 在 switch 语义下是永不执行的死代码，此处不再保留，统一走 handleSwitchNetworkMessage。

  // ==================== 签名（含 locked + requirePassword 早返分支） ====================
  ['SIGN_MESSAGE', async (data) => {
    try {
      const account = await getSelectedAccount();
      if (!account?.id) {
        throw new Error('Account not found');
      }
      if (!state.keyring || !state.keyring.has(account.id)) {
        if (!data?.password) {
          return { success: false, error: 'Wallet is locked', requirePassword: true };
        }
        await unlockWallet(data.password, account.id, 'popup');
      }
      const signature = await signMessage(account.id, data.message);
      return { success: true, signature };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }],
  ['SIGN_TRANSACTION', async (data) => {
    try {
      const account = await getSelectedAccount();
      if (!account?.id) {
        throw new Error('Account not found');
      }
      if (!state.keyring || !state.keyring.has(account.id)) {
        if (!data?.password) {
          return { success: false, error: 'Wallet is locked', requirePassword: true };
        }
        await unlockWallet(data.password, account.id, 'popup');
      }
      const signedTransaction = await signTransaction(account.id, data.transaction);
      return { success: true, signedTransaction };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }]
]);

/**
 * 处理来自 popup 的消息
 * @param {Object} message - 消息对象
 * @param {Function} response - 响应函数
 */
export async function handlePopupMessage(message, response) {
  const { type, data } = message;

  console.log('📨 Received popup message:', type);

  const handler = popupHandlers.get(type);
  if (!handler) {
    console.warn('⚠️ Unknown message type:', type);
    response({ success: false, error: 'Unknown message type' });
    return;
  }

  try {
    const result = await handler(data, { message });
    if (typeof result !== 'undefined') {
      response(result);
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

    if (port.name === APPROVAL_PORT_NAME) {
      registerApprovalChannel(port);
      return;
    }

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
