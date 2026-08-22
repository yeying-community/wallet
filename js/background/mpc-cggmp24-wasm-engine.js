const REQUIRED_WASM_EXPORTS = [
  'Cggmp24ThresholdKeygenSession',
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
    this._sessions = new Map();
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

  async startKeygen({ sessionId, senderIndex, parties, threshold, curve = 'secp256k1' } = {}) {
    if (curve !== 'secp256k1') {
      throw new Error('MPC_CGGMP24_UNSUPPORTED_CURVE');
    }
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('MPC_SESSION_ID_REQUIRED');
    }
    const normalizedSenderIndex = Number(senderIndex);
    const partyCount = Array.isArray(parties) ? parties.length : Number(parties || 0);
    const normalizedThreshold = Number(threshold);
    if (!Number.isInteger(normalizedSenderIndex) || normalizedSenderIndex < 0) {
      throw new Error('INVALID_MPC_PARTICIPANT_INDEX');
    }
    if (!Number.isInteger(partyCount) || partyCount <= 0) {
      throw new Error('INVALID_MPC_PARTICIPANT_COUNT');
    }
    if (!Number.isInteger(normalizedThreshold) || normalizedThreshold <= 0 || normalizedThreshold > partyCount) {
      throw new Error('INVALID_MPC_THRESHOLD');
    }
    const Session = requireFunction(this._wasm, 'Cggmp24ThresholdKeygenSession');
    const wasmSession = new Session(
      normalizedSessionId,
      normalizedSenderIndex,
      partyCount,
      normalizedThreshold
    );
    const state = {
      protocol: 'keygen',
      sessionId: normalizedSessionId,
      senderIndex: normalizedSenderIndex,
      parties: Array.isArray(parties) ? [...parties] : [],
      threshold: normalizedThreshold,
      curve,
      wasmSession
    };
    this._sessions.set(normalizedSessionId, state);
    await this.advance({ sessionId: normalizedSessionId, state });
    return state;
  }

  async startSign() {
    throw new Error('MPC_CGGMP24_STATE_MACHINE_NOT_IMPLEMENTED');
  }

  async receiveMessage({ sessionId, state, message } = {}) {
    const sessionState = this._resolveSessionState(sessionId, state);
    if (sessionState.protocol !== 'keygen') {
      throw new Error('MPC_CGGMP24_SIGNING_STATE_MACHINE_NOT_IMPLEMENTED');
    }
    sessionState.wasmSession.receiveWireMessageJson(stringifyJson(message));
    return sessionState;
  }

  async advance({ sessionId, state, maxSteps = 100 } = {}) {
    const sessionState = this._resolveSessionState(sessionId, state);
    if (sessionState.protocol !== 'keygen') {
      throw new Error('MPC_CGGMP24_SIGNING_STATE_MACHINE_NOT_IMPLEMENTED');
    }
    sessionState.lastAdvance = parseJson(sessionState.wasmSession.advanceJson(maxSteps), {});
    return sessionState;
  }

  async getOutgoingMessages({ sessionId, state } = {}) {
    const sessionState = this._resolveSessionState(sessionId, state);
    if (sessionState.protocol !== 'keygen') {
      throw new Error('MPC_CGGMP24_SIGNING_STATE_MACHINE_NOT_IMPLEMENTED');
    }
    const outgoing = parseJson(sessionState.wasmSession.drainOutgoingJson(), []);
    return (Array.isArray(outgoing) ? outgoing : []).map((message) => ({
      protocol: 'keygen',
      senderIndex: sessionState.senderIndex,
      audience: message.audience,
      payload: message.payload
    }));
  }

  async getResult({ sessionId, state } = {}) {
    const sessionState = this._resolveSessionState(sessionId, state);
    if (sessionState.protocol !== 'keygen') {
      throw new Error('MPC_CGGMP24_SIGNING_STATE_MACHINE_NOT_IMPLEMENTED');
    }
    const result = parseJson(sessionState.wasmSession.resultJson(), null);
    if (!result) {
      return null;
    }
    return {
      status: 'completed',
      keyShare: result,
      share: result,
      curve: sessionState.curve,
      threshold: sessionState.threshold
    };
  }

  _resolveSessionState(sessionId, state) {
    const normalizedSessionId = String(sessionId || state?.sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('MPC_SESSION_ID_REQUIRED');
    }
    const sessionState = state?.wasmSession ? state : this._sessions.get(normalizedSessionId);
    if (!sessionState?.wasmSession) {
      throw new Error('MPC_TSS_SESSION_NOT_STARTED');
    }
    return sessionState;
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
