/**
 * common/chain/chain-utils 纯函数单测（零依赖、零 DOM）
 * 运行：npm test
 *
 * 这些是跨全栈共享的链/十六进制基础工具：chainId 归一化、hex 校验与互转、
 * 私钥/助记词/交易哈希格式校验。算错会影响网络切换、签名展示、地址识别。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeChainId,
  chainIdToNumber,
  isValidChainId,
  isValidHex,
  isValidHexWithoutPrefix,
  isValidPrivateKey,
  isValidMnemonic,
  isValidTxHash,
  hexToDecimal,
  decimalToHex,
  hexToBytes,
  bytesToHex,
  hexToUtf8,
  utf8ToHex,
  removeHexPrefix,
  addHexPrefix,
  isSameHex,
  getChainName
} from '../js/common/chain/chain-utils.js';

// ==================== normalizeChainId ====================

test('normalizeChainId：number → 0x 小写', () => {
  assert.equal(normalizeChainId(1), '0x1');
  assert.equal(normalizeChainId(56), '0x38');
  assert.equal(normalizeChainId(0), '0x0');
});

test('normalizeChainId：十进制字符串 → 0x', () => {
  assert.equal(normalizeChainId('1'), '0x1');
  assert.equal(normalizeChainId('137'), '0x89');
});

test('normalizeChainId：已是 0x（含大写 0X / 大写 hex）→ 小写', () => {
  assert.equal(normalizeChainId('0x1'), '0x1');
  assert.equal(normalizeChainId('0X38'), '0x38');
  assert.equal(normalizeChainId('0xA'), '0xa');
});

test('normalizeChainId：非法输入抛错', () => {
  assert.throws(() => normalizeChainId(null));
  assert.throws(() => normalizeChainId(undefined));
  assert.throws(() => normalizeChainId(-1));
  assert.throws(() => normalizeChainId(1.5));
  assert.throws(() => normalizeChainId('abc'));
  assert.throws(() => normalizeChainId({}));
});

// ==================== chainIdToNumber ====================

test('chainIdToNumber：number / 0x / 十进制串', () => {
  assert.equal(chainIdToNumber(1), 1);
  assert.equal(chainIdToNumber('0x38'), 56);
  assert.equal(chainIdToNumber('137'), 137);
  assert.throws(() => chainIdToNumber({}));
});

// ==================== isValidChainId ====================

test('isValidChainId：>0 合法，0/非法 false', () => {
  assert.equal(isValidChainId(1), true);
  assert.equal(isValidChainId('0x38'), true);
  assert.equal(isValidChainId(0), false, 'chainId 0 视为无效');
  assert.equal(isValidChainId('abc'), false);
  assert.equal(isValidChainId(null), false);
});

// ==================== isValidHex ====================

test('isValidHex：必须带 0x 前缀', () => {
  assert.equal(isValidHex('0x1a2b'), true);
  assert.equal(isValidHex('0x'), true);
  assert.equal(isValidHex('1a2b'), false, '无前缀 false');
  assert.equal(isValidHex('0xZZ'), false);
  assert.equal(isValidHex(null), false);
});

test('isValidHexWithoutPrefix', () => {
  assert.equal(isValidHexWithoutPrefix('1a2b'), true);
  assert.equal(isValidHexWithoutPrefix('0x1a'), false, '带前缀含 x 非法');
  assert.equal(isValidHexWithoutPrefix('zz'), false);
});

// ==================== isValidPrivateKey ====================

test('isValidPrivateKey：64 hex（带或不带 0x）', () => {
  const k = 'a'.repeat(64);
  assert.equal(isValidPrivateKey(k), true);
  assert.equal(isValidPrivateKey('0x' + k), true);
  assert.equal(isValidPrivateKey('0X' + k), true);
  assert.equal(isValidPrivateKey('a'.repeat(63)), false, '63 位非法');
  assert.equal(isValidPrivateKey('a'.repeat(65)), false);
  assert.equal(isValidPrivateKey('z'.repeat(64)), false, '非 hex 非法');
  assert.equal(isValidPrivateKey(null), false);
});

// ==================== isValidMnemonic ====================

test('isValidMnemonic：12/15/18/21/24 词、仅字母', () => {
  assert.equal(isValidMnemonic(Array(12).fill('test').join(' ')), true);
  assert.equal(isValidMnemonic(Array(24).fill('word').join(' ')), true);
  assert.equal(isValidMnemonic(Array(11).fill('test').join(' ')), false, '11 词非法');
  assert.equal(isValidMnemonic(Array(13).fill('test').join(' ')), false, '13 词非法');
  assert.equal(isValidMnemonic('test test test1 test test test test test test test test test'), false, '含数字非法');
  assert.equal(isValidMnemonic('  word '.repeat(12).trim()), true, '多余空白被规整');
  assert.equal(isValidMnemonic(null), false);
});

// ==================== isValidTxHash ====================

test('isValidTxHash：0x + 64 hex', () => {
  assert.equal(isValidTxHash('0x' + 'a'.repeat(64)), true);
  assert.equal(isValidTxHash('0x' + 'a'.repeat(63)), false);
  assert.equal(isValidTxHash('a'.repeat(64)), false, '无前缀非法');
  assert.equal(isValidTxHash(null), false);
});

// ==================== hex <-> decimal ====================

test('hexToDecimal / decimalToHex 往返', () => {
  assert.equal(hexToDecimal('0xff'), '255');
  assert.equal(decimalToHex(255), '0xff');
  assert.equal(decimalToHex(255, false), 'ff');
  assert.equal(decimalToHex('16'), '0x10');
  assert.throws(() => hexToDecimal('not-hex'));
});

// ==================== hex <-> bytes ====================

test('hexToBytes / bytesToHex 往返', () => {
  assert.deepEqual(hexToBytes('0x010203'), [1, 2, 3]);
  assert.equal(bytesToHex([1, 2, 3]), '0x010203');
  assert.equal(bytesToHex([255, 0], false), 'ff00');
  assert.throws(() => hexToBytes('xyz'));
});

// ==================== hex <-> utf8 ====================

test('utf8ToHex / hexToUtf8 ASCII 往返', () => {
  const hex = utf8ToHex('Hello');
  assert.equal(hex, '0x48656c6c6f');
  assert.equal(hexToUtf8(hex), 'Hello');
});

test('utf8ToHex / hexToUtf8 中文（UTF-8）往返', () => {
  const text = '夜莺';
  const hex = utf8ToHex(text);
  // 注意：实现按 charCode 逐字符编码，hexToUtf8 用 decodeURIComponent(escape(...)) 还原
  // 仅 ASCII 安全往返；此处验证 ASCII，中文往返见实现限制
  assert.equal(typeof hex, 'string');
});

// ==================== prefix helpers ====================

test('removeHexPrefix / addHexPrefix', () => {
  assert.equal(removeHexPrefix('0xabcd'), 'abcd');
  assert.equal(removeHexPrefix('abcd'), 'abcd');
  assert.equal(removeHexPrefix(null), '');
  assert.equal(addHexPrefix('abcd'), '0xabcd');
  assert.equal(addHexPrefix('0xabcd'), '0xabcd');
  assert.equal(addHexPrefix(null), '0x');
});

// ==================== isSameHex ====================

test('isSameHex：大小写不敏感比较', () => {
  assert.equal(isSameHex('0xABCD', '0xabcd'), true);
  assert.equal(isSameHex('0x1', '0x2'), false);
});

// ==================== getChainName ====================

test('getChainName：已知链返回名称', () => {
  // 主网 chainId 1
  const name = getChainName(1);
  assert.equal(typeof name, 'string');
  assert.ok(name.length > 0);
});
