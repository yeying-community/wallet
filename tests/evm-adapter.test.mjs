/**
 * js/chain/adapters/evm 交易构造/组装单测（依赖 vendored ethers，零 DOM）
 * 运行：npm test
 *
 * 守门点：新的 buildUnsignedTransaction + assembleSignedTransaction 必须与旧
 * signing.js 的 buildMpcSignedTransaction 对「同一交易 + 同一签名」逐字节一致——
 * 这是 MPC/本地交易能否正确广播的兼容性保证。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ethers } from '../lib/ethers-6.16.esm.min.js';
import {
  normalizeTransaction,
  buildMpcSignedTransaction,
  buildUnsignedTransaction,
  assembleSignedTransaction
} from '../js/chain/adapters/evm/transaction.js';
import { evmAdapter } from '../js/chain/adapters/evm/index.js';

// 固定测试交易（EIP-1559）
const TX = {
  to: '0x' + '11'.repeat(20),
  value: '0x2386f26fc10000',
  nonce: 7,
  gasLimit: '0x5208',
  maxFeePerGas: '0x59682f00',
  maxPriorityFeePerGas: '0x3b9aca00',
  chainId: 1,
  type: 2
};

// 用固定私钥对该交易的 unsignedHash 产出确定签名
const WALLET = new ethers.Wallet('0x' + '42'.repeat(32));

function signatureFor(transaction) {
  const unsigned = buildUnsignedTransaction(transaction);
  return WALLET.signingKey.sign(unsigned.payloads[0].bytes);
}

test('buildUnsignedTransaction：secp256k1 / keccak256 digest / needsRecoveryId', () => {
  const u = buildUnsignedTransaction(TX);
  assert.equal(u.curve, 'secp256k1');
  assert.equal(u.needsRecoveryId, true);
  assert.equal(u.payloads.length, 1);
  assert.equal(u.payloads[0].kind, 'digest');
  assert.equal(u.payloads[0].hashAlg, 'keccak256');
  // digest 应等于 ethers 对归一化交易的 unsignedHash
  const expected = ethers.Transaction.from(normalizeTransaction(TX)).unsignedHash;
  assert.equal(u.payloads[0].bytes, expected);
});

test('assembleSigned（r/s/recid）与旧 buildMpcSignedTransaction 逐字节一致', () => {
  const sig = signatureFor(TX);
  const rawOld = buildMpcSignedTransaction(
    { request: { type: 'transaction', payload: { transaction: normalizeTransaction(TX) } } },
    { r: sig.r, s: sig.s, v: sig.v }
  );
  const u = buildUnsignedTransaction(TX);
  const rawNew = assembleSignedTransaction(u, { parts: [{ r: sig.r, s: sig.s, recid: sig.yParity }] });
  assert.ok(rawOld.startsWith('0x'));
  assert.equal(rawNew, rawOld);
});

test('assembleSigned（rs 拼接形态）与 r/s 分量形态一致', () => {
  const sig = signatureFor(TX);
  const u = buildUnsignedTransaction(TX);
  const rs = sig.r.slice(2) + sig.s.slice(2);
  const rawRs = assembleSignedTransaction(u, { parts: [{ rs: '0x' + rs, recid: sig.yParity }] });
  const rawParts = assembleSignedTransaction(u, { parts: [{ r: sig.r, s: sig.s, recid: sig.yParity }] });
  assert.equal(rawRs, rawParts);
});

test('组装后的 rawTx 可被 ethers 还原且签名者地址正确', () => {
  const sig = signatureFor(TX);
  const u = buildUnsignedTransaction(TX);
  const raw = assembleSignedTransaction(u, { parts: [{ r: sig.r, s: sig.s, recid: sig.yParity }] });
  const parsed = ethers.Transaction.from(raw);
  assert.equal(parsed.from, WALLET.address);
  assert.equal(parsed.nonce, 7);
});

test('evmAdapter：元信息与曲线', () => {
  assert.equal(evmAdapter.namespace, 'eip155');
  assert.equal(evmAdapter.family, 'evm');
  assert.equal(evmAdapter.curve, 'secp256k1');
  assert.equal(evmAdapter.coinType, 60);
  assert.equal(evmAdapter.chainKey({ chainId: 1 }), 'eip155:1');
  assert.equal(evmAdapter.isValidAddress(WALLET.address), true);
  assert.equal(evmAdapter.isValidAddress('nope'), false);
});

test('evmAdapter.buildUnsigned + assembleSigned 端到端与旧逻辑一致', async () => {
  const sig = signatureFor(TX);
  const u = await evmAdapter.buildUnsigned({ type: 'sign-transaction', transaction: TX }, { chainKey: 'eip155:1' });
  const rawNew = evmAdapter.assembleSigned(u, { parts: [{ r: sig.r, s: sig.s, recid: sig.yParity }] });
  const rawOld = buildMpcSignedTransaction(
    { request: { type: 'transaction', payload: { transaction: normalizeTransaction(TX) } } },
    { r: sig.r, s: sig.s, v: sig.v }
  );
  assert.equal(rawNew, rawOld);
});

test('evmAdapter.broadcast 对非法 rawTx 抛错（不触网）', async () => {
  await assert.rejects(() => evmAdapter.broadcast('not-hex', { chainKey: 'eip155:1' }), /Invalid signed transaction/);
});
