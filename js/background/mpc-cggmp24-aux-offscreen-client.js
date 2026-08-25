import { ensureOffscreenDocument } from './offscreen.js';

const CHANNEL_NAME = 'yeying-mpc-aux-info';
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

function hasBroadcastChannel() {
  return typeof BroadcastChannel !== 'undefined';
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mpc_aux_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export class MpcAuxInfoOffscreenClient {
  constructor({ timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    this.timeoutMs = timeoutMs;
    this.channel = null;
    this.pending = new Map();
  }

  async startAuxInfo(input = {}) {
    const result = await this._request('startAuxInfo', input);
    return this._buildRemoteState(result?.state || {
      sessionId: input.sessionId,
      senderIndex: input.senderIndex,
      parties: input.parties,
      curve: input.curve,
      requestId: input.requestId
    });
  }

  async receiveMessage(input = {}) {
    await this._request('receiveMessage', {
      sessionId: input.sessionId || input.state?.sessionId,
      message: input.message
    });
    return this._buildRemoteState(input.state || input);
  }

  async advance(input = {}) {
    await this._request('advance', {
      sessionId: input.sessionId || input.state?.sessionId,
      maxSteps: input.maxSteps
    });
    return this._buildRemoteState(input.state || input);
  }

  async getOutgoingMessages(input = {}) {
    const result = await this._request('getOutgoingMessages', {
      sessionId: input.sessionId || input.state?.sessionId
    });
    return Array.isArray(result?.messages) ? result.messages : [];
  }

  async getResult(input = {}) {
    const result = await this._request('getResult', {
      sessionId: input.sessionId || input.state?.sessionId
    });
    return result?.result || null;
  }

  async _request(operation, payload = {}) {
    if (!hasBroadcastChannel()) {
      throw new Error('MPC_AUX_INFO_OFFSCREEN_CHANNEL_UNAVAILABLE');
    }
    await ensureOffscreenDocument();
    this._ensureChannel();

    const id = createRequestId();
    const message = {
      scope: 'mpc-aux-info',
      kind: 'request',
      id,
      operation,
      payload
    };

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('MPC_AUX_INFO_OFFSCREEN_TIMEOUT'));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.channel.postMessage(message);
    });
  }

  _ensureChannel() {
    if (this.channel) return;
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (event) => {
      const message = event?.data || {};
      if (message.scope !== 'mpc-aux-info' || message.kind !== 'response') return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.success) {
        pending.resolve(message.data || {});
      } else {
        pending.reject(new Error(message.error || 'MPC_AUX_INFO_OFFSCREEN_FAILED'));
      }
    };
  }

  _buildRemoteState(input = {}) {
    const parties = Array.isArray(input.parties) ? [...input.parties] : [];
    return {
      protocol: 'aux-info',
      sessionId: String(input.sessionId || ''),
      senderIndex: Number(input.senderIndex),
      parties,
      partyCount: Number(input.partyCount || parties.length || 0),
      curve: input.curve || 'secp256k1',
      requestId: String(input.requestId || ''),
      remoteAuxInfo: true
    };
  }
}
