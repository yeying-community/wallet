/**
 * YeYing Wallet - 链处理
 * 负责：切换链、获取链 ID
 */
import { EventType } from '../protocol/protocol.js';
import { state } from './state.js';
import { createInvalidParams, createUnrecognizedChainError } from '../common/errors/index.js';
import { DEFAULT_NETWORK } from '../config/index.js';
import { normalizeChainId } from '../common/utils/index.js';
import { saveSelectedNetworkName, getNetworkByChainId, getNetworkConfigByKey } from '../storage/index.js';
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

  // 保存网络选择
  const networkName = network?.key || network?.id || null;
  if (!networkName) {
    const fallbackConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);
    if (fallbackConfig?.chainIdHex === normalizedChainId) {
      await saveSelectedNetworkName(DEFAULT_NETWORK);
    }
  } else {
    await saveSelectedNetworkName(networkName);
  }

  // 如果链 ID 改变，广播事件
  if (oldChainId !== normalizedChainId) {
    broadcastEvent(EventType.CHAIN_CHANGED, { chainId: normalizedChainId });
  }

  return null;
}
