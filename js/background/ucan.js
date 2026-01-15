/**
 * YeYing Wallet - UCAN session & signing (background)
 * 负责：为已授权站点生成 UCAN Session Key，并提供签名能力
 */

import { createInvalidParams, createInternalError } from '../common/errors/index.js';
import { getMapItem, setMapItem, deleteMapItem, UcanStorageKeys } from '../storage/index.js';

const DEFAULT_SESSION_ID = 'default';
const DEFAULT_SESSION_TTL = 24 * 60 * 60 * 1000;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const textEncoder = new TextEncoder();

function toBase64Url(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base58Encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  const encoded = [];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < encoded.length; j += 1) {
      carry += encoded[j] << 8;
      encoded[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      encoded.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let output = '';
  for (let i = 0; i < zeros; i += 1) output += '1';
  for (let i = encoded.length - 1; i >= 0; i -= 1) {
    output += BASE58_ALPHABET[encoded[i]];
  }
  return output;
}

function toDidKey(publicKeyRaw) {
  const prefix = new Uint8Array([0xed, 0x01]);
  const combined = new Uint8Array(prefix.length + publicKeyRaw.length);
  combined.set(prefix, 0);
  combined.set(publicKeyRaw, prefix.length);
  return `did:key:z${base58Encode(combined)}`;
}

function normalizeExpiry(expiresInMs) {
  const ttl = typeof expiresInMs === 'number' && !Number.isNaN(expiresInMs)
    ? expiresInMs
    : DEFAULT_SESSION_TTL;
  return Date.now() + ttl;
}

function getSessionKey(origin, address, sessionId) {
  const id = sessionId || DEFAULT_SESSION_ID;
  return `${origin || 'unknown'}::${address || 'unknown'}::${id}`;
}

async function loadSessionRecord(origin, address, sessionId) {
  const key = getSessionKey(origin, address, sessionId);
  const record = await getMapItem(UcanStorageKeys.UCAN_SESSIONS, key);
  if (!record) return null;
  if (record.expiresAt && Date.now() > record.expiresAt) {
    await deleteMapItem(UcanStorageKeys.UCAN_SESSIONS, key);
    return null;
  }
  return record;
}

async function createSessionRecord(origin, address, sessionId, expiresInMs) {
  if (!crypto?.subtle) {
    throw createInternalError('WebCrypto not available');
  }
  const keys = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  );
  const [publicJwk, privateJwk, rawPublic] = await Promise.all([
    crypto.subtle.exportKey('jwk', keys.publicKey),
    crypto.subtle.exportKey('jwk', keys.privateKey),
    crypto.subtle.exportKey('raw', keys.publicKey)
  ]);
  const did = toDidKey(new Uint8Array(rawPublic));
  const now = Date.now();
  const record = {
    id: sessionId || DEFAULT_SESSION_ID,
    origin,
    address,
    did,
    publicJwk,
    privateJwk,
    createdAt: now,
    expiresAt: normalizeExpiry(expiresInMs)
  };
  const key = getSessionKey(origin, address, sessionId);
  await setMapItem(UcanStorageKeys.UCAN_SESSIONS, key, record);
  return record;
}

async function ensureSessionRecord(origin, address, options = {}) {
  const sessionId = options.sessionId || DEFAULT_SESSION_ID;
  if (!options.forceNew) {
    const existing = await loadSessionRecord(origin, address, sessionId);
    if (existing) return existing;
  }
  return createSessionRecord(origin, address, sessionId, options.expiresInMs);
}

async function signWithRecord(record, signingInput) {
  if (!record?.privateJwk) {
    throw createInternalError('Missing UCAN private key');
  }
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    record.privateJwk,
    { name: 'Ed25519' },
    false,
    ['sign']
  );
  const data = textEncoder.encode(signingInput);
  const signature = await crypto.subtle.sign('Ed25519', privateKey, data);
  return toBase64Url(signature);
}

export async function handleUcanSession(origin, account, params) {
  const options = Array.isArray(params) ? params[0] || {} : params || {};
  const record = await ensureSessionRecord(origin, account.address, options);
  return {
    id: record.id,
    did: record.did,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt
  };
}

export async function handleUcanSign(origin, account, params) {
  const options = Array.isArray(params) ? params[0] || {} : params || {};
  const signingInput = options?.signingInput;
  if (!signingInput || typeof signingInput !== 'string') {
    throw createInvalidParams('signingInput is required');
  }
  const record = await ensureSessionRecord(origin, account.address, options);
  const iss = options?.payload?.iss;
  if (iss && iss !== record.did) {
    throw createInvalidParams('UCAN issuer mismatch');
  }
  const signature = await signWithRecord(record, signingInput);
  return { signature };
}
