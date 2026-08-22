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
const { handleMpcAcceptInvite, handleMpcCancelSession, handleMpcDismissInvite } = await import('../js/background/operations/mpc.js');
const { setMpcTssEngineForTests, resetMpcTssEngineForTests } = await import('../js/background/mpc-tss-engine.js');
const { state } = await import('../js/background/state.js');
const { HandleGetWalletList } = await import('../js/background/operations/wallet.js');
const {
  getMpcWallet,
  getMpcSession,
  getMpcSignRequest,
  getMpcKeyShare,
  saveAccount,
  saveMpcParticipant,
  saveMpcSignRequest,
  saveMpcSession,
  saveMpcWallet,
  setSelectedAccountId
} = await import('../js/storage/index.js');

test.beforeEach(async () => {
  await chrome.storage.local.clear();
  state.keyring = null;
  resetMpcTssEngineForTests();
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

test('ready session 会把本地 MPC 钱包状态收敛为等待密钥生成', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '团队金库',
    type: 'mpc',
    status: 'keygen_pending',
    keygenSessionId: 'session-1',
    threshold: 1,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });

  await mpcService.syncWalletFromSession({
    id: 'session-1',
    name: '团队金库',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'ready',
    threshold: 1,
    participants: ['0x1', '0x2'],
  });

  const wallet = await getMpcWallet('mpc-wallet-1');
  assert.equal(wallet.status, 'keygen_ready');
  assert.equal(wallet.address || '', '');
});

test('钱包列表会用本地 ready session 修复 MPC 钱包状态', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'keygen_pending',
    keygenSessionId: 'session-1',
    threshold: 1,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: 'session-1',
    name: 'mpc10',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'ready',
    threshold: 1,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });

  const result = await HandleGetWalletList();

  assert.equal(result.success, true);
  assert.equal(result.wallets.find((wallet) => wallet.id === 'mpc-wallet-1')?.status, 'keygen_ready');
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

test('session 同步不会把通用邀请标题写成 MPC 钱包名称', async () => {
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
    name: 'MPC 钱包邀请',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'created',
  });

  const wallet = await getMpcWallet('mpc-wallet-1');
  assert.equal(wallet.name, '社区金库');
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

