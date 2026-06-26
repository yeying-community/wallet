/**
 * Backup & Sync 纯工具函数（无状态，可独立测试）
 */
import {
  SYNC_FILENAME,
  LEGACY_DEFAULT_APP_ID,
  DEFAULT_UCAN_ACTION,
  LEGACY_UCAN_RESOURCES,
  DEFAULT_LOG_MAX_COUNT,
  DEFAULT_LOG_RETENTION_DAYS,
  LOG_MAX_COUNT_MIN,
  LOG_MAX_COUNT_MAX,
  LOG_RETENTION_MIN_DAYS,
  LOG_RETENTION_MAX_DAYS
} from './constants.js';

export function joinUrl(base, path) {
  if (!base) return path;
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedPath = path.replace(/^\/+/, '');
  return new URL(normalizedPath, normalizedBase).toString();
}

export function buildPayloadFilename(fingerprint) {
  const safe = String(fingerprint || '').trim();
  if (!safe) return SYNC_FILENAME;
  return `payload.${safe}.json.enc`;
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

export function normalizeUcanResource(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || isLegacyUcanResource(trimmed)) {
    return getDefaultUcanResource();
  }
  return trimmed;
}

export function normalizeUcanAction(value, { forceDefault = false } = {}) {
  const trimmed = String(value || '').trim();
  if (forceDefault || !trimmed || trimmed === '*') {
    return DEFAULT_UCAN_ACTION;
  }
  return trimmed;
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

export function extractAppIdFromResource(resource) {
  const trimmed = String(resource || '').trim();
  if (!trimmed.toLowerCase().startsWith('app:')) return '';
  const appId = trimmed.slice(4).trim();
  if (!appId || appId.includes('*')) return '';
  return appId;
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

export function normalizeBearerToken(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/^Bearer\s+/i, '')
    .replace(/^UCAN\s+/i, '')
    .trim();
}
