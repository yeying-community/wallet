import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMpcWireMessage,
  inferMpcWireRound,
  parseMpcWireMessage,
} from '../js/background/mpc-wire-protocol.js';
import { MpcTssStateMachineAdapter } from '../js/background/mpc-tss-engine.js';
import { MpcWireSessionRunner } from '../js/background/mpc-wire-session-runner.js';

function createMemoryWireLogTransport() {
  let sequence = 0;
  const log = [];
  return {
    log,
    async sendWireMessage(input) {
      sequence += 1;
      const envelope = createMpcWireMessage({ ...input, sequence });
      const receiver = envelope.audience === 'all-parties'
        ? ''
        : String(envelope.audience['one-party'].recipient_index);
      const message = {
        id: `msg-${sequence}`,
        sessionId: envelope.session_id,
        sender: String(envelope.sender_index),
        receiver,
        round: inferMpcWireRound(envelope.payload),
        type: envelope.protocol,
        seq: sequence,
        envelope,
        createdAt: String(sequence)
      };
      log.push(message);
      return { message, response: message };
    },
    async fetchWireMessages(sessionId, { after = 0, recipientIndex } = {}) {
      const recipient = String(recipientIndex);
      const messages = log.filter((message) => {
        if (message.sessionId !== sessionId) return false;
        if (message.seq <= Number(after || 0)) return false;
        if (message.receiver) return message.receiver === recipient;
        return message.sender !== recipient;
      });
      const last = messages[messages.length - 1];
      return {
        messages,
        nextSequence: last?.seq ?? Number(after || 0)
      };
    },
  };
}

test('MPC wire message uses stable cggmp24 envelope fields', () => {
  const message = createMpcWireMessage({
    sessionId: 'session-1',
    protocol: 'sign',
    senderIndex: 0,
    audience: { 'one-party': { recipient_index: 1 } },
    payload: { Round2: { ciphertext: 'opaque' } },
  });

  assert.deepEqual(message, {
    protocol_version: 1,
    engine: 'cggmp24',
    session_id: 'session-1',
    protocol: 'sign',
    sequence: 0,
    sender_index: 0,
    audience: { 'one-party': { recipient_index: 1 } },
    payload: { Round2: { ciphertext: 'opaque' } },
  });
  assert.equal(inferMpcWireRound(message.payload), 2);
});

test('MPC wire parser normalizes node message envelopes', () => {
  const parsed = parseMpcWireMessage({
    id: 'msg-4',
    seq: 4,
    envelope: {
      protocol_version: 1,
      engine: 'cggmp24',
      session_id: 'session-1',
      protocol: 'keygen',
      sender_index: 1,
      audience: 'all-parties',
      payload: { Round1a: {} },
    },
  });

  assert.equal(parsed.protocol_version, 1);
  assert.equal(parsed.session_id, 'session-1');
  assert.equal(parsed.protocol, 'keygen');
  assert.equal(parsed.sequence, 4);
  assert.equal(parsed.sender_index, 1);
  assert.equal(parsed.audience, 'all-parties');
});

test('MPC TSS state-machine adapter flushes outgoing messages through transport', async () => {
  const sent = [];
  const adapter = new MpcTssStateMachineAdapter({
    engine: {
      async startSign(input) {
        return {
          sessionId: input.sessionId,
          senderIndex: input.senderIndex,
          outgoing: [{ recipientIndex: 1, payload: { Round1a: { K: 'opaque' } } }],
        };
      },
      async getOutgoingMessages({ state }) {
        return state.outgoing;
      },
    },
    transport: {
      async sendWireMessage(message) {
        sent.push(message);
        return { message: { ...message, sequence: sent.length } };
      },
    },
  });

  const result = await adapter.startSign({
    sessionId: 'session-1',
    requestId: 'sign-request-1',
    senderIndex: 0,
    parties: [0, 1],
    payload: { message: 'hello' },
    password: 'wallet-password',
  });

  assert.equal(result.messages.length, 1);
  assert.deepEqual(sent[0], {
    sessionId: 'session-1',
    protocol: 'sign',
    senderIndex: 0,
    audience: { 'one-party': { recipient_index: 1 } },
    payload: { Round1a: { K: 'opaque' } },
    sequence: 0,
    password: 'wallet-password',
  });
});

