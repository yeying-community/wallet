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
const { MpcAuxInfoOffscreenClient } = await import('../js/background/mpc-cggmp24-aux-offscreen-client.js');
const {
  getMpcAuditLogs,
  getMpcKeyShare,
  getMpcSession,
  getMpcWallet,
  setMpcAuditLogs,
  saveMpcKeyShare,
  saveMpcSession,
  saveMpcWallet
} = await import('../js/storage/index.js');

test.beforeEach(async () => {
  await chrome.storage.local.clear();
  await setMpcAuditLogs([]);
  mpcService._wireSessionCursors.clear();
  mpcService._wireSessionAdapters.clear();
  for (const pump of mpcService._wireSessionPumps.values()) {
    pump.stop?.();
  }
  mpcService._wireSessionPumps.clear();
});

test('_buildAuxInfoRequestId returns v3 with generation; missing generation defaults to 1', () => {
  const id = mpcService._buildAuxInfoRequestId({
    session: { id: 'sid-1', keyVersion: 1, shareVersion: 1 },
    wallet: { keyVersion: 1, shareVersion: 1 }
  });
  assert.equal(id, 'aux-info:v3:sid-1:1:1:1');

  const idWithGeneration = mpcService._buildAuxInfoRequestId({
    session: { id: 'sid-1', keyVersion: 1, shareVersion: 1, auxInfoGeneration: 2 },
    wallet: { keyVersion: 1, shareVersion: 1 }
  });
  assert.equal(idWithGeneration, 'aux-info:v3:sid-1:1:1:2');
});

test('aux-info pump converges to failed on wall-clock deadline with MPC_AUX_INFO_DEADLINE_EXCEEDED', async () => {
  await saveMpcSession({
    id: 'session-deadline',
    type: 'keygen',
    walletId: 'wallet-deadline',
    status: 'keygen_completed',
    threshold: 1,
    curve: 'secp256k1',
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
    keyVersion: 1,
    shareVersion: 1,
    auxInfoStatus: 'running',
    auxInfoStartedAt: 1,
    auxInfoGeneration: 1,
    createdAt: 1,
    updatedAt: 1
  });
  await saveMpcWallet({
    id: 'wallet-deadline',
    name: 'deadline',
    type: 'mpc',
    status: 'keygen_completed',
    keygenSessionId: 'session-deadline',
    threshold: 1,
    curve: 'secp256k1',
    address: '0x3333333333333333333333333333333333333333',
    publicKey: '03abcdef',
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
    auxInfoStatus: 'running',
    auxInfoStartedAt: 1,
    auxInfoGeneration: 1,
    createdAt: 1,
    updatedAt: 1
  });
  await saveMpcKeyShare({
    id: 'wallet-deadline:0x2222222222222222222222222222222222222222:1',
    walletId: 'wallet-deadline',
    sessionId: 'session-deadline',
    participantId: '0x2222222222222222222222222222222222222222',
    participantIndex: 1,
    curve: 'secp256k1',
    share: { shared_public_key: '03abcdef', i: 1 },
    keyVersion: 1,
    shareVersion: 1,
    auxInfoStatus: 'running',
    createdAt: 1,
    updatedAt: 1
  });

  // Wire state at the original generation should be deleted by the deadline
  // failure path.
  await chrome.storage.local.set({
    mpc_wire_states: {
      'session-deadline:1:aux-info:aux-info:v3:session-deadline:1:1:1': {
        id: 'session-deadline:1:aux-info:aux-info:v3:session-deadline:1:1:1',
        sessionId: 'session-deadline',
        protocol: 'aux-info',
        participantIndex: 1,
        requestId: 'aux-info:v3:session-deadline:1:1:1',
        snapshot: { persistable: false, counter: 1 },
        updatedAt: 1
      }
    }
  });

  // Use an aux-info engine stub so `_completeKeyShareFromDevTrustedAuxInfo`
  // never runs (it is permanently gated for production builds).
  const originalTickWireSession = mpcService.tickWireSession;
  mpcService.tickWireSession = async () => ({
    messages: [],
    outputs: [],
    handledResult: null
  });

  try {
    const started = mpcService._startWireSessionPump({
      sessionId: 'session-deadline',
      protocol: 'aux-info',
      recipientIndex: 1,
      intervalMs: 1,
      maxTicks: 100000,
      maxIdleTicks: 100000,
      deadlineMs: 10,
      auxInfoGeneration: 1,
      requestId: 'aux-info:v3:session-deadline:1:1:1'
    });
    assert.equal(started.started, true);

    await new Promise((resolve) => setTimeout(resolve, 80));

    const session = await getMpcSession('session-deadline');
    const wallet = await getMpcWallet('wallet-deadline');
    assert.equal(session.auxInfoStatus, 'failed');
    assert.equal(session.signingUnavailableReason, 'MPC_AUX_INFO_DEADLINE_EXCEEDED');
    assert.equal(wallet.auxInfoStatus, 'failed');
    assert.equal(wallet.signingUnavailableReason, 'MPC_AUX_INFO_DEADLINE_EXCEEDED');
    assert.ok(session.auxInfoFailedAt);

    const share = await getMpcKeyShare('wallet-deadline:0x2222222222222222222222222222222222222222:1');
    assert.equal(share.auxInfoStatus, 'failed');
    assert.equal(share.signingUnavailableReason, 'MPC_AUX_INFO_DEADLINE_EXCEEDED');

    // Stored MPC_WIRE_STATES for this attempt should be cleared by the failure path.
    const wireStates = await chrome.storage.local.get('mpc_wire_states');
    assert.equal(Object.keys(wireStates.mpc_wire_states || {}).length, 0);

    const audit = await getMpcAuditLogs();
    const timeout = audit.find((entry) => entry.action === 'wire-aux-info-timeout');
    assert.ok(timeout, 'wire-aux-info-timeout audit should be appended');
    assert.equal(timeout.message, 'MPC_AUX_INFO_DEADLINE_EXCEEDED');
  } finally {
    mpcService.tickWireSession = originalTickWireSession;
    for (const pump of mpcService._wireSessionPumps.values()) {
      pump.stop?.();
    }
    mpcService._wireSessionPumps.clear();
  }
});

