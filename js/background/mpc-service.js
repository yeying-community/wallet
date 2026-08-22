/**
 * MPC service: device identity + key management (stage 1 scaffold).
 */

import { encryptObject, decryptObject } from '../common/crypto/index.js';
import { generateId } from '../common/utils/index.js';
import { getTimestamp } from '../common/utils/time-utils.js';
import {
  getUserSetting,
  getSelectedAccount,
  getMpcDeviceId,
  setMpcDeviceId,
  getMpcDeviceKey,
  saveMpcDeviceKey,
  getMpcParticipant,
  saveMpcParticipant,
  getMpcWallet,
  saveMpcWallet,
  getMpcKeyShares,
  getMpcKeyShare,
  saveMpcKeyShare,
  getMpcSession,
  saveMpcSession,
  getMpcSessionList,
  getMpcSignRequests,
  getMpcSignRequest,
  saveMpcSignRequest,
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
import { ensureTargetUcanToken } from './target-ucan-manager.js';
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
import { createActionSignature } from './action-signature.js';
import {
  MpcTssStateMachineAdapter,
  getMpcTssEngine,
  handleMpcKeygenMessage,
  handleMpcSignMessage,
  startMpcKeygen
} from './mpc-tss-engine.js';
import { createMpcWireMessage, inferMpcWireRound } from './mpc-wire-protocol.js';
import { MpcWireSessionRunner } from './mpc-wire-session-runner.js';

const DEFAULT_MPC_COORDINATOR_ENDPOINT = 'https://node.yeying.pub';
const DEFAULT_MPC_UCAN_RESOURCE = 'mpc';
const DEFAULT_MPC_UCAN_ACTION = 'coordinate';
const DEFAULT_MPC_UCAN_TTL_HOURS = 24;
const MPC_SESSION_ACTIVE_STATUSES = new Set(['active', 'completed', 'complete', 'succeeded', 'success']);
const MPC_SESSION_READY_STATUSES = new Set(['ready']);
const MPC_SESSION_RUNNING_STATUSES = new Set(['rounds', 'running', 'in_progress', 'in-progress']);
const MPC_SESSION_FAILED_STATUSES = new Set(['failed', 'error']);
const INVALID_MPC_WALLET_NAMES = new Set(['MPC 钱包创建邀请', 'MPC 钱包邀请']);

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
    this._keygenStarts = new Set();
    this._wireSessionCursors = new Map();
    this._wireSessionAdapters = new Map();
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
    // MPC has no user-facing enable switch. Prepare its coordinator session
    // as part of wallet unlock so notifications are authorized immediately.
    await this._ensureCoordinatorToken({ password });
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

  isSessionCancelledError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('session cancelled') || message.includes('session_cancelled');
  }

  _buildParticipantRecord(sessionId, participant = {}) {
    const participantId = String(participant?.participantId || participant?.id || participant || '').trim();
    if (!sessionId || !participantId) {
      return null;
    }
    return {
      id: participantId,
      sessionId,
      label: participant?.label || participantId,
      deviceId: String(participant?.deviceId || '').trim(),
      identity: String(participant?.identity || '').trim(),
      signingPublicKey: String(participant?.signingPublicKey || '').trim(),
      e2ePublicKey: String(participant?.e2ePublicKey || '').trim(),
      status: String(participant?.status || 'active').trim() || 'active',
      joinedAt: participant?.joinedAt || getTimestamp()
    };
  }

  _normalizeParticipantIds(participants = []) {
    if (!Array.isArray(participants)) return [];
    const normalized = [];
    const seen = new Set();
    for (const participant of participants) {
      const id = String(participant?.participantId || participant?.id || participant?.address || participant || '').trim();
      const key = id.toLowerCase();
      if (!id || seen.has(key)) continue;
      seen.add(key);
      normalized.push(id);
    }
    return normalized;
  }

  _resolveWalletName(source = {}, fallback = '') {
    const name = String(source?.name || '').trim();
    if (name && !INVALID_MPC_WALLET_NAMES.has(name)) {
      return name;
    }
    const fallbackName = String(fallback || '').trim();
    return INVALID_MPC_WALLET_NAMES.has(fallbackName) ? '' : fallbackName;
  }

  _buildSessionRecord(input = {}, fallback = {}) {
    const sessionId = String(input.id || fallback.id || '').trim();
    if (!sessionId) {
      return null;
    }
    return {
      id: sessionId,
      type: String(input.type || fallback.type || 'keygen').trim() || 'keygen',
      name: this._resolveWalletName(input, fallback.name || ''),
      walletId: String(input.walletId || fallback.walletId || '').trim(),
      threshold: input.threshold ?? fallback.threshold ?? null,
      participants: this._normalizeParticipantIds(Array.isArray(input.participants) ? input.participants : fallback.participants),
      curve: String(input.curve || fallback.curve || 'secp256k1').trim() || 'secp256k1',
      status: String(input.status || fallback.status || 'created').trim() || 'created',
      round: Number.isFinite(input.round) ? input.round : (Number.isFinite(fallback.round) ? fallback.round : 0),
      createdAt: input.createdAt || fallback.createdAt || getTimestamp(),
      updatedAt: getTimestamp(),
      expiresAt: input.expiresAt || fallback.expiresAt || '',
      keyVersion: Number.isFinite(input.keyVersion) ? input.keyVersion : fallback.keyVersion,
      shareVersion: Number.isFinite(input.shareVersion) ? input.shareVersion : fallback.shareVersion,
      result: input.result || fallback.result || null
    };
  }

  async _syncSessionParticipants(sessionId, participants = []) {
    if (!sessionId || !Array.isArray(participants)) return [];
    const synced = [];
    for (const item of participants) {
      const participant = this._buildParticipantRecord(sessionId, item);
      if (!participant) continue;
      await saveMpcParticipant(participant);
      synced.push(participant);
    }
    return synced;
  }

  async _syncSessionSnapshot(sessionInput, fallback = {}) {
    const session = this._buildSessionRecord(sessionInput, fallback);
    if (!session) {
      return null;
    }
    const joinedParticipants = Array.isArray(sessionInput?.joinedParticipants)
      ? sessionInput.joinedParticipants
      : [];
    await saveMpcSession(session);
    await this._syncSessionParticipants(session.id, joinedParticipants);
    await this._syncWalletFromSession(session, sessionInput);
    await this._maybeStartKeygen(session).catch(() => {});
    return session;
  }

  async _maybeStartKeygen(session) {
    const status = String(session?.status || '').trim().toLowerCase();
    if (status !== 'ready') return;
    const sessionId = String(session?.id || '').trim();
    if (!sessionId || this._keygenStarts.has(sessionId)) return;
    this._keygenStarts.add(sessionId);
    try {
      await this.startKeygenSession({ sessionId });
    } catch (error) {
      await this._appendAuditLog({
        sessionId,
        level: 'warn',
        action: 'keygen-start-skipped',
        message: error?.message || 'keygen start skipped'
      });
    } finally {
      this._keygenStarts.delete(sessionId);
    }
  }

  async syncWalletFromSession(sessionOrId) {
    const session = typeof sessionOrId === 'string'
      ? await getMpcSession(sessionOrId)
      : sessionOrId;
    return await this._syncWalletFromSession(session, session);
  }

  async _syncWalletFromSession(session, rawSession = {}) {
    const walletId = String(session?.walletId || rawSession?.walletId || '').trim();
    if (!walletId || String(session?.type || rawSession?.type || '').toLowerCase() !== 'keygen') {
      return null;
    }
    const wallet = await getMpcWallet(walletId);
    if (!wallet) {
      return null;
    }

    const result = rawSession?.result || rawSession?.keygenResult || rawSession?.output || {};
    const status = String(rawSession?.status || session?.status || '').toLowerCase();
    const next = { ...wallet, updatedAt: getTimestamp() };
    let changed = false;
    const setIfPresent = (targetKey, ...sources) => {
      const value = sources.map(item => String(item || '').trim()).find(Boolean);
      if (!value || String(next[targetKey] || '') === value) return;
      next[targetKey] = value;
      changed = true;
    };
    const setNumberIfPresent = (targetKey, ...sources) => {
      const value = sources.find(item => item !== undefined && item !== null && String(item).trim() !== '' && Number.isFinite(Number(item)));
      if (value === undefined) return;
      const numberValue = Number(value);
      if (next[targetKey] === numberValue) return;
      next[targetKey] = numberValue;
      changed = true;
    };
    const setArrayIfPresent = (targetKey, value) => {
      const normalized = this._normalizeParticipantIds(value);
      if (!normalized.length) return;
      if (JSON.stringify(next[targetKey] || []) === JSON.stringify(normalized)) return;
      next[targetKey] = normalized;
      changed = true;
    };

    if (MPC_SESSION_ACTIVE_STATUSES.has(status) && next.status !== 'active') {
      next.status = 'active';
      changed = true;
    } else if (MPC_SESSION_READY_STATUSES.has(status) && next.status !== 'keygen_ready') {
      next.status = 'keygen_ready';
      changed = true;
    } else if (MPC_SESSION_RUNNING_STATUSES.has(status) && next.status !== 'keygen_running') {
      next.status = 'keygen_running';
      changed = true;
    } else if (MPC_SESSION_FAILED_STATUSES.has(status) && next.status !== 'failed') {
      next.status = 'failed';
      changed = true;
    }

    setIfPresent('name', this._resolveWalletName(rawSession, session?.name || ''), this._resolveWalletName(result));
    setIfPresent('keygenSessionId', session?.id, rawSession?.id);
    setIfPresent('curve', rawSession?.curve, session?.curve, result?.curve);
    setIfPresent('address', rawSession?.address, result?.address, result?.walletAddress, result?.accountAddress);
    setIfPresent('publicKey', rawSession?.publicKey, result?.publicKey, result?.groupPublicKey, result?.aggregatePublicKey);
    setIfPresent('chainCode', rawSession?.chainCode, result?.chainCode);
    setNumberIfPresent('threshold', rawSession?.threshold, session?.threshold, result?.threshold);
    setNumberIfPresent('keyVersion', rawSession?.keyVersion, session?.keyVersion, result?.keyVersion);
    setNumberIfPresent('shareVersion', rawSession?.shareVersion, session?.shareVersion, result?.shareVersion);
    setArrayIfPresent('participants', rawSession?.participants || session?.participants || result?.participants);

    if (!changed) {
      return wallet;
    }
    await saveMpcWallet(next);
    return next;
  }

  async _refreshSessionFromCoordinator(sessionId) {
    const id = String(sessionId || '').trim();
    if (!id) {
      throw new Error('sessionId is required');
    }
    await this._ensureCoordinatorToken();
    const response = await this._coordinator.getSession(id);
    const local = await getMpcSession(id);
    const session = await this._syncSessionSnapshot(response, local || { id });
    return { session, response };
  }

  async _ensureCoordinatorToken(options = {}) {
    const endpoint = String(options.endpoint || '').trim()
      || await getUserSetting('mpcCoordinatorEndpoint', DEFAULT_MPC_COORDINATOR_ENDPOINT);
    if (endpoint) {
      this._coordinator.setEndpoint(endpoint);
    }
    const result = await ensureTargetUcanToken({
      endpoint,
      tokenSettingKey: 'mpcCoordinatorUcanToken',
      audienceSettingKey: 'mpcCoordinatorUcanAudience',
      resourceSettingKey: 'mpcCoordinatorUcanResource',
      actionSettingKey: 'mpcCoordinatorUcanAction',
      defaultResource: DEFAULT_MPC_UCAN_RESOURCE,
      defaultAction: DEFAULT_MPC_UCAN_ACTION,
      ttlHours: options.ttlHours ?? DEFAULT_MPC_UCAN_TTL_HOURS,
      password: options.password,
      audience: options.audience,
      resource: options.resource,
      action: options.action,
      forceRefresh: options.forceRefresh
    });
    return result;
  }

  async generateCoordinatorUcan(options = {}) {
    await this.init();
    return await this._ensureCoordinatorToken({
      endpoint: options.endpoint,
      password: options.password,
      audience: options.audience,
      resource: options.resource,
      action: options.action,
      ttlHours: options.ttlHours,
      forceRefresh: options.forceRefresh
    });
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
    await this._ensureCoordinatorToken({
      endpoint: options.endpoint,
      password: options.password,
      audience: options.audience,
      resource: options.resource,
      action: options.action,
      ttlHours: options.ttlHours,
      forceRefresh: options.forceRefresh
    });
    const type = String(options.type || 'keygen').toLowerCase();
    const walletName = String(options.name || '').trim() || undefined;
    const payload = {
      type,
      name: walletName,
      walletId: options.walletId || null,
      threshold: options.threshold ?? null,
      participants: Array.isArray(options.participants) ? options.participants : [],
      curve: options.curve || 'secp256k1',
      expiresAt: options.expiresAt ?? undefined,
      keyVersion: options.keyVersion ?? undefined,
      shareVersion: options.shareVersion ?? undefined
    };
    const actionPayload = {
      requestedSessionId: '',
      type: payload.type,
      walletId: String(payload.walletId || ''),
      threshold: Number(payload.threshold),
      participants: payload.participants,
      curve: String(payload.curve || ''),
      expiresAt: payload.expiresAt ? String(payload.expiresAt) : '',
      keyVersion: payload.keyVersion,
      shareVersion: payload.shareVersion,
    };
    const signature = await createActionSignature({
      account: await getSelectedAccount(),
      action: 'mpc_session_create',
      payload: actionPayload,
    });
    const response = await this._coordinator.createSession(payload, signature);
    const sessionId = response?.sessionId || response?.id || options.sessionId || generateId('mpc_session');
    const session = await this._syncSessionSnapshot(response, {
      id: sessionId,
      name: payload.name || '',
      type,
      walletId: payload.walletId,
      threshold: payload.threshold,
      participants: payload.participants,
      curve: payload.curve,
      status: 'created',
      round: 0,
      createdAt: getTimestamp(),
      expiresAt: payload.expiresAt
    });
    await this._appendAuditLog({
      sessionId,
      level: 'info',
      action: 'session-created',
      message: '已发起多签钱包创建'
    });
    return { session, response };
  }

  async joinSession(options = {}) {
    await this.init();
    await this._ensureCoordinatorToken({ password: options.password });
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
    const signature = await createActionSignature({
      account: await getSelectedAccount(),
      action: 'mpc_session_join',
      payload: { sessionId, ...payload },
    });
    const response = await this._coordinator.joinSession(sessionId, payload, signature);
    const now = getTimestamp();
    const participantRecord = {
      id: participantId,
      sessionId,
      label: options.label || participantId,
      deviceId,
      identity,
      signingPublicKey: deviceKeys.signingPublicKeyRaw,
      e2ePublicKey: deviceKeys.e2ePublicKeyRaw,
      status: 'active',
      joinedAt: now
    };
    await saveMpcParticipant(participantRecord);
    const sessionSnapshot = response?.session || response;
    const existing = await getMpcSession(sessionId);
    const session = await this._syncSessionSnapshot(sessionSnapshot, existing || {
      id: sessionId,
      participants: [participantId],
      updatedAt: now
    });
    await this._appendAuditLog({
      sessionId,
      level: 'info',
      action: 'session-joined',
      message: '已加入多签钱包创建'
    });

    return { participant: participantRecord, session, response };
  }

  async _resolveLocalParticipantId(session) {
    const account = await getSelectedAccount();
    const address = String(account?.address || '').trim();
    if (!address) return '';
    const participants = this._normalizeParticipantIds(session?.participants || []);
    return participants.find((item) => item.toLowerCase() === address.toLowerCase()) || address;
  }

  async _handleTssEngineOutput({ session, wallet, participantId, output, password }) {
    const result = output && typeof output === 'object' ? output : {};
    const sessionId = String(session?.id || '').trim();
    const walletId = String(wallet?.id || session?.walletId || '').trim();
    const share = result.keyShare || result.share || null;
    if (share && walletId && participantId) {
      const shareVersion = Number(result.shareVersion ?? session?.shareVersion ?? wallet?.shareVersion ?? 1);
      await saveMpcKeyShare({
        id: result.shareId || `${walletId}:${participantId}:${shareVersion}`,
        walletId,
        sessionId,
        participantId,
        curve: result.curve || session?.curve || wallet?.curve || 'secp256k1',
        publicKey: result.publicKey || result.groupPublicKey || '',
        share,
        keyVersion: Number(result.keyVersion ?? session?.keyVersion ?? wallet?.keyVersion ?? 1),
        shareVersion,
        createdAt: getTimestamp(),
        updatedAt: getTimestamp()
      });
    }

    const messages = Array.isArray(result.messages)
      ? result.messages
      : (Array.isArray(result.outboundMessages) ? result.outboundMessages : []);
    for (const message of messages) {
      await this.sendSessionMessage({
        sessionId,
        from: participantId,
        to: message.to || message.receiver || '',
        toParticipantId: message.toParticipantId || message.to || message.receiver || '',
        round: Number.isFinite(message.round) ? message.round : (Number.isFinite(result.round) ? result.round : 0),
        type: message.type || 'keygen',
        seq: message.seq,
        payload: message.payload ?? message,
        password
      });
    }

    const completed = result.completed || result.status === 'completed' || result.address || result.publicKey || result.groupPublicKey;
    if (completed) {
      const keygenResult = {
        address: result.address || result.walletAddress || '',
        publicKey: result.publicKey || result.groupPublicKey || result.aggregatePublicKey || '',
        groupPublicKey: result.groupPublicKey || result.publicKey || '',
        chainCode: result.chainCode || '',
        curve: result.curve || session?.curve || wallet?.curve,
        keyVersion: result.keyVersion ?? session?.keyVersion,
        shareVersion: result.shareVersion ?? session?.shareVersion,
      };
      const completedSession = {
        ...session,
        status: 'completed',
        name: session?.name || wallet?.name || '',
        keyVersion: keygenResult.keyVersion,
        shareVersion: keygenResult.shareVersion,
        result: keygenResult
      };
      await this._syncWalletFromSession(completedSession, completedSession);
      if (keygenResult.address && keygenResult.publicKey && typeof this._coordinator.completeSession === 'function') {
        const signature = await createActionSignature({
          account: await getSelectedAccount(),
          action: 'mpc_keygen_complete',
          payload: {
            sessionId,
            participantId,
            result: keygenResult
          }
        });
        const response = await this._coordinator.completeSession(sessionId, {
          participantId,
          result: keygenResult
        }, signature);
        if (response) {
          await this._syncSessionSnapshot(response, completedSession);
        }
      }
    }

    return result;
  }

  async _handleWireKeygenResult({ session, wallet, participantId, participantIndex, result } = {}) {
    const output = result && typeof result === 'object' ? result : {};
    const status = String(output.status || '').trim().toLowerCase();
    const share = output.keyShare || output.share || null;
    if (status !== 'completed' || !share) {
      return null;
    }

    const sessionId = String(session?.id || '').trim();
    const walletId = String(wallet?.id || session?.walletId || '').trim();
    const localParticipantId = String(participantId || '').trim();
    if (!sessionId || !walletId || !localParticipantId) {
      return null;
    }

    const shareVersion = Number(output.shareVersion ?? session?.shareVersion ?? wallet?.shareVersion ?? 1);
    const keyVersion = Number(output.keyVersion ?? session?.keyVersion ?? wallet?.keyVersion ?? 1);
    const publicKey = String(
      output.publicKey
      || output.groupPublicKey
      || output.aggregatePublicKey
      || share.shared_public_key
      || share.sharedPublicKey
      || ''
    ).trim();
    const address = String(output.address || output.walletAddress || output.accountAddress || '').trim();
    const uncompressedPublicKey = String(output.uncompressedPublicKey || output.uncompressedPublicKeyHex || '').trim();
    const now = getTimestamp();
    const shareRecord = {
      id: output.shareId || `${walletId}:${localParticipantId}:${shareVersion}`,
      walletId,
      sessionId,
      participantId: localParticipantId,
      participantIndex: Number.isInteger(participantIndex) ? participantIndex : undefined,
      curve: output.curve || session?.curve || wallet?.curve || 'secp256k1',
      publicKey,
      uncompressedPublicKey,
      address,
      share,
      keyVersion,
      shareVersion,
      engine: 'cggmp24',
      signingStatus: 'unavailable',
      signingUnavailableReason: 'MPC_CGGMP24_SIGNING_STATE_MACHINE_NOT_IMPLEMENTED',
      createdAt: now,
      updatedAt: now
    };
    const existingShare = await getMpcKeyShare(shareRecord.id);
    const alreadyCompleted = String(session?.status || '').trim() === 'keygen_completed'
      && String(wallet?.status || '').trim() === 'keygen_completed'
      && existingShare?.share;
    await saveMpcKeyShare(shareRecord);

    const completedResult = {
      ...(session?.result && typeof session.result === 'object' ? session.result : {}),
      status: 'keygen_completed',
      address,
      publicKey,
      groupPublicKey: publicKey,
      uncompressedPublicKey,
      curve: shareRecord.curve,
      keyVersion,
      shareVersion,
      engine: 'cggmp24',
      signingStatus: 'unavailable',
      signingUnavailableReason: 'MPC_CGGMP24_SIGNING_STATE_MACHINE_NOT_IMPLEMENTED'
    };
    const nextSession = {
      ...session,
      status: 'keygen_completed',
      result: completedResult,
      keyVersion,
      shareVersion,
      updatedAt: now
    };
    await saveMpcSession(nextSession);

    const nextWallet = {
      ...wallet,
      id: walletId,
      name: wallet?.name || session?.name || '',
      type: wallet?.type || 'mpc',
      status: 'keygen_completed',
      keygenSessionId: sessionId,
      curve: shareRecord.curve,
      address: address || wallet?.address || '',
      publicKey: publicKey || wallet?.publicKey || '',
      uncompressedPublicKey: uncompressedPublicKey || wallet?.uncompressedPublicKey || '',
      keyVersion,
      shareVersion,
      participants: this._normalizeParticipantIds(session?.participants || wallet?.participants || []),
      signingStatus: 'unavailable',
      signingUnavailableReason: 'MPC_CGGMP24_SIGNING_STATE_MACHINE_NOT_IMPLEMENTED',
      updatedAt: now
    };
    await saveMpcWallet(nextWallet);
    if (!alreadyCompleted) {
      await this._appendAuditLog({
        sessionId,
        level: 'info',
        action: 'wire-keygen-completed',
        message: 'MPC wire keygen 已完成，本地 key share 已保存'
      });
    }
    return { session: nextSession, wallet: nextWallet, keyShare: shareRecord };
  }

  async _handleWireAuxInfoResult({ session, wallet, participantId, participantIndex, result } = {}) {
    const output = result && typeof result === 'object' ? result : {};
    const status = String(output.status || '').trim().toLowerCase();
    const auxInfo = output.auxInfo || output.aux_info || null;
    if (status !== 'completed' || !auxInfo) {
      return null;
    }

    const sessionId = String(session?.id || '').trim();
    const walletId = String(wallet?.id || session?.walletId || '').trim();
    const localParticipantId = String(participantId || '').trim();
    if (!sessionId || !walletId || !localParticipantId) {
      return null;
    }

    const shareVersion = Number(output.shareVersion ?? session?.shareVersion ?? wallet?.shareVersion ?? 1);
    const keyVersion = Number(output.keyVersion ?? session?.keyVersion ?? wallet?.keyVersion ?? 1);
    const shareId = output.shareId || `${walletId}:${localParticipantId}:${shareVersion}`;
    const existingShare = await getMpcKeyShare(shareId);
    if (!existingShare?.share) {
      throw new Error('MPC_CGGMP24_CORE_KEY_SHARE_NOT_FOUND');
    }
    let combinedKeyShare = null;
    let combinedPublicMaterial = null;
    const tssEngine = getMpcTssEngine();
    const canCombineKeyShare = typeof tssEngine?.combineKeyShare === 'function'
      && (typeof tssEngine.isLoaded !== 'function' || tssEngine.isLoaded());
    if (canCombineKeyShare) {
      const combined = await tssEngine.combineKeyShare(existingShare.share, auxInfo);
      if (combined && typeof combined === 'object') {
        combinedKeyShare = combined.keyShare || combined.key_share || null;
        combinedPublicMaterial = {
          publicKey: String(combined.compressedPublicKeyHex || combined.publicKey || '').trim(),
          uncompressedPublicKey: String(combined.uncompressedPublicKeyHex || combined.uncompressedPublicKey || '').trim(),
          address: String(combined.ethereumAddress || combined.address || '').trim(),
          curve: combined.curve
        };
      }
    }

    const now = getTimestamp();
    const completeKeyShare = combinedKeyShare || existingShare.completeKeyShare;
    const canSign = !!completeKeyShare;
    const signingStatus = canSign ? 'available' : 'unavailable';
    const signingUnavailableReason = canSign ? '' : 'MPC_CGGMP24_COMPLETE_KEY_SHARE_NOT_FOUND';

    const shareRecord = {
      ...existingShare,
      id: shareId,
      walletId,
      sessionId: existingShare.sessionId || sessionId,
      auxInfoSessionId: sessionId,
      participantId: localParticipantId,
      participantIndex: Number.isInteger(participantIndex)
        ? participantIndex
        : existingShare.participantIndex,
      curve: output.curve || existingShare.curve || session?.curve || wallet?.curve || 'secp256k1',
      keyVersion,
      shareVersion,
      engine: existingShare.engine || 'cggmp24',
      auxInfo,
      auxInfoStatus: 'completed',
      completeKeyShare,
      completeKeyShareStatus: completeKeyShare ? 'completed' : existingShare.completeKeyShareStatus,
      signingStatus,
      signingUnavailableReason,
      updatedAt: now
    };
    await saveMpcKeyShare(shareRecord);

    const completedResult = {
      ...(session?.result && typeof session.result === 'object' ? session.result : {}),
      status: 'keygen_completed',
      auxInfoStatus: 'completed',
      completeKeyShareStatus: shareRecord.completeKeyShareStatus,
      publicKey: combinedPublicMaterial?.publicKey || session?.result?.publicKey || wallet?.publicKey || existingShare.publicKey || '',
      groupPublicKey: combinedPublicMaterial?.publicKey || session?.result?.groupPublicKey || wallet?.publicKey || existingShare.publicKey || '',
      uncompressedPublicKey: combinedPublicMaterial?.uncompressedPublicKey || session?.result?.uncompressedPublicKey || wallet?.uncompressedPublicKey || existingShare.uncompressedPublicKey || '',
      address: combinedPublicMaterial?.address || session?.result?.address || wallet?.address || existingShare.address || '',
      curve: combinedPublicMaterial?.curve || shareRecord.curve,
      keyVersion,
      shareVersion,
      engine: 'cggmp24',
      signingStatus,
      signingUnavailableReason
    };
    const nextSession = {
      ...session,
      status: canSign ? 'active' : 'keygen_completed',
      result: completedResult,
      auxInfoStatus: 'completed',
      keyVersion,
      shareVersion,
      updatedAt: now
    };
    await saveMpcSession(nextSession);

    const nextWallet = {
      ...wallet,
      id: walletId,
      name: wallet?.name || session?.name || '',
      type: wallet?.type || 'mpc',
      status: canSign ? 'active' : 'keygen_completed',
      keygenSessionId: wallet?.keygenSessionId || sessionId,
      curve: shareRecord.curve,
      address: combinedPublicMaterial?.address || wallet?.address || existingShare.address || '',
      publicKey: combinedPublicMaterial?.publicKey || wallet?.publicKey || existingShare.publicKey || '',
      uncompressedPublicKey: combinedPublicMaterial?.uncompressedPublicKey || wallet?.uncompressedPublicKey || existingShare.uncompressedPublicKey || '',
      keyVersion,
      shareVersion,
      auxInfoStatus: 'completed',
      completeKeyShareStatus: shareRecord.completeKeyShareStatus,
      signingStatus,
      signingUnavailableReason,
      updatedAt: now
    };
    await saveMpcWallet(nextWallet);

    await this._appendAuditLog({
      sessionId,
      level: 'info',
      action: 'wire-aux-info-completed',
      message: 'MPC wire aux-info 已完成，本地 aux-info 已保存'
    });

    return { session: nextSession, wallet: nextWallet, keyShare: shareRecord };
  }

  async _handleWireSignResult({ session, participantId, requestId, result } = {}) {
    const output = result && typeof result === 'object' ? result : {};
    const status = String(output.status || '').trim().toLowerCase();
    if (status !== 'completed') {
      return null;
    }

    const signRequestId = String(
      requestId
      || output.requestId
      || output.signRequestId
      || output.sign_request_id
      || ''
    ).trim();
    if (!signRequestId) {
      return null;
    }

    const signRequest = await getMpcSignRequest(signRequestId);
    if (!signRequest) {
      throw new Error('MPC_SIGN_REQUEST_NOT_FOUND');
    }

    const objectSignatureHex = (() => {
      const signatureObject = output.signature && typeof output.signature === 'object' ? output.signature : null;
      if (!signatureObject) return '';
      const r = String(signatureObject.r || '').trim();
      const s = String(signatureObject.s || '').trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(r) || !/^0x[0-9a-fA-F]{64}$/.test(s)) {
        return '';
      }
      const recovery = Number(signatureObject.recoveryId ?? signatureObject.recid ?? signatureObject.v ?? output.recoveryId ?? output.recid ?? output.v ?? 0);
      const v = Number.isInteger(recovery)
        ? (recovery >= 27 ? recovery : recovery + 27)
        : 27;
      return `${r}${s.slice(2)}${v.toString(16).padStart(2, '0')}`;
    })();
    const signatureHex = typeof output.signatureHex === 'string'
      ? output.signatureHex.trim()
      : (typeof output.signature_hex === 'string' ? output.signature_hex.trim() : objectSignatureHex);
    const signature = signatureHex
      || (typeof output.signature === 'string' ? output.signature.trim() : '')
      || (typeof output.signedPayload === 'string' ? output.signedPayload.trim() : '')
      || (typeof output.signedTransaction === 'string' ? output.signedTransaction.trim() : '');
    if (!signature) {
      return null;
    }

    const sessionId = String(session?.id || signRequest.sessionId || '').trim();
    const localParticipantId = String(participantId || '').trim();
    const now = getTimestamp();
    const next = {
      ...signRequest,
      status: 'completed',
      signature,
      signatureHex: signatureHex || signRequest.signatureHex,
      result: output,
      completedAt: signRequest.completedAt || now,
      updatedAt: now
    };
    await saveMpcSignRequest(next);

    if (sessionId && localParticipantId && typeof this._coordinator.completeSignRequest === 'function') {
      const payload = {
        requestId: signRequestId,
        participantId: localParticipantId,
        signature,
        signatureHex: signatureHex || undefined,
        result: output
      };
      const actionSignature = await createActionSignature({
        account: await getSelectedAccount(),
        action: 'mpc_sign_request_complete',
        payload
      });
      const response = await this._coordinator.completeSignRequest(signRequestId, payload, actionSignature);
      if (response) {
        await saveMpcSignRequest({
          ...next,
          ...response,
          signature: response.signature || next.signature,
          signatureHex: response.signatureHex || next.signatureHex,
          result: response.result || next.result,
          updatedAt: getTimestamp()
        });
      }
    }

    await this._appendAuditLog({
      sessionId,
      level: 'info',
      action: 'wire-sign-completed',
      message: 'MPC wire sign 已完成，本地签名请求已保存',
      metadata: { requestId: signRequestId }
    });

    return { signRequest: await getMpcSignRequest(signRequestId) };
  }

  async startKeygenSession(options = {}) {
    await this.init();
    const sessionId = String(options.sessionId || '').trim();
    if (!sessionId) {
      throw new Error('sessionId is required');
    }
    const alreadyStarting = this._keygenStarts.has(sessionId);
    if (!alreadyStarting) {
      this._keygenStarts.add(sessionId);
    }
    try {
      const { session } = await this._refreshSessionFromCoordinator(sessionId);
      if (!session) {
        throw new Error('MPC_SESSION_NOT_FOUND');
      }
      const walletId = String(options.walletId || session.walletId || '').trim();
      const wallet = walletId ? await getMpcWallet(walletId) : null;
      if (!wallet) {
        throw new Error('MPC_WALLET_NOT_FOUND');
      }
      const participantId = String(options.participantId || await this._resolveLocalParticipantId(session)).trim();
      if (!participantId) {
        throw new Error('MPC_PARTICIPANT_NOT_FOUND');
      }
      const localParticipant = await getMpcParticipant(sessionId, participantId);
      if (!localParticipant) {
        throw new Error('MPC_PARTICIPANT_NOT_JOINED');
      }

      const output = await startMpcKeygen({
        session,
        wallet,
        participant: localParticipant,
        participantId,
        participants: session.participants || [],
        threshold: session.threshold,
        curve: session.curve || wallet.curve || 'secp256k1'
      });
      const handled = await this._handleTssEngineOutput({
        session,
        wallet,
        participantId,
        output,
        password: options.password
      });
      await this._appendAuditLog({
        sessionId,
        level: 'info',
        action: 'keygen-started',
        message: '已启动 MPC 密钥生成'
      });
      return handled;
    } finally {
      if (!alreadyStarting) {
        this._keygenStarts.delete(sessionId);
      }
    }
  }

  async cancelSession(options = {}) {
    await this.init();
    await this._ensureCoordinatorToken({ password: options.password });
    const sessionId = String(options.sessionId || '').trim();
    if (!sessionId) {
      throw new Error('sessionId is required');
    }
    const signature = await createActionSignature({
      account: await getSelectedAccount(),
      action: 'mpc_session_cancel',
      payload: { sessionId },
    });
    const response = await this._coordinator.cancelSession(sessionId, signature);
    const local = await getMpcSession(sessionId);
    const session = await this._syncSessionSnapshot(response, {
      ...(local || { id: sessionId }),
      status: 'cancelled',
    });
    await this._appendAuditLog({
      sessionId,
      level: 'info',
      action: 'session-cancelled',
      message: '已取消多签钱包创建'
    });
    return { session, response };
  }

  async sendSessionMessage(options = {}) {
    await this.init();
    await this._ensureCoordinatorToken({ password: options.password });
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
        sessionId,
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
    const signature = await createActionSignature({
      account: await getSelectedAccount(),
      action: 'mpc_message_send',
      payload: {
        sessionId,
        messageId: message.id,
        from: message.from,
        to: message.to ? String(message.to) : '',
        round: Number.isFinite(message.round) ? message.round : undefined,
        type: message.type,
        seq: Number.isFinite(message.seq) ? message.seq : undefined,
        envelope: message.envelope ?? {},
      },
    });
    await this._coordinator.sendMessage(sessionId, message, signature);

    if (session) {
      await saveMpcSession({
        ...session,
        round: Math.max(session.round || 0, round || 0),
        updatedAt: now
      });
    }

    return { message };
  }

  async sendWireMessage(options = {}) {
    await this.init();
    await this._ensureCoordinatorToken({ password: options.password });
    const sessionId = String(options.sessionId || '').trim();
    if (!sessionId) {
      throw new Error('sessionId is required');
    }
    const message = createMpcWireMessage({
      sessionId,
      protocol: options.protocol || 'sign',
      senderIndex: options.senderIndex,
      audience: options.audience || 'all-parties',
      payload: options.payload,
      sequence: options.sequence
    });
    const signature = await createActionSignature({
      account: await getSelectedAccount(),
      action: 'mpc_message_send',
      payload: {
        sessionId,
        protocolVersion: message.protocol_version,
        engine: message.engine,
        envelopeSessionId: message.session_id,
        protocol: message.protocol,
        senderIndex: message.sender_index,
        audience: message.audience,
        messagePayload: message.payload,
      },
    });
    const response = await this._coordinator.sendWireMessage(sessionId, message, signature);
    const saved = {
      id: response?.id || generateId('mpc_msg'),
      sessionId,
      from: String(response?.sender ?? message.sender_index),
      to: String(response?.receiver ?? ''),
      round: Number.isFinite(response?.round) ? response.round : inferMpcWireRound(message.payload),
      type: response?.type || message.protocol,
      seq: Number.isFinite(response?.seq) ? response.seq : Number(response?.envelope?.sequence || message.sequence || 0),
      envelope: response?.envelope || message,
      createdAt: response?.createdAt || getTimestamp()
    };
    await saveMpcMessage(saved);
    return { message: saved, response };
  }

  async fetchWireMessages(sessionId, options = {}) {
    await this.init();
    await this._ensureCoordinatorToken({ password: options.password });
    const normalizedSessionId = String(sessionId || options.sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('sessionId is required');
    }
    const response = await this._coordinator.fetchMessages(normalizedSessionId, {
      after: options.after,
      recipientIndex: options.recipientIndex,
      limit: options.limit
    });
    const messages = Array.isArray(response?.messages)
      ? response.messages
      : (Array.isArray(response) ? response : []);
    const savedMessages = [];
    for (const item of messages) {
      const saved = {
        id: item?.id || generateId('mpc_msg'),
        sessionId: normalizedSessionId,
        from: String(item?.sender ?? item?.envelope?.sender_index ?? ''),
        to: String(item?.receiver ?? ''),
        round: Number.isFinite(item?.round) ? item.round : inferMpcWireRound(item?.envelope?.payload),
        type: item?.type || item?.envelope?.protocol || 'message',
        seq: Number.isFinite(item?.seq) ? item.seq : Number(item?.envelope?.sequence || 0),
        envelope: item?.envelope || {},
        createdAt: item?.createdAt || getTimestamp()
      };
      await saveMpcMessage(saved);
      savedMessages.push(saved);
    }
    return {
      messages: savedMessages,
      nextCursor: response?.nextCursor,
      nextSequence: response?.nextSequence
    };
  }

  _buildWireSessionKey({ sessionId, recipientIndex, protocol = '' } = {}) {
    return [
      String(sessionId || '').trim(),
      String(recipientIndex ?? '').trim(),
      String(protocol || '').trim()
    ].join(':');
  }

  async _resolveLocalParticipantIndex(session, options = {}) {
    if (options.recipientIndex !== undefined && options.recipientIndex !== null) {
      const index = Number(options.recipientIndex);
      if (Number.isInteger(index) && index >= 0) return index;
    }
    if (options.participantIndex !== undefined && options.participantIndex !== null) {
      const index = Number(options.participantIndex);
      if (Number.isInteger(index) && index >= 0) return index;
    }
    const participantId = String(options.participantId || await this._resolveLocalParticipantId(session)).trim();
    const participants = this._normalizeParticipantIds(session?.participants || []);
    const index = participants.findIndex((item) => item.toLowerCase() === participantId.toLowerCase());
    if (index >= 0) return index;
    throw new Error('MPC_PARTICIPANT_INDEX_NOT_FOUND');
  }

  _getWireSessionAdapter({ sessionId, recipientIndex, protocol = '', adapter } = {}) {
    if (adapter) return adapter;
    const key = this._buildWireSessionKey({ sessionId, recipientIndex, protocol });
    let existing = this._wireSessionAdapters.get(key);
    if (!existing) {
      existing = new MpcTssStateMachineAdapter({
        engine: getMpcTssEngine(),
        transport: this
      });
      this._wireSessionAdapters.set(key, existing);
    }
    return existing;
  }

  async startWireSession(options = {}) {
    await this.init();
    const sessionId = String(options.sessionId || '').trim();
    if (!sessionId) {
      throw new Error('sessionId is required');
    }
    const session = options.session || await getMpcSession(sessionId);
    const protocol = String(options.protocol || session?.type || 'keygen').trim();
    const senderIndex = await this._resolveLocalParticipantIndex(session, options);
    const adapter = this._getWireSessionAdapter({
      sessionId,
      recipientIndex: senderIndex,
      protocol,
      adapter: options.adapter
    });
    const participants = Array.isArray(options.parties)
      ? options.parties
      : this._normalizeParticipantIds(session?.participants || []).map((_participant, index) => index);
    let started;
    if (protocol === 'keygen') {
      started = await adapter.startKeygen({
        sessionId,
        senderIndex,
        parties: participants,
        threshold: options.threshold ?? session?.threshold,
        curve: options.curve || session?.curve || 'secp256k1'
      });
    } else if (protocol === 'aux-info') {
      started = await adapter.startAuxInfo({
        sessionId,
        senderIndex,
        parties: participants,
        curve: options.curve || session?.curve || 'secp256k1'
      });
    } else if (protocol === 'sign') {
      started = await adapter.startSign({
        sessionId,
        requestId: options.requestId || options.signRequestId || '',
        senderIndex,
        parties: participants,
        payload: options.payload,
        keyShareRef: options.keyShareRef
      });
    } else {
      throw new Error('UNSUPPORTED_MPC_WIRE_PROTOCOL');
    }
    const cursorKey = this._buildWireSessionKey({ sessionId, recipientIndex: senderIndex, protocol });
    if (!this._wireSessionCursors.has(cursorKey)) {
      this._wireSessionCursors.set(cursorKey, 0);
    }
    return {
      ...started,
      sessionId,
      senderIndex,
      protocol,
      cursorKey
    };
  }

  async tickWireSession(options = {}) {
    await this.init();
    const sessionId = String(options.sessionId || '').trim();
    if (!sessionId) {
      throw new Error('sessionId is required');
    }
    const session = options.session || await getMpcSession(sessionId);
    const recipientIndex = await this._resolveLocalParticipantIndex(session, options);
    const protocol = String(options.protocol || session?.type || '').trim();
    const cursorKey = this._buildWireSessionKey({ sessionId, recipientIndex, protocol });
    const afterSequence = Number.isFinite(Number(options.afterSequence))
      ? Number(options.afterSequence)
      : (this._wireSessionCursors.get(cursorKey) || 0);
    const adapter = this._getWireSessionAdapter({
      sessionId,
      recipientIndex,
      protocol,
      adapter: options.adapter
    });
    const runner = new MpcWireSessionRunner({
      adapter,
      transport: this,
      sessionId,
      recipientIndex,
      afterSequence,
      limit: options.limit
    });
    const poll = await runner.pollOnce({
      limit: options.limit,
      password: options.password
    });
    this._wireSessionCursors.set(cursorKey, poll.nextSequence);
    let result = null;
    if (typeof adapter.getResult === 'function') {
      try {
        result = await adapter.getResult({ sessionId });
      } catch (error) {
        if (String(error?.message || error || '') !== 'MPC_TSS_SESSION_NOT_STARTED') {
          throw error;
        }
      }
    }
    let handledResult = null;
    if (protocol === 'keygen' && result?.status === 'completed') {
      const participantId = String(options.participantId || await this._resolveLocalParticipantId(session)).trim();
      const walletId = String(options.walletId || session?.walletId || '').trim();
      const wallet = walletId ? await getMpcWallet(walletId) : null;
      handledResult = await this._handleWireKeygenResult({
        session,
        wallet,
        participantId,
        participantIndex: recipientIndex,
        result
      });
    } else if (protocol === 'aux-info' && result?.status === 'completed') {
      const participantId = String(options.participantId || await this._resolveLocalParticipantId(session)).trim();
      const walletId = String(options.walletId || session?.walletId || '').trim();
      const wallet = walletId ? await getMpcWallet(walletId) : null;
      handledResult = await this._handleWireAuxInfoResult({
        session,
        wallet,
        participantId,
        participantIndex: recipientIndex,
        result
      });
    } else if (protocol === 'sign' && result?.status === 'completed') {
      const participantId = String(options.participantId || await this._resolveLocalParticipantId(session)).trim();
      handledResult = await this._handleWireSignResult({
        session,
        participantId,
        requestId: options.requestId || options.signRequestId,
        result
      });
    }
    return {
      ...poll,
      sessionId,
      recipientIndex,
      cursorKey,
      result,
      handledResult
    };
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
      const participant = await getMpcParticipant(message.sessionId || options.sessionId || '', message.from);
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
    await this._ensureCoordinatorToken({ password: options.password });
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
    if (response?.session) {
      const local = await getMpcSession(id);
      await this._syncSessionSnapshot(response.session, local || { id });
    }
    const processed = options.process === false
      ? []
      : await this.processSessionMessages({ sessionId: id, messages: stored, password: options.password }).catch(() => []);
    return {
      messages: stored,
      processed,
      cursor: response?.nextCursor || response?.cursor || null,
      hasMore: Boolean(response?.hasMore)
    };
  }

  async _resolveMessagePayload(message, options = {}) {
    if (message?.payload !== undefined) return message.payload;
    if (!message?.envelope) return null;
    const decrypted = await this.decryptMessage({
      message,
      sessionId: message.sessionId || options.sessionId,
      password: options.password
    });
    return decrypted.payload;
  }

  _isKeygenMessage(message, payload) {
    const type = String(message?.type || payload?.type || '').trim().toLowerCase();
    return type === 'keygen' || type.startsWith('keygen.');
  }

  _isSignMessage(message, payload) {
    const type = String(message?.type || payload?.type || '').trim().toLowerCase();
    return type === 'sign' || type.startsWith('sign.');
  }

  _resolveSignRequestId(message, payload) {
    return String(
      payload?.requestId
      || payload?.signRequestId
      || payload?.sign_request_id
      || message?.requestId
      || message?.signRequestId
      || ''
    ).trim();
  }

  async _handleSignEngineOutput({ session, participantId, signRequest, output, password }) {
    const result = output && typeof output === 'object' ? output : {};
    const sessionId = String(session?.id || signRequest?.sessionId || '').trim();
    const messages = Array.isArray(result.messages)
      ? result.messages
      : (Array.isArray(result.outboundMessages) ? result.outboundMessages : []);
    for (const message of messages) {
      const payload = message.payload && typeof message.payload === 'object'
        ? { ...message.payload, requestId: signRequest.id }
        : { requestId: signRequest.id, payload: message.payload ?? message };
      await this.sendSessionMessage({
        sessionId,
        from: participantId,
        to: message.to || message.receiver || '',
        toParticipantId: message.toParticipantId || message.to || message.receiver || '',
        round: Number.isFinite(message.round) ? message.round : (Number.isFinite(result.round) ? result.round : 0),
        type: message.type || 'sign',
        seq: message.seq,
        payload,
        password
      });
    }

    const signature = String(result.signature || result.signedPayload || '').trim();
    const status = String(result.status || '').trim();
    if (!signature && status !== 'completed') {
      return result;
    }
    const next = {
      ...signRequest,
      status: 'completed',
      signature,
      result,
      completedAt: getTimestamp(),
      updatedAt: getTimestamp()
    };
    await saveMpcSignRequest(next);
    if (signature && sessionId && participantId && typeof this._coordinator.completeSignRequest === 'function') {
      const payload = {
        requestId: signRequest.id,
        participantId,
        signature,
        result
      };
      const actionSignature = await createActionSignature({
        account: await getSelectedAccount(),
        action: 'mpc_sign_request_complete',
        payload
      });
      const response = await this._coordinator.completeSignRequest(signRequest.id, payload, actionSignature);
      if (response) {
        await saveMpcSignRequest({
          ...next,
          ...response,
          updatedAt: getTimestamp()
        });
      }
    }
    return result;
  }

  async listSignRequests(options = {}) {
    await this.init();
    await this._ensureCoordinatorToken({ password: options.password });
    const response = await this._coordinator.listSignRequests({
      sessionId: String(options.sessionId || '').trim(),
      walletId: String(options.walletId || '').trim(),
      status: String(options.status || '').trim(),
      page: options.page || 1,
      pageSize: options.pageSize || 20
    });
    const items = Array.isArray(response?.items) ? response.items : (Array.isArray(response) ? response : []);
    for (const item of items) {
      if (!item?.id) continue;
      await saveMpcSignRequest({
        ...item,
        updatedAt: item.updatedAt || getTimestamp()
      });
    }
    return {
      items,
      page: response?.page || {
        total: items.length,
        page: Number(options.page || 1),
        pageSize: Number(options.pageSize || 20)
      }
    };
  }

  async _findLocalCompleteKeyShare({ walletId, participantId, shareVersion } = {}) {
    const normalizedWalletId = String(walletId || '').trim();
    const normalizedParticipantId = String(participantId || '').trim().toLowerCase();
    if (!normalizedWalletId || !normalizedParticipantId) {
      return null;
    }
    const shares = Object.values(await getMpcKeyShares());
    const matches = shares
      .filter((share) => String(share?.walletId || '').trim() === normalizedWalletId)
      .filter((share) => String(share?.participantId || '').trim().toLowerCase() === normalizedParticipantId)
      .filter((share) => share?.completeKeyShare)
      .filter((share) => !shareVersion || Number(share?.shareVersion || 0) === Number(shareVersion))
      .sort((a, b) => Number(b?.shareVersion || 0) - Number(a?.shareVersion || 0));
    return matches[0] || null;
  }

  _resolveSignRequestPayload(signRequest) {
    const payload = signRequest?.payload && typeof signRequest.payload === 'object'
      ? signRequest.payload
      : {};
    if (payload.messageHex || payload.dataHex || payload.transactionHash || payload.hash) {
      return payload;
    }
    const nested = payload.payload && typeof payload.payload === 'object' ? payload.payload : null;
    if (nested?.messageHex || nested?.dataHex || nested?.transactionHash || nested?.hash) {
      return nested;
    }
    return payload;
  }

  async processPendingWireSignRequests(options = {}) {
    await this.init();
    const syncRemote = options.syncRemote !== false;
    if (syncRemote) {
      await this.listSignRequests({
        sessionId: options.sessionId,
        walletId: options.walletId,
        status: options.status || 'pending',
        page: options.page || 1,
        pageSize: options.pageSize || 20,
        password: options.password
      }).catch(() => null);
    }

    const requestMap = await getMpcSignRequests();
    const requestId = String(options.requestId || options.signRequestId || '').trim();
    const wantedStatus = String(options.status || 'pending').trim().toLowerCase();
    const requests = Object.values(requestMap)
      .filter((request) => !requestId || String(request?.id || '').trim() === requestId)
      .filter((request) => !options.walletId || String(request?.walletId || '').trim() === String(options.walletId).trim())
      .filter((request) => !options.sessionId || String(request?.sessionId || '').trim() === String(options.sessionId).trim())
      .filter((request) => String(request?.status || '').trim().toLowerCase() === wantedStatus);

    const processed = [];
    for (const signRequest of requests) {
      const id = String(signRequest?.id || '').trim();
      try {
        const sessionId = String(signRequest?.sessionId || options.sessionId || '').trim();
        if (!sessionId) {
          throw new Error('MPC_SESSION_NOT_FOUND');
        }
        const session = await getMpcSession(sessionId);
        if (!session) {
          throw new Error('MPC_SESSION_NOT_FOUND');
        }
        const walletId = String(signRequest?.walletId || session.walletId || options.walletId || '').trim();
        const wallet = walletId ? await getMpcWallet(walletId) : null;
        if (!wallet) {
          throw new Error('MPC_WALLET_NOT_FOUND');
        }
        const participantId = String(options.participantId || await this._resolveLocalParticipantId(session)).trim();
        if (!participantId) {
          throw new Error('MPC_PARTICIPANT_NOT_FOUND');
        }
        const keyShare = await this._findLocalCompleteKeyShare({
          walletId,
          participantId,
          shareVersion: signRequest.shareVersion || wallet.shareVersion || session.shareVersion
        });
        if (!keyShare) {
          throw new Error('MPC_COMPLETE_KEY_SHARE_NOT_FOUND');
        }
        const participantIndex = Number.isInteger(Number(options.recipientIndex))
          ? Number(options.recipientIndex)
          : (Number.isInteger(Number(keyShare.participantIndex)) ? Number(keyShare.participantIndex) : await this._resolveLocalParticipantIndex(session, { participantId }));
        const participants = this._normalizeParticipantIds(session.participants || wallet.participants || []);
        const parties = participants.length ? participants.map((_participant, index) => index) : [];
        const payload = this._resolveSignRequestPayload(signRequest);
        await this.startWireSession({
          sessionId,
          protocol: 'sign',
          requestId: id,
          recipientIndex: participantIndex,
          parties,
          payload,
          keyShareRef: keyShare
        });
        const maxTicks = Math.max(1, Math.min(Number(options.maxTicks) || 5, 20));
        let tick = null;
        let tickCount = 0;
        for (let attempt = 0; attempt < maxTicks; attempt += 1) {
          tick = await this.tickWireSession({
            sessionId,
            protocol: 'sign',
            requestId: id,
            participantId,
            recipientIndex: participantIndex,
            password: options.password,
            limit: options.limit
          });
          tickCount += 1;
          if (tick?.result?.status === 'completed' || tick?.handledResult) {
            break;
          }
          const madeProgress = (tick?.messages?.length || 0) > 0 || (tick?.outputs?.length || 0) > 0;
          if (!madeProgress) {
            break;
          }
        }
        const updated = await getMpcSignRequest(id);
        processed.push({
          requestId: id,
          status: updated?.status || signRequest.status,
          sessionId,
          walletId,
          participantId,
          tickCount,
          result: tick.result,
          handledResult: tick.handledResult
        });
      } catch (error) {
        processed.push({
          requestId: id,
          status: 'skipped',
          error: error?.message || String(error)
        });
      }
    }
    return {
      processed,
      count: processed.length
    };
  }

  async processSessionMessages(options = {}) {
    await this.init();
    const sessionId = String(options.sessionId || '').trim();
    if (!sessionId) {
      throw new Error('sessionId is required');
    }
    const session = await getMpcSession(sessionId);
    if (!session) {
      throw new Error('MPC_SESSION_NOT_FOUND');
    }
    const walletId = String(options.walletId || session.walletId || '').trim();
    const wallet = walletId ? await getMpcWallet(walletId) : null;
    if (!wallet) {
      throw new Error('MPC_WALLET_NOT_FOUND');
    }
    const participantId = String(options.participantId || await this._resolveLocalParticipantId(session)).trim();
    if (!participantId) {
      throw new Error('MPC_PARTICIPANT_NOT_FOUND');
    }
    const participant = await getMpcParticipant(sessionId, participantId);
    if (!participant) {
      throw new Error('MPC_PARTICIPANT_NOT_JOINED');
    }

    const sourceMessages = Array.isArray(options.messages) ? options.messages : [];
    const processed = [];
    for (const rawMessage of sourceMessages) {
      const messageId = String(rawMessage?.id || '').trim();
      if (!messageId) continue;
      const message = await getMpcMessage(messageId) || rawMessage;
      if (message.processedAt || String(message.from || '').toLowerCase() === participantId.toLowerCase()) {
        continue;
      }
      const payload = await this._resolveMessagePayload(message, {
        sessionId,
        password: options.password
      });
      const isKeygen = this._isKeygenMessage(message, payload);
      const isSign = this._isSignMessage(message, payload);
      if (!isKeygen && !isSign) {
        continue;
      }
      try {
        if (isKeygen) {
          const output = await handleMpcKeygenMessage({
            session,
            wallet,
            participant,
            participantId,
            message,
            payload,
            participants: session.participants || [],
            threshold: session.threshold,
            curve: session.curve || wallet.curve || 'secp256k1'
          });
          await this._handleTssEngineOutput({
            session,
            wallet,
            participantId,
            output,
            password: options.password
          });
        } else {
          const signRequestId = this._resolveSignRequestId(message, payload);
          const signRequest = signRequestId ? await getMpcSignRequest(signRequestId) : null;
          if (!signRequest) {
            throw new Error('MPC_SIGN_REQUEST_NOT_FOUND');
          }
          const output = await handleMpcSignMessage({
            session,
            wallet,
            participant,
            participantId,
            message,
            payload,
            signRequest,
            participants: session.participants || [],
            threshold: session.threshold,
            curve: session.curve || wallet.curve || 'secp256k1'
          });
          await this._handleSignEngineOutput({
            session,
            participantId,
            signRequest,
            output,
            password: options.password
          });
        }
        const updated = {
          ...message,
          processedAt: getTimestamp(),
          processedBy: participantId
        };
        await saveMpcMessage(updated);
        processed.push(updated);
      } catch (error) {
        await this._appendAuditLog({
          sessionId,
          level: 'warn',
          action: 'message-process-skipped',
          message: error?.message || 'message process skipped',
          metadata: { messageId }
        });
      }
    }
    return processed;
  }

  async getSession(sessionId) {
    const { session } = await this._refreshSessionFromCoordinator(sessionId);
    return session;
  }

  async listInvites(options = {}) {
    await this.init();
    await this._ensureCoordinatorToken({
      endpoint: options.endpoint,
      password: options.password,
      audience: options.audience,
      resource: options.resource,
      action: options.action,
      ttlHours: options.ttlHours,
      forceRefresh: options.forceRefresh
    });
    let response;
    try {
      response = await this._coordinator.listMpcInvites({
        page: options.page || 1,
        pageSize: options.pageSize || 20
      });
    } catch (error) {
      response = await this._coordinator.listNotifications({
        unreadOnly: options.unreadOnly !== false,
        source: 'mpc',
        page: options.page || 1,
        pageSize: options.pageSize || 20
      });
    }
    const items = Array.isArray(response?.items) ? response.items : [];
    const invites = items.filter((item) => String(item?.type || '') === 'mpc.keygen.invited');
    const visible = [];
    for (const item of invites) {
      const sessionId = String(item?.payload?.sessionId || item?.subjectId || '').trim();
      const walletId = String(item?.payload?.walletId || '').trim();
      if (walletId && await getMpcWallet(walletId)) {
        continue;
      }
      let session = null;
      if (sessionId) {
        try {
          session = await this.getSession(sessionId);
          if (String(session?.status || '').toLowerCase() === 'cancelled') {
            continue;
          }
        } catch (error) {
          if (this.isSessionCancelledError(error)) {
            continue;
          }
        }
      }
      visible.push(this._enrichInviteWithSession(item, session));
    }
    return {
      ...response,
      items: visible
    };
  }

  _enrichInviteWithSession(item, session) {
    if (!session) return item;
    const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {};
    const enrichedPayload = {
      ...payload,
      sessionId: payload.sessionId || session.id,
      walletId: payload.walletId || session.walletId,
      name: this._resolveWalletName(payload, this._resolveWalletName(session, '')),
      threshold: payload.threshold ?? session.threshold,
      participants: Array.isArray(payload.participants) && payload.participants.length
        ? payload.participants
        : this._normalizeParticipantIds(session.participants),
      curve: payload.curve || session.curve,
      keyVersion: payload.keyVersion ?? session.keyVersion,
      shareVersion: payload.shareVersion ?? session.shareVersion
    };
    return {
      ...item,
      payload: enrichedPayload,
      session
    };
  }

  async markInviteRead(notificationUid) {
    await this.init();
    const uid = String(notificationUid || '').trim();
    if (!uid) {
      return null;
    }
    return await this._coordinator.markNotificationRead(uid);
  }

  async getSessions(walletId = '') {
    const sessions = await getMpcSessionList();
    const normalizedWalletId = String(walletId || '').trim();
    if (!normalizedWalletId) return sessions;
    const matched = sessions.filter(session => String(session?.walletId || '').trim() === normalizedWalletId);
    const refreshed = [];
    for (const session of matched) {
      try {
        const result = await this._refreshSessionFromCoordinator(session.id);
        refreshed.push(result.session || session);
      } catch {
        refreshed.push(session);
      }
    }
    return refreshed;
  }

  async startEventStream(sessionId, options = {}) {
    await this.init();
    const tokenResult = await this._ensureCoordinatorToken({ password: options.password });
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
      token: tokenResult.token,
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

  async _resolveRecipientKey({ sessionId, toParticipantId, recipientE2ePublicKey }) {
    if (recipientE2ePublicKey) {
      return String(recipientE2ePublicKey);
    }
    if (!toParticipantId) return '';
    const participant = await getMpcParticipant(sessionId || '', toParticipantId);
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
        const nextSession = {
          ...session,
          status: data?.status || session.status,
          round: Number.isFinite(data?.round) ? data.round : session.round,
          updatedAt: getTimestamp()
        };
        await saveMpcSession(nextSession);
        await this._syncWalletFromSession(nextSession, data);
      }
    }

    if ((eventType === 'sign-request' || eventType === 'sign-request-completed') && data?.id) {
      const existing = await getMpcSignRequest(data.id);
      await saveMpcSignRequest({
        ...(existing || {}),
        ...data,
        updatedAt: getTimestamp()
      });
      if (eventType === 'sign-request' && String(data.status || '').trim().toLowerCase() === 'pending') {
        await this.processPendingWireSignRequests({
          syncRemote: false,
          sessionId,
          requestId: data.id
        }).catch((error) => this._appendAuditLog({
          sessionId,
          level: 'warn',
          action: 'sign-request-process-skipped',
          message: error?.message || 'MPC sign request processing skipped',
          metadata: { requestId: data.id }
        }));
      }
    }

    if (eventType === 'participant-joined') {
      await this._refreshSessionFromCoordinator(sessionId).catch(() => {});
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
