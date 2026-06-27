/**
 * config/feature-flags 单测（仅读路径，零 DOM）
 * 运行：npm test
 *
 * 功能开关：基础/实验性/开发者三组、依赖检查、列出已启/禁用集合。
 *
 * 注：enableFeature/disableFeature/toggleFeature/setFeatures/resetFeatures
 * 都会直接修改导入的模块级对象（FEATURES / EXPERIMENTAL_FEATURES /
 * DEVELOPER_FEATURES），没有机制保证用例间隔离，也存在误改全局配置的
 * 风险——这些写路径未在此测试集中覆盖；调用方应自行保证不会污染。
 *
 * ★ 标注：isExperimentalFeatureEnabled 依赖 ENABLE_EXPERIMENTAL_FEATURES
 * 总开关；isDeveloperFeatureEnabled 同理。resetFeatures 当前仅 console.warn。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FEATURES,
  EXPERIMENTAL_FEATURES,
  DEVELOPER_FEATURES,
  isFeatureEnabled,
  isExperimentalFeatureEnabled,
  isDeveloperFeatureEnabled,
  getEnabledFeatures,
  getDisabledFeatures,
  checkFeatureDependencies
} from '../js/config/feature-flags.js';

const FEATURE_KEYS = Object.keys(FEATURES);

// ==================== 数据完整性 ====================

test('FEATURES：所有值为 boolean', () => {
  for (const [k, v] of Object.entries(FEATURES)) {
    assert.equal(typeof v, 'boolean', `${k} 应为 boolean`);
  }
  // 主要以 ENABLE_ 开头，允许少数例外（如 STRICT_VALIDATION）
  const enableCount = FEATURE_KEYS.filter((k) => k.startsWith('ENABLE_')).length;
  assert.ok(enableCount >= 20, `ENABLE_* 开关至少 20 个（实际 ${enableCount}）`);
});

test('EXPERIMENTAL_FEATURES / DEVELOPER_FEATURES：所有值默认 false', () => {
  for (const k of Object.keys(EXPERIMENTAL_FEATURES)) {
    assert.equal(EXPERIMENTAL_FEATURES[k], false, `${k} 默认 false`);
  }
  for (const k of Object.keys(DEVELOPER_FEATURES)) {
    assert.equal(DEVELOPER_FEATURES[k], false, `${k} 默认 false`);
  }
});

// ==================== isFeatureEnabled ====================

test('isFeatureEnabled：仅严格 === true 时为 true', () => {
  const onKey = FEATURE_KEYS.find((k) => FEATURES[k] === true);
  const offKey = FEATURE_KEYS.find((k) => FEATURES[k] === false);
  assert.ok(onKey, '应至少有一个默认开启的功能');
  assert.ok(offKey, '应至少有一个默认关闭的功能');
  assert.equal(isFeatureEnabled(onKey), true);
  assert.equal(isFeatureEnabled(offKey), false);
});

test('isFeatureEnabled：未知 key / null / 空 → false', () => {
  assert.equal(isFeatureEnabled('UNKNOWN_FEATURE'), false);
  assert.equal(isFeatureEnabled(null), false);
  assert.equal(isFeatureEnabled(''), false);
  assert.equal(isFeatureEnabled(undefined), false);
});

// ==================== isExperimentalFeatureEnabled（总开关关闭时全 false）====================

test('★ isExperimentalFeatureEnabled：默认总开关关 → 任何实验性功能都 false', () => {
  // 总开关 ENABLE_EXPERIMENTAL_FEATURES 默认 false
  assert.equal(FEATURES.ENABLE_EXPERIMENTAL_FEATURES, false);
  for (const k of Object.keys(EXPERIMENTAL_FEATURES)) {
    assert.equal(isExperimentalFeatureEnabled(k), false, `${k} 应 false（总开关关闭）`);
  }
});

test('isExperimentalFeatureEnabled：未知实验性 key → false（不抛）', () => {
  assert.equal(isExperimentalFeatureEnabled('UNKNOWN'), false);
  assert.equal(isExperimentalFeatureEnabled(null), false);
});

// ==================== isDeveloperFeatureEnabled（总开关关闭时全 false）====================

test('★ isDeveloperFeatureEnabled：默认总开关关 → 任何开发者功能都 false', () => {
  assert.equal(FEATURES.ENABLE_DEVELOPER_MODE, false);
  for (const k of Object.keys(DEVELOPER_FEATURES)) {
    assert.equal(isDeveloperFeatureEnabled(k), false, `${k} 应 false（总开关关闭）`);
  }
});

test('isDeveloperFeatureEnabled：未知 key → false（不抛）', () => {
  assert.equal(isDeveloperFeatureEnabled('UNKNOWN'), false);
});

// ==================== getEnabledFeatures / getDisabledFeatures ====================

test('getEnabledFeatures：返回值为 boolean=true 的键名数组', () => {
  const enabled = getEnabledFeatures();
  assert.ok(Array.isArray(enabled));
  for (const k of enabled) {
    assert.equal(FEATURES[k], true, `${k} 应确实为 true`);
  }
});

test('getDisabledFeatures：与 getEnabledFeatures 互斥、合计 = FEATURE_KEYS 长度', () => {
  const on = getEnabledFeatures();
  const off = getDisabledFeatures();
  assert.equal(on.length + off.length, FEATURE_KEYS.length);
  for (const k of on) assert.ok(!off.includes(k));
  for (const k of off) assert.equal(FEATURES[k], false, `${k} 应确实为 false`);
});

// ==================== checkFeatureDependencies ====================

test('checkFeatureDependencies：依赖全开 → satisfied=true', () => {
  // ENABLE_NFT_SUPPORT 依赖 ENABLE_TOKEN_DETECTION（默认 true）
  assert.equal(FEATURES.ENABLE_TOKEN_DETECTION, true, '前置：依赖默认开启');
  const r = checkFeatureDependencies('ENABLE_NFT_SUPPORT');
  assert.equal(r.satisfied, true);
  assert.deepEqual(r.missing, []);
});

test('checkFeatureDependencies：依赖未开 → 列出 missing', () => {
  // 不修改全局：仅检查依赖函数能正确识别"如果某项是 false 就 missing"——
  // 直接调用检查（依赖检查读 FEATURES 实时值；不修改）
  // 选一个有依赖的功能并验证结果结构
  const r = checkFeatureDependencies('ENABLE_HARDWARE_WALLET');
  // ENABLE_HARDWARE_WALLET 依赖 ENABLE_ADVANCED_MODE（默认 false）
  assert.equal(FEATURES.ENABLE_ADVANCED_MODE, false, '前置：依赖默认关闭');
  assert.equal(r.satisfied, false);
  assert.ok(r.missing.includes('ENABLE_ADVANCED_MODE'));
});

test('checkFeatureDependencies：无依赖的功能 → 始终 satisfied', () => {
  const r = checkFeatureDependencies('ENABLE_DARK_MODE');
  assert.equal(r.satisfied, true);
  assert.deepEqual(r.missing, []);
});

test('checkFeatureDependencies：未知功能 → 空依赖、satisfied=true', () => {
  const r = checkFeatureDependencies('UNKNOWN_FEATURE');
  assert.equal(r.satisfied, true);
  assert.deepEqual(r.missing, []);
});

test('checkFeatureDependencies：ENABLE_TOKEN_SWAP 依赖 ENABLE_CUSTOM_NETWORKS（默认 true）', () => {
  assert.equal(FEATURES.ENABLE_CUSTOM_NETWORKS, true, '前置：依赖默认开启');
  const r = checkFeatureDependencies('ENABLE_TOKEN_SWAP');
  assert.equal(r.satisfied, true);
});

test('checkFeatureDependencies：ENABLE_BIOMETRIC_AUTH 依赖 ENABLE_AUTO_LOCK（默认 true）', () => {
  assert.equal(FEATURES.ENABLE_AUTO_LOCK, true, '前置：依赖默认开启');
  const r = checkFeatureDependencies('ENABLE_BIOMETRIC_AUTH');
  assert.equal(r.satisfied, true);
});
