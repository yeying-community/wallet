// @ts-check
/**
 * state.currentChainKey 访问器（CAIP-2）
 *
 * 集中读取/写入 state.currentChainKey：
 * - getCurrentChainKey() 永远返回合法 CAIP-2（空时给 eip155:1 兜底）
 * - setCurrentChainKey(chainKey) 写合法值，无效抛错
 * - getCurrentEvmChainIdHex() 派生对外 hex chainId（eth_chainId 等 RPC 必须）
 * - getCurrentChainIdDecimal() 派生对外十进制 chainId（net_version 等 RPC 必须）
 *
 * 阶段 0 Step 3：state.currentChainId → state.currentChainKey。旧 hex 字段名
 * 永久移除，外部协议（eth_chainId/net_version）通过派生 helper 保持逐字节不变。
 */

import { state } from '../background/state.js';
import {
  DEFAULT_CHAIN_KEY,
  chainKeyFromHex,
  chainKeyToHex,
  chainKeyToDecimal,
  namespaceOf
} from './chain-key.js';

/**
 * @returns {string} CAIP-2 chainKey（永不返回空）
 */
export function getCurrentChainKey() {
  const key = String(state.currentChainKey || '').trim();
  return key || DEFAULT_CHAIN_KEY;
}

/**
 * @param {string} chainKey CAIP-2（eip155:1 等）
 */
export function setCurrentChainKey(chainKey) {
  const key = String(chainKey || '').trim();
  if (!/^[a-z0-9-]+:[a-zA-Z0-9_-]+$/.test(key)) {
    throw new Error(`Invalid chainKey: ${chainKey}`);
  }
  state.currentChainKey = key;
}

/**
 * @param {string|number} chainId 接受 hex（含 0x）/十进制数字/串
 * @returns {string} CAIP-2
 */
export function chainIdToChainKey(chainId) {
  return chainKeyFromHex(String(chainId));
}

/**
 * 派生对外 hex chainId（eth_chainId）。
 * 非 EVM 链（Tron 等）没有 numeric chainId，返回 null；
 * 调用方应先看 namespaceOf(getCurrentChainKey()) === 'eip155'
 * 再调本函数，否则视为 EVM 不适用。
 * @returns {string|null}
 */
export function getCurrentEvmChainIdHex() {
  const key = getCurrentChainKey();
  if (namespaceOf(key) !== 'eip155') {
    return null;
  }
  return chainKeyToHex(key);
}

/**
 * 派生对外十进制 chainId 串（net_version）。非 EVM 返回 null。
 * @returns {string|null}
 */
export function getCurrentChainIdDecimal() {
  const key = getCurrentChainKey();
  if (namespaceOf(key) !== 'eip155') {
    return null;
  }
  return chainKeyToDecimal(key);
}