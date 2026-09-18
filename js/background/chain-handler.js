/**
 * YeYing Wallet - 链处理
 * 负责：切换链、获取链 ID
 */
import { EventType } from '../protocol/dapp-protocol.js';
import { state } from './state.js';
import { createInvalidParams, createUnrecognizedChainError } from '../common/errors/index.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import { DEFAULT_NETWORK } from '../config/index.js';
import { normalizeChainId } from '../common/chain/index.js';
import { validateNetworkConfig } from '../config/validation-rules.js';
import { saveSelectedNetworkName, getNetworkByChainId, getNetworkConfigByKey, addNetwork } from '../storage/index.js';
import { broadcastEvent } from './connection.js';
import {
  getCurrentEvmChainIdHex,
  getCurrentChainIdDecimal,
  setCurrentChainKey,
  chainIdToChainKey
} from '../chain/current-chain.js';

/**
 * EVM 协议入口守门：当钱包当前链是 `tron:*` 时，dApp 调用 eth_chainId /
 * net_version / wallet_switchEthereumChain 抛 EIP-1193 UNSUPPORTED_METHOD。
 *
 * 阶段 1（v1）：wallet 不在 Tron 链下响应 dApp 的 EVM 协议调用，避免
 * 把错误的 chainId 答回 dApp。
 */
function ensureEvmActive() {
  const chainKey = state.currentChainKey || '';
  if (chainKey.startsWith('tron:')) {
    const err = new Error('EVM dApp protocol is unavailable while Tron is active');
    err.code = ErrorCode.UNSUPPORTED_METHOD;
    throw err;
  }
}

/**
 * 处理 eth_chainId
 * @returns {string} 当前链 ID
 */
export function handleEthChainId() {
  ensureEvmActive();
  return getCurrentEvmChainIdHex();
}

/**
 * 处理 net_version
 * @returns {string} 当前链 ID（十进制）
 */
export function handleNetVersion() {
  ensureEvmActive();
  return getCurrentChainIdDecimal();
}

/**
 * 处理 wallet_switchEthereumChain
 * @param {Array} params - 参数 [{ chainId }]
 * @returns {Promise<null>}
 */
export async function handleSwitchChain(params) {
  ensureEvmActive();
  const [{ chainId }] = params;

  if (!chainId) {
    throw createInvalidParams('chainId is required');
  }

  const normalizedChainId = normalizeChainId(chainId);
  const network = await getNetworkByChainId(normalizedChainId);

  if (!network) {
    throw createUnrecognizedChainError(chainId);
  }

  const oldChainKey = state.currentChainKey;
  setCurrentChainKey(chainIdToChainKey(normalizedChainId));
  const newChainKey = state.currentChainKey;
  const rpcUrl = network?.rpcUrl || network?.rpc || null;
  if (rpcUrl) {
    state.currentRpcUrl = rpcUrl;
  }

  // 保存网络选择
  let networkName = network?.key || network?.id || null;
  if (!networkName) {
    const fallbackConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);
    if (fallbackConfig?.chainIdHex === normalizedChainId) {
      networkName = DEFAULT_NETWORK;
    } else {
      networkName = normalizedChainId;
    }
  }

  if (networkName) {
    await saveSelectedNetworkName(networkName);
  }

  // 如果链 ID 改变，广播事件
  if (oldChainKey !== newChainKey) {
    broadcastEvent(EventType.CHAIN_CHANGED, { chainId: normalizedChainId });
  }

  return null;
}

/**
 * 处理 wallet_addEthereumChain
 * @param {Array} params - 参数 [{ chainId, chainName, rpcUrls, nativeCurrency, blockExplorerUrls }]
 * @returns {Promise<null>}
 */
export async function handleAddEthereumChain(params) {
  const [chainInfo] = Array.isArray(params) ? params : [];

  if (!chainInfo || typeof chainInfo !== 'object') {
    throw createInvalidParams('Invalid chain parameters');
  }

  const { chainId, chainName, rpcUrls, nativeCurrency, blockExplorerUrls } = chainInfo;

  if (!chainId) {
    throw createInvalidParams('chainId is required');
  }

  if (!chainName) {
    throw createInvalidParams('chainName is required');
  }

  if (!Array.isArray(rpcUrls) || !rpcUrls[0]) {
    throw createInvalidParams('rpcUrls is required');
  }

  const rpcUrl = rpcUrls[0];
  const symbol = nativeCurrency?.symbol || chainInfo.symbol || 'ETH';
  const decimals = Number.isFinite(nativeCurrency?.decimals) ? nativeCurrency.decimals : 18;

  const validation = validateNetworkConfig({
    name: chainName,
    rpcUrl,
    chainId,
    symbol
  });

  if (!validation.valid) {
    throw createInvalidParams(validation.errors?.[0] || 'Invalid network params');
  }

  const normalizedChainId = normalizeChainId(chainId);
  let network = await getNetworkByChainId(normalizedChainId);

  if (!network) {
    await addNetwork({
      chainId: normalizedChainId,
      chainName,
      rpcUrl,
      explorer: Array.isArray(blockExplorerUrls) ? blockExplorerUrls[0] : '',
      symbol,
      decimals,
      nativeCurrency: nativeCurrency ? { ...nativeCurrency } : { name: chainName, symbol, decimals }
    });
  }

  await handleSwitchChain([{ chainId: normalizedChainId }]);
  return null;
}
