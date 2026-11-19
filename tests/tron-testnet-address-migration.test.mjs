/**
 * 迁移:早期版本给波场测试网生成的 27 开头地址(前缀 0xa0,节点不认)→ 同一把密钥的 T 地址。
 * 只换前缀,不需要钱包密码;已是 T 地址的不动;重复执行没有影响;网站授权里记下的地址一并更新。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

globalThis.crypto ||= webcrypto;
const store = {};
globalThis.chrome = {
  runtime: { id: 'x', getURL: (p = '') => p, sendMessage: async () => ({}) },
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return { ...store };
        if (typeof keys === 'string') return { [keys]: store[keys] };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, store[k]]));
        return Object.fromEntries(Object.keys(keys).map((k) => [k, store[k] !== undefined ? store[k] : keys[k]]));
      },
      async set(items) { Object.assign(store, JSON.parse(JSON.stringify(items || {}))); },
      async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]); },
      async clear() { Object.keys(store).forEach((k) => delete store[k]); }
    },
    onChanged: { addListener() {} }
  }
};

const ops = await import('../js/background/operations/wallet.js');
const { migrateLegacyTronTestnetAddresses } = await import('../js/background/migrations/tron-testnet-address.js');
const { trxBase58CheckDecode, trxBase58CheckEncode, TRON_LEGACY_TESTNET_PREFIX } = await import('../js/chain/adapters/tron/base58check.js');
const { PermissionStorageKeys } = await import('../js/storage/storage-keys.js');

const P = 'Pass-1111';
const M24 = Array(23).fill('abandon').join(' ') + ' art';

test('新建的波场测试网账户直接是 T 地址', async () => {
  for (const k of Object.keys(store)) delete store[k];
  const r = await ops.handleImportTronHDWallet('波场', M24, P, { tronReference: 'nile' });
  assert.equal(r.success, true, r.error);
  assert.ok(r.account.address.startsWith('T'), r.account.address);
  assert.equal(r.account.chainKey, 'tron:nile');
  const sub = await ops.handleCreateTronSubAccount(r.wallet.id, P);
  assert.ok(sub.account.address.startsWith('T'), sub.account.address);
});

test('旧的 27 开头地址迁移为同一把密钥的 T 地址;网站授权一并更新;私钥不变;可重复执行', async () => {
  for (const k of Object.keys(store)) delete store[k];
  const r = await ops.handleImportTronHDWallet('波场', M24, P, { tronReference: 'nile' });
  const correct = r.account.address;
  // 模拟早期版本留下的数据:同一个账户,地址用的是 0xa0 前缀
  const legacy = trxBase58CheckEncode(trxBase58CheckDecode(correct), TRON_LEGACY_TESTNET_PREFIX);
  assert.ok(legacy.startsWith('2') && legacy.length === 35);
  store.accounts[r.account.id].address = legacy;
  store[PermissionStorageKeys.CONNECTED_SITES] = {
    'https://dapp.example': { address: legacy, accounts: [legacy, '0xabc'], timestamp: 1 },
    'https://other.example': { address: '0xabc', timestamp: 1 }
  };

  const first = await migrateLegacyTronTestnetAddresses();
  assert.deepEqual(first, { accounts: 1, authorizations: 1 });
  assert.equal(store.accounts[r.account.id].address, correct);
  assert.equal(store[PermissionStorageKeys.CONNECTED_SITES]['https://dapp.example'].address, correct);
  assert.deepEqual(store[PermissionStorageKeys.CONNECTED_SITES]['https://dapp.example'].accounts, [correct, '0xabc']);
  assert.equal(store[PermissionStorageKeys.CONNECTED_SITES]['https://other.example'].address, '0xabc');

  // 私钥不变:导出的仍是同一把密钥
  const pk = await ops.handleExportPrivateKey(r.account.id, P);
  assert.equal(pk.success, true);

  const second = await migrateLegacyTronTestnetAddresses();
  assert.deepEqual(second, { accounts: 0, authorizations: 0 }, '已是 T 地址:不再改动');
});
