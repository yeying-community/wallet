/**
 * MPC service: device identity + key management (stage 1 scaffold).
 */

import { encryptObject, decryptObject } from '../common/crypto/index.js';
import { generateId } from '../common/utils/index.js';
import { getTimestamp } from '../common/utils/time-utils.js';
import {
  getUserSetting,
  getMpcDeviceId,
  setMpcDeviceId,
  getMpcDeviceKey,
  saveMpcDeviceKey,
  getMpcParticipant,
  saveMpcParticipant,
  getMpcSession,
  saveMpcSession,
  getMpcSessionList,
  getMpcMessage,
  saveMpcMessage,
  appendMpcAuditLog,
  getMpcAuditExportConfig,
  saveMpcAuditExportConfig,
  getMpcAuditExportQueue,
  setMpcAuditExportQueue
} from '../storage/index.js';
import { MpcCoordinatorClient } from './mpc-coordinator-client.js';
import { getCachedPassword } from './password-cache.js';
import {
  MPC_SIGNING_ALG,
  MPC_E2E_ALG,
  formatKeyWithPrefix,
  stripKeyPrefix,
  generateSigningKeyPair,
  generateE2eKeyPair,
  exportPublicKeyRawBase64,
  exportPrivateKeyJwk,
  importPrivateKeyJwk,
  importPublicKeyRawBase64,
  encryptEnvelope,
  decryptEnvelope
} from './mpc-crypto.js';

const DEFAULT_MPC_COORDINATOR_ENDPOINT = 'https://www.yeying.pub';

class MpcService {
  constructor() {
    this._initialized = false;
    this._deviceId = null;
    this._deviceKeys = null;
    this._coordinator = new MpcCoordinatorClient({
      endpoint: '',
      getToken: async () => await getUserSetting('mpcCoordinatorUcanToken', '')
    });
    this._streams = new Map();
    this._streamCursors = new Map();
    this._exportInFlight = false;
  }

  async init() {
    if (this._initialized) return;
    this._initialized = true;
    this._deviceId = await getMpcDeviceId();
    const endpoint = await getUserSetting('mpcCoordinatorEndpoint', DEFAULT_MPC_COORDINATOR_ENDPOINT);
    if (endpoint) {
      this._coordinator.setEndpoint(endpoint);
    }
  }

  async onUnlocked(password) {
    await this.init();
    if (!password) return;
    await this.ensureDeviceKeys(password);
  }

  async onLocked() {
    this._deviceKeys = null;
  }

  async ensureDeviceKeys(password) {
    if (!password) {
      throw new Error('Password is required to unlock MPC keys');
    }

    let deviceId = this._deviceId;
    if (!deviceId) {
      deviceId = generateId('mpc_device');
      await setMpcDeviceId(deviceId);
      this._deviceId = deviceId;
    }

    let record = await getMpcDeviceKey(deviceId);
    if (!record) {
      record = await this._createDeviceKeys(deviceId, password);
    }

    const signingJwk = await decryptObject(record.encryptedSigningPrivateKey, password);
    const e2eJwk = await decryptObject(record.encryptedE2ePrivateKey, password);

    const [signingPrivateKey, e2ePrivateKey] = await Promise.all([
      importPrivateKeyJwk(signingJwk, MPC_SIGNING_ALG, ['sign']),
      importPrivateKeyJwk(e2eJwk, MPC_E2E_ALG, ['deriveKey'])
    ]);

    const signingPublicKeyBase64 = stripKeyPrefix(record.signingPublicKey, 'ed25519');
    const e2ePublicKeyBase64 = stripKeyPrefix(record.e2ePublicKey, 'x25519');

    const [signingPublicKey, e2ePublicKey] = await Promise.all([
      importPublicKeyRawBase64(signingPublicKeyBase64, MPC_SIGNING_ALG, ['verify']),
      importPublicKeyRawBase64(e2ePublicKeyBase64, MPC_E2E_ALG)
    ]);

    this._deviceKeys = {
      signingPrivateKey,
      e2ePrivateKey,
      signingPublicKey,
      e2ePublicKey,
      signingPublicKeyRaw: formatKeyWithPrefix('ed25519', signingPublicKeyBase64),
      e2ePublicKeyRaw: formatKeyWithPrefix('x25519', e2ePublicKeyBase64)
    };

    return this._deviceKeys;
  }

  async _requireDeviceKeys(password) {
    if (this._deviceKeys) return this._deviceKeys;
    const candidate = password || getCachedPassword();
    if (!candidate) {
      throw new Error('MPC keys are locked');
    }
    return await this.ensureDeviceKeys(candidate);
  }