test('aux-info pump exhaust budget and idle ticks are routed to failed', async () => {
  await saveMpcSession({
    id: 'session-budget',
    type: 'keygen',
    walletId: 'wallet-budget',
    status: 'keygen_completed',
    threshold: 1,
    curve: 'secp256k1',
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
    keyVersion: 1,
    shareVersion: 1,
    auxInfoStatus: 'running',
    auxInfoStartedAt: Date.now(),
    auxInfoGeneration: 1,
    createdAt: 1,
    updatedAt: 1
  });
  await saveMpcWallet({
    id: 'wallet-budget',
    name: 'budget',
    type: 'mpc',
    status: 'keygen_completed',
    keygenSessionId: 'session-budget',
    threshold: 1,
    curve: 'secp256k1',
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
    auxInfoStatus: 'running',
    auxInfoStartedAt: Date.now(),
    auxInfoGeneration: 1,
    createdAt: 1,
    updatedAt: 1
  });

  const originalTickWireSession = mpcService.tickWireSession;
  mpcService.tickWireSession = async () => ({
    messages: [],
    outputs: [],
    handledResult: null
  });

  try {
    const started = mpcService._startWireSessionPump({
      sessionId: 'session-budget',
      protocol: 'aux-info',
      recipientIndex: 0,
      intervalMs: 1,
      maxTicks: 3,
      maxIdleTicks: 100000,
      deadlineMs: 60_000_000,
      auxInfoGeneration: 1
    });
    assert.equal(started.started, true);

    await new Promise((resolve) => setTimeout(resolve, 60));

    const session = await getMpcSession('session-budget');
    const wallet = await getMpcWallet('wallet-budget');
    assert.equal(session.auxInfoStatus, 'failed');
    assert.equal(session.signingUnavailableReason, 'MPC_AUX_INFO_PUMP_BUDGET_EXCEEDED');
    assert.equal(wallet.auxInfoStatus, 'failed');
    assert.equal(wallet.signingUnavailableReason, 'MPC_AUX_INFO_PUMP_BUDGET_EXCEEDED');
  } finally {
    mpcService.tickWireSession = originalTickWireSession;
    for (const pump of mpcService._wireSessionPumps.values()) {
      pump.stop?.();
    }
    mpcService._wireSessionPumps.clear();
  }
});