test('listInvites 过滤本地已移除的未接受 MPC 邀请', async () => {
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  const marked = [];
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    listNotifications: async () => ({
      items: [{
        uid: 'item-1',
        type: 'mpc.keygen.invited',
        notificationUid: 'notification-1',
        subjectId: 'session-1',
        payload: {
          sessionId: 'session-1',
          walletId: 'mpc-wallet-1',
          name: '团队金库',
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
    markNotificationRead: async (notificationUid) => {
      marked.push(notificationUid);
      return { success: true };
    },
  };
  try {
    const dismissed = await handleMpcDismissInvite({
      uid: 'item-1',
      notificationUid: 'notification-1',
      subjectId: 'session-1',
      payload: {
        sessionId: 'session-1',
        walletId: 'mpc-wallet-1',
      },
    });
    assert.equal(dismissed.success, true);
    assert.deepEqual(marked, ['notification-1']);

    const result = await mpcService.listInvites({ unreadOnly: true });

    assert.deepEqual(result.items, []);
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('listInvites 不因本地 participant 记录隐藏缺失钱包的 MPC 邀请', async () => {
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
          name: '团队金库',
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

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].payload.name, '团队金库');
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('listInvites 用 session 详情补齐邀请中的 MPC 钱包名称', async () => {
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    listNotifications: async () => ({
      items: [{
        type: 'mpc.keygen.invited',
        notificationUid: 'notification-1',
        subjectId: '61705018-13b2-43e9-ab09-2698b64759f6',
        payload: {
          sessionId: '61705018-13b2-43e9-ab09-2698b64759f6',
          walletId: 'mpc-wallet-1',
        },
      }],
    }),
    getSession: async () => ({
      id: '61705018-13b2-43e9-ab09-2698b64759f6',
      name: 'mcp10',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      status: 'created',
      threshold: 2,
      participants: ['0x1', '0x2'],
    }),
  };
  try {
    const result = await mpcService.listInvites({ unreadOnly: true });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].payload.name, 'mcp10');
    assert.equal(result.items[0].payload.threshold, 2);
    assert.deepEqual(result.items[0].payload.participants, ['0x1', '0x2']);
    assert.equal(result.items[0].session.name, 'mcp10');
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('接受邀请会用协议 name 修复已有本地 MPC 钱包名称', async () => {
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: '0x5c7bf91c493126314bb821c123dee889ffca3932',
  });
  await setSelectedAccountId('account-1');
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '名称缺失',
    type: 'mpc',
    status: 'keygen_pending',
    keygenSessionId: 'session-1',
    threshold: 1,
    participants: [
      '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    ],
    createdAt: 1000,
    updatedAt: 1000,
  });

  const originalJoinSession = mpcService.joinSession;
  const originalStartEventStream = mpcService.startEventStream;
  const originalSyncWalletFromSession = mpcService.syncWalletFromSession;
  const originalMarkInviteRead = mpcService.markInviteRead;
  mpcService.joinSession = async () => ({
    session: {
      id: 'session-1',
      name: 'mpc10',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      status: 'created',
      threshold: 1,
      participants: [
        '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
        '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
      ],
    },
    response: {},
  });
  mpcService.startEventStream = async () => ({ started: true });
  mpcService.syncWalletFromSession = async () => null;
  mpcService.markInviteRead = async () => null;

  try {
    const result = await handleMpcAcceptInvite({
      notificationUid: 'notification-1',
      sessionId: 'session-1',
      walletId: 'mpc-wallet-1',
      payload: {
        sessionId: 'session-1',
        walletId: 'mpc-wallet-1',
        name: 'mpc10',
        threshold: 1,
        participants: [
          '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
          '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
        ],
      },
      password: 'password123',
    });

    assert.equal(result.success, true);
    const wallet = await getMpcWallet('mpc-wallet-1');
    assert.equal(wallet.name, 'mpc10');
  } finally {
    mpcService.joinSession = originalJoinSession;
    mpcService.startEventStream = originalStartEventStream;
    mpcService.syncWalletFromSession = originalSyncWalletFromSession;
    mpcService.markInviteRead = originalMarkInviteRead;
  }
});

test('取消旧 MPC 创建遇到远端不可取消时会清理本地未完成记录', async () => {
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: '0x1111111111111111111111111111111111111111',
  });
  await setSelectedAccountId('account-1');
  state.keyring = new Map([
    ['account-1', { signMessage: async (message) => `signed:${message}` }],
  ]);
  await saveMpcWallet({
    id: 'mpc-wallet-stale',
    name: 'mpc10',
    type: 'mpc',
    status: 'keygen_running',
    keygenSessionId: '868d2738-d7fe-4ae2-82f3-135f5454aad9',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: '868d2738-d7fe-4ae2-82f3-135f5454aad9',
    type: 'keygen',
    walletId: 'mpc-wallet-stale',
    status: 'running',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
    createdAt: 1000,
    updatedAt: 1000,
  });

  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    cancelSession: async () => {
      throw new Error('Session is not cancellable');
    },
  };

  try {
    const result = await handleMpcCancelSession({
      walletId: 'mpc-wallet-stale',
      sessionId: '868d2738-d7fe-4ae2-82f3-135f5454aad9',
      password: 'password123',
    });

    assert.equal(result.success, true);
    assert.equal(result.remoteCancelled, false);
    assert.match(result.warning, /已移除本地未完成 MPC 钱包记录/);
    assert.equal(await getMpcWallet('mpc-wallet-stale'), null);
    assert.equal(await getMpcSession('868d2738-d7fe-4ae2-82f3-135f5454aad9'), null);
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('被邀请方取消未完成 MPC 创建遇到远端 Forbidden 时会清理本地记录', async () => {
  await saveAccount({
    id: 'account-invitee',
    walletId: 'wallet-invitee',
    address: '0x2222222222222222222222222222222222222222',
  });
  await setSelectedAccountId('account-invitee');
  state.keyring = new Map([
    ['account-invitee', { signMessage: async (message) => `signed:${message}` }],
  ]);
  await saveMpcWallet({
    id: 'mpc-wallet-invitee',
    name: 'mpc10',
    type: 'mpc',
    status: 'keygen_running',
    keygenSessionId: 'session-forbidden',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
  });
  await saveMpcSession({
    id: 'session-forbidden',
    type: 'keygen',
    walletId: 'mpc-wallet-invitee',
    status: 'running',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
  });

  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    cancelSession: async () => {
      const error = new Error('Forbidden');
      error.status = 403;
      throw error;
    },
  };

  try {
    const result = await handleMpcCancelSession({
      walletId: 'mpc-wallet-invitee',
      sessionId: 'session-forbidden',
      password: 'password123',
    });

    assert.equal(result.success, true);
    assert.equal(result.remoteCancelled, false);
    assert.match(result.warning, /已移除本地未完成 MPC 钱包记录/);
    assert.equal(await getMpcWallet('mpc-wallet-invitee'), null);
    assert.equal(await getMpcSession('session-forbidden'), null);
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('已生成地址的 MPC 钱包不能通过取消创建入口移除', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-active',
    name: 'mpc10',
    type: 'mpc',
    status: 'keygen_running',
    address: '0x1111111111111111111111111111111111111111',
    keygenSessionId: 'session-active',
    threshold: 1,
    participants: ['0x1', '0x2'],
  });
  await saveMpcSession({
    id: 'session-active',
    type: 'keygen',
    walletId: 'mpc-wallet-active',
    status: 'running',
    threshold: 1,
    participants: ['0x1', '0x2'],
  });

  const result = await handleMpcCancelSession({
    walletId: 'mpc-wallet-active',
    sessionId: 'session-active',
    password: 'password123',
  });

  assert.equal(result.success, false);
  assert.match(result.error, /已创建成功/);
  assert.notEqual(await getMpcWallet('mpc-wallet-active'), null);
  assert.notEqual(await getMpcSession('session-active'), null);
});

test('钱包列表会用本地 session name 修复已有 MPC 钱包名称', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '名称缺失',
    type: 'mpc',
    status: 'keygen_pending',
    keygenSessionId: 'session-1',
    threshold: 1,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: 'session-1',
    name: 'mpc10',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'created',
    threshold: 1,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });

  const result = await HandleGetWalletList();

  assert.equal(result.success, true);
  assert.equal(result.wallets.find((wallet) => wallet.id === 'mpc-wallet-1')?.name, 'mpc10');
  const wallet = await getMpcWallet('mpc-wallet-1');
  assert.equal(wallet.name, 'mpc10');
});

