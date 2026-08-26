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
    walletIdentityTotpQrPage: { tagName: 'div' },
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
  assert.deepEqual(identityRequests, [{
    username: 'person',
    email: 'person@example.com',
    avatarUri: 'https://api.dicebear.com/9.x/identicon/svg?seed=0x1111111111111111111111111111111111111111'
  }]);
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
  assert.deepEqual(identityRequests, [{
    username: 'person',
    email: 'person@example.com',
    avatarUri: 'https://api.dicebear.com/9.x/identicon/svg?seed=0x1111111111111111111111111111111111111111'
  }]);
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
  assert.deepEqual(identityRequests, [{
    username: 'new-person',
    email: 'new@example.com',
    avatarUri: 'https://api.dicebear.com/9.x/identicon/svg?seed=0x1111111111111111111111111111111111111111'
  }]);
  assert.equal(elements.globalWaitingOverlay.classList.contains('hidden'), true);
});

test('submitIdentityEdit refreshes the identity detail page after a successful profile change', async () => {
  const dom = createDocument({
    walletIdentityEndpointInput: { tagName: 'input', value: 'https://node.example' },
    walletIdentityEditEndpoint: { tagName: 'input', value: 'https://node.example' },
    walletIdentityEditAddress: { tagName: 'select', value: '0x1111111111111111111111111111111111111111' },
    walletIdentityEditUsername: { tagName: 'input', value: 'new-person' },
    walletIdentityEditEmail: { tagName: 'input', value: 'New@Example.com' },
    walletIdentityEditAvatar: { tagName: 'input', value: 'https://avatar.example/new.png' },
    walletIdentityDetailPage: { tagName: 'div', _classes: 'page hidden' },
    walletIdentityEditPage: { tagName: 'div', _classes: 'page' },
    walletIdentityDetailStatusPage: { tagName: 'span', textContent: '已验证' },
    walletIdentityDetailUsernamePage: { tagName: 'span', textContent: 'old-person' },
    walletIdentityDetailEmailPage: { tagName: 'span', textContent: 'old@example.com' },
    walletIdentityDetailAvatarPage: { tagName: 'span' },
    walletIdentityDetailAvatarImagePage: { tagName: 'img' },
    walletIdentityDetailAddressPage: { tagName: 'span' },
    walletIdentityDetailDidPage: { tagName: 'span' },
    walletIdentityDetailEndpointPage: { tagName: 'span' }
  });
  elements = dom.elements;
  globalThis.document = dom.document;
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const makeCredential = (subject) => `${encode({ alg: 'none' })}.${encode({ vc: { credentialSubject: subject } })}.`;
  let credentials = [makeCredential({ username: 'old-person', email: 'old@example.com' })];
  const controller = new WalletIdentitySettingsController({
    wallet: {
      getCurrentAccount: async () => ({ address: '0x1111111111111111111111111111111111111111' }),
      listIdentities: async () => ({ selectedIdentityId: 'wid_1', identities: [{ document: { walletIdentityId: 'wid_1' } }] }),
      getIdentity: async () => ({ document: { id: 'did:yeying:wid_1', walletIdentityId: 'wid_1' } }),
      listIdentityCredentials: async () => ({ credentials })
    }
  });
  controller.requestAndConfirmIdentity = async ({ username, email, avatarUri }) => {
    credentials = [makeCredential({ username, email, avatarUri })];
    return true;
  };
  controller.renderIdentityVerificationAction = async () => {};
  controller.refreshIdentityPasskeySummary = async () => {};
  controller.refreshIdentityTotpSummary = async () => {};

  await controller.submitIdentityEdit();

  assert.equal(elements.walletIdentityDetailUsernamePage.textContent, 'new-person');
  assert.equal(elements.walletIdentityDetailEmailPage.textContent, 'new@example.com');
  assert.equal(elements.walletIdentityDetailAvatarImagePage.src, 'https://avatar.example/new.png');
  assert.equal(elements.walletIdentityDetailPage.classList.contains('hidden'), false);
});