test('_maybeContinueAuxInfoForWallet retries with bumped generation on failed', async () => {
  await saveMpcSession({
    id: 'session-retry',
    type: 'keygen',
    walletId: 'wallet-retry',
    status: 'keygen_completed',
    threshold: 1,
    curve: 'secp256k1',
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
    keyVersion: 1,
    shareVersion: 1,
    auxInfoStatus: 'failed',
    auxInfoGeneration: 1,
    auxInfoFailedAt: 1,
    createdAt: 1,
    updatedAt: 1
  });
  await saveMpcWallet({
    id: 'wallet-retry',
    name: 'retry',
    type: 'mpc',
    status: 'keygen_completed',
    keygenSessionId: 'session-retry',
    threshold: 1,
    curve: 'secp256k1',
    address: '0x3333333333333333333333333333333333333333',
    publicKey: '03abcdef',
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
    auxInfoStatus: 'failed',
    auxInfoGeneration: 1,
    auxInfoFailedAt: 1,
    signingStatus: 'unavailable',
    signingUnavailableReason: 'MPC_AUX_INFO_DEADLINE_EXCEEDED',
    createdAt: 1,
    updatedAt: 1
  });
  await saveMpcKeyShare({
    id: 'wallet-retry:0x2222222222222222222222222222222222222222:1',
    walletId: 'wallet-retry',
    sessionId: 'session-retry',
    participantId: '0x2222222222222222222222222222222222222222',
    participantIndex: 1,
    curve: 'secp256k1',
    share: { shared_public_key: '03abcdef', i: 1 },
    keyVersion: 1,
    shareVersion: 1,
    auxInfoStatus: 'failed',
    createdAt: 1,
    updatedAt: 1
  });

  // Track what generation the next attempt will use, and short-circuit the
  // WASM session start so we don't depend on the bundled CGGMP24 engine.
  const originalStart = mpcService.startWireSession;
  mpcService.startWireSession = async (input) => {
    mpcService._observedRequestId = input.requestId;
    return {
      protocol: 'aux-info',
      sessionId: input.sessionId,
      senderIndex: input.recipientIndex,
      outgoing: []
    };
  };
  // Avoid pumping the WASM loop — we just want to verify the retry entry
  // point bumps the generation and restarts.
  const originalStartPump = mpcService._startWireSessionPump;
  mpcService._startWireSessionPump = () => ({ started: true });

  try {
    const result = await mpcService._maybeContinueAuxInfoForWallet({
      session: await getMpcSession('session-retry'),
      wallet: await getMpcWallet('wallet-retry'),
      participantId: '0x2222222222222222222222222222222222222222'
    });

    // `_startAuxInfoAfterWireKeygen` returns `{ session, wallet, started, pending }`
    // where `started` is the `startWireSession` return value; the stubbed pump
    // was a sibling of that and returns its own `{ started }` shape, which the
    // retry path forwards through.
    assert.ok(result?.started, 'retry should call _startAuxInfoAfterWireKeygen');
    assert.equal(mpcService._observedRequestId, 'aux-info:v3:session-retry:1:1:2');

    const session = await getMpcSession('session-retry');
    const wallet = await getMpcWallet('wallet-retry');
    assert.equal(session.auxInfoGeneration, 2);
    assert.equal(session.auxInfoStatus, 'running');
    assert.ok(session.auxInfoStartedAt);
    assert.equal(wallet.auxInfoGeneration, 2);
    assert.equal(wallet.auxInfoStatus, 'running');
  } finally {
    mpcService.startWireSession = originalStart;
    mpcService._startWireSessionPump = originalStartPump;
    delete mpcService._observedRequestId;
  }
});