  getCoordinatorClient() {
    return this._coordinator;
  }

  async setCoordinatorEndpoint(endpoint) {
    const normalized = String(endpoint || '').trim();
    this._coordinator.setEndpoint(normalized);
  }

  getDeviceId() {
    return this._deviceId;
  }

  getDevicePublicKeys() {
    if (!this._deviceKeys) return null;
    return {
      deviceId: this._deviceId,
      signingPublicKey: this._deviceKeys.signingPublicKeyRaw,
      e2ePublicKey: this._deviceKeys.e2ePublicKeyRaw
    };
  }

  getDevicePrivateKeys() {
    return this._deviceKeys || null;
  }

  async getDeviceInfo() {
    await this.init();
    const publicKeys = this.getDevicePublicKeys();
    return {
      deviceId: this._deviceId,
      keys: publicKeys
    };
  }

  async createSession(options = {}) {
    await this.init();
    const type = String(options.type || 'keygen').toLowerCase();
    const payload = {
      type,
      walletId: options.walletId || null,
      threshold: options.threshold ?? null,
      participants: Array.isArray(options.participants) ? options.participants : [],
      curve: options.curve || 'secp256k1',
      expiresAt: options.expiresAt ?? null,
      keyVersion: options.keyVersion ?? undefined,
      shareVersion: options.shareVersion ?? undefined
    };

    const response = await this._coordinator.createSession(payload);
    const sessionId = response?.sessionId || response?.id || options.sessionId || generateId('mpc_session');
    const now = getTimestamp();
    const session = {
      id: sessionId,
      type,
      walletId: response?.walletId || payload.walletId,
      threshold: response?.threshold ?? payload.threshold,
      participants: response?.participants || payload.participants,
      curve: response?.curve || payload.curve,
      status: response?.status || 'created',
      round: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: response?.expiresAt || payload.expiresAt
    };
    await saveMpcSession(session);
    return { session, response };
  }

  async joinSession(options = {}) {
    await this.init();
    const sessionId = String(options.sessionId || '').trim();
    const participantId = String(options.participantId || '').trim();
    if (!sessionId) {
      throw new Error('sessionId is required');
    }
    if (!participantId) {
      throw new Error('participantId is required');
    }

    const deviceKeys = await this._requireDeviceKeys(options.password);
    const deviceId = this._deviceId || (await getMpcDeviceId());
    if (!deviceId) {
      throw new Error('deviceId not initialized');
    }

    const identity = options.identity || '';
    const payload = {
      participantId,
      deviceId,
      identity,
      e2ePublicKey: deviceKeys.e2ePublicKeyRaw,
      signingPublicKey: deviceKeys.signingPublicKeyRaw
    };

    const response = await this._coordinator.joinSession(sessionId, payload);
    const now = getTimestamp();
    const participantRecord = {
      id: participantId,
      label: options.label || participantId,
      deviceId,
      identity,
      signingPublicKey: deviceKeys.signingPublicKeyRaw,
      e2ePublicKey: deviceKeys.e2ePublicKeyRaw,
      status: 'active',
      joinedAt: now
    };
    await saveMpcParticipant(participantRecord);

    const session = await getMpcSession(sessionId);
    if (session) {
      const list = Array.isArray(session.participants) ? [...session.participants] : [];
      if (!list.includes(participantId)) {
        list.push(participantId);
      }
      await saveMpcSession({
        ...session,
        participants: list,
        updatedAt: now
      });
    }

    return { participant: participantRecord, response };
  }

