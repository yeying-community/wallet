/**
 * keyring 层单测（零依赖，Node 内置 test runner）
 * 运行：node --test --test-force-exit "tests/*.test.mjs"
 *
 * keyring 管理内存中的私钥（state.keyring），是「解锁=私钥进内存 / 锁定=清零」的边界。
 * 注意：keyring 通过直接 import 拉入 storage / sync-service / mpc-service 等单例，
 *       这些单例会在 onUnlocked 后留下定时器，使 Node 事件循环无法自然退出，
 *       故运行需带 --test-force-exit。这也印证了架构基线文档 R4（隐式耦合）的改进点。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── 在导入 background 依赖图之前，注入最小 chrome.storage.local mock ──
const store = {};
globalThis.chrome = {
  runtime: {
    id: 'test-extension-id',
    getURL: (p = '') => `chrome-extension://test-extension-id/${p}`,
    sendMessage: async () => ({ success: true })
  },
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return { ...store };
        if (typeof keys === 'string') return { [keys]: store[keys] };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, store[k]]));
        return Object.fromEntries(
          Object.keys(keys).map((k) => [k, store[k] !== undefined ? store[k] : keys[k]])
        );
      },
      async set(items) { Object.assign(store, items || {}); },
      async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]); },
      async clear() { Object.keys(store).forEach((k) => delete store[k]); }
    },
    onChanged: { addListener() {}, removeListener() {} }
  }
};

// 静态 import 会被提升到 mock 之前，因此用动态 import 在 mock 之后加载。
const vault = await import('../js/background/vault.js');
const storage = await import('../js/storage/index.js');
const keyring = await import('../js/background/keyring.js');
const walletOps = await import('../js/background/operations/wallet.js');

const PASSWORD = 'Correct-Horse-9';
const WRONG_PASSWORD = 'Correct-Horse-8';

// 全局只创建一个钱包/账户，落库后供各用例复用
const { wallet, mainAccount } = await vault.createHDWallet('Acc 1', PASSWORD);
await storage.saveWallet(wallet);
await storage.saveAccount(mainAccount);

test('初始状态为锁定', async () => {
  await keyring.lockWallet();
  assert.equal(keyring.isWalletUnlocked(), false);
});

test('正确密码解锁后私钥进入内存 keyring', async () => {
  await keyring.lockWallet();
  const res = await keyring.unlockWallet(PASSWORD, mainAccount.id, 'popup');
  assert.equal(res.success, true);
  assert.equal(res.account.address, mainAccount.address);
  assert.equal(keyring.isWalletUnlocked(), true);

  const instance = keyring.getWalletInstance(mainAccount.id);
  assert.equal(instance.address.toLowerCase(), mainAccount.address.toLowerCase());
});

test('未指定账户解锁时按实际账户 ID 写入 keyring', async () => {
  await keyring.lockWallet();
  const res = await keyring.unlockWallet(PASSWORD, null, 'popup');
  assert.equal(res.success, true);
  assert.equal(res.account.id, mainAccount.id);

  const instance = keyring.getWalletInstance(mainAccount.id);
  assert.equal(instance.address.toLowerCase(), mainAccount.address.toLowerCase());
});

test('错误密码解锁失败且不改变锁定态', async () => {
  await keyring.lockWallet();
  await assert.rejects(() => keyring.unlockWallet(WRONG_PASSWORD, mainAccount.id, 'popup'));
  assert.equal(keyring.isWalletUnlocked(), false);
});

test('锁定后清空内存私钥，再取实例应抛错', async () => {
  await keyring.unlockWallet(PASSWORD, mainAccount.id, 'popup');
  assert.equal(keyring.isWalletUnlocked(), true);

  await keyring.lockWallet();
  assert.equal(keyring.isWalletUnlocked(), false);
  assert.throws(() => keyring.getWalletInstance(mainAccount.id), '锁定后不应再能取出钱包实例');
});

test('未知账户取实例抛错（即使已解锁其它账户）', async () => {
  await keyring.unlockWallet(PASSWORD, mainAccount.id, 'popup');
  assert.throws(() => keyring.getWalletInstance('non-existent-account-id'));
  await keyring.lockWallet();
});

test('新建 HD 钱包后新账户立即进入内存 keyring', async () => {
  await keyring.lockWallet();
  const res = await walletOps.handleCreateHDWallet('Fresh', PASSWORD);
  assert.equal(res.success, true);

  const instance = keyring.getWalletInstance(res.account.id);
  assert.equal(instance.address.toLowerCase(), res.account.address.toLowerCase());
});
