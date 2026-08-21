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
const { createMpcWireMessage } = await import('../js/background/mpc-wire-protocol.js');
const { getMpcMessage } = await import('../js/storage/index.js');

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
    assert.deepEqual(sent[1], {
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
