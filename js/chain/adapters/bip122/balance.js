// @ts-check
/**
 * Bitcoin 原生币（BTC）余额查询
 *
 * Esplora `/address/{addr}` 返回 chain_stats / mempool_stats：
 *   confirmed balance = chain_stats.funded_txo_sum - chain_stats.spent_txo_sum
 * 单位 satoshi。返回 `{ balance: '0x<hex sat>' }`（与 EVM/Tron 形态对齐）。
 */

import { bip122RpcGet } from './rpc.js';

/**
 * @param {string} address Bitcoin 地址
 * @param {import('../../types.d.ts').ChainCtx} ctx
 * @returns {Promise<{balance: string}>}
 */
export async function getNativeBalance(address, ctx) {
  const raw = String(address || '').trim();
  if (!raw) throw new Error('Bitcoin getNativeBalance: missing address');
  const info = await bip122RpcGet(ctx.chainKey, `/address/${raw}`);
  if (!info || typeof info !== 'object') return { balance: '0x0' };
  const chain = info.chain_stats || {};
  const mem = info.mempool_stats || {};
  const funded = BigInt(chain.funded_txo_sum ?? 0) + BigInt(mem.funded_txo_sum ?? 0);
  const spent = BigInt(chain.spent_txo_sum ?? 0) + BigInt(mem.spent_txo_sum ?? 0);
  const sat = funded > spent ? funded - spent : 0n;
  let hex = sat.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  return { balance: `0x${hex}` };
}

/**
 * BTC 不支持代币（用户决策：不上 BTC 稳定币）。
 */
export async function getTokenBalance(_address, _token, _ctx) {
  throw new Error('CHAIN_ADAPTER_NOT_IMPLEMENTED: Bitcoin has no token layer (native BTC only)');
}
