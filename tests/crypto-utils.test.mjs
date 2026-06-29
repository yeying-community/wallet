/**
 * common/crypto/crypto-utils 纯函数单测（加密栈地基）
 * 运行：npm test
 *
 * 所有加解密都依赖这些底层：随机字节/盐/IV、string↔bytes、base64 编解码、
 * 字节拼接、常量时间比较、SHA 哈希。错误会波及私钥加解密与完整性校验。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateRandomBytes,
  generateSalt,
  generateIV,
  stringToBytes,
  bytesToString,
  normalizeBinaryInput,
  base64Encode,
  base64Decode,
  concatBytes,
  constantTimeEqual,
  hash,
  hashHex,
  verifyIntegrity
} from '../js/common/crypto/crypto-utils.js';
import { PBKDF2_CONFIG, AES_GCM_CONFIG } from '../js/common/crypto/crypto-constants.js';

// ==================== 随机字节 / salt / IV ====================

test('generateRandomBytes：长度正确、Uint8Array、两次不同', () => {
  const a = generateRandomBytes(16);
  const b = generateRandomBytes(16);
  assert.ok(a instanceof Uint8Array);
  assert.equal(a.length, 16);
  assert.notDeepEqual([...a], [...b], '两次随机应不同（概率上）');
});

test('generateSalt：长度 = PBKDF2 saltLength', () => {
  assert.equal(generateSalt().length, PBKDF2_CONFIG.saltLength);
});

test('generateIV：长度 = AES-GCM ivLength', () => {
  assert.equal(generateIV().length, AES_GCM_CONFIG.ivLength);
});

// ==================== string <-> bytes ====================

test('stringToBytes / bytesToString ASCII 往返', () => {
  const bytes = stringToBytes('Hello');
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual([...bytes], [72, 101, 108, 108, 111]);
  assert.equal(bytesToString(bytes), 'Hello');
});

test('stringToBytes / bytesToString UTF-8（中文 + emoji）往返', () => {
  const text = '夜莺钱包🐦';
  assert.equal(bytesToString(stringToBytes(text)), text);
});

test('normalizeBinaryInput：接受 Uint8Array / ArrayBuffer / TypedArray / DataView / byte array', () => {
  const uint8 = new Uint8Array([1, 2, 3, 4]);
  const arrayBuffer = uint8.buffer.slice(0);
  const uint16 = new Uint16Array([0x0201, 0x0403]);
  const dataView = new DataView(uint8.buffer.slice(0));
  const byteArray = [1, 2, 3, 4];
  const byteRecord = { 0: 1, 1: 2, 2: 3, 3: 4 };

  assert.deepEqual([...normalizeBinaryInput(uint8)], [1, 2, 3, 4]);
  assert.deepEqual([...normalizeBinaryInput(arrayBuffer)], [1, 2, 3, 4]);
  assert.deepEqual([...normalizeBinaryInput(uint16)], [1, 2, 3, 4]);
  assert.deepEqual([...normalizeBinaryInput(dataView)], [1, 2, 3, 4]);
  assert.deepEqual([...normalizeBinaryInput(byteArray)], [1, 2, 3, 4]);
  assert.deepEqual([...normalizeBinaryInput(byteRecord)], [1, 2, 3, 4]);
});

test('normalizeBinaryInput：非法输入返回 null', () => {
  assert.equal(normalizeBinaryInput({ foo: 'bar' }), null);
  assert.equal(normalizeBinaryInput([256]), null);
});

// ==================== base64 ====================

test('base64Encode / base64Decode 往返', () => {
  const bytes = new Uint8Array([0, 1, 2, 254, 255]);
  const b64 = base64Encode(bytes);
  assert.equal(typeof b64, 'string');
  assert.deepEqual([...base64Decode(b64)], [0, 1, 2, 254, 255]);
});

test('base64：经 string→bytes→base64→bytes→string 全链路', () => {
  const text = '助记词 mnemonic';
  const restored = bytesToString(base64Decode(base64Encode(stringToBytes(text))));
  assert.equal(restored, text);
});

// ==================== concatBytes ====================

test('concatBytes：拼接多段、保持顺序', () => {
  const out = concatBytes(new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5]));
  assert.deepEqual([...out], [1, 2, 3, 4, 5]);
});

test('concatBytes：空输入 → 空数组', () => {
  assert.equal(concatBytes().length, 0);
});

// ==================== constantTimeEqual ====================

test('constantTimeEqual：相等 / 不等 / 长度不同', () => {
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
});

// ==================== hash / hashHex / verifyIntegrity ====================

test('hashHex("")：SHA-256 空串已知向量', async () => {
  // 空串 SHA-256 标准向量
  const expected = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  assert.equal(await hashHex(''), expected);
});

test('hashHex("abc")：SHA-256 已知向量', async () => {
  const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(await hashHex('abc'), expected);
});

test('hash：返回 32 字节 Uint8Array（SHA-256）', async () => {
  const h = await hash('abc');
  assert.ok(h instanceof Uint8Array);
  assert.equal(h.length, 32);
});

test('hashHex：接受 Uint8Array 输入', async () => {
  const fromStr = await hashHex('abc');
  const fromBytes = await hashHex(stringToBytes('abc'));
  assert.equal(fromStr, fromBytes, '字符串与等价字节应得到相同哈希');
});

test('verifyIntegrity：匹配 true、不匹配 false', async () => {
  const data = 'integrity-test';
  const h = await hashHex(data);
  assert.equal(await verifyIntegrity(data, h), true);
  assert.equal(await verifyIntegrity(data, 'deadbeef'), false);
  assert.equal(await verifyIntegrity('tampered', h), false);
});
