import { generateId } from '../common/utils/index.js';
import { state } from './state.js';

const MESSAGE_PREFIX = 'YeYing Market';

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(String(value));
}

export async function buildActionPayloadHash(payload) {
  const bytes = new TextEncoder().encode(stableStringify(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildActionSignatureMessage({ action, actor, timestamp, requestId, payload }) {
  return [
    MESSAGE_PREFIX,
    `Action: ${String(action || '').trim().toLowerCase()}`,
    `Actor: ${String(actor || '').trim().toLowerCase()}`,
    `Timestamp: ${timestamp}`,
    `RequestId: ${requestId}`,
    `PayloadHash: ${await buildActionPayloadHash(payload ?? null)}`,
  ].join('\n');
}

export async function createActionSignature({ account, action, payload }) {
  if (!account?.id || !account?.address) throw new Error('未找到当前账户');
  const wallet = state.keyring?.get(account.id);
  if (!wallet || typeof wallet.signMessage !== 'function') {
    throw new Error('Wallet is locked');
  }
  const requestId = generateId('action');
  const timestamp = String(Date.now());
  const message = await buildActionSignatureMessage({
    action,
    actor: account.address,
    timestamp,
    requestId,
    payload,
  });
  return {
    requestId,
    timestamp,
    signature: await wallet.signMessage(message),
  };
}
