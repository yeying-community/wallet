import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Cggmp24WasmEngine,
  installCggmp24WasmEngine,
  resetCggmp24WasmEngineForTests,
} from '../js/background/mpc-cggmp24-wasm-engine.js';
import {
  getMpcTssEngine,
  installMpcTssEngine,
  MpcTssStateMachineAdapter,
  resetMpcTssEngineForTests,
} from '../js/background/mpc-tss-engine.js';

test.afterEach(() => {
  resetCggmp24WasmEngineForTests();
  resetMpcTssEngineForTests();
});

test('Cggmp24WasmEngine fails explicitly when WASM exports are missing', () => {
  const engine = new Cggmp24WasmEngine();

  assert.equal(engine.isLoaded(), false);
  assert.throws(() => engine.getMetadata(), /MPC_CGGMP24_WASM_NOT_LOADED/);
});

test('Cggmp24WasmEngine exposes metadata and JSON normalization exports', () => {
  const calls = [];
  const engine = new Cggmp24WasmEngine({
    wasm: {
      cggmp24EngineMetadataJson: () => JSON.stringify({
        engine: 'cggmp24',
        protocolVersion: 1,
        curve: 'secp256k1',
      }),
      Cggmp24ThresholdKeygenSession: class {},
      Cggmp24AuxInfoSession: class {},
      normalizeWireMessageJson: (json) => {
        calls.push(['wire', JSON.parse(json)]);
        return json;
      },
      normalizeSigningPayloadJson: (json) => {
        calls.push(['sign', JSON.parse(json)]);
        return json;
      },
      normalizeThresholdKeygenPayloadJson: (json) => {
        calls.push(['keygen', JSON.parse(json)]);
        return json;
      },
      normalizeAuxInfoPayloadJson: (json) => {
        calls.push(['aux-info', JSON.parse(json)]);
        return json;
      },
      coreKeySharePublicMaterialJson: (json) => {
        calls.push(['material', JSON.parse(json)]);
        return JSON.stringify({
          curve: 'secp256k1',
          compressedPublicKeyHex: '03abcdef',
          uncompressedPublicKeyHex: `04${'11'.repeat(64)}`,
          ethereumAddress: '0x1111111111111111111111111111111111111111',
        });
      },
    },
  });

  assert.equal(engine.isLoaded(), true);
  assert.deepEqual(engine.getMetadata(), {
    engine: 'cggmp24',
    protocolVersion: 1,
    curve: 'secp256k1',
  });
  assert.deepEqual(engine.normalizeWireMessage({ engine: 'cggmp24' }), { engine: 'cggmp24' });
  assert.deepEqual(engine.normalizeSigningPayload({ Round1a: {} }), { Round1a: {} });
  assert.deepEqual(engine.normalizeThresholdKeygenPayload({ Round1: {} }), { Round1: {} });
  assert.deepEqual(engine.normalizeAuxInfoPayload({ Round1: {} }), { Round1: {} });
  assert.deepEqual(engine.coreKeySharePublicMaterial({ shared_public_key: '03abcdef' }), {
    curve: 'secp256k1',
    compressedPublicKeyHex: '03abcdef',
    uncompressedPublicKeyHex: `04${'11'.repeat(64)}`,
    ethereumAddress: '0x1111111111111111111111111111111111111111',
  });
  assert.deepEqual(calls.map(([name]) => name), ['wire', 'sign', 'keygen', 'aux-info', 'material']);
});

