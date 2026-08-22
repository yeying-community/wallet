const REQUIRED_WASM_EXPORTS = [
  'Cggmp24ThresholdKeygenSession',
  'Cggmp24AuxInfoSession',
  'Cggmp24SigningSession',
  'cggmp24EngineMetadataJson',
  'normalizeWireMessageJson',
  'normalizeSigningPayloadJson',
  'normalizeThresholdKeygenPayloadJson',
  'normalizeAuxInfoPayloadJson',
  'coreKeySharePublicMaterialJson',
  'combineKeyShareJson',
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

  normalizeAuxInfoPayload(payload) {
    const normalized = requireFunction(this._wasm, 'normalizeAuxInfoPayloadJson')(stringifyJson(payload));
    return parseJson(normalized, {});
  }

  coreKeySharePublicMaterial(keyShare) {
    const material = requireFunction(this._wasm, 'coreKeySharePublicMaterialJson')(stringifyJson(keyShare));
    return parseJson(material, {});
  }

  combineKeyShare(coreKeyShare, auxInfo) {
    const combined = requireFunction(this._wasm, 'combineKeyShareJson')(
      stringifyJson(coreKeyShare),
      stringifyJson(auxInfo)
    );
    return parseJson(combined, {});
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

  async startSign({ sessionId, requestId = '', senderIndex, parties, payload, keyShareRef } = {}) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('MPC_SESSION_ID_REQUIRED');
    }
    const normalizedSenderIndex = Number(senderIndex);
    const normalizedParties = Array.isArray(parties) ? parties.map((item) => Number(item)) : [];
    if (!Number.isInteger(normalizedSenderIndex) || normalizedSenderIndex < 0) {
      throw new Error('INVALID_MPC_PARTICIPANT_INDEX');
    }
    if (!normalizedParties.length || normalizedSenderIndex >= normalizedParties.length) {
      throw new Error('INVALID_MPC_PARTICIPANT_COUNT');
    }
    const keyShare = keyShareRef?.completeKeyShare || keyShareRef?.keyShare || keyShareRef?.share || null;
    if (!keyShare) {
      throw new Error('MPC_CGGMP24_COMPLETE_KEY_SHARE_REQUIRED');
    }
    const messageHex = String(
      payload?.messageHex
      || payload?.dataHex
      || payload?.transactionHash
      || payload?.hash
      || ''
    ).trim();
    if (!messageHex) {
      throw new Error('MPC_CGGMP24_SIGNING_MESSAGE_HEX_REQUIRED');
    }
    const Session = requireFunction(this._wasm, 'Cggmp24SigningSession');
    const wasmSession = new Session(
      normalizedSessionId,
      String(requestId || ''),
      normalizedSenderIndex,
      stringifyJson(normalizedParties),
      stringifyJson(keyShare),
      messageHex
    );
    const state = {
      protocol: 'sign',
      sessionId: normalizedSessionId,
      requestId: String(requestId || ''),
      senderIndex: normalizedSenderIndex,
      parties: normalizedParties,
      payload,
      keyShareRef,
      wasmSession
    };
    this._sessions.set(normalizedSessionId, state);
    await this.advance({ sessionId: normalizedSessionId, state });
    return state;
  }

  async startAuxInfo({ sessionId, senderIndex, parties, curve = 'secp256k1' } = {}) {
    if (curve !== 'secp256k1') {
      throw new Error('MPC_CGGMP24_UNSUPPORTED_CURVE');
    }
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('MPC_SESSION_ID_REQUIRED');
    }
    const normalizedSenderIndex = Number(senderIndex);
    const partyCount = Array.isArray(parties) ? parties.length : Number(parties || 0);
    if (!Number.isInteger(normalizedSenderIndex) || normalizedSenderIndex < 0) {
      throw new Error('INVALID_MPC_PARTICIPANT_INDEX');
    }
    if (!Number.isInteger(partyCount) || partyCount <= 0) {
      throw new Error('INVALID_MPC_PARTICIPANT_COUNT');
    }
    const Session = requireFunction(this._wasm, 'Cggmp24AuxInfoSession');
    const wasmSession = new Session(
      normalizedSessionId,
      normalizedSenderIndex,
      partyCount
    );
    const state = {
      protocol: 'aux-info',
      sessionId: normalizedSessionId,
      senderIndex: normalizedSenderIndex,
      parties: Array.isArray(parties) ? [...parties] : [],
      curve,
      wasmSession
    };
    this._sessions.set(normalizedSessionId, state);
    await this.advance({ sessionId: normalizedSessionId, state });
    return state;
  }

  async receiveMessage({ sessionId, state, message } = {}) {
    const sessionState = this._resolveSessionState(sessionId, state);
    if (!['keygen', 'aux-info', 'sign'].includes(sessionState.protocol)) {
      throw new Error('MPC_CGGMP24_SIGNING_STATE_MACHINE_NOT_IMPLEMENTED');
    }
    sessionState.wasmSession.receiveWireMessageJson(stringifyJson(message));
    return sessionState;
  }

  async advance({ sessionId, state, maxSteps = 100 } = {}) {
    const sessionState = this._resolveSessionState(sessionId, state);
    if (!['keygen', 'aux-info', 'sign'].includes(sessionState.protocol)) {
      throw new Error('MPC_CGGMP24_SIGNING_STATE_MACHINE_NOT_IMPLEMENTED');
    }
    sessionState.lastAdvance = parseJson(sessionState.wasmSession.advanceJson(maxSteps), {});
    return sessionState;
  }

  async getOutgoingMessages({ sessionId, state } = {}) {
    const sessionState = this._resolveSessionState(sessionId, state);
    if (!['keygen', 'aux-info', 'sign'].includes(sessionState.protocol)) {
      throw new Error('MPC_CGGMP24_SIGNING_STATE_MACHINE_NOT_IMPLEMENTED');
    }
    const outgoing = parseJson(sessionState.wasmSession.drainOutgoingJson(), []);
    return (Array.isArray(outgoing) ? outgoing : []).map((message) => ({
      protocol: sessionState.protocol,
      senderIndex: sessionState.senderIndex,
      audience: message.audience,
      payload: message.payload
    }));
  }

  async getResult({ sessionId, state } = {}) {
    const sessionState = this._resolveSessionState(sessionId, state);
    if (!['keygen', 'aux-info', 'sign'].includes(sessionState.protocol)) {
      throw new Error('MPC_CGGMP24_SIGNING_STATE_MACHINE_NOT_IMPLEMENTED');
    }
    const result = parseJson(sessionState.wasmSession.resultJson(), null);
    if (!result) {
      return null;
    }
    if (sessionState.protocol === 'aux-info') {
      return {
        status: 'completed',
        auxInfo: result,
        curve: sessionState.curve,
      };
    }
    if (sessionState.protocol === 'sign') {
      return {
        status: 'completed',
        signature: result.signature,
        signatureHex: result.signatureHex,
        requestId: sessionState.requestId,
      };
    }
    const material = this.coreKeySharePublicMaterial(result);
    const publicKey = String(material.compressedPublicKeyHex || '').trim();
    const uncompressedPublicKey = String(material.uncompressedPublicKeyHex || '').trim();
    const address = String(material.ethereumAddress || '').trim();
    return {
      status: 'completed',
      keyShare: result,
      share: result,
      publicKey,
      groupPublicKey: publicKey,
      uncompressedPublicKey,
      address,
      walletAddress: address,
      curve: material.curve || sessionState.curve,
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
