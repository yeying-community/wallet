/**
 * settings-utils 纯函数单测（零依赖，Node 内置 runner）
 * 运行：node --test --test-force-exit "tests/*.test.mjs"
 *
 * 这些函数从 SettingController 拆出，供 backup/mpc 设置子控制器复用，
 * 决定 UCAN 资源/动作归一化、日志留存 clamp、Basic 凭证编码等行为。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeBasicAuth,
  normalizeUcanResource,
  normalizeMpcUcanResource,
  normalizeUcanAction,
  normalizeMpcUcanAction,
  normalizeLogMaxCount,
  normalizeLogRetentionDays,
  getDefaultUcanResource,
  isLegacyUcanResource,
  DEFAULT_UCAN_ACTION,
  DEFAULT_MPC_UCAN_RESOURCE,
  DEFAULT_MPC_UCAN_ACTION,
  LOG_MAX_COUNT_MIN,
  LOG_MAX_COUNT_MAX,
  LOG_RETENTION_MIN_DAYS,
  LOG_RETENTION_MAX_DAYS
} from '../js/controller/setting/settings-utils.js';

test('normalizeBasicAuth：原样 Basic / user:pass 编码 / 裸值加前缀', () => {
  assert.equal(normalizeBasicAuth('Basic abc'), 'Basic abc');
  assert.equal(normalizeBasicAuth('user:pass'), `Basic ${btoa('user:pass')}`);
  assert.equal(normalizeBasicAuth('token123'), 'Basic token123');
  assert.equal(normalizeBasicAuth(''), '');
});

test('normalizeUcanResource：空/legacy 归默认（app:<id>），自定义保留', () => {
  assert.equal(normalizeUcanResource(''), getDefaultUcanResource());
  assert.equal(normalizeUcanResource('webdav'), getDefaultUcanResource());
  assert.equal(normalizeUcanResource('app:custom-id'), 'app:custom-id');
});

test('normalizeMpcUcanResource：空归默认 mpc，自定义保留', () => {
  assert.equal(normalizeMpcUcanResource(''), DEFAULT_MPC_UCAN_RESOURCE);
  assert.equal(normalizeMpcUcanResource('custom-mpc'), 'custom-mpc');
});

test('normalizeUcanAction：legacy 资源/空/通配归默认 write，其余保留', () => {
  assert.equal(normalizeUcanAction('read', 'webdav'), DEFAULT_UCAN_ACTION); // legacy resource
  assert.equal(normalizeUcanAction('', 'app:x'), DEFAULT_UCAN_ACTION);
  assert.equal(normalizeUcanAction('*', 'app:x'), DEFAULT_UCAN_ACTION);
  assert.equal(normalizeUcanAction('read', 'app:x'), 'read');
});

test('normalizeMpcUcanAction：空/通配归默认 coordinate，legacy 资源归默认', () => {
  assert.equal(normalizeMpcUcanAction(''), DEFAULT_MPC_UCAN_ACTION);
  assert.equal(normalizeMpcUcanAction('*'), DEFAULT_MPC_UCAN_ACTION);
  assert.equal(normalizeMpcUcanAction('sign', 'webdav'), DEFAULT_MPC_UCAN_ACTION);
  assert.equal(normalizeMpcUcanAction('sign', 'app:x'), 'sign');
});

test('normalizeLogMaxCount / normalizeLogRetentionDays：clamp 到区间', () => {
  assert.equal(normalizeLogMaxCount(1), LOG_MAX_COUNT_MIN);
  assert.equal(normalizeLogMaxCount(999999999), LOG_MAX_COUNT_MAX);
  assert.equal(normalizeLogMaxCount(1000), 1000);
  assert.equal(normalizeLogMaxCount('x'), 100000);

  assert.equal(normalizeLogRetentionDays(0), LOG_RETENTION_MIN_DAYS);
  assert.equal(normalizeLogRetentionDays(99999), LOG_RETENTION_MAX_DAYS);
  assert.equal(normalizeLogRetentionDays(30), 30);
});

test('isLegacyUcanResource：旧资源 true，自定义 app 资源 false', () => {
  assert.equal(isLegacyUcanResource('webdav'), true);
  assert.equal(isLegacyUcanResource('profile'), true);
  assert.equal(isLegacyUcanResource(''), true);
  assert.equal(isLegacyUcanResource('app:some-custom-extension-id'), false);
});
