/**
 * YeYing Wallet - MPC 操作
 * 负责：创建 MPC 钱包、MPC 设置、会话编排、审计日志/导出
 */
import {
  getUserSetting,
  updateUserSettings,
  getWallet,
  getSelectedAccount,
  getAccountList,
  getMpcWallet,
  saveMpcWallet,
  getMpcAuditLogs,
  clearMpcAuditLogs
} from '../../storage/index.js';
import { mpcService } from '../mpc-service.js';
import { getTimestamp } from '../../common/utils/time-utils.js';
import { generateId } from '../../common/utils/index.js';

const DEFAULT_MPC_AUTH_SCHEME = 'ucan';
const DEFAULT_MPC_E2E_SUITE = 'x25519-aes-gcm';
const DEFAULT_MPC_REFRESH_POLICY = 'manual';
const DEFAULT_MPC_COORDINATOR_ENDPOINT = 'https://node.yeying.pub';
const DEFAULT_MPC_UCAN_RESOURCE = 'mpc';
const DEFAULT_MPC_UCAN_ACTION = 'coordinate';
const MPC_AUTH_SCHEMES = new Set(['ucan']);
const MPC_E2E_SUITES = new Set(['x25519-aes-gcm']);
const MPC_REFRESH_POLICIES = new Set(['manual']);

/**
 * 创建 MPC 钱包（并创建 Keygen 会话）
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function handleCreateMpcWallet(options = {}) {
  try {
    const name = String(options.name || 'MPC Wallet').trim() || 'MPC Wallet';
    const walletId = String(options.walletId || '').trim() || generateId('mpc_wallet');
    const currentAccount = await getSelectedAccount() || (await getAccountList())[0] || null;
    const selfAddress = String(currentAccount?.address || '').trim();
    const participantCandidates = Array.isArray(options.participants)
      ? options.participants.map(item => String(item).trim()).filter(Boolean)
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

    if (!participants.length) {
      throw new Error('参与者不能为空');
    }
    if (!Number.isFinite(threshold) || threshold <= 0) {
      throw new Error('门限必须大于 0');
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

    const sessionResult = await mpcService.createSession({
      type: 'keygen',
      walletId,
      threshold,
      participants,
      curve,
      password: options.password
    });
    const now = getTimestamp();
    const wallet = {
      id: walletId,
      name,
      type: 'mpc',
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
      sanitized.mpcCoordinatorEndpoint = String(updates.coordinatorEndpoint || '').trim();
    }

    if ('ucanResource' in updates) {
      sanitized.mpcCoordinatorUcanResource = String(updates.ucanResource || '').trim();
    }

    if ('ucanAction' in updates) {
      sanitized.mpcCoordinatorUcanAction = String(updates.ucanAction || '').trim();
    }

    if ('ucanAudience' in updates) {
      sanitized.mpcCoordinatorUcanAudience = String(updates.ucanAudience || '').trim();
    }

    if ('ucanToken' in updates) {
      sanitized.mpcCoordinatorUcanToken = String(updates.ucanToken || '').trim();
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

export async function handleMpcJoinSession(options = {}) {
  try {
    const result = await mpcService.joinSession(options);
    return { success: true, participant: result.participant, response: result.response };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to join session' };
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

export async function handleMpcGetSession(sessionId) {
  try {
    const session = await mpcService.getSession(sessionId);
    return { success: true, session };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get session' };
  }
}

export async function handleMpcGetSessions() {
  try {
    const sessions = await mpcService.getSessions();
    return { success: true, sessions };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get sessions' };
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
