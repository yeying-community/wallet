// @ts-check
/**
 * EVM 余额查询核心（从 operations/tokens.js 搬迁链交互部分）
 *
 * 只负责链交互、返回原始 hex；十进制/展示格式化仍留在 operations/tokens.js。
 * getTokenBalance 复刻 ERC20 `balanceOf(address)`（selector 0x70a08231）calldata 构造，
 * 与旧 getTokenBalanceHex 逐字节一致。阶段 0 Step 2 新增，调用方切换在后续步骤。
 */

import { evmRpcCall } from './rpc.js';

const ERC20_BALANCE_OF_SELECTOR = '0x70a08231';

/**
 * 原生币余额（wei hex）。
 * @param {string} address
 * @param {import('../../types.d.ts').ChainCtx} ctx
 * @returns {Promise<string>}
 */
export async function getNativeBalance(address, ctx) {
  return evmRpcCall(ctx.chainKey, 'eth_getBalance', [address, 'latest']);
}

/**
 * ERC20 代币余额（最小单位 hex）。
 * @param {string} address 持有人地址
 * @param {{address: string}} token 代币（需含合约地址）
 * @param {import('../../types.d.ts').ChainCtx} ctx
 * @returns {Promise<string>}
 */
export async function getTokenBalance(address, token, ctx) {
  const normalizedToken = String(token?.address || '').toLowerCase();
  const normalizedAccount = String(address || '').toLowerCase();
  if (!normalizedToken || !normalizedAccount) {
    throw new Error('invalid token or account');
  }
  const addressData = normalizedAccount.replace(/^0x/, '').padStart(64, '0');
  const data = `${ERC20_BALANCE_OF_SELECTOR}${addressData}`;
  return evmRpcCall(ctx.chainKey, 'eth_call', [
    { to: normalizedToken, data },
    'latest'
  ]);
}