  async sendSessionMessage(options = {}) {
    await this.init();
    const sessionId = String(options.sessionId || '').trim();
    const from = String(options.from || '').trim();
    if (!sessionId) {
      throw new Error('sessionId is required');
    }
    if (!from) {
      throw new Error('from is required');
    }

    const deviceKeys = await this._requireDeviceKeys(options.password);
    const existing = options.message || {};
    let envelope = existing.envelope || null;

    if (!envelope) {
      const recipientKey = await this._resolveRecipientKey({
        toParticipantId: options.toParticipantId,
        recipientE2ePublicKey: options.recipientE2ePublicKey
      });
      if (!recipientKey) {
        throw new Error('recipientE2ePublicKey is required');
      }
      const payload = options.payload ?? existing.payload ?? {};
      envelope = await encryptEnvelope({
        payload,
        senderSigningKey: deviceKeys.signingPrivateKey,
        senderE2ePrivateKey: deviceKeys.e2ePrivateKey,
        senderE2ePublicKey: deviceKeys.e2ePublicKeyRaw,
        recipientE2ePublicKey: recipientKey
      });
    }

    const session = await getMpcSession(sessionId);
    const now = getTimestamp();
    const round = Number.isFinite(options.round)
      ? options.round
      : (Number.isFinite(existing.round) ? existing.round : (Number.isFinite(session?.round) ? session.round : 0));
    const seq = Number.isFinite(options.seq)
      ? options.seq
      : (Number.isFinite(existing.seq) ? existing.seq : undefined);
    const message = {
      id: existing.id || generateId('mpc_msg'),
      sessionId,
      from,
      to: options.to || options.toParticipantId || existing.to || 'coordinator',
      round,
      type: options.type || existing.type || 'message',
      seq,
      envelope,
      createdAt: existing.createdAt || now
    };

    await saveMpcMessage(message);
    await this._coordinator.sendMessage(sessionId, message);

    if (session) {
      await saveMpcSession({
        ...session,
        round: Math.max(session.round || 0, round || 0),
        updatedAt: now
      });
    }

    return { message };
  }

  async decryptMessage(options = {}) {
    await this.init();
    const messageId = String(options.messageId || '').trim();
    const message = options.message || (messageId ? await getMpcMessage(messageId) : null);
    if (!message) {
      throw new Error('message not found');
    }
    const envelope = message.envelope;
    if (!envelope) {
      throw new Error('message has no envelope');
    }
    const deviceKeys = await this._requireDeviceKeys(options.password);
    let senderE2ePublicKey = envelope.senderPubKey || message.senderE2ePublicKey || '';
    let senderSigningPublicKey = null;
    if (message.from) {
      const participant = await getMpcParticipant(message.from);
      if (participant?.signingPublicKey) {
        const raw = stripKeyPrefix(participant.signingPublicKey, 'ed25519');
        senderSigningPublicKey = await importPublicKeyRawBase64(raw, MPC_SIGNING_ALG, ['verify']);
      }
      if (!senderE2ePublicKey && participant?.e2ePublicKey) {
        senderE2ePublicKey = participant.e2ePublicKey;
      }
    }
    const result = await decryptEnvelope({
      envelope,
      recipientE2ePrivateKey: deviceKeys.e2ePrivateKey,
      senderE2ePublicKey,
      senderSigningPublicKey,
      parseJson: true
    });
    return {
      payload: result.payload,
      plaintext: result.plaintext,
      verified: Boolean(senderSigningPublicKey)
    };
  }

  async fetchSessionMessages(sessionId, options = {}) {
    await this.init();
    const id = String(sessionId || '').trim();
    if (!id) {
      throw new Error('sessionId is required');
    }
    const response = await this._coordinator.fetchMessages(id, options);
    const messages = Array.isArray(response) ? response : (response?.messages || []);
    const stored = [];
    for (const msg of messages) {
      if (!msg?.id) continue;
      const exists = await getMpcMessage(msg.id);
      if (!exists) {
        await saveMpcMessage(msg);
      }
      stored.push(msg);
    }
    return {
      messages: stored,
      cursor: response?.nextCursor || response?.cursor || null,
      hasMore: Boolean(response?.hasMore)
    };
  }

  async getSession(sessionId) {
    return await getMpcSession(sessionId);
  }

  async getSessions() {
    return await getMpcSessionList();
  }

  async startEventStream(sessionId, options = {}) {
    await this.init();
    const id = String(sessionId || '').trim();
    if (!id) {
      throw new Error('sessionId is required');
    }
    if (this._streams.has(id)) {
      return { started: false, running: true };
    }

    const cursor = options.cursor || this._streamCursors.get(id) || '';
    await this._appendAuditLog({
      sessionId: id,
      level: 'info',
      action: 'stream-start',
      message: '开始订阅协调器事件流'
    });

    const cleanup = () => {
      this._streams.delete(id);
    };

    const stream = await this._coordinator.openSessionStream(id, {
      cursor,
      onEvent: (event) => {
        this._handleStreamEvent(id, event).catch(() => {});
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'stream error';
        this._appendAuditLog({
          sessionId: id,
          level: 'error',
          action: 'stream-error',
          message
        }).catch(() => {});
        cleanup();
      },
      onClose: () => {
        this._appendAuditLog({
          sessionId: id,
          level: 'warn',
          action: 'stream-close',
          message: '事件流已断开'
        }).catch(() => {});
        cleanup();
      }
    });

    this._streams.set(id, stream);
    return { started: true };
  }

