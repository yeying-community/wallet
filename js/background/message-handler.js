/**
 * YeYing Wallet - 消息处理
 * 负责：处理来自 content script 和 popup 的消息
 */

import { MessageValidator, PORT_NAME, EventType } from '../protocol/dapp-protocol.js';
import { APPROVAL_PORT_NAME, ApprovalMessageType, WalletMessageType, NetworkMessageType, TransactionMessageType } from '../protocol/extension-protocol.js';
import { sendResponse, sendError, registerConnection, unregisterConnection, checkSessionAndNotify } from './connection.js';
import { routeRequest } from './request-router.js';
import { unlockWallet, lockWallet, isAccountUnlocked } from './keyring.js';
import { resolveMpcAccountIdByAddress } from './signing.js';
import {
  signMessage,
  signTransactionRaw,
  broadcastRawTransaction
} from '../chain/signing-service.js';
import { ethers } from '../../lib/ethers-6.16.esm.min.js';
import {
  isWalletInitialized,
  HandleGetWalletList,
  handleCreateHDWallet,
  handleCreateTronHDWallet,
  handleImportHDWallet,
  handleImportTronHDWallet,
  handleImportSolanaHDWallet,
  handleImportPrivateKeyWallet,
  handleImportTronPrivateKeyWallet,
  handleImportSolanaPrivateKeyWallet,
  handleCreateSubAccount,
  handleCreateTronSubAccount,
  handleCreateSolanaSubAccount,
  handleSwitchAccount,
  handleGetCurrentAccount,
  handleGetAccountById,
  handleUpdateAccountName,
  handleUpdateAccountUsername,
  handleGetProfile,
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
  handleMpcCancelSession,
  handleMpcDeleteWallet,
  handleMpcListInvites,
  handleMpcDismissInvite,
  handleMpcAcceptInvite,
  handleMpcJoinSession,
  handleMpcStartKeygen,
  handleMpcSendSessionMessage,
  handleMpcDecryptMessage,
  handleMpcFetchSessionMessages,
  handleMpcListSignRequests,
  handleMpcProcessPendingSignRequests,
  handleMpcGetSession,
  handleMpcGetSessions,
  handleMpcDiagnoseWallet,
  handleMpcPrepareWalletSigning,
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
  handleCreateIdentity,
  handleListIdentities,
  handleGetIdentity,
  handleSelectIdentity,
  handleDeleteIdentity,
  handleExportIdentityDocument,
  handleSignIdentityDocument,
  handleSignIdentityAction,
  handleSaveIdentityCredentials,
  handleListIdentityCredentials,
  handleRequestIdentityVerification,
  handleConfirmIdentityVerification
} from './operations/identity.js';
import {
  handleGetCustodySettings,
  handleUpdateCustodySettings,
  handleGetCustodyStatus,
  handleListCustodySecrets,
  handleGetCustodySecret,
  handleRestoreCustodySecret,
  handleEnableCustody,
  handleDisableCustody
} from './operations/custody.js';
import { state } from './state.js';
import {
  getCurrentEvmChainIdHex,
  setCurrentChainKey,
  chainIdToChainKey
} from '../chain/current-chain.js';
import { DEFAULT_NETWORK } from '../config/index.js';
import { normalizeChainId } from '../common/chain/index.js';
import { compareAddresses } from '../common/chain/address-normalize.js';
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
  let nextChainKey = null;
  let nextRpcUrl = null;
  let selectedNetworkName = networkKey;

  if (networkKey) {
    const network = await getNetworkConfigByKey(networkKey);
    if (!network) {
      return { success: false, error: 'Unknown network key' };
    }
    // Tron 等非 EVM 链没有 numeric chainId；它们携带 `chainKey` 字段
    // （CAIP-2 `tron:<reference>`），下游 setCurrentChainKey 直接读它。
    // EVM 网络走 `chainIdHex`/`chainId` 路径；Tron 走 chainKey 路径，
    // `nextChainId` 留 null，让 line 246-252 的 fallback 不被触发。
    if (network.chainKey) {
      nextChainKey = network.chainKey;
    } else {
      nextChainId = network.chainIdHex || normalizeChainId(network.chainId);
    }
    nextRpcUrl = network.rpcUrl || network.rpc || network.tronRpcUrl;
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

  const prevChainKey = state.currentChainKey;
  if (!nextChainId && !nextChainKey) {
    const fallbackConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);
    nextChainId = fallbackConfig?.chainIdHex || (fallbackConfig?.chainId ? normalizeChainId(fallbackConfig.chainId) : null);
  }
  if (nextChainKey) {
    // Tron 等非 EVM 链：直接用 network.chainKey（CAIP-2 `tron:<reference>`）
    setCurrentChainKey(nextChainKey);
  } else if (nextChainId) {
    setCurrentChainKey(chainIdToChainKey(nextChainId));
  }
  state.currentRpcUrl = nextRpcUrl;

  if (!selectedNetworkName && nextChainId) {
    selectedNetworkName = nextChainId;
  }
  if (selectedNetworkName) {
    await saveSelectedNetworkName(selectedNetworkName);
  }

  if (prevChainKey !== state.currentChainKey) {
    broadcastEvent(EventType.CHAIN_CHANGED, { chainId: getCurrentEvmChainIdHex() });
  }

  return {
    success: true,
    chainId: getCurrentEvmChainIdHex(),
    rpcUrl: state.currentRpcUrl,
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
    let chainId = state.currentChainKey ? getCurrentEvmChainIdHex() : null;
    if (!chainId && state.currentChainKey) {
      // 非 EVM 链（Tron 等）没有 numeric chainId → 返回当前 chainKey
      // 让 dApp/popup 自行按 chainKey 路由；不要 fallback 到 defaultConfig
      // 的 EVM chainId，否则会把 currentChainKey 强制改写成 EVM 形态，
      // 破坏 SWITCH_NETWORK 写入的目标链。
      return {
        success: true,
        network: {
          chainId: null,
          chainKey: state.currentChainKey,
          rpcUrl: state.currentRpcUrl,
        },
      };
    }
    if (!chainId) {
      const fallbackConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);
      chainId = fallbackConfig?.chainIdHex
        || (fallbackConfig?.chainId ? normalizeChainId(fallbackConfig.chainId) : null)
        || null;
      if (chainId) {
        setCurrentChainKey(chainIdToChainKey(chainId));
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
  const mpcAccountId = await resolveMpcAccountIdByAddress(address);
  if (mpcAccountId) return mpcAccountId;
  const accounts = await getAccountList();
  // family-aware 比较：每个 account 独立按 `namespace` 选比较语义；
  // Tron 账户的 address（T...）不再被 EVM lowercase 强行转换。
  const match = accounts.find(account => (
    compareAddresses(address, account?.address, account?.namespace || 'eip155')
  ));
  return match?.id || null;
}

async function handleSendTransactionMessage(data) {
  const {
    from, to, value, data: txData, gas, gasLimit, chainId, token,
    chainFamily, valueTrx, feeLimitSun, asset, rpcUrl
  } = data || {};
  if (!from || !to) {
    return { success: false, error: 'Invalid transaction params' };
  }

  // Tron 路径：valueTrx 是人类可读 TRX 数量，不强制 hex value；Solana 路径：
  // amountSol 人类可读 SOL 数量（lamports = amount × 1e9）；EVM 必须有 value
  const family = chainFamily === 'solana'
    ? 'solana'
    : (chainFamily === 'tron' ? 'tron' : 'eip155');
  if (family === 'tron') {
    if (!valueTrx || parseFloat(valueTrx) <= 0) {
      return { success: false, error: 'Invalid transaction params' };
    }
  } else if (family === 'solana') {
    if (!data?.amountSol || parseFloat(data.amountSol) <= 0) {
      return { success: false, error: 'Invalid transaction params' };
    }
  } else if (!value) {
    return { success: false, error: 'Invalid transaction params' };
  }

  const accountId = await resolveAccountIdByAddress(from);
  if (!accountId) {
    return { success: false, error: 'Account not found' };
  }

  try {
    // 统一构造 transaction 对象：Tron 路径带 type='native-transfer' +
    // amount(SUN 字符串)；signing-service 的 signTransactionRaw 在
    // tron:* chainKey 上切到 signTronTransactionLocal（走
    // /wallet/createtransaction + 本地 secp256k1 签名）；
    // EVM 路径仍走 ethers populateTransaction + signTransaction。
    const SUN_PER_TRX = 1_000_000n;
    const LAMPORTS_PER_SOL = 1_000_000_000n;
    const tx = family === 'tron'
      ? {
          type: 'native-transfer',
          chainFamily: 'tron',
          asset: asset || 'TRX',
          from,
          to,
          amount: String(BigInt(Math.floor(parseFloat(valueTrx) * 1e6)))
        }
      : family === 'solana'
        ? {
            type: 'native-transfer',
            chainFamily: 'solana',
            asset: 'SOL',
            from,
            to,
            amount: String(BigInt(Math.floor(parseFloat(data.amountSol) * 1e9)))
          }
        : (() => {
            const evmTx = {
              to,
              value,
              data: txData || '0x'
            };
            const limit = gasLimit || gas;
            if (limit) evmTx.gasLimit = limit;
            return evmTx;
          })();

    // 优先使用消息携带的 chainKey（popup 显式声明）；其次 fallback state。
    // Tron / Solana 路径各自有 family-specific 兜底：
    //   - tron:* → tron:mainnet
    //   - solana:* → solana:mainnet-beta
    // EVM 仍走 state.currentChainKey（保留 eip155:1）。
    const currentKey = state.currentChainKey || '';
    const chainKey = currentKey.startsWith('tron:')
      ? currentKey
      : currentKey.startsWith('solana:')
        ? currentKey
        : (family === 'tron'
            ? 'tron:mainnet'
            : (family === 'solana'
                ? 'solana:mainnet-beta'
                : (state.currentChainKey || 'eip155:1')));

    const rawTx = await signTransactionRaw(chainKey, accountId, tx);
    const txHash = await broadcastRawTransaction(chainKey, rawTx);
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
      value: family === 'tron'
        ? `${valueTrx} TRX`
        : (family === 'solana' ? `${data.amountSol} SOL` : value),
      token: token || null,
      timestamp: getTimestamp(),
      status: 'pending',
      chainId: normalizedChainId || (state.currentChainKey ? getCurrentEvmChainIdHex() : null)
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
  const targetChainId = chainIdOverride || (state.currentChainKey ? getCurrentEvmChainIdHex() : null);
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
    normalizedChainId = state.currentChainKey ? getCurrentEvmChainIdHex() : null;
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
    normalizedChainId = state.currentChainKey ? getCurrentEvmChainIdHex() : null;
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

    if (state.currentChainKey && getCurrentEvmChainIdHex() === normalizedChainId) {
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
  // ==================== Wallet identity ====================
  [WalletMessageType.IDENTITY_CREATE, async (data) => await handleCreateIdentity(data)],
  [WalletMessageType.IDENTITY_LIST, async () => await handleListIdentities()],
  [WalletMessageType.IDENTITY_GET, async (data) => await handleGetIdentity(data)],
  [WalletMessageType.IDENTITY_SELECT, async (data) => await handleSelectIdentity(data)],
  [WalletMessageType.IDENTITY_DELETE, async (data) => await handleDeleteIdentity(data)],
  [WalletMessageType.IDENTITY_EXPORT_DOCUMENT, async (data) => await handleExportIdentityDocument(data)],
  [WalletMessageType.IDENTITY_SIGN_DOCUMENT, async (data) => await handleSignIdentityDocument(data)],
  [WalletMessageType.IDENTITY_SIGN_ACTION, async (data) => await handleSignIdentityAction(data)],
  [WalletMessageType.IDENTITY_SAVE_CREDENTIALS, async (data) => await handleSaveIdentityCredentials(data)],
  [WalletMessageType.IDENTITY_LIST_CREDENTIALS, async (data) => await handleListIdentityCredentials(data)],
  [WalletMessageType.IDENTITY_VERIFICATION_REQUEST, async (data) => await handleRequestIdentityVerification(data)],
  [WalletMessageType.IDENTITY_VERIFICATION_CONFIRM, async (data) => await handleConfirmIdentityVerification(data)],
  // ==================== 钱包管理 ====================
  ['IS_WALLET_INITIALIZED', async () => await isWalletInitialized()],
  ['GET_ALL_WALLETS', async () => await HandleGetWalletList()],
  ['CREATE_HD_WALLET', async (data) => await handleCreateHDWallet(data.accountName, data.password)],
  ['CREATE_TRON_HD_WALLET', async (data) => await handleCreateTronHDWallet(data.accountName, data.password, data.options || {})],
  ['CREATE_SOLANA_HD_WALLET', async (data) => await handleCreateSolanaHDWallet(data.accountName, data.password, data.options || {})],
  ['IMPORT_HD_WALLET', async (data) => await handleImportHDWallet(data.accountName, data.mnemonic, data.password)],
  ['IMPORT_TRON_HD_WALLET', async (data) => await handleImportTronHDWallet(data.accountName, data.mnemonic, data.password, data.options || {})],
  ['IMPORT_SOLANA_HD_WALLET', async (data) => await handleImportSolanaHDWallet(data.accountName, data.mnemonic, data.password, data.options || {})],
  ['IMPORT_PRIVATE_KEY_WALLET', async (data) => await handleImportPrivateKeyWallet(data.accountName, data.privateKey, data.password)],
  ['IMPORT_TRON_PRIVATE_KEY_WALLET', async (data) => await handleImportTronPrivateKeyWallet(data.accountName, data.privateKey, data.password, data.options || {})],
  ['IMPORT_SOLANA_PRIVATE_KEY_WALLET', async (data) => await handleImportSolanaPrivateKeyWallet(data.accountName, data.privateKey, data.password, data.options || {})],
  ['CREATE_MPC_WALLET', async (data) => await handleCreateMpcWallet(data)],
  ['CREATE_SUB_ACCOUNT', async (data) => await handleCreateSubAccount(data.walletId, data.accountName, data.password)],
  ['CREATE_TRON_SUB_ACCOUNT', async (data) => await handleCreateTronSubAccount(data.walletId, data.password)],
  ['CREATE_SOLANA_SUB_ACCOUNT', async (data) => await handleCreateSolanaSubAccount(data.walletId, data.password, data.options || {})],
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
      chainId: state.currentChainKey ? getCurrentEvmChainIdHex() : null,
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
    return {
      success: true,
      chainId: state.currentChainKey ? getCurrentEvmChainIdHex() : null,
    };
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
        account: message.account || null,
        password: message.password || null
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
  [WalletMessageType.EXPORT_ACCOUNTS_FILE, async (data) => await handleExportAccountsFile(data?.password, data?.identityEndpoint)],
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
  [WalletMessageType.MPC_CANCEL_SESSION, async (data) => await handleMpcCancelSession(data)],
  [WalletMessageType.MPC_DELETE_WALLET, async (data) => await handleMpcDeleteWallet(data)],
  [WalletMessageType.MPC_LIST_INVITES, async (data) => await handleMpcListInvites(data)],
  [WalletMessageType.MPC_DISMISS_INVITE, async (data) => await handleMpcDismissInvite(data)],
  [WalletMessageType.MPC_ACCEPT_INVITE, async (data) => await handleMpcAcceptInvite(data)],
  [WalletMessageType.MPC_JOIN_SESSION, async (data) => await handleMpcJoinSession(data)],
  [WalletMessageType.MPC_START_KEYGEN, async (data) => await handleMpcStartKeygen(data)],
  [WalletMessageType.MPC_SEND_SESSION_MESSAGE, async (data) => await handleMpcSendSessionMessage(data)],
  [WalletMessageType.MPC_DECRYPT_MESSAGE, async (data) => await handleMpcDecryptMessage(data)],
  [WalletMessageType.MPC_FETCH_SESSION_MESSAGES, async (data) => await handleMpcFetchSessionMessages(data)],
  [WalletMessageType.MPC_LIST_SIGN_REQUESTS, async (data) => await handleMpcListSignRequests(data)],
  [WalletMessageType.MPC_PROCESS_PENDING_SIGN_REQUESTS, async (data) => await handleMpcProcessPendingSignRequests(data)],
  [WalletMessageType.MPC_GET_SESSION, async (data) => await handleMpcGetSession(data?.sessionId)],
  [WalletMessageType.MPC_GET_SESSIONS, async (data) => await handleMpcGetSessions(data)],
  [WalletMessageType.MPC_DIAGNOSE_WALLET, async (data) => await handleMpcDiagnoseWallet(data)],
  [WalletMessageType.MPC_PREPARE_WALLET_SIGNING, async (data) => await handleMpcPrepareWalletSigning(data)],
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
  [WalletMessageType.CUSTODY_LIST_SECRETS, async (data) => await handleListCustodySecrets(data)],
  [WalletMessageType.CUSTODY_GET_SECRET, async (data) => await handleGetCustodySecret(data)],
  [WalletMessageType.CUSTODY_RESTORE_SECRET, async (data) => await handleRestoreCustodySecret(data)],
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
  ['WALLET_RECOVERY_CALLBACK', async (data, context = {}) => {
    const senderUrl = String(context?.sender?.url || '');
    const extensionOrigin = `chrome-extension://${chrome.runtime.id}/`;
    if (!senderUrl.startsWith(extensionOrigin)) throw new Error('非法恢复回调来源');
    const callback = data || {};
    if (!callback.code || !callback.state) throw new Error('恢复回调参数不完整');
    await updateUserSetting('walletRecoveryCallback', {
      code: String(callback.code),
      state: String(callback.state),
      receivedAt: Date.now(),
      senderUrl
    });
    return { success: true };
  }],
  ['WALLET_RECOVERY_GET_CALLBACK', async () => ({
    success: true,
    callback: await getUserSetting('walletRecoveryCallback', null)
  })],
  ['WALLET_RECOVERY_CLEAR_CALLBACK', async () => {
    await updateUserSetting('walletRecoveryCallback', null);
    return { success: true };
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
      const signedTransaction = await signTransactionRaw(
        state.currentChainKey || 'eip155:1',
        account.id,
        data.transaction
      );
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
export async function handlePopupMessage(message, response, sender = {}) {
  const { type, data } = message;

  console.log('📨 Received popup message:', type);

  const handler = popupHandlers.get(type);
  if (!handler) {
    console.warn('⚠️ Unknown message type:', type);
    response({ success: false, error: 'Unknown message type' });
    return;
  }

  try {
    const result = await handler(data, { message, sender });
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
    handlePopupMessage(message, response, sender);
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
