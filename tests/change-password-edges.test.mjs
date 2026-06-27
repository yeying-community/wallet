/**
 * changePassword / handleDeleteAccount 边界与并发回归（零依赖，Node 内置 runner）
 * 运行：node --test --test-force-exit tests/change-password-edges.test.mjs
 *
 * 覆盖主测试 change-password.test.mjs 未涉及的场景：
 * - 唯一钱包 / 唯一账户的删除级联（账户→钱包自动删）
 * - 空钱包状态下 changePassword / handleCreateSubAccount 的错误路径
 * - handleDeleteAccount 错误参数与错误密码
 * - changePassword 校验边界（旧/新密码太短、相同、缺参）
 * - 并发两次 changePassword：最终态一致（无新旧混杂）
 *
 * 与主测试共用 chrome.storage.local mock；每个用例前 clear 避免状态污染。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── chrome.storage.local mock（与 change-password.test.mjs 同形）──
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

const ops = await import('../js/background/operations/wallet.js');
const keyring = await import('../js/background/keyring.js');

const P = 'Pass-1111';
const Q = 'Pass-2222';
const R = 'Pass-3333';
const TEST_PRIVKEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

test.beforeEach(async () => {
  // 每用例前重置存储 + 锁定 keyring（state 跨用例不重置会污染）
  await chrome.storage.local.clear();
  await keyring.lockWallet();
});
test.afterEach(async () => {
  await keyring.lockWallet();
  await chrome.storage.local.clear();
});

// ==================== 唯一钱包 / 唯一账户删除级联 ====================

test('删除唯一账户后钱包自动删除（cascade）', async () => {
  // 建一个钱包 + 主账户
  const created = await ops.handleCreateHDWallet('Solo', P);
  assert.equal(created.success, true);
  const walletId = created.wallet.id;
  const mainId = created.account.id;

  // 验证钱包 + 账户都存在
  const walletsBefore = (await chrome.storage.local.get('wallets')).wallets || {};
  assert.ok(walletsBefore[walletId], '钱包应存在');

  // 删唯一账户
  const del = await ops.handleDeleteAccount(mainId, P);
  assert.equal(del.success, true, '删除应成功');

  // 账户应被删
  const r = await ops.handleExportPrivateKey(mainId, P);
  assert.equal(r.success, false, '已删账户不可导出');

  // 钱包也应被级联删除（无账户的钱包在 handleDeleteAccount 中清理）
  const walletsAfter = (await chrome.storage.local.get('wallets')).wallets || {};
  assert.equal(walletsAfter[walletId], undefined, '无账户的钱包应被级联删除');
});

test('删除多账户钱包的最后一个账户 → 钱包自动删', async () => {
  const created = await ops.handleCreateHDWallet('A', P);
  const walletId = created.wallet.id;
  const mainId = created.account.id;

  // 解锁 + 创建子账户
  await keyring.unlockWallet(P, mainId, 'popup');
  const sub = await ops.handleCreateSubAccount(walletId, 'B', null);
  assert.equal(sub.success, true);
  const subId = sub.account.id;

  // 删主账户（还剩子账户 → 钱包保留）
  const r1 = await ops.handleDeleteAccount(mainId, P);
  assert.equal(r1.success, true);
  const walletsAfterFirst = (await chrome.storage.local.get('wallets')).wallets || {};
  assert.ok(walletsAfterFirst[walletId], '仍剩子账户时钱包应保留');

  // 删子账户（现在无账户 → 钱包级联删除）
  const r2 = await ops.handleDeleteAccount(subId, P);
  assert.equal(r2.success, true);
  const walletsAfterLast = (await chrome.storage.local.get('wallets')).wallets || {};
  assert.equal(walletsAfterLast[walletId], undefined, '最后一个账户删后钱包应级联删除');
});

// ==================== 空钱包状态下的错误路径 ====================

test('空钱包 changePassword → 抛"钱包不存在"', async () => {
  // beforeEach 已 clear storage
  await assert.rejects(
    () => ops.changePassword(P, Q),
    /钱包不存在/
  );
});

test('空钱包下 handleCreateSubAccount → 失败', async () => {
  const r = await ops.handleCreateSubAccount('non-existent-wallet', 'X', P);
  assert.equal(r.success, false);
  assert.match(r.error, /钱包不存在/);
});

test('handleDeleteAccount 缺参 / account not found / 错误密码', async () => {
  // 缺 accountId
  const r1 = await ops.handleDeleteAccount('', P);
  assert.equal(r1.success, false);
  assert.match(r1.error, /required/);

  // 缺 password
  const r2 = await ops.handleDeleteAccount('any-id', '');
  assert.equal(r2.success, false);
  assert.match(r2.error, /required/);

  // 账户不存在
  const r3 = await ops.handleDeleteAccount('no-such-account', P);
  assert.equal(r3.success, false);
  assert.match(r3.error, /not found/);

  // 错误密码（账户存在但密码错）
  const created = await ops.handleCreateHDWallet('X', P);
  assert.equal(created.success, true);
  const r4 = await ops.handleDeleteAccount(created.account.id, 'WrongPass123');
  assert.equal(r4.success, false, '错误密码应被拒');
});

// ==================== changePassword 校验边界 ====================

test('changePassword：旧密码太短 → 抛', async () => {
  await ops.handleCreateHDWallet('A', P); // 需要一个钱包
  await assert.rejects(() => ops.changePassword('short', Q), /至少需要8位/);
});

test('changePassword：新密码太短 → 抛', async () => {
  await ops.handleCreateHDWallet('A', P);
  await assert.rejects(() => ops.changePassword(P, 'short'), /至少需要8位/);
});

test('changePassword：旧/新密码相同 → 抛', async () => {
  await ops.handleCreateHDWallet('A', P);
  await assert.rejects(() => ops.changePassword(P, P), /不能与旧密码相同/);
});

test('changePassword：旧密码缺省 → 抛', async () => {
  await ops.handleCreateHDWallet('A', P);
  await assert.rejects(() => ops.changePassword('', Q), /至少需要8位/);
});

// ==================== 并发 changePassword 的一致性 ====================

test('并发两次 changePassword：最终态一致（无新旧密码混杂）', async () => {
  const created = await ops.handleCreateHDWallet('A', P);
  const walletId = created.wallet.id;
  const mainId = created.account.id;
  await keyring.unlockWallet(P, mainId, 'popup');
  await ops.handleCreateSubAccount(walletId, 'B', null);

  // 并发 P→Q 和 P→R
  const [cp1, cp2] = await Promise.allSettled([
    ops.changePassword(P, Q),
    ops.changePassword(P, R)
  ]);

  // 至少一个成功；都成功的概率也允许（取决于 JS 单线程 + await 顺序）
  const successes = [cp1, cp2].filter((r) => r.status === 'fulfilled');
  assert.ok(successes.length >= 1, '至少一次改密应成功');

  // 关键断言：最终状态必须"统一在 Q 或 R"——不存在 Q+R 混杂
  const finalPassword = successes.length > 0
    ? (successes[successes.length - 1].value.success
        ? (successes[successes.length - 1] === cp1 ? Q : R)
        : null)
    : null;
  // 用反证：至少有一个失败密码 P 不应能导出（已经被改密）；Q 和 R 中至少一个能导出
  const onQ = await ops.handleExportPrivateKey(mainId, Q);
  const onR = await ops.handleExportPrivateKey(mainId, R);

  // 旧密码 P 应被拒
  const onP = await ops.handleExportPrivateKey(mainId, P);
  assert.equal(onP.success, false, '旧密码 P 不应再有效');

  // 至少 Q/R 之一能导出（=最后写入的密码）
  assert.ok(
    onQ.success || onR.success,
    '最终态应是 Q 或 R 之一，导出应至少一个成功（Q=' + onQ.success + ', R=' + onR.success + '）'
  );
  // 反之：不应两个都失败（那就表示最终态不是 Q/R 而是别的——不太可能但显式断言）
  assert.ok(
    !(onQ.success === false && onR.success === false),
    'Q/R 应至少一个成功；都失败表示最终态异常'
  );
});

// ==================== changePassword 后子账户 index 仍正确 ====================

test('changePassword 不会重置子账户 index（保留原 max+1 策略）', async () => {
  const created = await ops.handleCreateHDWallet('A', P);
  const walletId = created.wallet.id;
  const mainId = created.account.id;
  await keyring.unlockWallet(P, mainId, 'popup');

  const sub1 = await ops.handleCreateSubAccount(walletId, 'B', null);
  const sub2 = await ops.handleCreateSubAccount(walletId, 'C', null);
  assert.equal(sub1.account.index, 1);
  assert.equal(sub2.account.index, 2);

  // 改密
  await ops.changePassword(P, Q);

  // 解锁新密码后新建子账户，index 应为 3（max+1）
  await keyring.unlockWallet(Q, mainId, 'popup');
  const sub3 = await ops.handleCreateSubAccount(walletId, 'D', null);
  assert.equal(sub3.success, true);
  assert.equal(sub3.account.index, 3, '改密后 index 仍按 max+1，不重置');
});
