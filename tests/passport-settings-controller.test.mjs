import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocument } from './_helpers/dom-stub.js';

let elements;
let PassportSettingsController;

function setup() {
  const dom = createDocument({
    passportEndpointInput: { tagName: 'input' },
    passportStatusText: { tagName: 'p' },
    passportIdentityBtn: { tagName: 'button' }
  });
  elements = dom.elements;
  globalThis.document = dom.document;
}

test.beforeEach(async () => {
  setup();
  PassportSettingsController ||= (await import('../js/controller/setting/passport-settings-controller.js')).PassportSettingsController;
});
test.afterEach(() => {
  delete globalThis.document;
  delete globalThis.fetch;
  delete globalThis.localStorage;
  delete globalThis.confirm;
});

test('loginAndUnlink performs recent SIWE auth and signs the one-time unlink message', async () => {
  elements.passportEndpointInput.value = 'http://127.0.0.1:8100';
  globalThis.confirm = () => true;
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => String(url).includes('/challenge')
      ? { code: 0, data: { challenge: 'login-message' } }
      : { code: 0, data: { token: 'short-jwt' } }
  });
  const signed = [];
  const confirmed = [];
  const controller = new PassportSettingsController({
    wallet: {
      getCurrentAccount: async () => ({ address: '0x1111111111111111111111111111111111111111' }),
      createPassportUnlink: async () => ({ success: true, unlink: { requestId: 'pun-1', timestamp: '2026-08-03T00:00:00Z', message: 'unlink-message' } }),
      confirmPassportUnlink: async (...args) => { confirmed.push(args); return { success: true }; }
    },
    transaction: { signMessage: async (message) => { signed.push(message); return `sig:${message}`; } },
    requestPassword: async () => 'wallet-password'
  });
  await controller.loginAndUnlink();
  assert.deepEqual(signed, ['login-message', 'unlink-message']);
  assert.deepEqual(confirmed[0][2], {
    requestId: 'pun-1', timestamp: '2026-08-03T00:00:00Z', signature: 'sig:unlink-message'
  });
});

test('load restores the default Node endpoint without probing the service', async () => {
  let called = false;
  const controller = new PassportSettingsController({
    wallet: { getPassportStatus: async () => { called = true; return { success: true, status: { enabled: true } }; } }
  });
  await controller.load();
  assert.equal(elements.passportEndpointInput.value, 'https://node.yeying.pub');
  assert.equal(called, false);
});

test('load restores a locally configured Node endpoint', async () => {
  const values = new Map([['passportNodeEndpoint', 'http://127.0.0.1:8100']]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
  const controller = new PassportSettingsController({
    wallet: { getPassportStatus: async () => ({ success: true, status: { enabled: true } }) }
  });
  await controller.load();
  assert.equal(elements.passportEndpointInput.value, 'http://127.0.0.1:8100');
});

test('loginAndBind signs the SIWE challenge and sends its short-lived token once', async () => {
  elements.passportEndpointInput.value = 'https://node.example';
  const fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    const data = String(url).includes('/challenge')
      ? { code: 0, data: { challenge: 'sign-this' } }
      : { code: 0, data: { token: 'short-jwt' } };
    return { ok: true, json: async () => data };
  };
  const bindingCalls = [];
  const controller = new PassportSettingsController({
    wallet: {
      getCurrentAccount: async () => ({ address: '0x1111111111111111111111111111111111111111' }),
      createPassportBinding: async (...args) => { bindingCalls.push(args); return { success: true, binding: { subjectId: 'subject-1' } }; }
    },
    transaction: { signMessage: async (message, password) => `${message}:${password}` },
    requestPassword: async () => 'wallet-password'
  });
  await controller.loginAndBind();
  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), {
    address: '0x1111111111111111111111111111111111111111'
  });
  assert.deepEqual(bindingCalls, [['https://node.example', 'short-jwt']]);
  assert.equal(elements.globalWaitingOverlay.classList.contains('hidden'), true);
});
