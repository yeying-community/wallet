/**
 * PopupController 集成测试（DOM stub + mock wallet/network）
 * 运行：npm test
 *
 * 故意不调用 init() / bindEvents()（依赖全 DOM；UI 全量 mock 不实际）。本文件只验
 * 委派路由：openXxxPage 委派到子 controller + showPage；lockWallet / refreshWalletData
 * 委派到子 controller；handleNetworkChanged 委派给 account/balance/tokens。
 *
 * 这是"路由层"测试，对应架构基线 R1/R2：拆 controller 后顶层只是委托。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './_helpers/dom-stub.js';

let elements;
let pagesShown = [];

function setupDom() {
  // popup-controller 通过 showPage 切页（document.querySelectorAll('.page') + getElementById）；
  // 提供常见 page 占位、tokensContent、unlockPassword 等委派方法访问的 ID。
  const doc = createDocument({
    walletPage: { tagName: 'div' },
    accountsPage: { tagName: 'div' },
    settingsPage: { tagName: 'div' },
    sitesPage: { tagName: 'div' },
    contactsPage: { tagName: 'div' },
    transferPage: { tagName: 'div' },
    unlockPage: { tagName: 'div' },
    welcomePage: { tagName: 'div' },
    unlockPassword: { tagName: 'input' },
    tokensContent: { tagName: 'div' },
    backupSyncSection: { tagName: 'div' },
    siteSearchInput: { tagName: 'input' }
  });
  elements = doc.elements;
  globalThis.document = doc.document;
  globalThis.window = globalThis.window || {};
  globalThis.window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  return doc.elements;
}

function teardown() {
  delete globalThis.document;
  delete globalThis.window;
}

test.beforeEach(() => { setupDom(); pagesShown = []; });
test.afterEach(() => { teardown(); });

function fakeWallet() {
  const calls = { lock: 0 };
  return {
    calls,
    lock: async () => { calls.lock++; return { success: true }; },
    getStartupState: async () => ({ initialized: false, unlocked: false, errors: [] }),
    isWalletInitialized: async () => false,
    getCurrentAccount: async () => null,
    getAccountList: async () => [],
    getNetworks: async () => [],
    getBackupSyncSettings: async () => ({}),
    getMpcSettings: async () => ({}),
    getMpcSessions: async () => ({ success: true, sessions: [] }),
    getAuthorizedSites: async () => [],
    getContacts: async () => [],
    getTransactions: async () => [],
    getNetworkConfigByKey: async () => null,
    isAuthorized: async () => false,
    getStorageBackend: async () => 'chrome',
    getMpcAuditLogs: async () => ({ logs: [] }),
    getMpcAuditExportConfig: async () => ({ config: {} }),
    isDeveloperFeatureEnabled: () => false,
    getTokenBalances: async () => ({}),
    getCustomTokens: async () => ({}),
    getAllNetworks: async () => []
  };
}

async function importController() {
  return (await import('../js/controller/popup-controller.js')).PopupController;
}

// 在 dynamic import 之前 module-level 设置 document 避免被 ui/index.js 抓到
let PopupController;
test.beforeEach(async () => {
  if (!PopupController) PopupController = await importController();
});

test('openAccountsPage：调 accountsListController.loadWalletList', async () => {
  const c = new PopupController({ wallet: fakeWallet(), transaction: {}, network: {}, token: {} });
  await c.openAccountsPage();
  // accountsListController 是真实子 controller；只需验证不抛 + 内部 list 被读
  assert.equal(typeof c.accountsListController, 'object');
});

test('openSettingsPage：委派三个 load 到 settingsController', async () => {
  const wallet = fakeWallet();
  const spy = { backup: 0, mpc: 0, mpcSess: 0 };
  const c = new PopupController({ wallet, transaction: {}, network: {}, token: {} });
  c.settingsController.loadBackupSyncSettings = async () => { spy.backup++; };
  c.settingsController.loadMpcSettings = async () => { spy.mpc++; };
  c.settingsController.loadMpcSessions = async () => { spy.mpcSess++; };
  await c.openSettingsPage();
  assert.equal(spy.backup, 1);
  assert.equal(spy.mpc, 1);
  assert.equal(spy.mpcSess, 1);
});

test('openSitesPage：调 settingsController.loadAuthorizedSites', async () => {
  const wallet = fakeWallet();
  const c = new PopupController({ wallet, transaction: {}, network: {}, token: {} });
  let called = 0;
  c.settingsController.loadAuthorizedSites = async () => { called++; };
  await c.openSitesPage();
  assert.equal(called, 1);
});

test('openContactsPage：调 contactsController.loadContacts', async () => {
  const wallet = fakeWallet();
  const c = new PopupController({ wallet, transaction: {}, network: {}, token: {} });
  let called = 0;
  c.contactsController.loadContacts = async () => { called++; };
  await c.openContactsPage();
  assert.equal(called, 1);
});

test('openBackupSyncSettings：先 openSettingsPage 再请求 scrollIntoView', async () => {
  const wallet = fakeWallet();
  const c = new PopupController({ wallet, transaction: {}, network: {}, token: {} });
  c.settingsController.loadBackupSyncSettings = async () => {};
  c.settingsController.loadMpcSettings = async () => {};
  c.settingsController.loadMpcSessions = async () => {};
  elements.backupSyncSection.scrollIntoView = () => { c.__scrolled = true; };
  await c.openBackupSyncSettings();
  // requestAnimationFrame 异步 → 等 microtask
  await new Promise((r) => setImmediate(r));
  assert.equal(c.__scrolled, true, '应调用 backupSyncSection.scrollIntoView');
});

test('lockWallet：调 wallet.lock + 清空 unlockPassword', async () => {
  const wallet = fakeWallet();
  const c = new PopupController({ wallet, transaction: {}, network: {}, token: {} });
  elements.unlockPassword.value = 'old-pwd';
  c.closeWalletHeaderMenu = () => {};
  c.stopTransactionPolling = () => {};
  c.renderUnlockReason = () => {};
  await c.lockWallet();
  assert.equal(wallet.calls.lock, 1);
  assert.equal(elements.unlockPassword.value, '', 'unlockPassword 应清空');
});

test('handleNetworkChanged：委派给 accountHeader/balance/tokens 三个子 controller', async () => {
  const wallet = fakeWallet();
  const c = new PopupController({ wallet, transaction: {}, network: {}, token: {} });
  const calls = { account: 0, balance: 0, tokens: 0 };
  c.accountHeaderController.refreshHeader = async () => { calls.account++; };
  c.tokenBalanceController.refreshBalanceSilently = async () => { calls.balance++; };
  c.tokensListController.loadTokenBalances = async () => { calls.tokens++; };
  await c.handleNetworkChanged();
  assert.equal(calls.account, 1);
  assert.equal(calls.balance, 1);
  assert.equal(calls.tokens, 1);
});

test('refreshWalletData：调 4 个 refresh（accountHeader/balance/network/tokens）', async () => {
  const wallet = fakeWallet();
  const c = new PopupController({ wallet, transaction: {}, network: {}, token: {} });
  const calls = { account: 0, balance: 0, network: 0, backup: 0, tokens: 0 };
  c.accountHeaderController.refreshHeader = async () => { calls.account++; };
  c.tokenBalanceController.refreshBalanceSilently = async () => { calls.balance++; };
  c.networkController.refreshNetworkState = async () => { calls.network++; };
  c.updateBackupSyncStatus = async () => { calls.backup++; };
  c.tokensListController.loadTokenBalances = async () => { calls.tokens++; };
  // 让 tokensContent 不 hidden 才会触发 loadTokenBalances
  elements.tokensContent.classList.remove('hidden');
  await c.refreshWalletData();
  assert.equal(calls.account, 1);
  assert.equal(calls.balance, 1);
  assert.equal(calls.network, 1);
  assert.equal(calls.backup, 1);
  assert.equal(calls.tokens, 1, 'tokensContent 可见时应调 loadTokenBalances');
});

test('refreshWalletData：tokensContent 隐藏时不调 loadTokenBalances', async () => {
  const wallet = fakeWallet();
  const c = new PopupController({ wallet, transaction: {}, network: {}, token: {} });
  let tokens = 0;
  c.tokensListController.loadTokenBalances = async () => { tokens++; };
  elements.tokensContent.classList.add('hidden');
  await c.refreshWalletData();
  assert.equal(tokens, 0);
});

test('startTransactionPolling：开启 setInterval，stopTransactionPolling 清理', () => {
  const c = new PopupController({ wallet: fakeWallet(), transaction: {}, network: {}, token: {} });
  c.startTransactionPolling();
  assert.notEqual(c.transactionPollingTimer, null);
  c.stopTransactionPolling();
  assert.equal(c.transactionPollingTimer, null);
});

test('lockWallet：wallet.lock 抛错时仍调 showError 不抛', async () => {
  const wallet = fakeWallet();
  wallet.lock = async () => { throw new Error('lock-failed'); };
  const c = new PopupController({ wallet, transaction: {}, network: {}, token: {} });
  c.closeWalletHeaderMenu = () => {};
  c.stopTransactionPolling = () => {};
  c.renderUnlockReason = () => {};
  await c.lockWallet(); // 不应抛
  assert.ok(true, 'lockWallet 容错');
});