/**
 * common/chain/address-normalize 跨链族地址工具单测
 * 运行：node --test tests/address-normalize.test.mjs
 *
 * 覆盖：
 *  - normalizeAddress / isValidAddressForFamily 在 EVM 和 Tron 链族下的形态
 *  - compareAddresses 的 EVM 大小写等价 vs Tron 大小写敏感
 *  - formatAddressForFamily 的 display 形态
 *  - addressDidMethod 的 DID 前缀（eth / tron）
 *  - registerTronStrictValidator 注入：未注册时 Tron 仅字符集校验；注册后做严格校验和验证
 *  - default EVM 路径在未指定 family 时的向后兼容
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ADDRESS_FAMILY,
  normalizeAddress,
  isValidAddressForFamily,
  compareAddresses,
  formatAddressForFamily,
  addressDidMethod,
  registerTronStrictValidator
} from '../js/common/chain/address-normalize.js';

// 已知合法 Tron 地址（来自公开测试向量）
const TRON_VALID_1 = 'TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW';
const TRON_VALID_2 = 'TNzoqJ2ZCVZAzTsR5sKA6N5zardVodSi5x';
// 任一 Base58Check 字符集合法但校验和错误的形式（用 - 替换前 4 个字符）
const TRON_BAD_CHECKSUM = 'TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxM' + 'ZZZZ'; // 长度依然 38，加 -1 越界，改用同长度同字符集

// 已知合法 EVM 测试向量（Hardhat 公开）
const EVM_VALID = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const EVM_VALID_LOWER = EVM_VALID.toLowerCase();

// 测试期间注入真正的严格校验函数（来自 tron/base58check.js 的链族适配器）
// 这里我们直接动态 import（避免 common→chain 的硬依赖），并在 afterEach 还原。
let base58check = null;
async function loadStrictValidator() {
  if (!base58check) {
    base58check = await import('../js/chain/adapters/tron/base58check.js');
  }
  return base58check.trxBase58CheckVerify;
}

test('DEFAULT_ADDRESS_FAMILY = eip155（向后兼容默认形态）', () => {
  assert.equal(DEFAULT_ADDRESS_FAMILY, 'eip155');
});

// ==================== normalizeAddress ====================

test('normalizeAddress(EVM hex) → 0x + 40 lowercase', () => {
  assert.equal(normalizeAddress(EVM_VALID, 'eip155'), EVM_VALID_LOWER);
  assert.equal(normalizeAddress(EVM_VALID.toUpperCase().replace('0X', '0x'), 'eip155'), EVM_VALID_LOWER);
});

test('normalizeAddress(EVM 短地址 / 非 hex) → ""', () => {
  assert.equal(normalizeAddress('0xabc', 'eip155'), '');
  assert.equal(normalizeAddress('not-an-address', 'eip155'), '');
  assert.equal(normalizeAddress(null, 'eip155'), '');
  assert.equal(normalizeAddress('', 'eip155'), '');
  assert.equal(normalizeAddress(undefined, 'eip155'), '');
});

test('normalizeAddress(Tron 合法地址) → 原大小写返回', async () => {
  registerTronStrictValidator(await loadStrictValidator());
  assert.equal(normalizeAddress(TRON_VALID_1, 'tron'), TRON_VALID_1);
  assert.equal(normalizeAddress(TRON_VALID_2, 'tron'), TRON_VALID_2);
});

test('normalizeAddress(Tron 坏 checksum) → ""', async () => {
  registerTronStrictValidator(await loadStrictValidator());
  // 复制合法地址、把前 4 字符替换成同长度同字符集的其他字符，构造坏 checksum
  const tampered = TRON_VALID_1.slice(0, TRON_VALID_1.length - 4) + '1111';
  assert.equal(normalizeAddress(tampered, 'tron'), '');
});

test('normalizeAddress(Tron 字符集非法) → ""（先 regex 过滤）', async () => {
  registerTronStrictValidator(await loadStrictValidator());
  // 含 '0' / 'O' / 'I' / 'l' 都不在 Base58 字母表
  assert.equal(normalizeAddress('T0nKsPa7y5okkXvQAidZBzqx3QyQ6sxMWW', 'tron'), '');
  // 长度不对
  assert.equal(normalizeAddress('TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sx', 'tron'), '');
  // 完全不像地址
  assert.equal(normalizeAddress('hello', 'tron'), '');
});

test('normalizeAddress(default family) → EVM 路径（与阶段 0 行为一致）', () => {
  assert.equal(normalizeAddress(EVM_VALID), EVM_VALID_LOWER);
  assert.equal(normalizeAddress('garbage'), '');
});

test('normalizeAddress(Tron) 在 strict validator 未注册时仅字符集通过', () => {
  // 重置为 null（前面 test 注入过）
  registerTronStrictValidator(null);
  // 字符集合法、校验和错的字符串此时会通过（fallback 行为）
  const tampered = TRON_VALID_1.slice(0, TRON_VALID_1.length - 4) + '1111';
  assert.equal(normalizeAddress(tampered, 'tron'), tampered);
  // 再注入回去，后续 test 可继续依赖严格校验
});

// ==================== isValidAddressForFamily ====================

test('isValidAddressForFamily(EVM) → 大小写不敏感', () => {
  assert.equal(isValidAddressForFamily(EVM_VALID, 'eip155'), true);
  assert.equal(isValidAddressForFamily(EVM_VALID_LOWER, 'eip155'), true);
  assert.equal(isValidAddressForFamily(EVM_VALID.toUpperCase().replace('0X', '0x'), 'eip155'), true);
  assert.equal(isValidAddressForFamily('0xabc', 'eip155'), false);
  assert.equal(isValidAddressForFamily(null, 'eip155'), false);
});

test('isValidAddressForFamily(Tron 严格模式) → 合法地址 true / 坏 checksum false', async () => {
  registerTronStrictValidator(await loadStrictValidator());
  assert.equal(isValidAddressForFamily(TRON_VALID_1, 'tron'), true);
  assert.equal(isValidAddressForFamily(TRON_VALID_2, 'tron'), true);
  const tampered = TRON_VALID_1.slice(0, TRON_VALID_1.length - 4) + '1111';
  assert.equal(isValidAddressForFamily(tampered, 'tron'), false);
  assert.equal(isValidAddressForFamily('garbage', 'tron'), false);
  assert.equal(isValidAddressForFamily(null, 'tron'), false);
});

test('isValidAddressForFamily(default family) → EVM 路径', () => {
  assert.equal(isValidAddressForFamily(EVM_VALID), true);
  assert.equal(isValidAddressForFamily('garbage'), false);
});

// ==================== compareAddresses ====================

test('compareAddresses(EVM) → 大小写无关等价', () => {
  assert.equal(compareAddresses(EVM_VALID, EVM_VALID_LOWER, 'eip155'), true);
  assert.equal(compareAddresses(EVM_VALID, '0xf39FD6E51AAD88F6F4CE6AB8827279CFFFB92266', 'eip155'), true);
  assert.equal(compareAddresses(EVM_VALID, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 'eip155'), false);
  assert.equal(compareAddresses(EVM_VALID, null, 'eip155'), false);
  assert.equal(compareAddresses(null, EVM_VALID, 'eip155'), false);
});

test('compareAddresses(Tron) → 大小写敏感，原值比对', async () => {
  registerTronStrictValidator(await loadStrictValidator());
  assert.equal(compareAddresses(TRON_VALID_1, TRON_VALID_1, 'tron'), true);
  // 把第一个字符小写化（字符集合法但和原值不等）→ false
  const tampered = 't' + TRON_VALID_1.slice(1);
  assert.equal(compareAddresses(TRON_VALID_1, tampered, 'tron'), false);
  // 两不同合法地址
  assert.equal(compareAddresses(TRON_VALID_1, TRON_VALID_2, 'tron'), false);
});

test('compareAddresses(default family) → EVM 等价', () => {
  assert.equal(compareAddresses(EVM_VALID, EVM_VALID_LOWER), true);
  assert.equal(compareAddresses(EVM_VALID, 'garbage'), false);
});

// ==================== formatAddressForFamily ====================

test('formatAddressForFamily(EVM) → 全小写保留，其他大小写折叠为小写', () => {
  assert.equal(formatAddressForFamily(EVM_VALID_LOWER, 'eip155'), EVM_VALID_LOWER);
  // 混合大小写（坏 checksum）→ 输出小写
  assert.equal(formatAddressForFamily(EVM_VALID, 'eip155'), EVM_VALID_LOWER);
  // 非法 → 原样
  assert.equal(formatAddressForFamily('garbage', 'eip155'), 'garbage');
  assert.equal(formatAddressForFamily(null, 'eip155'), '');
});

test('formatAddressForFamily(Tron) → 原样', async () => {
  registerTronStrictValidator(await loadStrictValidator());
  assert.equal(formatAddressForFamily(TRON_VALID_1, 'tron'), TRON_VALID_1);
  assert.equal(formatAddressForFamily('garbage', 'tron'), 'garbage');
});

// ==================== addressDidMethod ====================

test('addressDidMethod：eip155 → eth；tron → tron；其他/默认 → eth', () => {
  assert.equal(addressDidMethod('eip155'), 'eth');
  assert.equal(addressDidMethod('tron'), 'tron');
  assert.equal(addressDidMethod(), 'eth');
  assert.equal(addressDidMethod('unknown'), 'eth');
  assert.equal(addressDidMethod('EIP155'), 'eth', '大小写无关');
  assert.equal(addressDidMethod('TRON'), 'tron', '大小写无关');
});

// ==================== registerTronStrictValidator 副作用 ====================

test('registerTronStrictValidator(null) 清除注入，回退到字符集校验', () => {
  registerTronStrictValidator(null);
  const tampered = TRON_VALID_1.slice(0, TRON_VALID_1.length - 4) + '1111';
  assert.equal(isValidAddressForFamily(tampered, 'tron'), true);
});

test('registerTronStrictValidator(non-function) 视为 null', () => {
  registerTronStrictValidator('not-a-fn');
  const tampered = TRON_VALID_1.slice(0, TRON_VALID_1.length - 4) + '1111';
  assert.equal(isValidAddressForFamily(tampered, 'tron'), true);
  registerTronStrictValidator(null);
});