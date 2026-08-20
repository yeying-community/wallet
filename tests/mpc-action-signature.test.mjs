import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import {
  buildActionPayloadHash,
  buildActionSignatureMessage,
} from '../js/background/action-signature.js';
import { MpcCoordinatorClient } from '../js/background/mpc-coordinator-client.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

test('MPC action signature message matches the Node canonical payload format', async () => {
  const payload = {
    walletId: 'wallet-1',
    participants: ['0x2', '0x1'],
    threshold: 2,
    omitted: undefined,
  };
  const canonical = '{"participants":["0x2","0x1"],"threshold":2,"walletId":"wallet-1"}';
  const expectedHash = createHash('sha256').update(canonical).digest('hex');

  assert.equal(await buildActionPayloadHash(payload), expectedHash);
  assert.equal(
    await buildActionSignatureMessage({
      action: 'MPC_SESSION_CREATE',
      actor: '0xABC',
      timestamp: '1786062000000',
      requestId: 'action-1',
      payload,
    }),
    [
      'YeYing Market',
      'Action: mpc_session_create',
      'Actor: 0xabc',
      'Timestamp: 1786062000000',
      'RequestId: action-1',
      `PayloadHash: ${expectedHash}`,
    ].join('\n')
  );
});

test('MPC coordinator write requests include action signature fields', async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ code: 0, data: { id: 'session-1' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const client = new MpcCoordinatorClient({
      endpoint: 'http://127.0.0.1:8100',
      getToken: async () => 'ucan-token',
    });
    const signature = { requestId: 'action-1', timestamp: '1786062000000', signature: '0xsig' };
    await client.createSession({ type: 'keygen' }, signature);
    await client.joinSession('session-1', { participantId: '0xabc' }, signature);
    await client.sendMessage('session-1', { id: 'message-1' }, signature);

    assert.equal(requests.length, 3);
    requests.forEach((request) => {
      assert.equal(request.options.headers.Authorization, 'Bearer ucan-token');
      assert.equal(request.body.requestId, 'action-1');
      assert.equal(request.body.timestamp, '1786062000000');
      assert.equal(request.body.signature, '0xsig');
    });
    assert.deepEqual(requests[2].body.message, { id: 'message-1' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unset MPC session expiry is omitted instead of serialized as null', async () => {
  let requestBody;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ code: 0, data: { id: 'session-1' } }), { status: 200 });
  };
  try {
    const client = new MpcCoordinatorClient({ endpoint: 'http://127.0.0.1:8100' });
    await client.createSession({
      type: 'keygen',
      walletId: 'wallet-1',
      expiresAt: undefined,
    }, {
      requestId: 'action-1',
      timestamp: '1786062000000',
      signature: '0xsig',
    });
    assert.equal('expiresAt' in requestBody, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('MPC create session request preserves wallet name for invite payloads', async () => {
  let requestBody;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ code: 0, data: { id: 'session-1' } }), { status: 200 });
  };
  try {
    const client = new MpcCoordinatorClient({ endpoint: 'http://127.0.0.1:8100' });
    await client.createSession({
      type: 'keygen',
      name: '团队金库',
      walletId: 'wallet-1',
    }, {
      requestId: 'action-1',
      timestamp: '1786062000000',
      signature: '0xsig',
    });
    assert.equal(requestBody.name, '团队金库');
    assert.equal(requestBody.walletId, 'wallet-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
