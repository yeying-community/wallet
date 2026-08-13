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
  await controller.loginAndBind();
  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), {
    address: '0x1111111111111111111111111111111111111111'
  });
  assert.deepEqual(bindingCalls, [['https://node.example', 'short-jwt']]);
  assert.deepEqual(emailRequests[0], ['https://node.example', 'short-jwt', 'person@example.com']);
  assert.deepEqual(confirms[0], ['https://node.example', 'short-jwt', 'pev-1', '123456']);
  assert.equal(elements.passportStatusText.textContent, '当前钱包已完成验证，钱包：0x1111...1111。可变更验证用户名和邮箱；如需重新建立验证，请移除验证服务关联后再验证。');
  assert.equal(elements.passportEmailStatusText.textContent, '验证邮箱已确认：person@example.com');
  assert.equal(elements.passportIdentityBtn.textContent, '变更验证资料');
  assert.equal(elements.passportUnlinkBtn.classList.contains('hidden'), false);
  assert.equal(elements.passportStatusText.textContent.includes('subject-1'), false);
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
  await controller.loginAndBind();
  assert.deepEqual(bindings[0], ['https://node.example', 'short-jwt']);
  assert.deepEqual(requests[0], ['https://node.example', 'short-jwt', 'person@example.com']);
  assert.equal(elements.passportStatusText.textContent, '钱包控制权已确认，但邮箱尚未验证。请继续验证，钱包：0x1111...1111');
  assert.equal(elements.passportIdentityBtn.textContent, '继续验证');
  assert.equal(elements.passportUnlinkBtn.classList.contains('hidden'), false);
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
  await controller.load();
  await controller.handleIdentityAction();
  assert.deepEqual(requests[0], ['https://node.example', 'short-jwt', 'new@example.com']);
  assert.deepEqual(confirms[0], ['https://node.example', 'short-jwt', 'pev-2', '654321']);
  assert.equal(elements.passportEmailStatusText.textContent, '验证邮箱已确认：new@example.com');
  assert.equal(elements.passportIdentityBtn.textContent, '变更验证资料');
});
