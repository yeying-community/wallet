/**
 * 存储迁移骨架单测（零依赖，Node 内置 runner）
 * 运行：node --test --test-force-exit "tests/*.test.mjs"
 *
 * 覆盖：
 * - mutation-events pub/sub（通知 / 退订 / 异常隔离）
 * - backend 迁移状态机（已迁跳过 / 成功切 idb / 失败保持 chrome / 校验不符保持 chrome）
 *   —— 全部用注入的 fake IO，不依赖真实 IndexedDB。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// backend.js 经 storage-base/indexeddb-base 间接 import chrome —— 提供最小 mock 以便加载。
globalThis.chrome = globalThis.chrome || {
  runtime: { id: 'test' },
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {}, clear: async () => {} }, onChanged: { addListener() {} } }
};

const { notifyMutation, onMutation, _resetMutationListeners } = await import('../js/storage/mutation-events.js');
const { migrateCollectionsToIdb, getStorageBackend, _setStorageBackend, initStorageBackend } =
  await import('../js/storage/backend.js');

// ==================== mutation-events ====================

test('onMutation 收到通知，退订后不再收到', () => {
  _resetMutationListeners();
  const seen = [];
  const off = onMutation((collection, detail) => seen.push([collection, detail]));
  notifyMutation('accounts', { id: 'a1' });
  notifyMutation('wallets');
  off();
  notifyMutation('networks');
  assert.deepEqual(seen, [['accounts', { id: 'a1' }], ['wallets', undefined]]);
});

test('一个订阅者抛错不影响其它订阅者与通知方', () => {
  _resetMutationListeners();
  const seen = [];
  onMutation(() => { throw new Error('boom'); });
  onMutation((c) => seen.push(c));
  assert.doesNotThrow(() => notifyMutation('accounts'));
  assert.deepEqual(seen, ['accounts']);
});

// ==================== 迁移状态机 ====================

function fakeDeps(overrides = {}) {
  const calls = { wrote: false, flagSet: null, verified: false };
  const deps = {
    getFlag: async () => false,
    setFlag: async (v) => { calls.flagSet = v; },
    readChrome: async () => ({ wallets: { w1: { id: 'w1' } }, accounts: { a1: { id: 'a1' } }, networks: [{ chainId: '0x1' }] }),
    writeIdb: async () => { calls.wrote = true; },
    verify: async () => { calls.verified = true; return true; },
    onError: () => {},
    ...overrides
  };
  return { deps, calls };
}

test('已迁（flag=true）→ 返回 idb 且跳过读写', async () => {
  const { deps, calls } = fakeDeps({ getFlag: async () => true });
  const result = await migrateCollectionsToIdb(deps);
  assert.equal(result, 'idb');
  assert.equal(calls.wrote, false, '已迁不应再写');
  assert.equal(calls.flagSet, null, '已迁不应重设 flag');
});

test('迁移成功（写入+校验通过）→ 设 flag、返回 idb', async () => {
  const { deps, calls } = fakeDeps();
  const result = await migrateCollectionsToIdb(deps);
  assert.equal(result, 'idb');
  assert.equal(calls.wrote, true);
  assert.equal(calls.verified, true);
  assert.equal(calls.flagSet, true);
});

test('写入抛错 → 返回 chrome、不设 flag', async () => {
  const { deps, calls } = fakeDeps({ writeIdb: async () => { throw new Error('idb write failed'); } });
  const result = await migrateCollectionsToIdb(deps);
  assert.equal(result, 'chrome', '失败必须回退 chrome');
  assert.equal(calls.flagSet, null, '失败不得设 flag（下次重试）');
});

test('回读校验不符 → 返回 chrome、不设 flag', async () => {
  const { deps, calls } = fakeDeps({ verify: async () => false });
  const result = await migrateCollectionsToIdb(deps);
  assert.equal(result, 'chrome');
  assert.equal(calls.flagSet, null);
});

test('读 chrome 抛错 → 返回 chrome', async () => {
  const { deps } = fakeDeps({ readChrome: async () => { throw new Error('read failed'); } });
  assert.equal(await migrateCollectionsToIdb(deps), 'chrome');
});

test('initStorageBackend 按迁移结果设置模块后端', async () => {
  _setStorageBackend('chrome');
  const { deps } = fakeDeps();
  await initStorageBackend(deps);
  assert.equal(getStorageBackend(), 'idb');

  _setStorageBackend('chrome');
  const fail = fakeDeps({ writeIdb: async () => { throw new Error('x'); } });
  await initStorageBackend(fail.deps);
  assert.equal(getStorageBackend(), 'chrome', '迁移失败后端保持 chrome');
});
