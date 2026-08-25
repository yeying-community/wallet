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
      Cggmp24SigningSession: class {},
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
      combineKeyShareJson: (coreJson, auxInfoJson) => {
        calls.push(['combine', JSON.parse(coreJson), JSON.parse(auxInfoJson)]);
        return JSON.stringify({
          status: 'completed',
          curve: 'secp256k1',
          keyShare: {
            core: JSON.parse(coreJson),
            aux: JSON.parse(auxInfoJson),
          },
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
  assert.deepEqual(engine.combineKeyShare({ core: 'share' }, { aux: 'info' }), {
    status: 'completed',
    curve: 'secp256k1',
    keyShare: {
      core: { core: 'share' },
      aux: { aux: 'info' },
    },
    compressedPublicKeyHex: '03abcdef',
    uncompressedPublicKeyHex: `04${'11'.repeat(64)}`,
    ethereumAddress: '0x1111111111111111111111111111111111111111',
  });
  assert.deepEqual(calls.map(([name]) => name), ['wire', 'sign', 'keygen', 'aux-info', 'material', 'combine']);
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
      Cggmp24SigningSession: class {},
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
      combineKeyShareJson: () => JSON.stringify({ status: 'completed' }),
    },
  });

  assert.deepEqual(metadata, {
    engine: 'cggmp24',
    protocolVersion: 1,
  });
  assert.equal(getMpcTssEngine().isLoaded(), true);
  await assert.rejects(
    () => getMpcTssEngine().startSign({ sessionId: 'session-sign', senderIndex: 0, parties: [0, 1], payload: { messageHex: '0x01' } }),
    /MPC_CGGMP24_COMPLETE_KEY_SHARE_REQUIRED/
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
      Cggmp24SigningSession: class {},
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
      combineKeyShareJson: () => JSON.stringify({ status: 'completed' }),
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

test('Cggmp24WasmEngine rejects threshold below cggmp24 minimum', async () => {
  const engine = new Cggmp24WasmEngine({
    wasm: {
      Cggmp24ThresholdKeygenSession: class {},
      Cggmp24AuxInfoSession: class {},
      Cggmp24SigningSession: class {},
      cggmp24EngineMetadataJson: () => JSON.stringify({ engine: 'cggmp24' }),
      normalizeWireMessageJson: (json) => json,
      normalizeSigningPayloadJson: (json) => json,
      normalizeThresholdKeygenPayloadJson: (json) => json,
      normalizeAuxInfoPayloadJson: (json) => json,
      coreKeySharePublicMaterialJson: () => JSON.stringify({}),
      combineKeyShareJson: () => JSON.stringify({ status: 'completed' }),
    },
  });

  await assert.rejects(
    () => engine.startKeygen({
      sessionId: 'session-threshold-1',
      senderIndex: 0,
      parties: [0, 1],
      threshold: 1,
    }),
    /INVALID_MPC_THRESHOLD/
  );
});

test('Cggmp24WasmEngine exports and imports seeded keygen state with replayed messages', async () => {
  const calls = [];
  class SeededKeygenSession {
    constructor(sessionId, senderIndex, partyCount, threshold, seedHex = '') {
      this.sessionId = sessionId;
      this.senderIndex = senderIndex;
      this.partyCount = partyCount;
      this.threshold = threshold;
      this.seedHex = seedHex;
      this.outgoing = [{ audience: 'all-parties', payload: { Round1: { from: senderIndex, seedHex } } }];
      this.result = null;
    }

    static newWithSeed(sessionId, senderIndex, partyCount, threshold, seedHex) {
      calls.push(['newWithSeed', sessionId, senderIndex, partyCount, threshold, seedHex]);
      return new SeededKeygenSession(sessionId, senderIndex, partyCount, threshold, seedHex);
    }

    advanceJson() {
      if (this.seenMessage) {
        this.outgoing.push({
          audience: { 'one-party': { recipient_index: this.seenMessage.sender_index } },
          payload: { Round2Uni: { from: this.senderIndex, seedHex: this.seedHex } },
        });
        this.result = { shared_public_key: '03abcdef', i: this.senderIndex };
      }
      return JSON.stringify({ status: this.result ? 'completed' : 'waiting' });
    }

    receiveWireMessageJson(json) {
      this.seenMessage = JSON.parse(json);
      calls.push(['receive', this.seenMessage.sequence]);
      return JSON.stringify({ status: 'running' });
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

  const wasm = {
    Cggmp24ThresholdKeygenSession: SeededKeygenSession,
    Cggmp24AuxInfoSession: class {},
    Cggmp24SigningSession: class {},
    cggmp24EngineMetadataJson: () => JSON.stringify({ engine: 'cggmp24' }),
    normalizeWireMessageJson: (json) => json,
    normalizeSigningPayloadJson: (json) => json,
    normalizeThresholdKeygenPayloadJson: (json) => json,
    normalizeAuxInfoPayloadJson: (json) => json,
    coreKeySharePublicMaterialJson: () => JSON.stringify({
      curve: 'secp256k1',
      compressedPublicKeyHex: '03abcdef',
      uncompressedPublicKeyHex: `04${'22'.repeat(64)}`,
      ethereumAddress: '0x2222222222222222222222222222222222222222',
    }),
    combineKeyShareJson: () => JSON.stringify({ status: 'completed' }),
  };
  const firstEngine = new Cggmp24WasmEngine({ wasm });
  const started = await firstEngine.startKeygen({
    sessionId: 'session-seeded',
    senderIndex: 1,
    parties: [0, 1],
    threshold: 2,
  });
  const firstOutgoing = await firstEngine.getOutgoingMessages({ sessionId: 'session-seeded', state: started });
  assert.equal(firstOutgoing.length, 1);

  await firstEngine.receiveMessage({
    sessionId: 'session-seeded',
    state: started,
    message: {
      protocol_version: 1,
      engine: 'cggmp24',
      session_id: 'session-seeded',
      protocol: 'keygen',
      sequence: 7,
      sender_index: 0,
      audience: 'all-parties',
      payload: { Round1: { from: 0 } },
    },
  });
  await firstEngine.advance({ sessionId: 'session-seeded', state: started });

  const snapshot = await firstEngine.exportState({ sessionId: 'session-seeded', state: started });
  assert.equal(snapshot.engine, 'cggmp24');
  assert.equal(snapshot.persistable, true);
  assert.match(snapshot.seedHex, /^[0-9a-f]{64}$/);
  assert.equal(snapshot.processedMessages.length, 1);
  assert.equal(snapshot.processedMessages[0].sequence, 7);

  const restoredEngine = new Cggmp24WasmEngine({ wasm });
  const restored = await restoredEngine.importState(snapshot);
  assert.equal(restored.seedHex, snapshot.seedHex);
  assert.equal(restored.processedMessages.length, 1);
  assert.deepEqual(await restoredEngine.getOutgoingMessages({ sessionId: 'session-seeded', state: restored }), []);
  assert.deepEqual(await restoredEngine.getResult({ sessionId: 'session-seeded', state: restored }), {
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
  assert.equal(calls.filter(([name]) => name === 'newWithSeed').length, 2);
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
      Cggmp24SigningSession: class {},
      cggmp24EngineMetadataJson: () => JSON.stringify({ engine: 'cggmp24' }),
      normalizeWireMessageJson: (json) => json,
      normalizeSigningPayloadJson: (json) => json,
      normalizeThresholdKeygenPayloadJson: (json) => json,
      normalizeAuxInfoPayloadJson: (json) => json,
      coreKeySharePublicMaterialJson: () => JSON.stringify({}),
      combineKeyShareJson: () => JSON.stringify({ status: 'completed' }),
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

test('Cggmp24WasmEngine rejects browser-blocking wasm-bindgen aux-info constructor', async () => {
  class BlockingAuxInfoSession {}
  BlockingAuxInfoSession.newWithSeed = function newWithSeed() {
    return wasm.cggmp24auxinfosession_newWithSeed();
  };

  const engine = new Cggmp24WasmEngine({
    wasm: {
      Cggmp24ThresholdKeygenSession: class {},
      Cggmp24AuxInfoSession: BlockingAuxInfoSession,
      Cggmp24SigningSession: class {},
      cggmp24EngineMetadataJson: () => JSON.stringify({ engine: 'cggmp24' }),
      normalizeWireMessageJson: (json) => json,
      normalizeSigningPayloadJson: (json) => json,
      normalizeThresholdKeygenPayloadJson: (json) => json,
      normalizeAuxInfoPayloadJson: (json) => json,
      coreKeySharePublicMaterialJson: () => JSON.stringify({}),
      combineKeyShareJson: () => JSON.stringify({ status: 'completed' }),
    },
  });

  await assert.rejects(
    () => engine.startAuxInfo({
      sessionId: 'session-aux-blocking',
      senderIndex: 1,
      parties: [0, 1],
      curve: 'secp256k1',
    }),
    /MPC_CGGMP24_AUX_INFO_BROWSER_BLOCKING/
  );
});

test('Cggmp24WasmEngine delegates aux-info sessions to offscreen engine proxy', async () => {
  const calls = [];
  const auxInfoDelegate = {
    async startAuxInfo(input) {
      calls.push(['startAuxInfo', input]);
      return {
        protocol: 'aux-info',
        sessionId: input.sessionId,
        senderIndex: input.senderIndex,
        parties: input.parties,
        partyCount: input.parties.length,
        curve: input.curve,
        remoteAuxInfo: true,
      };
    },
    async receiveMessage(input) {
      calls.push(['receiveMessage', input.message.payload]);
    },
    async advance(input) {
      calls.push(['advance', input.maxSteps]);
    },
    async getOutgoingMessages() {
      calls.push(['getOutgoingMessages']);
      return [{ protocol: 'aux-info', senderIndex: 1, audience: 'all-parties', payload: { Round1: {} } }];
    },
    async getResult() {
      calls.push(['getResult']);
      return { status: 'completed', auxInfo: { paillier: 'aux-from-worker' }, curve: 'secp256k1' };
    },
  };

  const engine = new Cggmp24WasmEngine({
    auxInfoDelegate,
    wasm: {
      Cggmp24ThresholdKeygenSession: class {},
      Cggmp24AuxInfoSession: class {},
      Cggmp24SigningSession: class {},
      cggmp24EngineMetadataJson: () => JSON.stringify({ engine: 'cggmp24' }),
      normalizeWireMessageJson: (json) => json,
      normalizeSigningPayloadJson: (json) => json,
      normalizeThresholdKeygenPayloadJson: (json) => json,
      normalizeAuxInfoPayloadJson: (json) => json,
      coreKeySharePublicMaterialJson: () => JSON.stringify({}),
      combineKeyShareJson: () => JSON.stringify({ status: 'completed' }),
    },
  });

  const state = await engine.startAuxInfo({
    sessionId: 'session-remote-aux',
    senderIndex: 1,
    parties: [0, 1],
    curve: 'secp256k1',
    maxSteps: 5,
  });
  await engine.receiveMessage({
    sessionId: 'session-remote-aux',
    state,
    message: { protocol: 'aux-info', payload: { Round1: {} } },
  });
  await engine.advance({ sessionId: 'session-remote-aux', state, maxSteps: 5 });
  assert.deepEqual(await engine.getOutgoingMessages({ sessionId: 'session-remote-aux', state }), [
    { protocol: 'aux-info', senderIndex: 1, audience: 'all-parties', payload: { Round1: {} } },
  ]);
  assert.deepEqual(await engine.getResult({ sessionId: 'session-remote-aux', state }), {
    status: 'completed',
    auxInfo: { paillier: 'aux-from-worker' },
    curve: 'secp256k1',
  });

  assert.deepEqual(calls.map(([name]) => name), [
    'startAuxInfo',
    'receiveMessage',
    'advance',
    'getOutgoingMessages',
    'getResult',
  ]);
});

test('Cggmp24WasmEngine drives signing sessions through the TSS adapter contract', async () => {
  class FakeSigningSession {
    constructor(sessionId, requestId, senderIndex, partiesJson, keyShareJson, messageHex) {
      this.sessionId = sessionId;
      this.requestId = requestId;
      this.senderIndex = senderIndex;
      this.parties = JSON.parse(partiesJson);
      this.keyShare = JSON.parse(keyShareJson);
      this.messageHex = messageHex;
      this.outgoing = [{ audience: 'all-parties', payload: { Round1a: { from: senderIndex } } }];
      this.result = null;
    }

    advanceJson() {
      if (this.seenMessage) {
        this.result = {
          signature: { r: 'r1', s: 's1' },
          signatureHex: '0x' + '11'.repeat(64),
        };
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
      Cggmp24AuxInfoSession: class {},
      Cggmp24SigningSession: FakeSigningSession,
      cggmp24EngineMetadataJson: () => JSON.stringify({ engine: 'cggmp24' }),
      normalizeWireMessageJson: (json) => json,
      normalizeSigningPayloadJson: (json) => json,
      normalizeThresholdKeygenPayloadJson: (json) => json,
      normalizeAuxInfoPayloadJson: (json) => json,
      coreKeySharePublicMaterialJson: () => JSON.stringify({}),
      combineKeyShareJson: () => JSON.stringify({ status: 'completed' }),
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

  await adapter.startSign({
    sessionId: 'session-sign',
    requestId: 'request-1',
    senderIndex: 1,
    parties: [0, 1],
    payload: { messageHex: '0x1234' },
    keyShareRef: { completeKeyShare: { core: 'core-share', aux: 'aux-info' } },
  });

  assert.deepEqual(sent[0], {
    sessionId: 'session-sign',
    protocol: 'sign',
    senderIndex: 1,
    audience: 'all-parties',
    payload: { Round1a: { from: 1 } },
    sequence: 0,
    requestId: 'request-1',
  });

  await adapter.receiveMessage({
    sessionId: 'session-sign',
    message: {
      protocol_version: 1,
      engine: 'cggmp24',
      session_id: 'session-sign',
      protocol: 'sign',
      sequence: 2,
      sender_index: 0,
      audience: 'all-parties',
      payload: { Round1a: { from: 0 } },
    },
  });

  assert.deepEqual(await adapter.getResult({ sessionId: 'session-sign' }), {
    status: 'completed',
    signature: { r: 'r1', s: 's1' },
    signatureHex: '0x' + '11'.repeat(64),
    requestId: 'request-1',
  });
});
