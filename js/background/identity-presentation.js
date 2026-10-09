import { getIdentity, getIdentityCredentials, saveIdentityCredentials, decryptIdentityKeyMaterial } from '../storage/identity-storage.js';
import { getValue } from '../storage/storage-base.js';
import { IdentityStorageKeys } from '../storage/storage-keys.js';
import { createInvalidParams } from '../common/errors/index.js';
import { signIdentityDocument } from '../common/identity/identity-document.js';
import { getCachedPassword, refreshPasswordCache } from './password-cache.js';
import { compareAddresses } from '../common/chain/address-normalize.js';

const METHOD = 'wallet_identity_presentation';
const DEFAULT_ISSUER_ENDPOINT = 'https://node.yeying.pub';
const ALLOWED_SCOPES = new Set(['identity.basic', 'identity.wallet', 'identity.username', 'identity.email', 'identity.avatar']);
const CREDENTIAL_CLOCK_SKEW_MS = 60 * 1000;

export function normalizeIdentityPresentationRequest(params, origin) {
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
  return scope === 'identity.wallet' || scope === 'identity.email' || scope === 'identity.username' || scope === 'identity.avatar';
}

function credentialTypeForScope(scope) {
  if (scope === 'identity.wallet') return 'WalletAccountCredential';
  if (scope === 'identity.email') return 'EmailCredential';
  if (scope === 'identity.username') return 'UsernameCredential';
  return 'AvatarCredential';
}

function missingCredentialErrorForScope(scope) {
  if (scope === 'identity.wallet') return 'IDENTITY_WALLET_NOT_VERIFIED';
  if (scope === 'identity.email') return 'IDENTITY_EMAIL_NOT_VERIFIED';
  if (scope === 'identity.username') return 'IDENTITY_USERNAME_NOT_VERIFIED';
  if (scope === 'identity.avatar') return 'IDENTITY_AVATAR_NOT_VERIFIED';
  return `IDENTITY_SCOPE_NOT_GRANTED:${scope}`;
}

function decodeCredentialPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
  } catch {
    return null;
  }
}

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(`${normalized}${'='.repeat((4 - normalized.length % 4) % 4)}`);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('IDENTITY_CREDENTIAL_INVALID');
  try {
    return {
      header: JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]))),
      payload: JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1]))),
      signingInput: new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
      signature: decodeBase64Url(parts[2]),
    };
  } catch {
    throw new Error('IDENTITY_CREDENTIAL_INVALID');
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
  return [...new Set(normalized.filter((type) => type === 'WalletAccountCredential' || type === 'EmailCredential' || type === 'UsernameCredential' || type === 'AvatarCredential'))];
}

function credentialToken(credential) {
  return credential?.credential || credential?.jwt || (typeof credential === 'string' ? credential : '');
}

