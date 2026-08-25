import { getIdentity, getIdentityCredentials, saveIdentityCredentials, decryptIdentityKeyMaterial } from '../storage/identity-storage.js';
import { getValue } from '../storage/storage-base.js';
import { IdentityStorageKeys } from '../storage/storage-keys.js';
import { createInvalidParams } from '../common/errors/index.js';
import { signIdentityDocument } from '../common/identity/identity-document.js';

const METHOD = 'yeying_identity_presentation';
const ALLOWED_SCOPES = new Set(['identity.basic', 'identity.wallet', 'identity.username', 'identity.email', 'identity.avatar']);
const CREDENTIAL_CLOCK_SKEW_MS = 60 * 1000;

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
  return scope === 'identity.email' || scope === 'identity.username' || scope === 'identity.avatar';
}

function credentialTypeForScope(scope) {
  if (scope === 'identity.email') return 'EmailCredential';
  if (scope === 'identity.username') return 'UsernameCredential';
  return 'AvatarCredential';
}

function decodeCredentialPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(`${normalized}${'='.repeat((4 - normalized.length % 4) % 4)}`));
  } catch {
    return null;
  }
}

function decodeCredentialTypesFromJwt(token) {
  const types = decodeCredentialPayload(token)?.vc?.type;
  return Array.isArray(types) ? types : (types ? [types] : []);
}

function credentialTypes(credential) {
  const types = credential?.payload?.vc?.type || credential?.type;
  const normalized = Array.isArray(types) ? [...types] : (types ? [types] : []);
  const jwt = credential?.credential || credential?.jwt || (typeof credential === 'string' ? credential : '');
  normalized.push(...decodeCredentialTypesFromJwt(jwt));
  return [...new Set(normalized.filter((type) => type === 'EmailCredential' || type === 'UsernameCredential' || type === 'AvatarCredential'))];
}

function credentialToken(credential) {
  return credential?.credential || credential?.jwt || (typeof credential === 'string' ? credential : '');
}

function credentialPayload(credential) {
  return credential?.payload || decodeCredentialPayload(credentialToken(credential));
}

function credentialIsFresh(credential, now = Date.now()) {
  const payload = credentialPayload(credential);
  const exp = Number(payload?.exp || 0);
  const nbf = Number(payload?.nbf || 0);
  if (!Number.isFinite(exp) || exp <= 0) return false;
  if (exp * 1000 <= now + CREDENTIAL_CLOCK_SKEW_MS) return false;
  return !Number.isFinite(nbf) || nbf <= 0 || nbf * 1000 <= now + CREDENTIAL_CLOCK_SKEW_MS;
}

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function requestCredentialTypes(scopes) {
  return [...new Set(scopes.filter(scopeNeedsCredential).map(credentialTypeForScope))];
}

function selectFreshCredentials(credentials, scopes) {
  const requestedTypes = requestCredentialTypes(scopes);
  return credentials.filter((credential) => {
    const types = credentialTypes(credential);
    return credentialIsFresh(credential) && requestedTypes.some((type) => types.includes(type));
  });
}

function missingCredentialTypes(selectedCredentials, scopes) {
  return requestCredentialTypes(scopes).filter((type) => !selectedCredentials.some((credential) => credentialTypes(credential).includes(type)));
}

function mergeCredentials(currentCredentials, reissuedCredentials) {
  const merged = [...currentCredentials];
  for (const item of reissuedCredentials) {
    const credential = item?.credential || item?.jwt || (typeof item === 'string' ? item : '');
    if (!credential) continue;
    const types = credentialTypes(item);
    for (let index = merged.length - 1; index >= 0; index -= 1) {
      if (credentialTypes(merged[index]).some((type) => types.includes(type))) merged.splice(index, 1);
    }
    merged.push(item);
  }
  return merged;
}

async function postIssuer(endpoint, path, payload) {
  const base = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('IDENTITY_ISSUER_ENDPOINT_REQUIRED');
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    credentials: 'omit',
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.code) throw new Error(result.message || 'IDENTITY_CREDENTIAL_REISSUE_FAILED');
  return result.data || {};
}

