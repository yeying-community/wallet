/**
 * MPC crypto helpers (device keys + E2E envelope).
 */

import { base64Encode, base64Decode, generateIV, stringToBytes, bytesToString } from '../common/crypto/crypto-utils.js';

export const MPC_SIGNING_ALG = 'Ed25519';
export const MPC_E2E_ALG = 'X25519';
export const MPC_E2E_SUITE = 'x25519-aes-gcm';

function ensureWebCrypto() {
  if (!crypto?.subtle) {
    throw new Error('WebCrypto not available');
  }
}

export function formatKeyWithPrefix(prefix, value) {
  if (!value) return '';
  const normalized = String(value);
  if (normalized.includes(':')) {
    return normalized;
  }
  return `${prefix}:${normalized}`;
}

export function stripKeyPrefix(value, expectedPrefix) {
  if (!value) return '';
  const normalized = String(value);
  const parts = normalized.split(':');
  if (parts.length >= 2) {
    const prefix = parts[0];
    const data = parts.slice(1).join(':');
    if (!expectedPrefix || prefix === expectedPrefix) {
      return data;
    }
  }
  return normalized;
}

export async function generateSigningKeyPair() {
  ensureWebCrypto();
  return crypto.subtle.generateKey(
    { name: MPC_SIGNING_ALG },
    true,
    ['sign', 'verify']
  );
}

export async function generateE2eKeyPair() {
  ensureWebCrypto();
  return crypto.subtle.generateKey(
    { name: MPC_E2E_ALG },
    true,
    ['deriveKey']
  );
}

export async function exportPublicKeyRawBase64(key) {
  ensureWebCrypto();
  const raw = await crypto.subtle.exportKey('raw', key);
  return base64Encode(new Uint8Array(raw));
}

export async function exportPrivateKeyJwk(key) {
  ensureWebCrypto();
  return crypto.subtle.exportKey('jwk', key);
}

export async function importPrivateKeyJwk(jwk, algorithm, usages) {
  ensureWebCrypto();
  return crypto.subtle.importKey('jwk', jwk, { name: algorithm }, false, usages);
}

export async function importPublicKeyRawBase64(value, algorithm, usages = []) {
  ensureWebCrypto();
  const raw = base64Decode(value);
  return crypto.subtle.importKey('raw', raw, { name: algorithm }, true, usages);
}

export async function signPayload(privateKey, payloadString) {
  ensureWebCrypto();
  const data = stringToBytes(payloadString);
  const signature = await crypto.subtle.sign(MPC_SIGNING_ALG, privateKey, data);
  return base64Encode(new Uint8Array(signature));
}

export async function verifyPayload(publicKey, payloadString, signatureBase64) {
  ensureWebCrypto();
  if (!signatureBase64) return false;
  const data = stringToBytes(payloadString);
  const signature = base64Decode(signatureBase64);
  return crypto.subtle.verify(MPC_SIGNING_ALG, publicKey, signature, data);
}

async function deriveSharedKey(privateKey, publicKey) {
  ensureWebCrypto();
  return crypto.subtle.deriveKey(
    { name: MPC_E2E_ALG, public: publicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function buildSigningInput(envelope) {
  const payload = {
    enc: envelope.enc,
    senderPubKey: envelope.senderPubKey,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext
  };
  return JSON.stringify(payload);
}

export async function encryptEnvelope({
  payload,
  senderSigningKey,
  senderE2ePrivateKey,
  senderE2ePublicKey,
  recipientE2ePublicKey
}) {
  if (!senderSigningKey || !senderE2ePrivateKey || !recipientE2ePublicKey || !senderE2ePublicKey) {
    throw new Error('Missing E2E keys');
  }
  const normalizedSenderPubKey = senderE2ePublicKey;
  const normalizedRecipientPubKey = recipientE2ePublicKey;
  const recipientKey = await importPublicKeyRawBase64(
    stripKeyPrefix(normalizedRecipientPubKey, 'x25519'),
    MPC_E2E_ALG
  );
  const sharedKey = await deriveSharedKey(senderE2ePrivateKey, recipientKey);
  const iv = generateIV();
  const plainText = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    stringToBytes(plainText)
  );
  const envelope = {
    enc: MPC_E2E_SUITE,
    senderPubKey: normalizedSenderPubKey,
    nonce: base64Encode(iv),
    ciphertext: base64Encode(new Uint8Array(cipherBuffer))
  };
  envelope.signature = await signPayload(senderSigningKey, buildSigningInput(envelope));
  return envelope;
}

export async function decryptEnvelope({
  envelope,
  recipientE2ePrivateKey,
  senderE2ePublicKey,
  senderSigningPublicKey,
  parseJson = true
}) {
  if (!envelope || !recipientE2ePrivateKey) {
    throw new Error('Missing envelope or keys');
  }
  if (senderSigningPublicKey) {
    const valid = await verifyPayload(
      senderSigningPublicKey,
      buildSigningInput(envelope),
      envelope.signature
    );
    if (!valid) {
      throw new Error('Invalid envelope signature');
    }
  }
  const senderPubKey = senderE2ePublicKey || envelope.senderPubKey;
  const normalizedSenderPubKey = stripKeyPrefix(senderPubKey, 'x25519');
  const senderKey = await importPublicKeyRawBase64(normalizedSenderPubKey, MPC_E2E_ALG);
  const sharedKey = await deriveSharedKey(recipientE2ePrivateKey, senderKey);
  const iv = base64Decode(envelope.nonce);
  const ciphertext = base64Decode(envelope.ciphertext);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    ciphertext
  );
  const plainText = bytesToString(new Uint8Array(plainBuffer));
  if (!parseJson) {
    return { payload: plainText, plaintext: plainText };
  }
  try {
    return { payload: JSON.parse(plainText), plaintext: plainText };
  } catch (error) {
    return { payload: plainText, plaintext: plainText };
  }
}
