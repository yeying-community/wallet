/**
 * YeYing Wallet - MPC 操作
 * 负责：创建 MPC 钱包、MPC 设置、会话编排、审计日志/导出
 */
import {
  getUserSetting,
  updateUserSettings,
  getWallet,
  getSelectedAccount,
  getMpcWallet,
  getMpcWalletList,
  saveMpcWallet,
  deleteMpcWallet,
  getMpcSessionList,
  deleteMpcSession,
  getMpcKeyShares,
  deleteMpcKeyShare,
  getMpcWireStates,
  deleteMpcWireState,
  getMpcSignRequests,
  deleteMpcSignRequest,
  getMpcMessages,
  deleteMpcMessage,
  getMpcParticipants,
  deleteMpcParticipant,
  getMpcAuditLogs,
  clearMpcAuditLogs
} from '../../storage/index.js';
import { mpcService } from '../mpc-service.js';
import {
  getCoordinatorSigningAccount,
  isMpcAccount
} from '../coordinator-signing-account.js';
import { getTimestamp } from '../../common/utils/time-utils.js';
import { generateId } from '../../common/utils/index.js';
import { deriveUcanAudience, normalizeBearerToken } from '../../common/ucan-utils.js';

const DEFAULT_MPC_AUTH_SCHEME = 'ucan';
const DEFAULT_MPC_E2E_SUITE = 'x25519-aes-gcm';
const DEFAULT_MPC_REFRESH_POLICY = 'manual';
const DEFAULT_MPC_COORDINATOR_ENDPOINT = 'https://node.yeying.pub';
const DEFAULT_MPC_UCAN_RESOURCE = 'mpc';
const DEFAULT_MPC_UCAN_ACTION = 'coordinate';
const MPC_IGNORED_INVITES_SETTING = 'mpcIgnoredInviteIds';
const MPC_AUTH_SCHEMES = new Set(['ucan']);
const MPC_E2E_SUITES = new Set(['x25519-aes-gcm']);
const MPC_REFRESH_POLICIES = new Set(['manual']);
const INVALID_MPC_WALLET_NAMES = new Set(['MPC 钱包创建邀请', 'MPC 钱包邀请']);
const MPC_KEYGEN_STARTABLE_SESSION_STATUSES = new Set(['ready', 'running', 'rounds', 'in_progress', 'in-progress']);

function isRemoteSessionCleanupBlockedError(error) {
  const message = String(error?.message || error || '').trim();
  const code = String(error?.code || error?.status || error?.statusCode || '').trim();
  return message === 'Session is not cancellable'
    || message === 'SESSION_NOT_CANCELLABLE'
    || message === 'Session not found'
    || message === 'SESSION_NOT_FOUND'
    || message === 'Forbidden'
    || code === '403'
    || code === '404'
    || code === 'NOT_FOUND'
    || code === 'FORBIDDEN';
}

function isMpcWalletCreated(wallet) {
  return String(wallet?.status || '').trim() === 'active' || Boolean(String(wallet?.address || '').trim());
}

function isKeygenStartableSession(session) {
  return MPC_KEYGEN_STARTABLE_SESSION_STATUSES.has(String(session?.status || '').trim().toLowerCase());
}

function normalizeIgnoredInviteIds(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return [];
}

function getInviteIgnoreIds(source = {}) {
  const payload = source?.payload && typeof source.payload === 'object' ? source.payload : source;
  return [
    source?.notificationUid,
    source?.uid,
    source?.subjectId,
    payload?.sessionId,
    payload?.walletId,
    source?.sessionId,
    source?.walletId
  ].map((item) => String(item || '').trim()).filter(Boolean);
}

export function resolveMpcWalletName(source = {}) {
  const payload = source?.payload && typeof source.payload === 'object' ? source.payload : source;
  const name = String(payload?.name || '').trim();
  if (!name || INVALID_MPC_WALLET_NAMES.has(name)) {
    throw new Error('MPC 钱包名称缺失');
  }
  return name;
}

