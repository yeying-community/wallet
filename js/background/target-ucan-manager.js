import { createWalletInstance } from './vault.js';
import { signMessage } from './signing.js';
import { state } from './state.js';
import {
  getSelectedAccount,
  getAccountList,
  getUserSetting,
  updateUserSettings
} from '../storage/index.js';
import { cachePassword, getCachedPassword, refreshPasswordCache } from './password-cache.js';
import {
  normalizeBearerToken,
  decodeJwtPayload,
  deriveUcanAudience,
  getUcanExpiresAt,
  isUcanExpiringSoon,
  buildSiweMessage,
  createUcanInvocationKey,
  createUcanInvocationToken
} from '../common/ucan-utils.js';

const DEFAULT_UCAN_TTL_HOURS = 24;

async function getSigningAccount() {
  let account = await getSelectedAccount();
  if (account?.id && account?.address) {
    return account;
  }
  const accounts = await getAccountList();
  return Array.isArray(accounts) && accounts.length > 0 ? accounts[0] : null;
}

async function ensureAccountUnlocked(account, passwordOverride) {
  if (!account?.id) {
    throw new Error('未找到当前账户');
  }
  if (state.keyring?.has(account.id)) {
    refreshPasswordCache();
    return;
  }
  const password = String(passwordOverride || '').trim() || getCachedPassword();
  if (!password) {
    throw new Error('请先解锁钱包后再试');
  }
  const walletInstance = await createWalletInstance(account, password);
  if (!state.keyring) {
    state.keyring = new Map();
  }
  state.keyring.set(account.id, walletInstance);
  cachePassword(password);
}

export async function ensureTargetUcanToken(options = {}) {
  const endpoint = String(options.endpoint || '').trim();
  if (!endpoint) {
    throw new Error('MPC coordinator endpoint not set');
  }

  const tokenSettingKey = String(options.tokenSettingKey || '').trim();
  const audienceSettingKey = String(options.audienceSettingKey || '').trim();
  const resourceSettingKey = String(options.resourceSettingKey || '').trim();
  const actionSettingKey = String(options.actionSettingKey || '').trim();

  if (!tokenSettingKey || !audienceSettingKey || !resourceSettingKey || !actionSettingKey) {
    throw new Error('UCAN target settings keys are required');
  }

  const defaultResource = String(options.defaultResource || '').trim();
  const defaultAction = String(options.defaultAction || '').trim();
  const ttlHours = Number(options.ttlHours || DEFAULT_UCAN_TTL_HOURS);
  const ttlMs = (Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : DEFAULT_UCAN_TTL_HOURS) * 60 * 60 * 1000;
  const explicitAudience = String(options.audience || '').trim();
  const explicitResource = String(options.resource || '').trim();
  const explicitAction = String(options.action || '').trim();
  const forceRefresh = Boolean(options.forceRefresh);

  const storedToken = normalizeBearerToken(await getUserSetting(tokenSettingKey, ''));
  const storedAudience = String(await getUserSetting(audienceSettingKey, '') || '').trim();
  const storedResource = String(await getUserSetting(resourceSettingKey, '') || '').trim();
  const storedAction = String(await getUserSetting(actionSettingKey, '') || '').trim();

  const audience = explicitAudience || storedAudience || deriveUcanAudience(endpoint);
  const resource = explicitResource || storedResource || defaultResource;
  const action = explicitAction || storedAction || defaultAction;

  if (!audience) {
    throw new Error('无法推导 UCAN audience');
  }
  if (!resource || !action) {
    throw new Error('MPC UCAN capability is incomplete');
  }

  const payload = decodeJwtPayload(storedToken);
  const payloadAud = String(payload?.aud || '').trim();
  const payloadCap = Array.isArray(payload?.cap) ? payload.cap[0] : null;
  const tokenMatchesTarget = Boolean(
    storedToken &&
    payloadAud === audience &&
    String(payloadCap?.resource || payloadCap?.with || '').trim() === resource &&
    String(payloadCap?.action || payloadCap?.can || '').trim() === action
  );

  if (!forceRefresh && tokenMatchesTarget && !isUcanExpiringSoon(storedToken)) {
    return {
      token: storedToken,
      audience,
      resource,
      action,
      expiresAt: getUcanExpiresAt(storedToken)
    };
  }

  const account = await getSigningAccount();
  await ensureAccountUnlocked(account, options.password);

  const now = Date.now();
  const expiresAt = now + ttlMs;
  const { did, keys } = await createUcanInvocationKey();
  const statement = {
    aud: did,
    cap: [{ resource, action }],
    exp: expiresAt,
    nbf: now
  };
  const message = buildSiweMessage(endpoint, account.address, statement);
  const signature = await signMessage(account.id, message);
  const rootProof = {
    type: 'siwe',
    iss: `did:pkh:eth:${String(account.address || '').toLowerCase()}`,
    aud: did,
    cap: [{ resource, action }],
    exp: expiresAt,
    nbf: now,
    siwe: {
      message,
      signature
    }
  };

  const { token } = await createUcanInvocationToken({
    audience,
    capability: { resource, action },
    proof: rootProof,
    expiresAt,
    notBefore: now,
    keys,
    did
  });

  const normalizedToken = normalizeBearerToken(token);
  await updateUserSettings({
    [audienceSettingKey]: audience,
    [resourceSettingKey]: resource,
    [actionSettingKey]: action,
    [tokenSettingKey]: normalizedToken
  });

  return {
    token: normalizedToken,
    audience,
    resource,
    action,
    expiresAt
  };
}
