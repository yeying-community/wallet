/**
 * config/app-config 纯函数单测（依赖 time-utils，零 DOM）
 * 运行：npm test
 *
 * 应用基础配置：版本信息、版本兼容（min-version 校验，major 一致 + minor ≥
 * required）、日志级别优先级、是否记录日志。
 *
 * ★ 标注：isVersionCompatible 忽略 patch 版本，且无空参守卫——锁定现状。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APP_NAME,
  VERSION,
  PROTOCOL_VERSION,
  APP_METADATA,
  LOG_LEVEL,
  LOG_CONFIG,
  LIMITS,
  getVersionInfo,
  isVersionCompatible,
  getLogLevelPriority,
  shouldLog
} from '../js/config/app-config.js';

// ==================== 数据完整性 ====================

test('APP_NAME = "YeYing Wallet"', () => {
  assert.equal(APP_NAME, 'YeYing Wallet');
});

test('VERSION / PROTOCOL_VERSION：semver 形 x.y.z', () => {
  for (const v of [VERSION, PROTOCOL_VERSION]) {
    assert.match(v, /^\d+\.\d+\.\d+$/);
  }
});

test('APP_METADATA：含 name/version/protocolVersion/description/author/homepage/supportEmail', () => {
  for (const k of ['name', 'version', 'protocolVersion', 'description', 'author', 'homepage', 'supportEmail']) {
    assert.ok(APP_METADATA[k], `${k} 存在`);
    assert.equal(typeof APP_METADATA[k], 'string');
  }
  assert.equal(APP_METADATA.name, APP_NAME);
  assert.equal(APP_METADATA.version, VERSION);
  assert.equal(APP_METADATA.protocolVersion, PROTOCOL_VERSION);
});

test('LOG_LEVEL：合法级别', () => {
  assert.ok(['debug', 'info', 'warn', 'error', 'none'].includes(LOG_LEVEL));
});

test('LOG_CONFIG：与 LOG_LEVEL 一致', () => {
  assert.equal(LOG_CONFIG.level, LOG_LEVEL);
  for (const k of ['enableConsole', 'enableStorage', 'includeTimestamp', 'includeStackTrace']) {
    assert.equal(typeof LOG_CONFIG[k], 'boolean');
  }
  assert.ok(LOG_CONFIG.maxStorageSize > 0);
});

test('LIMITS：各上限 > 0', () => {
  for (const [k, v] of Object.entries(LIMITS)) {
    assert.ok(v > 0, `${k} 应 > 0`);
  }
});

// ==================== getVersionInfo ====================

test('getVersionInfo：返回 version/protocolVersion/ISO buildDate', () => {
  const info = getVersionInfo();
  assert.equal(info.version, VERSION);
  assert.equal(info.protocolVersion, PROTOCOL_VERSION);
  assert.match(info.buildDate, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

// ==================== isVersionCompatible ====================

test('isVersionCompatible：major 一致 + current.minor ≥ required.minor → true', () => {
  const [curMaj, curMin] = VERSION.split('.').map(Number);
  // 等于当前版本
  assert.equal(isVersionCompatible(VERSION), true);
  // 比当前低
  if (curMin > 0) {
    assert.equal(isVersionCompatible(`${curMaj}.0.0`), true);
  }
});

test('isVersionCompatible：major 不同 → false', () => {
  const [curMaj] = VERSION.split('.').map(Number);
  assert.equal(isVersionCompatible(`${curMaj + 1}.0.0`), false);
  // VERSION=1.x.x，要求 0.x.x 也不通过（major 严格相等）
  if (curMaj > 0) {
    assert.equal(isVersionCompatible(`0.0.0`), false);
  }
});

test('isVersionCompatible：current.minor < required.minor → false', () => {
  const [curMaj, curMin] = VERSION.split('.').map(Number);
  if (curMin >= 0) {
    // 要求比当前高
    assert.equal(isVersionCompatible(`${curMaj}.${curMin + 100}.0`), false);
  }
});

test('★ isVersionCompatible：忽略 patch 段（当前实现行为）', () => {
  // 1.0.0 vs required 1.0.5：minor 都是 0 → 0 >= 0 → true
  // 即要求更高的 patch 也视作兼容（潜在缺陷）
  assert.equal(isVersionCompatible('1.0.5'), true, 'patch 差异被忽略');
});

test('★ isVersionCompatible：缺参数 / 非字符串 → 抛错（当前实现未守卫）', () => {
  // undefined.split → TypeError
  assert.throws(() => isVersionCompatible(undefined), TypeError);
  // null → 同样抛错
  assert.throws(() => isVersionCompatible(null), TypeError);
  // 空串 split → [''] → Number('') = 0：major 不匹配当前 → false
  assert.doesNotThrow(() => isVersionCompatible(''));
  assert.equal(isVersionCompatible(''), false, '空串 → [0,0] → major 不匹配当前');
});

// ==================== getLogLevelPriority ====================

test('getLogLevelPriority：debug=0 / info=1 / warn=2 / error=3 / none=4', () => {
  assert.equal(getLogLevelPriority('debug'), 0);
  assert.equal(getLogLevelPriority('info'), 1);
  assert.equal(getLogLevelPriority('warn'), 2);
  assert.equal(getLogLevelPriority('error'), 3);
  assert.equal(getLogLevelPriority('none'), 4);
});

test('getLogLevelPriority：未知 level 回落 info (1)', () => {
  assert.equal(getLogLevelPriority('unknown'), 1);
  assert.equal(getLogLevelPriority(null), 1);
  assert.equal(getLogLevelPriority(undefined), 1);
});

// ==================== shouldLog ====================

test('shouldLog：默认 LOG_LEVEL=info', () => {
  // info 及更高级别（warn/error/none）应记录；debug 不记录
  assert.equal(shouldLog('debug'), false);
  assert.equal(shouldLog('info'), true);
  assert.equal(shouldLog('warn'), true);
  assert.equal(shouldLog('error'), true);
  assert.equal(shouldLog('none'), true);
});