test('installCggmp24WasmEngine installs the loaded engine through the TSS boundary', async () => {
  const metadata = await installCggmp24WasmEngine({
    setEngine: installMpcTssEngine,
    wasm: {
      cggmp24EngineMetadataJson: () => JSON.stringify({
        engine: 'cggmp24',
        protocolVersion: 1,
      }),
      Cggmp24ThresholdKeygenSession: class {},
      Cggmp24AuxInfoSession: class {},
      normalizeWireMessageJson: (json) => json,
      normalizeSigningPayloadJson: (json) => json,
      normalizeThresholdKeygenPayloadJson: (json) => json,
      normalizeAuxInfoPayloadJson: (json) => json,
      coreKeySharePublicMaterialJson: () => JSON.stringify({
        curve: 'secp256k1',
        compressedPublicKeyHex: '03abcdef',
        uncompressedPublicKeyHex: `04${'11'.repeat(64)}`,
        ethereumAddress: '0x1111111111111111111111111111111111111111',
      }),
    },
  });

  assert.deepEqual(metadata, {
    engine: 'cggmp24',
    protocolVersion: 1,
  });
  assert.equal(getMpcTssEngine().isLoaded(), true);
  await assert.rejects(
    () => getMpcTssEngine().startSign(),
    /MPC_CGGMP24_STATE_MACHINE_NOT_IMPLEMENTED/
  );
});

