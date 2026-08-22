import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './_helpers/dom-stub.js';
import { showPage } from '../js/common/ui/index.js';
import { CreateWalletController } from '../js/controller/wallet/create-wallet-controller.js';

function setup() {
  const { document, elements } = createDocument({
    setPasswordPage: { tagName: 'div', _classes: 'page', dataset: { origin: 'accounts' } },
    accountsPage: { tagName: 'div', _classes: 'page hidden' },
    setWalletName: { tagName: 'input', value: '家庭钱包' },
    newPassword: { tagName: 'input', value: 'must-not-persist' },
    confirmPassword: { tagName: 'input', value: 'must-not-persist' },
    createWalletTypeSelect: { tagName: 'select', value: 'mpc' },
    mpcCreateThresholdInput: { tagName: 'input', value: '2' },
    mpcCreateCurveSelect: { tagName: 'select', value: 'secp256k1' },
    mpcCreateCoordinatorEndpointInput: { tagName: 'input', value: 'http://127.0.0.1:8100' },
    mpcAdvancedOptions: { tagName: 'details', _classes: 'mpc-advanced-options', open: true },
  });
  globalThis.document = document;
  showPage('setPasswordPage');
  return elements;
}

test.afterEach(() => {
  delete globalThis.document;
  delete globalThis.chrome;
});

test('MPC 创建草稿保留非敏感表单，不包含密码', () => {
  setup();
  const controller = new CreateWalletController({ wallet: {}, onCreated: null });
  controller.selectedMpcParticipants = ['0x1111111111111111111111111111111111111111'];

  const draft = controller.buildDraft();
  assert.equal(draft.walletType, 'mpc');
  assert.equal(draft.name, '家庭钱包');
  assert.equal(draft.threshold, '2');
  assert.deepEqual(draft.participants, ['0x1111111111111111111111111111111111111111']);
  assert.doesNotMatch(JSON.stringify(draft), /must-not-persist/);
  assert.equal('password' in draft, false);
  assert.equal('ucanToken' in draft, false);
});

test('MPC 创建草稿写入并清除 chrome.storage.session', async () => {
  setup();
  const stored = {};
  globalThis.chrome = {
    storage: {
      session: {
        async set(values) { Object.assign(stored, values); },
        async remove(key) { delete stored[key]; },
      },
    },
  };
  const controller = new CreateWalletController({ wallet: {}, onCreated: null });

  await controller.saveDraft();
  assert.equal('walletId' in stored.createWalletDraft, false);
  await controller.clearDraft();
  assert.equal(stored.createWalletDraft, undefined);
});

test('从账户管理取消创建时委派标准账户列表入口', async () => {
  setup();
  let opened = 0;
  const controller = new CreateWalletController({
    wallet: {},
    onCreated: null,
    onReturnToAccounts: async () => { opened += 1; },
  });

  await controller.handleCancel();
  assert.equal(opened, 1);
});

test('创建钱包默认名称使用钱包类型和4位随机数字', () => {
  setup();
  const controller = new CreateWalletController({ wallet: {}, onCreated: null });

  const hdName = controller.generateDefaultWalletName('hd');
  const mpcName = controller.generateDefaultWalletName('mpc');

  assert.match(hdName, /^hd-\d{4}$/);
  assert.match(mpcName, /^mpc-\d{4}$/);
});

test('创建 HD 钱包使用独立密码框，不读取创建页面密码输入', async () => {
  const { document, elements } = createDocument({
    setPasswordPage: { tagName: 'div', _classes: 'page', dataset: { origin: 'welcome' } },
    walletPage: { tagName: 'div', _classes: 'page hidden' },
    setWalletName: { tagName: 'input', value: 'hd-1235' },
    newPassword: { tagName: 'input', value: 'must-not-use' },
    confirmPassword: { tagName: 'input', value: 'must-not-use' },
    createWalletTypeSelect: { tagName: 'select', value: 'hd' },
    mpcCreateThresholdInput: { tagName: 'input', value: '' },
    mpcCreateCurveSelect: { tagName: 'select', value: 'secp256k1' },
    mpcCreateCoordinatorEndpointInput: { tagName: 'input', value: '' },
  });
  globalThis.document = document;
  showPage('setPasswordPage');
  let created = null;
  let refreshed = 0;
  const controller = new CreateWalletController({
    wallet: {
      createHDWallet: async (name, password) => {
        created = { name, password };
      },
    },
    onCreated: async () => { refreshed += 1; },
    promptPassword: async () => 'prompt-password',
  });

  await controller.handleCreateWallet();

  assert.deepEqual(created, { name: 'hd-1235', password: 'prompt-password' });
  assert.equal(refreshed, 1);
  assert.equal(elements.walletPage.classList.contains('hidden'), false);
});