async function reissueMissingCredentials({ identityId, record, credentials, missingTypes, issuerEndpoint, privateKey }) {
  if (missingTypes.length === 0) return credentials;
  const challenge = await postIssuer(issuerEndpoint, '/api/v1/public/identity/credentials/reissue/challenge', {
    identity: record.document.id,
    credentialTypes: missingTypes
  });
  const signingInput = String(challenge.signingInput || canonicalize(challenge.proofPayload));
  const signature = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(signingInput));
  const identityDocument = await signIdentityDocument(record.document, privateKey, {
    verificationMethod: `${record.document.id}#${record.controllerId}`,
    purpose: 'manage'
  });
  const confirmed = await postIssuer(issuerEndpoint, '/api/v1/public/identity/credentials/reissue/confirm', {
    identity: record.document.id,
    challengeId: challenge.challengeId,
    identityDocument,
    proof: {
      type: 'YeyingCredentialReissueProofV1',
      verificationMethod: `${record.document.id}#${record.controllerId}`,
      purpose: 'authentication',
      proofValue: toBase64Url(new Uint8Array(signature))
    }
  });
  const nextCredentials = mergeCredentials(credentials, confirmed.credentials || []);
  await saveIdentityCredentials(identityId, nextCredentials);
  return nextCredentials;
}

export async function requestIdentityPresentation({ account, params, origin, password }) {
  const request = normalizeRequest(params, origin);
  const identityId = await getValue(IdentityStorageKeys.SELECTED_IDENTITY, null);
  if (!identityId) throw new Error('IDENTITY_NOT_SELECTED');
  const record = await getIdentity(identityId);
  if (!record?.document) throw new Error('IDENTITY_NOT_FOUND');
  const issuedAt = new Date().toISOString();
  const expiresAt = request.expiresAt || new Date(Date.now() + 5 * 60 * 1000).toISOString();
  let credentials = await getIdentityCredentials(identityId);
  let selectedCredentials = selectFreshCredentials(credentials, request.scopes);
  const keyMaterial = await decryptIdentityKeyMaterial(record, password);
  const privateKey = await crypto.subtle.importKey('jwk', keyMaterial.privateJwk, { name: 'Ed25519' }, false, ['sign']);
  const missingTypes = missingCredentialTypes(selectedCredentials, request.scopes);
  if (missingTypes.length > 0 && request.issuerEndpoint) {
    credentials = await reissueMissingCredentials({ identityId, record, credentials, missingTypes, issuerEndpoint: request.issuerEndpoint, privateKey });
    selectedCredentials = selectFreshCredentials(credentials, request.scopes);
  }
  for (const scope of request.scopes) {
    if (scopeNeedsCredential(scope) && !selectedCredentials.some((credential) => {
      const types = credentialTypes(credential);
      return types.includes(credentialTypeForScope(scope));
    })) throw new Error(`IDENTITY_SCOPE_NOT_GRANTED:${scope}`);
  }
  const unsigned = { version: 1, holder: record.document.id, audience: request.audience, nonce: request.nonce, issuedAt, expiresAt, scopes: request.scopes, identityDocument: request.scopes.includes('identity.basic') ? record.document : undefined, walletProof: request.scopes.includes('identity.wallet') ? { chainKey: account.chainKey || `eip155:${account.chainId || 1}`, address: account.address } : undefined, credentials: selectedCredentials.map(credentialToken) };
  const signature = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(canonicalize(unsigned)));
  return { ...unsigned, proof: { type: 'YeyingIdentityPresentationProofV1', verificationMethod: `${record.document.id}#${record.controllerId}`, purpose: 'authentication', proofValue: toBase64Url(new Uint8Array(signature)) } };
}

export { METHOD, credentialIsFresh, requestCredentialTypes, selectFreshCredentials, missingCredentialTypes, mergeCredentials };