test('Cggmp24WasmEngine drives threshold keygen sessions through the TSS adapter contract', async () => {
  const calls = [];
  class FakeKeygenSession {
    constructor(sessionId, senderIndex, partyCount, threshold) {
      calls.push(['constructor', sessionId, senderIndex, partyCount, threshold]);
      this.sessionId = sessionId;
      this.senderIndex = senderIndex;
      this.outgoing = [{ audience: 'all-parties', payload: { Round1: { from: senderIndex } } }];
      this.result = null;
    }

    advanceJson(maxSteps) {
      calls.push(['advance', maxSteps]);
      if (this.seenMessage) {
        this.outgoing.push({
          audience: { 'one-party': { recipient_index: this.seenMessage.sender_index } },
          payload: { Round2Uni: { from: this.senderIndex } },
        });
        this.result = { shared_public_key: '03abcdef', i: this.senderIndex };
      }
      return JSON.stringify({
        status: this.result ? 'completed' : 'waiting',
        outgoing: this.outgoing,
        result: this.result,
        error: null,
      });
    }

    receiveWireMessageJson(json) {
      this.seenMessage = JSON.parse(json);
      calls.push(['receive', this.seenMessage.payload]);
      return JSON.stringify({
        status: 'running',
        outgoing: this.outgoing,
        result: this.result,
        error: null,
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

  const sent = [];
  const engine = new Cggmp24WasmEngine({
    wasm: {
      Cggmp24ThresholdKeygenSession: FakeKeygenSession,
      Cggmp24AuxInfoSession: class {},
      cggmp24EngineMetadataJson: () => JSON.stringify({ engine: 'cggmp24' }),
      normalizeWireMessageJson: (json) => json,
      normalizeSigningPayloadJson: (json) => json,
      normalizeThresholdKeygenPayloadJson: (json) => json,
      normalizeAuxInfoPayloadJson: (json) => json,
      coreKeySharePublicMaterialJson: (json) => {
        calls.push(['material', JSON.parse(json)]);
        return JSON.stringify({
          curve: 'secp256k1',
          compressedPublicKeyHex: '03abcdef',
          uncompressedPublicKeyHex: `04${'22'.repeat(64)}`,
          ethereumAddress: '0x2222222222222222222222222222222222222222',
        });
      },
    },
  });
  const adapter = new MpcTssStateMachineAdapter({
    engine,
    transport: {
      async sendWireMessage(message) {
        sent.push(message);
        return { message };
      },
    },
  });

  await adapter.startKeygen({
    sessionId: 'session-1',
    senderIndex: 1,
    parties: [0, 1],
    threshold: 2,
    curve: 'secp256k1',
  });

  assert.deepEqual(calls[0], ['constructor', 'session-1', 1, 2, 2]);
  assert.deepEqual(sent[0], {
    sessionId: 'session-1',
    protocol: 'keygen',
    senderIndex: 1,
    audience: 'all-parties',
    payload: { Round1: { from: 1 } },
    sequence: 0,
  });

  await adapter.receiveMessage({
    sessionId: 'session-1',
    message: {
      protocol_version: 1,
      engine: 'cggmp24',
      session_id: 'session-1',
      protocol: 'keygen',
      sequence: 7,
      sender_index: 0,
      audience: 'all-parties',
      payload: { Round1: { from: 0 } },
    },
  });

  assert.deepEqual(sent[1], {
    sessionId: 'session-1',
    protocol: 'keygen',
    senderIndex: 1,
    audience: { 'one-party': { recipient_index: 0 } },
    payload: { Round2Uni: { from: 1 } },
    sequence: 0,
  });
  assert.deepEqual(await adapter.getResult({ sessionId: 'session-1' }), {
    status: 'completed',
    keyShare: { shared_public_key: '03abcdef', i: 1 },
    share: { shared_public_key: '03abcdef', i: 1 },
    publicKey: '03abcdef',
    groupPublicKey: '03abcdef',
    uncompressedPublicKey: `04${'22'.repeat(64)}`,
    address: '0x2222222222222222222222222222222222222222',
    walletAddress: '0x2222222222222222222222222222222222222222',
    curve: 'secp256k1',
    threshold: 2,
  });
});

test('Cggmp24WasmEngine drives aux-info sessions through the TSS adapter contract', async () => {
  class FakeAuxInfoSession {
    constructor(sessionId, senderIndex, partyCount) {
      this.sessionId = sessionId;
      this.senderIndex = senderIndex;
      this.partyCount = partyCount;
      this.outgoing = [{ audience: 'all-parties', payload: { Round1: { aux: senderIndex } } }];
      this.result = null;
    }

    advanceJson() {
      if (this.seenMessage) {
        this.result = { paillier: `aux-${this.senderIndex}` };
      }
      return JSON.stringify({
        status: this.result ? 'completed' : 'waiting',
        outgoing: this.outgoing,
        result: this.result,
        error: null,
      });
    }

    receiveWireMessageJson(json) {
      this.seenMessage = JSON.parse(json);
      return JSON.stringify({
        status: 'running',
        outgoing: this.outgoing,
        result: this.result,
        error: null,
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

  const sent = [];
  const engine = new Cggmp24WasmEngine({
    wasm: {
      Cggmp24ThresholdKeygenSession: class {},
      Cggmp24AuxInfoSession: FakeAuxInfoSession,
      cggmp24EngineMetadataJson: () => JSON.stringify({ engine: 'cggmp24' }),
      normalizeWireMessageJson: (json) => json,
      normalizeSigningPayloadJson: (json) => json,
      normalizeThresholdKeygenPayloadJson: (json) => json,
      normalizeAuxInfoPayloadJson: (json) => json,
      coreKeySharePublicMaterialJson: () => JSON.stringify({}),
    },
  });
  const adapter = new MpcTssStateMachineAdapter({
    engine,
    transport: {
      async sendWireMessage(message) {
        sent.push(message);
        return { message };
      },
    },
  });

  await adapter.startAuxInfo({
    sessionId: 'session-aux',
    senderIndex: 1,
    parties: [0, 1],
    curve: 'secp256k1',
  });

  assert.deepEqual(sent[0], {
    sessionId: 'session-aux',
    protocol: 'aux-info',
    senderIndex: 1,
    audience: 'all-parties',
    payload: { Round1: { aux: 1 } },
    sequence: 0,
  });

  await adapter.receiveMessage({
    sessionId: 'session-aux',
    message: {
      protocol_version: 1,
      engine: 'cggmp24',
      session_id: 'session-aux',
      protocol: 'aux-info',
      sequence: 3,
      sender_index: 0,
      audience: 'all-parties',
      payload: { Round1: { aux: 0 } },
    },
  });

  assert.deepEqual(await adapter.getResult({ sessionId: 'session-aux' }), {
    status: 'completed',
    auxInfo: { paillier: 'aux-1' },
    curve: 'secp256k1',
  });
});
