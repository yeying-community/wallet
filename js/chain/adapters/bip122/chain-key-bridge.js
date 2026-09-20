// @ts-check
/**
 * Bitcoin (bip122) namespace 常量与轻量 helper（不依赖 ethers）
 *
 * 与 tron/solana chain-key-bridge 同构：只放常量 + 纯字符串 helper，
 * 让 chain-key.js 在不引 ethers 的情况下也能 import bip122 字面值。
 *
 * CAIP-2 形态：`bip122:<reference>`，reference ∈ { mainnet, testnet }。
 * （CAIP-2 官方 bip122 reference 是 genesis block hash 前 32 hex；wallet v1
 *  为可读性用 mainnet/testnet 别名，RPC 解析时映射到 Esplora endpoint。）
 */

export const BIP122_NAMESPACE = 'bip122';
export const BIP122_REFERENCE_MAINNET = 'mainnet';
export const BIP122_REFERENCE_TESTNET = 'testnet';

/** BTC SLIP-44 coin type = 0（testnet 派生用 1'，见 vault）。 */
export const BIP122_COIN_TYPE = 0;

/** 合法 bip122 reference 集合。 */
export const BIP122_REFERENCES = Object.freeze([
  BIP122_REFERENCE_MAINNET,
  BIP122_REFERENCE_TESTNET
]);

/** 校验是否是合法 bip122 reference。 */
export function isValidBip122Reference(value) {
  return BIP122_REFERENCES.includes(String(value || '').toLowerCase());
}

/**
 * 从网络配置对象派生 chainKey（`bip122:<reference>`）。
 * @param {{reference?: string}} net
 * @returns {string}
 */
export function chainKeyFromBip122Network(net) {
  const ref = String(net?.reference || '').toLowerCase();
  if (!ref) throw new Error('Bitcoin network config requires reference (mainnet/testnet)');
  if (!isValidBip122Reference(ref)) throw new Error(`Invalid bip122 reference: ${ref}`);
  return `${BIP122_NAMESPACE}:${ref}`;
}

/**
 * 解析 chainKey 为 reference。非法抛错。
 * @param {string} chainKey
 * @returns {string}
 */
export function bip122Reference(chainKey) {
  const key = String(chainKey || '').trim();
  const idx = key.indexOf(':');
  if (idx <= 0) throw new Error(`Invalid chainKey: ${chainKey}`);
  const ns = key.slice(0, idx);
  const ref = key.slice(idx + 1);
  if (ns !== BIP122_NAMESPACE) {
    throw new Error(`Unsupported chain namespace for bip122: ${chainKey}`);
  }
  if (!isValidBip122Reference(ref)) {
    throw new Error(`Invalid bip122 reference: ${ref}`);
  }
  return ref;
}

/** reference → bech32 HRP（mainnet 'bc' / testnet 'tb'）。 */
export function bip122Hrp(reference) {
  return reference === BIP122_REFERENCE_TESTNET ? 'tb' : 'bc';
}

/** reference → base58 P2PKH version byte（mainnet 0x00 / testnet 0x6f）。 */
export function bip122P2pkhVersion(reference) {
  return reference === BIP122_REFERENCE_TESTNET ? 0x6f : 0x00;
}

/** reference → base58 P2SH version byte（mainnet 0x05 / testnet 0xc4）。 */
export function bip122P2shVersion(reference) {
  return reference === BIP122_REFERENCE_TESTNET ? 0xc4 : 0x05;
}
