/**
 * YeYing Wallet - RPC 调用处理
 * 负责：转发 RPC 请求到节点
 */

import { state } from './state.js';
import { createRpcError, createNetworkError } from '../common/errors/index.js';
import { DEFAULT_NETWORK } from '../config/index.js';
import { getNetworkByChainId, getNetworkConfigByKey } from '../storage/index.js';
import { getTimestamp } from '../common/utils/time-utils.js';

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
  const network = await getNetworkByChainId(state.currentChainId);
  let rpcUrl = state.currentRpcUrl || network?.rpcUrl || network?.rpc;
  if (!rpcUrl) {
    const fallbackConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);
    rpcUrl = fallbackConfig?.rpcUrl || fallbackConfig?.rpc || '';
  }
  if (!rpcUrl) {
    throw createNetworkError('RPC URL not configured');
  }
  console.log(`network=${JSON.stringify(network)}, rpcUrl=${rpcUrl}, method=${method}, params=${params}`)
  try {
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
    console.log(`Throw error ${error.message}`)
    if (error.code) throw error;
    throw createNetworkError(error.message);
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
