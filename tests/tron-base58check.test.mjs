/**
 * chain/adapters/tron/base58check 单测
 * 运行：node --test tests/tron-base58check.test.mjs
 *
 * 覆盖：
 *  - base58Encode / base58Decode 字节级 round-trip（含前导 0 字节）
 *  - base58CheckEncode / base58CheckDecode：Base58Check 编解码 + SHA-256 校验和
 *  - base58CheckVerify：合法通过 / 校验和不匹配返回 false
 *  - trxBase58CheckEncode / Decode / Verify：Tron 主网（0x41）与测试网（0xa0）prefix
 *  - 已知合法 Tron 地址向量的解码/校验
 *  - 异常路径（非法字符、坏 checksum、prefix 错误、payload 长度错误）
 *  - 边界：空字符串、长度不足、非 Uint8Array 输入
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  base58Encode,
  base58Decode,
  base58CheckEncode,
  base58CheckDecode,
  base58CheckVerify,
  trxBase58CheckEncode,
  trxBase58CheckDecode,
  trxBase58CheckVerify,
  TRON_MAINNET_PREFIX,
  TRON_SHASTA_PREFIX,
  TRON_NILE_PREFIX,
  hexToBytes,
  bytesToHex
} from '../js/chain/adapters/tron/base58check.js';

// 已知合法 Tron 主网地址（来自公开测试向量：0x41 prefix）
const TRON_MAINNET_ADDR_1 = 'THKrowiEfCe8evdbaBzDDvQjM5DGeB3s3F'; // priv 0x8e812436a0e3323166e1f0e8ba79e19e217b2c4a53c970d4cca0cfb1078979df
const TRON_MAINNET_ADDR_2 = 'TNzoqJ2ZCVZAzTsR5sKA6N5zardVodSi5x'; // priv 0x13B9751EDFC5F25ABCB6AE0A8DF387C0B473CF52D8A71125358EBC735F157ABA

// 已知合法 Bitcoin / 通用 Base58Check 地址（用作 base58Check 通测向量）
const BTC_ADDRESS = '1MqxtdQBoY3THeRk9ABfHhsLM3KVHPPSh4'; // priv 0x01...01 → hash160 0xe4a522...0d43

// ==================== bytesToHex / hexToBytes ====================

test('bytesToHex / hexToBytes：互相 round-trip', () => {
  const buf = new Uint8Array([0x00, 0x01, 0x7f, 0x80, 0xff]);
  const hex = bytesToHex(buf);
  assert.equal(hex, '0x00017f80ff');
  const back = hexToBytes(hex);
  assert.deepEqual(Array.from(back), Array.from(buf));
});

test('hexToBytes：缺 0x 前缀也接受；奇数长度抛错', () => {
  const back = hexToBytes('00017f80ff');
  assert.equal(back.length, 5);
  assert.throws(() => hexToBytes('0x123'), /even/);
});

// ==================== base58Encode / base58Decode ====================

test('base58Encode：空字节 → 空串', () => {
  assert.equal(base58Encode(new Uint8Array(0)), '');
});

test('base58Encode / base58Decode round-trip：单字节', () => {
  for (const b of [0x00, 0x01, 0x57, 0x58, 0xff]) {
    const buf = new Uint8Array([b]);
    const enc = base58Encode(buf);
    const dec = base58Decode(enc);
    assert.deepEqual(Array.from(dec), [b], `byte 0x${b.toString(16)}`);
  }
});

test('base58Encode / base58Decode round-trip：多字节（任意填充）', () => {
  const buf = new Uint8Array([0x41, 0x09, 0x9c, 0x66, 0xde, 0x55, 0xaa, 0xfa, 0x14, 0x20, 0x01]);
  const enc = base58Encode(buf);
  const dec = base58Decode(enc);
  assert.deepEqual(Array.from(dec), Array.from(buf));
});

test('base58Encode / base58Decode round-trip：前导 0 字节', () => {
  // 多个前导 0 字节在 Base58 里编码为前导 '1'
  const buf = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x02]);
  const enc = base58Encode(buf);
  assert.ok(enc.startsWith('111'), '前导 0 字节应编码为 1');
  const dec = base58Decode(enc);
  assert.deepEqual(Array.from(dec), Array.from(buf));
});

test('base58Decode：非法字符抛错', () => {
  // '0' / 'O' / 'I' / 'l' 都不在 Base58 字母表
  assert.throws(() => base58Decode('0'), /Invalid Base58 character/);
  assert.throws(() => base58Decode('O'), /Invalid Base58 character/);
  assert.throws(() => base58Decode('I'), /Invalid Base58 character/);
  assert.throws(() => base58Decode('l'), /Invalid Base58 character/);
});

test('base58Encode：非 Uint8Array 抛错', () => {
  assert.throws(() => base58Encode('not-bytes'), /Uint8Array/);
  assert.throws(() => base58Encode(null), /Uint8Array/);
});

test('base58Decode：空串 → 空字节；非字符串抛错', () => {
  assert.equal(base58Decode('').length, 0);
  assert.throws(() => base58Decode(null), /string/);
  assert.throws(() => base58Decode(123), /string/);
});

// ==================== base58CheckEncode / base58CheckDecode ====================

test('base58CheckEncode：Bitcoin 已知地址（0x00 prefix + 20B hash）', () => {
  // BTC 地址 1BoatSLRHtKNngkdXEeobR76b53LETgpyT 对应 payload = 0x00 + 20B hash
  // 解码后应得到 21 字节 payload，且首字节为 0x00
  const decoded = base58CheckDecode(BTC_ADDRESS);
  assert.equal(decoded.length, 21, 'Bitcoin 地址 payload 应为 21 字节');
  assert.equal(decoded[0], 0x00, 'Bitcoin 主网 version byte = 0x00');
});

test('base58CheckVerify：合法 Bitcoin 地址 → true', () => {
  assert.equal(base58CheckVerify(BTC_ADDRESS), true);
});

test('base58CheckVerify：翻转最后一位 → checksum 错误 → false', () => {
  // 取最后一字符切到 Base58 字母表里另一个字符；保留长度与字符集
  const last = BTC_ADDRESS[BTC_ADDRESS.length - 1];
  const replacement = last === 'A' ? 'B' : 'A';
  const tampered = BTC_ADDRESS.slice(0, -1) + replacement;
  assert.equal(base58CheckVerify(tampered), false);
});

test('base58CheckDecode：payload < 4 字节 → 抛错', () => {
  // 1 个有效 Base58 字符最多解码约 0.732 字节；构造一个只够解码到 ~3 字节 payload 的串
  // 用 base58Encode 编一个 0 长度 payload（实际不可能拿到合法 checksum），绕开：测函数路径上
  // 构造一个短串让其解码不到 4 字节即可：
  // 1 字节 '1' 在 base58 里代表 0，所以 '1' 解码为单字节 0x00，凑不出 4 字节 payload
  assert.throws(() => base58CheckDecode('11'), /too short/);
});

test('base58CheckDecode：checksum 不匹配抛错', () => {
  // 用合法 BTC 地址算一个 forward path，但替换一个字符（仍在 Base58 字母表）使 mismatch
  const wrong = BTC_ADDRESS.slice(0, -1) + 'B';
  assert.throws(() => base58CheckDecode(wrong), /checksum mismatch/);
});

test('base58CheckEncode：非 Uint8Array 抛错', () => {
  assert.throws(() => base58CheckEncode('not-bytes'), /Uint8Array/);
});

// ==================== Tron prefix 常量 ====================

test('Tron prefix 常量：mainnet 0x41 / shasta&nile 0xa0', () => {
  assert.equal(TRON_MAINNET_PREFIX, 0x41);
  assert.equal(TRON_SHASTA_PREFIX, 0xa0);
  assert.equal(TRON_NILE_PREFIX, 0xa0);
});

// ==================== trxBase58CheckEncode / Decode / Verify ====================

test('trxBase58CheckEncode：20 字节 hash → 34 字符地址', () => {
  // 任意 20 字节 hash，验证长度正确且以 T 开头（mainnet prefix 0x41）
  const hash = new Uint8Array(20);
  for (let i = 0; i < 20; i += 1) hash[i] = i + 1;
  const addr = trxBase58CheckEncode(hash, TRON_MAINNET_PREFIX);
  assert.equal(addr.length, 34);
  assert.ok(addr.startsWith('T'), 'mainnet 地址以 T 开头');
});

test('trxBase58CheckEncode：testnet prefix 0xa0 → 35 字符地址（无前导零）', () => {
  const hash = new Uint8Array(20);
  for (let i = 0; i < 20; i += 1) hash[i] = i + 1;
  const addr = trxBase58CheckEncode(hash, TRON_SHASTA_PREFIX);
  // 0xa0 = 160，非前导 0；前缀 base58 编码后不是 'a'
  // 主要校验：长度稳定（25 字节 + checksum → 34 字符，但具体长度由 payload 值决定）
  assert.ok(addr.length >= 33 && addr.length <= 36);
  // 解码能正确拿到原 hash（确定性 round-trip）
  const back = trxBase58CheckDecode(addr);
  assert.deepEqual(Array.from(back), Array.from(hash));
});

test('trxBase58CheckEncode：非 20 字节 / 非 Uint8Array 抛错', () => {
  assert.throws(() => trxBase58CheckEncode(new Uint8Array(19)), /20-byte/);
  assert.throws(() => trxBase58CheckEncode(new Uint8Array(21)), /20-byte/);
  assert.throws(() => trxBase58CheckEncode('not-bytes'), /20-byte Uint8Array/);
  assert.throws(() => trxBase58CheckEncode(null), /20-byte Uint8Array/);
});

test('trxBase58CheckDecode：已知 Tron 主网地址 → 20 字节 hash 且 prefix=0x41', () => {
  const hash = trxBase58CheckDecode(TRON_MAINNET_ADDR_1);
  assert.equal(hash.length, 20);
  // 再次编码应得回原地址（确定性校验）
  const reencoded = trxBase58CheckEncode(hash, TRON_MAINNET_PREFIX);
  assert.equal(reencoded, TRON_MAINNET_ADDR_1);
});

test('trxBase58CheckDecode：两个不同已知地址解出不同 hash', () => {
  const h1 = trxBase58CheckDecode(TRON_MAINNET_ADDR_1);
  const h2 = trxBase58CheckDecode(TRON_MAINNET_ADDR_2);
  assert.notDeepEqual(Array.from(h1), Array.from(h2));
});

test('trxBase58CheckDecode：未知 prefix payload 抛错', () => {
  // 构造一个 prefix=0x42 的 payload 并 Base58Check 编码，再用 trxBase58CheckDecode 应拒绝
  const payload = new Uint8Array(21);
  payload[0] = 0x42; // 非 0x41 / 0xa0
  for (let i = 1; i < 21; i += 1) payload[i] = i;
  const str = base58CheckEncode(payload);
  assert.throws(() => trxBase58CheckDecode(str), /Invalid Tron address prefix/);
});

test('trxBase58CheckDecode：payload 长度非 21 抛错', () => {
  // 长度 20 字节 payload（Base58Check 解码仍可算 checksum）→ 长度检查失败
  const payload = new Uint8Array(20);
  for (let i = 0; i < 20; i += 1) payload[i] = i;
  const str = base58CheckEncode(payload);
  assert.throws(() => trxBase58CheckDecode(str), /payload length/);
});

test('trxBase58CheckVerify：合法已知地址 → true', () => {
  assert.equal(trxBase58CheckVerify(TRON_MAINNET_ADDR_1), true);
  assert.equal(trxBase58CheckVerify(TRON_MAINNET_ADDR_2), true);
});

test('trxBase58CheckVerify：翻转最后一位 → false', () => {
  const last = TRON_MAINNET_ADDR_1[TRON_MAINNET_ADDR_1.length - 1];
  const replacement = last === 'A' ? 'B' : 'A';
  const tampered = TRON_MAINNET_ADDR_1.slice(0, -1) + replacement;
  assert.equal(trxBase58CheckVerify(tampered), false);
});

test('trxBase58CheckVerify：非法字符 → false（不抛错）', () => {
  assert.equal(trxBase58CheckVerify('not-a-base58-address'), false);
  assert.equal(trxBase58CheckVerify(null), false);
  assert.equal(trxBase58CheckVerify(''), false);
});

// ==================== 完整 round-trip ====================

test('完整 round-trip：20 字节 hash → 主网地址 → 解码回原 hash', () => {
  const original = new Uint8Array([
    0x41, 0x09, 0x9c, 0x66, 0xde, 0x55, 0xaa, 0xfa,
    0x14, 0x20, 0x01, 0x77, 0x7a, 0x6e, 0xb8, 0xc5,
    0x4d, 0x33, 0xa1, 0x2c
  ]);
  const addr = trxBase58CheckEncode(original);
  const back = trxBase58CheckDecode(addr);
  assert.deepEqual(Array.from(back), Array.from(original));
});