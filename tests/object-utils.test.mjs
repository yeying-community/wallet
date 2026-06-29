/**
 * common/utils/object-utils 纯函数单测（零依赖、零 DOM）
 * 运行：npm test
 *
 * 这些是全栈高频工具（deepClone 7 处、pick 9 处、omit 5 处、deepMerge 4 处等）：
 * 状态克隆、配置合并、对外裁剪字段（如剔除 privateKey/mnemonic）。
 * 误删/误改字段或浅拷贝共享引用会引入难查的状态污染与潜在密钥泄露。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deepClone,
  deepMerge,
  getNestedValue,
  setNestedValue,
  pick,
  omit,
  isEmptyObject
} from '../js/common/utils/object-utils.js';

// ==================== deepClone ====================

test('deepClone：嵌套对象/数组深拷贝，不共享引用', () => {
  const src = { a: 1, b: { c: [1, 2, { d: 3 }] } };
  const out = deepClone(src);
  assert.deepEqual(out, src);
  out.b.c[2].d = 99;
  assert.equal(src.b.c[2].d, 3, '改副本不影响源');
});

test('deepClone：Date / Map / Set', () => {
  const d = new Date('2020-01-02T03:04:05Z');
  const cd = deepClone(d);
  assert.ok(cd instanceof Date);
  assert.equal(cd.getTime(), d.getTime());
  assert.notEqual(cd, d);

  const m = new Map([['k', { v: 1 }]]);
  const cm = deepClone(m);
  assert.ok(cm instanceof Map);
  cm.get('k').v = 2;
  assert.equal(m.get('k').v, 1, 'Map 值也深拷贝');

  const s = new Set([1, 2]);
  const cs = deepClone(s);
  assert.ok(cs instanceof Set);
  assert.deepEqual([...cs], [1, 2]);
});

test('deepClone：null / undefined / 基本类型原样返回', () => {
  assert.equal(deepClone(null), null);
  assert.equal(deepClone(undefined), undefined);
  assert.equal(deepClone(42), 42);
  assert.equal(deepClone('x'), 'x');
});

// ==================== deepMerge ====================

test('deepMerge：递归合并嵌套对象', () => {
  const target = { a: 1, nested: { x: 1, y: 2 } };
  const out = deepMerge(target, { b: 2, nested: { y: 20, z: 30 } });
  assert.deepEqual(out, { a: 1, b: 2, nested: { x: 1, y: 20, z: 30 } });
});

test('deepMerge：多个源依次合并，后者覆盖前者', () => {
  const out = deepMerge({ a: 1 }, { a: 2 }, { a: 3, b: 1 });
  assert.deepEqual(out, { a: 3, b: 1 });
});

test('deepMerge：无源 / 非对象源 → 返回 target', () => {
  const t = { a: 1 };
  assert.equal(deepMerge(t), t);
  assert.deepEqual(deepMerge({ a: 1 }, null), { a: 1 });
});

// ==================== getNestedValue ====================

test('getNestedValue：点路径取值，缺失走默认', () => {
  const obj = { a: { b: { c: 42 } } };
  assert.equal(getNestedValue(obj, 'a.b.c'), 42);
  assert.equal(getNestedValue(obj, 'a.b.x', 'def'), 'def');
  assert.equal(getNestedValue(obj, 'a.x.y', 'def'), 'def', '中途断链走默认');
  assert.equal(getNestedValue(null, 'a', 'def'), 'def');
  assert.equal(getNestedValue(obj, '', 'def'), 'def');
});

test('getNestedValue：存在但值为 falsy 时返回该值而非默认', () => {
  const obj = { a: { b: 0 } };
  assert.equal(getNestedValue(obj, 'a.b', 'def'), 0);
});

// ==================== setNestedValue ====================

test('setNestedValue：写入并按需创建中间对象', () => {
  const obj = {};
  setNestedValue(obj, 'a.b.c', 42);
  assert.deepEqual(obj, { a: { b: { c: 42 } } });
});

test('setNestedValue：覆盖非对象中间节点', () => {
  const obj = { a: 1 };
  setNestedValue(obj, 'a.b', 2);
  assert.deepEqual(obj, { a: { b: 2 } });
});

test('setNestedValue：空 obj / 空 path 原样返回', () => {
  assert.equal(setNestedValue(null, 'a', 1), null);
  const o = { a: 1 };
  assert.equal(setNestedValue(o, '', 1), o);
});

// ==================== pick / omit ====================

test('pick：仅保留存在的键', () => {
  const obj = { a: 1, b: 2, c: 3 };
  assert.deepEqual(pick(obj, ['a', 'c']), { a: 1, c: 3 });
  assert.deepEqual(pick(obj, ['a', 'zzz']), { a: 1 }, '不存在的键被忽略');
  assert.deepEqual(pick(obj, []), {});
  assert.deepEqual(pick(null, ['a']), {});
  assert.deepEqual(pick(obj, 'a'), {}, 'keys 非数组 → {}');
});

test('omit：剔除指定键（典型用途：导出前去掉 privateKey/mnemonic）', () => {
  const account = { id: '1', address: '0xabc', privateKey: 'SECRET', mnemonic: 'SEED' };
  const safe = omit(account, ['privateKey', 'mnemonic']);
  assert.deepEqual(safe, { id: '1', address: '0xabc' });
  assert.equal('privateKey' in safe, false);
});

test('omit：非法 keys → 原样返回', () => {
  const o = { a: 1 };
  assert.equal(omit(o, null), o);
  assert.equal(omit(null, ['a']), null);
});

test('pick / omit：不修改原对象', () => {
  const obj = { a: 1, b: 2 };
  pick(obj, ['a']);
  omit(obj, ['a']);
  assert.deepEqual(obj, { a: 1, b: 2 });
});

// ==================== isEmptyObject ====================

test('isEmptyObject', () => {
  assert.equal(isEmptyObject({}), true);
  assert.equal(isEmptyObject({ a: 1 }), false);
  assert.equal(isEmptyObject(null), true);
  assert.equal(isEmptyObject(undefined), true);
  assert.equal(isEmptyObject('not-obj'), true);
});
