/**
 * Key custody HTTP client.
 */

function normalizeEndpoint(endpoint) {
  const trimmed = String(endpoint || '').trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : '';
}

function buildUrl(endpoint, path) {
  const base = normalizeEndpoint(endpoint);
  if (!base) {
    throw new Error('托管服务地址未配置');
  }
  return `${base}/${String(path || '').replace(/^\/+/, '')}`;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export class CustodyClient {
  constructor({ endpoint = '', getToken } = {}) {
    this._endpoint = normalizeEndpoint(endpoint);
    this._getToken = typeof getToken === 'function' ? getToken : null;
  }

  setEndpoint(endpoint) {
    this._endpoint = normalizeEndpoint(endpoint);
  }

  async _resolveToken() {
    return this._getToken ? await this._getToken() : '';
  }

  async request(path, { method = 'GET', body } = {}) {
    const token = await this._resolveToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(buildUrl(this._endpoint, path), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit'
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data?.message || data?.error || response.statusText || `HTTP ${response.status}`);
    }
    if (data && typeof data.code === 'number' && Object.prototype.hasOwnProperty.call(data, 'data')) {
      if (data.code !== 0) {
        throw new Error(data.message || '托管服务请求失败');
      }
      return data.data;
    }
    return data;
  }

  async getStatus() {
    return this.request('/api/v1/public/custody/status');
  }

  async upsertSecret(payload) {
    return this.request('/api/v1/public/custody/secrets', {
      method: 'POST',
      body: payload
    });
  }

  async deleteSecret(walletId) {
    return this.request(`/api/v1/public/custody/secrets/${encodeURIComponent(walletId)}`, {
      method: 'DELETE'
    });
  }
}
