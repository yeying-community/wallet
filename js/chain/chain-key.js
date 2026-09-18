// @ts-check
/**
 * CAIP-2 chainKey 转换（纯函数，零依赖）
 *
 * chainKey 采用 CAIP-2 形式：`<namespace>:<reference>`，阶段 0 仅支持 EVM 命名空间
 * `eip155`，reference 为十进制 chainId（如 `eip155:1`、`eip155:5432`）。
 *
 * 这是 `state.currentChainKey`（CAIP-2）与对外 EVM 协议所需 hex/十进制 chainId 之间
 * 的唯一转换收敛点——所有需要 hex 的旧读点都应经由此处，避免格式散落。
 */

export const DEFAULT_NAMESPACE = 'eip155';
export const DEFAULT_COIN_TYPE = 60;

/**
 * 从网络配置对象派生 chainKey。
 * @param {{chainId?: string|number}} net
 * @returns {string} 形如 `eip155:1`
 */
export function chainKeyFromNetwork(net) {
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
