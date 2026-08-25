/**
 * MPC TSS engine adapter boundary.
 *
 * The wallet must not emulate MPC signing with a locally reconstructed private
 * key. A real implementation should plug a browser-safe threshold ECDSA engine
 * here and exchange round messages through mpcService.
 */

import { createMpcWireMessage, parseMpcWireMessage } from './mpc-wire-protocol.js';

function requireFunction(target, name) {
  if (!target || typeof target[name] !== 'function') {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }
  return target[name].bind(target);
}

function logMpcTssDebug(event, data = {}) {
  console.info('[MPC_DEBUG]', event, data);
}

export class MpcTssStateMachineAdapter {
  constructor({ engine: wasmEngine, transport, stateStore, protocol = '', senderIndex = null, requestId = '' } = {}) {
    this._engine = wasmEngine || null;
    this._transport = transport || null;
    this._stateStore = stateStore || null;
    this._protocol = String(protocol || '').trim();
    this._senderIndex = senderIndex;
    this._requestId = String(requestId || '').trim();
    this._sessions = new Map();
  }

  async startSign({ sessionId, requestId = '', senderIndex, parties, payload, keyShareRef, maxSteps, password } = {}) {
    const startSign = requireFunction(this._engine, 'startSign');
    const state = await startSign({
      sessionId,
      requestId,
      senderIndex,
      parties,
      payload,
      keyShareRef,
      maxSteps
    });
    return await this._rememberAndFlush({ sessionId, protocol: 'sign', senderIndex, state, transportOptions: { password } });
  }

  async startAuxInfo({ sessionId, senderIndex, parties, curve = 'secp256k1', maxSteps, password } = {}) {
    const startAuxInfo = requireFunction(this._engine, 'startAuxInfo');
    const startedAt = Date.now();
    logMpcTssDebug('tss-adapter:start-aux-info:before-engine', {
      sessionId,
      senderIndex,
      partiesCount: Array.isArray(parties) ? parties.length : 0,
      maxSteps
    });
    const state = await startAuxInfo({
      sessionId,
      senderIndex,
      parties,
      curve,
      maxSteps,
      requestId: this._requestId || ''
    });
    logMpcTssDebug('tss-adapter:start-aux-info:after-engine', {
      sessionId,
      senderIndex,
      durationMs: Date.now() - startedAt
    });
    const flushStartedAt = Date.now();
    const result = await this._rememberAndFlush({ sessionId, protocol: 'aux-info', senderIndex, state, transportOptions: { password } });
    logMpcTssDebug('tss-adapter:start-aux-info:after-flush', {
      sessionId,
      senderIndex,
      durationMs: Date.now() - flushStartedAt,
      messageCount: Array.isArray(result?.messages) ? result.messages.length : 0
    });
    return result;
  }

  async startKeygen({ sessionId, senderIndex, parties, threshold, curve = 'secp256k1', maxSteps, password } = {}) {
    const startKeygen = requireFunction(this._engine, 'startKeygen');
    const state = await startKeygen({
      sessionId,
      senderIndex,
      parties,
      threshold,
      curve,
      maxSteps
    });
    return await this._rememberAndFlush({ sessionId, protocol: 'keygen', senderIndex, state, transportOptions: { password } });
  }

