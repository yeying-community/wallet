import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';

globalThis.crypto ||= webcrypto;

const {
  createWalletIdentity,
  canonicalizeIdentityDocument,
  generateIdentityKeyPair,
  verifyIdentityDocument,
  validateIdentityDocument
} = await import('../js/common/identity/identity-document.js');

test('createWalletIdentity creates a signed chain-independent identity', async () => {
  const identity = await createWalletIdentity({ now: new Date('2026-08-13T00:00:00.000Z') });
  assert.match(identity.document.id, /^did:yeying:wid_[A-Za-z0-9_-]+$/);
  assert.equal(identity.document.walletIdentityId.startsWith('wid_'), true);
  assert.equal(identity.document.controllers[0].algorithm, 'Ed25519');
  assert.equal(identity.document.recovery.manageThreshold, 1);
  assert.equal(identity.document.recovery.publicKey, identity.document.recovery.publicKey);
  assert.ok(identity.recoveryPrivateJwk);
  validateIdentityDocument(identity.document);
  const publicKey = await crypto.subtle.importKey('jwk', identity.publicJwk, { name: 'Ed25519' }, true, ['verify']);
  assert.equal(await verifyIdentityDocument(identity.document, publicKey), true);
});

test('identity document signature covers the unsigned document', async () => {
  const identity = await createWalletIdentity();
  const changed = { ...identity.document, revision: 2 };
  const publicKey = await crypto.subtle.importKey('jwk', identity.publicJwk, { name: 'Ed25519' }, true, ['verify']);
  assert.equal(await verifyIdentityDocument(changed, publicKey), false);
  assert.match(canonicalizeIdentityDocument(identity.document), /walletIdentityId/);
});

test('identity document rejects a missing manage controller or mismatched DID', async () => {
  const identity = await createWalletIdentity();
  assert.throws(() => validateIdentityDocument({ ...identity.document, id: 'did:yeying:wid_other' }), /DID mismatch/);
  const invalid = { ...identity.document, controllers: identity.document.controllers.map((item) => ({ ...item, purposes: ['assertion'] })) };
  assert.throws(() => validateIdentityDocument(invalid), /manage controller/);
});

test('identity key pair is Ed25519 and exportable for encrypted storage', async () => {
  const pair = await generateIdentityKeyPair();
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  assert.equal(privateJwk.crv, 'Ed25519');
  assert.equal(privateJwk.kty, 'OKP');
});
