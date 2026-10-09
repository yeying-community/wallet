/**
 * crypto 层单测（零依赖，使用 node 内置 test runner）
 * 运行：node --test --test-force-exit "tests/*.test.mjs"
 *
 * 覆盖：PBKDF2 + AES-GCM 加解密往返、错误密码拒绝、随机 salt/iv 不可预测性、
 *       密文篡改检测、对象/批量加解密、密码校验。
 * 这些路径直接关系到私钥/助记词的机密性，属于资产安全关键路径。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

globalThis.crypto ||= webcrypto;

import {
  encryptString,
  decryptString,
  encryptObject,
  decryptObject,
  encryptBatch,
  decryptBatch,
  validatePassword,
  PBKDF2_CONFIG,
  AES_GCM_CONFIG
} from '../js/common/crypto/index.js';

const PASSWORD = 'Correct-Horse-9';
const WRONG_PASSWORD = 'Correct-Horse-8';

async function legacyEncrypt(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const passwordKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, passwordKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return Buffer.concat([Buffer.from(salt), Buffer.from(iv), Buffer.from(encrypted)]).toString('base64');
}

test('encryptString/decryptString 往返还原明文', async () => {
  const plaintext = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
  const encrypted = await encryptString(plaintext, PASSWORD);
  assert.equal(typeof encrypted, 'string');
  assert.notEqual(encrypted, plaintext, '密文不应等于明文');
  assert.match(encrypted, /^v2\./, '新密文必须携带 KDF 格式版本');

  const decrypted = await decryptString(encrypted, PASSWORD);
  assert.equal(decrypted, plaintext);
});

test('旧版无版本前缀密文仍可用历史 KDF 参数解密', async () => {
  const encrypted = await legacyEncrypt('legacy-secret', PASSWORD);
  assert.equal(await decryptString(encrypted, PASSWORD), 'legacy-secret');
});

test('错误密码必须解密失败（不得静默返回错误明文）', async () => {
  const encrypted = await encryptString('sensitive', PASSWORD);
  await assert.rejects(
    () => decryptString(encrypted, WRONG_PASSWORD),
    '错误密码应抛出错误而非返回乱码'
  );
});

test('相同明文+相同密码两次加密产生不同密文（随机 salt/iv）', async () => {
  const a = await encryptString('same-secret', PASSWORD);
  const b = await encryptString('same-secret', PASSWORD);
  assert.notEqual(a, b, 'salt/iv 随机化应保证密文不可预测');

  // 但两者都能正确还原
  assert.equal(await decryptString(a, PASSWORD), 'same-secret');
  assert.equal(await decryptString(b, PASSWORD), 'same-secret');
});

test('密文被篡改后解密失败（AES-GCM 完整性校验）', async () => {
  const encrypted = await encryptString('integrity-check', PASSWORD);
  // 翻转 base64 末尾一个字符，破坏 GCM tag
  const lastChar = encrypted.at(-1);
  const tampered = encrypted.slice(0, -1) + (lastChar === 'A' ? 'B' : 'A');
  await assert.rejects(
    () => decryptString(tampered, PASSWORD),
    '篡改密文应被 GCM 认证标签拒绝'
  );
});

test('Unicode 与长文本往返保持字节正确', async () => {
  const plaintext = '助记词 mnemonic 🐦 ' + 'x'.repeat(5000);
  const encrypted = await encryptString(plaintext, PASSWORD);
  assert.equal(await decryptString(encrypted, PASSWORD), plaintext);
});

test('encryptObject/decryptObject 往返保持结构', async () => {
  const obj = {
    id: 'wallet_1',
    accounts: [{ index: 0, address: '0xabc' }, { index: 1, address: '0xdef' }],
    nested: { enabled: true, count: 3 }
  };
  const encrypted = await encryptObject(obj, PASSWORD);
  const decrypted = await decryptObject(encrypted, PASSWORD);
  assert.deepEqual(decrypted, obj);
});

test('encryptBatch/decryptBatch 按序往返', async () => {
  const texts = ['a', 'b', 'c', '0x01'];
  const encrypted = await encryptBatch(texts, PASSWORD);
  assert.equal(encrypted.length, texts.length);
  const decrypted = await decryptBatch(encrypted, PASSWORD);
  assert.deepEqual(decrypted, texts);
});

test('空字符串或非字符串输入应被拒绝', async () => {
  await assert.rejects(() => encryptString('', PASSWORD));
  await assert.rejects(() => encryptString(null, PASSWORD));
  await assert.rejects(() => encryptString('ok', ''));
});

test('validatePassword 拒绝过短密码、接受合规密码', () => {
  const weak = validatePassword('123');
  assert.equal(weak.valid, false);
  assert.match(weak.error, /at least|8/i);

  const ok = validatePassword(PASSWORD);
  assert.equal(ok.valid, true);
});

test('新加密参数为 PBKDF2 210k + AES-256-GCM，并保留旧参数标识', () => {
  assert.equal(PBKDF2_CONFIG.iterations, 210000);
  assert.equal(PBKDF2_CONFIG.legacyIterations, 100000);
  assert.equal(PBKDF2_CONFIG.hash, 'SHA-256');
  assert.equal(AES_GCM_CONFIG.length, 256);
  assert.equal(AES_GCM_CONFIG.ivLength, 12);
});