  async receiveMessage({ sessionId, message, maxSteps, password } = {}) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('MPC_SESSION_ID_REQUIRED');
    }
    const state = await this._getSessionState(normalizedSessionId);
    if (!state) {
      throw new Error('MPC_TSS_SESSION_NOT_STARTED');
    }
    const receiveMessage = requireFunction(this._engine, 'receiveMessage');
    const wireMessage = parseMpcWireMessage(message);
    const nextState = await receiveMessage({
      sessionId: normalizedSessionId,
      state,
      message: wireMessage
    });
    await this._setSessionState(normalizedSessionId, nextState || state);
    return await this.advance({ sessionId: normalizedSessionId, maxSteps, password });
  }

  async advance({ sessionId, maxSteps, password } = {}) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('MPC_SESSION_ID_REQUIRED');
    }
    const state = await this._getSessionState(normalizedSessionId);
    if (!state) {
      throw new Error('MPC_TSS_SESSION_NOT_STARTED');
    }
    const advance = requireFunction(this._engine, 'advance');
    const nextState = await advance({ sessionId: normalizedSessionId, state, maxSteps });
    await this._setSessionState(normalizedSessionId, nextState || state);
    return await this._flushOutgoing({ sessionId: normalizedSessionId, state: nextState || state, transportOptions: { password } });
  }

  async getResult({ sessionId } = {}) {
    const normalizedSessionId = String(sessionId || '').trim();
    const state = await this._getSessionState(normalizedSessionId);
    if (!state) {
      throw new Error('MPC_TSS_SESSION_NOT_STARTED');
    }
    const getResult = requireFunction(this._engine, 'getResult');
    return await getResult({ sessionId: normalizedSessionId, state });
  }

  async _rememberAndFlush({ sessionId, protocol, senderIndex, state, transportOptions = {} }) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('MPC_SESSION_ID_REQUIRED');
    }
    const nextState = {
      ...(state && typeof state === 'object' ? state : {}),
      protocol,
      senderIndex,
      requestId: state?.requestId || this._requestId || ''
    };
    await this._setSessionState(normalizedSessionId, nextState);
    return await this._flushOutgoing({ sessionId: normalizedSessionId, state: nextState, transportOptions });
  }

  async _getSessionState(sessionId) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) return null;
    const cached = this._sessions.get(normalizedSessionId);
    if (cached) return cached;
    if (!this._stateStore || typeof this._stateStore.load !== 'function') {
      return null;
    }
    const record = await this._stateStore.load({
      sessionId: normalizedSessionId,
      protocol: this._protocol,
      senderIndex: this._senderIndex,
      requestId: this._requestId
    });
    const snapshot = record?.snapshot;
    if (!snapshot) return null;
    if (snapshot.persistable === false) {
      throw new Error(snapshot.reason || 'MPC_TSS_STATE_NOT_PERSISTABLE');
    }
    let state = snapshot;
    if (this._engine && typeof this._engine.importState === 'function') {
      state = await this._engine.importState(snapshot);
    } else if (snapshot?.requiresEngineImport) {
      throw new Error('MPC_TSS_STATE_RESTORE_UNSUPPORTED');
    }
    this._sessions.set(normalizedSessionId, state);
    return state;
  }

  async _setSessionState(sessionId, state) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('MPC_SESSION_ID_REQUIRED');
    }
    this._sessions.set(normalizedSessionId, state);
    if (!this._stateStore || typeof this._stateStore.save !== 'function') {
      return;
    }
    const snapshot = await this._exportPersistableState(normalizedSessionId, state);
    await this._stateStore.save({
      sessionId: normalizedSessionId,
      protocol: state?.protocol || this._protocol,
      senderIndex: state?.senderIndex ?? this._senderIndex,
      requestId: state?.requestId || this._requestId,
      snapshot
    });
  }

  async _exportPersistableState(sessionId, state) {
    if (this._engine && typeof this._engine.exportState === 'function') {
      return await this._engine.exportState({ sessionId, state });
    }
    if (state?.wasmSession) {
      return {
        requiresEngineImport: true,
        persistable: false,
        reason: 'MPC_TSS_STATE_NOT_PERSISTABLE',
        protocol: state.protocol,
        sessionId,
        senderIndex: state.senderIndex,
        requestId: state.requestId || '',
        updatedAt: Date.now()
      };
    }
    return JSON.parse(JSON.stringify(state || {}));
  }

  async _flushOutgoing({ sessionId, state, transportOptions = {} }) {
    const getOutgoingMessages = requireFunction(this._engine, 'getOutgoingMessages');
    const outgoing = await getOutgoingMessages({ sessionId, state });
    const messages = Array.isArray(outgoing) ? outgoing : [];
    const sent = [];
    for (const item of messages) {
      const audience = item.audience || (
        item.recipientIndex !== undefined && item.recipientIndex !== null
          ? { 'one-party': { recipient_index: Number(item.recipientIndex) } }
          : 'all-parties'
      );
      const wireMessage = createMpcWireMessage({
        sessionId,
        protocol: item.protocol || state.protocol || 'sign',
        senderIndex: item.senderIndex ?? state.senderIndex,
        audience,
        payload: item.payload,
        sequence: item.sequence,
        requestId: item.requestId || state.requestId || this._requestId || ''
      });
      if (this._transport && typeof this._transport.sendWireMessage === 'function') {
        const transportMessage = {
          sessionId,
          protocol: wireMessage.protocol,
          senderIndex: wireMessage.sender_index,
          audience: wireMessage.audience,
          payload: wireMessage.payload,
          sequence: wireMessage.sequence
        };
        if (transportOptions.password !== undefined) {
          transportMessage.password = transportOptions.password;
        }
        if (wireMessage.request_id) {
          transportMessage.requestId = wireMessage.request_id;
        }
        sent.push(await this._transport.sendWireMessage(transportMessage));
      } else {
        sent.push({ message: wireMessage });
      }
    }
    return { state, messages: sent };
  }
}

