import assert from 'node:assert/strict';
import test from 'node:test';

import { credentialIsFresh, mergeCredentials, missingCredentialTypes, selectFreshCredentials } from '../js/background/identity-presentation.js';

function credential(payload) {
  return {
    credential: `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
  };
}

test('credential freshness rejects expired and near-expiry credentials', () => {
  const now = Date.parse('2026-08-25T00:00:00.000Z');

  assert.equal(credentialIsFresh(credential({ exp: now / 1000 - 1 }), now), false);
  assert.equal(credentialIsFresh(credential({ exp: now / 1000 + 30 }), now), false);
  assert.equal(credentialIsFresh(credential({ exp: now / 1000 + 300 }), now), true);
});

test('credential freshness rejects credentials that are not active yet', () => {
  const now = Date.parse('2026-08-25T00:00:00.000Z');

  assert.equal(credentialIsFresh(credential({ nbf: now / 1000 + 120, exp: now / 1000 + 300 }), now), false);
  assert.equal(credentialIsFresh(credential({ nbf: now / 1000 - 1, exp: now / 1000 + 300 }), now), true);
});

test('credential freshness rejects malformed credentials', () => {
  assert.equal(credentialIsFresh({ credential: 'not-a-jwt' }), false);
  assert.equal(credentialIsFresh({ credential: 'header.payload.signature' }), false);
  assert.equal(credentialIsFresh({}), false);
});

test('missing credential types only includes requested stale credentials', () => {
  const credentials = [
    { type: 'EmailCredential', credential: credential({ exp: 1 }).credential },
    { type: 'UsernameCredential', credential: credential({ exp: 9999999999 }).credential }
  ];
  const selected = selectFreshCredentials(credentials, ['identity.email', 'identity.username']);

  assert.deepEqual(missingCredentialTypes(selected, ['identity.email', 'identity.username']), ['EmailCredential']);
});

test('merge credentials replaces stale credentials by credential type', () => {
  const oldEmail = { type: 'EmailCredential', credential: credential({ vc: { type: ['VerifiableCredential', 'EmailCredential'] }, exp: 1 }).credential };
  const username = { type: 'UsernameCredential', credential: credential({ vc: { type: ['VerifiableCredential', 'UsernameCredential'] }, exp: 1 }).credential };
  const newEmail = { type: 'EmailCredential', credential: credential({ vc: { type: ['VerifiableCredential', 'EmailCredential'] }, exp: 2 }).credential };

  assert.deepEqual(mergeCredentials([oldEmail, username], [newEmail]), [username, newEmail]);
});
