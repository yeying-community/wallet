import assert from 'node:assert/strict';
import test from 'node:test';

import { ethers } from '../../lib/ethers-6.16.esm.min.js';
import { PassportClient } from '../../js/background/passport-client.js';

const endpoint = process.env.PASSPORT_NODE_ENDPOINT || 'http://127.0.0.1:8100';
const testPrivateKey = process.env.PASSPORT_TEST_PRIVATE_KEY
  || '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

async function post(path, body) {
  const response = await fetch(new URL(path, endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'omit'
  });
  const payload = await response.json();
  assert.equal(response.ok, true, payload?.message || `HTTP ${response.status}`);
  assert.equal(payload.code, 0, payload?.message || 'Node request failed');
  return payload.data;
}

test('local Node completes SIWE authentication and Passport wallet binding', { timeout: 15_000 }, async () => {
  const signer = new ethers.Wallet(testPrivateKey);
  const challenge = await post('/api/v1/public/auth/challenge', { address: signer.address });
  assert.equal(typeof challenge?.challenge, 'string');

  const signature = await signer.signMessage(challenge.challenge);
  const session = await post('/api/v1/public/auth/verify', { address: signer.address, signature });
  assert.equal(typeof session?.token, 'string');

  const client = new PassportClient({ endpoint, getToken: () => session.token });
  const service = await client.getStatus();
  assert.equal(service.enabled, true);
  assert.equal(service.passkey?.ready, true);

  const binding = await client.createBindingRequest();
  assert.match(binding.subjectId, /^sub_/);
  assert.equal(binding.walletAddress.toLowerCase(), signer.address.toLowerCase());

  const bindings = await client.listBindings();
  assert.equal(bindings.subjectId, binding.subjectId);
  assert.equal(bindings.walletBindings.some((item) => item.address.toLowerCase() === signer.address.toLowerCase()), true);
});
