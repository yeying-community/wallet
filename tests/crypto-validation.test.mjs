/**
 * common/crypto/validation 单测（助记词/私钥/地址/路径/签名校验）
 * 运行：npm test
 *
 * 这些是导入钱包、派生账户、验签的入口校验，错误会让用户无法导入或误判。
 * 用 Hardhat 公开测试向量做确定性断言，并用 ethers 真实签名验 validateSignature。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateMnemonic,
  validatePrivateKey,
  validateAddress,
  isValidMnemonicWord,
  getMnemonicSuggestions,
  validateDerivationPath,
  generateEthereumPath,
  validateSignature
} from '../js/common/crypto/validation.js';
import { ethers } from '../lib/ethers-6.16.esm.min.js';

// Hardhat 公开测试向量（无真实资产）
const TEST_MNEMONIC = 'test test test test test test test test test test test junk';
const TEST_ADDR_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TEST_PRIVKEY_0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// ==================== validateMnemonic ====================

test('validateMnemonic：合法助记词 → valid + 地址 + 词数', () => {
  const r = validateMnemonic(TEST_MNEMONIC);
  assert.equal(r.valid, true);
  assert.equal(r.wordCount, 12);
  assert.equal(r.address.toLowerCase(), TEST_ADDR_0.toLowerCase());
});

test('validateMnemonic：多余空白被规整', () => {
  const r = validateMnemonic('  test   test test test test test test test test test test junk ');
  assert.equal(r.valid, true);
});

test('validateMnemonic：空/非字符串 → 报错', () => {
  assert.equal(validateMnemonic('').valid, false);
  assert.equal(validateMnemonic(null).valid, false);
});

test('validateMnemonic：词数非法 → 报错 + wordCount', () => {
  const r = validateMnemonic('test test test'); // 3 词
  assert.equal(r.valid, false);
  assert.equal(r.wordCount, 3);
});

test('validateMnemonic：词数对但校验和无效 → 报错', () => {
  // 12 个合法 BIP39 词但顺序使校验和无效
  const r = validateMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon');
  assert.equal(r.valid, false);
});

// ==================== validatePrivateKey ====================

test('validatePrivateKey：合法（带 0x）→ valid + 地址', () => {
  const r = validatePrivateKey(TEST_PRIVKEY_0);
  assert.equal(r.valid, true);
  assert.equal(r.address.toLowerCase(), TEST_ADDR_0.toLowerCase());
});

test('validatePrivateKey：不带 0x 也接受', () => {
  const r = validatePrivateKey(TEST_PRIVKEY_0.slice(2));
  assert.equal(r.valid, true);
  assert.equal(r.address.toLowerCase(), TEST_ADDR_0.toLowerCase());
});

test('validatePrivateKey：空 → 报错', () => {
  assert.equal(validatePrivateKey('').valid, false);
  assert.equal(validatePrivateKey(null).valid, false);
});

test('validatePrivateKey：长度错误 → 报错', () => {
  assert.equal(validatePrivateKey('0x1234').valid, false);
  assert.equal(validatePrivateKey('0x' + 'a'.repeat(63)).valid, false);
});

test('validatePrivateKey：非 hex → 报错', () => {
  assert.equal(validatePrivateKey('0x' + 'z'.repeat(64)).valid, false);
});

// ==================== validateAddress ====================

test('validateAddress：合法 → valid + checksum 地址', () => {
  const lower = TEST_ADDR_0.toLowerCase();
  const r = validateAddress(lower);
  assert.equal(r.valid, true);
  assert.equal(r.checksumAddress, ethers.getAddress(lower));
});

test('validateAddress：空 / 非地址 → 报错', () => {
  assert.equal(validateAddress('').valid, false);
  assert.equal(validateAddress('0x123').valid, false);
  assert.equal(validateAddress('not-an-address').valid, false);
});

test('validateAddress：坏校验和（混合大小写）→ 报错', () => {
  const good = ethers.getAddress(TEST_ADDR_0.toLowerCase());
  const bad = good.slice(0, 10) + (good[10] === 'a' ? 'b' : 'a') + good.slice(11);
  assert.equal(validateAddress(bad).valid, false);
});

// ==================== isValidMnemonicWord / getMnemonicSuggestions ====================

test('isValidMnemonicWord：BIP39 词表内 / 外', () => {
  assert.equal(isValidMnemonicWord('abandon'), true);
  assert.equal(isValidMnemonicWord('ABANDON'), true, '大小写不敏感');
  assert.equal(isValidMnemonicWord('zzzzzz'), false);
  assert.equal(isValidMnemonicWord('test'), true);
});

test('getMnemonicSuggestions：前缀补全（< 2 字符返回空）', () => {
  assert.deepEqual(getMnemonicSuggestions('a'), []);
  const sugg = getMnemonicSuggestions('aba');
  assert.ok(sugg.length > 0);
  assert.ok(sugg.every((w) => w.startsWith('aba')));
  assert.ok(sugg.includes('abandon'));
});

test('getMnemonicSuggestions：limit 生效', () => {
  const sugg = getMnemonicSuggestions('a', 3); // 'a' < 2? 不，'a' 长度 1 → []
  assert.deepEqual(sugg, []);
  const sugg2 = getMnemonicSuggestions('ab', 2);
  assert.ok(sugg2.length <= 2);
});

// ==================== validateDerivationPath / generateEthereumPath ====================

test('validateDerivationPath：标准以太坊路径合法', () => {
  assert.equal(validateDerivationPath("m/44'/60'/0'/0/0").valid, true);
  assert.equal(validateDerivationPath("m/44'/60'/0'/0/5").valid, true);
});

test('validateDerivationPath：非法格式 → 报错', () => {
  assert.equal(validateDerivationPath('').valid, false);
  assert.equal(validateDerivationPath('not-a-path').valid, false);
  assert.equal(validateDerivationPath("44'/60'/0'/0/0").valid, false, '缺 m 前缀');
});

test('generateEthereumPath：默认 index 0 + 自定义', () => {
  assert.equal(generateEthereumPath(), "m/44'/60'/0'/0/0");
  assert.equal(generateEthereumPath(3), "m/44'/60'/0'/0/3");
  // 生成的路径应被 validateDerivationPath 接受
  assert.equal(validateDerivationPath(generateEthereumPath(7)).valid, true);
});

// ==================== validateSignature（用 ethers 真实签名） ====================

test('validateSignature：正确签名 → valid', async () => {
  const wallet = new ethers.Wallet(TEST_PRIVKEY_0);
  const message = 'Hello YeYing';
  const signature = await wallet.signMessage(message);
  const r = validateSignature(message, signature, TEST_ADDR_0);
  assert.equal(r.valid, true);
});

test('validateSignature：地址不匹配 → invalid', async () => {
  const wallet = new ethers.Wallet(TEST_PRIVKEY_0);
  const signature = await wallet.signMessage('msg');
  const otherAddr = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  const r = validateSignature('msg', signature, otherAddr);
  assert.equal(r.valid, false);
});

test('validateSignature：缺参数 → 报错', () => {
  assert.equal(validateSignature('', 'sig', '0xabc').valid, false);
  assert.equal(validateSignature('msg', '', '0xabc').valid, false);
  assert.equal(validateSignature('msg', 'sig', '').valid, false);
});

test('validateSignature：非法签名 → 容错 invalid（不抛）', () => {
  let r;
  assert.doesNotThrow(() => { r = validateSignature('msg', '0xgarbage', TEST_ADDR_0); });
  assert.equal(r.valid, false);
});