test('_maybeContinueAuxInfoForWallet stays failed and emits retry-exhausted at MAX generations', async () => {
  await saveMpcSession({
    id: 'session-exhaust',
    type: 'keygen',
    walletId: 'wallet-exhaust',
    status: 'keygen_completed',
    threshold: 1,
    curve: 'secp256k1',
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
    keyVersion: 1,
    shareVersion: 1,
    auxInfoStatus: 'failed',
    auxInfoGeneration: 3,
    auxInfoFailedAt: 1,
    createdAt: 1,
    updatedAt: 1
  });
  await saveMpcWallet({
    id: 'wallet-exhaust',
    name: 'exhaust',
    type: 'mpc',
    status: 'keygen_completed',
    keygenSessionId: 'session-exhaust',
    threshold: 1,
    curve: 'secp256k1',
    address: '0x3333333333333333333333333333333333333333',
    publicKey: '03abcdef',
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
    auxInfoStatus: 'failed',
    auxInfoGeneration: 3,
    auxInfoFailedAt: 1,
    createdAt: 1,
    updatedAt: 1
  });
  await saveMpcKeyShare({
    id: 'wallet-exhaust:0x2222222222222222222222222222222222222222:1',
    walletId: 'wallet-exhaust',
    sessionId: 'session-exhaust',
    participantId: '0x2222222222222222222222222222222222222222',
    participantIndex: 1,
    curve: 'secp256k1',
    share: { shared_public_key: '03abcdef', i: 1 },
    keyVersion: 1,
    shareVersion: 1,
    auxInfoStatus: 'failed',
    auxInfoGeneration: 3,
    createdAt: 1,
    updatedAt: 1
  });

  const originalStart = mpcService.startWireSession;
  mpcService.startWireSession = async () => {
    throw new Error('MPC_AUX_INFO_START_FAILED');
  };

  try {
    const result = await mpcService._maybeContinueAuxInfoForWallet({
      session: await getMpcSession('session-exhaust'),
      wallet: await getMpcWallet('wallet-exhaust'),
      participantId: '0x2222222222222222222222222222222222222222'
    });

    assert.equal(result?.exhausted, true);
    assert.equal(result?.generation, 3);

    const audit = await getMpcAuditLogs();
    const exhausted = audit.find((entry) => entry.action === 'wire-aux-info-retry-exhausted');
    assert.ok(exhausted, 'wire-aux-info-retry-exhausted audit should be appended');
  } finally {
    mpcService.startWireSession = originalStart;
  }
});

