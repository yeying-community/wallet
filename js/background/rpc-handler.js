/**
 * YeYing Wallet - RPC 调用处理
 * 负责：转发 RPC 请求到节点
 */

import { state } from './state.js';
import { createRpcError, createNetworkError } from '../common/errors/index.js';
import { getNetworkByChainId, NETWORKS, DEFAULT_NETWORK } from '../config/index.js';

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
  const network = getNetworkByChainId(state.currentChainId);
  const rpcUrl = state.currentRpcUrl || network?.rpcUrl || network?.rpc || NETWORKS[DEFAULT_NETWORK].rpc;
  console.log(`network=${network}, rpcUrl=${rpcUrl}, method=${method}, params=${params}`)
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
      throw createRpcError(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw createRpcError(data.error.message || 'RPC error', data.error);
    }

    return data.result;
  } catch (error) {
    if (error.code) throw error;
    throw createNetworkError(error.message);
  }
}
