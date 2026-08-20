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

const { mpcService } = await import('../js/background/mpc-service.js');
const { getMpcWallet, saveMpcParticipant, saveMpcSession, saveMpcWallet } = await import('../js/storage/index.js');

test.beforeEach(async () => {
  await chrome.storage.local.clear();
});

test('keygen session 完成时同步本地 MPC 钱包状态和地址', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '团队金库',
    type: 'mpc',
    status: 'keygen_pending',
    keygenSessionId: 'session-1',
    threshold: 2,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: 'session-1',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'completed',
    threshold: 2,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 2000,
  });

  await mpcService.syncWalletFromSession({
    id: 'session-1',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'completed',
    result: {
      address: '0x1111111111111111111111111111111111111111',
      groupPublicKey: '03abcdef',
    },
    keyVersion: 2,
    shareVersion: 3,
  });

  const wallet = await getMpcWallet('mpc-wallet-1');
  assert.equal(wallet.status, 'active');
  assert.equal(wallet.address, '0x1111111111111111111111111111111111111111');
  assert.equal(wallet.publicKey, '03abcdef');
  assert.equal(wallet.keyVersion, 2);
  assert.equal(wallet.shareVersion, 3);
});

test('session 同步会把被邀请者本地 MPC 钱包收敛到共同记录', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'MPC Wallet',
    type: 'mpc',
    status: 'keygen_pending',
    keygenSessionId: 'session-1',
    curve: 'secp256k1',
    threshold: 0,
    participants: [],
    keyVersion: 1,
    shareVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
  });

  await mpcService.syncWalletFromSession({
    id: 'session-1',
    name: '社区金库',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'created',
    curve: 'secp256k1',
    threshold: 2,
    participants: [
      { participantId: '0x1111111111111111111111111111111111111111' },
      { id: '0x2222222222222222222222222222222222222222' },
    ],
    keyVersion: 4,
    shareVersion: 5,
  });

  const wallet = await getMpcWallet('mpc-wallet-1');
  assert.equal(wallet.name, '社区金库');
  assert.equal(wallet.keygenSessionId, 'session-1');
  assert.equal(wallet.curve, 'secp256k1');
  assert.equal(wallet.threshold, 2);
  assert.deepEqual(wallet.participants, [
    '0x1111111111111111111111111111111111111111',
    '0x2222222222222222222222222222222222222222',
  ]);
  assert.equal(wallet.keyVersion, 4);
  assert.equal(wallet.shareVersion, 5);
});

test('session 数字字段缺失时不会把本地值误同步为 0', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '社区金库',
    type: 'mpc',
    status: 'keygen_pending',
    keygenSessionId: 'session-1',
    threshold: 2,
    participants: ['0x1', '0x2'],
  });

  await mpcService.syncWalletFromSession({
    id: 'session-1',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'created',
    threshold: null,
    participants: [],
  });

  const wallet = await getMpcWallet('mpc-wallet-1');
  assert.equal(wallet.threshold, 2);
  assert.deepEqual(wallet.participants, ['0x1', '0x2']);
});


test('listInvites 过滤本地已接受的 MPC 邀请', async () => {
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    listNotifications: async () => ({
      items: [{
        type: 'mpc.keygen.invited',
        notificationUid: 'notification-1',
        subjectId: 'session-1',
        payload: {
          sessionId: 'session-1',
          walletId: 'mpc-wallet-1',
          participants: ['0x1', '0x2'],
        },
      }],
    }),
    getSession: async () => ({
      id: 'session-1',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      status: 'created',
    }),
  };
  try {
    await saveMpcWallet({
      id: 'mpc-wallet-1',
      name: '团队金库',
      type: 'mpc',
      status: 'keygen_pending',
      keygenSessionId: 'session-1',
    });

    const result = await mpcService.listInvites({ unreadOnly: true });

    assert.deepEqual(result.items, []);
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('listInvites 过滤本地已加入参与者的 MPC 邀请', async () => {
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    listNotifications: async () => ({
      items: [{
        type: 'mpc.keygen.invited',
        notificationUid: 'notification-1',
        subjectId: 'session-1',
        payload: {
          sessionId: 'session-1',
          walletId: 'mpc-wallet-1',
          participants: ['0x1', '0x2'],
        },
      }],
    }),
    getSession: async () => ({
      id: 'session-1',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      status: 'created',
    }),
  };
  try {
    await saveMpcParticipant({
      id: '0x2',
      sessionId: 'session-1',
      status: 'active',
    });

    const result = await mpcService.listInvites({ unreadOnly: true });

    assert.deepEqual(result.items, []);
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});