test('MPC wire session runner relays fake TSS rounds through message log semantics', async () => {
  const transport = createMemoryWireLogTransport();
  const party0Events = [];
  const party1Events = [];
  const party0 = new MpcTssStateMachineAdapter({
    engine: {
      async startSign(input) {
        return {
          senderIndex: input.senderIndex,
          protocol: 'sign',
          outgoing: [{ payload: { Round1a: { from: 0 } } }],
          result: null,
        };
      },
      async receiveMessage({ state, message }) {
        party0Events.push(message);
        return {
          ...state,
          outgoing: [],
          result: { status: 'completed', seen: message.payload },
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
      },
    },
    transport,
  });
  const party1 = new MpcTssStateMachineAdapter({
    engine: {
      async startSign(input) {
        return {
          senderIndex: input.senderIndex,
          protocol: 'sign',
          outgoing: [],
          result: null,
        };
      },
      async receiveMessage({ state, message }) {
        party1Events.push(message);
        return {
          ...state,
          outgoing: [{ recipientIndex: 0, payload: { Round1b: { from: 1 } } }],
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
      },
    },
    transport,
  });

  await party0.startSign({
    sessionId: 'session-1',
    senderIndex: 0,
    parties: [0, 1],
    payload: { message: 'hello' },
  });
  await party1.startSign({
    sessionId: 'session-1',
    senderIndex: 1,
    parties: [0, 1],
    payload: { message: 'hello' },
  });

  const runner1 = new MpcWireSessionRunner({
    adapter: party1,
    transport,
    sessionId: 'session-1',
    recipientIndex: 1,
  });
  const firstPoll = await runner1.pollOnce();
  assert.equal(firstPoll.messages.length, 1);
  assert.equal(firstPoll.messages[0].sender, '0');
  assert.equal(firstPoll.messages[0].receiver, '');
  assert.deepEqual(party1Events[0].payload, { Round1a: { from: 0 } });

  const runner0 = new MpcWireSessionRunner({
    adapter: party0,
    transport,
    sessionId: 'session-1',
    recipientIndex: 0,
  });
  const secondPoll = await runner0.pollOnce();
  assert.equal(secondPoll.messages.length, 1);
  assert.equal(secondPoll.messages[0].sender, '1');
  assert.equal(secondPoll.messages[0].receiver, '0');
  assert.deepEqual(party0Events[0].payload, { Round1b: { from: 1 } });

  const result = await party0.getResult({ sessionId: 'session-1' });
  assert.deepEqual(result, {
    status: 'completed',
    seen: { Round1b: { from: 1 } },
  });
  assert.equal(transport.log.length, 2);
});

test('MPC wire session runner skips messages from other protocols in same session', async () => {
  const transport = createMemoryWireLogTransport();
  const received = [];
  const adapter = new MpcTssStateMachineAdapter({
    engine: {
      async startAuxInfo(input) {
        return {
          senderIndex: input.senderIndex,
          protocol: 'aux-info',
          outgoing: [],
          result: null,
        };
      },
      async receiveMessage({ state, message }) {
        received.push(message);
        return {
          ...state,
          result: { status: 'waiting' },
        };
      },
      async advance({ state }) {
        return state;
      },
      async getOutgoingMessages({ state }) {
        return state.outgoing || [];
      },
      async getResult({ state }) {
        return state.result || null;
      },
    },
    transport,
  });

  await transport.sendWireMessage({
    sessionId: 'session-mixed',
    protocol: 'keygen',
    senderIndex: 0,
    audience: { 'one-party': { recipient_index: 1 } },
    payload: { Round1a: { keygen: true } },
  });
  await transport.sendWireMessage({
    sessionId: 'session-mixed',
    protocol: 'aux-info',
    senderIndex: 0,
    audience: { 'one-party': { recipient_index: 1 } },
    payload: { Round1: { aux: true } },
  });
  await adapter.startAuxInfo({
    sessionId: 'session-mixed',
    senderIndex: 1,
    parties: [0, 1],
  });

  const runner = new MpcWireSessionRunner({
    adapter,
    transport,
    sessionId: 'session-mixed',
    recipientIndex: 1,
    protocol: 'aux-info',
  });
  const poll = await runner.pollOnce();

  assert.equal(poll.messages.length, 1);
  assert.equal(poll.skippedMessages.length, 1);
  assert.equal(poll.messages[0].envelope.protocol, 'aux-info');
  assert.equal(poll.skippedMessages[0].envelope.protocol, 'keygen');
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].payload, { Round1: { aux: true } });
  assert.equal(poll.nextSequence, 2);
});

