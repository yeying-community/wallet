/**
 * YeYing Wallet - 链处理
 * 负责：切换链、获取链 ID
 */
import { EventType } from '../protocol/dapp-protocol.js';
import { state } from './state.js';
import { createInvalidParams, createUnrecognizedChainError } from '../common/errors/index.js';
import { DEFAULT_NETWORK } from '../config/index.js';
import { normalizeChainId } from '../common/chain/index.js';
import { validateNetworkConfig } from '../config/validation-rules.js';
import { saveSelectedNetworkName, getNetworkByChainId, getNetworkConfigByKey, addNetwork } from '../storage/index.js';
import { broadcastEvent } from './connection.js';

/**
 * 处理 eth_chainId
 * @returns {string} 当前链 ID
 */
export function handleEthChainId() {
  return state.currentChainId;
}

/**
 * 处理 net_version
 * @returns {string} 当前链 ID（十进制）
 */
export function handleNetVersion() {
  return parseInt(state.currentChainId, 16).toString();
}

/**
 * 处理 wallet_switchEthereumChain
 * @param {Array} params - 参数 [{ chainId }]
 * @returns {Promise<null>}
 */
export async function handleSwitchChain(params) {
  const [{ chainId }] = params;

  if (!chainId) {
    throw createInvalidParams('chainId is required');
  }

  const normalizedChainId = normalizeChainId(chainId);
  const network = await getNetworkByChainId(normalizedChainId);

  if (!network) {
    throw createUnrecognizedChainError(chainId);
  }

  const oldChainId = state.currentChainId;
  state.currentChainId = normalizedChainId;
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
  if (oldChainId !== normalizedChainId) {
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
