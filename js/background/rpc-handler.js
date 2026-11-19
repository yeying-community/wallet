/**
 * YeYing Wallet - RPC 调用处理
 * 负责：转发 RPC 请求到节点
 */

import { state } from './state.js';
import { createRpcError, createNetworkError, createError } from '../common/errors/index.js';
import { DEFAULT_EVM_NETWORK } from '../config/index.js';
import { getNetworkByChainId, getNetworkConfigByKey } from '../storage/index.js';
import { getTimestamp } from '../common/utils/time-utils.js';
import { diagnostics } from './diagnostics.js';
import { RPC_CONFIG } from '../config/index.js';
import { getCurrentEvmChainIdHex, getCurrentChainKey } from '../chain/current-chain.js';
import { isEvmChainKey } from '../chain/chain-key.js';

/**
 * 处理 RPC 方法
 * @param {string} method - RPC 方法名
 * @param {Array} params - 参数
 * @returns {Promise<any>} RPC 结果
 */
export async function handleRpcMethod(method, params) {
  return rpcCall(method, params);
}

/**
 * RPC 调用
 * @param {string} method - RPC 方法名
 * @param {Array} params - 参数
 * @returns {Promise<any>} RPC 结果
 */
async function rpcCall(method, params) {
  // 只有 EVM 链有以太坊 JSON-RPC。当前是知行图 / Tron / Solana / Bitcoin 时不转发,
  // 否则会把 JSON-RPC 发到那条链的接口(例如知行图的 REST API)上。
  if (!isEvmChainKey(getCurrentChainKey())) {
    throw createError(4901, `EVM RPC is not available on the current network (${getCurrentChainKey()}); switch to an EVM network`);
  }
  const network = await getNetworkByChainId(getCurrentEvmChainIdHex());
  let rpcUrl = state.currentRpcUrl || network?.rpcUrl || network?.rpc;
  if (!rpcUrl) {
    const fallbackConfig = await getNetworkConfigByKey(DEFAULT_EVM_NETWORK);
    rpcUrl = fallbackConfig?.rpcUrl || fallbackConfig?.rpc || '';
  }
  if (!rpcUrl) {
    throw createNetworkError('RPC URL not configured');
  }
  console.log(`network=${JSON.stringify(network)}, rpcUrl=${rpcUrl}, method=${method}, params=${params}`)
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), RPC_CONFIG.TIMEOUT);
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortController.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: getTimestamp(),
        method,
        params
      })
    });

    if (!response.ok) {
      console.log(`HTTP ${response.status}`)
      throw createRpcError(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      console.log(`Error ${data.error.message}`)
      throw createRpcError(data.error.message || 'RPC error', data.error);
    }

    console.log(`[RPC] result ${method}: ${formatRpcLog(data.result)}`);
    return data.result;
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? `RPC request timed out after ${RPC_CONFIG.TIMEOUT}ms`
      : error.message;
    console.log(`Throw error ${message}`)
    diagnostics.record({ category: 'rpc', level: 'error', action: method, message: message || 'rpc failed', meta: { method, code: error?.code } });
    if (error.code) throw error;
    throw createNetworkError(message);
  } finally {
    clearTimeout(timeoutId);
  }
}

function formatRpcLog(result, maxLength = 300) {
  if (result === null || result === undefined) return 'null';
  let text;
  if (typeof result === 'string') {
    text = result;
  } else {
    try {
      text = JSON.stringify(result);
    } catch {
      text = String(result);
    }
  }
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}
