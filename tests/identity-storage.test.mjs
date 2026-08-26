import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';

globalThis.crypto ||= webcrypto;
const data = {};
globalThis.chrome = {
  storage: { local: {
    async get(key) { return key === null ? { ...data } : { [key]: data[key] }; },
    async set(values) { Object.assign(data, values); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) delete data[key]; }
  } }
};

const { createWalletIdentity } = await import('../js/common/identity/identity-document.js');
const storage = await import('../js/storage/identity-storage.js');
const { setValue } = await import('../js/storage/storage-base.js');
const { IdentityStorageKeys } = await import('../js/storage/storage-keys.js');
const { requestIdentityPresentation } = await import('../js/background/identity-presentation.js');
const { cachePassword, clearPasswordCache } = await import('../js/background/password-cache.js');

test('identity private material is encrypted at rest', async () => {
  for (const key of Object.keys(data)) delete data[key];
  const identity = await createWalletIdentity();
  const id = identity.document.walletIdentityId;
  await storage.saveEncryptedIdentity(id, identity, 'correct horse battery staple');
  const saved = await storage.getIdentity(id);
  assert.equal(saved.privateJwk, undefined);
  assert.equal(saved.recoveryPrivateJwk, undefined);
  assert.ok(saved.encryptedKeyMaterial);
  const material = await storage.decryptIdentityKeyMaterial(saved, 'correct horse battery staple');
  assert.equal(material.privateJwk.d, identity.privateJwk.d);
  assert.equal(material.recoveryPrivateJwk.d, identity.recoveryPrivateJwk.d);
  await assert.rejects(() => storage.decryptIdentityKeyMaterial(saved, 'wrong password'));
});

test('identities are independently addressable', async () => {
  for (const key of Object.keys(data)) delete data[key];
  const first = await createWalletIdentity();
  const second = await createWalletIdentity();
  await storage.saveEncryptedIdentity(first.document.walletIdentityId, first, 'password-one');
  await storage.saveEncryptedIdentity(second.document.walletIdentityId, second, 'password-two');
  assert.equal(Object.keys(await storage.getIdentities()).length, 2);
  assert.equal((await storage.getIdentity(first.document.walletIdentityId)).document.id, first.document.id);
});

test('identity presentation reuses cached wallet password', async () => {
  for (const key of Object.keys(data)) delete data[key];
  clearPasswordCache();
  const identity = await createWalletIdentity();
  const id = identity.document.walletIdentityId;
  await storage.saveEncryptedIdentity(id, identity, 'cached-password');
  await setValue(IdentityStorageKeys.SELECTED_IDENTITY, id);
  cachePassword('cached-password');

  const presentation = await requestIdentityPresentation({
    account: {
      address: '0x1111111111111111111111111111111111111111',
      chainId: 1,
    },
    params: {
      audience: 'https://chat.example',
      nonce: 'nonce-1',
      scopes: ['identity.basic'],
    },
    origin: 'https://chat.example',
  });

  assert.equal(presentation.holder, identity.document.id);
  assert.equal(presentation.audience, 'https://chat.example');
  assert.equal(presentation.nonce, 'nonce-1');
  assert.equal(presentation.proof.type, 'YeyingIdentityPresentationProofV1');
  clearPasswordCache();
});

test('identity presentation reports missing email credential explicitly', async () => {
  for (const key of Object.keys(data)) delete data[key];
  clearPasswordCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    json: async () => ({ message: 'not verified' })
  });

  try {
    const identity = await createWalletIdentity();
    const id = identity.document.walletIdentityId;
    await storage.saveEncryptedIdentity(id, identity, 'cached-password');
    await setValue(IdentityStorageKeys.SELECTED_IDENTITY, id);
    cachePassword('cached-password');

    await assert.rejects(
      () => requestIdentityPresentation({
        account: {
          address: '0x1111111111111111111111111111111111111111',
          chainId: 1,
        },
        params: {
          audience: 'https://chat.example',
          nonce: 'nonce-1',
          scopes: ['identity.basic', 'identity.email'],
        },
        origin: 'https://chat.example',
      }),
      error => error?.message === 'IDENTITY_EMAIL_NOT_VERIFIED'
    );
  } finally {
    globalThis.fetch = originalFetch;
    clearPasswordCache();
  }
});
