/**
 * config/storage-keys 纯函数单测（零依赖、零 DOM）
 * 运行：npm test
 *
 * 存储键生成器：账户/网络/代币/交易/网站/缓存键的拼接。键错会写错分区、
 * 读不到数据、敏感键识别错会误清或漏清 → 影响会话安全。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LOCAL_KEYS,
  SESSION_KEYS,
  CHROME_KEYS,
  KEY_PREFIXES,
  getAccountKey,
  getNetworkKey,
  getTokenKey,
  getTransactionKey,
  getSiteKey,
  getCacheKey,
  isSensitiveKey,
  shouldClearOnSessionEnd,
  getSensitiveKeys,
  getSessionKeys,
  getLocalKeys
} from '../js/config/storage-keys.js';

// ==================== 数据完整性 ====================

test('LOCAL_KEYS / SESSION_KEYS / CHROME_KEYS：所有值为非空字符串', () => {
  for (const v of Object.values(LOCAL_KEYS)) {
    assert.equal(typeof v, 'string');
    assert.ok(v.length > 0);
  }
  for (const v of Object.values(SESSION_KEYS)) {
    assert.equal(typeof v, 'string');
    assert.ok(v.length > 0);
  }
  for (const v of Object.values(CHROME_KEYS.SYNC)) {
    assert.equal(typeof v, 'string');
    assert.ok(v.length > 0);
  }
  for (const v of Object.values(CHROME_KEYS.LOCAL)) {
    assert.equal(typeof v, 'string');
    assert.ok(v.length > 0);
  }
});

test('LOCAL_KEYS / SESSION_KEYS：键名无重复（防覆盖）', () => {
  const all = [...Object.values(LOCAL_KEYS), ...Object.values(SESSION_KEYS)];
  assert.equal(new Set(all).size, all.length);
});

test('KEY_PREFIXES：含 6 个前缀且都是空串外的字符串', () => {
  const expected = ['ACCOUNT', 'NETWORK', 'TOKEN', 'TRANSACTION', 'SITE', 'CACHE'];
  for (const k of expected) {
    assert.ok(KEY_PREFIXES[k], `${k} 前缀存在`);
    assert.equal(typeof KEY_PREFIXES[k], 'string');
  }
});

// ==================== 键生成器 ====================

test('getAccountKey：account_<id>_<key>', () => {
  assert.equal(getAccountKey('acc1', 'balance'), 'account_acc1_balance');
  assert.equal(getAccountKey('acc_1', 'meta.name'), 'account_acc_1_meta.name');
});

test('getNetworkKey：network_<id>_<key>', () => {
  assert.equal(getNetworkKey('eth', 'rpc'), 'network_eth_rpc');
});

test('getTokenKey：token_<networkId>_<address>', () => {
  // 实现：prefix + networkId + '_' + tokenAddress
  assert.equal(getTokenKey('0xabc', 'eth'), 'token_eth_0xabc');
});

test('getTransactionKey：tx_<hash>', () => {
  assert.equal(getTransactionKey('0x' + 'a'.repeat(64)), 'tx_0x' + 'a'.repeat(64));
  assert.equal(getTransactionKey('0xdeadbeef'), 'tx_0xdeadbeef');
});

test('getSiteKey：site_<origin>', () => {
  assert.equal(getSiteKey('https://example.com'), 'site_https://example.com');
});

test('getCacheKey：cache_<key>', () => {
  assert.equal(getCacheKey('gas_price'), 'cache_gas_price');
});

// ==================== isSensitiveKey ====================

test('isSensitiveKey：命中 4 个敏感键', () => {
  // 私钥、临时助记词、临时密码、加密钱包
  assert.equal(isSensitiveKey(SESSION_KEYS.WALLET_PRIVATE_KEY), true);
  assert.equal(isSensitiveKey(SESSION_KEYS.TEMP_MNEMONIC), true);
  assert.equal(isSensitiveKey(SESSION_KEYS.TEMP_PASSWORD), true);
  assert.equal(isSensitiveKey(LOCAL_KEYS.ENCRYPTED_WALLET), true);
});

test('isSensitiveKey：非敏感键 / 未知键 → false', () => {
  assert.equal(isSensitiveKey(SESSION_KEYS.WALLET_ADDRESS), false);
  assert.equal(isSensitiveKey(LOCAL_KEYS.SETTINGS), false);
  assert.equal(isSensitiveKey('not-a-real-key'), false);
  assert.equal(isSensitiveKey(null), false);
  assert.equal(isSensitiveKey(''), false);
});

// ==================== shouldClearOnSessionEnd ====================

test('shouldClearOnSessionEnd：SESSION_KEYS 全部应在会话结束清除', () => {
  for (const k of Object.values(SESSION_KEYS)) {
    assert.equal(shouldClearOnSessionEnd(k), true, `${k} 应被清`);
  }
});

test('shouldClearOnSessionEnd：LOCAL_KEYS 不应被清', () => {
  for (const k of Object.values(LOCAL_KEYS)) {
    assert.equal(shouldClearOnSessionEnd(k), false, `${k} 不应被清`);
  }
});

test('shouldClearOnSessionEnd：未知键 → false', () => {
  assert.equal(shouldClearOnSessionEnd('foo'), false);
  assert.equal(shouldClearOnSessionEnd(null), false);
});

// ==================== getSensitiveKeys / getSessionKeys / getLocalKeys ====================

test('getSensitiveKeys：长度 4 + 全部命中 isSensitiveKey', () => {
  const list = getSensitiveKeys();
  assert.equal(list.length, 4);
  for (const k of list) assert.equal(isSensitiveKey(k), true);
});

test('getSessionKeys：等于 SESSION_KEYS 全部值、每条都能 shouldClearOnSessionEnd', () => {
  const list = getSessionKeys();
  assert.deepEqual(list, Object.values(SESSION_KEYS));
  for (const k of list) assert.equal(shouldClearOnSessionEnd(k), true);
});

test('getLocalKeys：等于 LOCAL_KEYS 全部值、每条都不能 shouldClearOnSessionEnd', () => {
  const list = getLocalKeys();
  assert.deepEqual(list, Object.values(LOCAL_KEYS));
  for (const k of list) assert.equal(shouldClearOnSessionEnd(k), false);
});
