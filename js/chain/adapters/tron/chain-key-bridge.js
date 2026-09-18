// @ts-check
/**
 * Tron namespace 常量与轻量 helper（不依赖 ethers）
 *
 * 这个模块刻意只放常量和纯字符串 helper，让 chain-key.js 在不引入 ethers
 * 库的情况下也能 import Tron namespace 字面值。重的派生逻辑（pubkey → 地址）
 * 留在 `./address.js`，由 Tron adapter 单独引用。
 */

export const TRON_NAMESPACE = 'tron';
export const TRON_REFERENCE_MAINNET = 'mainnet';
export const TRON_REFERENCE_SHASTA = 'shasta';
export const TRON_REFERENCE_NILE = 'nile';

/** 合法 Tron reference 字面值集合（mainnet / shasta / nile） */
export const TRON_REFERENCES = Object.freeze([
  TRON_REFERENCE_MAINNET,
  TRON_REFERENCE_SHASTA,
  TRON_REFERENCE_NILE
]);

/** 校验是否是合法 Tron reference。 */
export function isValidTronReference(value) {
  return TRON_REFERENCES.includes(String(value || '').toLowerCase());
}

/**
 * 从网络配置对象派生 chainKey（`tron:<reference>`）。
 * 抛出在 reference 缺失或非法时。
 * @param {{reference?: string}} net
 * @returns {string}
 */
export function chainKeyFromTronNetwork(net) {
  const ref = String(net?.reference || '').toLowerCase();
  if (!ref) throw new Error('Tron network config requires reference (mainnet/shasta/nile)');
  if (!isValidTronReference(ref)) throw new Error(`Invalid tron reference: ${ref}`);
  return `${TRON_NAMESPACE}:${ref}`;
}

/**
 * 解析 chainKey 为 reference。chainKey 必须是合法 `tron:<mainnet|shasta|nile>`，否则抛错。
 * @param {string} chainKey
 * @returns {string}
 */
export function tronReference(chainKey) {
  const key = String(chainKey || '').trim();
  const idx = key.indexOf(':');
  if (idx <= 0) throw new Error(`Invalid chainKey: ${chainKey}`);
  const ns = key.slice(0, idx);
  const ref = key.slice(idx + 1);
  if (ns !== TRON_NAMESPACE) {
    throw new Error(`Unsupported chain namespace for tron: ${chainKey}`);
  }
  if (!isValidTronReference(ref)) {
    throw new Error(`Invalid tron reference: ${ref}`);
  }
  return ref;
}