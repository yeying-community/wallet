/**
 * TransactionDomain.formatTransactionValue 单元测试
 *
 * 守门点（Tier 3 多链显示）：
 *   - EVM native：hex/十进制原始 wei → 18 位格式化 + "ETH" 单位
 *   - 非 EVM native（Tron/Solana/Bitcoin）：记录里 value 已是格式化展示串
 *     （"0.1 SOL" / "0.001 BTC" / "5 TRX"），必须原样透传（仅加 -/+ 前缀），
 *     不能再被当成 18 位 wei 解析成 "-0.000000 ETH"。
 *
 * 用 prototype 调用避免 BaseDomain 构造依赖（chrome API）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { TransactionDomain } from '../js/domain/transaction-domain.js';

// 复用真实 formatEther/formatUnits 实现，仅绕开构造函数。
const fake = {
  formatUnits: TransactionDomain.prototype.formatUnits,
  formatEther: TransactionDomain.prototype.formatEther
};
const format = (value, isSent) =>
  TransactionDomain.prototype.formatTransactionValue.call(fake, value, isSent);

test('EVM native：hex wei → 18 位 ETH（发送带 -）', () => {
  // 1e18 wei = 1 ETH
  assert.equal(format('0x' + (10n ** 18n).toString(16), true), '-1 ETH');
});

test('EVM native：十进制 wei 字符串 → 18 位 ETH（接收带 +）', () => {
  assert.equal(format((10n ** 18n).toString(), false), '+1 ETH');
});

test('非 EVM native：已格式化展示串原样透传（Solana）', () => {
  assert.equal(format('0.1 SOL', true), '-0.1 SOL');
  assert.equal(format('0.1 SOL', false), '+0.1 SOL');
});

test('非 EVM native：Bitcoin / Tron 展示串透传', () => {
  assert.equal(format('0.001 BTC', true), '-0.001 BTC');
  assert.equal(format('5 TRX', false), '+5 TRX');
});

test('空 value → 回退 0 ETH，不抛错', () => {
  assert.equal(format('', true), '-0.000000 ETH');
});
