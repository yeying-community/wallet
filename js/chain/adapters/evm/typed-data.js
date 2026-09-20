// @ts-check
/**
 * EVM EIP-712 typed data 归一化（从 signing.js 忠实搬迁）
 *
 * 语义与旧 normalizeTypedData 逐字节一致：domain.chainId 字符串（hex/十进制）→ number，
 * 删除 types.EIP712Domain（ethers 会自行推导），value 缺省为 {}。
 */

/**
 * @param {Object} [domain]
 * @param {Object} [types]
 * @param {Object} [value]
 * @returns {{domain: Object, types: Object, value: Object}}
 */
export function normalizeTypedData(domain, types, value) {
  const normalizedDomain = { ...(domain || {}) };
  if (normalizedDomain.chainId) {
    if (typeof normalizedDomain.chainId === 'string') {
      const parsed = normalizedDomain.chainId.startsWith('0x')
        ? parseInt(normalizedDomain.chainId, 16)
        : parseInt(normalizedDomain.chainId, 10);
      if (!Number.isNaN(parsed)) {
        normalizedDomain.chainId = parsed;
      }
    }
  }

  const normalizedTypes = { ...(types || {}) };
  if (normalizedTypes.EIP712Domain) {
    delete normalizedTypes.EIP712Domain;
  }

  return {
    domain: normalizedDomain,
    types: normalizedTypes,
    value: value || {}
  };
}