function credentialPayload(credential) {
  return credential?.payload || decodeCredentialPayload(credentialToken(credential));
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function credentialIssuerEndpoint(credentials) {
  for (const credential of credentials || []) {
    const issuer = String(credentialPayload(credential)?.iss || '').trim();
    if (!issuer) continue;
    if (issuer.startsWith('did:web:')) {
      const methodId = issuer.slice('did:web:'.length);
      let authority = '';
      const bracketedIpv6 = methodId.match(/^(\[[0-9a-f:.]+\])(?::(\d+))?$/i);
      if (bracketedIpv6) authority = methodId;
      else if (methodId.includes('%3a') || methodId.includes('%3A')) {
        try { authority = decodeURIComponent(methodId); } catch { authority = ''; }
      } else {
        const parts = methodId.split(':');
        if (parts.length === 1) authority = parts[0];
        else if (parts.length === 2 && /^\d+$/.test(parts[1])) authority = `${parts[0]}:${parts[1]}`;
      }
      if (authority && !/[/?#@]/.test(authority)) {
        try {
          const candidate = new URL(`https://${authority}`);
          const local = isLoopbackHostname(candidate.hostname);
          return `${local ? 'http:' : 'https:'}//${candidate.host}`;
        } catch { /* Ignore malformed DID web authorities. */ }
      }
    }
    try {
      const url = new URL(issuer);
      const local = isLoopbackHostname(url.hostname);
      if ((url.protocol === 'https:' || (url.protocol === 'http:' && local)) && url.hostname && !url.username && !url.password) {
        url.hash = '';
        url.search = '';
        url.pathname = url.pathname.replace(/\/+$/, '');
        return url.toString().replace(/\/$/, '');
      }
    } catch { /* Ignore malformed issuer claims and continue. */ }
  }
  return '';
}

async function getIssuerVerificationContext(endpoint, expectedIssuer) {
  const base = new URL(String(endpoint || '').trim());
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('IDENTITY_ISSUER_ENDPOINT_INVALID');
  }
  const localIssuer = isLoopbackHostname(base.hostname);
  if (base.protocol !== 'https:' && !localIssuer) throw new Error('IDENTITY_ISSUER_HTTPS_REQUIRED');
  const origin = base.origin;
  const metadataResponse = await fetch(`${origin}/.well-known/openid-credential-issuer`, {
    headers: { accept: 'application/json' }, credentials: 'omit', redirect: 'error'
  });
  const metadata = await metadataResponse.json().catch(() => ({}));
  if (!metadataResponse.ok || metadata.issuer !== expectedIssuer) throw new Error('IDENTITY_ISSUER_UNTRUSTED');
  const jwksUrl = new URL(String(metadata.jwks_uri || ''));
  if (jwksUrl.origin !== origin || !['http:', 'https:'].includes(jwksUrl.protocol)) {
    throw new Error('IDENTITY_ISSUER_JWKS_INVALID');
  }
  const jwksResponse = await fetch(jwksUrl, {
    headers: { accept: 'application/json' }, credentials: 'omit', redirect: 'error'
  });
  const jwks = await jwksResponse.json().catch(() => ({}));
  if (!jwksResponse.ok || !Array.isArray(jwks.keys)) throw new Error('IDENTITY_ISSUER_JWKS_UNAVAILABLE');
  return { issuer: expectedIssuer, keys: jwks.keys };
}

async function verifyIssuerCredential(token, context, { identityId, credentialType, credentialId, requireFresh = false } = {}) {
  const { header, payload, signingInput, signature } = decodeJwt(token);
  const subject = payload?.vc?.credentialSubject || {};
  const types = Array.isArray(payload?.vc?.type) ? payload.vc.type : [payload?.vc?.type];
  if (header.alg !== 'EdDSA' || !header.kid || payload.iss !== context.issuer || payload.sub !== identityId || subject.id !== identityId || !types.includes(credentialType)) {
    throw new Error('IDENTITY_CREDENTIAL_INVALID');
  }
  if (credentialId && (payload.jti !== credentialId || subject.credentialStatus?.id !== credentialId)) {
    throw new Error('IDENTITY_CREDENTIAL_INVALID');
  }
  if (requireFresh && !credentialIsFresh({ credential: token })) throw new Error('IDENTITY_CREDENTIAL_EXPIRED');
  const jwk = context.keys.find(key => key.kid === header.kid && key.kty === 'OKP' && key.crv === 'Ed25519' && (!key.alg || key.alg === 'EdDSA') && (!key.use || key.use === 'sig'));
  if (!jwk) throw new Error('IDENTITY_CREDENTIAL_ISSUER_KEY_NOT_FOUND');
  const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'Ed25519' }, publicKey, signature, signingInput);
  if (!valid) throw new Error('IDENTITY_CREDENTIAL_SIGNATURE_INVALID');
  return payload;
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

function credentialMatchesAccount(credential, account) {
  const subject = credentialPayload(credential)?.vc?.credentialSubject;
  const expectedChainKey = account?.chainKey || `eip155:${account?.chainId || 1}`;
  if (subject?.chainKey !== expectedChainKey) return false;
  // family-aware 比较：EVM 大小写等价、Tron 大小写敏感。account 缺 namespace 时默认 EVM。
  return compareAddresses(
    subject?.address,
    account?.address,
    account?.namespace || 'eip155',
  );
}

function selectFreshCredentials(credentials, scopes, account) {
  const requestedTypes = requestCredentialTypes(scopes);
  return credentials.filter((credential) => {
    const types = credentialTypes(credential);
    if (!credentialIsFresh(credential) || !requestedTypes.some((type) => types.includes(type))) return false;
    // identity.wallet proves the identity's bound address. It is not tied to
    // the currently selected account; keep account as a ranking hint only.
    return true;
  });
}

function selectWalletCredential(credentials, account) {
  const walletCredentials = credentials.filter((credential) =>
    credentialIsFresh(credential) && credentialTypes(credential).includes('WalletAccountCredential')
  );
  if (walletCredentials.length === 0) return null;
  if (!account) return walletCredentials[0];
  return walletCredentials.find((credential) => credentialMatchesAccount(credential, account)) || walletCredentials[0];
}

function credentialAccount(credential) {
  const subject = credentialPayload(credential)?.vc?.credentialSubject || {};
  return { chainKey: String(subject.chainKey || ''), address: String(subject.address || '') };
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
    redirect: 'error',
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.code) throw new Error(result.message || 'IDENTITY_CREDENTIAL_REISSUE_FAILED');
  return result.data || {};
}

