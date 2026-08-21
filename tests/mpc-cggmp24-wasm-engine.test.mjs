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
  assert.deepEqual(calls.map(([name]) => name), ['wire', 'sign', 'keygen']);
});

test('installCggmp24WasmEngine installs the loaded engine through the TSS boundary', async () => {
  const metadata = await installCggmp24WasmEngine({
    setEngine: installMpcTssEngine,
    wasm: {
      cggmp24EngineMetadataJson: () => JSON.stringify({
        engine: 'cggmp24',
        protocolVersion: 1,
      }),
      normalizeWireMessageJson: (json) => json,
      normalizeSigningPayloadJson: (json) => json,
      normalizeThresholdKeygenPayloadJson: (json) => json,
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
