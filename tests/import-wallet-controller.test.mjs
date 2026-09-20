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
    custodyRecoveryPage: { tagName: 'div' },
    custodyRecoveryCount: { tagName: 'div' },
    custodyRecoveryList: { tagName: 'div' },
    custodyRecoveryPassword: { tagName: 'input' },
    accountsPage: { tagName: 'div' },
    walletPage: { tagName: 'div' },
    importAccountName: { tagName: 'input' },
    importMnemonic: { tagName: 'textarea' },
    importPrivateKey: { tagName: 'input' },
    importWalletPassword: { tagName: 'input' },
    importWalletNameGroup: { tagName: 'div' },
    fileImportSection: { tagName: 'div', _classes: 'hidden' },
    importPasswordLabel: { tagName: 'label' },
    mnemonicImportSection: { tagName: 'div' },
    privateKeyImportSection: { tagName: 'div' },
    importBtn: { tagName: 'button' },
    cancelImportBtn: { tagName: 'button' },
    welcomeImportWalletBtn: { tagName: 'button' },
    accountsImportWalletBtn: { tagName: 'button' },
    // source tabs 仍保留「助记词/私钥 · 备份文件 · 云端恢复」三选一
    walletSourceTab: { tagName: 'button', _classes: 'import-source-tab active', dataset: { source: 'wallet' } },
    fileSourceTab: { tagName: 'button', _classes: 'import-source-tab', dataset: { source: 'file' } },
    custodySourceTab: { tagName: 'button', _classes: 'import-source-tab', dataset: { source: 'custody' } },
    // 助记词/私钥 switch + 网络选择器（仅 evm 选项；reference 选择器对 evm 隐藏）
    importMethodMnemonicOption: { tagName: 'button', _classes: 'import-method-option active', dataset: { method: 'mnemonic' } },
    importMethodPrivateKeyOption: { tagName: 'button', _classes: 'import-method-option', dataset: { method: 'privateKey' } },
    importNetworkSelect: { tagName: 'select', value: 'evm' },
    importNetworkMenu: { tagName: 'div', _classes: 'network-menu hidden' },
    importReferenceGroup: { tagName: 'div', _classes: 'form-group hidden' }
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
  elements.importMethodPrivateKeyOption.classList.add('active');
  elements.importMethodMnemonicOption.classList.remove('active');
  elements.mnemonicImportSection.classList.add('hidden');
  elements.privateKeyImportSection.classList.remove('hidden');
}

function assertImportFormCleared() {
  assert.equal(elements.importAccountName.value, '');
  assert.equal(elements.importMnemonic.value, '');
  assert.equal(elements.importPrivateKey.value, '');
  assert.equal(elements.importWalletPassword.value, '');
  assert.ok(elements.importMethodMnemonicOption.classList.contains('active'));
  assert.ok(!elements.importMethodPrivateKeyOption.classList.contains('active'));
  assert.ok(!elements.mnemonicImportSection.classList.contains('hidden'));
  assert.ok(elements.privateKeyImportSection.classList.contains('hidden'));
  assert.ok(elements.fileImportSection.classList.contains('hidden'));
  assert.ok(!elements.importWalletNameGroup.classList.contains('hidden'));
}

test('切换到备份文件时隐藏钱包名称', () => {
  const c = new ImportWalletController({ wallet: {} });
  c.bindEvents();
  elements.fileSourceTab.click();
  assert.ok(elements.importWalletNameGroup.classList.contains('hidden'));
  assert.ok(!elements.fileImportSection.classList.contains('hidden'));
});

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

test('托管恢复读取当前身份服务地址', () => {
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem(key) {
      return key === 'walletIdentityNodeEndpoint' ? 'http://localhost:8100/' : '';
    }
  };
  try {
    const c = new WelcomeController();
    assert.equal(c.identityNodeEndpoint(), 'http://localhost:8100');
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});

test('云端密钥恢复列表展示钱包数量、名称、账户数和 Wallet Identity DID', async () => {
  const previousChrome = globalThis.chrome;
  const identityDid = 'did:yeying:wid_1234567890123456789012';
  globalThis.chrome = {
    storage: {
      local: {
        async get() {
          return {
            walletRecoveryAuthorization: {
              token: 'recovery-token',
              endpoint: 'http://localhost:8100',
              identityDid
            }
          };
        }
      }
    }
  };
  try {
    const c = new WelcomeController({
      wallet: {
        async listCustodySecrets() {
          return {
            success: true,
            secrets: {
              identityDid,
              records: [{
                walletId: 'wallet_1782978556067_sroz69v',
                metadata: { walletName: '工作钱包', accountCount: 3 }
              }]
            }
          };
        }
      }
    });
    await c.loadCustodyRecoveryRecords();

    assert.equal(elements.custodyRecoveryList.children.length, 1);
    assert.equal(elements.custodyRecoveryCount.textContent, '共 1 个云端托管钱包');
    assert.equal(elements.custodyRecoveryList.children[0].children[0].textContent, '工作钱包');
    assert.equal(elements.custodyRecoveryList.children[0].children[1].textContent, '3 个账户');
    assert.equal(elements.custodyRecoveryList.children[0].children[2].textContent, identityDid);
    assert.equal(c.recoveryWalletId, 'wallet_1782978556067_sroz69v');
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});

test('云端恢复拒绝授权 DID 和托管服务 DID 不一致', async () => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: {
      local: {
        async get() {
          return {
            walletRecoveryAuthorization: {
              token: 'recovery-token',
              endpoint: 'http://localhost:8100',
              identityDid: 'did:yeying:wid_1234567890123456789012'
            }
          };
        }
      }
    }
  };
  try {
    const c = new WelcomeController({
      wallet: {
        async listCustodySecrets() {
          return {
            success: true,
            secrets: {
              identityDid: 'did:yeying:wid_abcdefghijklmnopqrstuv',
              records: [{ walletId: 'wallet-1' }]
            }
          };
        }
      }
    });
    await assert.rejects(
      () => c.loadCustodyRecoveryRecords(),
      error => error?.message === '恢复授权的钱包身份不匹配'
    );
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});

test('云端恢复成功后刷新钱包首页数据', async () => {
  const previousChrome = globalThis.chrome;
  let restored = 0;
  let refreshed = 0;
  globalThis.chrome = {
    storage: {
      local: {
        async get() {
          return {
            walletRecoveryAuthorization: {
              token: 'recovery-token',
              endpoint: 'http://localhost:8100'
            }
          };
        },
        async remove() {}
      }
    }
  };
  elements.custodyRecoveryPassword.value = 'Custody-Test-Password';
  try {
    const c = new WelcomeController({
      wallet: {
        async restoreCustodySecret() {
          restored += 1;
          return { account: { address: '0x1111111111111111111111111111111111111111' } };
        }
      },
      onRecoverySuccess: async () => { refreshed += 1; }
    });
    c.recoveryWalletId = 'wallet-1';

    await c.restoreSelectedCustodyWallet();

    assert.equal(restored, 1);
    assert.equal(refreshed, 1);
    assert.equal(elements.custodyRecoveryPassword.value, '');
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
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