test('MPC wire session runner skips messages from other request instances and self broadcasts', async () => {
  const received = [];
  const messages = [
    {
      id: 'old-aux',
      sessionId: 'session-request-filter',
      sender: '0',
      receiver: '',
      seq: 1,
      type: 'aux-info',
      envelope: createMpcWireMessage({
        sessionId: 'session-request-filter',
        protocol: 'aux-info',
        senderIndex: 0,
        audience: 'all-parties',
        payload: { Round1: { old: true } },
        sequence: 1
      })
    },
    {
      id: 'self-aux',
      sessionId: 'session-request-filter',
      sender: '1',
      receiver: '',
      seq: 2,
      type: 'aux-info',
      envelope: createMpcWireMessage({
        sessionId: 'session-request-filter',
        protocol: 'aux-info',
        requestId: 'aux-info:v2:session-request-filter:1:1',
        senderIndex: 1,
        audience: 'all-parties',
        payload: { Round1: { self: true } },
        sequence: 2
      })
    },
    {
      id: 'new-aux',
      sessionId: 'session-request-filter',
      sender: '0',
      receiver: '',
      seq: 3,
      type: 'aux-info',
      envelope: createMpcWireMessage({
        sessionId: 'session-request-filter',
        protocol: 'aux-info',
        requestId: 'aux-info:v2:session-request-filter:1:1',
        senderIndex: 0,
        audience: 'all-parties',
        payload: { Round1: { fresh: true } },
        sequence: 3
      })
    }
  ];
  const adapter = {
    async receiveMessage({ message }) {
      received.push(message);
      return { messages: [] };
    },
    async advance() {
      return { messages: [] };
    }
  };
  const runner = new MpcWireSessionRunner({
    adapter,
    transport: {
      async fetchWireMessages() {
        return { messages, nextSequence: 3 };
      }
    },
    sessionId: 'session-request-filter',
    recipientIndex: 1,
    protocol: 'aux-info',
    requestId: 'aux-info:v2:session-request-filter:1:1'
  });

  const poll = await runner.pollOnce();

  assert.equal(poll.messages.length, 1);
  assert.equal(poll.skippedMessages.length, 2);
  assert.equal(received.length, 1);
  assert.equal(received[0].id, 'new-aux');
  assert.equal(poll.nextSequence, 3);
});

test('MPC wire session runner only accepts snake_case request_id from wire envelope', async () => {
  const received = [];
  const messages = [
    {
      id: 'camel-request-id',
      sessionId: 'session-request-field',
      sender: '0',
      receiver: '',
      seq: 1,
      type: 'aux-info',
      envelope: {
        protocol_version: 1,
        engine: 'cggmp24',
        session_id: 'session-request-field',
        protocol: 'aux-info',
        requestId: 'aux-info:v2:session-request-field:1:1',
        sequence: 1,
        sender_index: 0,
        audience: 'all-parties',
        payload: { Round1: { camel: true } }
      }
    },
    {
      id: 'snake-request-id',
      sessionId: 'session-request-field',
      sender: '0',
      receiver: '',
      seq: 2,
      type: 'aux-info',
      envelope: createMpcWireMessage({
        sessionId: 'session-request-field',
        protocol: 'aux-info',
        requestId: 'aux-info:v2:session-request-field:1:1',
        senderIndex: 0,
        audience: 'all-parties',
        payload: { Round1: { snake: true } },
        sequence: 2
      })
    }
  ];
  const runner = new MpcWireSessionRunner({
    adapter: {
      async receiveMessage({ message }) {
        received.push(message);
        return { messages: [] };
      },
      async advance() {
        return { messages: [] };
      }
    },
    transport: {
      async fetchWireMessages() {
        return { messages, nextSequence: 2 };
      }
    },
    sessionId: 'session-request-field',
    recipientIndex: 1,
    protocol: 'aux-info',
    requestId: 'aux-info:v2:session-request-field:1:1'
  });

  const poll = await runner.pollOnce();

  assert.equal(poll.messages.length, 1);
  assert.equal(poll.skippedMessages.length, 1);
  assert.equal(received[0].id, 'snake-request-id');
});