test('_recoverStaleAuxInfoSessions converges overdue running wallets and retries them', async () => {
  const staleStartedAt = Date.now() - 30 * 60 * 1000; // 30 min ago
  await saveMpcSession({
    id: 'session-stale',
    type: 'keygen',
    walletId: 'wallet-stale',
    status: 'keygen_completed',
    threshold: 1,
    curve: 'secp256k1',
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
    keyVersion: 1,
    shareVersion: 1,
    auxInfoStatus: 'running',
    auxInfoStartedAt: staleStartedAt,
    auxInfoGeneration: 1,
    createdAt: 1,
    updatedAt: 1
  });
  await saveMpcWallet({
    id: 'wallet-stale',
    name: 'stale',
    type: 'mpc',
    status: 'keygen_completed',
    keygenSessionId: 'session-stale',
    threshold: 1,
    curve: 'secp256k1',
    address: '0x3333333333333333333333333333333333333333',
    publicKey: '03abcdef',
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
    auxInfoStatus: 'running',
    auxInfoStartedAt: staleStartedAt,
    auxInfoGeneration: 1,
    createdAt: 1,
    updatedAt: 1
  });
  await saveMpcKeyShare({
    id: 'wallet-stale:0x2222222222222222222222222222222222222222:1',
    walletId: 'wallet-stale',
    sessionId: 'session-stale',
    participantId: '0x2222222222222222222222222222222222222222',
    participantIndex: 1,
    curve: 'secp256k1',
    share: { shared_public_key: '03abcdef', i: 1 },
    keyVersion: 1,
    shareVersion: 1,
    auxInfoStatus: 'running',
    auxInfoStartedAt: staleStartedAt,
    createdAt: 1,
    updatedAt: 1
  });

  // Stash a fresh `running` wallet whose deadline hasn't passed; watchdog
  // must leave it alone.
  const freshStartedAt = Date.now() - 30 * 1000; // 30 s ago
  await saveMpcSession({
    id: 'session-fresh',
    type: 'keygen',
    walletId: 'wallet-fresh',
    status: 'keygen_completed',
    threshold: 1,
    curve: 'secp256k1',
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
    keyVersion: 1,
    shareVersion: 1,
    auxInfoStatus: 'running',
    auxInfoStartedAt: freshStartedAt,
    auxInfoGeneration: 1,
    createdAt: 1,
    updatedAt: 1
  });
  await saveMpcWallet({
    id: 'wallet-fresh',
    name: 'fresh',
    type: 'mpc',
    status: 'keygen_completed',
    keygenSessionId: 'session-fresh',
    threshold: 1,
    curve: 'secp256k1',
    address: '0x4444444444444444444444444444444444444444',
    publicKey: '03abcdef',
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
    auxInfoStatus: 'running',
    auxInfoStartedAt: freshStartedAt,
    auxInfoGeneration: 1,
    createdAt: 1,
    updatedAt: 1
  });
  await saveMpcKeyShare({
    id: 'wallet-fresh:0x2222222222222222222222222222222222222222:1',
    walletId: 'wallet-fresh',
    sessionId: 'session-fresh',
    participantId: '0x2222222222222222222222222222222222222222',
    participantIndex: 1,
    curve: 'secp256k1',
    share: { shared_public_key: '03abcdef', i: 1 },
    keyVersion: 1,
    shareVersion: 1,
    auxInfoStatus: 'running',
    auxInfoStartedAt: freshStartedAt,
    createdAt: 1,
    updatedAt: 1
  });

  // Stub the WASM session start + pump to capture the bumped-generation retry.
  const originalStart = mpcService.startWireSession;
  const originalStartPump = mpcService._startWireSessionPump;
  let observedRequestId = null;
  mpcService.startWireSession = async (input) => {
    observedRequestId = input.requestId;
    return {
      protocol: 'aux-info',
      sessionId: input.sessionId,
      senderIndex: input.recipientIndex,
      outgoing: []
    };
  };
  mpcService._startWireSessionPump = () => ({ started: false });

  try {
    const summary = await mpcService._recoverStaleAuxInfoSessions();
    assert.ok(summary.checked >= 1, 'watchdog should check at least the stale wallet');
    assert.ok(summary.recovered >= 1, 'watchdog should recover the stale wallet');

    const staleSession = await getMpcSession('session-stale');
    const staleWallet = await getMpcWallet('wallet-stale');
    // The watchdog failed it first, then `_maybeContinueAuxInfoForWallet` retried
    // it under generation 2 with status `running`.
    assert.equal(staleSession.auxInfoGeneration, 2);
    assert.equal(staleSession.auxInfoStatus, 'running');
    assert.equal(staleWallet.auxInfoGeneration, 2);
    assert.equal(staleWallet.auxInfoStatus, 'running');
    assert.equal(observedRequestId, 'aux-info:v3:session-stale:1:1:2');

    // Fresh wallet must remain untouched.
    const freshSession = await getMpcSession('session-fresh');
    const freshWallet = await getMpcWallet('wallet-fresh');
    assert.equal(freshSession.auxInfoStatus, 'running');
    assert.equal(freshSession.auxInfoGeneration, 1);
    assert.equal(freshWallet.auxInfoStatus, 'running');
    assert.equal(freshWallet.auxInfoGeneration, 1);
  } finally {
    mpcService.startWireSession = originalStart;
    mpcService._startWireSessionPump = originalStartPump;
  }
});

