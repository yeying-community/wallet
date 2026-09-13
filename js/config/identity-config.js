export const DEFAULT_IDENTITY_NODE_ENDPOINT = 'https://node.yeying.pub';
export const IDENTITY_NODE_ENDPOINT_STORAGE_KEY = 'walletIdentityNodeEndpoint';

export function normalizeIdentityNodeEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return '';
    url.hash = '';
    url.search = '';
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${pathname}`;
  } catch {
    return '';
  }
}
