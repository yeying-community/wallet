const IDENTITY_BASE_PATH = '/api/v1/public/identity';

function normalizeEndpoint(endpoint) {
  const value = String(endpoint || '').trim();
  if (!value) return '';
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Node 服务地址无效');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Node 服务地址必须使用 HTTP 或 HTTPS');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export class IdentityClientError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.name = 'IdentityClientError';
    this.status = status;
    this.code = code;
  }
}

export class IdentityClient {
  constructor({ endpoint = '', getToken, fetchImpl } = {}) {
    this._endpoint = normalizeEndpoint(endpoint);
    this._getToken = typeof getToken === 'function' ? getToken : null;
    this._fetch = typeof fetchImpl === 'function'
      ? fetchImpl
      : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  }

  setEndpoint(endpoint) {
    this._endpoint = normalizeEndpoint(endpoint);
  }

  async identityRequest(path, { method = 'GET', body } = {}) {
    if (!this._endpoint) throw new IdentityClientError('Node 服务地址未配置');
    if (typeof this._fetch !== 'function') throw new IdentityClientError('当前环境不支持网络请求');
    const response = await this._fetch(`${this._endpoint}${IDENTITY_BASE_PATH}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit'
    });
    const payload = await parseResponse(response);
    if (!response.ok || (payload && typeof payload.code === 'number' && payload.code !== 0)) {
      throw new IdentityClientError(payload?.message || payload?.error || response.statusText || `HTTP ${response.status}`, { status: response.status, code: String(payload?.errorCode || payload?.code || '') });
    }
    return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
  }

  requestIdentityVerification(body) {
    return this.identityRequest('/verifications/request', { method: 'POST', body });
  }

  confirmIdentityVerification(body) {
    return this.identityRequest('/verifications/confirm', { method: 'POST', body });
  }

  requestIdentityPasskeyRegistration(body) {
    return this.identityRequest('/passkeys/register/request', { method: 'POST', body });
  }

  confirmIdentityPasskeyRegistration(body) {
    return this.identityRequest('/passkeys/register/confirm', { method: 'POST', body });
  }

}

export { normalizeEndpoint };
