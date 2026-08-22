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
const { MpcTssStateMachineAdapter } = await import('../js/background/mpc-tss-engine.js');
const { Cggmp24WasmEngine } = await import('../js/background/mpc-cggmp24-wasm-engine.js');
const { createMpcWireMessage } = await import('../js/background/mpc-wire-protocol.js');
const {
  getMpcKeyShare,
  getMpcMessage,
  getMpcSession,
  getMpcWallet,
  saveMpcKeyShare,
  saveMpcSession,
  saveMpcWallet
} = await import('../js/storage/index.js');

test.beforeEach(async () => {
  await chrome.storage.local.clear();
  mpcService._wireSessionCursors.clear();
  mpcService._wireSessionAdapters.clear();
});

test('tickWireSession polls wire messages, advances adapter, and stores sequence cursor', async () => {
  const sent = [];
  const received = [];
  const fetchQueries = [];
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  const originalSendWireMessage = mpcService.sendWireMessage;

  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    fetchMessages: async (_sessionId, query) => {
      fetchQueries.push(query);
      if (Number(query.after || 0) > 0) {
        return { messages: [], nextSequence: query.after };
      }
      return {
        messages: [{
          id: 'wire-4',
          sessionId: 'session-1',
          sender: '0',
          receiver: '1',
          round: 1,
          type: 'sign',
          seq: 4,
          envelope: createMpcWireMessage({
            sessionId: 'session-1',
            protocol: 'sign',
            senderIndex: 0,
            audience: { oneParty: { recipientIndex: 1 } },
            payload: { Round1a: { from: 0 } },
            sequence: 4
          }),
          createdAt: '4'
        }],
        nextSequence: 4
      };
    }
  };
  mpcService.sendWireMessage = async (message) => {
    sent.push(message);
    return { message: { id: `sent-${sent.length}`, ...message } };
  };

  const adapter = new MpcTssStateMachineAdapter({
    engine: {
      async startSign(input) {
        return {
          senderIndex: input.senderIndex,
          protocol: 'sign',
          outgoing: [],
          result: null
        };
      },
      async receiveMessage({ state, message }) {
        received.push(message);
        return {
          ...state,
          outgoing: [{ recipientIndex: 0, payload: { Round1b: { from: 1 } } }],
          result: { status: 'waiting' }
        };
      },
      async advance({ state }) {
        return state;
      },
      async getOutgoingMessages({ state }) {
        const outgoing = state.outgoing || [];
        state.outgoing = [];
        return outgoing;
      },
      async getResult({ state }) {
        return state.result;
      }
    },
    transport: mpcService
  });

  try {
    await adapter.startSign({
      sessionId: 'session-1',
      requestId: 'request-1',
      senderIndex: 1,
      parties: [0, 1],
      payload: { message: 'hello' }
    });

    const first = await mpcService.tickWireSession({
      sessionId: 'session-1',
      recipientIndex: 1,
      protocol: 'sign',
      adapter
    });
    assert.equal(first.messages.length, 1);
    assert.equal(first.nextSequence, 4);
    assert.deepEqual(received[0].payload, { Round1a: { from: 0 } });
    assert.deepEqual(sent[0], {
      sessionId: 'session-1',
      protocol: 'sign',
      senderIndex: 1,
      audience: { 'one-party': { recipient_index: 0 } },
      payload: { Round1b: { from: 1 } },
      sequence: 0
    });
    assert.equal((await getMpcMessage('wire-4')).seq, 4);

    const second = await mpcService.tickWireSession({
      sessionId: 'session-1',
      recipientIndex: 1,
      protocol: 'sign',
      adapter
    });
    assert.equal(second.messages.length, 0);
    assert.equal(fetchQueries[0].after, 0);
    assert.equal(fetchQueries[1].after, 4);
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
    mpcService.sendWireMessage = originalSendWireMessage;
  }
});

