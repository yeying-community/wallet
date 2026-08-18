import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocument } from './_helpers/dom-stub.js';

let elements;
let PassportSettingsController;

function setup() {
  const dom = createDocument({
    passportEndpointInput: { tagName: 'input' },
    passportStatusText: { tagName: 'p' },
    passportIdentityBtn: { tagName: 'button' },
    passportUnlinkBtn: { tagName: 'button' },
    passportEmailStatusText: { tagName: 'p' },
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
  delete globalThis.prompt;
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

test('loginAndBind prompts for email and code before completing the binding', async () => {
  elements.passportEndpointInput.value = 'https://node.example';
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  const fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    const data = String(url).includes('/challenge')
      ? { code: 0, data: { challenge: 'sign-this' } }
      : { code: 0, data: { token: 'short-jwt' } };
    return { ok: true, json: async () => data };
  };
  const prompts = ['person', 'Person@Example.com', '123456'];
  globalThis.prompt = () => prompts.shift();
  const bindingCalls = [];
  const emailRequests = [];
  const confirms = [];
  const controller = new PassportSettingsController({
    wallet: {
      getCurrentAccount: async () => ({ address: '0x1111111111111111111111111111111111111111' }),
      createPassportBinding: async (...args) => { bindingCalls.push(args); return { success: true, binding: { subjectId: 'subject-1' } }; },
      setPassportUsername: async (...args) => ({ success: true, username: { username: args[2], usernameVerified: true } }),
      requestPassportEmailVerification: async (...args) => {
        emailRequests.push(args);
        return { success: true, verification: { verificationId: 'pev-1', emailHint: 'p***@example.com' } };
      },
      confirmPassportEmailVerification: async (...args) => {
        confirms.push(args);
        return { success: true, verification: { email: 'person@example.com' } };
      }
    },
    transaction: { signMessage: async (message, password) => `${message}:${password}` },
    requestPassword: async () => 'wallet-password'
  });
  const identityRequests = [];
  controller.promptUsername = async () => 'person';
  controller.promptEmail = async () => 'person@example.com';
  controller.requestAndConfirmIdentity = async (input) => {
    identityRequests.push(input);
    return true;
  };
  await controller.loginAndBind();
  assert.deepEqual(identityRequests, [{ username: 'person', email: 'person@example.com' }]);
  assert.equal(elements.globalWaitingOverlay.classList.contains('hidden'), true);
});

test('cancelled or missing verification code keeps the binding pending', async () => {
  elements.passportEndpointInput.value = 'https://node.example';
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => String(url).includes('/challenge')
      ? { code: 0, data: { challenge: 'sign-this' } }
      : { code: 0, data: { token: 'short-jwt' } }
  });
  const prompts = ['person', 'Person@Example.com', null];
  globalThis.prompt = () => prompts.shift();
  const requests = [];
  const bindings = [];
  const controller = new PassportSettingsController({
    wallet: {
      getCurrentAccount: async () => ({ address: '0x1111111111111111111111111111111111111111' }),
      createPassportBinding: async (...args) => {
        bindings.push(args);
        return { success: true, binding: { subjectId: 'subject-1' } };
      },
      setPassportUsername: async (...args) => ({ success: true, username: { username: args[2], usernameVerified: true } }),
      requestPassportEmailVerification: async (...args) => {
        requests.push(args);
        return { success: true, verification: { verificationId: 'pev-1', emailHint: 'p***@example.com' } };
      }
    },
    transaction: { signMessage: async (message, password) => `${message}:${password}` },
    requestPassword: async () => 'wallet-password'
  });
  const identityRequests = [];
  controller.promptUsername = async () => 'person';
  controller.promptEmail = async () => 'person@example.com';
  controller.requestAndConfirmIdentity = async (input) => {
    identityRequests.push(input);
    return false;
  };
  await controller.loginAndBind();
  assert.deepEqual(identityRequests, [{ username: 'person', email: 'person@example.com' }]);
  assert.equal(elements.globalWaitingOverlay.classList.contains('hidden'), true);
});

test('changePassportEmail prompts for a new email and verifies it', async () => {
  elements.passportEndpointInput.value = 'https://node.example';
  const values = new Map([
    ['passportIdentityBinding:https://node.example:0x1111111111111111111111111111111111111111', 'complete']
  ]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => String(url).includes('/challenge')
      ? { code: 0, data: { challenge: 'sign-this' } }
      : { code: 0, data: { token: 'short-jwt' } }
  });
  const prompts = ['new-person', 'New@Example.com', '654321'];
  globalThis.prompt = () => prompts.shift();
  const requests = [];
  const confirms = [];
  const controller = new PassportSettingsController({
    wallet: {
      getCurrentAccount: async () => ({ address: '0x1111111111111111111111111111111111111111' }),
      setPassportUsername: async (...args) => ({ success: true, username: { username: args[2], usernameVerified: true } }),
      requestPassportEmailVerification: async (...args) => {
        requests.push(args);
        return { success: true, verification: { verificationId: 'pev-2', emailHint: 'n***@example.com' } };
      },
      confirmPassportEmailVerification: async (...args) => {
        confirms.push(args);
        return { success: true, verification: { email: 'new@example.com' } };
      }
    },
    transaction: { signMessage: async (message, password) => `${message}:${password}` },
    requestPassword: async () => 'wallet-password'
  });
  const identityRequests = [];
  controller.promptUsername = async () => 'new-person';
  controller.promptEmail = async () => 'new@example.com';
  controller.requestAndConfirmIdentity = async (input) => {
    identityRequests.push(input);
    return true;
  };
  await controller.changePassportIdentity();
  assert.deepEqual(identityRequests, [{ username: 'new-person', email: 'new@example.com' }]);
  assert.equal(elements.globalWaitingOverlay.classList.contains('hidden'), true);
});
