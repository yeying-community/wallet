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

export class MpcTssStateMachineAdapter {
  constructor({ engine: wasmEngine, transport } = {}) {
    this._engine = wasmEngine || null;
    this._transport = transport || null;
    this._sessions = new Map();
  }

  async startSign({ sessionId, requestId = '', senderIndex, parties, payload, keyShareRef } = {}) {
    const startSign = requireFunction(this._engine, 'startSign');
    const state = await startSign({
      sessionId,
      requestId,
      senderIndex,
      parties,
      payload,
      keyShareRef
    });
    return await this._rememberAndFlush({ sessionId, protocol: 'sign', senderIndex, state });
  }

  async startKeygen({ sessionId, senderIndex, parties, threshold, curve = 'secp256k1' } = {}) {
    const startKeygen = requireFunction(this._engine, 'startKeygen');
    const state = await startKeygen({
      sessionId,
      senderIndex,
      parties,
      threshold,
      curve
    });
    return await this._rememberAndFlush({ sessionId, protocol: 'keygen', senderIndex, state });
  }

  async receiveMessage({ sessionId, message } = {}) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('MPC_SESSION_ID_REQUIRED');
    }
    const state = this._sessions.get(normalizedSessionId);
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
    this._sessions.set(normalizedSessionId, nextState || state);
    return await this.advance({ sessionId: normalizedSessionId });
  }

  async advance({ sessionId } = {}) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('MPC_SESSION_ID_REQUIRED');
    }
    const state = this._sessions.get(normalizedSessionId);
    if (!state) {
      throw new Error('MPC_TSS_SESSION_NOT_STARTED');
    }
    const advance = requireFunction(this._engine, 'advance');
    const nextState = await advance({ sessionId: normalizedSessionId, state });
    this._sessions.set(normalizedSessionId, nextState || state);
    return await this._flushOutgoing({ sessionId: normalizedSessionId, state: nextState || state });
  }

  async getResult({ sessionId } = {}) {
    const normalizedSessionId = String(sessionId || '').trim();
    const state = this._sessions.get(normalizedSessionId);
    if (!state) {
      throw new Error('MPC_TSS_SESSION_NOT_STARTED');
    }
    const getResult = requireFunction(this._engine, 'getResult');
    return await getResult({ sessionId: normalizedSessionId, state });
  }

  async _rememberAndFlush({ sessionId, protocol, senderIndex, state }) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('MPC_SESSION_ID_REQUIRED');
    }
    const nextState = {
      ...(state && typeof state === 'object' ? state : {}),
      protocol,
      senderIndex
    };
    this._sessions.set(normalizedSessionId, nextState);
    return await this._flushOutgoing({ sessionId: normalizedSessionId, state: nextState });
  }

  async _flushOutgoing({ sessionId, state }) {
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
        sequence: item.sequence
      });
      if (this._transport && typeof this._transport.sendWireMessage === 'function') {
        sent.push(await this._transport.sendWireMessage({
          sessionId,
          protocol: wireMessage.protocol,
          senderIndex: wireMessage.sender_index,
          audience: wireMessage.audience,
          payload: wireMessage.payload,
          sequence: wireMessage.sequence
        }));
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
