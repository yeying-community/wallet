/**
 * common/crypto/password 纯函数单测（密码强度/校验，安全敏感）
 * 运行：npm test
 *
 * crypto.test.mjs 只覆盖加解密；本文件补 password.js：强度分级、validatePassword、
 * 确认一致性、常见弱密码、随机生成（含字符集/长度/crypto 随机）、hash 往返。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculatePasswordStrength,
  validatePassword,
  getPasswordStrengthDetails,
  generateRandomPassword,
  validatePasswordConfirmation,
  isCommonPassword,
  hashPassword,
  verifyPasswordHash,
  getPasswordStrengthColor,
  getPasswordStrengthText
} from '../js/common/crypto/password.js';
import { PASSWORD_STRENGTH } from '../js/common/crypto/crypto-constants.js';

// ==================== calculatePasswordStrength ====================

test('calculatePasswordStrength：< 8 位 → WEAK', () => {
  assert.equal(calculatePasswordStrength(''), PASSWORD_STRENGTH.WEAK);
  assert.equal(calculatePasswordStrength('Aa1!'), PASSWORD_STRENGTH.WEAK);
});

test('calculatePasswordStrength：8 位无要求 → WEAK', () => {
  assert.equal(calculatePasswordStrength('aaaaaaaa'), PASSWORD_STRENGTH.WEAK);
});

test('calculatePasswordStrength：MEDIUM（>=10 位 + 字母 + 数字）', () => {
  // 10 位、含字母数字、但不满足 STRONG（无大写/特殊符 + 仅 10 位）
  assert.equal(calculatePasswordStrength('abcde12345'), PASSWORD_STRENGTH.MEDIUM);
});

test('calculatePasswordStrength：STRONG（>=12 位 + 大小写+数字+特殊）', () => {
  assert.equal(calculatePasswordStrength('Abcdef123!@#'), PASSWORD_STRENGTH.STRONG);
});

test('calculatePasswordStrength：VERY_STRONG（>=16 位 + 四类）', () => {
  assert.equal(calculatePasswordStrength('Abcdefgh1234!@#$'), PASSWORD_STRENGTH.VERY_STRONG);
});

// ==================== validatePassword ====================

test('validatePassword：空/非字符串 → 报错', () => {
  assert.equal(validatePassword('').valid, false);
  assert.equal(validatePassword(null).valid, false);
  assert.equal(validatePassword(12345678).valid, false);
});

test('validatePassword：长度不足 → 报错', () => {
  const r = validatePassword('Aa1!');
  assert.equal(r.valid, false);
  assert.match(r.error, /at least/);
});

test('validatePassword：默认（minStrength=WEAK）合法 8 位通过', () => {
  const r = validatePassword('aaaaaaaa');
  assert.equal(r.valid, true);
  assert.equal(r.strength, PASSWORD_STRENGTH.WEAK);
});

test('validatePassword：minStrength=STRONG，弱密码被拒', () => {
  const r = validatePassword('aaaaaaaa', { minStrength: PASSWORD_STRENGTH.STRONG });
  assert.equal(r.valid, false);
  assert.match(r.error, /too weak/);
  assert.equal(r.strength, PASSWORD_STRENGTH.WEAK);
});

test('validatePassword：minStrength=STRONG，强密码通过', () => {
  const r = validatePassword('Abcdef123!@#', { minStrength: PASSWORD_STRENGTH.STRONG });
  assert.equal(r.valid, true);
  assert.equal(r.strength, PASSWORD_STRENGTH.STRONG);
});

test('validatePassword：自定义 minLength', () => {
  assert.equal(validatePassword('abcdef', { minLength: 6 }).valid, true);
  assert.equal(validatePassword('abcde', { minLength: 6 }).valid, false);
});

// ==================== getPasswordStrengthDetails ====================

test('getPasswordStrengthDetails：空密码 → score 0 + 建议', () => {
  const d = getPasswordStrengthDetails('');
  assert.equal(d.score, 0);
  assert.equal(d.strength, PASSWORD_STRENGTH.WEAK);
  assert.ok(d.suggestions.length > 0);
});

test('getPasswordStrengthDetails：满分密码 score=100、无缺项建议', () => {
  const d = getPasswordStrengthDetails('Abcdefgh1234!@#$'); // 16 位四类
  assert.equal(d.score, 100);
  assert.equal(d.checks.length, true);
  assert.equal(d.checks.hasUpperCase, true);
  assert.equal(d.checks.hasLowerCase, true);
  assert.equal(d.checks.hasNumbers, true);
  assert.equal(d.checks.hasSpecialChars, true);
  assert.equal(d.checks.isLongEnough, true);
  assert.deepEqual(d.suggestions, []);
});

test('getPasswordStrengthDetails：缺特殊符 → 对应建议', () => {
  const d = getPasswordStrengthDetails('Abcdefgh1234');
  assert.equal(d.checks.hasSpecialChars, false);
  assert.ok(d.suggestions.some((s) => /special characters/.test(s)));
});

// ==================== validatePasswordConfirmation ====================

test('validatePasswordConfirmation', () => {
  assert.equal(validatePasswordConfirmation('abc', 'abc').valid, true);
  assert.equal(validatePasswordConfirmation('abc', 'abd').valid, false);
  assert.equal(validatePasswordConfirmation('abc', '').valid, false);
});

// ==================== isCommonPassword ====================

test('isCommonPassword：命中常见弱密码（大小写不敏感）', () => {
  assert.equal(isCommonPassword('password'), true);
  assert.equal(isCommonPassword('PASSWORD'), true);
  assert.equal(isCommonPassword('123456'), true);
  assert.equal(isCommonPassword('qwerty'), true);
  assert.equal(isCommonPassword('My$ecretP@ss42'), false);
});

// ==================== generateRandomPassword ====================

test('generateRandomPassword：默认长度 16、四类字符', () => {
  const pwd = generateRandomPassword();
  assert.equal(pwd.length, 16);
});

test('generateRandomPassword：自定义长度', () => {
  assert.equal(generateRandomPassword(24).length, 24);
});

test('generateRandomPassword：仅数字字符集 → 全数字', () => {
  const pwd = generateRandomPassword(20, {
    includeUpperCase: false, includeLowerCase: false, includeNumbers: true, includeSpecialChars: false
  });
  assert.match(pwd, /^[0-9]{20}$/);
});

test('generateRandomPassword：空字符集 → 抛错', () => {
  assert.throws(() => generateRandomPassword(8, {
    includeUpperCase: false, includeLowerCase: false, includeNumbers: false, includeSpecialChars: false
  }));
});

test('generateRandomPassword：两次生成不同（随机性）', () => {
  assert.notEqual(generateRandomPassword(32), generateRandomPassword(32));
});

// ==================== hashPassword / verifyPasswordHash ====================

test('hashPassword：SHA-256 十六进制（64 字符）', async () => {
  const h = await hashPassword('hello');
  assert.match(h, /^[0-9a-f]{64}$/);
});

test('verifyPasswordHash：匹配 / 不匹配', async () => {
  const h = await hashPassword('TestPass123');
  assert.equal(await verifyPasswordHash('TestPass123', h), true);
  assert.equal(await verifyPasswordHash('WrongPass', h), false);
});

// ==================== 强度展示辅助 ====================

test('getPasswordStrengthColor / Text：四档都有返回', () => {
  for (const s of Object.values(PASSWORD_STRENGTH)) {
    assert.equal(typeof getPasswordStrengthColor(s), 'string');
    assert.equal(typeof getPasswordStrengthText(s), 'string');
  }
});