test('aux-info start writes auxInfoStartedAt and auxInfoGeneration; resume preserves startedAt', async () => {
  await saveMpcSession({
    id: 'session-start-fields',
    type: 'keygen',
    walletId: 'wallet-start-fields',
    status: 'keygen_completed',
    threshold: 1,
    curve: 'secp256k1',
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
    keyVersion: 1,
    shareVersion: 1,
    createdAt: 1,
    updatedAt: 1
  });
  await saveMpcWallet({
    id: 'wallet-start-fields',
    name: 'startfields',
    type: 'mpc',
    status: 'keygen_completed',
    keygenSessionId: 'session-start-fields',
    threshold: 1,
    curve: 'secp256k1',
    address: '0x3333333333333333333333333333333333333333',
    publicKey: '03abcdef',
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
    createdAt: 1,
    updatedAt: 1
  });
  await saveMpcKeyShare({
    id: 'wallet-start-fields:0x2222222222222222222222222222222222222222:1',
    walletId: 'wallet-start-fields',
    sessionId: 'session-start-fields',
    participantId: '0x2222222222222222222222222222222222222222',
    participantIndex: 1,
    curve: 'secp256k1',
    share: { shared_public_key: '03abcdef', i: 1 },
    keyVersion: 1,
    shareVersion: 1,
    createdAt: 1,
    updatedAt: 1
  });

  const originalStart = mpcService.startWireSession;
  const originalStartPump = mpcService._startWireSessionPump;
  mpcService.startWireSession = async () => ({
    protocol: 'aux-info',
    sessionId: 'session-start-fields',
    senderIndex: 1,
    outgoing: []
  });
  mpcService._startWireSessionPump = () => ({ started: false });

  try {
    const result = await mpcService._startAuxInfoAfterWireKeygen({
      session: await getMpcSession('session-start-fields'),
      wallet: await getMpcWallet('wallet-start-fields'),
      participantId: '0x2222222222222222222222222222222222222222',
      participantIndex: 1
    });

    assert.ok(result.started);
    const session = await getMpcSession('session-start-fields');
    const wallet = await getMpcWallet('wallet-start-fields');
    assert.ok(Number(session.auxInfoStartedAt) > 0);
    assert.equal(session.auxInfoGeneration, 1);
    assert.ok(Number(wallet.auxInfoStartedAt) > 0);
    assert.equal(wallet.auxInfoGeneration, 1);

    // Simulate a Service Worker restart: clear in-memory maps so `_maybeContinueAuxInfoForWallet`
    // takes the restart-stale-running path; the deadline should still be respected
    // (we set startedAt far enough in the past to not re-converge here).
    const firstStartedAt = session.auxInfoStartedAt;
    await saveMpcSession({
      ...session,
      auxInfoStartedAt: Date.now() - 5 * 60 * 1000 // still within deadline (10 min)
    });
    await saveMpcWallet({
      ...wallet,
      auxInfoStartedAt: Date.now() - 5 * 60 * 1000
    });

    const refreshedSession = await getMpcSession('session-start-fields');
    const refreshedWallet = await getMpcWallet('wallet-start-fields');
    // Aux-info status is currently `running`; resume path is taken only if the
    // in-memory pump map still has the cursor (it does not in this test). The
    // restart-stale-running path therefore bumps generation, then re-enters
    // `_startAuxInfoAfterWireKeygen` with the bumped generation.
    const continueResult = await mpcService._maybeContinueAuxInfoForWallet({
      session: refreshedSession,
      wallet: refreshedWallet,
      participantId: '0x2222222222222222222222222222222222222222'
    });
    assert.ok(continueResult?.started, 'restart-stale-running should restart');
    const afterRetrySession = await getMpcSession('session-start-fields');
    assert.equal(afterRetrySession.auxInfoGeneration, 2);
    assert.ok(Number(afterRetrySession.auxInfoStartedAt) > 0);
    // The retry writes a fresh auxInfoStartedAt timestamp; verify it's later
    // than the very first start we wrote above.
    assert.ok(Number(afterRetrySession.auxInfoStartedAt) >= Number(firstStartedAt));
  } finally {
    mpcService.startWireSession = originalStart;
    mpcService._startWireSessionPump = originalStartPump;
  }
});

test('MpcAuxInfoOffscreenClient onmessageerror rejects pending requests', async () => {
  // Polyfill BroadcastChannel from node:worker_threads if the host does not
  // provide one (the offscreen client only needs a working channel object
  // surface — we will trigger `onmessageerror` directly).
  const { BroadcastChannel: NodeBroadcastChannel } = await import('node:worker_threads');
  if (typeof globalThis.BroadcastChannel === 'undefined') {
    globalThis.BroadcastChannel = NodeBroadcastChannel;
  }
  const liveClient = new MpcAuxInfoOffscreenClient({ timeoutMs: 5000 });
  // Issue a request, then simulate a structured-clone failure by invoking
  // `onmessageerror` on the channel with the in-flight request id. Node's
  // BroadcastChannel rejects non-Event `dispatchEvent` arguments, so we call
  // the handler directly — it accepts a plain object with `.data`.
  const pending = liveClient._request('startAuxInfo', { sessionId: 'sid-x' });
  // Give the channel a tick to record the pending entry.
  await new Promise((resolve) => setTimeout(resolve, 5));
  const pendingId = liveClient.pending.keys().next().value;
  liveClient.channel.onmessageerror({ data: { id: pendingId } });
  await assert.rejects(pending, /MPC_AUX_INFO_OFFSCREEN_MESSAGE_ERROR/);
});