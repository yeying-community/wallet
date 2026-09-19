// @ts-check
/**
 * Solana native SOL 余额
 *
 * getNativeBalance(addr, ctx) → { balance: '<lamports>' }
 *   调 RPC `getBalance`，单位 lamports（1 SOL = 1_000_000_000 lamports）。
 *
 * getTokenBalance: v1 不实现（Phase 3 走 SPL Token program）。
 */

import { solanaRpcCall } from './rpc.js';

const NOT_IMPLEMENTED = 'CHAIN_ADAPTER_NOT_IMPLEMENTED';

/**
 * @param {string} address
 * @param {{ chainKey: string }} ctx
 * @returns {Promise<{ balance: string }>}
 */
export async function getNativeBalance(address, ctx) {
  if (!address || typeof address !== 'string') {
    throw new Error('Solana getNativeBalance: address required');
  }
  const result = await solanaRpcCall(ctx.chainKey, 'getBalance', [address]);
  // result: { context: { slot }, value: <lamports number> }
  /** @type {any} */
  const r = result;
  const lamports = r?.value ?? 0;
  return { balance: String(lamports) };
}

/**
 * SPL Token 余额（v1 未实现，留 Phase 3）
 */
export async function getTokenBalance(_address, _token, _ctx) {
  throw new Error(`${NOT_IMPLEMENTED}: SPL token balance (deferred to Phase 3)`);
}