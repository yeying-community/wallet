/**
 * common/utils 的 id-utils + number-utils 高频小工具单测（零依赖、零 DOM）
 * 运行：npm test
 *
 * generateId（18 处调用）是钱包/账户/记录等本地实体的主键来源——格式与唯一性
 * 出问题会撞键覆盖数据；number 的 clamp/isInRange/padNumber 用于 gas 滑杆、
 * 派生 index、时间补零等边界场景。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateId,
  generateShortId,
  generateUUID,
  generateNanoId
} from '../js/common/utils/id-utils.js';
import {
  clampNumber,
  isInRange,
  padNumber
} from '../js/common/utils/number-utils.js';

// ==================== generateId ====================

test('generateId：默认前缀 id_，含 timestamp 与随机段', () => {
  const id = generateId();
  assert.match(id, /^id_\d+_[a-z0-9]+$/);
});

test('generateId：自定义前缀', () => {
  assert.match(generateId('wallet'), /^wallet_\d+_[a-z0-9]+$/);
});

test('generateId：批量生成唯一（无碰撞）', () => {
  const set = new Set();
  for (let i = 0; i < 1000; i++) {
    set.add(generateId('acc'));
  }
  assert.equal(set.size, 1000, '1000 次生成应无重复');
});

// ==================== generateShortId ====================

test('generateShortId：带 / 不带前缀', () => {
  assert.match(generateShortId(), /^[a-z0-9]+$/);
  assert.match(generateShortId('s'), /^s_[a-z0-9]+$/);
});

// ==================== generateUUID ====================

test('generateUUID：UUID v4 格式', () => {
  const u = generateUUID();
  assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('generateUUID：批量唯一', () => {
  const set = new Set();
  for (let i = 0; i < 1000; i++) set.add(generateUUID());
  assert.equal(set.size, 1000);
});

// ==================== generateNanoId ====================

test('generateNanoId：n_ 前缀且唯一', () => {
  assert.match(generateNanoId(), /^n_\d+_\d+_[a-z0-9]+$/);
  assert.notEqual(generateNanoId(), generateNanoId());
});

// ==================== clampNumber ====================

test('clampNumber：夹在 [min,max]', () => {
  assert.equal(clampNumber(5, 0, 10), 5);
  assert.equal(clampNumber(-1, 0, 10), 0);
  assert.equal(clampNumber(99, 0, 10), 10);
  assert.equal(clampNumber(0, 0, 10), 0);
  assert.equal(clampNumber(10, 0, 10), 10);
});

// ==================== isInRange ====================

test('isInRange：闭区间', () => {
  assert.equal(isInRange(5, 0, 10), true);
  assert.equal(isInRange(0, 0, 10), true);
  assert.equal(isInRange(10, 0, 10), true);
  assert.equal(isInRange(-1, 0, 10), false);
  assert.equal(isInRange(11, 0, 10), false);
});

// ==================== padNumber ====================

test('padNumber：左侧补零', () => {
  assert.equal(padNumber(5), '05');
  assert.equal(padNumber(5, 3), '005');
  assert.equal(padNumber(123, 2), '123', '超长不截断');
  assert.equal(padNumber(0), '00');
});
