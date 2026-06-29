/**
 * sync-utils 纯工具函数单测（零依赖，Node 内置 runner）
 * 运行：node --test --test-force-exit "tests/*.test.mjs"
 *
 * 这些函数从 sync-service.js 拆出，无状态，决定 WebDAV 路径/UCAN 资源/日志保留等行为。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  joinUrl,
  buildPayloadFilename,
  isLegacyUcanResource,
  normalizeUcanResource,
  normalizeUcanAction,
  normalizeLogMaxCount,
  normalizeLogRetentionDays,
  extractAppIdFromResource,
  getDefaultUcanResource,
  normalizeBearerToken
} from '../js/background/sync/sync-utils.js';
import {
  SYNC_FILENAME,
  DEFAULT_UCAN_ACTION,
  LOG_MAX_COUNT_MIN,
  LOG_MAX_COUNT_MAX,
  LOG_RETENTION_MIN_DAYS,
  LOG_RETENTION_MAX_DAYS
} from '../js/background/sync/constants.js';

test('joinUrl 处理斜杠与空 base', () => {
  assert.equal(joinUrl('https://h/dav', 'a/b'), 'https://h/dav/a/b');
  assert.equal(joinUrl('https://h/dav/', '/a/b'), 'https://h/dav/a/b');
  assert.equal(joinUrl('', 'a/b'), 'a/b');
});

test('buildPayloadFilename 含 fingerprint / 空回退默认名', () => {
  assert.equal(buildPayloadFilename('abc123'), 'payload.abc123.json.enc');
  assert.equal(buildPayloadFilename(''), SYNC_FILENAME);
  assert.equal(buildPayloadFilename(null), SYNC_FILENAME);
});

test('normalizeUcanAction：空/通配/forceDefault 归默认，其余保留', () => {
  assert.equal(normalizeUcanAction(''), DEFAULT_UCAN_ACTION);
  assert.equal(normalizeUcanAction('*'), DEFAULT_UCAN_ACTION);
  assert.equal(normalizeUcanAction('read', { forceDefault: true }), DEFAULT_UCAN_ACTION);
  assert.equal(normalizeUcanAction('read'), 'read');
});

test('normalizeLogMaxCount：clamp 到 [MIN, MAX]，非数回退默认', () => {
  assert.equal(normalizeLogMaxCount(1), LOG_MAX_COUNT_MIN);
  assert.equal(normalizeLogMaxCount(99999999), LOG_MAX_COUNT_MAX);
  assert.equal(normalizeLogMaxCount(1000), 1000);
  assert.equal(normalizeLogMaxCount('not-a-number'), 100000);
});

test('normalizeLogRetentionDays：clamp 到 [MIN, MAX]', () => {
  assert.equal(normalizeLogRetentionDays(0), LOG_RETENTION_MIN_DAYS);
  assert.equal(normalizeLogRetentionDays(99999), LOG_RETENTION_MAX_DAYS);
  assert.equal(normalizeLogRetentionDays(30), 30);
});

test('extractAppIdFromResource：仅识别 app: 前缀且不含通配', () => {
  assert.equal(extractAppIdFromResource('app:my-app'), 'my-app');
  assert.equal(extractAppIdFromResource('webdav'), '');
  assert.equal(extractAppIdFromResource('app:*'), '');
  assert.equal(extractAppIdFromResource(''), '');
});

test('isLegacyUcanResource：旧资源标记为 legacy，自定义 app 资源不是', () => {
  assert.equal(isLegacyUcanResource('webdav'), true);
  assert.equal(isLegacyUcanResource('profile'), true);
  assert.equal(isLegacyUcanResource(''), true);
  assert.equal(isLegacyUcanResource('app:some-custom-extension-id'), false);
});

test('normalizeUcanResource：空/legacy 归默认（app:<id>），自定义保留', () => {
  assert.equal(normalizeUcanResource(''), getDefaultUcanResource());
  assert.equal(normalizeUcanResource('webdav'), getDefaultUcanResource());
  assert.equal(normalizeUcanResource('app:custom-id'), 'app:custom-id');
});

test('normalizeBearerToken：去除 Bearer/UCAN 前缀与空白', () => {
  assert.equal(normalizeBearerToken('Bearer abc'), 'abc');
  assert.equal(normalizeBearerToken('UCAN xyz'), 'xyz');
  assert.equal(normalizeBearerToken('  plain  '), 'plain');
  assert.equal(normalizeBearerToken(''), '');
});
