// @ts-check
/**
 * Solana JSON-RPC 客户端（fetch HTTPS → Solana RPC nodes）
 *
 * v1：直接调用原生 solana RPC（https://api.mainnet-beta.solana.com 等）；
 *       不做缓存、不做重试——popup 路径一次 RPC 一个请求。
 * 返回 JSON-RPC result 字段（response.error 已抛错）。
 */

import {
  SOLANA_REFERENCE_MAINNET,
  SOLANA_REFERENCE_DEVNET,
  SOLANA_REFERENCE_TESTNET,
  solanaReference
} from './chain-key-bridge.js';

const SOLANA_RPC_URLS = Object.freeze({
  [SOLANA_REFERENCE_MAINNET]: 'https://api.mainnet-beta.solana.com',
  [SOLANA_REFERENCE_DEVNET]: 'https://api.devnet.solana.com',
  [SOLANA_REFERENCE_TESTNET]: 'https://api.testnet.solana.com'
});

/**
 * 从 chainKey 取 RPC URL。
 * @param {string} chainKey
 * @returns {string}
 */
export function resolveSolanaRpcUrl(chainKey) {
  const ref = solanaReference(chainKey);
  if (!ref) throw new Error(`resolveSolanaRpcUrl: invalid chainKey ${chainKey}`);
  const url = SOLANA_RPC_URLS[ref];
  if (!url) throw new Error(`resolveSolanaRpcUrl: unknown reference ${ref}`);
  return url;
}

/**
 * 调用 Solana JSON-RPC。
 * @param {string} chainKey
 * @param {string} method JSON-RPC method
 * @param {unknown[]} [params]
 * @returns {Promise<unknown>}
 */
export async function solanaRpcCall(chainKey, method, params = []) {
  const url = resolveSolanaRpcUrl(chainKey);
  const id = Math.random().toString(36).slice(2, 10);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
    });
  } catch (error) {
    throw new Error(`solanaRpcCall(${method}): network error ${error?.message || error}`);
  }
  if (!resp.ok) {
    throw new Error(`solanaRpcCall(${method}): HTTP ${resp.status}`);
  }
  let body;
  try {
    body = await resp.json();
  } catch {
    throw new Error(`solanaRpcCall(${method}): invalid JSON response`);
  }
  if (body && typeof body === 'object' && body.error) {
    const err = body.error;
    const msg = err?.message || JSON.stringify(err);
    throw new Error(`solanaRpcCall(${method}): ${msg}`);
  }
  return body?.result;
}