// @ts-check
/**
 * Bitcoin RPC 解析 + 调用（Esplora REST API，非 JSON-RPC）
 *
 * Esplora（blockstream.info / mempool.space 同款开源后端）用 RESTful path：
 *   GET  /address/{addr}/utxo      → UTXO 列表
 *   GET  /address/{addr}           → chain_stats / mempool_stats（余额）
 *   GET  /fee-estimates            → { "1": sat/vB, "6": ..., ... }
 *   POST /tx  (body = raw tx hex)  → txid（纯文本）
 *
 * URL 解析优先级与 tron/rpc.js 对称：state.currentRpcUrl 覆盖 → 内置网络配置 →
 * reference 特定 Esplora 兜底。
 */

import { state } from '../../../background/state.js';
import { getNetworkConfigByKey } from '../../../storage/index.js';
import {
  BIP122_REFERENCE_MAINNET,
  BIP122_REFERENCE_TESTNET,
  bip122Reference
} from './chain-key-bridge.js';

const BIP122_DEFAULT_NETWORK_KEYS = Object.freeze({
  [BIP122_REFERENCE_MAINNET]: 'bitcoinMainnet',
  [BIP122_REFERENCE_TESTNET]: 'bitcoinTestnet'
});

const BIP122_REFERENCE_FALLBACK_URL = Object.freeze({
  [BIP122_REFERENCE_MAINNET]: 'https://blockstream.info/api',
  [BIP122_REFERENCE_TESTNET]: 'https://blockstream.info/testnet/api'
});

/**
 * 解析给定 bip122 chainKey 的 Esplora base URL。
 * @param {string} chainKey 形如 `bip122:mainnet`
 * @returns {Promise<string>}
 */
export async function resolveBip122RpcUrl(chainKey) {
  const ref = bip122Reference(chainKey);
  let rpcUrl = '';
  if (state.currentRpcUrl) rpcUrl = state.currentRpcUrl;
  if (!rpcUrl) {
    const netKey = BIP122_DEFAULT_NETWORK_KEYS[ref];
    const net = await getNetworkConfigByKey(netKey);
    rpcUrl = net?.bitcoinRpcUrl || net?.esploraUrl || net?.rpcUrl || net?.rpc || '';
  }
  if (!rpcUrl) rpcUrl = BIP122_REFERENCE_FALLBACK_URL[ref] || '';
  if (!rpcUrl) throw new Error('Bitcoin RPC URL not configured');
  return rpcUrl.replace(/\/$/, '');
}

/**
 * 对 Esplora 发一次 GET，返回解析后的 JSON。
 * @param {string} chainKey
 * @param {string} path 例如 `/address/bc1.../utxo`
 * @returns {Promise<*>}
 */
export async function bip122RpcGet(chainKey, path) {
  const base = await resolveBip122RpcUrl(chainKey);
  let response;
  try {
    response = await fetch(`${base}${path}`);
  } catch (err) {
    throw new Error(`Bitcoin RPC network error (${path}): ${err?.message || err}`);
  }
  if (!response.ok) {
    throw new Error(`Bitcoin RPC HTTP ${response.status} (${path})`);
  }
  return response.json();
}

/**
 * 广播 raw tx（hex）。返回 txid（纯文本 hex）。
 * @param {string} chainKey
 * @param {string} rawTxHex
 * @returns {Promise<string>}
 */
export async function bip122Broadcast(chainKey, rawTxHex) {
  const base = await resolveBip122RpcUrl(chainKey);
  let response;
  try {
    response = await fetch(`${base}/tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: String(rawTxHex || '').trim()
    });
  } catch (err) {
    throw new Error(`Bitcoin broadcast network error: ${err?.message || err}`);
  }
  const text = (await response.text()).trim();
  if (!response.ok) {
    throw new Error(`Bitcoin broadcast HTTP ${response.status}: ${text}`);
  }
  return text;
}

/**
 * 取 fee rate（sat/vB）。Esplora /fee-estimates 返回 { "<target>": sat/vB }。
 * 取 6 区块目标；失败兜底 10 sat/vB。
 * @param {string} chainKey
 * @returns {Promise<number>}
 */
export async function getFeeRate(chainKey) {
  try {
    const estimates = await bip122RpcGet(chainKey, '/fee-estimates');
    const rate = Number(estimates?.['6'] ?? estimates?.['3'] ?? estimates?.['1']);
    if (Number.isFinite(rate) && rate > 0) return Math.ceil(rate);
  } catch {
    // 忽略，走兜底
  }
  return 10;
}

export { BIP122_DEFAULT_NETWORK_KEYS };
