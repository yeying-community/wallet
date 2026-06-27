/**
 * common/chain/address-utils 纯函数单测（依赖 ethers，零 DOM）
 * 运行：npm test
 *
 * 地址校验/规整/比较/展示/ENS&UD 识别。错判断会让用户复制错地址、转账发错链、
 * checksum 误报、ENS 输入被吞。
 *
 * 注：generateAvatar / getAvatarDataUrl 需要 canvas，跳过（DOM 依赖）。
 * 注：isContractAddress / isEOAAddress 当前实现只是 isValidAddress 的占位
 * （实际需要链上查询），测试只锁定当前行为，不掩盖待办。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidAddress,
  isValidAddressCaseInsensitive,
  isValidChecksum,
  isContractAddress,
  isEOAAddress,
  shortenAddress,
  normalizeAddress,
  addChecksum,
  isSameAddress,
  isValidEnsName,
  isValidUnstoppableDomain,
  validateAddressOrEns
} from '../js/common/chain/address-utils.js';
import { ethers } from '../lib/ethers-6.16.esm.min.js';

const HARDHAT_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const HARDHAT_0_LOWER = HARDHAT_0.toLowerCase();
const HARDHAT_0_CHECKSUM = ethers.getAddress(HARDHAT_0); // 当前就是 checksum 形式

// ==================== isValidAddress ====================

test('isValidAddress：合法 / 非法', () => {
  assert.equal(isValidAddress(HARDHAT_0), true);
  assert.equal(isValidAddress(HARDHAT_0_LOWER), true, '全小写也合法');
  assert.equal(isValidAddress('0xABCDEF1234567890ABCDEF1234567890ABCDEF12'), true, '全大写也合法');
  assert.equal(isValidAddress('0x123'), false, '长度不足');
  assert.equal(isValidAddress(HARDHAT_0 + '00'), false, '长度超 40 字符');
  assert.equal(isValidAddress('0x' + 'z'.repeat(40)), false, '含非 hex');
  assert.equal(isValidAddress('xyz'), false, '无 0x 前缀');
  assert.equal(isValidAddress(''), false);
  assert.equal(isValidAddress(null), false);
  assert.equal(isValidAddress(123), false, '非字符串');
});

// ==================== isValidAddressCaseInsensitive ====================

test('isValidAddressCaseInsensitive：先将输入 lowercase 再校验', () => {
  // 实现先 address.toLowerCase() 再走 hex 正则，因此 "仅小写" 是字面意义：
  // 不限制调用方大小写形式，函数内做归一化后判定。混合大小写也可通过。
  assert.equal(isValidAddressCaseInsensitive(HARDHAT_0_LOWER), true);
  assert.equal(isValidAddressCaseInsensitive('0x' + 'a'.repeat(40)), true);
  assert.equal(isValidAddressCaseInsensitive(HARDHAT_0), true, '混合大小写：lowercase 后合法');
  assert.equal(isValidAddressCaseInsensitive('0x' + 'A'.repeat(40)), true, '全大写：lowercase 后合法');
  assert.equal(isValidAddressCaseInsensitive('0x' + 'z'.repeat(40)), false, '非 hex 非法');
  assert.equal(isValidAddressCaseInsensitive(null), false);
});

// ==================== isValidChecksum（EIP-55）====================

test('isValidChecksum：合法 EIP-55 → true', () => {
  assert.equal(isValidChecksum(HARDHAT_0_CHECKSUM), true);
});

test('isValidChecksum：全小写 / 全大写 → true（无数混合时认为是有效的）', () => {
  assert.equal(isValidChecksum(HARDHAT_0_LOWER), true, '全小写视作有效');
  assert.equal(isValidChecksum(HARDHAT_0.toUpperCase().replace('0X', '0x')), true, '全大写视作有效');
});

test('isValidChecksum：坏 checksum（混合大小写且与 EIP-55 不一致）→ false', () => {
  // 翻转一位大小写
  const bad = HARDHAT_0_CHECKSUM.slice(0, 10)
    + (HARDHAT_0_CHECKSUM[10] === 'a' ? 'A' : 'a')
    + HARDHAT_0_CHECKSUM.slice(11);
  assert.equal(isValidChecksum(bad), false);
});

test('isValidChecksum：非法格式 → false', () => {
  assert.equal(isValidChecksum('0x123'), false);
  assert.equal(isValidChecksum(null), false);
});

// ==================== shortenAddress ====================

test('shortenAddress：默认 0xABCD…4321', () => {
  assert.equal(shortenAddress(HARDHAT_0), '0xf39F...2266');
});

test('shortenAddress：自定义 start / end', () => {
  // startLength 含 0x 长度：8 表示 "0x" + 6 个字符
  assert.equal(shortenAddress(HARDHAT_0, 8, 6), '0xf39Fd6...b92266');
});

test('shortenAddress：格式非法 → 空串（先 isValidAddress 判）', () => {
  assert.equal(shortenAddress('0x12345'), '', '短但非法 → 空');
  assert.equal(shortenAddress(HARDHAT_0_LOWER), '0xf39f...2266', '小写地址也合法 → 缩短');
});

test('shortenAddress：非法地址 → 空串', () => {
  assert.equal(shortenAddress('not-an-address'), '');
  assert.equal(shortenAddress(null), '');
  assert.equal(shortenAddress(''), '');
});

// ==================== normalizeAddress ====================

test('normalizeAddress：转小写、非字符串 → ""', () => {
  assert.equal(normalizeAddress(HARDHAT_0), HARDHAT_0_LOWER);
  assert.equal(normalizeAddress(HARDHAT_0_LOWER), HARDHAT_0_LOWER);
  assert.equal(normalizeAddress(null), '');
  assert.equal(normalizeAddress(''), '');
  assert.equal(normalizeAddress(123), '');
});

// ==================== addChecksum ====================

test('addChecksum：小写 → EIP-55 checksum', () => {
  assert.equal(addChecksum(HARDHAT_0_LOWER), HARDHAT_0_CHECKSUM);
});

test('addChecksum：非法地址 → 抛错', () => {
  assert.throws(() => addChecksum('not-an-address'), /Invalid address/);
  assert.throws(() => addChecksum(null), /Invalid address/);
});

test('addChecksum：全大写地址也能转（小写化后送 ethers）', () => {
  // 实现先 lowercase 再 ethers.getAddress，所以全大写会被规范化。
  // 注意：'0x' + 'A'.repeat(40) 经 lowercase 变成 0x + 40 个 a，
  // 其 EIP-55 checksum 与 HARDHAT_0 不同。
  const upperA = '0x' + 'A'.repeat(40);
  const expected = ethers.getAddress(upperA); // 0xaaa... 的 checksum
  assert.equal(addChecksum(upperA), expected);
});

// ==================== isSameAddress ====================

test('isSameAddress：大小写不敏感', () => {
  assert.equal(isSameAddress(HARDHAT_0, HARDHAT_0_LOWER), true);
  assert.equal(isSameAddress(HARDHAT_0, HARDHAT_0_CHECKSUM), true);
  assert.equal(isSameAddress(HARDHAT_0, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'), false);
});

test('isSameAddress：null / 空 → false', () => {
  assert.equal(isSameAddress(null, HARDHAT_0), false);
  assert.equal(isSameAddress(HARDHAT_0, null), false);
  assert.equal(isSameAddress('', HARDHAT_0), false);
});

// ==================== isContractAddress / isEOAAddress（占位实现）====================

test('isContractAddress / isEOAAddress：当前仅做格式校验（占位）', () => {
  // 已知限制：此实现只判断是否合法地址，不查链上代码/是否 EOA。
  // 这里仅锁定当前行为，避免无意中改成不一样的实现。
  assert.equal(isContractAddress(HARDHAT_0), true);
  assert.equal(isContractAddress('0xbad'), false);
  assert.equal(isEOAAddress(HARDHAT_0), true);
  assert.equal(isEOAAddress(null), false);
});

// ==================== isValidEnsName ====================

test('isValidEnsName：合法 / 非法', () => {
  assert.equal(isValidEnsName('vitalik.eth'), true);
  assert.equal(isValidEnsName('sub.example.eth'), true);
  assert.equal(isValidEnsName('my-name.eth'), true, '含连字符');
  assert.equal(isValidEnsName(''), false);
  assert.equal(isValidEnsName('eth'), false, '无 .');
  assert.equal(isValidEnsName('.eth'), false, '空 label');
  assert.equal(isValidEnsName('-leading.eth'), false, 'label 以 - 开头');
  assert.equal(isValidEnsName('trailing-.eth'), false, 'label 以 - 结尾');
  assert.equal(isValidEnsName('A.eth'), false, '大写非法（实现要求小写）');
  assert.equal(isValidEnsName(null), false);
});

test('★ isValidEnsName：当前实现未做 3-100 长度限制（待补）', () => {
  // ENS 规范要求 3-100 字符；此实现只用正则不限长度。锁定现状。
  const veryLong = 'a'.repeat(200) + '.eth';
  assert.equal(isValidEnsName(veryLong), true, '当前未拒超长；后续补长度限制');
});

// ==================== isValidUnstoppableDomain ====================

test('isValidUnstoppableDomain：支持后缀', () => {
  assert.equal(isValidUnstoppableDomain('brad.crypto'), true);
  assert.equal(isValidUnstoppableDomain('brad.wallet'), true);
  assert.equal(isValidUnstoppableDomain('brad.nft'), true);
  assert.equal(isValidUnstoppableDomain('brad.888'), true);
  assert.equal(isValidUnstoppableDomain('BRAD.crypto'), true, '实现不区分大小写（flag /i）');
});

test('isValidUnstoppableDomain：非法后缀 / 非法 label', () => {
  assert.equal(isValidUnstoppableDomain('brad.eth'), false, '非 UD 后缀');
  assert.equal(isValidUnstoppableDomain('brad'), false, '无后缀');
  assert.equal(isValidUnstoppableDomain('.crypto'), false, '空 label');
  assert.equal(isValidUnstoppableDomain('-brad.crypto'), false, '以 - 开头');
  assert.equal(isValidUnstoppableDomain(null), false);
});

// ==================== validateAddressOrEns ====================

test('validateAddressOrEns：地址 / ENS / UD / 非法', () => {
  assert.deepEqual(validateAddressOrEns(HARDHAT_0), { valid: true, type: 'address' });
  assert.deepEqual(validateAddressOrEns('vitalik.eth'), { valid: true, type: 'ens' });
  assert.deepEqual(validateAddressOrEns('not-anything'), { valid: false, type: null });
  assert.deepEqual(validateAddressOrEns(''), { valid: false, type: null });
});

test('★ validateAddressOrEns：UD 域名（.crypto）被 ENS 分支抢先匹配（当前实现问题）', () => {
  // 实现顺序：先 isValidEnsName 再 isValidUnstoppableDomain。ENS 正则过宽
  // （任何 label.label 都过），所以 'brad.crypto' 永远走 ENS 分支，UD 检测
  // 实质上是死代码。锁定现状以便后续修复。
  assert.deepEqual(validateAddressOrEns('brad.crypto'), { valid: true, type: 'ens' });
});
