/**
 * changePassword 原子性 / 一致性回归（零依赖，Node 内置 runner）
 * 运行：node --test --test-force-exit "tests/*.test.mjs"
 *
 * 背景：历史实现对每个账户逐个 await updateAccount（整表读改写 × N），非原子。
 *       Service Worker 在改密中途被回收会留下「部分账户新密码、部分旧密码」的混杂态，
 *       导致用户用正确的新密码导出私钥/助记词时，部分账户报 “Invalid password”。
 * 本用例验证修复后：多钱包 + 子账户改密后，所有账户/助记词都只认新密码、旧密码全部失效。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── 在导入 background 依赖图之前注入最小 chrome.storage.local mock ──
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

const ops = await import('../js/background/wallet-operations.js');
const keyring = await import('../js/background/keyring.js');

const P = 'Pass-1111';
const Q = 'Pass-2222';
// Hardhat 公开测试私钥（无真实资产）
const TEST_PRIVKEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

test('多钱包+子账户改密后全部账户只认新密码、旧密码失效', async () => {
  // HD 钱包(P) + 主账户
  const created = await ops.handleCreateHDWallet('Acc1', P);
  assert.equal(created.success, true);
  const walletId = created.wallet.id;
  const mainId = created.account.id;

  // 解锁建立密码缓存，派生一个子账户（用缓存密码加密）
  await keyring.unlockWallet(P, mainId, 'popup');
  const sub = await ops.handleCreateSubAccount(walletId, 'Acc2', null);
  assert.equal(sub.success, true);
  const subId = sub.account.id;

  // 第二个钱包：导入私钥（同一全局密码 P）
  const imported = await ops.handleImportPrivateKeyWallet('Imp', TEST_PRIVKEY, P);
  assert.equal(imported.success, true);
  const importedId = imported.account.id;

  // 改密 P -> Q
  const cp = await ops.changePassword(P, Q);
  assert.equal(cp.success, true);
  assert.equal(cp.updatedWallets, 2, '两个钱包都应被重加密');
  assert.equal(cp.updatedAccounts, 3, '主账户+子账户+导入账户共 3 个');

  // 新密码：全部可导出
  for (const id of [mainId, subId, importedId]) {
    const r = await ops.handleExportPrivateKey(id, Q);
    assert.equal(r.success, true, `账户 ${id} 应能用新密码导出私钥`);
  }
  const mnemonic = await ops.handleExportMnemonic(walletId, Q);
  assert.equal(mnemonic.success, true, '应能用新密码导出助记词');

  // 旧密码：全部失效（不再存在新旧混杂）
  for (const id of [mainId, subId, importedId]) {
    const r = await ops.handleExportPrivateKey(id, P);
    assert.equal(r.success, false, `账户 ${id} 不应再接受旧密码`);
  }
  const oldMnemonic = await ops.handleExportMnemonic(walletId, P);
  assert.equal(oldMnemonic.success, false, '旧密码不应再导出助记词');

  await keyring.lockWallet();
});

test('改密失败（旧密码错误）时不改动任何存储', async () => {
  const created = await ops.handleCreateHDWallet('Acc1', P);
  const walletId = created.wallet.id;
  const mainId = created.account.id;

  await assert.rejects(() => ops.changePassword('WRONG-old-pass', Q));

  // 仍可用原密码导出，说明未发生部分写入
  const r = await ops.handleExportPrivateKey(mainId, P);
  assert.equal(r.success, true, '改密失败后原密码应仍然有效');
  const m = await ops.handleExportMnemonic(walletId, P);
  assert.equal(m.success, true);
});

test('子账户 index 不复用：删除中间子账户后新建得到更大的 index', async () => {
  await chrome.storage.local.clear();
  const created = await ops.handleCreateHDWallet('Acc1', P);
  const walletId = created.wallet.id;
  const mainId = created.account.id;
  await keyring.unlockWallet(P, mainId, 'popup');

  const sub1 = await ops.handleCreateSubAccount(walletId, 'Acc2', null); // index 1
  const sub2 = await ops.handleCreateSubAccount(walletId, 'Acc3', null); // index 2
  assert.equal(sub1.account.index, 1);
  assert.equal(sub2.account.index, 2);

  await ops.handleDeleteAccount(sub1.account.id, P); // 删除 index 1
  const sub3 = await ops.handleCreateSubAccount(walletId, 'Acc4', null);

  assert.equal(sub3.account.index, 3, '应取 max(index)+1，而非复用被删的 index 1');
  assert.notEqual(sub3.account.id, sub1.account.id, '不得复用被删账户的 id');
  await keyring.lockWallet();
});