test('startWireSession starts keygen and sign adapters through service transport', async () => {
  const sent = [];
  const originalSendWireMessage = mpcService.sendWireMessage;
  mpcService.sendWireMessage = async (message) => {
    sent.push(message);
    return { message: { id: `sent-${sent.length}`, ...message } };
  };

  const adapter = new MpcTssStateMachineAdapter({
    engine: {
      async startKeygen(input) {
        assert.equal(input.sessionId, 'session-1');
        assert.equal(input.senderIndex, 1);
        assert.deepEqual(input.parties, [0, 1]);
        assert.equal(input.threshold, 1);
        return {
          senderIndex: input.senderIndex,
          protocol: 'keygen',
          outgoing: [{ payload: { Round1a: { keygen: true } } }]
        };
      },
      async startAuxInfo(input) {
        assert.equal(input.sessionId, 'session-1');
        assert.equal(input.senderIndex, 1);
        assert.deepEqual(input.parties, [0, 1]);
        return {
          senderIndex: input.senderIndex,
          protocol: 'aux-info',
          outgoing: [{ payload: { Round1: { aux: true } } }]
        };
      },
      async startSign(input) {
        assert.equal(input.requestId, 'sign-request-1');
        assert.deepEqual(input.payload, { digest: '0xabc' });
        return {
          senderIndex: input.senderIndex,
          protocol: 'sign',
          outgoing: [{ recipientIndex: 0, payload: { Round1a: { sign: true } } }]
        };
      },
      async getOutgoingMessages({ state }) {
        const outgoing = state.outgoing || [];
        state.outgoing = [];
        return outgoing;
      }
    },
    transport: mpcService
  });

  try {
    const keygen = await mpcService.startWireSession({
      sessionId: 'session-1',
      protocol: 'keygen',
      recipientIndex: 1,
      parties: [0, 1],
      threshold: 1,
      adapter
    });
    assert.equal(keygen.protocol, 'keygen');
    assert.equal(keygen.senderIndex, 1);
    assert.deepEqual(sent[0], {
      sessionId: 'session-1',
      protocol: 'keygen',
      senderIndex: 1,
      audience: 'all-parties',
      payload: { Round1a: { keygen: true } },
      sequence: 0
    });

    const auxInfo = await mpcService.startWireSession({
      sessionId: 'session-1',
      protocol: 'aux-info',
      recipientIndex: 1,
      parties: [0, 1],
      adapter
    });
    assert.equal(auxInfo.protocol, 'aux-info');
    assert.deepEqual(sent[1], {
      sessionId: 'session-1',
      protocol: 'aux-info',
      senderIndex: 1,
      audience: 'all-parties',
      payload: { Round1: { aux: true } },
      sequence: 0
    });

    const sign = await mpcService.startWireSession({
      sessionId: 'session-1',
      protocol: 'sign',
      recipientIndex: 1,
      parties: [0, 1],
      requestId: 'sign-request-1',
      payload: { digest: '0xabc' },
      adapter
    });
    assert.equal(sign.protocol, 'sign');
    assert.deepEqual(sent[2], {
      sessionId: 'session-1',
      protocol: 'sign',
      senderIndex: 1,
      audience: { 'one-party': { recipient_index: 0 } },
      payload: { Round1a: { sign: true } },
      sequence: 0
    });
  } finally {
    mpcService.sendWireMessage = originalSendWireMessage;
  }
});

