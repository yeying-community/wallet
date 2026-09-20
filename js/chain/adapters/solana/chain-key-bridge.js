// @ts-check
/**
 * Solana CAIP-2 bridge（与 tron/chain-key-bridge.js 同形态）
 *
 * namespace  = 'solana'  （CAIP-30）
 * reference  = 'mainnet-beta' | 'devnet' | 'testnet'
 * coinType   = 501 (SLIP-44)
 *
 * Solana addresses 是 base58(32-byte ed25519 pubkey)，无 checksum；序列化在
 * js/chain/adapters/solana/transaction.js / sysprog.js 内。
 */

export const SOLANA_NAMESPACE = 'solana';

export const SOLANA_REFERENCE_MAINNET = 'mainnet-beta';
export const SOLANA_REFERENCE_DEVNET = 'devnet';
export const SOLANA_REFERENCE_TESTNET = 'testnet';

export const SOLANA_REFERENCES = Object.freeze([
  SOLANA_REFERENCE_MAINNET,
  SOLANA_REFERENCE_DEVNET,
  SOLANA_REFERENCE_TESTNET
]);

export const SOLANA_COIN_TYPE = 501;

/**
 * 是否合法的 Solana reference。
 * @param {string} ref
 * @returns {boolean}
 */
export function isValidSolanaReference(ref) {
  return SOLANA_REFERENCES.includes(String(ref || '').toLowerCase());
}

/**
 * 从 network config 派生 chainKey（CAIP-2：`solana:<reference>`）。
 * @param {{ reference?: string }} [net]
 * @returns {string}
 */
export function chainKeyFromSolanaNetwork(net) {
  const ref = String(net?.reference || SOLANA_REFERENCE_MAINNET).toLowerCase();
  if (!isValidSolanaReference(ref)) {
    throw new Error(`Invalid Solana reference: ${ref}`);
  }
  return `${SOLANA_NAMESPACE}:${ref}`;
}

/**
 * 从 chainKey 取 Solana reference（如 `solana:mainnet-beta` → `mainnet-beta`）。
 * @param {string} chainKey
 * @returns {string|null}
 */
export function solanaReference(chainKey) {
  const k = String(chainKey || '');
  if (!k.startsWith(`${SOLANA_NAMESPACE}:`)) return null;
  const ref = k.slice(SOLANA_NAMESPACE.length + 1);
  return isValidSolanaReference(ref) ? ref : null;
}