async function reissueMissingCredentials({ identityId, record, credentials, missingTypes, issuerEndpoint, privateKey }) {
  if (missingTypes.length === 0) return credentials;
  const source = credentials.find(item => credentialIssuerEndpoint([item]) === issuerEndpoint && credentialTypes(item).length > 0);
  const sourceToken = credentialToken(source);
  const sourceType = credentialTypes(source)[0];
  const sourceIssuer = credentialPayload(source)?.iss;
  if (!sourceToken || !sourceIssuer) throw new Error('IDENTITY_ISSUER_CREDENTIAL_REQUIRED');
  const verificationContext = await getIssuerVerificationContext(issuerEndpoint, sourceIssuer);
  const identityDid = record.document.id;
  await verifyIssuerCredential(sourceToken, verificationContext, { identityId: identityDid, credentialType: sourceType });
  const challenge = await postIssuer(issuerEndpoint, '/api/v1/public/identity/credentials/reissue/challenge', {
    identity: record.document.id,
    credentialTypes: missingTypes
  });
  const expectedProofPayload = {
    purpose: 'identity-credential-reissue',
    challengeId: String(challenge.challengeId || ''),
    identity: record.document.id,
    credentialTypes: missingTypes,
    nonce: String(challenge.nonce || ''),
    issuedAt: String(challenge.issuedAt || ''),
    expiresAt: String(challenge.expiresAt || ''),
  };
  const issuedAt = Date.parse(expectedProofPayload.issuedAt);
  const expiresAt = Date.parse(expectedProofPayload.expiresAt);
  if (!expectedProofPayload.challengeId || expectedProofPayload.nonce.length < 16 || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > Date.now() + 30_000 || expiresAt <= Date.now() || expiresAt - issuedAt > 5 * 60 * 1000 || canonicalize(challenge.proofPayload) !== canonicalize(expectedProofPayload) || challenge.signingInput !== canonicalize(expectedProofPayload)) {
    throw new Error('IDENTITY_CREDENTIAL_REISSUE_CHALLENGE_INVALID');
  }
  const signingInput = canonicalize(expectedProofPayload);
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
  const reissuedCredentials = Array.isArray(confirmed.credentials) ? confirmed.credentials : [];
  const seenTypes = new Set();
  if (confirmed.identity !== identityDid || canonicalize(confirmed.credentialTypes) !== canonicalize(missingTypes) || reissuedCredentials.length !== missingTypes.length) {
    throw new Error('IDENTITY_CREDENTIAL_REISSUE_RESPONSE_INVALID');
  }
  for (const item of reissuedCredentials) {
    const type = String(item?.type || '');
    const credentialId = String(item?.credentialId || '');
    if (!credentialId || !missingTypes.includes(type) || seenTypes.has(type)) throw new Error('IDENTITY_CREDENTIAL_REISSUE_RESPONSE_INVALID');
    seenTypes.add(type);
    await verifyIssuerCredential(credentialToken(item), verificationContext, {
      identityId: identityDid,
      credentialType: type,
      credentialId,
      requireFresh: true,
    });
  }
  const nextCredentials = mergeCredentials(credentials, reissuedCredentials);
  await saveIdentityCredentials(identityId, nextCredentials);
  return nextCredentials;
}

export async function refreshIdentityCredentialsAfterRestore({ identityId, password }) {
  const record = await getIdentity(identityId);
  if (!record?.document) throw new Error('IDENTITY_NOT_FOUND');
  const credentials = await getIdentityCredentials(identityId);
  const profileTypes = ['EmailCredential', 'UsernameCredential', 'AvatarCredential'];
  const freshTypes = new Set(credentials.filter(credentialIsFresh).flatMap(credentialTypes));
  const missingTypes = profileTypes.filter((type) => !freshTypes.has(type));
  if (missingTypes.length === 0) return { identityId, refreshed: [], unchanged: true };

  const endpoint = credentialIssuerEndpoint(credentials);
  if (!endpoint) throw new Error('IDENTITY_ISSUER_CREDENTIAL_REQUIRED');
  const keyMaterial = await decryptIdentityKeyMaterial(record, password);
  const privateKey = await crypto.subtle.importKey('jwk', keyMaterial.privateJwk, { name: 'Ed25519' }, false, ['sign']);
  await reissueMissingCredentials({ identityId, record, credentials, missingTypes, issuerEndpoint: endpoint, privateKey });
  return { identityId, refreshed: missingTypes, unchanged: false };
}

