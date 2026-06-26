/**
 * Settings 控制器共享纯函数与常量（无 DOM、无实例状态，可独立测试）
 * 供 BackupSyncSettingsController 与 MpcSettingsController 复用。
 */
import { normalizeBearerToken } from '../../common/ucan-utils.js';

export const LEGACY_DEFAULT_APP_ID = 'yeying-wallet';
export const DEFAULT_UCAN_ACTION = 'write';
export const DEFAULT_LOG_MAX_COUNT = 100000;
export const DEFAULT_LOG_RETENTION_DAYS = 30;
export const LOG_MAX_COUNT_MIN = 50;
export const LOG_MAX_COUNT_MAX = 100000;
export const LOG_RETENTION_MIN_DAYS = 1;
export const LOG_RETENTION_MAX_DAYS = 365;
export const DEFAULT_MPC_UCAN_RESOURCE = 'mpc';
export const DEFAULT_MPC_UCAN_ACTION = 'coordinate';
export const LEGACY_UCAN_RESOURCES = new Set([
  'profile',
  'webdav/*',
  'webdav#access',
  'webdav/access',
  'webdav'
]);

export function normalizeBasicAuth(value) {
  if (!value) return '';
  if (value.startsWith('Basic ')) return value;
  if (value.includes(':')) {
    return `Basic ${btoa(value)}`;
  }
  return `Basic ${value}`;
}

export function normalizeUcanToken(value) {
  return normalizeBearerToken(value);
}

export function normalizeUcanResource(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || isLegacyUcanResource(trimmed)) {
    return getDefaultUcanResource();
  }
  return trimmed;
}

export function normalizeMpcUcanResource(value) {
  const trimmed = String(value || '').trim();
  return trimmed || DEFAULT_MPC_UCAN_RESOURCE;
}

export function normalizeLogMaxCount(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return DEFAULT_LOG_MAX_COUNT;
  const rounded = Math.floor(numberValue);
  if (rounded < LOG_MAX_COUNT_MIN) return LOG_MAX_COUNT_MIN;
  if (rounded > LOG_MAX_COUNT_MAX) return LOG_MAX_COUNT_MAX;
  return rounded;
}

export function normalizeLogRetentionDays(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return DEFAULT_LOG_RETENTION_DAYS;
  const rounded = Math.floor(numberValue);
  if (rounded < LOG_RETENTION_MIN_DAYS) return LOG_RETENTION_MIN_DAYS;
  if (rounded > LOG_RETENTION_MAX_DAYS) return LOG_RETENTION_MAX_DAYS;
  return rounded;
}

export function normalizeUcanAction(value, resource) {
  const trimmed = String(value || '').trim();
  const resourceTrimmed = String(resource || '').trim();
  const isLegacyResource = !resourceTrimmed || isLegacyUcanResource(resourceTrimmed);
  if (isLegacyResource || !trimmed || trimmed === '*') {
    return DEFAULT_UCAN_ACTION;
  }
  return trimmed;
}

export function normalizeMpcUcanAction(value, resource) {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === '*') {
    return DEFAULT_MPC_UCAN_ACTION;
  }
  if (resource && isLegacyUcanResource(resource)) {
    return DEFAULT_MPC_UCAN_ACTION;
  }
  return trimmed;
}

export function getDefaultUcanAppId() {
  try {
    const id = typeof chrome !== 'undefined' ? chrome?.runtime?.id : '';
    if (id) return String(id).toLowerCase();
  } catch {
    // ignore
  }
  return LEGACY_DEFAULT_APP_ID;
}

export function getDefaultUcanResource() {
  return `app:${getDefaultUcanAppId()}`;
}

export function isLegacyUcanResource(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;
  const normalized = trimmed.toLowerCase();
  if (LEGACY_UCAN_RESOURCES.has(normalized)) return true;
  const legacyResource = `app:${LEGACY_DEFAULT_APP_ID}`;
  if (normalized === legacyResource) {
    return normalized !== getDefaultUcanResource().toLowerCase();
  }
  return false;
}
