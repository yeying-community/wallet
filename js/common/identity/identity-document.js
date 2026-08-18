import { base64Encode, base64Decode, stringToBytes } from '../crypto/crypto-utils.js';

const DID_METHOD = 'did:yeying';
const IDENTITY_PREFIX = 'wid_';
const MIN_RANDOM_BYTES = 16;

function assertWebCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error('WebCrypto not available');
}

function encodeBase64Url(bytes) {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function canonicalize(value) {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JCS does not allow non-finite numbers');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value !== 'object') throw new Error('JCS does not allow undefined or unsupported values');
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function identityIdToDid(walletIdentityId) {
  const id = String(walletIdentityId || '').trim();
  if (!new RegExp(`^${IDENTITY_PREFIX}[A-Za-z0-9_-]{22,}$`).test(id)) throw new Error('Invalid wallet identity id');
  return `${DID_METHOD}:${id}`;
}

function createController({ controllerId, publicKey }) {
  return {
    controllerId,
    kind: 'wallet_key',
    publicKey,
    algorithm: 'Ed25519',
    purposes: ['authentication', 'assertion', 'manage'],
    status: 'active',
    addedAt: new Date().toISOString()
  };
}

export async function generateIdentityKeyPair() {
  assertWebCrypto();
  return globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
}

export async function exportIdentityKeyPair(keyPair) {
  assertWebCrypto();
  const [publicJwk, privateJwk, rawPublic] = await Promise.all([
    globalThis.crypto.subtle.exportKey('jwk', keyPair.publicKey),
    globalThis.crypto.subtle.exportKey('jwk', keyPair.privateKey),
    globalThis.crypto.subtle.exportKey('raw', keyPair.publicKey)
  ]);
  return { publicJwk, privateJwk, publicKey: encodeBase64Url(new Uint8Array(rawPublic)) };
}

export function canonicalizeIdentityDocument(document) {
  const { proof, ...unsigned } = document || {};
  return canonicalize(unsigned);
}

export async function signIdentityDocument(document, privateKey, proof = {}) {
  assertWebCrypto();
  const signature = await globalThis.crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    stringToBytes(canonicalizeIdentityDocument(document))
  );
  return {
    ...document,
    proof: {
      type: 'YeyingIdentityDocumentProofV1',
      created: proof.created || new Date().toISOString(),
      verificationMethod: proof.verificationMethod,
      purpose: proof.purpose || 'assertionMethod',
      proofValue: encodeBase64Url(new Uint8Array(signature))
    }
  };
}

export async function verifyIdentityDocument(document, publicKey) {
  assertWebCrypto();
  const proof = document?.proof;
  if (!proof?.proofValue || proof.type !== 'YeyingIdentityDocumentProofV1') return false;
  return globalThis.crypto.subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    base64Decode(`${proof.proofValue.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat((4 - proof.proofValue.length % 4) % 4)}`),
    stringToBytes(canonicalizeIdentityDocument(document))
  );
}

export async function createWalletIdentity({ now = new Date() } = {}) {
  assertWebCrypto();
  const random = new Uint8Array(MIN_RANDOM_BYTES);
  globalThis.crypto.getRandomValues(random);
  const walletIdentityId = `${IDENTITY_PREFIX}${encodeBase64Url(random)}`;
  const did = identityIdToDid(walletIdentityId);
  const keyPair = await generateIdentityKeyPair();
  const recoveryKeyPair = await generateIdentityKeyPair();
  const exported = await exportIdentityKeyPair(keyPair);
  const recovery = await exportIdentityKeyPair(recoveryKeyPair);
  const controllerId = 'controller-1';
  const createdAt = now.toISOString();
  const document = {
    version: 1,
    id: did,
    walletIdentityId,
    createdAt,
    updatedAt: createdAt,
    revision: 1,
    controllers: [createController({ controllerId, publicKey: exported.publicKey })],
    accounts: [],
    issuers: [],
    recovery: {
      version: 1,
      manageThreshold: 1,
      controllerChangeDelaySeconds: 86400,
      publicKey: recovery.publicKey,
      algorithm: 'Ed25519'
    }
  };
  const signedDocument = await signIdentityDocument(document, keyPair.privateKey, {
    verificationMethod: `${did}#${controllerId}`,
    purpose: 'assertionMethod'
  });
  return {
    document: signedDocument,
    controllerId,
    publicJwk: exported.publicJwk,
    privateJwk: exported.privateJwk,
    recoveryPublicJwk: recovery.publicJwk,
    recoveryPrivateJwk: recovery.privateJwk
  };
}

export function validateIdentityDocument(document) {
  if (!document || document.version !== 1 || typeof document.id !== 'string' || !document.id.startsWith(`${DID_METHOD}:`)) {
    throw new Error('Invalid identity document');
  }
  if (document.id !== identityIdToDid(document.walletIdentityId)) throw new Error('Identity DID mismatch');
  if (!Number.isInteger(document.revision) || document.revision < 1) throw new Error('Invalid identity revision');
  if (!Array.isArray(document.controllers) || !document.controllers.some((item) => item.status === 'active' && item.purposes?.includes('manage'))) {
    throw new Error('Identity requires an active manage controller');
  }
  return true;
}

export { DID_METHOD, IDENTITY_PREFIX, canonicalize };
