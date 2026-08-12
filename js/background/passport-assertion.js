import { PassportClient, normalizeEndpoint } from './passport-client.js';
import { signMessage } from './signing.js';
import { getUserSetting } from '../storage/index.js';
import { createInvalidParams } from '../common/errors/index.js';

const DEFAULT_NODE_ENDPOINT = 'https://node.yeying.pub';
const PASSPORT_ENDPOINT_STORAGE_KEY = 'passportNodeEndpoint';
const PASSPORT_ASSERTION_METHOD = 'yeying_passport_assertion';
const DEFAULT_SCOPES = ['identity.basic', 'identity.wallet'];
const ALLOWED_SCOPES = new Set(['identity.basic', 'identity.wallet', 'identity.email']);

function asString(value) {
  return String(value || '').trim();
}

function normalizeScopes(scopes) {
  const source = Array.isArray(scopes) ? scopes : DEFAULT_SCOPES;
  const normalized = [];
  source.forEach((scope) => {
    const value = asString(scope);
    if (!value) return;
    if (!ALLOWED_SCOPES.has(value)) {
      throw createInvalidParams(`Unsupported Passport scope: ${value}`);
    }
    if (!normalized.includes(value)) normalized.push(value);
  });
  if (!normalized.includes('identity.basic')) normalized.unshift('identity.basic');
  return normalized;
}

function normalizeAudience(audience, origin) {
  const value = asString(audience || origin);
  if (!value) throw createInvalidParams('audience is required');
  return value;
}

function normalizeAppId(appId, audience) {
  const value = asString(appId);
  if (value) return value;
  try {
    return new URL(audience).host;
  } catch {
    throw createInvalidParams('appId is required when audience is not a URL');
  }
}

function normalizeParams(params, origin) {
  const source = Array.isArray(params) ? (params[0] || {}) : (params || {});
  if (!source || typeof source !== 'object') {
    throw createInvalidParams('Invalid Passport assertion parameters');
  }

  const nonce = asString(source.nonce);
  if (!nonce) throw createInvalidParams('nonce is required');

  const audience = normalizeAudience(source.audience || source.aud, origin);
  const appId = normalizeAppId(source.appId, audience);
  const scopes = normalizeScopes(source.scopes || source.scope);
  const rawEndpoint = asString(source.passportEndpoint || source.endpoint);
  const endpoint = rawEndpoint ? normalizeEndpoint(rawEndpoint) : '';

  return {
    appId,
    audience,
    nonce,
    scopes,
    endpoint,
    statement: asString(source.statement),
    requestId: asString(source.requestId),
    expiresAt: asString(source.expiresAt)
  };
}

function scopeLabel(scope) {
  const labels = {
    'identity.basic': '社区身份',
    'identity.wallet': '钱包地址',
    'identity.email': '已验证邮箱'
  };
  return labels[scope] || scope;
}

export function buildPassportLoginIntent({ origin, address, appId, audience, nonce, scopes, statement }) {
  const issuedAt = new Date().toISOString();
  let displayHost = origin || audience;
  try {
    displayHost = new URL(origin || audience).host;
  } catch {
    displayHost = origin || audience;
  }
  const lines = [
    `${displayHost} wants to sign in with your YeYing Passport wallet:`,
    '',
    address,
    '',
    statement || 'Authorize this application to request a YeYing Passport assertion.',
    '',
    `App ID: ${appId}`,
    `Audience: ${audience}`,
    `Origin: ${origin || ''}`,
    `Nonce: ${nonce}`,
    `Scopes: ${scopes.join(' ')}`,
    `Issued At: ${issuedAt}`
  ];
  return lines.join('\n');
}

function extractPassportAssertion(response) {
  if (!response || typeof response !== 'object') return '';
  const direct = response.passportAssertion || response.assertion || response.jwt || response.token;
  return typeof direct === 'string' ? direct : '';
}

async function resolvePassportEndpoint(requestEndpoint) {
  const configured = asString(requestEndpoint);
  if (configured) return configured;
  const stored = asString(await getUserSetting(PASSPORT_ENDPOINT_STORAGE_KEY));
  return stored || DEFAULT_NODE_ENDPOINT;
}

export async function requestPassportAssertion({
  account,
  params,
  origin,
  fetchImpl,
  endpoint
}) {
  const normalized = normalizeParams(params, origin);
  normalized.endpoint = normalizeEndpoint(await resolvePassportEndpoint(endpoint || normalized.endpoint));

  const address = asString(account?.address);
  if (!address) throw createInvalidParams('No selected wallet address');

  const message = buildPassportLoginIntent({
    origin,
    address,
    appId: normalized.appId,
    audience: normalized.audience,
    nonce: normalized.nonce,
    scopes: normalized.scopes,
    statement: normalized.statement
  });
  const signature = await signMessage(account.id, message);
  const walletProof = {
    type: 'wallet-signature',
    method: 'personal_sign',
    address,
    message,
    signature,
    appId: normalized.appId,
    audience: normalized.audience,
    nonce: normalized.nonce,
    scopes: normalized.scopes,
    origin: origin || '',
    requestId: normalized.requestId || undefined
  };

  const client = new PassportClient({
    endpoint: normalized.endpoint,
    fetchImpl
  });
  const response = await client.createWalletAssertion({
    address,
    message,
    signature,
    method: 'personal_sign',
    appId: normalized.appId,
    audience: normalized.audience,
    nonce: normalized.nonce,
    scopes: normalized.scopes,
    origin: origin || '',
    requestId: normalized.requestId || undefined
  });
  const passportAssertion = extractPassportAssertion(response);
  if (!passportAssertion) {
    throw new Error('Node 未返回 Passport assertion');
  }

  return {
    address,
    walletProof,
    passportAssertion,
    response
  };
}

export {
  PASSPORT_ASSERTION_METHOD,
  PASSPORT_ENDPOINT_STORAGE_KEY,
  normalizeParams as normalizePassportAssertionParams,
  normalizeScopes as normalizePassportAssertionScopes
};
