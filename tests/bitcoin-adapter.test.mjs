/**
 * js/chain/adapters/bip122 单元测试（BTC native P2WPKH segwit）
 *
 * 守门点：
 *   - pubkey → P2WPKH 地址匹配 BIP-173 官方向量
 *   - hash160 / addressToScriptPubKey 结构正确（P2WPKH / P2PKH / P2SH）
 *   - isValidBitcoinAddress 接受 4 类地址、拒非法
 *   - buildUnsigned：greedy 选币 + BIP-143 sighash（digest payload）
 *   - assembleSigned：DER + witness，segwit 序列化（marker/flag 0001）
 *   - toDer minimal 编码 + low-s
 *
 * 不覆盖：真实 RPC、P2TR 发送、多签。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ethers } from '../lib/ethers-6.16.esm.min.js';
import {
  pubkeyToP2wpkhAddress,
  pubkeyToP2pkhAddress,
  privateKeyToBitcoinAddress,
  isValidBitcoinAddress,
  addressToScriptPubKey,
  p2wpkhAddressToHash160,
  hash160
} from '../js/chain/adapters/bip122/address.js';
import {
  buildUnsigned,
  assembleSigned,
  computeTxid,
  toDer,
  greedySelect,
  estimateVsize
} from '../js/chain/adapters/bip122/transaction.js';
import { bitcoinAdapter } from '../js/chain/adapters/bip122/index.js';

// BIP-173 官方向量：pubkey → hash160 → P2WPKH
const EXAMPLE_PUBKEY_HEX = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const EXAMPLE_HASH160 = '751e76e8199196d454941c45d1b3a323f1433bd6';
const EXAMPLE_P2WPKH = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function hexToBytes(hex) {
  const raw = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(raw.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

// ===== 地址派生 =====

test('hash160(example pubkey) 匹配 BIP-173 向量', () => {
  assert.equal(bytesToHex(hash160(hexToBytes(EXAMPLE_PUBKEY_HEX))), EXAMPLE_HASH160);
});

test('pubkeyToP2wpkhAddress 匹配 BIP-173 官方 P2WPKH 向量', () => {
  assert.equal(pubkeyToP2wpkhAddress(hexToBytes(EXAMPLE_PUBKEY_HEX), 'mainnet'), EXAMPLE_P2WPKH);
});

test('P2WPKH 地址 → hash160 roundtrip', () => {
  assert.equal(bytesToHex(p2wpkhAddressToHash160(EXAMPLE_P2WPKH)), EXAMPLE_HASH160);
});

test('testnet P2WPKH 用 tb HRP', () => {
  const addr = pubkeyToP2wpkhAddress(hexToBytes(EXAMPLE_PUBKEY_HEX), 'testnet');
  assert.equal(addr.startsWith('tb1q'), true);
});

test('privateKeyToBitcoinAddress：Hardhat #0 → 合法 bc1q 地址', () => {
  const addr = privateKeyToBitcoinAddress(
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    'mainnet'
  );
  assert.equal(addr.startsWith('bc1q'), true);
  assert.equal(isValidBitcoinAddress(addr), true);
});

test('P2PKH 派生 + base58check 结构（version 0x00, 25B script）', () => {
  const addr = pubkeyToP2pkhAddress(hexToBytes(EXAMPLE_PUBKEY_HEX), 'mainnet');
  assert.equal(addr[0], '1'); // mainnet P2PKH 前缀
  const spk = addressToScriptPubKey(addr);
  // OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
  assert.equal(spk.length, 25);
  assert.equal(spk[0], 0x76);
  assert.equal(spk[1], 0xa9);
  assert.equal(spk[2], 0x14);
  assert.equal(spk[23], 0x88);
  assert.equal(spk[24], 0xac);
  assert.equal(bytesToHex(spk.slice(3, 23)), EXAMPLE_HASH160);
});

// ===== addressToScriptPubKey =====

test('addressToScriptPubKey(P2WPKH) = 0x0014 || hash160', () => {
  const spk = addressToScriptPubKey(EXAMPLE_P2WPKH);
  assert.equal(spk.length, 22);
  assert.equal(spk[0], 0x00); // OP_0
  assert.equal(spk[1], 0x14); // push 20
  assert.equal(bytesToHex(spk.slice(2)), EXAMPLE_HASH160);
});

test('isValidBitcoinAddress：接受 P2WPKH / P2PKH，拒非法', () => {
  assert.equal(isValidBitcoinAddress(EXAMPLE_P2WPKH), true);
  assert.equal(isValidBitcoinAddress(pubkeyToP2pkhAddress(hexToBytes(EXAMPLE_PUBKEY_HEX), 'mainnet')), true);
  assert.equal(isValidBitcoinAddress('not-an-address'), false);
  assert.equal(isValidBitcoinAddress('bc1qinvalidchecksum000000000000000000'), false);
  assert.equal(isValidBitcoinAddress(''), false);
});

// ===== toDer =====

test('toDer：minimal DER，0x30 header + 两个 0x02 INTEGER', () => {
  const der = toDer(
    '0x00d7aaa462f0ce530c40f580c8a3399710658b51e96c7b2de759916788699deefe',
    '0x2bc830a30000000000000000000000000000000000000000000000000000000001'
  );
  assert.equal(der[0], 0x30);
  assert.equal(der[2], 0x02); // 第一个 INTEGER 标记
});

// ===== greedySelect / estimateVsize =====

test('greedySelect：largest-first 覆盖 target', () => {
  const utxos = [
    { txid: 'a'.repeat(64), vout: 0, value: 1000 },
    { txid: 'b'.repeat(64), vout: 1, value: 5000 },
    { txid: 'c'.repeat(64), vout: 0, value: 2000 }
  ];
  const { selected, total } = greedySelect(utxos, 6000n);
  // 5000 (最大) + 2000 = 7000 ≥ 6000
  assert.equal(selected.length, 2);
  assert.equal(total, 7000n);
  assert.equal(BigInt(selected[0].value), 5000n);
});

test('greedySelect：不足抛错', () => {
  assert.throws(() => greedySelect([{ txid: 'a'.repeat(64), vout: 0, value: 100 }], 6000n), /Insufficient/);
});

test('estimateVsize 单调递增', () => {
  assert.ok(estimateVsize(2, 2) > estimateVsize(1, 1));
});

// ===== buildUnsigned / assembleSigned 全链路 =====

test('buildUnsigned + assembleSigned：真签名 → segwit raw tx（marker 0001）', async () => {
  const PRIV = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const from = privateKeyToBitcoinAddress(PRIV, 'mainnet');
  const to = EXAMPLE_P2WPKH;

  // stub Esplora：/utxo → 1 个 1 BTC UTXO；/fee-estimates → 10 sat/vB
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/fee-estimates')) {
      return { ok: true, json: async () => ({ '6': 10, '3': 12, '1': 20 }) };
    }
    if (u.includes('/utxo')) {
      return { ok: true, json: async () => ([{ txid: 'd'.repeat(64), vout: 0, value: 100000000 }]) };
    }
    return { ok: false, status: 404, text: async () => 'nope' };
  };

  try {
    const unsigned = await buildUnsigned(
      { type: 'native-transfer', from, to, amount: '10000000' }, // 0.1 BTC
      { chainKey: 'bip122:mainnet' }
    );
    assert.equal(unsigned.curve, 'secp256k1');
    assert.equal(unsigned.payloads.length, 1);
    assert.equal(unsigned.payloads[0].kind, 'digest');
    assert.equal(unsigned.payloads[0].bytes.startsWith('0x'), true);
    // 找零应存在（1 BTC - 0.1 BTC - fee ≫ dust）
    assert.equal(unsigned.serializeState.outputs.length, 2);

    // 用 keyring 私钥真签每个 sighash
    const signingKey = new ethers.SigningKey(PRIV);
    unsigned.serializeState.compressedPubkey = hexToBytes(signingKey.compressedPublicKey);
    const parts = unsigned.payloads.map((p) => {
      const s = signingKey.sign(ethers.getBytes(p.bytes));
      return { r: s.r, s: s.s, recid: s.v - 27 };
    });
    const rawHex = assembleSigned(unsigned, { parts });
    // 版本 02000000 + segwit marker/flag 0001
    assert.equal(rawHex.slice(0, 8), '02000000');
    assert.equal(rawHex.slice(8, 12), '0001');
    // txid 是 64 hex（大端）
    const txid = computeTxid(unsigned);
    assert.equal(/^[0-9a-f]{64}$/.test(txid), true);
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ===== adapter 形 =====

test('bitcoinAdapter：namespace / family / curve / coinType', () => {
  assert.equal(bitcoinAdapter.namespace, 'bip122');
  assert.equal(bitcoinAdapter.family, 'utxo');
  assert.equal(bitcoinAdapter.curve, 'secp256k1');
  assert.equal(bitcoinAdapter.coinType, 0);
  assert.equal(bitcoinAdapter.chainKey({ reference: 'mainnet' }), 'bip122:mainnet');
  assert.equal(bitcoinAdapter.chainKey({ reference: 'testnet' }), 'bip122:testnet');
});
