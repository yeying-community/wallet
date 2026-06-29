/**
 * Backup & Sync 常量
 */

export const SYNC_PAYLOAD_VERSION = 1;
export const SYNC_FILENAME = 'payload.json.enc';
export const SYNC_DEBOUNCE_MS = 1500;
export const DEFAULT_SYNC_ENDPOINT = 'https://webdav.yeying.pub/dav';
export const LEGACY_DEFAULT_APP_ID = 'yeying-wallet';
export const DEFAULT_UCAN_ACTION = 'write';
export const APP_SCOPE_PREFIX = 'apps';
export const LEGACY_UCAN_RESOURCES = new Set([
  'profile',
  'webdav/*',
  'webdav#access',
  'webdav/access',
  'webdav'
]);
export const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
export const AUTO_SYNC_JITTER_MS = 30 * 1000;
export const AUTO_SYNC_MAX_BACKOFF_MS = 15 * 60 * 1000;
export const DEFAULT_LOG_MAX_COUNT = 100000;
export const DEFAULT_LOG_RETENTION_DAYS = 30;
export const LOG_MAX_COUNT_MIN = 50;
export const LOG_MAX_COUNT_MAX = 100000;
export const LOG_RETENTION_MIN_DAYS = 1;
export const LOG_RETENTION_MAX_DAYS = 365;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const SETTINGS_KEYS = {
  enabled: 'backupSyncEnabled',
  endpoint: 'backupSyncEndpoint',
  authMode: 'backupSyncAuthMode',
  authToken: 'backupSyncAuthToken',
  authTokenExpiresAt: 'backupSyncAuthTokenExpiresAt',
  ucanToken: 'backupSyncUcanToken',
  ucanResource: 'backupSyncUcanResource',
  ucanAction: 'backupSyncUcanAction',
  ucanAudience: 'backupSyncUcanAudience',
  basicAuth: 'backupSyncBasicAuth',
  dirty: 'backupSyncDirty',
  lastPullAt: 'backupSyncLastPullAt',
  lastPushAt: 'backupSyncLastPushAt',
  pendingDelete: 'backupSyncPendingDelete',
  networkIds: 'backupSyncNetworkIds',
  conflicts: 'backupSyncConflicts',
  remoteMeta: 'backupSyncRemoteMeta',
  logs: 'backupSyncLogs',
  logMaxCount: 'backupSyncLogMaxCount',
  logRetentionDays: 'backupSyncLogRetentionDays'
};
