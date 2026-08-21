/**
 * MPC coordinator client (HTTP + WS).
 */

function normalizeEndpoint(endpoint) {
  const trimmed = String(endpoint || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

function buildHttpUrl(endpoint, path) {
  const base = normalizeEndpoint(endpoint);
  if (!base) return '';
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  return `${base}/${normalizedPath}`;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return { message: text };
  }
}

export class MpcCoordinatorClient {
  constructor({ endpoint = '', getToken } = {}) {
    this._endpoint = normalizeEndpoint(endpoint);
    this._getToken = typeof getToken === 'function' ? getToken : null;
  }

  setEndpoint(endpoint) {
    this._endpoint = normalizeEndpoint(endpoint);
  }

  async _resolveToken() {
    if (!this._getToken) return null;
    return await this._getToken();
  }

  async request(path, { method = 'GET', body, headers = {} } = {}) {
    const url = buildHttpUrl(this._endpoint, path);
    if (!url) {
      throw new Error('MPC coordinator endpoint not set');
    }

    const token = await this._resolveToken();
    const requestHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (token) {
      requestHeaders.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await parseJsonResponse(response);
    if (!response.ok) {
      const message = data?.message || data?.error || response.statusText || `HTTP ${response.status}`;
      throw new Error(message);
    }
    if (data && typeof data.code === 'number' && Object.prototype.hasOwnProperty.call(data, 'data')) {
      if (data.code !== 0) {
        throw new Error(data.message || 'MPC request failed');
      }
      return data.data;
    }
    return data;
  }

  async createSession(payload, signature = {}) {
    return this.request('/api/v1/public/mpc/sessions', {
      method: 'POST',
      body: { ...payload, ...signature }
    });
  }

  async joinSession(sessionId, payload, signature = {}) {
    return this.request(`/api/v1/public/mpc/sessions/${sessionId}/join`, {
      method: 'POST',
      body: { ...payload, ...signature }
    });
  }

  async cancelSession(sessionId, signature = {}) {
    return this.request(`/api/v1/public/mpc/sessions/${sessionId}/cancel`, {
      method: 'POST',
      body: { ...signature }
    });
  }

  async completeSession(sessionId, payload, signature = {}) {
    return this.request(`/api/v1/public/mpc/sessions/${sessionId}/complete`, {
      method: 'POST',
      body: { ...payload, ...signature }
    });
  }

  async createSignRequest(payload, signature = {}) {
    return this.request('/api/v1/public/mpc/sign-requests', {
      method: 'POST',
      body: { ...payload, ...signature }
    });
  }

  async sendMessage(sessionId, message, signature = {}) {
    return this.request(`/api/v1/public/mpc/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: { message, ...signature }
    });
  }

  async fetchMessages(sessionId, { since, cursor, limit } = {}) {
    const params = new URLSearchParams();
    if (since !== undefined && since !== null) {
      params.set('since', String(since));
    }
    if (cursor !== undefined && cursor !== null) {
      params.set('cursor', String(cursor));
    }
    if (limit !== undefined && limit !== null) {
      params.set('limit', String(limit));
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/api/v1/public/mpc/sessions/${sessionId}/messages${suffix}`, { method: 'GET' });
  }

  async getSession(sessionId) {
    return this.request(`/api/v1/public/mpc/sessions/${sessionId}`, { method: 'GET' });
  }

  async listNotifications({ unreadOnly = false, source = '', level = '', page = 1, pageSize = 20 } = {}) {
    const params = new URLSearchParams();
    if (unreadOnly) {
      params.set('unreadOnly', 'true');
    }
    if (source) {
      params.set('source', String(source));
    }
    if (level) {
      params.set('level', String(level));
    }
    params.set('page', String(page || 1));
    params.set('pageSize', String(pageSize || 20));
    return this.request(`/api/v1/public/notifications?${params.toString()}`, { method: 'GET' });
  }

  async listMpcInvites({ page = 1, pageSize = 20 } = {}) {
    const params = new URLSearchParams();
    params.set('page', String(page || 1));
    params.set('pageSize', String(pageSize || 20));
    return this.request(`/api/v1/public/mpc/invites?${params.toString()}`, { method: 'GET' });
  }

  async markNotificationRead(notificationUid) {
    return this.request(`/api/v1/public/notifications/${encodeURIComponent(notificationUid)}/read`, {
      method: 'POST'
    });
  }

  async openSessionStream(sessionId, options = {}) {
    const token = options.token || await this._resolveToken();
    const baseUrl = buildHttpUrl(this._endpoint, '/api/v1/public/mpc/ws');
    if (!baseUrl) {
      throw new Error('MPC coordinator endpoint not set');
    }
    const params = new URLSearchParams();
    params.set('sessionId', sessionId);
    if (options.cursor) {
      params.set('cursor', String(options.cursor));
    }
    const url = `${baseUrl}?${params.toString()}`;

    const headers = {
      Accept: 'text/event-stream'
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });

    if (!response.ok || !response.body) {
      const data = await parseJsonResponse(response);
      const message = data?.error || data?.message || response.statusText || `HTTP ${response.status}`;
      throw new Error(message);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventId = '';
    let eventName = '';
    let eventData = '';

    const dispatch = () => {
      if (!eventName && !eventData) {
        return;
      }
      const name = eventName || 'message';
      const raw = eventData;
      let parsed = null;
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
      }
      if (typeof options.onEvent === 'function') {
        options.onEvent({
          id: eventId || null,
          type: name,
          data: parsed,
          raw
        });
      }
      eventId = '';
      eventName = '';
      eventData = '';
    };

    const pump = async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let lineEnd = buffer.indexOf('\n');
          while (lineEnd >= 0) {
            const line = buffer.slice(0, lineEnd).replace(/\r$/, '');
            buffer = buffer.slice(lineEnd + 1);
            if (!line) {
              dispatch();
            } else if (line.startsWith('id:')) {
              eventId = line.slice(3).trim();
            } else if (line.startsWith('event:')) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              const chunk = line.slice(5).trim();
              eventData = eventData ? `${eventData}\n${chunk}` : chunk;
            }
            lineEnd = buffer.indexOf('\n');
          }
        }
        dispatch();
        if (typeof options.onClose === 'function') {
          options.onClose();
        }
      } catch (error) {
        if (typeof options.onError === 'function') {
          options.onError(error);
        }
      }
    };

    pump();

    return {
      close: () => controller.abort()
    };
  }
}
