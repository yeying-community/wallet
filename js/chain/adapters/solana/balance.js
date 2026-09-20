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
 * SPL Token 余额：`getTokenAccountsByOwner`（按 mint 过滤，jsonParsed 编码）
 * 累加该 owner 所有该 mint 的 token account 的 `tokenAmount.amount`（原始整数）。
 * 返回 `{ balance: '<decimal amount>' }`（十进制字符串，供上层 BigInt 解析）。
 *
 * @param {string} address owner base58 地址
 * @param {{address?: string, mint?: string}} token SPL mint（address 即 mint 地址）
 * @param {{ chainKey: string }} ctx
 * @returns {Promise<{ balance: string }>}
 */
export async function getTokenBalance(address, token, ctx) {
  const owner = String(address || '').trim();
  const mint = String(token?.address || token?.mint || '').trim();
  if (!owner || !mint) {
    throw new Error('Solana getTokenBalance: owner and mint required');
  }
  const result = await solanaRpcCall(ctx.chainKey, 'getTokenAccountsByOwner', [
    owner,
    { mint },
    { encoding: 'jsonParsed', commitment: 'confirmed' }
  ]);
  /** @type {any} */
  const r = result;
  const accounts = r?.value;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return { balance: '0' };
  }
  let total = 0n;
  for (const acc of accounts) {
    const amount = acc?.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (amount != null) {
      try { total += BigInt(String(amount)); } catch { /* skip malformed */ }
    }
  }
  return { balance: total.toString() };
}