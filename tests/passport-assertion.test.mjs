import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPassportLoginIntent,
  normalizePassportAssertionParams,
  normalizePassportAssertionScopes
} from '../js/background/passport-assertion.js';
import { PassportClient } from '../js/background/passport-client.js';

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: '', text: async () => JSON.stringify(data) };
}

test('Passport assertion scopes are normalized and require identity.basic', () => {
  assert.deepEqual(normalizePassportAssertionScopes(['identity.email', 'identity.email']), [
    'identity.basic',
    'identity.email'
  ]);
  assert.throws(
    () => normalizePassportAssertionScopes(['profile.email']),
    (error) => error?.message === 'Unsupported Passport scope: profile.email'
  );
});

test('Passport assertion params default audience to origin and derive appId from URL audience', () => {
  const params = normalizePassportAssertionParams([{ nonce: 'n-1', scopes: ['identity.email'] }], 'https://app.example');
  assert.equal(params.appId, 'app.example');
  assert.equal(params.audience, 'https://app.example');
  assert.equal(params.endpoint, '');
  assert.deepEqual(params.scopes, ['identity.basic', 'identity.email']);
});

test('Passport login intent contains app binding fields', () => {
  const message = buildPassportLoginIntent({
    origin: 'https://app.example',
    address: '0x1111111111111111111111111111111111111111',
    appId: 'community-app',
    audience: 'https://app.example',
    nonce: 'nonce-1',
    scopes: ['identity.basic', 'identity.wallet', 'identity.email'],
    statement: ''
  });
  assert.match(message, /community-app/);
  assert.match(message, /Nonce: nonce-1/);
  assert.match(message, /Scopes: identity.basic identity.wallet identity.email/);
});

test('PassportClient wallet assertion calls the public assertion route', async () => {
  const calls = [];
  const client = new PassportClient({
    endpoint: 'https://node.example',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ code: 0, data: { passportAssertion: 'jwt-1' } });
    }
  });

  assert.deepEqual(await client.createWalletAssertion({ address: '0xabc' }), { passportAssertion: 'jwt-1' });
  assert.equal(calls[0].url, 'https://node.example/api/v1/public/auth/passport/assertions/wallet');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, undefined);
});
