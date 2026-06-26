/**
 * YeYing Wallet - 备份同步操作
 * 负责：WebDAV 备份同步设置、手动同步/清理、冲突解决、活动日志
 */
import {
  getUserSetting,
  updateUserSetting,
  updateUserSettings,
  getAccount,
  updateAccount,
  getContact,
  saveContact
} from '../../storage/index.js';
import { backupSyncService } from '../sync-service.js';
import { isDeveloperFeatureEnabled } from '../../config/index.js';
import { getTimestamp } from '../../common/utils/time-utils.js';

const DEFAULT_BACKUP_SYNC_ENDPOINT = 'https://webdav.yeying.pub/dav';
const BACKUP_SYNC_MODES = new Set(['siwe', 'ucan', 'basic']);

function normalizeBackupSyncEndpoint(value) {
  const trimmed = String(value || '').trim();
  return trimmed || DEFAULT_BACKUP_SYNC_ENDPOINT;
}

function buildConflictLabel(conflict) {
  if (!conflict || typeof conflict !== 'object') return '冲突';
  if (conflict.type === 'contact') {
    const address = conflict.address ? String(conflict.address) : '';
    const name = conflict.localName || conflict.remoteName || '';
    if (name) return `联系人 ${name}`;
    if (address) return `联系人 ${address}`;
    return '联系人';
  }
  const index = Number.isFinite(conflict.index) ? conflict.index : null;
  return index !== null ? `账户 #${index}` : '账户';
}

export async function handleGetBackupSyncSettings() {
  try {
    const settings = {
      enabled: await getUserSetting('backupSyncEnabled', true),
      endpoint: await getUserSetting('backupSyncEndpoint', DEFAULT_BACKUP_SYNC_ENDPOINT),
      authMode: await getUserSetting('backupSyncAuthMode', 'ucan'),
      authToken: await getUserSetting('backupSyncAuthToken', ''),
      authTokenExpiresAt: await getUserSetting('backupSyncAuthTokenExpiresAt', null),
      ucanToken: await getUserSetting('backupSyncUcanToken', ''),
      ucanResource: await getUserSetting('backupSyncUcanResource', ''),
      ucanAction: await getUserSetting('backupSyncUcanAction', ''),
      ucanAudience: await getUserSetting('backupSyncUcanAudience', ''),
      basicAuth: await getUserSetting('backupSyncBasicAuth', ''),
      lastPullAt: await getUserSetting('backupSyncLastPullAt', null),
      lastPushAt: await getUserSetting('backupSyncLastPushAt', null),
      pendingDelete: await getUserSetting('backupSyncPendingDelete', false),
      networkIds: await getUserSetting('backupSyncNetworkIds', []),
      conflicts: await getUserSetting('backupSyncConflicts', []),
      logs: await getUserSetting('backupSyncLogs', []),
      logMaxCount: await getUserSetting('backupSyncLogMaxCount', null),
      logRetentionDays: await getUserSetting('backupSyncLogRetentionDays', null)
    };

    return { success: true, settings };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get backup sync settings' };
  }
}

export async function handleUpdateBackupSyncSettings(updates = {}) {
  try {
    const prevEndpoint = await getUserSetting('backupSyncEndpoint', DEFAULT_BACKUP_SYNC_ENDPOINT);
    const prevAuthMode = await getUserSetting('backupSyncAuthMode', 'ucan');
    const prevAuthToken = await getUserSetting('backupSyncAuthToken', '');
    const prevUcanToken = await getUserSetting('backupSyncUcanToken', '');

    const sanitized = {};

    if ('enabled' in updates) {
      sanitized.backupSyncEnabled = Boolean(updates.enabled);
    }

    if ('endpoint' in updates) {
      sanitized.backupSyncEndpoint = normalizeBackupSyncEndpoint(updates.endpoint);
    }

    if ('authMode' in updates) {
      const mode = String(updates.authMode || '').toLowerCase();
      if (BACKUP_SYNC_MODES.has(mode)) {
        sanitized.backupSyncAuthMode = mode;
      }
    }

    if ('authToken' in updates) {
      sanitized.backupSyncAuthToken = String(updates.authToken || '');
    }

    if ('authTokenExpiresAt' in updates) {
      sanitized.backupSyncAuthTokenExpiresAt = updates.authTokenExpiresAt ?? null;
    }

    if ('ucanToken' in updates) {
      sanitized.backupSyncUcanToken = String(updates.ucanToken || '');
    }

    if ('ucanResource' in updates) {
      sanitized.backupSyncUcanResource = String(updates.ucanResource || '');
    }

    if ('ucanAction' in updates) {
      sanitized.backupSyncUcanAction = String(updates.ucanAction || '');
    }

    if ('ucanAudience' in updates) {
      sanitized.backupSyncUcanAudience = String(updates.ucanAudience || '');
    }

    if ('basicAuth' in updates) {
      sanitized.backupSyncBasicAuth = String(updates.basicAuth || '');
    }

    if ('logMaxCount' in updates) {
      const raw = Number(updates.logMaxCount);
      if (Number.isFinite(raw)) {
        const rounded = Math.floor(raw);
        sanitized.backupSyncLogMaxCount = Math.min(100000, Math.max(50, rounded));
      }
    }

    if ('logRetentionDays' in updates) {
      const raw = Number(updates.logRetentionDays);
      if (Number.isFinite(raw)) {
        const rounded = Math.floor(raw);
        sanitized.backupSyncLogRetentionDays = Math.min(365, Math.max(1, rounded));
      }
    }

    if ('conflicts' in updates) {
      if (isDeveloperFeatureEnabled('ENABLE_DEBUG_MODE')) {
        sanitized.backupSyncConflicts = Array.isArray(updates.conflicts) ? updates.conflicts : [];
      }
    }

    if (Object.keys(sanitized).length > 0) {
      await updateUserSettings(sanitized);
    }

    if (sanitized.backupSyncEnabled === false) {
      await backupSyncService.disableSync();
    }

    if (
      sanitized.backupSyncEnabled === true ||
      'backupSyncAuthToken' in sanitized ||
      'backupSyncUcanToken' in sanitized ||
      'backupSyncBasicAuth' in sanitized
    ) {
      await backupSyncService.tryStartAutoSync();
    }

    if ('backupSyncEndpoint' in sanitized && sanitized.backupSyncEndpoint !== prevEndpoint) {
      await backupSyncService.logEvent({
        level: 'info',
        action: 'endpoint-update',
        message: `WebDAV 地址已更新为 ${sanitized.backupSyncEndpoint}`
      }).catch(() => {});
    }

    const nextAuthMode = sanitized.backupSyncAuthMode || prevAuthMode;
    if ('backupSyncAuthToken' in sanitized && nextAuthMode === 'siwe') {
      const hasPrev = Boolean(prevAuthToken);
      const hasNext = Boolean(sanitized.backupSyncAuthToken);
      if (hasNext) {
        await backupSyncService.logEvent({
          level: 'info',
          action: hasPrev ? 'siwe-refresh' : 'siwe-login',
          message: hasPrev ? 'SIWE Token 已刷新' : 'SIWE 登录成功'
        }).catch(() => {});
      }
    }

    if ('backupSyncUcanToken' in sanitized && nextAuthMode === 'ucan') {
      const hasPrev = Boolean(prevUcanToken);
      const hasNext = Boolean(sanitized.backupSyncUcanToken);
      if (hasNext) {
        await backupSyncService.logEvent({
          level: 'info',
          action: hasPrev ? 'ucan-refresh' : 'ucan-login',
          message: hasPrev ? 'UCAN 已刷新' : 'UCAN 已生成'
        }).catch(() => {});
      }
    }

    if ('backupSyncLogMaxCount' in sanitized || 'backupSyncLogRetentionDays' in sanitized) {
      await backupSyncService.compactActivityLogs().catch(() => {});
    }

    return await handleGetBackupSyncSettings();
  } catch (error) {
    return { success: false, error: error.message || 'Failed to update backup sync settings' };
  }
}

