/**
 * common/utils/time-utils 纯函数单测（零依赖、零 DOM）
 * 运行：npm test
 *
 * 跨全栈时间显示：交易记录/操作历史的相对时间（如「3 分钟前」）、会话是否超时、
 * 当日起止/周首/月末。边界错了会让用户看到错位时间或判定有效状态出错。
 *
 * 为规避环境时区差异，断言使用 getHours/getDate/getDay/getTime 的「相对值」，
 * 不直接用本地字符串硬等。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getTimestamp,
  getTimestampSeconds,
  formatIsoTimestamp,
  formatLocaleDateTime,
  formatDate,
  formatRelativeTimeEn,
  formatDateOnly,
  formatTimeOnly,
  formatDuration,
  isTimeout,
  isValidTimestamp,
  getStartOfDay,
  getEndOfDay,
  getStartOfWeek,
  getStartOfMonth,
  getEndOfMonth,
  parseTimeString
} from '../js/common/utils/time-utils.js';

// ==================== getTimestamp / getTimestampSeconds ====================

test('getTimestamp：返回毫秒数且单调递增', async () => {
  const a = getTimestamp();
  await new Promise((r) => setTimeout(r, 5));
  const b = getTimestamp();
  assert.ok(b > a);
  assert.ok(a > 1_700_000_000_000, '应是现代时间');
});

test('getTimestampSeconds：截断到秒', () => {
  const s = getTimestampSeconds();
  assert.equal(Math.floor(s), s);
  assert.ok(s > 1_700_000_000);
});

// ==================== formatIsoTimestamp ====================

test('formatIsoTimestamp：标准 ISO 字符串', () => {
  const out = formatIsoTimestamp(0);
  assert.equal(out, '1970-01-01T00:00:00.000Z');
});

test('formatIsoTimestamp：缺省 → 当前时间', () => {
  const out = formatIsoTimestamp();
  assert.match(out, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

// ==================== formatLocaleDateTime ====================

test('formatLocaleDateTime：空 / null → 空串', () => {
  assert.equal(formatLocaleDateTime(null), '');
  assert.equal(formatLocaleDateTime(undefined), '');
  assert.equal(formatLocaleDateTime(''), '');
});

test('formatLocaleDateTime：Date / 毫秒 / 字符串均可', () => {
  const t = new Date('2024-06-15T12:00:00Z').getTime();
  const a = formatLocaleDateTime(new Date(t), { locale: 'en-US' });
  const b = formatLocaleDateTime(t, { locale: 'en-US' });
  const c = formatLocaleDateTime('2024-06-15T12:00:00Z', { locale: 'en-US' });
  for (const s of [a, b, c]) {
    assert.equal(typeof s, 'string');
    assert.ok(s.length > 0);
  }
});

// ==================== formatDate（中文 / relative / standard）====================

test('formatDate：缺省 / 0 → 空', () => {
  assert.equal(formatDate(0), '');
  assert.equal(formatDate(null), '');
});

test('formatDate("relative")：分桶', () => {
  const now = Date.now();
  assert.equal(formatDate(now - 5_000, 'relative'), '刚刚');
  assert.equal(formatDate(now - 90_000, 'relative'), '1 分钟前');
  assert.equal(formatDate(now - 90 * 60_000, 'relative'), '1 小时前');
  assert.equal(formatDate(now - 2 * 86_400_000, 'relative'), '2 天前');
  assert.equal(formatDate(now - 2 * 604_800_000, 'relative'), '2 周前');
  assert.equal(formatDate(now - 90 * 86_400_000, 'relative'), '3 个月前');
});

test('formatDate("relative")：未来 → "未来"', () => {
  assert.equal(formatDate(Date.now() + 60_000, 'relative'), '未来');
});

test('formatDate("zh")：同一年 → "MM月DD日 HH:mm"', () => {
  // 用当前年构造，避免跨年导致期望落到 else 分支
  const t = new Date(new Date().getFullYear(), 5, 15, 10, 30).getTime();
  const out = formatDate(t, 'zh');
  assert.match(out, /^\d{2}月\d{2}日 \d{2}:\d{2}$/);
});

test('formatDate("zh")：跨年 → "YYYY年MM月DD日 HH:mm"', () => {
  const t = new Date(2020, 0, 15, 10, 30).getTime();
  const out = formatDate(t, 'zh');
  assert.match(out, /^2020年\d{2}月\d{2}日 \d{2}:\d{2}$/);
});

test('formatDate(默认非 relative/zh)：standard → "YYYY-MM-DD HH:mm:ss"', () => {
  const t = new Date(2024, 0, 5, 7, 8, 9).getTime();
  assert.equal(formatDate(t, 'standard'), '2024-01-05 07:08:09');
});

// ==================== formatRelativeTimeEn ====================

test('formatRelativeTimeEn：单 / 复数 + "Just now"', () => {
  const now = Date.now();
  assert.equal(formatRelativeTimeEn(now - 3_000), 'Just now');
  assert.equal(formatRelativeTimeEn(now - 90_000), '1 minute ago', '单数不加 s');
  assert.equal(formatRelativeTimeEn(now - 2 * 60_000), '2 minutes ago');
  assert.equal(formatRelativeTimeEn(now - 3_600_000), '1 hour ago');
  assert.equal(formatRelativeTimeEn(now - 2 * 3_600_000), '2 hours ago');
  assert.equal(formatRelativeTimeEn(now - 86_400_000), '1 day ago');
  assert.equal(formatRelativeTimeEn(now - 3 * 86_400_000), '3 days ago');
});

test('formatRelativeTimeEn：空 / null → 空串', () => {
  assert.equal(formatRelativeTimeEn(null), '');
  assert.equal(formatRelativeTimeEn(undefined), '');
  assert.equal(formatRelativeTimeEn(''), '');
});

// ==================== formatDateOnly / formatTimeOnly ====================

test('formatDateOnly：YYYY-MM-DD 本地', () => {
  const t = new Date(2024, 0, 5).getTime();
  assert.equal(formatDateOnly(t), '2024-01-05');
});

test('formatTimeOnly：HH:mm:ss 本地', () => {
  const t = new Date(2024, 0, 1, 7, 8, 9).getTime();
  assert.equal(formatTimeOnly(t), '07:08:09');
});

// ==================== formatDuration ====================

test('formatDuration：ms / s / m+s / h+m / d+h', () => {
  assert.equal(formatDuration(500), '500ms');
  assert.equal(formatDuration(1_500), '1.50s');
  assert.equal(formatDuration(65_000), '1m 5s');
  assert.equal(formatDuration(3_661_000), '1h 1m'); // 3661s = 1h1m1s -> 1h 1m
  assert.equal(formatDuration(90_000_000), '1d 1h'); // 25h = 1d 1h
});

// ==================== isTimeout / isValidTimestamp ====================

test('isTimeout：未来 ts 视为未超时', () => {
  assert.equal(isTimeout(Date.now() + 10_000, 5000), false);
});

test('isTimeout：过期 ts 超时', () => {
  assert.equal(isTimeout(Date.now() - 10_000, 5000), true);
});

test('isValidTimestamp：差异 ≤ validity → true（含相等与对过去）', () => {
  assert.equal(isValidTimestamp(Date.now(), 1000), true);
  assert.equal(isValidTimestamp(Date.now() - 500, 1000), true);
});

test('isValidTimestamp：差异 > validity → false（对过去/未来均）', () => {
  assert.equal(isValidTimestamp(Date.now() - 2000, 1000), false);
  assert.equal(isValidTimestamp(Date.now() + 2000, 1000), false);
});

// ==================== getStartOfDay / getEndOfDay ====================

test('getStartOfDay：本地 00:00:00.000', () => {
  const t = new Date(2024, 5, 15, 12, 30, 45).getTime();
  const d = new Date(getStartOfDay(t));
  assert.equal(d.getFullYear(), 2024);
  assert.equal(d.getMonth(), 5);
  assert.equal(d.getDate(), 15);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getSeconds(), 0);
  assert.equal(d.getMilliseconds(), 0);
});

test('getEndOfDay：本地 23:59:59.999', () => {
  const t = new Date(2024, 5, 15).getTime();
  const d = new Date(getEndOfDay(t));
  assert.equal(d.getHours(), 23);
  assert.equal(d.getMinutes(), 59);
  assert.equal(d.getSeconds(), 59);
  assert.equal(d.getMilliseconds(), 999);
});

// ==================== getStartOfWeek（周一为周首）====================

test('getStartOfWeek：周一为周首', () => {
  // 2024-06-17 是周一
  const monday = new Date(2024, 5, 17, 14, 0).getTime();
  const sow = new Date(getStartOfWeek(monday));
  assert.equal(sow.getDay(), 1, '周首应是周一');
  assert.equal(sow.getDate(), 17);

  // 周三 → 同周周一
  const wed = new Date(2024, 5, 19).getTime();
  assert.equal(new Date(getStartOfWeek(wed)).getDate(), 17);

  // 周日 → 上周一（getDay()=0 时 diff = date-0+(-6) = date-6）
  const sun = new Date(2024, 5, 23).getTime();
  assert.equal(new Date(getStartOfWeek(sun)).getDate(), 17);
});

// ==================== getStartOfMonth / getEndOfMonth ====================

test('getStartOfMonth：当地 1 号 00:00:00.000', () => {
  const t = new Date(2024, 5, 15).getTime();
  const d = new Date(getStartOfMonth(t));
  assert.equal(d.getDate(), 1);
  assert.equal(d.getHours(), 0);
});

test('getEndOfMonth：6 月 → 30 日 23:59:59.999', () => {
  const d = new Date(getEndOfMonth(new Date(2024, 5, 15).getTime()));
  assert.equal(d.getMonth(), 5);
  assert.equal(d.getDate(), 30, '6 月 30 日');
  assert.equal(d.getHours(), 23);
});

test('getEndOfMonth：闰年 2 月 → 29 日', () => {
  const d = new Date(getEndOfMonth(new Date(2024, 1, 5).getTime()));
  assert.equal(d.getMonth(), 1);
  assert.equal(d.getDate(), 29);
});

test('getEndOfMonth：平年 2 月 → 28 日', () => {
  const d = new Date(getEndOfMonth(new Date(2023, 1, 5).getTime()));
  assert.equal(d.getDate(), 28);
});

// ==================== parseTimeString ====================

test('parseTimeString：中文相对时间（无方向）→ 仅毫秒数', () => {
  const r = parseTimeString('5 分钟');
  assert.equal(typeof r, 'number');
  // 5 * 60_000
  assert.equal(r, 5 * 60_000);
});

test('parseTimeString：中文 "X 单位前" → 当前 - offset', () => {
  const before = Date.now();
  const r = parseTimeString('10 分钟前');
  const after = Date.now();
  const expected = before - 10 * 60_000;
  assert.ok(r <= before - 10 * 60_000 + 5);
  assert.ok(r >= after - 10 * 60_000 - 5);
});

test('parseTimeString：中文 "X 单位后" → 当前 + offset', () => {
  const before = Date.now();
  const r = parseTimeString('2 小时后');
  assert.ok(r >= before + 2 * 3600_000 - 5);
  assert.ok(r <= Date.now() + 2 * 3600_000 + 5);
});

test('parseTimeString：年 / 周 / 秒 / 天 / 月', () => {
  // 1 年 ≈ 31536e6 ms
  assert.equal(parseTimeString('1 年'), 31_536_000_000);
  assert.equal(parseTimeString('3 天'), 3 * 86_400_000);
  assert.equal(parseTimeString('2 周'), 2 * 604_800_000);
  assert.equal(parseTimeString('30 秒'), 30_000);
  // 1 月固定 30 天（实现里的 2592e6）
  assert.equal(parseTimeString('1 月'), 2_592_000_000);
});

test('parseTimeString：标准日期字符串', () => {
  const r = parseTimeString('2024-06-15T10:00:00Z');
  assert.equal(typeof r, 'number');
  assert.equal(new Date(r).toISOString(), '2024-06-15T10:00:00.000Z');
});

test('parseTimeString：无法识别 → null', () => {
  assert.equal(parseTimeString('not-a-time'), null);
  assert.equal(parseTimeString(''), null);
});
