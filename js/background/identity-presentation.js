import { getIdentity, getIdentityCredentials, decryptIdentityKeyMaterial } from '../storage/identity-storage.js';
import { getValue } from '../storage/storage-base.js';
import { IdentityStorageKeys } from '../storage/storage-keys.js';
import { createInvalidParams } from '../common/errors/index.js';

const METHOD = 'yeying_identity_presentation';
const ALLOWED_SCOPES = new Set(['identity.basic', 'identity.wallet', 'identity.username', 'identity.email']);

function normalizeRequest(params, origin) {
  const request = Array.isArray(params) ? params[0] : params;
  if (!request || typeof request !== 'object') throw createInvalidParams('Invalid identity presentation request');
  const scopes = [...new Set((Array.isArray(request.scopes) ? request.scopes : []).map(value => String(value || '').trim()).filter(Boolean))];
  if (scopes.length === 0 || scopes.some(scope => !ALLOWED_SCOPES.has(scope))) throw createInvalidParams('Invalid identity presentation scopes');
  if (!scopes.includes('identity.basic')) scopes.unshift('identity.basic');
  const appId = String(request.appId || '').trim();
  const audience = String(request.audience || origin || '').trim();
  const nonce = String(request.nonce || '').trim();
  if (!audience || !nonce) throw createInvalidParams('audience and nonce are required');
  return { ...request, appId, audience, nonce, scopes };
}

function canonicalize(value) {
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function scopeNeedsCredential(scope) {
  return scope === 'identity.email' || scope === 'identity.username';
}

function credentialTypeForScope(scope) {
  return scope === 'identity.email' ? 'EmailCredential' : 'UsernameCredential';
}

function decodeCredentialTypesFromJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return [];
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(`${normalized}${'='.repeat((4 - normalized.length % 4) % 4)}`));
    const types = payload?.vc?.type;
    return Array.isArray(types) ? types : (types ? [types] : []);
  } catch {
    return [];
  }
}

function credentialTypes(credential) {
  const types = credential?.payload?.vc?.type || credential?.type;
  const normalized = Array.isArray(types) ? [...types] : (types ? [types] : []);
  const jwt = credential?.credential || credential?.jwt || (typeof credential === 'string' ? credential : '');
  normalized.push(...decodeCredentialTypesFromJwt(jwt));
  return [...new Set(normalized)];
}

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function requestIdentityPresentation({ account, params, origin, password }) {
  const request = normalizeRequest(params, origin);
  const identityId = await getValue(IdentityStorageKeys.SELECTED_IDENTITY, null);
  if (!identityId) throw new Error('IDENTITY_NOT_SELECTED');
  const record = await getIdentity(identityId);
  if (!record?.document) throw new Error('IDENTITY_NOT_FOUND');
  const issuedAt = new Date().toISOString();
  const expiresAt = request.expiresAt || new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const credentials = await getIdentityCredentials(identityId);
  const selectedCredentials = credentials.filter((credential) => {
    const types = credentialTypes(credential);
    return request.scopes.some((scope) => scopeNeedsCredential(scope) && types.includes(credentialTypeForScope(scope)));
  });
  for (const scope of request.scopes) {
    if (scopeNeedsCredential(scope) && !selectedCredentials.some((credential) => {
      const types = credentialTypes(credential);
      return types.includes(credentialTypeForScope(scope));
    })) throw new Error(`IDENTITY_SCOPE_NOT_GRANTED:${scope}`);
  }
  const unsigned = { version: 1, holder: record.document.id, audience: request.audience, nonce: request.nonce, issuedAt, expiresAt, scopes: request.scopes, identityDocument: request.scopes.includes('identity.basic') ? record.document : undefined, walletProof: request.scopes.includes('identity.wallet') ? { chainKey: account.chainKey || `eip155:${account.chainId || 1}`, address: account.address } : undefined, credentials: selectedCredentials.map((credential) => credential.credential || credential.jwt || credential) };
  const keyMaterial = await decryptIdentityKeyMaterial(record, password);
  const privateKey = await crypto.subtle.importKey('jwk', keyMaterial.privateJwk, { name: 'Ed25519' }, false, ['sign']);
  const signature = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(canonicalize(unsigned)));
  return { ...unsigned, proof: { type: 'YeyingIdentityPresentationProofV1', verificationMethod: `${record.document.id}#${record.controllerId}`, purpose: 'authentication', proofValue: toBase64Url(new Uint8Array(signature)) } };
}

export { METHOD };
