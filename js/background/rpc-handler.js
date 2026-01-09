/**
 * YeYing Wallet - RPC 调用处理
 * 负责：转发 RPC 请求到节点
 */

import { state } from './state.js';
import { createRpcError, createNetworkError } from '../common/errors/index.js';
import { DEFAULT_NETWORK } from '../config/index.js';
import { getNetworkByChainId, getNetworkConfigByKey } from '../storage/index.js';

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
        id: Date.now(),
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

    return data.result;
  } catch (error) {
    console.log(`Throw error ${error.message}`)
    if (error.code) throw error;
    throw createNetworkError(error.message);
  }
}