export async function handleBackupSyncNow() {
  try {
    await backupSyncService.syncAll('manual');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to sync now' };
  }
}

export async function handleBackupSyncClearRemote() {
  try {
    await backupSyncService.clearRemoteNow();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to clear remote backup' };
  }
}

export async function handleBackupSyncClearLogs() {
  try {
    await backupSyncService.clearActivityLogs();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to clear sync logs' };
  }
}

export async function handleBackupSyncLogEvent(options = {}) {
  try {
    const level = String(options?.level || 'info').toLowerCase();
    const action = String(options?.action || '').trim();
    const reason = String(options?.reason || '').trim();
    const message = String(options?.message || '').trim();
    if (!action && !message) {
      return { success: false, error: 'action or message is required' };
    }
    const normalizedLevel = ['info', 'warn', 'error'].includes(level) ? level : 'info';
    await backupSyncService.logEvent({
      level: normalizedLevel,
      action,
      reason,
      message
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to log sync event' };
  }
}

export async function handleResolveBackupSyncConflict(options = {}) {
  const conflictId = String(options?.id || '').trim();
  const action = String(options?.action || '').trim();
  if (!conflictId || !action) {
    return { success: false, error: 'conflict id and action are required' };
  }

  try {
    const conflicts = await getUserSetting('backupSyncConflicts', []);
    const list = Array.isArray(conflicts) ? conflicts : [];
    const target = list.find(item => item?.id === conflictId);
    if (!target) {
      return { success: false, error: 'conflict not found' };
    }

    if (target.type === 'account' && target.accountId) {
      const account = await getAccount(target.accountId);
      if (!account) {
        return { success: false, error: 'account not found' };
      }
      const nextName = action === 'remote' ? target.remoteName : target.localName;
      const nextTimestamp = action === 'remote'
        ? (target.timestamp || getTimestamp())
        : getTimestamp();
      await updateAccount({
        ...account,
        name: nextName,
        nameUpdatedAt: nextTimestamp
      });
    } else if (target.type === 'contact' && target.contactId) {
      const contact = await getContact(target.contactId);
      if (!contact) {
        return { success: false, error: 'contact not found' };
      }
      const nextName = action === 'remote' ? target.remoteName : target.localName;
      const nextNote = action === 'remote' ? (target.remoteNote || '') : (target.localNote || '');
      const nextTimestamp = action === 'remote'
        ? (target.timestamp || Date.now())
        : Date.now();
      await saveContact({
        ...contact,
        name: nextName,
        note: nextNote,
        updatedAt: nextTimestamp
      });
    }

    const nextConflicts = list.filter(item => item?.id !== conflictId);
    await updateUserSetting('backupSyncConflicts', nextConflicts);
    backupSyncService.markDirty('conflict-resolved');

    const choiceLabel = action === 'remote' ? '远端' : '本地';
    const targetLabel = buildConflictLabel(target);
    await backupSyncService.logEvent({
      level: 'info',
      action: 'conflict-resolve',
      message: `已处理冲突：${targetLabel} 使用${choiceLabel}`
    }).catch(() => {});

    return { success: true, conflicts: nextConflicts };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to resolve conflict' };
  }
}
