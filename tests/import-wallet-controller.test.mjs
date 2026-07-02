/**
 * ImportWalletController DOM tests.
 * 运行：npm test
 *
 * 覆盖导入页复用时的敏感字段清理，避免助记词/私钥/密码在不同入口之间残留。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './_helpers/dom-stub.js';
import { setPageOrigin } from '../js/common/ui/index.js';
import { clearImportWalletForm, ImportWalletController } from '../js/controller/wallet/import-wallet-controller.js';
import { WelcomeController } from '../js/controller/welcome-controller.js';
import { AccountListController } from '../js/controller/account/account-list-controller.js';

let elements;

function setupDom() {
  const doc = createDocument({
    importPage: { tagName: 'div' },
    welcomePage: { tagName: 'div' },
    accountsPage: { tagName: 'div' },
    walletPage: { tagName: 'div' },
    importAccountName: { tagName: 'input' },
    importMnemonic: { tagName: 'textarea' },
    importPrivateKey: { tagName: 'input' },
    importWalletPassword: { tagName: 'input' },
    importPasswordLabel: { tagName: 'label' },
    mnemonicImportSection: { tagName: 'div' },
    privateKeyImportSection: { tagName: 'div' },
    importBtn: { tagName: 'button' },
    cancelImportBtn: { tagName: 'button' },
    welcomeImportWalletBtn: { tagName: 'button' },
    accountsImportWalletBtn: { tagName: 'button' },
    mnemonicTab: { tagName: 'button', _classes: 'import-tab active', dataset: { type: 'mnemonic' } },
    privateKeyTab: { tagName: 'button', _classes: 'import-tab', dataset: { type: 'privateKey' } }
  });
  elements = doc.elements;

  globalThis.document = doc.document;
  globalThis.window = globalThis.window || {};
}

function teardown() {
  delete globalThis.document;
  delete globalThis.window;
}

test.beforeEach(() => setupDom());
test.afterEach(() => teardown());

function fillImportSecrets() {
  elements.importAccountName.value = 'leaked name';
  elements.importMnemonic.value = 'test test test test test test test test test test test junk';
  elements.importPrivateKey.value = '0xabc';
  elements.importWalletPassword.value = 'Secret-Pass-123';
  elements.privateKeyTab.classList.add('active');
  elements.mnemonicTab.classList.remove('active');
  elements.mnemonicImportSection.classList.add('hidden');
  elements.privateKeyImportSection.classList.remove('hidden');
}

function assertImportFormCleared() {
  assert.equal(elements.importAccountName.value, '');
  assert.equal(elements.importMnemonic.value, '');
  assert.equal(elements.importPrivateKey.value, '');
  assert.equal(elements.importWalletPassword.value, '');
  assert.ok(elements.mnemonicTab.classList.contains('active'));
  assert.ok(!elements.privateKeyTab.classList.contains('active'));
  assert.ok(!elements.mnemonicImportSection.classList.contains('hidden'));
  assert.ok(elements.privateKeyImportSection.classList.contains('hidden'));
}

test('clearImportWalletForm：清空助记词/私钥/密码并重置到助记词页签', () => {
  fillImportSecrets();
  clearImportWalletForm();
  assertImportFormCleared();
});

test('首次导入入口：打开导入页前清空上次残留的敏感输入', () => {
  fillImportSecrets();
  const c = new WelcomeController();
  c.prepareImportFormForNewWallet();
  assert.equal(elements.importPasswordLabel.textContent, '密码');
  assert.equal(elements.importWalletPassword.placeholder, '至少8位字符');
  assertImportFormCleared();
});

test('账户管理导入入口：打开导入页前清空首次导入残留的敏感输入', () => {
  fillImportSecrets();
  const c = new AccountListController({ wallet: {} });
  c.prepareImportFormForExistingWallet();
  assert.equal(elements.importPasswordLabel.textContent, '当前密码');
  assert.equal(elements.importWalletPassword.placeholder, '输入当前密码');
  assertImportFormCleared();
});

test('取消导入：离开导入页时清空敏感输入', () => {
  fillImportSecrets();
  setPageOrigin('importPage', 'accounts');
  const c = new ImportWalletController({ wallet: {} });
  c.handleCancel();
  assertImportFormCleared();
});