test('identity detail compact values copy their full values', async () => {
  const address = '0x1111111111111111111111111111111111111111';
  const did = 'did:yeying:wallet:1234567890abcdefghijklmnopqrstuvwxyz';
  const avatarUri = 'https://avatar.example/person.png';
  const dom = createDocument({
    walletIdentityEndpointInput: { tagName: 'input', value: 'https://node.example' },
    walletIdentityDetailPage: { tagName: 'div', _classes: 'page hidden' },
    walletIdentityDetailStatusPage: { tagName: 'span' },
    walletIdentityDetailUsernamePage: { tagName: 'span' },
    walletIdentityDetailEmailPage: { tagName: 'span' },
    walletIdentityDetailAvatarPage: { tagName: 'span' },
    walletIdentityDetailAvatarImagePage: { tagName: 'img' },
    walletIdentityDetailAddressPage: { tagName: 'span' },
    walletIdentityDetailDidPage: { tagName: 'span' },
    walletIdentityDetailEndpointPage: { tagName: 'span' }
  });
  elements = dom.elements;
  globalThis.document = dom.document;
  const copied = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async (value) => copied.push(value) } }
  });
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const makeCredential = (subject) => `${encode({ alg: 'none' })}.${encode({ vc: { credentialSubject: subject } })}.`;
  const controller = new WalletIdentitySettingsController({
    wallet: {
      getCurrentAccount: async () => ({ address }),
      listIdentities: async () => ({ selectedIdentityId: 'wid_1', identities: [{ document: { walletIdentityId: 'wid_1' } }] }),
      getIdentity: async () => ({ document: { id: did, walletIdentityId: 'wid_1' } }),
      listIdentityCredentials: async () => ({
        credentials: [makeCredential({ username: 'person', email: 'person@example.com', avatarUri })]
      })
    }
  });
  controller.refreshIdentityPasskeySummary = async () => {};
  controller.refreshIdentityTotpSummary = async () => {};
  controller.bindEvents();

  await controller.openIdentityDetails();

  assert.equal(elements.walletIdentityDetailAddressPage.textContent, '0x1111111111...11111111');
  assert.equal(elements.walletIdentityDetailAddressPage.dataset.copyValue, address);
  assert.equal(elements.walletIdentityDetailDidPage.textContent, 'did:yeying:wallet:...qrstuvwxyz');
  assert.equal(elements.walletIdentityDetailDidPage.dataset.copyValue, did);
  assert.equal(elements.walletIdentityDetailAvatarPage.dataset.copyValue, avatarUri);

  elements.walletIdentityDetailAddressPage.click();
  elements.walletIdentityDetailDidPage.click();
  elements.walletIdentityDetailAvatarPage.click();

  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(copied, [address, did, avatarUri]);
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

test('requestAndConfirmIdentity requests an avatar credential when avatar URI is provided', async () => {
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
  const verificationRequests = [];
  const verificationConfirms = [];
  const controller = new WalletIdentitySettingsController({
    wallet: {
      getCurrentAccount: async () => ({ address, chainId: 1 }),
      listIdentities: async () => ({ selectedIdentityId: 'wid_1', identities: [{ document: { walletIdentityId: 'wid_1' } }] }),
      selectIdentity: async () => {},
      exportIdentityDocument: async () => ({ document: { id: 'did:yeying:wid_1', walletIdentityId: 'wid_1' } }),
      signIdentityDocument: async (document) => ({ ...document, id: document.id || 'did:yeying:wid_1' }),
      requestIdentityVerification: async (requestEndpoint, body) => {
        verificationRequests.push([requestEndpoint, body]);
        return { verificationId: 'verification-1', email: 'person@example.com' };
      },
      confirmIdentityVerification: async (...args) => {
        verificationConfirms.push(args);
        return { credentials: [{ type: 'EmailCredential' }, { type: 'UsernameCredential' }, { type: 'AvatarCredential' }] };
      }
    },
    transaction: { signMessage: async () => 'account-signature' },
    requestPassword: async () => 'wallet-password'
  });
  controller.promptVerificationCode = async () => '123456';

  const completed = await controller.requestAndConfirmIdentity({
    username: 'person',
    email: 'person@example.com',
    avatarUri: 'https://avatar.example/person.png'
  });

  assert.equal(completed, true);
  assert.deepEqual(verificationRequests[0][1].types, ['email', 'username', 'avatar']);
  assert.equal(verificationRequests[0][1].avatarUri, 'https://avatar.example/person.png');
  assert.deepEqual(verificationConfirms[0], [endpoint, 'verification-1', '123456', ['email', 'username', 'avatar']]);
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
