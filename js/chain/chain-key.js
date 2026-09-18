// @ts-check
/**
 * CAIP-2 chainKey 转换（纯函数，零依赖）
 *
 * chainKey 采用 CAIP-2 形式：`<namespace>:<reference>`。
 * 阶段 0 仅 EVM 命名空间 `eip155`，reference 为十进制 chainId（如 `eip155:1`、`eip155:5432`）。
 * 阶段 1+ 加入 Tron 命名空间 `tron`，reference 为 `mainnet|shasta|nile`。
 *
 * 这是 `state.currentChainKey`（CAIP-2）与对外 EVM 协议所需 hex/十进制 chainId 之间
 * 的唯一转换收敛点——所有需要 hex 的旧读点都应经由此处，避免格式散落。
 */

import {
  TRON_NAMESPACE,
  TRON_REFERENCE_MAINNET,
  TRON_REFERENCE_SHASTA,
  TRON_REFERENCE_NILE,
  chainKeyFromTronNetwork,
  tronReference
} from './adapters/tron/chain-key-bridge.js';

export const DEFAULT_NAMESPACE = 'eip155';
export const DEFAULT_COIN_TYPE = 60;

/**
 * 默认 chainKey（首启动、currentChainKey 为空时兜底）。阶段 0 固定 `eip155:1`。
 */
export const DEFAULT_CHAIN_KEY = `${DEFAULT_NAMESPACE}:1`;

/**
 * 从网络配置对象派生 chainKey。
 * 支持 `net.namespace === 'tron'` 走 `tron:<reference>` 形式。
 * @param {{chainId?: string|number, namespace?: string, reference?: string}} net
 * @returns {string} 形如 `eip155:1` / `tron:mainnet`
 */
export function chainKeyFromNetwork(net) {
  const ns = String(net?.namespace || '').toLowerCase();
  if (ns === TRON_NAMESPACE) {
    return chainKeyFromTronNetwork(net);
  }
  const decimal = toDecimalChainId(net?.chainId);
  return `${DEFAULT_NAMESPACE}:${decimal}`;
}

/**
 * hex chainId（如 `0x1`）→ chainKey（如 `eip155:1`）。
 * @param {string} hex
 * @param {string} [namespace]
 * @returns {string}
 */
export function chainKeyFromHex(hex, namespace = DEFAULT_NAMESPACE) {
  const raw = String(hex || '').trim();
  const decimal = raw.toLowerCase().startsWith('0x')
    ? parseInt(raw, 16)
    : parseInt(raw, 10);
  if (!Number.isInteger(decimal) || decimal < 0) {
    throw new Error(`Invalid hex chainId: ${hex}`);
  }
  return `${namespace}:${decimal}`;
}

/**
 * chainKey → hex chainId（如 `eip155:1` → `0x1`）。仅支持 eip155。
 * @param {string} chainKey
 * @returns {string}
 */
export function chainKeyToHex(chainKey) {
  const decimal = evmReference(chainKey);
  return `0x${decimal.toString(16)}`;
}

/**
 * chainKey → 十进制 chainId 字符串（如 `eip155:1` → `1`）。仅支持 eip155。
 * @param {string} chainKey
 * @returns {string}
 */
export function chainKeyToDecimal(chainKey) {
  return String(evmReference(chainKey));
}

/**
 * 提取 chainKey 的命名空间部分。
 * @param {string} chainKey
 * @returns {string}
 */
export function namespaceOf(chainKey) {
  const key = String(chainKey || '').trim();
  const idx = key.indexOf(':');
  return idx > 0 ? key.slice(0, idx) : '';
}

/**
 * 提取 chainKey 的 reference 部分（如 `eip155:1` → `1`；`tron:mainnet` → `mainnet`）。
 * @param {string} chainKey
 * @returns {string}
 */
export function referenceOf(chainKey) {
  const key = String(chainKey || '').trim();
  const idx = key.indexOf(':');
  return idx > 0 ? key.slice(idx + 1) : '';
}

/**
 * 校验 EVM chainKey 并返回其十进制 reference。非 eip155 抛错（阶段 0 仅支持 EVM）。
 * @param {string} chainKey
 * @returns {number}
 */
function evmReference(chainKey) {
  const key = String(chainKey || '').trim();
  const ns = namespaceOf(key);
  if (ns !== DEFAULT_NAMESPACE) {
    throw new Error(`Unsupported chain namespace: ${chainKey}`);
  }
  const decimal = parseInt(key.slice(ns.length + 1), 10);
  if (!Number.isInteger(decimal) || decimal < 0) {
    throw new Error(`Invalid chainKey: ${chainKey}`);
  }
  return decimal;
}

/**
 * @param {string|number|undefined} chainId
 * @returns {number}
 */
function toDecimalChainId(chainId) {
  if (typeof chainId === 'number') {
    if (!Number.isInteger(chainId) || chainId < 0) {
      throw new Error(`Invalid chainId: ${chainId}`);
    }
    return chainId;
  }
  const raw = String(chainId ?? '').trim();
  const decimal = raw.toLowerCase().startsWith('0x')
    ? parseInt(raw, 16)
    : parseInt(raw, 10);
  if (!Number.isInteger(decimal) || decimal < 0) {
    throw new Error(`Invalid chainId: ${chainId}`);
  }
  return decimal;
}

// 重新导出 Tron namespace 常量，方便调用方直接 `import { TRON_NAMESPACE } from 'chain-key.js'`。
export {
  TRON_NAMESPACE,
  TRON_REFERENCE_MAINNET,
  TRON_REFERENCE_SHASTA,
  TRON_REFERENCE_NILE,
  chainKeyFromTronNetwork,
  tronReference
};
