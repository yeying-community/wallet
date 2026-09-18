// @ts-check
/**
 * EVM RPC 层：rpcUrl 解析 + JSON-RPC 调用（收敛 rpc-handler / request-router / signing 三处重复）
 *
 * resolveEvmRpcUrl(chainKey) 复刻原三处逐字节一致的解析顺序：
 *   state.currentRpcUrl → 该链 network.rpcUrl/rpc → DEFAULT_NETWORK 兜底 → 无则抛错。
 * 阶段 0 Step 2 为新增，调用方切换在 Step 4；此前 evm 适配器的 broadcast/余额已用它。
 */

import { state } from '../../../background/state.js';
import { getNetworkByChainId, getNetworkConfigByKey } from '../../../storage/index.js';
import { DEFAULT_NETWORK } from '../../../config/index.js';
import { getTimestamp } from '../../../common/utils/time-utils.js';
import { chainKeyToHex } from '../../chain-key.js';

/**
 * 解析给定 chainKey 的 EVM rpcUrl。
 * @param {string} chainKey CAIP-2，如 eip155:1
 * @returns {Promise<string>}
 */
export async function resolveEvmRpcUrl(chainKey) {
  const chainIdHex = chainKeyToHex(chainKey);
  const network = await getNetworkByChainId(chainIdHex);
  let rpcUrl = state.currentRpcUrl || network?.rpcUrl || network?.rpc;
  if (!rpcUrl) {
    const fallbackConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);
    rpcUrl = fallbackConfig?.rpcUrl || fallbackConfig?.rpc || '';
  }
  if (!rpcUrl) {
    throw new Error('RPC URL not configured');
  }
  return rpcUrl;
}

/**
 * 对给定 chainKey 的 rpcUrl 发一次 JSON-RPC 调用，返回 result（error 抛出）。
 * @param {string} chainKey
 * @param {string} method
 * @param {Array<*>} params
 * @returns {Promise<*>}
 */
export async function evmRpcCall(chainKey, method, params) {
  const rpcUrl = await resolveEvmRpcUrl(chainKey);
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
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message || `RPC error: HTTP ${response.status}`);
  }
  return payload?.result;
}
