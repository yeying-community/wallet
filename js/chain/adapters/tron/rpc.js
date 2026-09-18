// @ts-check
/**
 * Tron RPC 解析 + 调用（TronGrid 风格的 HTTP API，非 JSON-RPC）
 *
 * Tron 网络通过 `state.currentRpcUrl` 覆盖 → 用户提供的「net.tronRpcUrl」→ 默认网络
 * `tronMainnet` 兜底 → 无则抛错。`/wallet/getnowblock`、`/wallet/broadcasttransaction`
 * 等都走 POST application/json。
 *
 * 解析逻辑与 EVM `resolveEvmRpcUrl` 形态对称，但调用路径不同（无 method/params，
 * 只有一个 endpoint+body）。
 */

import { state } from '../../../background/state.js';
import { getNetworkConfigByKey } from '../../../storage/index.js';
import {
  TRON_NAMESPACE,
  TRON_REFERENCE_MAINNET,
  TRON_REFERENCE_SHASTA,
  TRON_REFERENCE_NILE,
  isValidTronReference,
  tronReference
} from './chain-key-bridge.js';

// 默认网络配置 key（与 network-config.js 中的 NETWORKS 条目一致；Step 4 注册时对齐）
const TRON_DEFAULT_NETWORK_KEYS = Object.freeze({
  [TRON_REFERENCE_MAINNET]: 'tronMainnet',
  [TRON_REFERENCE_SHASTA]: 'tronShasta',
  [TRON_REFERENCE_NILE]: 'tronNile'
});

/**
 * 当 chainKey 找不到内置网络时，回退到 reference 特定的 TronGrid URL。
 * 用于 Step 4 之前 / e2e 测试场景下的纯默认兜底。
 */
const TRON_REFERENCE_FALLBACK_URL = Object.freeze({
  [TRON_REFERENCE_MAINNET]: 'https://api.trongrid.io',
  [TRON_REFERENCE_SHASTA]: 'https://api.shasta.trongrid.io',
  [TRON_REFERENCE_NILE]: 'https://api.nile.trongrid.io'
});

/**
 * 解析给定 Tron chainKey 的 RPC base URL。
 * @param {string} chainKey 形如 `tron:mainnet`
 * @returns {Promise<string>}
 */
export async function resolveTronRpcUrl(chainKey) {
  const ref = tronReference(chainKey);
  let rpcUrl = '';
  // 1. 用户当前覆盖（最优先）
  if (state.currentRpcUrl) rpcUrl = state.currentRpcUrl;
  // 2. 该 reference 的内置网络
  if (!rpcUrl) {
    const netKey = TRON_DEFAULT_NETWORK_KEYS[ref];
    const net = await getNetworkConfigByKey(netKey);
    rpcUrl = net?.tronRpcUrl || net?.rpcUrl || net?.rpc || '';
  }
  // 3. 内置兜底（reference 特定 TronGrid URL）
  if (!rpcUrl) {
    rpcUrl = TRON_REFERENCE_FALLBACK_URL[ref] || '';
  }
  if (!rpcUrl) {
    throw new Error('Tron RPC URL not configured');
  }
  return rpcUrl;
}

/**
 * 对 Tron RPC 发一次 POST，返回响应 JSON 中 `result` 字段（或整个 body）。
 *
 * @param {string} chainKey 形如 `tron:mainnet`
 * @param {string} endpoint 例如 `/wallet/getnowblock`
 * @param {Object} body
 * @returns {Promise<*>}
 */
export async function tronRpcCall(chainKey, endpoint, body = {}) {
  const base = await resolveTronRpcUrl(chainKey);
  const url = joinUrl(base, endpoint);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new Error(`Tron RPC network error (${endpoint}): ${err?.message || err}`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(`Tron RPC HTTP ${response.status} (${endpoint})`);
  }
  return payload;
}

/**
 * 解析链族的默认网络 key。
 * @param {string} chainKey
 * @returns {string}
 */
export function tronDefaultNetworkKey(chainKey) {
  const ref = tronReference(chainKey);
  return TRON_DEFAULT_NETWORK_KEYS[ref];
}

/**
 * @param {string} base
 * @param {string} endpoint
 * @returns {string}
 */
function joinUrl(base, endpoint) {
  if (!base) return endpoint;
  if (base.endsWith('/') && endpoint.startsWith('/')) return base + endpoint.slice(1);
  if (!base.endsWith('/') && !endpoint.startsWith('/')) return `${base}/${endpoint}`;
  return base + endpoint;
}

export { TRON_DEFAULT_NETWORK_KEYS };