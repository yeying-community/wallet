const EXPIRING_SOON_THRESHOLD_MS = 5 * 60 * 1000;

function base64UrlEncode(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base58Encode(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
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
    output += alphabet[encoded[i]];
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

export function normalizeBearerToken(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/^Bearer\s+/i, '')
    .replace(/^UCAN\s+/i, '')
    .trim();
}

export function deriveUcanAudience(endpoint) {
  try {
    const url = new URL(String(endpoint || '').trim());
    const host = url.hostname;
    const port = url.port ? `:${url.port}` : '';
    return host ? `did:web:${host}${port}` : '';
  } catch {
    return '';
  }
}

export function decodeJwtPayload(value) {
  const token = normalizeBearerToken(value);
  const segments = token.split('.');
  if (segments.length < 2) return null;
  try {
    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function getUcanExpiresAt(value) {
  const payload = decodeJwtPayload(value);
  const exp = Number(payload?.exp);
  if (!Number.isFinite(exp) || exp <= 0) return 0;
  return exp > 1e12 ? exp : exp * 1000;
}

export function isUcanExpiringSoon(value, thresholdMs = EXPIRING_SOON_THRESHOLD_MS) {
  const expiresAt = getUcanExpiresAt(value);
  if (!expiresAt) return true;
  return expiresAt <= (Date.now() + thresholdMs);
}

export function buildSiweMessage(endpoint, address, statement) {
  const url = new URL(endpoint);
  const domain = url.host || url.hostname;
  const nonce = Math.random().toString(36).slice(2, 10);
  const issuedAt = new Date().toISOString();
  const statementLine = `UCAN-AUTH: ${JSON.stringify(statement)}`;

  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    `URI: ${url.origin}`,
    'Version: 1',
    'Chain ID: 1',
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    '',
    statementLine
  ].join('\n');
}

export async function createUcanInvocationKey() {
  if (!crypto?.subtle) {
    throw new Error('WebCrypto not available');
  }
  const keys = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  );
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const did = toDidKey(publicRaw);
  return { keys, did };
}

export async function createUcanInvocationToken({ audience, capability, proof, expiresAt, notBefore, keys, did }) {
  if (!crypto?.subtle) {
    throw new Error('WebCrypto not available');
  }
  if (!keys?.privateKey || !did) {
    throw new Error('Missing UCAN key');
  }
  const payload = {
    iss: did,
    aud: audience,
    cap: [capability],
    exp: expiresAt,
    nbf: notBefore,
    prf: [proof]
  };
  const header = { alg: 'EdDSA', typ: 'UCAN' };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(
    'Ed25519',
    keys.privateKey,
    new TextEncoder().encode(signingInput)
  );
  const token = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
  return { token, did };
}