  async stopEventStream(sessionId) {
    const id = String(sessionId || '').trim();
    if (!id) {
      throw new Error('sessionId is required');
    }
    const stream = this._streams.get(id);
    if (stream?.close) {
      stream.close();
    }
    this._streams.delete(id);
    await this._appendAuditLog({
      sessionId: id,
      level: 'info',
      action: 'stream-stop',
      message: '已停止事件流'
    });
    return { stopped: true };
  }

  async reencryptDeviceKeys(oldPassword, newPassword) {
    await this.init();
    const deviceId = this._deviceId || (await getMpcDeviceId());
    if (!deviceId) {
      return { updated: false };
    }
    const record = await getMpcDeviceKey(deviceId);
    if (!record) {
      return { updated: false };
    }
    const [signingJwk, e2eJwk] = await Promise.all([
      decryptObject(record.encryptedSigningPrivateKey, oldPassword),
      decryptObject(record.encryptedE2ePrivateKey, oldPassword)
    ]);
    const now = getTimestamp();
    const nextRecord = {
      ...record,
      encryptedSigningPrivateKey: await encryptObject(signingJwk, newPassword),
      encryptedE2ePrivateKey: await encryptObject(e2eJwk, newPassword),
      updatedAt: now
    };
    await saveMpcDeviceKey(nextRecord);

    this._deviceKeys = null;
    await this.ensureDeviceKeys(newPassword);
    return { updated: true };
  }

  async getAuditExportConfig() {
    const config = await getMpcAuditExportConfig();
    if (config && typeof config === 'object') {
      return {
        enabled: Boolean(config.enabled),
        endpoint: String(config.endpoint || '').trim(),
        headers: config.headers && typeof config.headers === 'object' ? config.headers : {},
        lastStatus: config.lastStatus && typeof config.lastStatus === 'object' ? config.lastStatus : null
      };
    }
    return { enabled: false, endpoint: '', headers: {}, lastStatus: null };
  }

  async updateAuditExportConfig(updates = {}) {
    const stored = await getMpcAuditExportConfig();
    const current = stored && typeof stored === 'object' ? stored : {};
    const next = {
      ...current,
      enabled: 'enabled' in updates ? Boolean(updates.enabled) : current.enabled,
      endpoint: 'endpoint' in updates ? String(updates.endpoint || '').trim() : current.endpoint,
      headers: 'headers' in updates && updates.headers && typeof updates.headers === 'object'
        ? updates.headers
        : current.headers
    };
    await saveMpcAuditExportConfig(next);
    return await this.getAuditExportConfig();
  }

  async exportAuditLogsNow(logs = []) {
    const config = await this.getAuditExportConfig();
    if (!config.endpoint) {
      throw new Error('Export endpoint is required');
    }
    const payload = Array.isArray(logs) ? logs : [];
    try {
      await this._sendAuditLogs(config, payload);
      await this._updateAuditExportStatus({ status: 'success', sent: payload.length });
      return { sent: payload.length };
    } catch (error) {
      await this._updateAuditExportStatus({
        status: 'error',
        sent: payload.length,
        error: error?.message || 'export failed'
      });
      throw error;
    }
  }

  async flushAuditExportQueue() {
    if (this._exportInFlight) {
      return { skipped: true };
    }
    const config = await this.getAuditExportConfig();
    if (!config.enabled || !config.endpoint) {
      return { skipped: true };
    }
    const queue = await getMpcAuditExportQueue();
    if (!Array.isArray(queue) || queue.length === 0) {
      return { sent: 0 };
    }
    this._exportInFlight = true;
    try {
      await this._sendAuditLogs(config, queue);
      await setMpcAuditExportQueue([]);
      await this._updateAuditExportStatus({ status: 'success', sent: queue.length });
      return { sent: queue.length };
    } catch (error) {
      await this._updateAuditExportStatus({
        status: 'error',
        sent: queue.length,
        error: error?.message || 'export failed'
      });
      throw error;
    } finally {
      this._exportInFlight = false;
    }
  }

  async _updateAuditExportStatus({ status, sent, error }) {
    const stored = await getMpcAuditExportConfig();
    const current = stored && typeof stored === 'object' ? stored : {};
    const now = getTimestamp();
    const nextStatus = {
      status,
      time: now,
      sent: Number.isFinite(sent) ? sent : null,
      error: error || ''
    };
    const next = {
      ...current,
      lastStatus: nextStatus
    };
    await saveMpcAuditExportConfig(next);
    return nextStatus;
  }