test('tickWireSession persists completed cggmp24 wire keygen result without marking wallet signable', async () => {
  await saveMpcSession({
    id: 'session-1',
    type: 'keygen',
    name: 'mpc10',
    walletId: 'mpc-wallet-1',
    status: 'running',
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
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'keygen_running',
    keygenSessionId: 'session-1',
    threshold: 1,
    curve: 'secp256k1',
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
    createdAt: 1,
    updatedAt: 1
  });

  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    fetchMessages: async () => ({ messages: [], nextSequence: 0 })
  };

  const adapter = {
    async getResult() {
      return {
        status: 'completed',
        keyShare: { shared_public_key: '03abcdef', i: 1 },
        share: { shared_public_key: '03abcdef', i: 1 },
        address: '0x2222222222222222222222222222222222222222',
        walletAddress: '0x2222222222222222222222222222222222222222',
        uncompressedPublicKey: `04${'22'.repeat(64)}`,
        curve: 'secp256k1',
        threshold: 1
      };
    },
    async receiveMessage() {},
    async advance() {
      return { messages: [] };
    }
  };

  try {
    const result = await mpcService.tickWireSession({
      sessionId: 'session-1',
      protocol: 'keygen',
      participantId: '0x2222222222222222222222222222222222222222',
      recipientIndex: 1,
      adapter
    });

    assert.equal(result.result.status, 'completed');
    assert.equal(result.handledResult.wallet.status, 'keygen_completed');
    const share = await getMpcKeyShare('mpc-wallet-1:0x2222222222222222222222222222222222222222:1');
    assert.deepEqual(share.share, { shared_public_key: '03abcdef', i: 1 });
    assert.equal(share.publicKey, '03abcdef');
    assert.equal(share.address, '0x2222222222222222222222222222222222222222');
    assert.equal(share.uncompressedPublicKey, `04${'22'.repeat(64)}`);
    assert.equal(share.engine, 'cggmp24');
    assert.equal(share.signingStatus, 'unavailable');

    const session = await getMpcSession('session-1');
    assert.equal(session.status, 'keygen_completed');
    assert.equal(session.result.publicKey, '03abcdef');
    assert.equal(session.result.address, '0x2222222222222222222222222222222222222222');
    assert.equal(session.result.signingUnavailableReason, 'MPC_CGGMP24_SIGNING_STATE_MACHINE_NOT_IMPLEMENTED');

    const wallet = await getMpcWallet('mpc-wallet-1');
    assert.equal(wallet.status, 'keygen_completed');
    assert.equal(wallet.publicKey, '03abcdef');
    assert.equal(wallet.address, '0x2222222222222222222222222222222222222222');
    assert.equal(wallet.signingStatus, 'unavailable');
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('tickWireSession persists completed cggmp24 aux-info result without marking wallet signable', async () => {
  await saveMpcSession({
    id: 'session-aux-1',
    type: 'keygen',
    name: 'mpc10',
    walletId: 'mpc-wallet-aux-1',
    status: 'keygen_completed',
    threshold: 1,
    curve: 'secp256k1',
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
    keyVersion: 1,
    shareVersion: 1,
    result: {
      status: 'keygen_completed',
      publicKey: '03abcdef',
      address: '0x3333333333333333333333333333333333333333',
      signingStatus: 'unavailable',
      signingUnavailableReason: 'MPC_CGGMP24_SIGNING_STATE_MACHINE_NOT_IMPLEMENTED'
    },
    createdAt: 1,
    updatedAt: 1
  });
  await saveMpcWallet({
    id: 'mpc-wallet-aux-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'keygen_completed',
    keygenSessionId: 'session-aux-1',
    threshold: 1,
    curve: 'secp256k1',
    address: '0x3333333333333333333333333333333333333333',
    publicKey: '03abcdef',
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222'
    ],
    signingStatus: 'unavailable',
    signingUnavailableReason: 'MPC_CGGMP24_SIGNING_STATE_MACHINE_NOT_IMPLEMENTED',
    createdAt: 1,
    updatedAt: 1
  });
  await saveMpcKeyShare({
    id: 'mpc-wallet-aux-1:0x2222222222222222222222222222222222222222:1',
    walletId: 'mpc-wallet-aux-1',
    sessionId: 'session-aux-1',
    participantId: '0x2222222222222222222222222222222222222222',
    participantIndex: 1,
    curve: 'secp256k1',
    publicKey: '03abcdef',
    address: '0x3333333333333333333333333333333333333333',
    share: { shared_public_key: '03abcdef', i: 1 },
    keyVersion: 1,
    shareVersion: 1,
    engine: 'cggmp24',
    signingStatus: 'unavailable',
    signingUnavailableReason: 'MPC_CGGMP24_SIGNING_STATE_MACHINE_NOT_IMPLEMENTED',
    createdAt: 1,
    updatedAt: 1
  });

  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    fetchMessages: async () => ({ messages: [], nextSequence: 0 })
  };

  const adapter = {
    async getResult() {
      return {
        status: 'completed',
        auxInfo: { paillier: 'aux-1', rid: 'rid-1' },
        curve: 'secp256k1'
      };
    },
    async receiveMessage() {},
    async advance() {
      return { messages: [] };
    }
  };

  try {
    const result = await mpcService.tickWireSession({
      sessionId: 'session-aux-1',
      protocol: 'aux-info',
      participantId: '0x2222222222222222222222222222222222222222',
      recipientIndex: 1,
      adapter
    });

    assert.equal(result.result.status, 'completed');
    assert.equal(result.handledResult.wallet.status, 'keygen_completed');
    const share = await getMpcKeyShare('mpc-wallet-aux-1:0x2222222222222222222222222222222222222222:1');
    assert.deepEqual(share.auxInfo, { paillier: 'aux-1', rid: 'rid-1' });
    assert.equal(share.auxInfoStatus, 'completed');
    assert.equal(share.signingStatus, 'unavailable');

    const session = await getMpcSession('session-aux-1');
    assert.equal(session.status, 'keygen_completed');
    assert.equal(session.auxInfoStatus, 'completed');
    assert.equal(session.result.auxInfoStatus, 'completed');
    assert.equal(session.result.signingUnavailableReason, 'MPC_CGGMP24_SIGNING_STATE_MACHINE_NOT_IMPLEMENTED');

    const wallet = await getMpcWallet('mpc-wallet-aux-1');
    assert.equal(wallet.status, 'keygen_completed');
    assert.equal(wallet.address, '0x3333333333333333333333333333333333333333');
    assert.equal(wallet.auxInfoStatus, 'completed');
    assert.equal(wallet.signingStatus, 'unavailable');
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('service wire sessions can drive two cggmp24 keygen participants through the message log', async () => {
  class FakeKeygenSession {
    constructor(sessionId, senderIndex, partyCount, threshold) {
      this.sessionId = sessionId;
      this.senderIndex = senderIndex;
      this.partyCount = partyCount;
      this.threshold = threshold;
      this.inbox = [];
      this.completed = false;
      this.outgoing = [{
        audience: 'all-parties',
        payload: { Round1: { from: senderIndex } }
      }];
      this.result = null;
    }

    advanceJson() {
      if (!this.completed && this.inbox.length > 0) {
        const last = this.inbox[this.inbox.length - 1];
        this.outgoing.push({
          audience: { 'one-party': { recipient_index: last.sender_index } },
          payload: { Round2Uni: { from: this.senderIndex, to: last.sender_index } }
        });
        this.completed = true;
        this.result = {
          shared_public_key: '03shared',
          participant_index: this.senderIndex,
          party_count: this.partyCount,
          threshold: this.threshold
        };
      }
      return JSON.stringify({
        status: this.completed ? 'completed' : 'waiting',
        outgoing: this.outgoing,
        result: this.result,
        error: null
      });
    }

    receiveWireMessageJson(json) {
      const message = JSON.parse(json);
      if (!this.completed) {
        this.inbox.push(message);
      }
      return JSON.stringify({
        status: this.completed ? 'completed' : 'running',
        outgoing: this.outgoing,
        result: this.result,
        error: null
      });
    }

    drainOutgoingJson() {
      const outgoing = this.outgoing;
      this.outgoing = [];
      return JSON.stringify(outgoing);
    }

    resultJson() {
      return JSON.stringify(this.result);
    }
  }

  function makeEngine() {
    return new Cggmp24WasmEngine({
      wasm: {
        Cggmp24ThresholdKeygenSession: FakeKeygenSession,
        Cggmp24AuxInfoSession: class {},
        cggmp24EngineMetadataJson: () => JSON.stringify({ engine: 'cggmp24' }),
        normalizeWireMessageJson: (json) => json,
        normalizeSigningPayloadJson: (json) => json,
        normalizeThresholdKeygenPayloadJson: (json) => json,
        normalizeAuxInfoPayloadJson: (json) => json,
        coreKeySharePublicMaterialJson: () => JSON.stringify({
          curve: 'secp256k1',
          compressedPublicKeyHex: '03shared',
          uncompressedPublicKeyHex: `04${'33'.repeat(64)}`,
          ethereumAddress: '0x3333333333333333333333333333333333333333',
        }),
      },
    });
  }

  let sequence = 0;
  const log = [];
  const originalSendWireMessage = mpcService.sendWireMessage;
  const originalFetchWireMessages = mpcService.fetchWireMessages;
  mpcService.sendWireMessage = async (input) => {
    sequence += 1;
    const envelope = createMpcWireMessage({ ...input, sequence });
    const receiver = envelope.audience === 'all-parties'
      ? ''
      : String(envelope.audience['one-party'].recipient_index);
    const message = {
      id: `wire-${sequence}`,
      sessionId: envelope.session_id,
      sender: String(envelope.sender_index),
      receiver,
      round: sequence,
      type: envelope.protocol,
      seq: sequence,
      envelope,
      createdAt: String(sequence)
    };
    log.push(message);
    return { message, response: message };
  };
  mpcService.fetchWireMessages = async (sessionId, { after = 0, recipientIndex, limit = 50 } = {}) => {
    const recipient = String(recipientIndex);
    const messages = log
      .filter((message) => {
        if (message.sessionId !== sessionId) return false;
        if (message.seq <= Number(after || 0)) return false;
        if (message.receiver) return message.receiver === recipient;
        return message.sender !== recipient;
      })
      .slice(0, Number(limit || 50));
    const last = messages[messages.length - 1];
    return {
      messages,
      nextSequence: last?.seq ?? Number(after || 0)
    };
  };

  const party0 = new MpcTssStateMachineAdapter({
    engine: makeEngine(),
    transport: mpcService
  });
  const party1 = new MpcTssStateMachineAdapter({
    engine: makeEngine(),
    transport: mpcService
  });

  try {
    await mpcService.startWireSession({
      sessionId: 'session-keygen',
      protocol: 'keygen',
      recipientIndex: 0,
      parties: [0, 1],
      threshold: 2,
      adapter: party0
    });
    await mpcService.startWireSession({
      sessionId: 'session-keygen',
      protocol: 'keygen',
      recipientIndex: 1,
      parties: [0, 1],
      threshold: 2,
      adapter: party1
    });

    let result0 = null;
    let result1 = null;
    for (let i = 0; i < 8; i += 1) {
      result0 = (await mpcService.tickWireSession({
        sessionId: 'session-keygen',
        recipientIndex: 0,
        protocol: 'keygen',
        adapter: party0,
        limit: 1
      })).result;
      result1 = (await mpcService.tickWireSession({
        sessionId: 'session-keygen',
        recipientIndex: 1,
        protocol: 'keygen',
        adapter: party1,
        limit: 1
      })).result;
      if (result0?.status === 'completed' && result1?.status === 'completed') {
        break;
      }
    }

    assert.equal(result0?.status, 'completed');
    assert.equal(result1?.status, 'completed');
    assert.equal(result0.keyShare.shared_public_key, '03shared');
    assert.equal(result1.keyShare.shared_public_key, '03shared');
    assert.equal(result0.address, '0x3333333333333333333333333333333333333333');
    assert.equal(result1.address, '0x3333333333333333333333333333333333333333');
    assert.equal(result0.keyShare.participant_index, 0);
    assert.equal(result1.keyShare.participant_index, 1);
    assert.ok(log.some((message) => message.receiver === '0'));
    assert.ok(log.some((message) => message.receiver === '1'));
  } finally {
    mpcService.sendWireMessage = originalSendWireMessage;
    mpcService.fetchWireMessages = originalFetchWireMessages;
  }
});
