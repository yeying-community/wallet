import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handleApprovePassportAuthorization,
  handleConfirmPassportEmailVerification,
  handleCreatePassportBinding,
  handleGetPassportBindings,
  handleGetPassportStatus,
  handleRequestPassportEmailVerification
} from '../js/background/operations/passport.js';

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: '', text: async () => JSON.stringify(data) };
}

test('passport operations call the Node contract without persisting the bearer token', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return response({ code: 0, data: { subjectId: 'subject-1' } });
  };
  const data = { endpoint: 'https://node.example', accessToken: 'siwe-jwt' };

  assert.equal((await handleGetPassportStatus({ endpoint: data.endpoint }, { fetchImpl })).success, true);
  assert.equal((await handleCreatePassportBinding(data, { fetchImpl })).binding.subjectId, 'subject-1');
  assert.equal((await handleGetPassportBindings(data, { fetchImpl })).success, true);
  assert.equal((await handleRequestPassportEmailVerification({ ...data, email: 'person@example.com' }, { fetchImpl })).success, true);
  assert.equal((await handleConfirmPassportEmailVerification({ ...data, verificationId: 'pev-1', code: '123456' }, { fetchImpl })).success, true);
  assert.equal((await handleApprovePassportAuthorization({ ...data, requestId: 'request-1' }, { fetchImpl })).success, true);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer siwe-jwt');
  assert.deepEqual(JSON.parse(calls[4].options.body), { verificationId: 'pev-1', code: '123456' });
  assert.deepEqual(JSON.parse(calls[5].options.body), { requestId: 'request-1' });
});

test('passport operations expose Node errors without throwing through the popup channel', async () => {
  const result = await handleCreatePassportBinding(
    { endpoint: 'https://node.example', accessToken: 'expired' },
    { fetchImpl: async () => response({ code: 401, message: 'Invalid token' }, 401) }
  );
  assert.deepEqual(result, {
    success: false,
    error: 'Invalid token',
    errorCode: '401',
    status: 401
  });
});
