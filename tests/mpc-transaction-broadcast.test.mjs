import test from 'node:test';
import assert from 'node:assert/strict';

const store = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return structuredClone(store);
        if (typeof keys === 'string') return { [keys]: structuredClone(store[keys]) };
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.map((key) => [key, structuredClone(store[key])]));
        }
        return Object.fromEntries(
          Object.keys(keys).map((key) => [key, store[key] !== undefined ? structuredClone(store[key]) : keys[key]])
        );
      },
      async set(items) {
        Object.assign(store, structuredClone(items || {}));
      },
      async remove(keys) {
        (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete store[key]);
      },
      async clear() {
        Object.keys(store).forEach((key) => delete store[key]);
      }
    },
    onChanged: {
      addListener() {},
      removeListener() {}
    }
  },
  runtime: {
    getURL: (path) => `chrome-extension://test/${path}`,
    getContexts: async () => []
  },
  tabs: {
    get: async () => ({ active: true, windowId: 1 })
  },
  windows: {
    get: async () => ({ focused: true }),
    update: async () => ({})
  }
};

const { broadcastSignedTransaction } = await import('../js/background/request-router.js');
const { resetState, state } = await import('../js/background/state.js');

test.beforeEach(async () => {
  await chrome.storage.local.clear();
  resetState();
});

test('broadcastSignedTransaction 使用当前 RPC 广播 raw transaction 并返回 hash', async () => {
  state.currentRpcUrl = 'http://127.0.0.1:8545';
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: `0x${'12'.repeat(32)}`
    }), { status: 200 });
  };

  try {
    const hash = await broadcastSignedTransaction(`0x${'ab'.repeat(10)}`);

    assert.equal(hash, `0x${'12'.repeat(32)}`);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:8545');
    assert.equal(calls[0].body.method, 'eth_sendRawTransaction');
    assert.deepEqual(calls[0].body.params, [`0x${'ab'.repeat(10)}`]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('broadcastSignedTransaction 会透传 RPC 错误消息', async () => {
  state.currentRpcUrl = 'http://127.0.0.1:8545';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32000, message: 'insufficient funds' }
  }), { status: 200 });

  try {
    await assert.rejects(
      () => broadcastSignedTransaction(`0x${'ab'.repeat(10)}`),
      (error) => error?.message === 'insufficient funds'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
