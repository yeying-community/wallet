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
import { trxBase58CheckDecode } from './base58check.js';

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
 * TRC20 余额：`/wallet/triggerconstantcontract` 只读调用 `balanceOf(address)`
 * （ABI selector 通过 function_selector 传字符串，节点自行编码）。
 * 参数为 owner 地址的 32 字节左填充 hex（20 字节 hash160 → 64 hex）。
 * 返回 `{ balance: '0x<hex>' }`，与 getNativeBalance 形态对齐。
 *
 * @param {string} address Tron Base58Check 地址（T...，被查询余额的账户）
 * @param {{address?: string}} token TRC20 合约（address 为 Base58Check T...）
 * @param {import('../../types.d.ts').ChainCtx} ctx
 * @returns {Promise<{balance: string}>}
 */
export async function getTokenBalance(address, token, ctx) {
  const owner = String(address || '').trim();
  const contract = String(token?.address || '').trim();
  if (!owner || !contract) {
    throw new Error('Tron getTokenBalance: missing address or contract');
  }
  const resp = await tronRpcCall(ctx.chainKey, '/wallet/triggerconstantcontract', {
    owner_address: owner,
    contract_address: contract,
    function_selector: 'balanceOf(address)',
    parameter: tronAddressToAbiParam(owner),
    visible: true
  });
  const result = Array.isArray(resp?.constant_result) ? resp.constant_result[0] : null;
  if (!result) return { balance: '0x0' };
  const hex = String(result).replace(/^0x/, '');
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length === 0) return { balance: '0x0' };
  const n = BigInt(`0x${hex}`);
  let out = n.toString(16);
  if (out.length % 2 === 1) out = `0${out}`;
  return { balance: `0x${out}` };
}

/**
 * Tron 地址 → ABI address 参数（20 字节 hash160 左填充为 32 字节 = 64 hex）。
 * @param {string} address Base58Check（T...）
 * @returns {string} 64 位小写 hex（无 0x 前缀）
 */
function tronAddressToAbiParam(address) {
  const hash20 = trxBase58CheckDecode(address); // Uint8Array(20)
  let hex = '';
  for (const b of hash20) hex += b.toString(16).padStart(2, '0');
  return hex.padStart(64, '0');
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