class UnconfiguredMpcTssEngine {
  async startSign() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }

  async advance() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }

  async receiveMessage() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }

  async getOutgoingMessages() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }

  async getResult() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }

  async startKeygen() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }

  async startAuxInfo() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }

  async handleKeygenMessage() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }

  async handleSignMessage() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }

  async signTransaction() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }

  async signMessage() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }

  async signTypedData() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }
}

let engine = new UnconfiguredMpcTssEngine();

export function getMpcTssEngine() {
  return engine;
}

export function installMpcTssEngine(nextEngine) {
  if (!nextEngine) {
    throw new Error('MPC_TSS_ENGINE_REQUIRED');
  }
  [
    'startSign',
    'startKeygen',
    'advance',
    'receiveMessage',
    'getOutgoingMessages',
    'getResult'
  ].forEach((name) => requireFunction(nextEngine, name));
  engine = nextEngine;
  return engine;
}

export function setMpcTssEngineForTests(nextEngine) {
  engine = nextEngine || new UnconfiguredMpcTssEngine();
}

export function resetMpcTssEngineForTests() {
  engine = new UnconfiguredMpcTssEngine();
}

function normalizeEngineError(error) {
  if (String(error?.message || error || '') === 'MPC_TSS_ENGINE_NOT_CONFIGURED') {
    throw new Error('MPC_SIGNER_NOT_CONFIGURED');
  }
  throw error;
}

export async function startMpcKeygen(input) {
  try {
    return await engine.startKeygen(input);
  } catch (error) {
    normalizeEngineError(error);
  }
}

export async function handleMpcKeygenMessage(input) {
  try {
    return await engine.handleKeygenMessage(input);
  } catch (error) {
    normalizeEngineError(error);
  }
}

export async function handleMpcSignMessage(input) {
  try {
    return await engine.handleSignMessage(input);
  } catch (error) {
    normalizeEngineError(error);
  }
}

export async function signMpcTransaction(input) {
  try {
    return await engine.signTransaction(input);
  } catch (error) {
    normalizeEngineError(error);
  }
}

export async function signMpcMessage(input) {
  try {
    return await engine.signMessage(input);
  } catch (error) {
    normalizeEngineError(error);
  }
}

export async function signMpcTypedData(input) {
  try {
    return await engine.signTypedData(input);
  } catch (error) {
    normalizeEngineError(error);
  }
}
