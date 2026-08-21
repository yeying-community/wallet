const REQUIRED_WASM_EXPORTS = [
  'cggmp24EngineMetadataJson',
  'normalizeWireMessageJson',
  'normalizeSigningPayloadJson',
  'normalizeThresholdKeygenPayloadJson',
];

function requireFunction(target, name) {
  if (!target || typeof target[name] !== 'function') {
    throw new Error('MPC_CGGMP24_WASM_NOT_LOADED');
  }
  return target[name].bind(target);
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  return JSON.parse(String(value));
}

function stringifyJson(value) {
  return typeof value === 'string' ? value : JSON.stringify(value ?? {});
}

export class Cggmp24WasmEngine {
  constructor({ wasm } = {}) {
    this._wasm = wasm || null;
  }

  isLoaded() {
    return REQUIRED_WASM_EXPORTS.every((name) => typeof this._wasm?.[name] === 'function');
  }

  getMetadata() {
    const metadataJson = requireFunction(this._wasm, 'cggmp24EngineMetadataJson')();
    return parseJson(metadataJson, {});
  }

  normalizeWireMessage(message) {
    const normalized = requireFunction(this._wasm, 'normalizeWireMessageJson')(stringifyJson(message));
    return parseJson(normalized, {});
  }

  normalizeSigningPayload(payload) {
    const normalized = requireFunction(this._wasm, 'normalizeSigningPayloadJson')(stringifyJson(payload));
    return parseJson(normalized, {});
  }

  normalizeThresholdKeygenPayload(payload) {
    const normalized = requireFunction(this._wasm, 'normalizeThresholdKeygenPayloadJson')(stringifyJson(payload));
    return parseJson(normalized, {});
  }

  async startKeygen() {
    throw new Error('MPC_CGGMP24_STATE_MACHINE_NOT_IMPLEMENTED');
  }

  async startSign() {
    throw new Error('MPC_CGGMP24_STATE_MACHINE_NOT_IMPLEMENTED');
  }

  async receiveMessage() {
    throw new Error('MPC_CGGMP24_STATE_MACHINE_NOT_IMPLEMENTED');
  }

  async advance() {
    throw new Error('MPC_CGGMP24_STATE_MACHINE_NOT_IMPLEMENTED');
  }

  async getOutgoingMessages() {
    throw new Error('MPC_CGGMP24_STATE_MACHINE_NOT_IMPLEMENTED');
  }

  async getResult() {
    throw new Error('MPC_CGGMP24_STATE_MACHINE_NOT_IMPLEMENTED');
  }
}

let cggmp24WasmEngine = new Cggmp24WasmEngine();

export function getCggmp24WasmEngine() {
  return cggmp24WasmEngine;
}

export function setCggmp24WasmModuleForTests(wasm) {
  cggmp24WasmEngine = new Cggmp24WasmEngine({ wasm });
  return cggmp24WasmEngine;
}

export function resetCggmp24WasmEngineForTests() {
  cggmp24WasmEngine = new Cggmp24WasmEngine();
}

export async function installCggmp24WasmEngine({ wasm, setEngine } = {}) {
  const engine = new Cggmp24WasmEngine({ wasm });
  if (!engine.isLoaded()) {
    throw new Error('MPC_CGGMP24_WASM_NOT_LOADED');
  }
  if (typeof setEngine !== 'function') {
    throw new Error('MPC_TSS_ENGINE_INSTALLER_REQUIRED');
  }
  setEngine(engine);
  cggmp24WasmEngine = engine;
  return engine.getMetadata();
}
