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

test('loginAndUnlink clears local identity verification state', async () => {
  elements.passportEndpointInput.value = 'http://127.0.0.1:8100';
  const values = new Map([
    ['passportIdentityBinding:http://127.0.0.1:8100:0x1111111111111111111111111111111111111111', 'complete'],
    ['passportEmailVerification:http://127.0.0.1:8100:0x1111111111111111111111111111111111111111', '{"verificationId":"v1"}']
  ]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  const controller = new PassportSettingsController({
    wallet: {
      getCurrentAccount: async () => ({ address: '0x1111111111111111111111111111111111111111' }),
    }
  });
  controller.renderBindingAction = async () => {};
  await controller.loginAndUnlink();
  assert.equal(values.has('passportIdentityBinding:http://127.0.0.1:8100:0x1111111111111111111111111111111111111111'), false);
  assert.equal(values.has('passportEmailVerification:http://127.0.0.1:8100:0x1111111111111111111111111111111111111111'), false);
});

test('load restores the default Node endpoint without probing the old Passport service', async () => {
  const controller = new PassportSettingsController({
    wallet: {
      getCurrentAccount: async () => null,
      listIdentities: async () => ({ identities: [], selectedIdentityId: '' }),
      getWalletList: async () => []
    }
  });
  await controller.load();
  assert.equal(elements.passportEndpointInput.value, 'https://node.yeying.pub');
});

test('load restores a locally configured Node endpoint', async () => {
  const values = new Map([['passportNodeEndpoint', 'http://127.0.0.1:8100']]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
  const controller = new PassportSettingsController({
    wallet: {}
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

test('continueEmailVerification resumes the stored verification without relinking the account', async () => {
  const endpoint = 'http://127.0.0.1:8100';
  const address = '0x1111111111111111111111111111111111111111';
  elements.passportEndpointInput.value = endpoint;
  const verificationKey = `passportEmailVerification:${endpoint}:${address.toLowerCase()}`;
  const values = new Map([[verificationKey, JSON.stringify({
    verificationId: 'verification-1',
    username: 'person',
    email: 'person@example.com'
  })]]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  const confirms = [];
  const controller = new PassportSettingsController({
    wallet: {
      getCurrentAccount: async () => ({ address }),
      confirmIdentityVerification: async (...args) => {
        confirms.push(args);
        return { credentials: [{ type: 'EmailCredential' }, { type: 'UsernameCredential' }] };
      }
    }
  });
  controller.promptVerificationCode = async () => '123456';
  controller.requestAndConfirmIdentity = async () => { throw new Error('account link must not be retried'); };
  controller.renderBindingAction = async () => {};

  await controller.continueEmailVerification();

  assert.deepEqual(confirms, [[endpoint, 'verification-1', '123456', ['email', 'username']]]);
  assert.equal(values.has(verificationKey), false);
  assert.equal(values.get(`passportIdentityBinding:${endpoint}:${address}`), 'complete');
});