/**
 * 创建 MPC 钱包（并创建 Keygen 会话）
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function handleCreateMpcWallet(options = {}) {
  try {
    const name = String(options.name || '').trim();
    if (!name || INVALID_MPC_WALLET_NAMES.has(name)) {
      throw new Error('请输入 MPC 钱包名称');
    }
    const walletId = generateId('mpc_wallet');
    const currentAccount = await getCoordinatorSigningAccount();
    const selfAddress = String(currentAccount?.address || '').trim();
    const selectedAccount = await getSelectedAccount();
    const selectedMpcAddress = isMpcAccount(selectedAccount)
      ? String(selectedAccount?.address || '').trim().toLowerCase()
      : '';
    const participantCandidates = Array.isArray(options.participants)
      ? options.participants
        .map(item => String(item).trim())
        .filter(Boolean)
        .filter((item, index) => index !== 0 || !selectedMpcAddress || item.toLowerCase() !== selectedMpcAddress)
      : [];
    const participants = [];
    const seenParticipants = new Set();
    for (const item of [selfAddress, ...participantCandidates]) {
      const raw = String(item || '').trim();
      const key = raw.toLowerCase();
      if (!raw || seenParticipants.has(key)) continue;
      seenParticipants.add(key);
      participants.push(raw);
    }
    const threshold = Number(options.threshold);
    const curve = String(options.curve || 'secp256k1').trim() || 'secp256k1';
    const coordinatorEndpoint = String(options.coordinatorEndpoint || '').trim();
    const ucanToken = normalizeBearerToken(options.ucanToken || '');

    if (!participants.length) {
      throw new Error('参与者不能为空');
    }
    if (!Number.isFinite(threshold) || threshold < 2) {
      throw new Error('门限必须至少为 2');
    }
    if (threshold > participants.length) {
      throw new Error('门限不能大于参与者数量');
    }

    const existing = await getMpcWallet(walletId);
    if (existing) {
      throw new Error('Wallet ID 已存在');
    }
    const existingWallet = await getWallet(walletId);
    if (existingWallet) {
      throw new Error('Wallet ID 已存在');
    }

    const settingsUpdates = {};
    if (coordinatorEndpoint) {
      try {
        new URL(coordinatorEndpoint);
      } catch {
        throw new Error('协调器地址格式不正确');
      }
      settingsUpdates.mpcCoordinatorEndpoint = coordinatorEndpoint;
      settingsUpdates.mpcCoordinatorUcanAudience = deriveUcanAudience(coordinatorEndpoint);
      settingsUpdates.mpcCoordinatorUcanResource = DEFAULT_MPC_UCAN_RESOURCE;
      settingsUpdates.mpcCoordinatorUcanAction = DEFAULT_MPC_UCAN_ACTION;
      settingsUpdates.mpcCoordinatorUcanToken = '';
      await mpcService.setCoordinatorEndpoint(coordinatorEndpoint);
    }
    if (ucanToken) {
      settingsUpdates.mpcCoordinatorUcanToken = ucanToken;
    }
    if (Object.keys(settingsUpdates).length > 0) {
      await updateUserSettings(settingsUpdates);
    }

    const sessionResult = await mpcService.createSession({
      type: 'keygen',
      name,
      walletId,
      threshold,
      participants,
      curve,
      password: options.password,
      endpoint: coordinatorEndpoint || undefined,
      resource: DEFAULT_MPC_UCAN_RESOURCE,
      action: DEFAULT_MPC_UCAN_ACTION,
      forceRefresh: true
    });
    const now = getTimestamp();
    const wallet = {
      id: walletId,
      name,
      type: 'mpc',
      status: 'keygen_pending',
      keygenSessionId: sessionResult.session?.id || sessionResult.session?.sessionId || '',
      curve,
      threshold,
      participants,
      chainIds: Array.isArray(options.chainIds) ? options.chainIds : [],
      keyVersion: 1,
      shareVersion: 1,
      createdAt: now,
      updatedAt: now
    };

    await saveMpcWallet(wallet);
    await mpcService.syncWalletFromSession(sessionResult.session || wallet.keygenSessionId).catch(() => null);
    if (isKeygenStartableSession(sessionResult.session)) {
      await mpcService.startKeygenSession({
        sessionId: wallet.keygenSessionId,
        password: options.password
      }).catch(() => null);
    }

    return {
      success: true,
      wallet,
      session: sessionResult.session
    };
  } catch (error) {
    console.error('❌ Handle create MPC wallet failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

export async function handleGetMpcSettings() {
  try {
    const settings = {
      authScheme: await getUserSetting('mpcCoordinatorAuth', DEFAULT_MPC_AUTH_SCHEME),
      e2eSuite: await getUserSetting('mpcE2eSuite', DEFAULT_MPC_E2E_SUITE),
      refreshPolicy: await getUserSetting('mpcRefreshPolicy', DEFAULT_MPC_REFRESH_POLICY),
      coordinatorEndpoint: await getUserSetting('mpcCoordinatorEndpoint', DEFAULT_MPC_COORDINATOR_ENDPOINT),
      ucanResource: await getUserSetting('mpcCoordinatorUcanResource', DEFAULT_MPC_UCAN_RESOURCE),
      ucanAction: await getUserSetting('mpcCoordinatorUcanAction', DEFAULT_MPC_UCAN_ACTION),
      ucanAudience: await getUserSetting('mpcCoordinatorUcanAudience', ''),
      ucanToken: await getUserSetting('mpcCoordinatorUcanToken', '')
    };
    return { success: true, settings };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get mpc settings' };
  }
}

export async function handleUpdateMpcSettings(updates = {}) {
  try {
    const sanitized = {};
    const previousEndpoint = String(await getUserSetting('mpcCoordinatorEndpoint', DEFAULT_MPC_COORDINATOR_ENDPOINT) || '').trim();
    const previousAudience = String(await getUserSetting('mpcCoordinatorUcanAudience', '') || '').trim();
    const nextEndpoint = 'coordinatorEndpoint' in updates
      ? String(updates.coordinatorEndpoint || '').trim()
      : previousEndpoint;
    const endpointChanged = nextEndpoint !== previousEndpoint;

    if ('authScheme' in updates) {
      const value = String(updates.authScheme || '').toLowerCase();
      if (MPC_AUTH_SCHEMES.has(value)) {
        sanitized.mpcCoordinatorAuth = value;
      }
    }

    if ('e2eSuite' in updates) {
      const value = String(updates.e2eSuite || '').toLowerCase();
      if (MPC_E2E_SUITES.has(value)) {
        sanitized.mpcE2eSuite = value;
      }
    }

    if ('refreshPolicy' in updates) {
      const value = String(updates.refreshPolicy || '').toLowerCase();
      if (MPC_REFRESH_POLICIES.has(value)) {
        sanitized.mpcRefreshPolicy = value;
      }
    }

    if ('coordinatorEndpoint' in updates) {
      sanitized.mpcCoordinatorEndpoint = nextEndpoint;
      if (endpointChanged) {
        const submittedAudience = String(updates.ucanAudience || '').trim();
        if (!submittedAudience || submittedAudience === previousAudience) {
          sanitized.mpcCoordinatorUcanAudience = deriveUcanAudience(sanitized.mpcCoordinatorEndpoint);
        }
        sanitized.mpcCoordinatorUcanToken = '';
      }
    }

    if ('ucanResource' in updates) {
      sanitized.mpcCoordinatorUcanResource = String(updates.ucanResource || '').trim();
    }

    if ('ucanAction' in updates) {
      sanitized.mpcCoordinatorUcanAction = String(updates.ucanAction || '').trim();
    }

    if ('ucanAudience' in updates) {
      const submittedAudience = String(updates.ucanAudience || '').trim();
      if (!endpointChanged || (submittedAudience && submittedAudience !== previousAudience)) {
        sanitized.mpcCoordinatorUcanAudience = submittedAudience;
      }
    }

    if ('ucanToken' in updates) {
      if (!endpointChanged) {
        sanitized.mpcCoordinatorUcanToken = normalizeBearerToken(updates.ucanToken || '');
      }
    }

    if (Object.keys(sanitized).length > 0) {
      await updateUserSettings(sanitized);
    }

    if ('mpcCoordinatorEndpoint' in sanitized) {
      await mpcService.setCoordinatorEndpoint(sanitized.mpcCoordinatorEndpoint);
    }

    return await handleGetMpcSettings();
  } catch (error) {
    return { success: false, error: error.message || 'Failed to update mpc settings' };
  }
}

export async function handleGenerateMpcCoordinatorUcan(options = {}) {
  try {
    const endpoint = String(options.coordinatorEndpoint || '').trim();
    const resource = String(options.ucanResource || '').trim() || DEFAULT_MPC_UCAN_RESOURCE;
    const action = String(options.ucanAction || '').trim() || DEFAULT_MPC_UCAN_ACTION;
    const audience = String(options.ucanAudience || '').trim();
    const ttlHours = Number(options.ttlHours || 24);
    const password = String(options.password || '');

    if (!endpoint) {
      return { success: false, error: '协调器地址未配置' };
    }

    const generated = await mpcService.generateCoordinatorUcan({
      endpoint,
      password,
      audience,
      resource,
      action,
      ttlHours,
      forceRefresh: true
    });

    await updateUserSettings({
      mpcCoordinatorEndpoint: endpoint
    });
    await mpcService.setCoordinatorEndpoint(endpoint);

    const settingsResult = await handleGetMpcSettings();
    return {
      success: true,
      token: generated.token,
      audience: generated.audience,
      resource: generated.resource,
      action: generated.action,
      expiresAt: generated.expiresAt,
      settings: settingsResult.settings
    };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to generate MPC coordinator UCAN' };
  }
}

export async function handleMpcGetDeviceInfo() {
  try {
    const info = await mpcService.getDeviceInfo();
    return { success: true, device: info };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get device info' };
  }
}

export async function handleMpcCreateSession(options = {}) {
  try {
    const result = await mpcService.createSession(options);
    return { success: true, session: result.session, response: result.response };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to create session' };
  }
}

export async function handleMpcCancelSession(options = {}) {
  try {
    const walletId = String(options?.walletId || '').trim();
    const sessionId = String(options?.sessionId || '').trim();
    if (!walletId) {
      throw new Error('walletId is required');
    }
    if (!sessionId) {
      throw new Error('sessionId is required');
    }
    const wallet = await getMpcWallet(walletId);
    if (!wallet) {
      throw new Error('MPC 钱包不存在');
    }
    if (isMpcWalletCreated(wallet)) {
      throw new Error('已创建成功的 MPC 钱包不能通过该入口移除');
    }
    let result = null;
    let remoteCancelled = true;
    try {
      result = await mpcService.cancelSession({
        sessionId,
        password: options.password
      });
    } catch (error) {
      if (!isRemoteSessionCleanupBlockedError(error)) {
        throw error;
      }
      remoteCancelled = false;
    }
    await deleteMpcSession(sessionId);
    await deleteMpcWallet(walletId);
    return {
      success: true,
      session: result?.session || null,
      response: result?.response || null,
      walletId,
      sessionId,
      remoteCancelled,
      warning: remoteCancelled ? '' : '远端会话当前不可取消，已移除本地未完成 MPC 钱包记录'
    };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to cancel MPC session' };
  }
}

export async function handleMpcDeleteWallet(options = {}) {
  try {
    const walletId = String(options?.walletId || options?.id || '').trim();
    if (!walletId) {
      throw new Error('walletId is required');
    }
    const wallet = await getMpcWallet(walletId);
    if (!wallet) {
      throw new Error('MPC 钱包不存在');
    }

    const sessionIds = new Set(
      [wallet?.keygenSessionId, wallet?.sessionId]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );
    const sessions = await getMpcSessionList();
    for (const session of sessions) {
      const sessionId = String(session?.id || session?.sessionId || '').trim();
      if (!sessionId) continue;
      if (String(session?.walletId || '').trim() === walletId || sessionIds.has(sessionId)) {
        sessionIds.add(sessionId);
      }
    }

    const deleted = {
      wallet: false,
      sessions: 0,
      keyShares: 0,
      wireStates: 0,
      signRequests: 0,
      messages: 0,
      participants: 0
    };

    for (const session of sessions) {
      const sessionId = String(session?.id || session?.sessionId || '').trim();
      if (!sessionId || !sessionIds.has(sessionId)) continue;
      await deleteMpcSession(sessionId);
      deleted.sessions += 1;
    }

    const keyShares = await getMpcKeyShares();
    for (const [key, share] of Object.entries(keyShares || {})) {
      const shareId = String(share?.id || key || '').trim();
      const shareSessionId = String(share?.sessionId || '').trim();
      if (!shareId) continue;
      if (String(share?.walletId || '').trim() === walletId || sessionIds.has(shareSessionId)) {
        await deleteMpcKeyShare(shareId);
        deleted.keyShares += 1;
      }
    }

    const wireStates = await getMpcWireStates();
    for (const [key, state] of Object.entries(wireStates || {})) {
      if (!sessionIds.has(String(state?.sessionId || '').trim())) continue;
      await deleteMpcWireState(key);
      deleted.wireStates += 1;
    }

    const signRequests = await getMpcSignRequests();
    for (const [key, request] of Object.entries(signRequests || {})) {
      const requestId = String(request?.id || key || '').trim();
      const requestSessionId = String(request?.sessionId || '').trim();
      if (!requestId) continue;
      if (String(request?.walletId || '').trim() === walletId || sessionIds.has(requestSessionId)) {
        await deleteMpcSignRequest(requestId);
        deleted.signRequests += 1;
      }
    }

    const messages = await getMpcMessages();
    for (const [key, message] of Object.entries(messages || {})) {
      const messageId = String(message?.id || key || '').trim();
      if (!messageId || !sessionIds.has(String(message?.sessionId || '').trim())) continue;
      await deleteMpcMessage(messageId);
      deleted.messages += 1;
    }

    const participants = await getMpcParticipants();
    for (const [key, participant] of Object.entries(participants || {})) {
      const sessionId = String(participant?.sessionId || key.split(':')[0] || '').trim();
      const participantId = String(participant?.id || key.split(':').slice(1).join(':') || '').trim();
      if (!sessionId || !participantId || !sessionIds.has(sessionId)) continue;
      await deleteMpcParticipant(sessionId, participantId);
      deleted.participants += 1;
    }

    await deleteMpcWallet(walletId);
    deleted.wallet = true;

    return {
      success: true,
      walletId,
      sessionIds: Array.from(sessionIds),
      deleted
    };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to delete MPC wallet' };
  }
}

export async function handleMpcDismissInvite(options = {}) {
  try {
    const ids = getInviteIgnoreIds(options);
    if (!ids.length) {
      throw new Error('invite id is required');
    }
    const current = normalizeIgnoredInviteIds(await getUserSetting(MPC_IGNORED_INVITES_SETTING, []));
    const next = Array.from(new Set([...current, ...ids]));
    await updateUserSettings({ [MPC_IGNORED_INVITES_SETTING]: next });

    const notificationUid = String(options?.notificationUid || options?.uid || '').trim();
    if (notificationUid) {
      await mpcService.markInviteRead(notificationUid).catch(() => null);
    }

    return {
      success: true,
      ignoredIds: next,
      dismissedIds: ids
    };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to dismiss MPC invite' };
  }
}

export async function handleMpcListInvites(options = {}) {
  try {
    const result = await mpcService.listInvites(options);
    return { success: true, items: result.items || [], page: result.page || null };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to list MPC invites' };
  }
}

export async function handleMpcAcceptInvite(options = {}) {
  try {
    const payload = options?.payload || {};
    const sessionId = String(options?.sessionId || payload.sessionId || payload.id || '').trim();
    const walletId = String(options?.walletId || payload.walletId || '').trim();
    const notificationUid = String(options?.notificationUid || '').trim();
    if (!sessionId) {
      throw new Error('sessionId is required');
    }
    if (!walletId) {
      throw new Error('walletId is required');
    }

    const currentAccount = await getCoordinatorSigningAccount();
    const address = String(currentAccount?.address || '').trim();
    if (!address) {
      throw new Error('当前账户地址不可用');
    }

    const participants = Array.isArray(payload.participants)
      ? payload.participants.map(item => String(item).trim()).filter(Boolean)
      : [];
    const participantId = participants.find(item => item.toLowerCase() === address.toLowerCase()) || address;
    const identity = String(options?.identity || `did:pkh:eth:${address.toLowerCase()}`).trim();

    let joinResult;
    try {
      joinResult = await mpcService.joinSession({
        sessionId,
        participantId,
        identity,
        password: options.password
      });
    } catch (error) {
      if (mpcService.isSessionCancelledError?.(error)) {
        if (notificationUid) {
          await mpcService.markInviteRead(notificationUid).catch(() => null);
        }
        throw new Error('该 MPC 钱包创建已被发起人取消');
      }
      throw error;
    }
    await mpcService.startEventStream(sessionId).catch(() => null);

    const walletName = resolveMpcWalletName(payload);
    const existingWallet = await getMpcWallet(walletId);
    if (!existingWallet) {
      const now = getTimestamp();
      await saveMpcWallet({
        id: walletId,
        name: walletName,
        type: 'mpc',
        status: 'keygen_pending',
        keygenSessionId: sessionId,
        curve: String(payload.curve || 'secp256k1').trim() || 'secp256k1',
        threshold: Number(payload.threshold || 0),
        participants,
        chainIds: [],
        keyVersion: Number(payload.keyVersion || 1),
        shareVersion: Number(payload.shareVersion || 1),
        createdAt: now,
        updatedAt: now
      });
    } else if (String(existingWallet.name || '').trim() !== walletName) {
      await saveMpcWallet({
        ...existingWallet,
        name: walletName,
        updatedAt: getTimestamp()
      });
    }
    await mpcService.syncWalletFromSession(joinResult.session || sessionId).catch(() => null);
    if (isKeygenStartableSession(joinResult.session)) {
      await mpcService.startKeygenSession({
        sessionId,
        password: options.password
      }).catch(() => null);
    }

    if (notificationUid) {
      await mpcService.markInviteRead(notificationUid).catch(() => null);
    }

    return {
      success: true,
      session: joinResult.session,
      response: joinResult.response,
      participantId,
      walletId
    };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to accept MPC invite' };
  }
}

export async function handleMpcJoinSession(options = {}) {
  try {
    const result = await mpcService.joinSession(options);
    return { success: true, participant: result.participant, response: result.response };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to join session' };
  }
}

export async function handleMpcStartKeygen(options = {}) {
  try {
    const result = await mpcService.startKeygenSession(options);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to start keygen' };
  }
}

export async function handleMpcSendSessionMessage(options = {}) {
  try {
    const result = await mpcService.sendSessionMessage(options);
    return { success: true, message: result.message };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to send session message' };
  }
}

export async function handleMpcDecryptMessage(options = {}) {
  try {
    const result = await mpcService.decryptMessage(options);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to decrypt session message' };
  }
}

export async function handleMpcFetchSessionMessages(options = {}) {
  try {
    const sessionId = options?.sessionId;
    const result = await mpcService.fetchSessionMessages(sessionId, options);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to fetch session messages' };
  }
}

export async function handleMpcListSignRequests(options = {}) {
  try {
    const result = await mpcService.listSignRequests(options);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to list sign requests' };
  }
}

export async function handleMpcProcessPendingSignRequests(options = {}) {
  try {
    const result = await mpcService.processPendingWireSignRequests(options);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to process pending sign requests' };
  }
}

export async function handleMpcGetSession(sessionId) {
  try {
    const session = await mpcService.getSession(sessionId);
    return { success: true, session };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get session' };
  }
}

export async function handleMpcGetSessions(options = {}) {
  try {
    const sessions = await mpcService.getSessions(options?.walletId, { localOnly: Boolean(options?.localOnly) });
    const walletId = String(options?.walletId || '').trim();
    const wallet = walletId
      ? (await mpcService.reconcileWalletSigningReadiness(walletId))?.wallet
      : null;
    return { success: true, sessions, wallet };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get sessions' };
  }
}

async function resolveMpcWalletIdForOperation(options = {}) {
  let walletId = String(options?.walletId || options?.id || '').trim();
  const address = String(options?.address || '').trim().toLowerCase();
  if (!walletId && address) {
    const wallets = await getMpcWalletList();
    const matchedWallet = wallets.find((wallet) => String(wallet?.address || '').trim().toLowerCase() === address);
    walletId = String(matchedWallet?.id || '').trim();
  }
  if (!walletId) {
    throw new Error(address ? '未找到该地址对应的 MPC 钱包' : 'MPC 钱包 ID 不能为空');
  }
  return walletId;
}

function buildMpcSigningDiagnosis(walletId, readiness) {
  const wallet = readiness?.wallet || null;
  const keyShare = readiness?.keyShare || null;
  const sessionId = String(wallet?.keygenSessionId || keyShare?.sessionId || '').trim();
  const participantIndex = Number(keyShare?.participantIndex);
  return {
    walletId,
    name: String(wallet?.name || ''),
    address: String(wallet?.address || ''),
    status: String(wallet?.status || ''),
    signingStatus: String(wallet?.signingStatus || ''),
    signingUnavailableReason: String(readiness?.error || wallet?.signingUnavailableReason || readiness?.reason || ''),
    canSign: Boolean(readiness?.canSign),
    reason: String(readiness?.error || readiness?.reason || ''),
    hasAddress: Boolean(String(wallet?.address || '').trim()),
    keyVersion: wallet?.keyVersion ?? keyShare?.keyVersion ?? null,
    shareVersion: wallet?.shareVersion ?? keyShare?.shareVersion ?? null,
    participantId: String(keyShare?.participantId || ''),
    hasKeyShare: Boolean(keyShare?.share),
    hasAuxInfo: Boolean(keyShare?.auxInfo),
    auxInfoStatus: String(keyShare?.auxInfoStatus || wallet?.auxInfoStatus || ''),
    hasCompleteKeyShare: Boolean(keyShare?.completeKeyShare),
    completeKeyShareStatus: String(keyShare?.completeKeyShareStatus || wallet?.completeKeyShareStatus || ''),
    localSigningStatus: String(keyShare?.signingStatus || ''),
    localSigningUnavailableReason: String(keyShare?.signingUnavailableReason || ''),
    wireRuntime: mpcService.getWireRuntimeState({
      sessionId,
      protocol: 'aux-info',
      participantIndex
    })
  };
}

export async function handleMpcDiagnoseWallet(options = {}) {
  try {
    const walletId = await resolveMpcWalletIdForOperation(options);
    const readiness = await mpcService.evaluateWalletSigningReadiness(walletId);
    return {
      success: true,
      diagnosis: buildMpcSigningDiagnosis(walletId, readiness)
    };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to diagnose MPC wallet' };
  }
}

export async function handleMpcPrepareWalletSigning(options = {}) {
  try {
    const walletId = await resolveMpcWalletIdForOperation(options);
    const readiness = await mpcService.prepareWalletSigningReadiness(walletId, { password: options?.password });
    if (readiness?.failed) {
      return {
        success: false,
        error: readiness.error || readiness.reason || 'MPC_AUX_INFO_START_FAILED',
        action: String(readiness?.action || 'failed'),
        diagnosis: buildMpcSigningDiagnosis(walletId, readiness)
      };
    }
    return {
      success: true,
      action: String(readiness?.action || ''),
      started: Boolean(readiness?.started),
      resumed: Boolean(readiness?.resumed),
      repaired: Boolean(readiness?.repaired),
      pending: Boolean(readiness?.pending),
      diagnosis: buildMpcSigningDiagnosis(walletId, readiness)
    };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to prepare MPC wallet signing' };
  }
}

export async function handleMpcStartStream(options = {}) {
  try {
    const sessionId = options?.sessionId;
    const cursor = options?.cursor;
    const result = await mpcService.startEventStream(sessionId, { cursor });
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to start stream' };
  }
}

export async function handleMpcStopStream(options = {}) {
  try {
    const sessionId = options?.sessionId;
    const result = await mpcService.stopEventStream(sessionId);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to stop stream' };
  }
}

export async function handleMpcGetAuditLogs() {
  try {
    const logs = await getMpcAuditLogs();
    return { success: true, logs };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get audit logs' };
  }
}

export async function handleMpcClearAuditLogs() {
  try {
    await clearMpcAuditLogs();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to clear audit logs' };
  }
}

export async function handleMpcGetAuditExportConfig() {
  try {
    const config = await mpcService.getAuditExportConfig();
    return { success: true, config };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get audit export config' };
  }
}

export async function handleMpcUpdateAuditExportConfig(updates = {}) {
  try {
    const config = await mpcService.updateAuditExportConfig(updates);
    return { success: true, config };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to update audit export config' };
  }
}

export async function handleMpcExportAuditLogs(options = {}) {
  try {
    const includeAll = Boolean(options?.includeAll);
    let logs = [];
    if (includeAll) {
      logs = await getMpcAuditLogs();
    }
    const result = includeAll
      ? await mpcService.exportAuditLogsNow(logs)
      : await mpcService.flushAuditExportQueue();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to export audit logs' };
  }
}

export async function handleMpcFlushAuditExportQueue() {
  try {
    const result = await mpcService.flushAuditExportQueue();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to flush audit export queue' };
  }
}
