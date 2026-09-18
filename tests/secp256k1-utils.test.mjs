/**
 * js/chain/adapters/evm/secp256k1-utils 单测（依赖 vendored ethers，零 DOM）
 * 运行：npm test
 *
 * rsvToSignatureHex 守门点：与 mpc-service.js `_handleWireSignResult` 原内联 IIFE
 * 逐字节一致——去重后 v（≥27 判定）不得改变 MPC 交易广播的 65 字节签名。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { rsvToSignatureHex, normalizeMpcSignatureParts } from '../js/chain/adapters/evm/secp256k1-utils.js';

// 原 mpc-service.js 内联实现（对拍基准，逐字符复制）
function legacyObjectSignatureHex(output) {
  const signatureObject = output.signature && typeof output.signature === 'object' ? output.signature : null;
  if (!signatureObject) return '';
  const r = String(signatureObject.r || '').trim();
  const s = String(signatureObject.s || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(r) || !/^0x[0-9a-fA-F]{64}$/.test(s)) {
    return '';
  }
  const recovery = Number(signatureObject.recoveryId ?? signatureObject.recid ?? signatureObject.v ?? output.recoveryId ?? output.recid ?? output.v ?? 0);
  const v = Number.isInteger(recovery)
    ? (recovery >= 27 ? recovery : recovery + 27)
    : 27;
  return `${r}${s.slice(2)}${v.toString(16).padStart(2, '0')}`;
}

const R = '0x' + '11'.repeat(32);
const S = '0x' + '22'.repeat(32);

const CASES = [
  { name: 'recid 0（→ v=27=0x1b）', output: { signature: { r: R, s: S, recid: 0 } } },
  { name: 'recid 1（→ v=28=0x1c）', output: { signature: { r: R, s: S, recid: 1 } } },
  { name: 'v 已是 27', output: { signature: { r: R, s: S, v: 27 } } },
  { name: 'v 已是 28', output: { signature: { r: R, s: S, v: 28 } } },
  { name: 'recovery 缺省（无字段 → 0 → 27）', output: { signature: { r: R, s: S } } },
  { name: 'recovery 从 output 兜底', output: { signature: { r: R, s: S }, recoveryId: 1 } },
  { name: 'recoveryId 字段', output: { signature: { r: R, s: S, recoveryId: 1 } } },
  { name: 'r 非 64 hex → 空串', output: { signature: { r: '0x1234', s: S, recid: 0 } } },
  { name: 's 缺失 → 空串', output: { signature: { r: R, recid: 0 } } },
  { name: 'signature 非对象 → 空串', output: { signature: '0xabc' } },
];

for (const { name, output } of CASES) {
  test(`rsvToSignatureHex 与旧 IIFE 一致：${name}`, () => {
    const legacy = legacyObjectSignatureHex(output);
    const next = rsvToSignatureHex(
      output.signature && typeof output.signature === 'object' ? output.signature : null,
      output
    );
    assert.equal(next, legacy);
  });
}

test('rsvToSignatureHex 输出为 0x + 130 hex（有效输入）', () => {
  const hex = rsvToSignatureHex({ r: R, s: S, recid: 1 });
  assert.match(hex, /^0x[0-9a-fA-F]{130}$/);
  // 与 normalizeMpcSignatureParts 对同一 r/s/v 的 r/s/v 分量一致
  const sig = normalizeMpcSignatureParts({ signature: { r: R, s: S, recid: 1 } });
  assert.equal(sig.r, R);
  assert.equal(sig.s, S);
  assert.equal(sig.v, 28);
});
