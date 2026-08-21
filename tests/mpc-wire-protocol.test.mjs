import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMpcWireMessage,
  inferMpcWireRound,
  parseMpcWireMessage,
} from '../js/background/mpc-wire-protocol.js';
import { MpcTssStateMachineAdapter } from '../js/background/mpc-tss-engine.js';

test('MPC wire message uses stable cggmp24 envelope fields', () => {
  const message = createMpcWireMessage({
    sessionId: 'session-1',
    protocol: 'sign',
    senderIndex: 0,
    audience: { oneParty: { recipientIndex: 1 } },
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
      protocolVersion: 1,
      engine: 'cggmp24',
      sessionId: 'session-1',
      protocol: 'keygen',
      senderIndex: 1,
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
  });

  assert.equal(result.messages.length, 1);
  assert.deepEqual(sent[0], {
    sessionId: 'session-1',
    protocol: 'sign',
    senderIndex: 0,
    audience: { 'one-party': { recipient_index: 1 } },
    payload: { Round1a: { K: 'opaque' } },
    sequence: 0,
  });
});
