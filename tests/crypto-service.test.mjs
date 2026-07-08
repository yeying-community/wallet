import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleYeyingEncrypt,
  handleYeyingDecrypt
} from '../js/background/operations/crypto-service.js';
import { resetState, state } from '../js/background/state.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const TEST_ACCOUNT = {
  id: 'wallet-derived-account',
  address: '0x084a6171f6ecf0a4c8fa1c88ce53cf725a23e630'
};

const TEST_PRIVATE_KEY = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function matchesErrorMessage(pattern) {
  return (error) => pattern.test(String(error?.message || error));
}

function unlockTestAccount() {
  state.keyring = new Map([
    [TEST_ACCOUNT.id, { privateKey: TEST_PRIVATE_KEY }]
  ]);
}

async function decryptText(ciphertext, options) {
  const result = await handleYeyingDecrypt('https://warehouse.local', TEST_ACCOUNT, [{
    ciphertext,
    ...options
  }]);
  assert.equal(result.encoding, 'base64');
  return decoder.decode(Buffer.from(result.plaintext, 'base64'));
}

test('yeying_encrypt/decrypt manual password remains compatible', async () => {
  resetState();
  unlockTestAccount();

  const encrypted = await handleYeyingEncrypt('https://warehouse.local', TEST_ACCOUNT, [{
    data: 'manual-secret',
    password: 'directory-pass',
    passwordSource: 'manual'
  }]);

  assert.equal(encrypted.passwordSource, 'manual');
  assert.ok(encrypted.ciphertext.startsWith('v1:aes-256-gcm:'));
  assert.equal(
    await decryptText(encrypted.ciphertext, { password: 'directory-pass', passwordSource: 'manual' }),
    'manual-secret'
  );
});

test('yeying_encrypt manual source requires password', async () => {
  resetState();
  unlockTestAccount();

  await assert.rejects(
    () => handleYeyingEncrypt('https://warehouse.local', TEST_ACCOUNT, [{
      data: 'missing-password',
      passwordSource: 'manual'
    }]),
    matchesErrorMessage(/password is required/)
  );
});

test('yeying_encrypt/decrypt can derive password from wallet key', async () => {
  resetState();
  unlockTestAccount();

  const encrypted = await handleYeyingEncrypt('https://warehouse.local', TEST_ACCOUNT, [{
    data: encoder.encode('wallet-secret'),
    passwordSource: 'wallet',
    passwordContext: '/personal/secure'
  }]);

  assert.equal(encrypted.passwordSource, 'wallet');
  assert.equal(
    await decryptText(encrypted.ciphertext, {
      passwordSource: 'wallet',
      passwordContext: '/personal/secure'
    }),
    'wallet-secret'
  );
});

test('wallet-derived password is bound to passwordContext', async () => {
  resetState();
  unlockTestAccount();

  const encrypted = await handleYeyingEncrypt('https://warehouse.local', TEST_ACCOUNT, [{
    data: 'context-secret',
    passwordSource: 'wallet',
    passwordContext: '/personal/secure-a'
  }]);

  await assert.rejects(
    () => decryptText(encrypted.ciphertext, {
      passwordSource: 'wallet',
      passwordContext: '/personal/secure-b'
    }),
    matchesErrorMessage(/decrypt|auth|unsupported|invalid|failed/i)
  );
});

test('wallet+password requires extra password and verifies it', async () => {
  resetState();
  unlockTestAccount();

  const encrypted = await handleYeyingEncrypt('https://warehouse.local', TEST_ACCOUNT, [{
    data: 'wallet-plus-password-secret',
    password: 'extra-pass',
    passwordSource: 'wallet+password',
    passwordContext: '/personal/high-security'
  }]);

  assert.equal(encrypted.passwordSource, 'wallet+password');
  assert.equal(
    await decryptText(encrypted.ciphertext, {
      password: 'extra-pass',
      passwordSource: 'wallet+password',
      passwordContext: '/personal/high-security'
    }),
    'wallet-plus-password-secret'
  );

  await assert.rejects(
    () => decryptText(encrypted.ciphertext, {
      password: 'wrong-extra-pass',
      passwordSource: 'wallet+password',
      passwordContext: '/personal/high-security'
    }),
    matchesErrorMessage(/decrypt|auth|unsupported|invalid|failed/i)
  );
});

test('wallet+password source requires extra password', async () => {
  resetState();
  unlockTestAccount();

  await assert.rejects(
    () => handleYeyingEncrypt('https://warehouse.local', TEST_ACCOUNT, [{
      data: 'missing-extra-password',
      passwordSource: 'wallet+password',
      passwordContext: '/personal/secure'
    }]),
    matchesErrorMessage(/password is required/)
  );
});