test('MPC wire session runner skips stale aux-info messages rejected by state machine', async () => {
  const received = [];
  const messages = [
    {
      id: 'stale-aux',
      sessionId: 'session-stale-aux',
      sender: '0',
      receiver: '',
      seq: 10,
      type: 'aux-info',
      envelope: createMpcWireMessage({
        sessionId: 'session-stale-aux',
        protocol: 'aux-info',
        requestId: 'aux-info:v2:session-stale-aux:1:1',
        senderIndex: 0,
        audience: 'all-parties',
        payload: { Round1: { stale: true } },
        sequence: 10
      })
    },
    {
      id: 'fresh-aux',
      sessionId: 'session-stale-aux',
      sender: '0',
      receiver: '',
      seq: 11,
      type: 'aux-info',
      envelope: createMpcWireMessage({
        sessionId: 'session-stale-aux',
        protocol: 'aux-info',
        requestId: 'aux-info:v2:session-stale-aux:1:1',
        senderIndex: 0,
        audience: 'all-parties',
        payload: { Round2: { fresh: true } },
        sequence: 11
      })
    }
  ];
  const adapter = {
    async receiveMessage({ message }) {
      if (message.id === 'stale-aux') {
        throw new Error('JsValue(MPC_AUX_INFO_UNEXPECTED_MESSAGE)');
      }
      received.push(message);
      return { messages: [] };
    },
    async advance() {
      return { messages: [] };
    }
  };
  const runner = new MpcWireSessionRunner({
    adapter,
    transport: {
      async fetchWireMessages() {
        return { messages, nextSequence: 11 };
      }
    },
    sessionId: 'session-stale-aux',
    recipientIndex: 1,
    protocol: 'aux-info',
    requestId: 'aux-info:v2:session-stale-aux:1:1'
  });

  const poll = await runner.pollOnce();

  assert.equal(poll.messages.length, 1);
  assert.equal(poll.skippedMessages.length, 1);
  assert.equal(poll.skippedMessages[0].id, 'stale-aux');
  assert.equal(poll.skippedMessages[0].skipReason, 'JsValue(MPC_AUX_INFO_UNEXPECTED_MESSAGE)');
  assert.equal(received.length, 1);
  assert.equal(received[0].id, 'fresh-aux');
  assert.equal(poll.nextSequence, 11);
});

test('MPC wire session runner keeps latest aux-info message per sender and round', async () => {
  const received = [];
  const messages = [
    {
      id: 'old-round1',
      sessionId: 'session-aux-dedup',
      sender: '0',
      receiver: '',
      seq: 20,
      type: 'aux-info',
      envelope: createMpcWireMessage({
        sessionId: 'session-aux-dedup',
        protocol: 'aux-info',
        requestId: 'aux-info:v2:session-aux-dedup:1:1',
        senderIndex: 0,
        audience: 'all-parties',
        payload: { Round1: { value: 'old' } },
        sequence: 20
      })
    },
    {
      id: 'new-round1',
      sessionId: 'session-aux-dedup',
      sender: '0',
      receiver: '',
      seq: 25,
      type: 'aux-info',
      envelope: createMpcWireMessage({
        sessionId: 'session-aux-dedup',
        protocol: 'aux-info',
        requestId: 'aux-info:v2:session-aux-dedup:1:1',
        senderIndex: 0,
        audience: 'all-parties',
        payload: { Round1: { value: 'new' } },
        sequence: 25
      })
    }
  ];
  const runner = new MpcWireSessionRunner({
    adapter: {
      async receiveMessage({ message }) {
        received.push(message);
        return { messages: [] };
      },
      async advance() {
        return { messages: [] };
      }
    },
    transport: {
      async fetchWireMessages() {
        return { messages, nextSequence: 25 };
      }
    },
    sessionId: 'session-aux-dedup',
    recipientIndex: 1,
    protocol: 'aux-info',
    requestId: 'aux-info:v2:session-aux-dedup:1:1'
  });

  const poll = await runner.pollOnce();

  assert.equal(poll.messages.length, 1);
  assert.equal(received.length, 1);
  assert.equal(received[0].id, 'new-round1');
  assert.equal(poll.skippedMessages.length, 1);
  assert.equal(poll.skippedMessages[0].id, 'old-round1');
  assert.equal(poll.skippedMessages[0].skipReason, 'MPC_AUX_INFO_STALE_DUPLICATE_MESSAGE');
  assert.equal(poll.nextSequence, 25);
});
