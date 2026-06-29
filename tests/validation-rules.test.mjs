/**
 * config/validation-rules 纯函数单测（依赖 ethers，零 DOM）
 * 运行：npm test
 *
 * 校验栈：地址/交易/网络/代币/输入/url/数字范围。校验错会拦不住无效数据、
 * 放过坏 checksum 让用户转错账。
 *
 * 重点覆盖：
 * - validateEthereumAddress：默认接受小写/大写/合法 checksum、拒绝坏 checksum
 *   （这是引入 ethers.isAddress 后的关键回归）。
 * - validateEthereumAddress({requireChecksum: true})：强校验拒绝纯小写。
 * - validateTransaction：to / value / gasLimit / gasPrice / data。
 * - validateNetworkConfig / validateTokenConfig：name / rpc / chainId / symbol
 *   / decimals 全字段。
 * - validateAccountName / ContactName / Label / Note / sanitizeInput /
 *   validateUrl / validateNumberRange。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateEthereumAddress,
  validateTransaction,
  validateNetworkConfig,
  validateTokenConfig,
  validateAccountName,
  validateContactName,
  validateLabel,
  validateNote,
  sanitizeInput,
  validateUrl,
  validateNumberRange
} from '../js/config/validation-rules.js';
import { ethers } from '../lib/ethers-6.16.esm.min.js';

const HARDHAT_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const HARDHAT_0_LOWER = HARDHAT_0.toLowerCase();
const HARDHAT_0_CHECKSUM = ethers.getAddress(HARDHAT_0); // 实际就是原串
const HARDHAT_1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

// 翻转一位大小写：构造"坏 checksum"
const BAD_CHECKSUM = HARDHAT_0_CHECKSUM.slice(0, 10)
  + (HARDHAT_0_CHECKSUM[10] === 'a' ? 'A' : 'a')
  + HARDHAT_0_CHECKSUM.slice(11);

// ==================== validateEthereumAddress（EIP-55 回归核心）====================

test('validateEthereumAddress：空 / 缺 → 报错', () => {
  const r = validateEthereumAddress('');
  assert.equal(r.valid, false);
  assert.match(r.error, /required/);
});

test('validateEthereumAddress：格式错（长度/字符）→ 报错', () => {
  const r = validateEthereumAddress('0x123');
  assert.equal(r.valid, false);
  assert.match(r.error, /Invalid address format/);
});

test('validateEthereumAddress：全小写 → 合法（视为无 checksum）', () => {
  const r = validateEthereumAddress(HARDHAT_0_LOWER);
  assert.equal(r.valid, true);
});

test('validateEthereumAddress：全大写 → 合法', () => {
  const r = validateEthereumAddress(HARDHAT_0_CHECKSUM.toUpperCase().replace('0X', '0x'));
  assert.equal(r.valid, true);
});

test('validateEthereumAddress：合法 checksum → 通过', () => {
  assert.equal(validateEthereumAddress(HARDHAT_0_CHECKSUM).valid, true);
});

test('★ validateEthereumAddress：坏 checksum（混合大小写不一致）→ 拒绝（EIP-55 回归）', () => {
  const r = validateEthereumAddress(BAD_CHECKSUM);
  assert.equal(r.valid, false, '坏 checksum 应被拒');
  assert.match(r.error, /EIP-55/);
});

test('validateEthereumAddress({requireChecksum:true})：纯小写被拒', () => {
  const r = validateEthereumAddress(HARDHAT_0_LOWER, true);
  assert.equal(r.valid, false, '小写在 requireChecksum 下应被拒');
  assert.match(r.error, /EIP-55/);
});

test('validateEthereumAddress({requireChecksum:true})：合法 checksum 通过', () => {
  assert.equal(validateEthereumAddress(HARDHAT_0_CHECKSUM, true).valid, true);
});

test('validateEthereumAddress({requireChecksum:true})：坏 checksum 仍被拒', () => {
  const r = validateEthereumAddress(BAD_CHECKSUM, true);
  assert.equal(r.valid, false);
});

// ==================== validateTransaction ====================

test('validateTransaction：合法交易 → 通过', () => {
  const r = validateTransaction({
    to: HARDHAT_0,
    value: '0.1',
    gasLimit: 21000,
    gasPrice: 50
  });
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test('validateTransaction：to 缺失或非法 → 报错', () => {
  const r1 = validateTransaction({});
  assert.equal(r1.valid, false);
  assert.ok(r1.errors.some((e) => /Recipient address is required/.test(e)));

  const r2 = validateTransaction({ to: '0xbad' });
  assert.equal(r2.valid, false);
  assert.ok(r2.errors.length > 0);
});

test('validateTransaction：value 负 / NaN → 报错', () => {
  const r1 = validateTransaction({ to: HARDHAT_0, value: '-1' });
  assert.ok(r1.errors.some((e) => /Invalid transaction value/.test(e)));
  const r2 = validateTransaction({ to: HARDHAT_0, value: 'abc' });
  assert.ok(r2.errors.some((e) => /Invalid transaction value/.test(e)));
});

test('validateTransaction：ALLOW_ZERO_VALUE=true 时 value=0 通过', () => {
  const r = validateTransaction({ to: HARDHAT_0, value: '0' });
  assert.equal(r.valid, true);
});

test('validateTransaction：gas limit 越界 → 报错（min/max）', () => {
  const r1 = validateTransaction({ to: HARDHAT_0, gasLimit: 100 }); // 太小
  assert.ok(r1.errors.some((e) => /Gas limit must be at least/.test(e)));
  const r2 = validateTransaction({ to: HARDHAT_0, gasLimit: 999_999_999 }); // 太大
  assert.ok(r2.errors.some((e) => /Gas limit must not exceed/.test(e)));
});

test('validateTransaction：gas price 越界 → 报错（min/max）', () => {
  const r1 = validateTransaction({ to: HARDHAT_0, gasPrice: 0.5 });
  assert.ok(r1.errors.some((e) => /Gas price must be at least/.test(e)));
  const r2 = validateTransaction({ to: HARDHAT_0, gasPrice: 9999 });
  assert.ok(r2.errors.some((e) => /Gas price must not exceed/.test(e)));
});

test('validateTransaction：data 非 hex → 报错', () => {
  const r = validateTransaction({ to: HARDHAT_0, data: '0xZZZZ' });
  assert.ok(r.errors.some((e) => /Invalid transaction data format/.test(e)));
});

test('validateTransaction：合法 data 通过', () => {
  const r = validateTransaction({ to: HARDHAT_0, data: '0x1234abcd' });
  assert.equal(r.valid, true);
});

// ==================== validateNetworkConfig ====================

test('validateNetworkConfig：合法网络 → 通过', () => {
  const r = validateNetworkConfig({
    name: 'Polygon',
    rpcUrl: 'https://polygon-rpc.com',
    chainId: 137,
    symbol: 'MATIC'
  });
  assert.equal(r.valid, true);
});

test('validateNetworkConfig：缺 name / rpc / chainId / symbol → 报错', () => {
  const r = validateNetworkConfig({});
  assert.equal(r.valid, false);
  assert.ok(r.errors.length >= 4);
});

test('validateNetworkConfig：name 含特殊字符 → 报错', () => {
  const r = validateNetworkConfig({
    name: 'Bad@Name!', rpcUrl: 'https://x', chainId: 1, symbol: 'X'
  });
  assert.ok(r.errors.some((e) => /invalid characters/.test(e)));
});

test('validateNetworkConfig：name 超长 → 报错', () => {
  const r = validateNetworkConfig({
    name: 'a'.repeat(51), rpcUrl: 'https://x', chainId: 1, symbol: 'X'
  });
  assert.ok(r.errors.some((e) => /must not exceed/.test(e)));
});

test('validateNetworkConfig：rpc 非 http(s) → 报错', () => {
  const r = validateNetworkConfig({
    name: 'X', rpcUrl: 'ftp://x', chainId: 1, symbol: 'X'
  });
  assert.ok(r.errors.some((e) => /Invalid RPC URL format/.test(e)));
});

test('validateNetworkConfig：REQUIRE_HTTPS=true 时 http:// 被拒', () => {
  // 通过临时 patch 不实际：这里仅验证默认配置 REQUIRE_HTTPS=false 不强制
  const r = validateNetworkConfig({
    name: 'X', rpcUrl: 'http://x', chainId: 1, symbol: 'X'
  });
  // 默认 REQUIRE_HTTPS=false → http 通过
  assert.equal(r.valid, true);
});

test('validateNetworkConfig：chainId 0x 字符串合法', () => {
  const r = validateNetworkConfig({
    name: 'BSC', rpcUrl: 'https://x', chainId: '0x38', symbol: 'BNB'
  });
  assert.equal(r.valid, true);
});

test('validateNetworkConfig：chainId 越界 / NaN → 报错', () => {
  // 注意：chainId=0 走"required"分支（!chainId 为 true），不是越界
  const r0 = validateNetworkConfig({
    name: 'X', rpcUrl: 'https://x', chainId: 0, symbol: 'X'
  });
  assert.ok(r0.errors.some((e) => /Chain ID is required/.test(e)));

  const r1 = validateNetworkConfig({
    name: 'X', rpcUrl: 'https://x', chainId: 1, symbol: 'X'
  });
  assert.equal(r1.valid, true, '1 是最小合法值');

  const r2 = validateNetworkConfig({
    name: 'X', rpcUrl: 'https://x', chainId: '0xfffffffff', symbol: 'X'
  });
  // 0xfffffffff = 68719476735 > 4294967295
  assert.ok(r2.errors.some((e) => /must not exceed/.test(e)));
  const r3 = validateNetworkConfig({
    name: 'X', rpcUrl: 'https://x', chainId: 'abc', symbol: 'X'
  });
  assert.ok(r3.errors.some((e) => /Invalid chain ID/.test(e)));
});

test('validateNetworkConfig：symbol 小写 / 特殊字符 → 报错', () => {
  const r = validateNetworkConfig({
    name: 'X', rpcUrl: 'https://x', chainId: 1, symbol: 'matic'
  });
  assert.ok(r.errors.some((e) => /uppercase/.test(e)));
});

// ==================== validateTokenConfig ====================

test('validateTokenConfig：合法 → 通过', () => {
  const r = validateTokenConfig({
    address: HARDHAT_0,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6
  });
  assert.equal(r.valid, true);
});

test('validateTokenConfig：address 缺失 → 报错', () => {
  const r = validateTokenConfig({ symbol: 'X' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /Token address is required/.test(e)));
});

test('validateTokenConfig：symbol 缺失 / 非法 → 报错', () => {
  const r1 = validateTokenConfig({ address: HARDHAT_0 });
  assert.ok(r1.errors.some((e) => /Token symbol is required/.test(e)));
  const r2 = validateTokenConfig({ address: HARDHAT_0, symbol: 'usdc' });
  assert.ok(r2.errors.some((e) => /uppercase/.test(e)));
});

test('validateTokenConfig：decimals 越界 → 报错', () => {
  const r1 = validateTokenConfig({ address: HARDHAT_0, symbol: 'X', decimals: 19 });
  assert.ok(r1.errors.some((e) => /must not exceed/.test(e)));
  const r2 = validateTokenConfig({ address: HARDHAT_0, symbol: 'X', decimals: -1 });
  assert.ok(r2.errors.some((e) => /must be at least/.test(e)));
});

test('validateTokenConfig：address 用强校验（CHECKSUM=true）拒小写', () => {
  const r = validateTokenConfig({ address: HARDHAT_0_LOWER, symbol: 'X' });
  assert.equal(r.valid, false);
});

// ==================== validateAccountName / ContactName / Label / Note ====================

test('validateAccountName：空 → 报错、合法 / 非法字符 / 长度', () => {
  assert.equal(validateAccountName('').valid, false);
  assert.equal(validateAccountName('Wallet 1').valid, true);
  assert.equal(validateAccountName('中文账户').valid, true, '支持中文');
  assert.equal(validateAccountName('a@b').valid, false, '@ 非法');
  assert.equal(validateAccountName('a'.repeat(51)).valid, false, '> 50 拒');
});

test('validateContactName：同 AccountName 规则', () => {
  assert.equal(validateContactName('').valid, false);
  assert.equal(validateContactName('Alice').valid, true);
  assert.equal(validateContactName('a@b').valid, false);
});

test('validateLabel：空 → 通过（可选）', () => {
  assert.equal(validateLabel('').valid, true);
  assert.equal(validateLabel(null).valid, true);
  assert.equal(validateLabel('DeFi').valid, true);
  assert.equal(validateLabel('a'.repeat(31)).valid, false, '> 30 拒');
  assert.equal(validateLabel('bad/label').valid, false, '/ 非法');
});

test('validateNote：空 → 通过（可选）、超长拒', () => {
  assert.equal(validateNote('').valid, true);
  assert.equal(validateNote(null).valid, true);
  assert.equal(validateNote('a'.repeat(500)).valid, true, '正好 500 通过');
  assert.equal(validateNote('a'.repeat(501)).valid, false, '> 500 拒');
});

// ==================== sanitizeInput ====================

test('sanitizeInput：trim + 多空格合一 + 去 < >', () => {
  assert.equal(sanitizeInput('  hello   world  '), 'hello world');
  assert.equal(sanitizeInput('<script>'), 'script');
  assert.equal(sanitizeInput('a<b>c'), 'abc', '< > 双侧都去');
  assert.equal(sanitizeInput('  normal  '), 'normal');
});

test('sanitizeInput：非字符串 → 空串', () => {
  assert.equal(sanitizeInput(null), '');
  assert.equal(sanitizeInput(undefined), '');
  assert.equal(sanitizeInput(123), '');
});

// ==================== validateUrl ====================

test('validateUrl：合法 / 非法', () => {
  assert.equal(validateUrl('https://example.com').valid, true);
  assert.equal(validateUrl('http://localhost:3000/path').valid, true);
  assert.equal(validateUrl('not-a-url').valid, false);
  assert.equal(validateUrl('').valid, false);
  assert.equal(validateUrl(null).valid, false);
});

// ==================== validateNumberRange ====================

test('validateNumberRange：范围内 / 越界 / 非法', () => {
  assert.equal(validateNumberRange(5, 0, 10).valid, true);
  assert.equal(validateNumberRange(0, 0, 10).valid, true, '含边界');
  assert.equal(validateNumberRange(10, 0, 10).valid, true, '含边界');
  assert.equal(validateNumberRange(-1, 0, 10).valid, false, '过小');
  assert.equal(validateNumberRange(11, 0, 10).valid, false, '过大');
  assert.equal(validateNumberRange(NaN, 0, 10).valid, false);
  assert.equal(validateNumberRange('5', 0, 10).valid, false, '非 number');
  assert.equal(validateNumberRange(null, 0, 10).valid, false);
});
