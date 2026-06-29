/**
 * diagnostics 诊断日志环单测（零依赖，Node 内置 runner）
 * 运行：node --test --test-force-exit "tests/*.test.mjs"
 *
 * 重点验证：opt-in 关闭时 no-op、容量上限、敏感字段脱敏、clear。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// chrome.storage mock（diagnostics 经 storage 读写开关）
const store = {};
globalThis.chrome = {
  runtime: { id: 'test', getURL: (p = '') => `chrome-extension://test/${p}`, sendMessage: async () => ({ success: true }) },
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return { ...store };
        if (typeof keys === 'string') return { [keys]: store[keys] };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, store[k]]));
        return Object.fromEntries(Object.keys(keys).map((k) => [k, store[k] !== undefined ? store[k] : keys[k]]));
      },
      async set(items) { Object.assign(store, items || {}); },
      async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]); },
      async clear() { Object.keys(store).forEach((k) => delete store[k]); }
    },
    onChanged: { addListener() {}, removeListener() {} }
  }
};

const { diagnostics } = await import('../js/background/diagnostics.js');

test('默认关闭：record 为 no-op', () => {
  diagnostics.clear();
  assert.equal(diagnostics.isEnabled(), false);
  diagnostics.record({ category: 'unlock', message: 'should be dropped' });
  assert.deepEqual(diagnostics.getEntries(), []);
});

test('开启后可记录，getEntries 最近在前', async () => {
  await diagnostics.setEnabled(true);
  diagnostics.clear();
  diagnostics.record({ category: 'rpc', action: 'eth_call', message: 'first' });
  diagnostics.record({ category: 'rpc', action: 'eth_call', message: 'second' });
  const entries = diagnostics.getEntries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].message, 'second', '最近的在前');
  assert.equal(entries[1].message, 'first');
  assert.equal(entries[0].category, 'rpc');
});

test('容量上限 200：超出丢弃最旧', async () => {
  await diagnostics.setEnabled(true);
  diagnostics.clear();
  for (let i = 0; i < 250; i++) {
    diagnostics.record({ category: 'test', message: `m${i}` });
  }
  const entries = diagnostics.getEntries();
  assert.equal(entries.length, 200, '环形缓冲应封顶 200');
  assert.equal(entries[0].message, 'm249', '保留最新');
  assert.equal(entries[199].message, 'm50', '最旧 50 条被丢弃');
});

test('脱敏：敏感键被剔除，标量保留，非标量忽略', async () => {
  await diagnostics.setEnabled(true);
  diagnostics.clear();
  diagnostics.record({
    category: 'sign',
    message: 'signing',
    meta: {
      method: 'personal_sign',
      origin: 'https://app.example',
      chainId: 1,
      ok: true,
      password: 'hunter2',
      privateKey: '0xdeadbeef',
      mnemonic: 'test test ...',
      token: 'ucan-xyz',
      signature: '0xsig',
      nested: { secret: 'x' }
    }
  });
  const [entry] = diagnostics.getEntries();
  assert.deepEqual(entry.meta, {
    method: 'personal_sign',
    origin: 'https://app.example',
    chainId: 1,
    ok: true
  }, '只保留非敏感标量；password/privateKey/mnemonic/token/signature 与嵌套对象均被剔除');
});

test('长字符串截断', async () => {
  await diagnostics.setEnabled(true);
  diagnostics.clear();
  diagnostics.record({ category: 'test', message: 'x'.repeat(500), meta: { note: 'y'.repeat(500) } });
  const [entry] = diagnostics.getEntries();
  assert.ok(entry.message.length <= 201, 'message 截断到 ~200');
  assert.ok(entry.message.endsWith('…'));
  assert.ok(entry.meta.note.length <= 201);
});

test('关闭时清空缓冲并停止记录', async () => {
  await diagnostics.setEnabled(true);
  diagnostics.clear();
  diagnostics.record({ category: 'test', message: 'before' });
  assert.equal(diagnostics.getEntries().length, 1);
  await diagnostics.setEnabled(false);
  assert.deepEqual(diagnostics.getEntries(), [], '关闭即清空');
  diagnostics.record({ category: 'test', message: 'after' });
  assert.deepEqual(diagnostics.getEntries(), [], '关闭后不再记录');
});

test('init 从存储读取开关', async () => {
  store.user_settings = { diagnosticsEnabled: true };
  await diagnostics.init();
  assert.equal(diagnostics.isEnabled(), true);
  // 复位，避免影响其它用例顺序
  await diagnostics.setEnabled(false);
});
