import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocument } from './_helpers/dom-stub.js';

let elements;
let WalletIdentitySettingsController;

function setup() {
  const dom = createDocument({
    walletIdentityEndpointInput: { tagName: 'input' },
    walletIdentityStatusText: { tagName: 'p' },
    walletIdentityVerifyBtn: { tagName: 'button' },
    walletIdentityClearVerificationBtn: { tagName: 'button' },
    walletIdentityEmailStatusText: { tagName: 'p' },
    walletIdentityTotpStatusPage: { tagName: 'p' },
    walletIdentityTotpSetupPage: { tagName: 'div' },
    walletIdentityTotpSecretPage: { tagName: 'div' },
    walletIdentityTotpUriPage: { tagName: 'div' },
    walletIdentityTotpCodeInput: { tagName: 'input' },
    setupWalletIdentityTotpBtn: { tagName: 'button' },
    revokeWalletIdentityTotpBtn: { tagName: 'button' },
  });
  elements = dom.elements;
  globalThis.document = dom.document;
}

test.beforeEach(async () => {
  setup();
  WalletIdentitySettingsController ||= (await import('../js/controller/setting/wallet-identity-settings-controller.js')).WalletIdentitySettingsController;
});
test.afterEach(() => {
  delete globalThis.document;
  delete globalThis.fetch;
  delete globalThis.localStorage;
  delete globalThis.confirm;
  delete globalThis.prompt;
  delete globalThis.PublicKeyCredential;
  delete globalThis.navigator;
});