test('startKeygenSession 调用 TSS 引擎并保存 share、发送消息、激活钱包', async () => {
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: '0x1111111111111111111111111111111111111111',
  });
  await setSelectedAccountId('account-1');
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '团队金库',
    type: 'mpc',
    status: 'keygen_ready',
    keygenSessionId: 'session-1',
    curve: 'secp256k1',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
    keyVersion: 1,
    shareVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcParticipant({
    id: '0x1111111111111111111111111111111111111111',
    sessionId: 'session-1',
    status: 'active',
    signingPublicKey: '',
    e2ePublicKey: '',
  });

  const sentMessages = [];
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  const originalSendSessionMessage = mpcService.sendSessionMessage;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    getSession: async () => ({
      id: 'session-1',
      name: '团队金库',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      status: 'ready',
      curve: 'secp256k1',
      threshold: 1,
      participants: [
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222',
      ],
      keyVersion: 1,
      shareVersion: 1,
    }),
    sendMessage: async () => ({ ok: true }),
  };
  mpcService.sendSessionMessage = async (message) => {
    sentMessages.push(message);
    return { message: { id: `sent-${sentMessages.length}`, ...message } };
  };
  setMpcTssEngineForTests({
    startKeygen: async (input) => {
      assert.equal(input.session.id, 'session-1');
      assert.equal(input.wallet.id, 'mpc-wallet-1');
      assert.equal(input.participantId, '0x1111111111111111111111111111111111111111');
      return {
        keyShare: { secret: 'local-share' },
        shareVersion: 2,
        keyVersion: 2,
        messages: [{
          toParticipantId: '0x2222222222222222222222222222222222222222',
          round: 1,
          type: 'keygen.round1',
          payload: { commitment: 'c1' },
        }],
        completed: true,
        address: '0x9999999999999999999999999999999999999999',
        publicKey: '03abcdef',
      };
    },
  });

  try {
    const result = await mpcService.startKeygenSession({ sessionId: 'session-1' });

    assert.equal(result.completed, true);
    const share = await getMpcKeyShare('mpc-wallet-1:0x1111111111111111111111111111111111111111:2');
    assert.deepEqual(share.share, { secret: 'local-share' });
    assert.equal(share.publicKey, '03abcdef');
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].sessionId, 'session-1');
    assert.equal(sentMessages[0].toParticipantId, '0x2222222222222222222222222222222222222222');
    assert.equal(sentMessages[0].type, 'keygen.round1');
    const wallet = await getMpcWallet('mpc-wallet-1');
    assert.equal(wallet.name, '团队金库');
    assert.equal(wallet.status, 'active');
    assert.equal(wallet.address, '0x9999999999999999999999999999999999999999');
    assert.equal(wallet.publicKey, '03abcdef');
    assert.equal(wallet.keyVersion, 2);
    assert.equal(wallet.shareVersion, 2);
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
    mpcService.sendSessionMessage = originalSendSessionMessage;
    resetMpcTssEngineForTests();
  }
});

