import { state } from './state.js';
import { createInvalidParams, createUnauthorizedError } from '../common/errors/index.js';
import { getAuthorization, getSelectedAccount, getUserSetting } from '../storage/index.js';

const SUPPORTED_FIELDS = new Set(['username', 'email']);

export async function handleYeyingGetProfile(origin, params) {
  const authorization = await getAuthorization(origin);
  if (!authorization?.address) throw createUnauthorizedError('Site not connected');

  const requested = params?.[0]?.fields;
  if (!Array.isArray(requested) || requested.length === 0) {
    throw createInvalidParams('fields must contain username and/or email');
  }
  const fields = Array.from(new Set(requested.map(String)));
  if (fields.some(field => !SUPPORTED_FIELDS.has(field))) {
    throw createInvalidParams('Unsupported profile field');
  }
  const granted = new Set(authorization.profileFields || []);
  if (fields.some(field => !granted.has(field))) {
    throw createUnauthorizedError('Profile field permission not granted');
  }

  const account = await getSelectedAccount();
  if (!account || account.address?.toLowerCase() !== authorization.address.toLowerCase()) {
    throw createUnauthorizedError('Authorized account is not selected');
  }
  const profile = {};
  if (fields.includes('username')) profile.username = account.username || '';
  if (fields.includes('email')) profile.email = String(await getUserSetting('profileEmail', '') || '');
  return { address: account.address, chainId: state.currentChainId, profile };
}