test('clearIdentityVerification clears local identity verification state', async () => {
  elements.walletIdentityEndpointInput.value = 'http://127.0.0.1:8100';
  const values = new Map([
    ['walletIdentityVerification:http://127.0.0.1:8100:0x1111111111111111111111111111111111111111', 'complete'],
    ['walletIdentityEmailVerification:http://127.0.0.1:8100:0x1111111111111111111111111111111111111111', '{"verificationId":"v1"}']
  ]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  const controller = new WalletIdentitySettingsController({
    wallet: {
      getCurrentAccount: async () => ({ address: '0x1111111111111111111111111111111111111111' }),
    }
  });
  controller.renderIdentityVerificationAction = async () => {};
  await controller.clearIdentityVerification();
  assert.equal(values.has('walletIdentityVerification:http://127.0.0.1:8100:0x1111111111111111111111111111111111111111'), false);
  assert.equal(values.has('walletIdentityEmailVerification:http://127.0.0.1:8100:0x1111111111111111111111111111111111111111'), false);
});

test('load restores the default Node endpoint without probing the wallet identity service', async () => {
  const controller = new WalletIdentitySettingsController({
    wallet: {
      getCurrentAccount: async () => null,
      listIdentities: async () => ({ identities: [], selectedIdentityId: '' }),
      getWalletList: async () => []
    }
  });
  await controller.load();
  assert.equal(elements.walletIdentityEndpointInput.value, 'https://node.yeying.pub');
});

test('load restores a locally configured Node endpoint', async () => {
  const values = new Map([['walletIdentityNodeEndpoint', 'http://127.0.0.1:8100']]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
  const controller = new WalletIdentitySettingsController({
    wallet: {}
  });
  await controller.load();
  assert.equal(elements.walletIdentityEndpointInput.value, 'http://127.0.0.1:8100');
});

test('startIdentityVerification prompts for email and code before completing the verification', async () => {
  elements.walletIdentityEndpointInput.value = 'https://node.example';
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
  const verificationCalls = [];
  const emailRequests = [];
  const confirms = [];
  const controller = new WalletIdentitySettingsController({
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
  await controller.startIdentityVerification();
  assert.deepEqual(identityRequests, [{ username: 'person', email: 'person@example.com' }]);
  assert.equal(elements.globalWaitingOverlay.classList.contains('hidden'), true);
});

test('cancelled or missing verification code keeps the verification pending', async () => {
  elements.walletIdentityEndpointInput.value = 'https://node.example';
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
  const controller = new WalletIdentitySettingsController({
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
  await controller.startIdentityVerification();
  assert.deepEqual(identityRequests, [{ username: 'person', email: 'person@example.com' }]);
  assert.equal(elements.globalWaitingOverlay.classList.contains('hidden'), true);
});

test('changeWalletIdentity prompts for new profile data and verifies it', async () => {
  elements.walletIdentityEndpointInput.value = 'https://node.example';
  const values = new Map([
    ['walletIdentityVerification:https://node.example:0x1111111111111111111111111111111111111111', 'complete']
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
  const controller = new WalletIdentitySettingsController({
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
  await controller.changeWalletIdentity();
  assert.deepEqual(identityRequests, [{ username: 'new-person', email: 'new@example.com' }]);
  assert.equal(elements.globalWaitingOverlay.classList.contains('hidden'), true);
});

test('continueEmailVerification resumes the stored verification without relinking the account', async () => {
  const endpoint = 'http://127.0.0.1:8100';
  const address = '0x1111111111111111111111111111111111111111';
  elements.walletIdentityEndpointInput.value = endpoint;
  const verificationKey = `walletIdentityEmailVerification:${endpoint}:${address.toLowerCase()}`;
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
  const controller = new WalletIdentitySettingsController({
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
  controller.renderIdentityVerificationAction = async () => {};

  await controller.continueEmailVerification();

  assert.deepEqual(confirms, [[endpoint, 'verification-1', '123456', ['email', 'username']]]);
  assert.equal(values.has(verificationKey), false);
  assert.equal(values.get(`walletIdentityVerification:${endpoint}:${address}`), 'complete');
});

test('requestAndConfirmIdentity completes wallet identity verification without auto-registering passkey', async () => {
  const endpoint = 'http://127.0.0.1:8100';
  const address = '0x1111111111111111111111111111111111111111';
  elements.walletIdentityEndpointInput.value = endpoint;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => String(url).includes('/account-links/challenge')
      ? { code: 0, data: { message: 'link-message', nonce: 'n1', issuedAt: 'now', expiresAt: 'later' } }
      : { code: 0, data: { verifiedAt: 'now' } }
  });
  const controller = new WalletIdentitySettingsController({
    wallet: {
      getCurrentAccount: async () => ({ address, chainId: 1 }),
      listIdentities: async () => ({ selectedIdentityId: 'wid_1', identities: [{ document: { walletIdentityId: 'wid_1' } }] }),
      selectIdentity: async () => {},
      exportIdentityDocument: async () => ({ document: { id: 'did:yeying:wid_1', walletIdentityId: 'wid_1' } }),
      signIdentityDocument: async (document) => ({ ...document, id: document.id || 'did:yeying:wid_1' }),
      requestIdentityVerification: async () => ({ verificationId: 'verification-1', email: 'person@example.com' }),
      confirmIdentityVerification: async () => ({ credentials: [{ type: 'EmailCredential' }, { type: 'UsernameCredential' }] })
    },
    transaction: { signMessage: async () => 'account-signature' },
    requestPassword: async () => 'wallet-password'
  });
  controller.promptVerificationCode = async () => '123456';
  controller.tryEnsureIdentityPasskey = async () => { throw new Error('passkey must be optional'); };

  const completed = await controller.requestAndConfirmIdentity({ username: 'person', email: 'person@example.com' });

  assert.equal(completed, true);
  assert.equal(values.get(`walletIdentityVerification:${endpoint}:${address}`), 'complete');
});

test('registerIdentityPasskey registers a new passkey from the verified identity detail flow', async () => {
  const endpoint = 'http://127.0.0.1:8100';
  elements.walletIdentityEndpointInput.value = endpoint;
  globalThis.PublicKeyCredential = function PublicKeyCredential() {};
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      credentials: {
        create: async () => ({
          id: 'credential-1',
          rawId: new Uint8Array([1, 2, 3]).buffer,
          type: 'public-key',
          response: {
            attestationObject: new Uint8Array([4, 5, 6]).buffer,
            clientDataJSON: new Uint8Array([7, 8, 9]).buffer,
            getTransports: () => ['internal']
          },
          getClientExtensionResults: () => ({})
        })
      }
    }
  });
  const fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    if (String(url).includes('/passkeys/register/request')) {
      return { ok: true, json: async () => ({ code: 0, data: { passkeyRequest: {
        requestId: 'pkr_1',
        challenge: 'AQID',
        rp: { id: 'localhost', name: 'Node' },
        user: { id: 'BAUG', name: 'did:yeying:wid_1', displayName: 'YeYing Identity' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        timeout: 60000,
        attestation: 'none',
        excludeCredentials: []
      } } }) };
    }
    if (String(url).includes('/passkeys/register/confirm')) {
      return { ok: true, json: async () => ({ code: 0, data: { credentialId: 'credential-1' } }) };
    }
    if (String(url).includes('/passkeys/list')) {
      return { ok: true, json: async () => ({ code: 0, data: { credentials: [] } }) };
    }
    return { ok: false, status: 404, json: async () => ({ code: 404, message: 'not found' }) };
  };
  const controller = new WalletIdentitySettingsController({
    wallet: {
      listIdentities: async () => ({ selectedIdentityId: 'wid_1', identities: [{ document: { walletIdentityId: 'wid_1' } }] }),
      exportIdentityDocument: async () => ({ document: { id: 'did:yeying:wid_1', walletIdentityId: 'wid_1' } }),
      signIdentityDocument: async (document) => ({ ...document, id: document.id || 'did:yeying:wid_1' })
    },
    requestPassword: async () => 'wallet-password'
  });

  await controller.registerIdentityPasskey();

  assert.equal(fetchCalls.some(call => call.url.endsWith('/api/v1/public/identity/passkeys/register/request')), true);
  assert.equal(fetchCalls.some(call => call.url.endsWith('/api/v1/public/identity/passkeys/register/confirm')), true);
});

test('setup and confirm identity TOTP from the verified identity detail flow', async () => {
  const endpoint = 'http://127.0.0.1:8100';
  elements.walletIdentityEndpointInput.value = endpoint;
  const fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    if (String(url).includes('/identity/totp/setup')) {
      return { ok: true, json: async () => ({ code: 0, data: { totp: { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/YeYing' } } }) };
    }
    if (String(url).includes('/identity/totp/confirm')) {
      return { ok: true, json: async () => ({ code: 0, data: { totp: { enabled: true, status: 'active', deviceName: 'TOTP 验证器' } } }) };
    }
    if (String(url).includes('/identity/totp/get')) {
      return { ok: true, json: async () => ({ code: 0, data: { totp: { enabled: true, status: 'active', deviceName: 'TOTP 验证器' } } }) };
    }
    return { ok: false, status: 404, json: async () => ({ code: 404, message: 'not found' }) };
  };
  const controller = new WalletIdentitySettingsController({
    wallet: {
      listIdentities: async () => ({ selectedIdentityId: 'wid_1', identities: [{ document: { walletIdentityId: 'wid_1' } }] }),
      exportIdentityDocument: async () => ({ document: { id: 'did:yeying:wid_1', walletIdentityId: 'wid_1' } }),
      signIdentityDocument: async (document) => ({ ...document, id: document.id || 'did:yeying:wid_1' })
    },
    requestPassword: async () => 'wallet-password'
  });

  await controller.setupIdentityTotp();
  assert.equal(elements.walletIdentityTotpSecretPage.textContent, 'Secret：JBSWY3DPEHPK3PXP');
  assert.equal(fetchCalls.some(call => call.url.endsWith('/api/v1/public/identity/totp/setup')), true);

  elements.walletIdentityTotpCodeInput.value = '123456';
  await controller.confirmIdentityTotp();

  assert.equal(fetchCalls.some(call => call.url.endsWith('/api/v1/public/identity/totp/confirm')), true);
  assert.equal(elements.walletIdentityTotpStatusPage.textContent, '已启用：TOTP 验证器');
});