test('fetchSessionMessages 会把对端 keygen 消息交给 TSS 引擎处理', async () => {
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: '0x1111111111111111111111111111111111111111',
  });
  await setSelectedAccountId('account-1');
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '团队金库',
    type: 'mpc',
    status: 'keygen_running',
    keygenSessionId: 'session-1',
    curve: 'secp256k1',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
    keyVersion: 1,
    shareVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: 'session-1',
    name: '团队金库',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'rounds',
    curve: 'secp256k1',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
    keyVersion: 1,
    shareVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcParticipant({
    id: '0x1111111111111111111111111111111111111111',
    sessionId: 'session-1',
    status: 'active',
    signingPublicKey: '',
    e2ePublicKey: '',
  });

  const sentMessages = [];
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  const originalSendSessionMessage = mpcService.sendSessionMessage;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    fetchMessages: async () => ({
      messages: [{
        id: 'message-1',
        sessionId: 'session-1',
        from: '0x2222222222222222222222222222222222222222',
        to: '0x1111111111111111111111111111111111111111',
        round: 1,
        type: 'keygen.round1',
        payload: { commitment: 'c1' },
        createdAt: 2000,
      }],
      nextCursor: 'message-1',
    }),
  };
  mpcService.sendSessionMessage = async (message) => {
    sentMessages.push(message);
    return { message: { id: `sent-${sentMessages.length}`, ...message } };
  };
  setMpcTssEngineForTests({
    handleKeygenMessage: async ({ message, payload, participantId }) => {
      assert.equal(message.id, 'message-1');
      assert.deepEqual(payload, { commitment: 'c1' });
      assert.equal(participantId, '0x1111111111111111111111111111111111111111');
      return {
        messages: [{
          toParticipantId: '0x2222222222222222222222222222222222222222',
          round: 2,
          type: 'keygen.round2',
          payload: { response: 'r2' },
        }],
      };
    },
  });

  try {
    const result = await mpcService.fetchSessionMessages('session-1');

    assert.equal(result.messages.length, 1);
    assert.equal(result.processed.length, 1);
    assert.equal(result.processed[0].id, 'message-1');
    assert.ok(result.processed[0].processedAt);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].type, 'keygen.round2');
    assert.equal(sentMessages[0].toParticipantId, '0x2222222222222222222222222222222222222222');
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
    mpcService.sendSessionMessage = originalSendSessionMessage;
    resetMpcTssEngineForTests();
  }
});

