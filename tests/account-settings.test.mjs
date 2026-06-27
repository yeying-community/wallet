/**
 * AccountSettingsController DOM 集成测试
 * 运行：npm test
 *
 * 覆盖：改密 modal 校验、重置 modal 校验（输入关键词匹配后按钮可用）、清除全部授权
 * 按钮通过注入的 onClearAllAuthorizations 回调触发；Enter/Escape 键盘处理。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createElement } from './_helpers/dom-stub.js';

let elements;
let AccountSettingsController;

function setupDom() {
  const doc = createDocument({
    // 改密 modal
    changePasswordBtn: { tagName: 'button' },
    changePasswordModal: { tagName: 'div' },
    confirmChangePasswordBtn: { tagName: 'button' },
    cancelChangePasswordBtn: { tagName: 'button' },
    closeChangePasswordModal: { tagName: 'button' },
    oldPasswordInput: { tagName: 'input' },
    newPasswordInput: { tagName: 'input' },
    confirmNewPasswordInput: { tagName: 'input' },
    // 重置 modal
    resetWalletBtn: { tagName: 'button' },
    resetWalletModal: { tagName: 'div' },
    closeResetWalletModal: { tagName: 'button' },
    cancelResetWalletBtn: { tagName: 'button' },
    confirmResetWalletBtn: { tagName: 'button' },
    resetWalletConfirmInput: { tagName: 'input' },
    // 清除全部授权
    clearAllAuthBtn: { tagName: 'button' },
    // handleResetWallet 在成功后 setTimeout(showPage, 1000) 跳 welcome；stub 让 showPage 不抛
    welcomePage: { tagName: 'div' }
  });
  elements = doc.elements;
  globalThis.document = doc.document;
  globalThis.window = globalThis.window || {};
  globalThis.confirm = () => true;
  globalThis.alert = () => {};
  return doc.elements;
}

// 在文件顶层保存原生 setTimeout/clearTimeout（setupDom/teardown 会反复 delete globalThis 上的覆盖版本，
// 但原生 Node 函数引用不变）。
const ORIGINAL_SET_TIMEOUT = globalThis.setTimeout;
const ORIGINAL_CLEAR_TIMEOUT = globalThis.clearTimeout;

// 跟踪测试期间产生的定时器，在 teardown 时清理（避免 setTimeout 在 document 删除后触发）。
const pendingTimers = new Set();

function patchTimers() {
  globalThis.setTimeout = function (fn, delay, ...args) {
    const id = ORIGINAL_SET_TIMEOUT.call(globalThis, fn, delay, ...args);
    pendingTimers.add(id);
    return id;
  };
  globalThis.clearTimeout = function (id) {
    pendingTimers.delete(id);
    return ORIGINAL_CLEAR_TIMEOUT.call(globalThis, id);
  };
}

function teardown() {
  // 清理所有 pending setTimeout（handleResetWallet 1s 后调 showPage），避免异步访问已删 document
  for (const id of pendingTimers) ORIGINAL_CLEAR_TIMEOUT.call(globalThis, id);
  pendingTimers.clear();
  delete globalThis.document;
  delete globalThis.window.confirm;
  delete globalThis.window.alert;
  delete globalThis.confirm;
  delete globalThis.alert;
  delete globalThis.setTimeout;
  delete globalThis.clearTimeout;
}

test.beforeEach(async () => {
  setupDom();
  patchTimers();
  if (!AccountSettingsController) {
    AccountSettingsController = (await import('../js/controller/settings/account-settings-controller.js')).AccountSettingsController;
  }
});
test.afterEach(() => { teardown(); });

function fakeWallet({ changePasswordResult = { success: true }, resetResult = { success: true } } = {}) {
  const calls = { changePassword: null, reset: 0 };
  const wallet = {
    changePassword: async (oldPwd, newPwd) => {
      calls.changePassword = { oldPwd, newPwd };
      return changePasswordResult;
    },
    resetWallet: async () => { calls.reset++; return resetResult; }
  };
  return { wallet, calls };
}

// ==================== 修改密码 modal ====================

test('openChangePasswordModal：显示 modal 并聚焦旧密码输入', () => {
  const { wallet } = fakeWallet();
  const c = new AccountSettingsController({ wallet });
  elements.changePasswordModal.classList.add('hidden');
  c.openChangePasswordModal();
  assert.ok(!elements.changePasswordModal.classList.contains('hidden'));
});

test('closeChangePasswordModal：隐藏 modal 并清空表单', () => {
  const { wallet } = fakeWallet();
  const c = new AccountSettingsController({ wallet });
  elements.oldPasswordInput.value = 'old';
  elements.newPasswordInput.value = 'New-Pass-1234';
  elements.confirmNewPasswordInput.value = 'New-Pass-1234';
  c.openChangePasswordModal();
  c.closeChangePasswordModal();
  assert.ok(elements.changePasswordModal.classList.contains('hidden'));
  assert.equal(elements.oldPasswordInput.value, '');
  assert.equal(elements.newPasswordInput.value, '');
  assert.equal(elements.confirmNewPasswordInput.value, '');
});

test('handleChangePassword：缺旧密码 → 不调用 wallet', async () => {
  const { wallet, calls } = fakeWallet();
  const c = new AccountSettingsController({ wallet });
  await c.handleChangePassword();
  assert.equal(calls.changePassword, null);
});

test('handleChangePassword：新密码 < 8 位 → 不调用 wallet', async () => {
  const { wallet, calls } = fakeWallet();
  const c = new AccountSettingsController({ wallet });
  elements.oldPasswordInput.value = 'old-pass-1234';
  elements.newPasswordInput.value = 'short';
  elements.confirmNewPasswordInput.value = 'short';
  await c.handleChangePassword();
  assert.equal(calls.changePassword, null);
});

test('handleChangePassword：两次新密码不一致 → 不调用 wallet', async () => {
  const { wallet, calls } = fakeWallet();
  const c = new AccountSettingsController({ wallet });
  elements.oldPasswordInput.value = 'old-pass-1234';
  elements.newPasswordInput.value = 'New-Pass-AAAA';
  elements.confirmNewPasswordInput.value = 'New-Pass-BBBB';
  await c.handleChangePassword();
  assert.equal(calls.changePassword, null);
});

test('handleChangePassword：新旧密码相同 → 不调用 wallet', async () => {
  const { wallet, calls } = fakeWallet();
  const c = new AccountSettingsController({ wallet });
  elements.oldPasswordInput.value = 'Same-Pass-1234';
  elements.newPasswordInput.value = 'Same-Pass-1234';
  elements.confirmNewPasswordInput.value = 'Same-Pass-1234';
  await c.handleChangePassword();
  assert.equal(calls.changePassword, null);
});

test('handleChangePassword：合法输入 → 调 wallet.changePassword 并关闭 modal', async () => {
  const { wallet, calls } = fakeWallet();
  const c = new AccountSettingsController({ wallet });
  elements.oldPasswordInput.value = 'Old-Pass-1234';
  elements.newPasswordInput.value = 'New-Pass-5678';
  elements.confirmNewPasswordInput.value = 'New-Pass-5678';
  c.openChangePasswordModal();
  await c.handleChangePassword();
  assert.deepEqual(calls.changePassword, { oldPwd: 'Old-Pass-1234', newPwd: 'New-Pass-5678' });
  assert.ok(elements.changePasswordModal.classList.contains('hidden'));
});

// ==================== 重置钱包 modal ====================

test('openResetWalletModal：显示 modal，清空输入并聚焦', () => {
  const { wallet } = fakeWallet();
  const c = new AccountSettingsController({ wallet });
  elements.resetWalletConfirmInput.value = 'RESET';
  elements.resetWalletModal.classList.add('hidden');
  c.openResetWalletModal();
  assert.ok(!elements.resetWalletModal.classList.contains('hidden'));
  assert.equal(elements.resetWalletConfirmInput.value, '');
});

test('closeResetWalletModal：隐藏 modal 并清空输入', () => {
  const { wallet } = fakeWallet();
  const c = new AccountSettingsController({ wallet });
  elements.resetWalletConfirmInput.value = 'RESET';
  c.openResetWalletModal();
  c.closeResetWalletModal();
  assert.ok(elements.resetWalletModal.classList.contains('hidden'));
  assert.equal(elements.resetWalletConfirmInput.value, '');
});

test('updateResetWalletConfirmState：输入「RESET」后 confirm 按钮启用', () => {
  const { wallet } = fakeWallet();
  const c = new AccountSettingsController({ wallet });
  elements.confirmResetWalletBtn.disabled = true;
  elements.resetWalletConfirmInput.value = 'WRONG';
  c.updateResetWalletConfirmState();
  assert.equal(elements.confirmResetWalletBtn.disabled, true);
  elements.resetWalletConfirmInput.value = 'RESET';
  c.updateResetWalletConfirmState();
  assert.equal(elements.confirmResetWalletBtn.disabled, false);
});

test('handleResetWallet：输入非 RESET → 不调用 wallet', async () => {
  const { wallet, calls } = fakeWallet();
  const c = new AccountSettingsController({ wallet });
  elements.resetWalletConfirmInput.value = 'wrong';
  await c.handleResetWallet();
  assert.equal(calls.reset, 0);
});

test('handleResetWallet：输入 RESET → 调 wallet.resetWallet', async () => {
  const { wallet, calls } = fakeWallet();
  const c = new AccountSettingsController({ wallet });
  elements.resetWalletConfirmInput.value = 'RESET';
  await c.handleResetWallet();
  assert.equal(calls.reset, 1);
});

test('重置 modal 按 Enter 触发 handleResetWallet', async () => {
  const { wallet, calls } = fakeWallet();
  const c = new AccountSettingsController({ wallet });
  c.bindEvents();
  elements.resetWalletConfirmInput.value = 'RESET';
  elements.resetWalletConfirmInput.dispatchEvent({ type: 'keydown', key: 'Enter' });
  // 异步：等 microtask
  await new Promise((res) => setImmediate(res));
  assert.equal(calls.reset, 1);
});

test('重置 modal 按 Escape 关闭 modal（不调 wallet）', () => {
  const { wallet, calls } = fakeWallet();
  const c = new AccountSettingsController({ wallet });
  c.bindEvents();
  c.openResetWalletModal();
  elements.resetWalletConfirmInput.value = 'RESET';
  elements.resetWalletConfirmInput.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.ok(elements.resetWalletModal.classList.contains('hidden'));
  assert.equal(calls.reset, 0);
});

// ==================== 清除全部授权按钮 ====================

test('点击 clearAllAuthBtn 触发注入的 onClearAllAuthorizations', () => {
  let cleared = 0;
  const { wallet } = fakeWallet();
  const c = new AccountSettingsController({
    wallet,
    onClearAllAuthorizations: () => { cleared++; }
  });
  c.bindEvents();
  elements.clearAllAuthBtn.click();
  assert.equal(cleared, 1);
});

test('未提供 onClearAllAuthorizations 也不抛错（默认 noop）', () => {
  const { wallet } = fakeWallet();
  const c = new AccountSettingsController({ wallet }); // 无回调
  c.bindEvents();
  assert.doesNotThrow(() => elements.clearAllAuthBtn.click());
});