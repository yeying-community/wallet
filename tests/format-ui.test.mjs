/**
 * common/chain/format-ui 纯函数单测（依赖 Intl，零 DOM）
 * 运行：npm test
 *
 * UI 展示层：余额小数规整、地址/交易哈希缩短、状态/网络配色、Intl 格式化。
 * 显示不对（余额少一位、地址多一位、颜色拿错）会直接影响用户决策。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatBalance,
  shortenAddress,
  formatTxHash,
  getStatusColor,
  getNetworkColor,
  formatNumber,
  formatCurrency,
  formatDate,
  formatTime,
  formatRelativeTime
} from '../js/common/chain/format-ui.js';
import { COLORS } from '../js/config/ui-config.js';

const HARDHAT_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// ==================== formatBalance ====================

test('formatBalance：保留 4 位并去除无意义的尾零', () => {
  assert.equal(formatBalance('1.5'), '1.5');
  assert.equal(formatBalance('1.0'), '1', '1.0000 → 1');
  assert.equal(formatBalance('1.234567'), '1.2346', '> 4 位四舍五入');
  assert.equal(formatBalance('0.000123'), '0.0001');
  assert.equal(formatBalance('0'), '0');
  assert.equal(formatBalance(0), '0');
  assert.equal(formatBalance(2.5), '2.5');
});

test('formatBalance：非法输入 → "0"（不抛）', () => {
  assert.equal(formatBalance('abc'), '0');
  assert.equal(formatBalance(null), '0');
  assert.equal(formatBalance(undefined), '0');
  assert.equal(formatBalance(''), '0');
});

test('formatBalance：自定义 decimals', () => {
  assert.equal(formatBalance('1.234567', 2), '1.23');
  assert.equal(formatBalance('1', 0), '1');
  assert.equal(formatBalance('1.5', 0), '2', 'toFixed(0) 四舍五入');
});

// ==================== shortenAddress（与 address-utils 不同：无格式校验）====================

test('shortenAddress：默认 length=10，start=5, end=5', () => {
  // 42 字符地址，> 10 → 走省略。slice(0,5)='0xf39' + slice(-5)='92266'
  assert.equal(shortenAddress(HARDHAT_0), '0xf39...92266');
});

test('shortenAddress：长度 <= length → 原样返回（无格式校验）', () => {
  // 注意：此实现与 address-utils.shortenAddress 行为不同——
  // format-ui 的版本不做 isValidAddress 校验，只看长度。
  assert.equal(shortenAddress('0x12345', 10), '0x12345', '短于 length 原样返回');
  assert.equal(shortenAddress('any-string', 100), 'any-string');
});

test('shortenAddress：空 / 假 → 空串', () => {
  assert.equal(shortenAddress(''), '');
  assert.equal(shortenAddress(null), '');
  assert.equal(shortenAddress(undefined), '');
});

test('shortenAddress：自定义 length 的 start/end 分割（floor(length/2)）', () => {
  // length=8 → start=4, end=4
  assert.equal(shortenAddress(HARDHAT_0, 8), '0xf3...2266');
  // length=11 → start=5, end=6
  assert.equal(shortenAddress(HARDHAT_0, 11), '0xf39...b92266');
  // length=9 → start=4, end=5
  assert.equal(shortenAddress(HARDHAT_0, 9), '0xf3...92266');
});

// ==================== formatTxHash ====================

test('formatTxHash：等价于 shortenAddress(hash, 16) → start=8, end=8', () => {
  const hash = '0x' + 'a'.repeat(64);
  assert.equal(formatTxHash(hash), '0xaaaaaa...aaaaaaaa');
  // 验证参数确实是 16
  assert.equal(formatTxHash(hash), shortenAddress(hash, 16));
});

// ==================== getStatusColor ====================

test('getStatusColor：known / unknown → 回落 info', () => {
  assert.equal(getStatusColor('pending'), COLORS.pending);
  assert.equal(getStatusColor('confirmed'), COLORS.confirmed);
  assert.equal(getStatusColor('failed'), COLORS.failed);
  assert.equal(getStatusColor('success'), COLORS.success);
  assert.equal(getStatusColor('danger'), COLORS.danger);
  assert.equal(getStatusColor('unknown-xyz'), COLORS.info, '未识别回落 info');
  assert.equal(getStatusColor(null), COLORS.info);
});

// ==================== getNetworkColor ====================

test('getNetworkColor：mainnet/testnet/其他', () => {
  assert.equal(getNetworkColor('mainnet'), COLORS.mainnet);
  assert.equal(getNetworkColor('testnet'), COLORS.testnet);
  // 其他（custom / 未知）回落 custom
  assert.equal(getNetworkColor('custom'), COLORS.custom);
  assert.equal(getNetworkColor('other'), COLORS.custom);
  assert.equal(getNetworkColor(null), COLORS.custom);
});

// ==================== formatNumber ====================

test('formatNumber：默认 locale en-US、千分位', () => {
  assert.equal(formatNumber(1234.5), '1,234.5');
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(1_000_000), '1,000,000');
});

test('formatNumber：自定义 locale / minimumFractionDigits', () => {
  assert.equal(formatNumber(1234.5, { locale: 'de-DE' }), '1.234,5');
  assert.equal(formatNumber(1.5, { minimumFractionDigits: 4 }), '1.5000');
});

// ==================== formatCurrency ====================

test('formatCurrency：带 / 不带 symbol（默认 2 位小数）', () => {
  assert.equal(formatCurrency(1.234, 'USDC'), '1.234 USDC');
  assert.equal(formatCurrency(0.5, '$'), '0.50 $');
  // 默认 minimumFractionDigits=2：即使无 symbol 也补 0
  assert.equal(formatCurrency(100, ''), '100.00');
  assert.equal(formatCurrency(0, ''), '0.00');
});

test('formatCurrency：默认 2-6 位小数（minimumFractionDigits=2）', () => {
  assert.equal(formatCurrency(1, 'USD'), '1.00 USD', '整数补 0');
  // 注：maximumFractionDigits=6 不会截断
  const out = formatCurrency(1.2345678, 'X');
  assert.match(out, /^1\.\d{4,6} X$/);
});

// ==================== formatDate / formatTime ====================

test('formatDate：默认 medium date + short time（en-US）', () => {
  // 用本地化字符串断言（不锁死精确格式，Intl 区域可能微调）
  const out = formatDate('2024-06-15T10:30:00Z');
  assert.equal(typeof out, 'string');
  assert.ok(out.length > 0);
  assert.ok(out.includes('2024') || /\d{1,2}\/\d{1,2}/.test(out), '含日期部分');
});

test('formatTime：HH:mm:ss（en-US, 2-digit）', () => {
  const out = formatTime('2024-06-15T10:30:45Z');
  assert.match(out, /\d{1,2}:\d{2}:\d{2}/);
});

test('formatDate / formatTime：自定义 locale 透传', () => {
  // 不抛，且返回非空字符串
  const a = formatDate('2024-06-15T10:30:00Z', { locale: 'zh-CN' });
  const b = formatTime('2024-06-15T10:30:45Z', { locale: 'zh-CN' });
  assert.ok(a.length > 0);
  assert.ok(b.length > 0);
});

// ==================== formatRelativeTime ====================

test('formatRelativeTime：英文相对时间（与 time-utils 一致）', () => {
  const now = Date.now();
  assert.equal(formatRelativeTime(now - 3_000), 'Just now');
  assert.equal(formatRelativeTime(now - 90_000), '1 minute ago');
  assert.equal(formatRelativeTime(now - 2 * 3_600_000), '2 hours ago');
  assert.equal(formatRelativeTime(now - 3 * 86_400_000), '3 days ago');
});