  async _resolveRecipientKey({ toParticipantId, recipientE2ePublicKey }) {
    if (recipientE2ePublicKey) {
      return String(recipientE2ePublicKey);
    }
    if (!toParticipantId) return '';
    const participant = await getMpcParticipant(toParticipantId);
    return participant?.e2ePublicKey || '';
  }

  async _handleStreamEvent(sessionId, event) {
    if (!event) return;
    if (event.id) {
      this._streamCursors.set(sessionId, event.id);
    }
    const payload = event.data || {};
    const eventType = payload?.type || event.type || 'message';
    const data = payload?.data ?? payload;
    const time = payload?.timestamp || getTimestamp();

    if (eventType === 'message' && data?.id) {
      const existing = await getMpcMessage(data.id);
      if (!existing) {
        await saveMpcMessage(data);
      }
    }

    if (eventType === 'session-update') {
      const session = await getMpcSession(sessionId);
      if (session) {
        await saveMpcSession({
          ...session,
          status: data?.status || session.status,
          round: Number.isFinite(data?.round) ? data.round : session.round,
          updatedAt: getTimestamp()
        });
      }
    }

    if (eventType === 'participant-joined') {
      const session = await getMpcSession(sessionId);
      if (session && data?.status) {
        await saveMpcSession({
          ...session,
          status: data.status,
          updatedAt: getTimestamp()
        });
      }
    }

    const message = eventType === 'message'
      ? `收到会话消息 ${data?.type || ''}`.trim()
      : `收到事件 ${eventType}`;
    await this._appendAuditLog({
      sessionId,
      level: 'info',
      action: `event-${eventType}`,
      message,
      time
    });
  }

  async _appendAuditLog(entry) {
    const now = getTimestamp();
    const record = {
      id: generateId('mpc_audit'),
      level: entry?.level || 'info',
      action: entry?.action || 'event',
      message: entry?.message || '',
      sessionId: entry?.sessionId || '',
      time: entry?.time || now
    };
    await appendMpcAuditLog(record);

    const exportConfig = await this.getAuditExportConfig();
    if (exportConfig.enabled && exportConfig.endpoint) {
      const queue = await getMpcAuditExportQueue();
      const nextQueue = Array.isArray(queue) ? [...queue, record] : [record];
      await setMpcAuditExportQueue(nextQueue);
      this.flushAuditExportQueue().catch(() => {});
    }
  }

  async _sendAuditLogs(config, logs) {
    const endpoint = String(config?.endpoint || '').trim();
    if (!endpoint) {
      throw new Error('Export endpoint is required');
    }
    const headers = {
      'Content-Type': 'application/json',
      ...(config?.headers || {})
    };
    const body = {
      type: 'mpc_audit_logs',
      exportedAt: getTimestamp(),
      logs
    };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`Export failed: ${response.status}`);
    }
  }

  async _createDeviceKeys(deviceId, password) {
    const now = getTimestamp();
    const signingKeys = await generateSigningKeyPair();
    const e2eKeys = await generateE2eKeyPair();

    const [signingPublicKeyBase64, e2ePublicKeyBase64] = await Promise.all([
      exportPublicKeyRawBase64(signingKeys.publicKey),
      exportPublicKeyRawBase64(e2eKeys.publicKey)
    ]);
    const [signingPrivateJwk, e2ePrivateJwk] = await Promise.all([
      exportPrivateKeyJwk(signingKeys.privateKey),
      exportPrivateKeyJwk(e2eKeys.privateKey)
    ]);

    const record = {
      id: deviceId,
      signingPublicKey: formatKeyWithPrefix('ed25519', signingPublicKeyBase64),
      e2ePublicKey: formatKeyWithPrefix('x25519', e2ePublicKeyBase64),
      encryptedSigningPrivateKey: await encryptObject(signingPrivateJwk, password),
      encryptedE2ePrivateKey: await encryptObject(e2ePrivateJwk, password),
      createdAt: now,
      updatedAt: now
    };

    await saveMpcDeviceKey(record);

    this._deviceKeys = {
      signingPrivateKey: signingKeys.privateKey,
      e2ePrivateKey: e2eKeys.privateKey,
      signingPublicKey: signingKeys.publicKey,
      e2ePublicKey: e2eKeys.publicKey,
      signingPublicKeyRaw: record.signingPublicKey,
      e2ePublicKeyRaw: record.e2ePublicKey
    };

    return record;
  }
}

export const mpcService = new MpcService();
