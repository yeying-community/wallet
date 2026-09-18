// @ts-check
/**
 * EVM secp256k1 签名工具（从 signing.js 忠实搬迁）
 *
 * normalizeMpcSignatureParts 把 MPC/远端返回的多种签名形态归一为 ethers.Signature：
 * - 130-hex（r‖s‖v，65 字节）直接 Signature.from(hex)
 * - 否则由 r/s(+recovery) 组装，recovery 缺省按 27（v = recid>=27 ? recid : recid+27）
 *
 * 输出与旧逻辑逐字节一致——这是 MPC 交易能否正确广播的守门点。
 */

import { ethers } from '../../../../lib/ethers-6.16.esm.min.js';

/**
 * 归一化 MPC 签名分量为 ethers.Signature；无法解析返回 null。
 * @param {*} source
 * @returns {import('../../../../lib/ethers-6.16.esm.min.js').Signature|null}
 */
export function normalizeMpcSignatureParts(source) {
  const result = source?.signRequest?.result || source?.result || source || {};
  const signature = result?.signature && typeof result.signature === 'object'
    ? result.signature
    : (source?.signature && typeof source.signature === 'object' ? source.signature : null);
  const signatureHex = String(
    source?.signRequest?.signatureHex
    || source?.signRequest?.signature
    || source?.signatureHex
    || (typeof source?.signature === 'string' ? source.signature : '')
    || result?.signatureHex
    || (typeof result?.signature === 'string' ? result.signature : '')
    || ''
  ).trim();
  if (signatureHex && /^0x[0-9a-fA-F]{130}$/.test(signatureHex)) {
    return ethers.Signature.from(signatureHex);
  }
  const r = String(signature?.r || result?.r || '').trim();
  const s = String(signature?.s || result?.s || '').trim();
  if (!r || !s) {
    return null;
  }
  const recovery = signature?.recoveryId ?? signature?.recid ?? signature?.v ?? result?.recoveryId ?? result?.recid ?? result?.v;
  const recoveryNumber = Number(recovery);
  const v = Number.isInteger(recoveryNumber)
    ? (recoveryNumber >= 27 ? recoveryNumber : recoveryNumber + 27)
    : 27;
  return ethers.Signature.from({ r, s, v });
}
