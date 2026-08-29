import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const expectedMethods = [
  'wallet_ucan_session',
  'wallet_ucan_sign',
  'wallet_encrypt',
  'wallet_decrypt',
  'wallet_getCipherSuites'
];

test('Wallet router exposes the generic wallet RPC method names only', async () => {
  const source = await readFile(new URL('../js/background/request-router.js', import.meta.url), 'utf8');
  for (const method of expectedMethods) {
    assert.match(source, new RegExp(`['"]${method}['"]`), `${method} is missing from the Wallet router`);
  }
  assert.doesNotMatch(source, /['"]yeying_[A-Za-z0-9_]+['"]/);
});
