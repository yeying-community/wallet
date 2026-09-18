// @ts-check
/**
 * Tron 原生币（TRX）余额查询
 *
 * 通过 `/wallet/getaccount` 读取 account object，返回 `balance`（单位 SUN，6 位小数）
 * 与 `account_address`（Base58Check 形式，T...）。TRC20 v1 不支持，留待后续阶段。
 *
 * 返回格式：`{ balance: '0x<hex sun>' }`（与 EVM `getNativeBalance` 形态对齐）。
 */

import { tronRpcCall } from './rpc.js';

/**
 * @param {string} address Tron Base58Check 地址（T...）
 * @param {import('../../types.d.ts').ChainCtx} ctx
 * @returns {Promise<{balance: string}>}
 */
export async function getNativeBalance(address, ctx) {
  const raw = String(address || '').trim();
  if (!raw) {
    throw new Error('Tron getNativeBalance: missing address');
  }
  const account = await tronRpcCall(ctx.chainKey, '/wallet/getaccount', {
    address: raw
  });
  // TronGrid 返回 balance 是十进制数字（string 或 bigint）；空账户返回 null
  if (!account || typeof account !== 'object') {
    return { balance: '0x0' };
  }
  const sun = String(account.balance ?? '0');
  const hexBalance = decimalSunToHex(sun);
  return { balance: hexBalance };
}

/**
 * TRC20 余额（v1 未实现，留接口以保持 ChainAdapter 形态完整）。
 */
export async function getTokenBalance(_address, _token, _ctx) {
  throw new Error('CHAIN_ADAPTER_NOT_IMPLEMENTED: Tron TRC20 balance (v1 supports native TRX only)');
}

/**
 * 十进制 sun 数 → `0x<hex>`。
 */
function decimalSunToHex(value) {
  const s = String(value || '0').trim();
  if (!s) return '0x0';
  // 用 BigInt 转换，避开大数精度问题
  try {
    let n = 0n;
    for (let i = 0; i < s.length; i += 1) {
      const ch = s.charCodeAt(i) - 48;
      if (ch < 0 || ch > 9) return '0x0';
      n = n * 10n + BigInt(ch);
    }
    let hex = n.toString(16);
    if (hex.length % 2 === 1) hex = `0${hex}`;
    return `0x${hex}`;
  } catch {
    return '0x0';
  }
}