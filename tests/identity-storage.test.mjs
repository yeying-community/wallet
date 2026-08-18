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
