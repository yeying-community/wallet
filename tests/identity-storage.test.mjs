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
const { requestIdentityPresentation, refreshIdentityCredentialsAfterRestore } = await import('../js/background/identity-presentation.js');
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

test('custody restore reissues missing profile credentials using the existing signed protocol', async () => {
  for (const key of Object.keys(data)) delete data[key];
  const originalFetch = globalThis.fetch;
  const calls = [];
  const identity = await createWalletIdentity();
  const id = identity.document.walletIdentityId;
  const issuer = 'did:web:localhost:8100';
  const issuerEndpoint = 'http://localhost:8100';
  const issuerKeys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const issuerJwk = await crypto.subtle.exportKey('jwk', issuerKeys.publicKey);
  issuerJwk.kid = 'issuer-key-1';
  issuerJwk.alg = 'EdDSA';
  issuerJwk.use = 'sig';
  const issueCredential = async (type, credentialId) => {
    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: 'issuer-key-1' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: issuer,
      sub: identity.document.id,
      iat: Math.floor(Date.now() / 1000),
      nbf: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: credentialId,
      vc: { type: ['VerifiableCredential', type], credentialSubject: { id: identity.document.id, credentialStatus: { id: credentialId, type: 'YeyingCredentialStatusV1' } } }
    })).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const signature = await crypto.subtle.sign('Ed25519', issuerKeys.privateKey, new TextEncoder().encode(signingInput));
    return `${signingInput}.${Buffer.from(signature).toString('base64url')}`;
  };
  await storage.saveEncryptedIdentity(id, identity, 'restore-password');
  const walletCredential = await issueCredential('WalletAccountCredential', 'urn:test:wallet-account');
  await storage.saveIdentityCredentials(id, [{ type: 'WalletAccountCredential', credential: walletCredential }]);
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : undefined });
    if (String(url).endsWith('/.well-known/openid-credential-issuer')) {
      return { ok: true, json: async () => ({ issuer, jwks_uri: `${issuerEndpoint}/.well-known/jwks.json` }) };
    }
    if (String(url).endsWith('/.well-known/jwks.json')) {
      return { ok: true, json: async () => ({ keys: [issuerJwk] }) };
    }
    if (String(url).endsWith('/credentials/reissue/challenge')) {
      const issuedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const proofPayload = {
        purpose: 'identity-credential-reissue',
        challengeId: 'icr_restore',
        identity: identity.document.id,
        credentialTypes: ['EmailCredential', 'UsernameCredential', 'AvatarCredential'],
        nonce: '0123456789abcdefghijklmnopqrstuv',
        issuedAt,
        expiresAt,
      };
      const canonicalize = value => value && typeof value === 'object'
        ? Array.isArray(value) ? `[${value.map(canonicalize).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`
        : JSON.stringify(value);
      return { ok: true, json: async () => ({ code: 0, data: {
        challengeId: 'icr_restore',
        identity: identity.document.id,
        credentialTypes: proofPayload.credentialTypes,
        nonce: proofPayload.nonce,
        issuedAt,
        expiresAt,
        signingInput: canonicalize(proofPayload),
        proofPayload
      } }) };
    }
    const types = ['EmailCredential', 'UsernameCredential', 'AvatarCredential'];
    return { ok: true, json: async () => ({ code: 0, data: {
      identity: identity.document.id,
      credentialTypes: types,
      credentials: await Promise.all(types.map(async type => ({
        type,
        credentialId: `urn:test:${type}`,
        credential: await issueCredential(type, `urn:test:${type}`)
      })))
    } }) };
  };

  try {
    const result = await refreshIdentityCredentialsAfterRestore({
      identityId: id,
      password: 'restore-password',
      issuerEndpoint: 'https://attacker.invalid'
    });
    const restored = await storage.getIdentityCredentials(id);
    assert.deepEqual(result.refreshed, ['EmailCredential', 'UsernameCredential', 'AvatarCredential']);
    assert.equal(calls.length, 4);
    assert.equal(calls[0].url, `${issuerEndpoint}/.well-known/openid-credential-issuer`);
    assert.equal(calls[1].url, `${issuerEndpoint}/.well-known/jwks.json`);
    assert.deepEqual(calls[2].body.credentialTypes, ['EmailCredential', 'UsernameCredential', 'AvatarCredential']);
    assert.equal(calls[3].body.proof.type, 'YeyingCredentialReissueProofV1');
    assert.deepEqual(restored.map(item => item.type).sort(), ['AvatarCredential', 'EmailCredential', 'UsernameCredential', 'WalletAccountCredential']);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