export async function requestIdentityPresentation({ account, params, origin, password }) {
  const request = normalizeIdentityPresentationRequest(params, origin);
  const identityId = await getValue(IdentityStorageKeys.SELECTED_IDENTITY, null);
  if (!identityId) throw new Error('IDENTITY_NOT_SELECTED');
  const record = await getIdentity(identityId);
  if (!record?.document) throw new Error('IDENTITY_NOT_FOUND');
  const issuedAt = new Date().toISOString();
  const expiresAt = request.expiresAt || new Date(Date.now() + 5 * 60 * 1000).toISOString();
  let credentials = await getIdentityCredentials(identityId);
  let selectedCredentials = selectFreshCredentials(credentials, request.scopes, account);
  let walletCredential = request.scopes.includes('identity.wallet') ? selectWalletCredential(credentials, account) : null;
  if (walletCredential) {
    selectedCredentials = [
      ...selectedCredentials.filter((credential) => !credentialTypes(credential).includes('WalletAccountCredential')),
      walletCredential
    ];
  }
  const effectivePassword = String(password || '').trim() || getCachedPassword();
  if (!effectivePassword) {
    throw new Error('Wallet is locked');
  }
  refreshPasswordCache();
  const keyMaterial = await decryptIdentityKeyMaterial(record, effectivePassword);
  const privateKey = await crypto.subtle.importKey('jwk', keyMaterial.privateJwk, { name: 'Ed25519' }, false, ['sign']);
  const signedIdentityDocument = await signIdentityDocument(record.document, privateKey, {
    verificationMethod: `${record.document.id}#${record.controllerId}`,
    purpose: 'manage'
  });
  const missingTypes = missingCredentialTypes(selectedCredentials, request.scopes);
  // Use the issuer bound to the stored credentials; DApps cannot redirect issuer requests.
  const issuerEndpoint = String(credentialIssuerEndpoint(credentials) || DEFAULT_ISSUER_ENDPOINT).trim();
  let reissueError = null;
  if (missingTypes.length > 0 && issuerEndpoint) {
    try {
      credentials = await reissueMissingCredentials({ identityId, record, credentials, missingTypes, issuerEndpoint, privateKey });
      selectedCredentials = selectFreshCredentials(credentials, request.scopes, account);
      walletCredential = request.scopes.includes('identity.wallet') ? selectWalletCredential(credentials, account) : null;
      if (walletCredential) {
        selectedCredentials = [
          ...selectedCredentials.filter((credential) => !credentialTypes(credential).includes('WalletAccountCredential')),
          walletCredential
        ];
      }
    } catch (error) {
      reissueError = error;
      console.warn('[IdentityPresentation] credential reissue failed:', error?.message || error);
    }
  }
  for (const scope of request.scopes) {
    if (scopeNeedsCredential(scope) && !selectedCredentials.some((credential) => {
      const types = credentialTypes(credential);
      return types.includes(credentialTypeForScope(scope));
    })) {
      const code = missingCredentialErrorForScope(scope);
      const error = new Error(code);
      error.code = code;
      error.userMessage = scope === 'identity.email'
        ? '钱包身份尚未完成邮箱验证，请先验证邮箱后再登录'
        : scope === 'identity.username'
          ? '钱包身份尚未完成用户名验证，请先补充用户名后再登录'
          : scope === 'identity.avatar'
            ? '钱包身份尚未完成头像验证，请先补充头像后再登录'
            : code;
      if (reissueError) {
        error.cause = reissueError;
        error.reissueError = reissueError?.message || String(reissueError);
      }
      throw error;
    }
  }
  const walletBinding = walletCredential ? credentialAccount(walletCredential) : null;
  const unsigned = { version: 1, holder: record.document.id, audience: request.audience, nonce: request.nonce, issuedAt, expiresAt, scopes: request.scopes, identityDocument: request.scopes.includes('identity.basic') ? signedIdentityDocument : undefined, walletProof: request.scopes.includes('identity.wallet') ? walletBinding : undefined, credentials: selectedCredentials.map(credentialToken) };
  const signature = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(canonicalize(unsigned)));
  return { ...unsigned, proof: { type: 'YeyingIdentityPresentationProofV1', verificationMethod: `${record.document.id}#${record.controllerId}`, purpose: 'authentication', proofValue: toBase64Url(new Uint8Array(signature)) } };
}

export { METHOD, credentialIsFresh, requestCredentialTypes, selectFreshCredentials, selectWalletCredential, missingCredentialTypes, mergeCredentials, credentialIssuerEndpoint };
