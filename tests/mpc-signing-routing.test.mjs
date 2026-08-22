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
  }
};

const {
  getMpcAccountId,
  resolveMpcAccountIdByAddress,
  signMessage,
  signTransaction,
  signTypedData
} = await import('../js/background/signing.js');
const { resetMpcTssEngineForTests, setMpcTssEngineForTests } = await import('../js/background/mpc-tss-engine.js');
const { mpcService } = await import('../js/background/mpc-service.js');
const {
  getMpcSignRequest,
  getMpcSignRequests,
  saveAccount,
  saveMpcKeyShare,
  saveMpcWallet,
  setSelectedAccountId,
  updateUserSettings
} = await import('../js/storage/index.js');
const { resetState, state } = await import('../js/background/state.js');

test.beforeEach(async () => {
  await chrome.storage.local.clear();
  resetState();
  resetMpcTssEngineForTests();
  mpcService._wireSessionCursors.clear();
  mpcService._wireSessionAdapters.clear();
});

test.afterEach(() => {
  resetMpcTssEngineForTests();
});

function installCompletedWireSignEngine(assertStart = () => {}) {
  setMpcTssEngineForTests({
    async startSign(input) {
      assertStart(input);
      return {
        sessionId: input.sessionId,
        requestId: input.requestId,
        senderIndex: input.senderIndex,
        protocol: 'sign',
        result: {
          status: 'completed',
          requestId: input.requestId,
          signatureHex: '0xmpcsig'
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
}

async function withLocalWireMessagePoll(fn) {
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    fetchMessages: async () => ({ messages: [], nextSequence: 0 })
  };
  try {
    return await fn();
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
}

test('active MPC 钱包地址会解析为 MPC signer id', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'active',
    address: '0x1111111111111111111111111111111111111111',
    publicKey: '03abcdef',
    keygenSessionId: 'session-1',
  });

  const accountId = await resolveMpcAccountIdByAddress('0x1111111111111111111111111111111111111111');

  assert.equal(accountId, 'mpc:mpc-wallet-1');
});

test('未完成 keygen 的 MPC 钱包不能进入签名', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'keygen_ready',
    keygenSessionId: 'session-1',
  });

  await assert.rejects(
    () => signMessage(getMpcAccountId('mpc-wallet-1'), 'hello'),
    /MPC_KEYGEN_NOT_COMPLETED/
  );
});

test('active MPC 钱包在 TSS signer 接入前明确阻断签名', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'active',
    address: '0x1111111111111111111111111111111111111111',
    publicKey: '03abcdef',
    keygenSessionId: 'session-1',
  });
  await saveMpcKeyShare({
    id: 'share-1',
    walletId: 'mpc-wallet-1',
    sessionId: 'session-1',
    participantId: '0x1111111111111111111111111111111111111111',
    share: { secret: 'local-share' },
    completeKeyShare: { secret: 'complete-local-share' },
    keyVersion: 1,
    shareVersion: 1,
  });

  await assert.rejects(
    () => signMessage(getMpcAccountId('mpc-wallet-1'), 'hello'),
    /MPC_SIGNER_NOT_CONFIGURED/
  );
  await assert.rejects(
    () => signTransaction(getMpcAccountId('mpc-wallet-1'), {
      to: '0x2222222222222222222222222222222222222222',
      value: '0x0',
    }),
    /MPC_SIGNER_NOT_CONFIGURED/
  );
  await assert.rejects(
    () => signTypedData(
      getMpcAccountId('mpc-wallet-1'),
      { name: 'App', chainId: 1 },
      { Mail: [{ name: 'contents', type: 'string' }] },
      { contents: 'hello' }
    ),
    /MPC_SIGNER_NOT_CONFIGURED/
  );
});

test('MPC 签名入口会启动 wire sign 状态机', async () => {
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
  installCompletedWireSignEngine((input) => {
    assert.equal(input.sessionId, 'session-1');
    assert.equal(input.senderIndex, 0);
    assert.deepEqual(input.parties, [0, 1]);
    assert.ok(input.requestId);
    assert.deepEqual(input.keyShareRef.completeKeyShare, { secret: 'complete-local-share' });
    assert.deepEqual(input.payload, {
      message: 'hello',
      messageHex: '0x68656c6c6f'
    });
  });

  const signature = await withLocalWireMessagePoll(
    () => signMessage(getMpcAccountId('mpc-wallet-1'), 'hello')
  );

  assert.equal(signature, '0xmpcsig');
  const requests = Object.values(await getMpcSignRequests());
  assert.equal(requests.length, 1);
  assert.equal(requests[0].status, 'completed');
  assert.deepEqual(requests[0].payload, {
    message: 'hello',
    messageHex: '0x68656c6c6f'
  });
});

test('active MPC 钱包缺少本地 key share 时不能签名', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'active',
    address: '0x1111111111111111111111111111111111111111',
    publicKey: '03abcdef',
    keygenSessionId: 'session-1',
  });

  await assert.rejects(
    () => signMessage(getMpcAccountId('mpc-wallet-1'), 'hello'),
    /MPC_KEY_SHARE_NOT_FOUND/
  );
});

test('MPC 签名前会同步远端 sign request 并传给 TSS engine', async () => {
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: '0x1111111111111111111111111111111111111111',
  });
  await setSelectedAccountId('account-1');
  state.keyring = new Map([
    ['account-1', { signMessage: async (message) => `signed:${message}` }],
  ]);
  await updateUserSettings({
    mpcCoordinatorEndpoint: 'http://127.0.0.1:8100',
    mpcCoordinatorUcanToken: 'ucan-token',
  });
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'active',
    address: '0x9999999999999999999999999999999999999999',
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

  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, options, body });
    return new Response(JSON.stringify({
      code: 0,
        data: {
        id: body.signRequestId,
        walletId: body.walletId,
        sessionId: body.sessionId,
        initiator: '0x1111111111111111111111111111111111111111',
        payloadType: body.payloadType,
        payloadHash: body.payloadHash,
        payload: body.payload,
        chainId: body.chainId,
        status: 'pending',
        approvals: [],
        createdAt: '1',
      },
    }), { status: 200 });
  };
  installCompletedWireSignEngine((input) => {
    assert.equal(input.sessionId, 'session-1');
    assert.ok(input.requestId);
    assert.deepEqual(input.payload, {
      message: 'hello',
      messageHex: '0x68656c6c6f'
    });
  });

  try {
    const signature = await withLocalWireMessagePoll(
      () => signMessage(getMpcAccountId('mpc-wallet-1'), 'hello')
    );

    assert.equal(signature, '0xmpcsig');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://127.0.0.1:8100/api/v1/public/mpc/sign-requests');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer ucan-token');
    assert.equal(requests[0].body.walletId, 'mpc-wallet-1');
    assert.equal(requests[0].body.sessionId, 'session-1');
    assert.equal(requests[0].body.payloadType, 'message');
    assert.deepEqual(requests[0].body.payload, {
      message: 'hello',
      messageHex: '0x68656c6c6f'
    });
    assert.ok(requests[0].body.payloadHash);
    assert.ok(requests[0].body.signRequestId);
    assert.ok(requests[0].body.signature.startsWith('signed:'));
    const signRequest = await getMpcSignRequest(requests[0].body.signRequestId);
    assert.equal(signRequest.status, 'completed');
    assert.equal(signRequest.signature, '0xmpcsig');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
