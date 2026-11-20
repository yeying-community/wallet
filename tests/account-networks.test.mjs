/**
 * 首页选了账户之后,通证 / 藏品 / 活动里的网络菜单只列这个账户能用的网络。
 * 用内置网络表验证:比特币账户不会看到以太坊、波场;比特币主网账户也不会看到比特币测试网(地址编码了网络)。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { NETWORKS } = await import('../js/config/network-config.js');
const { networksForAccount, isNetworkUsableByAccount } = await import('../js/config/account-networks.js');

const all = Object.entries(NETWORKS).map(([key, n]) => ({ key, ...n }));
const keys = (account) => networksForAccount(account, all).map((n) => n.key).sort();
const evmKeys = all.filter((n) => !n.chainKey || n.chainKey.startsWith('eip155:')).map((n) => n.key).sort();

test('以太坊系账户:列出全部 EVM 网络,不列波场 / 索拉纳 / 比特币 / 知行图', () => {
  const account = { namespace: 'eip155', chainKey: 'eip155:1', address: '0x0000000000000000000000000000000000000001' };
  assert.deepEqual(keys(account), evmKeys);
  assert.ok(evmKeys.length >= 2, '内置 EVM 网络应不止一个');
});

test('比特币账户:只列账户所在的那个比特币网络', () => {
  assert.deepEqual(keys({ namespace: 'bip122', chainKey: 'bip122:mainnet', address: 'bc1qxyz' }),
    all.filter((n) => n.chainKey === 'bip122:mainnet').map((n) => n.key).sort());
  assert.deepEqual(keys({ namespace: 'bip122', chainKey: 'bip122:testnet', address: 'tb1qxyz' }),
    all.filter((n) => n.chainKey === 'bip122:testnet').map((n) => n.key).sort());
  // 旧数据里命名空间可能写作 utxo
  assert.deepEqual(keys({ namespace: 'utxo', chainKey: 'bip122:mainnet' }),
    all.filter((n) => n.chainKey === 'bip122:mainnet').map((n) => n.key).sort());
});

test('波场 / 索拉纳 / 知行图账户:列出同一条链的全部网络(主网与测试网地址相同)', () => {
  for (const [ns, chainKey] of [['tron', 'tron:mainnet'], ['solana', 'solana:mainnet-beta'], ['zhixing', 'zhixing:testnet']]) {
    const expected = all.filter((n) => String(n.chainKey || '').startsWith(ns + ':')).map((n) => n.key).sort();
    assert.ok(expected.length >= 1);
    assert.deepEqual(keys({ namespace: ns, chainKey }), expected, ns);
  }
});

test('没有选中账户时不过滤;自定义 EVM 网络(没有 chainKey)算作 EVM', () => {
  assert.equal(networksForAccount(null, all).length, all.length);
  const custom = { key: 'my-l2', rpcUrl: 'http://127.0.0.1:8545', chainId: '0x7a69' };
  assert.equal(isNetworkUsableByAccount({ namespace: 'eip155' }, custom), true);
  assert.equal(isNetworkUsableByAccount({ namespace: 'bip122', chainKey: 'bip122:mainnet' }, custom), false);
});
