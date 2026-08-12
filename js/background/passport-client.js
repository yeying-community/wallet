const BASE_PATH = '/api/v1/public/auth/passport';

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

export class PassportClientError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.name = 'PassportClientError';
    this.status = status;
    this.code = code;
  }
}

export class PassportClient {
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

  async request(path, { method = 'GET', body, authenticated = false } = {}) {
    if (!this._endpoint) {
      throw new PassportClientError('Node 服务地址未配置');
    }
    if (typeof this._fetch !== 'function') {
      throw new PassportClientError('当前环境不支持网络请求');
    }

    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated) {
      const token = String(this._getToken ? await this._getToken() : '').trim();
      if (!token) throw new PassportClientError('缺少 Node 访问令牌', { code: 'PASSPORT_TOKEN_MISSING' });
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await this._fetch(`${this._endpoint}${BASE_PATH}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit'
    });
    const payload = await parseResponse(response);
    const envelopeFailed = payload && typeof payload.code === 'number' && payload.code !== 0;
    if (!response.ok || envelopeFailed) {
      throw new PassportClientError(
        payload?.message || payload?.error || response.statusText || `HTTP ${response.status}`,
        { status: response.status, code: String(payload?.errorCode || payload?.code || '') }
      );
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'data')) return payload.data;
    return payload;
  }

  getStatus() {
    return this.request('/status');
  }

  createBindingRequest() {
    return this.request('/bind/request', { method: 'POST', authenticated: true });
  }

  confirmBinding(proof) {
    return this.request('/bind/confirm', {
      method: 'POST',
      authenticated: true,
      body: proof === undefined ? {} : { proof }
    });
  }

  listBindings() {
    return this.request('/bindings', { authenticated: true });
  }

  requestEmailVerification(email) {
    const value = String(email || '').trim();
    if (!value) throw new PassportClientError('请输入社区邮箱');
    return this.request('/email/verification/request', {
      method: 'POST',
      authenticated: true,
      body: { email: value }
    });
  }

  confirmEmailVerification({ verificationId, code }) {
    const id = String(verificationId || '').trim();
    const value = String(code || '').trim();
    if (!id) throw new PassportClientError('请先发送邮箱验证码');
    if (!/^\d{6}$/.test(value)) throw new PassportClientError('请输入 6 位验证码');
    return this.request('/email/verification/confirm', {
      method: 'POST',
      authenticated: true,
      body: { verificationId: id, code: value }
    });
  }

  createUnlinkRequest() {
    return this.request('/bind/unlink/request', { method: 'POST', authenticated: true });
  }

  confirmUnlink({ requestId, timestamp, signature }) {
    return this.request('/bind/unlink/confirm', {
      method: 'POST', authenticated: true, body: { requestId, timestamp, signature }
    });
  }

  getAuthorizationRequest(requestId) {
    const id = String(requestId || '').trim();
    if (!id) throw new PassportClientError('缺少授权请求 ID');
    return this.request(`/authorize/request/${encodeURIComponent(id)}`);
  }

  approveAuthorization(requestId) {
    const id = String(requestId || '').trim();
    if (!id) throw new PassportClientError('缺少授权请求 ID');
    return this.request('/authorize/approve', {
      method: 'POST',
      authenticated: true,
      body: { requestId: id }
    });
  }

  createWalletAssertion(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new PassportClientError('缺少 Passport assertion 请求参数');
    }
    return this.request('/assertions/wallet', {
      method: 'POST',
      body: payload
    });
  }
}

export { normalizeEndpoint };
