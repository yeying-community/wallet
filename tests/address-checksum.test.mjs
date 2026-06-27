/**
 * validateEthereumAddress EIP-55 校验和单测
 * 运行：npm test
 *
 * 关键回归：此前默认路径（requireChecksum=false）只跑正则，会放过混合大小写但
 * 校验和错误的地址（手抄/复制改了一位）。修复后默认即用 ethers.isAddress 的
 * EIP-55 语义：纯大小写放行、混合大小写必须校验和正确。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { validateEthereumAddress } from '../js/config/validation-rules.js';
import { ethers } from '../lib/ethers-6.16.esm.min.js';

const LOWER = '0x52908400098527886e0f7030069857d2e4169ee7';
const CHECKSUMMED = ethers.getAddress(LOWER); // 规范 EIP-55 形式
const UPPER = '0x' + LOWER.slice(2).toUpperCase();

function flipOneChecksumBit(addr) {
  // 找一个字母位翻转大小写，破坏校验和（数字位翻不动，跳过）
  const chars = addr.slice(2).split('');
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (/[a-z]/.test(c)) { chars[i] = c.toUpperCase(); return '0x' + chars.join(''); }
    if (/[A-Z]/.test(c)) { chars[i] = c.toLowerCase(); return '0x' + chars.join(''); }
  }
  return addr;
}

test('空地址 → 报错', () => {
  assert.equal(validateEthereumAddress('').valid, false);
  assert.equal(validateEthereumAddress(null).valid, false);
});

test('格式非法（长度/字符集）→ Invalid address format', () => {
  assert.equal(validateEthereumAddress('0x123').valid, false);
  assert.equal(validateEthereumAddress('not-an-address').valid, false);
  assert.equal(validateEthereumAddress('0x' + 'g'.repeat(40)).valid, false);
});

test('纯小写地址：默认放行（EIP-55 视为无校验和）', () => {
  const r = validateEthereumAddress(LOWER);
  assert.equal(r.valid, true);
});

test('纯大写地址：默认放行', () => {
  const r = validateEthereumAddress(UPPER);
  assert.equal(r.valid, true);
});

test('规范校验和地址：默认放行', () => {
  const r = validateEthereumAddress(CHECKSUMMED);
  assert.equal(r.valid, true);
});

test('★ 混合大小写但校验和错误：默认即拒绝（此前的漏洞）', () => {
  const bad = flipOneChecksumBit(CHECKSUMMED);
  assert.notEqual(bad, CHECKSUMMED, '测试前提：已构造一个不同于规范形式的混合大小写地址');
  const r = validateEthereumAddress(bad);
  assert.equal(r.valid, false, '坏校验和的混合大小写地址必须被拒绝');
  assert.match(r.error, /checksum/i);
});

test('requireChecksum=true：纯小写被拒绝（要求规范形式）', () => {
  assert.equal(validateEthereumAddress(LOWER, true).valid, false);
  assert.equal(validateEthereumAddress(CHECKSUMMED, true).valid, true);
});

test('requireChecksum=true：坏校验和被拒绝', () => {
  const bad = flipOneChecksumBit(CHECKSUMMED);
  assert.equal(validateEthereumAddress(bad, true).valid, false);
});
