import test from 'node:test';
import assert from 'node:assert/strict';

const store = {};
const windows = new Map();
const tabs = new Map();
let nextWindowId = 100;
let nextTabId = 1000;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return clone(store);
        if (typeof keys === 'string') return { [keys]: clone(store[keys]) };
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.map((key) => [key, clone(store[key])]));
        }
        return Object.fromEntries(
          Object.keys(keys).map((key) => [key, store[key] !== undefined ? clone(store[key]) : keys[key]])
        );
      },
      async set(items) {
        Object.assign(store, clone(items || {}));
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
    getContexts: async () => [],
    sendMessage: async () => ({ success: true })
  },
  tabs: {
    async get(tabId) {
      return tabs.get(tabId) || { id: tabId, active: true, windowId: 1 };
    },
    async query(queryInfo) {
      return [...tabs.values()].filter((tab) => !Number.isFinite(queryInfo?.windowId) || tab.windowId === queryInfo.windowId);
    },
    async update(tabId, updates) {
      const tab = tabs.get(tabId) || { id: tabId, windowId: 1, active: true };
      Object.assign(tab, updates || {});
      tabs.set(tabId, tab);
      return clone(tab);
    }
  },
  windows: {
    onRemoved: {
      addListener() {},
      removeListener() {}
    },
    async get(windowId) {
      return windows.get(windowId) || { id: windowId, focused: true };
    },
    async update(windowId, updates) {
      const win = windows.get(windowId) || { id: windowId, focused: true };
      Object.assign(win, updates || {});
      windows.set(windowId, win);
      return clone(win);
    },
    create(options, callback) {
      const id = nextWindowId += 1;
      const tabId = nextTabId += 1;
      const tab = { id: tabId, windowId: id, active: true, url: options?.url || '' };
      const win = { id, focused: Boolean(options?.focused), tabs: [tab] };
      windows.set(id, win);
      tabs.set(tabId, tab);
      callback(clone(win));
    },
    async remove(windowId) {
      windows.delete(windowId);
    }
  }
};

const { routeRequest } = await import('../js/background/request-router.js');
const { recordApprovalResponse } = await import('../js/background/approval-flow.js');
const { resetState, state } = await import('../js/background/state.js');
const { mpcService } = await import('../js/background/mpc-service.js');
const { setMpcTssEngineForTests, resetMpcTssEngineForTests } = await import('../js/background/mpc-tss-engine.js');
const {
  saveAccount,
  saveMpcKeyShare,
  saveMpcWallet,
  setSelectedAccountId
} = await import('../js/storage/index.js');

test.beforeEach(async () => {
  await chrome.storage.local.clear();
  windows.clear();
  tabs.clear();
  nextWindowId = 100;
  nextTabId = 1000;
  resetState();
  resetMpcTssEngineForTests();
  mpcService._wireSessionCursors.clear();
  mpcService._wireSessionAdapters.clear();
});

test.afterEach(() => {
  resetMpcTssEngineForTests();
});

test('routeRequest eth_sendTransaction 对 MPC 钱包签名后广播 raw transaction 并返回 hash', async () => {
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });
  await setSelectedAccountId('account-1');
  state.keyring = new Map([['account-1', { signMessage: async (message) => `signed:${message}` }]]);
  state.currentRpcUrl = 'http://127.0.0.1:8545';

  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'active',
    address: '0x1111111111111111111111111111111111111111',
    publicKey: '03abcdef',
    keygenSessionId: 'session-1',
    keyVersion: 1,
    shareVersion: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
  });
  await saveMpcKeyShare({
    id: 'share-1',
    walletId: 'mpc-wallet-1',
    sessionId: 'session-1',
    participantId: '0x1111111111111111111111111111111111111111',
    participantIndex: 0,
    share: { secret: 'local-share' },
    completeKeyShare: { secret: 'complete-local-share' },
    keyVersion: 1,
    shareVersion: 1,
  });

  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    fetchMessages: async () => ({ messages: [], nextSequence: 0 })
  };
  setMpcTssEngineForTests({
    async startSign(input) {
      return {
        sessionId: input.sessionId,
        requestId: input.requestId,
        senderIndex: input.senderIndex,
        protocol: 'sign',
        result: {
          status: 'completed',
          requestId: input.requestId,
          signature: {
            r: `0x${'11'.repeat(32)}`,
            s: `0x${'22'.repeat(32)}`
          },
          recoveryId: 0
        }
      };
    },
    async receiveMessage({ state }) {
      return state;
    },
    async advance({ state }) {
      return state;
    },
    async getOutgoingMessages() {
      return [];
    },
    async getResult({ state }) {
      return state.result;
    }
  });

  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: `0x${'34'.repeat(32)}`
    }), { status: 200 });
  };

  try {
    const routePromise = routeRequest('eth_sendTransaction', [{
      from: '0x1111111111111111111111111111111111111111',
      to: '0x2222222222222222222222222222222222222222',
      value: '0x0',
      nonce: 0,
      gasLimit: '0x5208',
      gasPrice: '0x1',
      chainId: 1,
    }], {
      origin: 'https://dapp.example',
      tabId: 1,
      clientRequestId: 'rpc-1'
    });

    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const poll = () => {
        const pendingId = [...state.pendingRequests.keys()][0];
        if (pendingId) {
          recordApprovalResponse(pendingId, { approved: true });
          resolve();
          return;
        }
        if (Date.now() - startedAt > 1000) {
          reject(new Error('approval request was not created'));
          return;
        }
        setTimeout(poll, 0);
      };
      poll();
    });

    const hash = await routePromise;

    assert.equal(hash, `0x${'34'.repeat(32)}`);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'http://127.0.0.1:8545');
    assert.equal(fetchCalls[0].body.method, 'eth_sendRawTransaction');
    assert.match(fetchCalls[0].body.params[0], /^0x/);
  } finally {
    globalThis.fetch = originalFetch;
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});
