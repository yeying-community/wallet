/**
 * wallet/account/network-storage IDB 后端集成测试
 * 用 fake-indexeddb 在 node 跑真 IDB CRUD（覆盖此前 Node 测不了的 IDB 路径）。
 * 运行：npm test 或 node --test --test-force-exit "tests/storage-idb.test.mjs"
 *
 * 覆盖：写入 / 单读 / 列表 / 按索引筛 / 删除 / 批删 / 跨 store 事务。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { registerStore } from '../js/storage/indexeddb-base.js';
import { _setStorageBackend } from '../js/storage/backend.js';

// 注册 store（与生产 storage 文件相同 keyPath/indexes），必须在任何读写之前。
registerStore('wallets', { keyPath: 'id' });
registerStore('accounts', { keyPath: 'id', indexes: [{ name: 'by_wallet', keyPath: 'walletId' }] });
registerStore('networks', { keyPath: 'chainId' });

// 强制 idb 后端（绕过迁移）
_setStorageBackend('idb');

const walletStorage = await import('../js/storage/wallet-storage.js');
const accountStorage = await import('../js/storage/account-storage.js');
const networkStorage = await import('../js/storage/network-storage.js');

test.beforeEach(() => {
  // fake-indexeddb 是模块级单例；每个用例清掉三个 store
  // 通过 IDB 直接 clear（避免依赖 chrome.storage 层）。
  return Promise.all([
    new Promise((res, rej) => { const r = indexedDB.deleteDatabase('yeying_wallet_db'); r.onsuccess = res; r.onerror = rej; }),
  ]);
});

// ==================== wallet-storage IDB ====================

test('wallet: save/get/getAll/delete 在 IDB 后端', async () => {
  const w1 = { id: 'w1', name: 'HD Wallet', type: 'hd', createdAt: 1 };
  const w2 = { id: 'w2', name: 'Imported', type: 'imported', createdAt: 2 };
  await walletStorage.saveWallet(w1);
  await walletStorage.saveWallet(w2);

  assert.equal((await walletStorage.getWallet('w1')).name, 'HD Wallet');
  assert.equal(await walletStorage.getWallet('missing'), null);

  const all = await walletStorage.getWallets();
  assert.equal(Object.keys(all).length, 2);
  assert.equal(all.w2.type, 'imported');

  await walletStorage.deleteWallet('w1');
  assert.equal(await walletStorage.getWallet('w1'), null);
  assert.equal(Object.keys(await walletStorage.getWallets()).length, 1);

  assert.equal(await walletStorage.walletExists('w2'), true);
  assert.equal(await walletStorage.walletExists('w3'), false);
});

// ==================== account-storage IDB ====================

test('account: save/get/update/delete/getWalletAccounts/getAccountList', async () => {
  const a1 = { id: 'w1_0', walletId: 'w1', name: 'Acc1', index: 0, address: '0xa1', encryptedPrivateKey: 'encA' };
  const a2 = { id: 'w1_1', walletId: 'w1', name: 'Acc2', index: 1, address: '0xa2', encryptedPrivateKey: 'encB' };
  const a3 = { id: 'w2_0', walletId: 'w2', name: 'Acc3', index: 0, address: '0xa3', encryptedPrivateKey: 'encC' };

  await accountStorage.saveAccount(a1);
  await accountStorage.saveAccount(a2);
  await accountStorage.saveAccount(a3);

  assert.equal((await accountStorage.getAccount('w1_0')).name, 'Acc1');
  assert.equal(await accountStorage.getAccount('missing'), null);

  // 按 walletId 索引筛
  const w1Accs = await accountStorage.getWalletAccounts('w1');
  assert.equal(w1Accs.length, 2);
  assert.ok(w1Accs.every(a => a.walletId === 'w1'));

  // list / accounts map
  const list = await accountStorage.getAccountList();
  assert.equal(list.length, 3);
  const map = await accountStorage.getAccounts();
  assert.equal(Object.keys(map).length, 3);

  // update via saveAccount（put 语义）
  await accountStorage.updateAccount({ ...a1, name: 'Acc1-renamed' });
  assert.equal((await accountStorage.getAccount('w1_0')).name, 'Acc1-renamed');

  // delete 删单条
  await accountStorage.deleteAccount('w1_0');
  assert.equal(await accountStorage.getAccount('w1_0'), null);
  assert.equal((await accountStorage.getWalletAccounts('w1')).length, 1);

  // deleteAccounts 批量
  await accountStorage.deleteAccounts(['w1_1', 'w2_0']);
  assert.equal((await accountStorage.getAccounts() && Object.keys(await accountStorage.getAccounts())).length, 0);

  assert.equal(await accountStorage.accountExists('w1_1'), false);
  assert.equal(await accountStorage.hasAccounts(), false);
});

// ==================== network-storage IDB ====================

test('network: saveNetworks 整组替换（避免 chainId 变更残留）', async () => {
  await networkStorage.saveNetworks([
    { chainId: '0x1', name: 'Ethereum' },
    { chainId: '0x38', name: 'BSC' }
  ]);
  let list = await networkStorage.getNetworks();
  assert.equal(list.length, 2);

  // 修改 chainId + 删除一条：saveNetworks 整组 clear+put 必须清除旧 0x38
  await networkStorage.saveNetworks([
    { chainId: '0x1', name: 'Ethereum-renamed' },
    { chainId: '0x89', name: 'Polygon' }
  ]);
  list = await networkStorage.getNetworks();
  assert.equal(list.length, 2, '旧 0x38 应被清掉');
  assert.ok(list.find(n => n.chainId === '0x1' && n.name === 'Ethereum-renamed'));
  assert.ok(list.find(n => n.chainId === '0x89'));
  assert.equal(list.find(n => n.chainId === '0x38'), undefined);
});

test('network: getNetworks 在空库返回空数组（不是抛错）', async () => {
  const list = await networkStorage.getNetworks();
  assert.deepEqual(list, []);
});

// ==================== 跨 store 事务（atomicity） ====================

test('跨 store 事务：runMultiStoreTransaction 原子写入+回滚验证', async () => {
  const { runMultiStoreTransaction } = await import('../js/storage/indexeddb-base.js');
  await walletStorage.saveWallet({ id: 'wA', name: 'A', type: 'hd', createdAt: 1 });
  await accountStorage.saveAccount({ id: 'wA_0', walletId: 'wA', name: 'A0', index: 0, address: '0x', encryptedPrivateKey: 'x' });

  // 成功：两 store 同时新增
  await runMultiStoreTransaction(['wallets', 'accounts'], 'readwrite', (stores) => {
    stores.wallets.put({ id: 'wB', name: 'B', type: 'hd', createdAt: 2 });
    stores.accounts.put({ id: 'wB_0', walletId: 'wB', name: 'B0', index: 0, address: '0x', encryptedPrivateKey: 'y' });
  });
  assert.equal((await walletStorage.getWallet('wB')).name, 'B');
  assert.equal((await accountStorage.getAccount('wB_0')).walletId, 'wB');

  // 失败：tx.onerror 应让整事务回滚——wC 账户应不存在
  await assert.rejects(() => runMultiStoreTransaction(['wallets', 'accounts'], 'readwrite', (stores) => {
    stores.wallets.put({ id: 'wC', name: 'C', type: 'hd', createdAt: 3 });
    stores.accounts.put({ id: 'wC_0', walletId: 'wC', name: 'C0', index: 0, address: '0x', encryptedPrivateKey: 'z' });
    // 触发事务错误：违反 accounts store 的 index 假设（keyPath 为 id，accountId 应存在），
    // 这里用一次 put 后显式 abort 来强制整事务回滚。
    stores.tx.abort();
  }));
  assert.equal(await walletStorage.getWallet('wC'), null, '回滚后 wallet wC 应不存在');
  assert.equal(await accountStorage.getAccount('wC_0'), null, '回滚后 account wC_0 应不存在');
});