test('listSignRequests 使用协调器业务接口并同步本地签名请求', async () => {
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  const queries = [];
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    listSignRequests: async (query) => {
      queries.push(query);
      return {
        items: [{
          id: 'sign-request-1',
          walletId: 'mpc-wallet-1',
          sessionId: 'session-1',
          payloadType: 'message',
          payloadHash: 'hash-1',
          status: 'pending',
          createdAt: '1',
        }],
        page: { total: 1, page: 1, pageSize: 20 },
      };
    },
  };

  try {
    const result = await mpcService.listSignRequests({
      sessionId: 'session-1',
      status: 'pending',
    });

    assert.equal(queries.length, 1);
    assert.equal(queries[0].sessionId, 'session-1');
    assert.equal(queries[0].status, 'pending');
    assert.equal(result.items.length, 1);
    const stored = await getMpcSignRequest('sign-request-1');
    assert.equal(stored.status, 'pending');
    assert.equal(stored.payloadType, 'message');
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('stream sign request 事件会同步本地签名请求', async () => {
  const originalProcessPending = mpcService.processPendingWireSignRequests;
  const processed = [];
  mpcService.processPendingWireSignRequests = async (options) => {
    processed.push(options);
    return { processed: [], count: 0 };
  };
  try {
    await mpcService._handleStreamEvent('session-1', {
      id: 'event-1',
      type: 'sign-request',
      data: {
        type: 'sign-request',
        sessionId: 'session-1',
        data: {
          id: 'sign-request-1',
          walletId: 'mpc-wallet-1',
          sessionId: 'session-1',
          payloadType: 'message',
          payloadHash: 'hash-1',
          status: 'pending',
          createdAt: '1',
        },
        timestamp: 2000,
      },
    });

    let stored = await getMpcSignRequest('sign-request-1');
    assert.equal(stored.status, 'pending');
    assert.equal(stored.payloadHash, 'hash-1');
    assert.deepEqual(processed, [{
      syncRemote: false,
      sessionId: 'session-1',
      requestId: 'sign-request-1',
    }]);

    await mpcService._handleStreamEvent('session-1', {
      id: 'event-2',
      type: 'sign-request-completed',
      data: {
        type: 'sign-request-completed',
        sessionId: 'session-1',
        data: {
          id: 'sign-request-1',
          status: 'completed',
          signature: '0xmpcsig',
          completedAt: '2',
        },
        timestamp: 3000,
      },
    });

    stored = await getMpcSignRequest('sign-request-1');
    assert.equal(stored.status, 'completed');
    assert.equal(stored.signature, '0xmpcsig');
    assert.equal(stored.walletId, 'mpc-wallet-1');
    assert.equal(processed.length, 1);
  } finally {
    mpcService.processPendingWireSignRequests = originalProcessPending;
  }
});

test('fetchSessionMessages 会把对端 sign 消息交给 TSS 引擎处理', async () => {
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: '0x1111111111111111111111111111111111111111',
  });
  await setSelectedAccountId('account-1');
  state.keyring = new Map([
    ['account-1', { signMessage: async (message) => `signed:${message}` }],
  ]);
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '团队金库',
    type: 'mpc',
    status: 'active',
    address: '0x9999999999999999999999999999999999999999',
    publicKey: '03abcdef',
    keygenSessionId: 'session-1',
    curve: 'secp256k1',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
    keyVersion: 1,
    shareVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: 'session-1',
    name: '团队金库',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'completed',
    curve: 'secp256k1',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
    keyVersion: 1,
    shareVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcParticipant({
    id: '0x1111111111111111111111111111111111111111',
    sessionId: 'session-1',
    status: 'active',
    signingPublicKey: '',
    e2ePublicKey: '',
  });
  await saveMpcSignRequest({
    id: 'sign-request-1',
    walletId: 'mpc-wallet-1',
    sessionId: 'session-1',
    type: 'message',
    status: 'pending',
    payload: { message: 'hello' },
    keyVersion: 1,
    shareVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
  });

  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  const originalSendSessionMessage = mpcService.sendSessionMessage;
  const sentMessages = [];
  const completedRequests = [];
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    fetchMessages: async () => ({
      messages: [{
        id: 'message-1',
        sessionId: 'session-1',
        from: '0x2222222222222222222222222222222222222222',
        to: '0x1111111111111111111111111111111111111111',
        round: 1,
        type: 'sign.round1',
        payload: { requestId: 'sign-request-1', partial: 'p1' },
        createdAt: 2000,
      }],
      nextCursor: 'message-1',
    }),
    completeSignRequest: async (requestId, payload, signature) => {
      completedRequests.push({ requestId, payload, signature });
      return {
        id: requestId,
        status: 'completed',
        signature: payload.signature,
        result: payload.result,
        completedAt: '3000',
      };
    },
  };
  mpcService.sendSessionMessage = async (message) => {
    sentMessages.push(message);
    return { message: { id: `sent-${sentMessages.length}`, ...message } };
  };
  setMpcTssEngineForTests({
    handleSignMessage: async ({ message, payload, signRequest, participantId }) => {
      assert.equal(message.id, 'message-1');
      assert.deepEqual(payload, { requestId: 'sign-request-1', partial: 'p1' });
      assert.equal(signRequest.id, 'sign-request-1');
      assert.equal(participantId, '0x1111111111111111111111111111111111111111');
      return {
        messages: [{
          toParticipantId: '0x2222222222222222222222222222222222222222',
          round: 2,
          type: 'sign.round2',
          payload: { partial: 'p2' },
        }],
        status: 'completed',
        signature: '0xmpcsig',
      };
    },
  });

  try {
    const result = await mpcService.fetchSessionMessages('session-1');

    assert.equal(result.messages.length, 1);
    assert.equal(result.processed.length, 1);
    assert.equal(result.processed[0].id, 'message-1');
    assert.ok(result.processed[0].processedAt);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].type, 'sign.round2');
    assert.deepEqual(sentMessages[0].payload, { partial: 'p2', requestId: 'sign-request-1' });
    assert.equal(completedRequests.length, 1);
    assert.equal(completedRequests[0].requestId, 'sign-request-1');
    assert.equal(completedRequests[0].payload.signature, '0xmpcsig');
    assert.equal(completedRequests[0].signature.signature.startsWith('signed:'), true);
    const signRequest = await getMpcSignRequest('sign-request-1');
    assert.equal(signRequest.status, 'completed');
    assert.equal(signRequest.signature, '0xmpcsig');
    assert.ok(signRequest.completedAt);
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
    mpcService.sendSessionMessage = originalSendSessionMessage;
    resetMpcTssEngineForTests();
  }
});
