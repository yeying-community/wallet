import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PassportClient,
  PassportClientError,
  normalizeEndpoint
} from '../js/background/passport-client.js';

function jsonResponse(data, { ok = true, status = 200, statusText = '' } = {}) {
  return {
    ok,
    status,
    statusText,
    async text() {
      return JSON.stringify(data);
    }
  };
}

test('normalizeEndpoint accepts HTTP endpoints and strips query, hash and trailing slash', () => {
  assert.equal(normalizeEndpoint(' https://node.example/base/?x=1#hash '), 'https://node.example/base');
  assert.throws(() => normalizeEndpoint('javascript:alert(1)'), /HTTP/);
  assert.throws(() => normalizeEndpoint('not-a-url'), /无效/);
});

test('binding request uses the Node passport route and bearer token', async () => {
  const calls = [];
  const client = new PassportClient({
    endpoint: 'https://node.example/',
    getToken: async () => 'node-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ code: 0, data: { subjectId: 'subject-1', status: 'ready' } });
    }
  });

  assert.deepEqual(await client.createBindingRequest(), { subjectId: 'subject-1', status: 'ready' });
  assert.equal(calls[0].url, 'https://node.example/api/v1/public/auth/passport/bind/request');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer node-token');
  assert.equal(calls[0].options.credentials, 'omit');
});

test('authorization request is encoded and approval sends only the request id', async () => {
  const calls = [];
  const client = new PassportClient({
    endpoint: 'http://127.0.0.1:3000',
    getToken: () => 'token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ code: 0, data: { requestId: 'req/1' } });
    }
  });

  await client.getAuthorizationRequest('req/1');
  await client.approveAuthorization('req/1');
  assert.match(calls[0].url, /authorize\/request\/req%2F1$/);
  assert.deepEqual(JSON.parse(calls[1].options.body), { requestId: 'req/1' });
  assert.equal(calls[1].options.headers.Authorization, 'Bearer token');
});

test('authenticated calls fail before fetch when no bearer token is available', async () => {
  let called = false;
  const client = new PassportClient({
    endpoint: 'https://node.example',
    fetchImpl: async () => {
      called = true;
      return jsonResponse({ code: 0, data: {} });
    }
  });
  await assert.rejects(
    client.listBindings(),
    (error) => error instanceof PassportClientError && error.code === 'PASSPORT_TOKEN_MISSING'
  );
  assert.equal(called, false);
});

test('Node error envelopes preserve HTTP status and message', async () => {
  const client = new PassportClient({
    endpoint: 'https://node.example',
    fetchImpl: async () => jsonResponse(
      { code: 401, message: 'Invalid or expired access token' },
      { ok: false, status: 401, statusText: 'Unauthorized' }
    )
  });
  await assert.rejects(
    client.getStatus(),
    (error) => error instanceof PassportClientError
      && error.status === 401
      && error.message === 'Invalid or expired access token'
  );
});

test('default fetch keeps its global receiver for extension Service Workers', async () => {
  const originalFetch = globalThis.fetch;
  const receiver = globalThis;
  globalThis.fetch = function () {
    assert.equal(this, receiver);
    return Promise.resolve(jsonResponse({ code: 0, data: { enabled: true } }));
  };
  try {
    const client = new PassportClient({ endpoint: 'https://node.example' });
    assert.deepEqual(await client.getStatus(), { enabled: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unlink uses the signed one-time request returned by Node', async () => {
  const calls = [];
  const client = new PassportClient({
    endpoint: 'https://node.example', getToken: () => 'jwt',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ code: 0, data: { success: true } });
    }
  });
  await client.createUnlinkRequest();
  await client.confirmUnlink({ requestId: 'pun-1', timestamp: 'now', signature: '0xsig' });
  assert.match(calls[0].url, /bind\/unlink\/request$/);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    requestId: 'pun-1', timestamp: 'now', signature: '0xsig'
  });
});

test('email verification uses authenticated Passport endpoints', async () => {
  const calls = [];
  const client = new PassportClient({
    endpoint: 'https://node.example',
    getToken: () => 'jwt',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ code: 0, data: { verificationId: 'pev-1', email: 'person@example.com' } });
    }
  });
  await client.requestEmailVerification('person@example.com');
  await client.confirmEmailVerification({ verificationId: 'pev-1', code: '123456' });
  assert.match(calls[0].url, /email\/verification\/request$/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer jwt');
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: 'person@example.com' });
  assert.match(calls[1].url, /email\/verification\/confirm$/);
  assert.deepEqual(JSON.parse(calls[1].options.body), { verificationId: 'pev-1', code: '123456' });
});
