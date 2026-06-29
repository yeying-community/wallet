/**
 * common/utils/json-utils 纯函数单测（零依赖、零 DOM）
 * 运行：npm test
 *
 * safeJsonParse/Stringify/jsonClone/isValidJson 是存储读写与消息序列化的地基；
 * BigInt 序列化（serializeBigInt/stringifyWithBigInt/parseWithBigInt）用于在
 * JSON 中安全携带 wei/余额等大整数——直接 JSON.stringify(BigInt) 会抛错。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  safeJsonParse,
  safeJsonStringify,
  jsonClone,
  isValidJson,
  serializeBigInt,
  deserializeBigInt,
  stringifyWithBigInt,
  parseWithBigInt
} from '../js/common/utils/json-utils.js';

// ==================== safeJsonParse ====================

test('safeJsonParse：合法 JSON → 对象', () => {
  assert.deepEqual(safeJsonParse('{"a":1}'), { a: 1 });
  assert.deepEqual(safeJsonParse('[1,2,3]'), [1, 2, 3]);
});

test('safeJsonParse：非法 / 空 / 非字符串 → 默认值（不抛）', () => {
  assert.equal(safeJsonParse('{bad', null), null);
  assert.equal(safeJsonParse('', 'def'), 'def');
  assert.equal(safeJsonParse(null, 'def'), 'def');
  assert.deepEqual(safeJsonParse(undefined, []), []);
});

// ==================== safeJsonStringify ====================

test('safeJsonStringify：普通对象', () => {
  assert.equal(safeJsonStringify({ a: 1 }), '{"a":1}');
  assert.equal(safeJsonStringify({ a: 1 }, '{}', 2), '{\n  "a": 1\n}');
});

test('safeJsonStringify：循环引用 → 默认值（不抛）', () => {
  const o = {};
  o.self = o;
  assert.equal(safeJsonStringify(o, 'FALLBACK'), 'FALLBACK');
});

// ==================== jsonClone ====================

test('jsonClone：深拷贝且不共享引用', () => {
  const src = { a: { b: [1, 2] } };
  const out = jsonClone(src);
  assert.deepEqual(out, src);
  out.a.b.push(3);
  assert.deepEqual(src.a.b, [1, 2]);
});

// ==================== isValidJson ====================

test('isValidJson', () => {
  assert.equal(isValidJson('{"a":1}'), true);
  assert.equal(isValidJson('null'), true);
  assert.equal(isValidJson('{bad'), false);
  assert.equal(isValidJson(''), false);
  assert.equal(isValidJson(null), false);
});

// ==================== BigInt 序列化 ====================

test('serializeBigInt：BigInt → {__type,value}，嵌套递归', () => {
  assert.deepEqual(serializeBigInt(123n), { __type: 'BigInt', value: '123' });
  assert.deepEqual(
    serializeBigInt({ wei: 1000000000000000000n, n: 'x' }),
    { wei: { __type: 'BigInt', value: '1000000000000000000' }, n: 'x' }
  );
  assert.deepEqual(serializeBigInt([1n, 2n]), [
    { __type: 'BigInt', value: '1' },
    { __type: 'BigInt', value: '2' }
  ]);
});

test('deserializeBigInt：还原 BigInt', () => {
  assert.equal(deserializeBigInt({ __type: 'BigInt', value: '123' }), 123n);
  const out = deserializeBigInt({ wei: { __type: 'BigInt', value: '5' } });
  assert.equal(out.wei, 5n);
});

test('stringify/parseWithBigInt：往返保 BigInt（含巨大 wei 值）', () => {
  const src = { value: 12345678901234567890n, label: 'bal' };
  const json = stringifyWithBigInt(src);
  assert.equal(typeof json, 'string');
  const restored = parseWithBigInt(json);
  assert.equal(restored.value, 12345678901234567890n);
  assert.equal(restored.label, 'bal');
});

test('原生 JSON.stringify(BigInt) 会抛 —— 故需 stringifyWithBigInt', () => {
  assert.throws(() => JSON.stringify({ v: 1n }), TypeError);
  assert.doesNotThrow(() => stringifyWithBigInt({ v: 1n }));
});
