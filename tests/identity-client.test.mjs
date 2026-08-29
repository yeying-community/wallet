import assert from 'node:assert/strict';
import test from 'node:test';

import { IdentityClient } from '../js/background/identity-client.js';

function response(payload, status = 400) {
  return {
    ok: false,
    status,
    statusText: 'Bad Request',
    async text() { return JSON.stringify(payload); }
  };
}

test('maps Node identity envelope username conflict to actionable error', async () => {
  const client = new IdentityClient({
    endpoint: 'http://localhost:8100',
    fetchImpl: async () => response({ code: 400, message: 'IDENTITY_USERNAME_TAKEN' })
  });

  await assert.rejects(
    () => client.requestIdentityVerification({ types: ['username'] }),
    error => {
      assert.equal(error.code, 'IDENTITY_USERNAME_TAKEN');
      assert.equal(error.message, '用户名已被占用，请更换用户名');
      return true;
    }
  );
});

test('does not treat numeric envelope code as identity error code', async () => {
  const client = new IdentityClient({
    endpoint: 'http://localhost:8100',
    fetchImpl: async () => response({ code: 400, message: '请求参数无效' })
  });

  await assert.rejects(
    () => client.requestIdentityVerification({}),
    error => {
      assert.equal(error.code, '');
      assert.equal(error.message, '请求参数无效');
      return true;
    }
  );
});
