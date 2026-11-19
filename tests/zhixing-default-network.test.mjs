/**
 * 知行图作为默认网络:迁移、非 EVM 守门、重置。
 *
 * 背景:旧默认网络 YeYing Mainnet(EVM chainId 5432,RPC https://blockchain.yeying.pub)已停用,
 * 那个域名现在是知行图(REST + JSON,不是以太坊 JSON-RPC)。守门点:
 *   - 已安装的钱包:存储里的旧网络条目被移除;选中的若是它,切到知行图;用户自己加的 5432(别的 RPC)保留;
 *   - 选中知行图时,不会把 JSON-RPC 发到知行图接口;不弹审批让用户确认注定失败的以太坊交易;
 *   - 知行图没有余额与通证;
 *   - 重置钱包后落在知行图上(而不是因为推导数字 chainId 而抛错)。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

globalThis.crypto ||= webcrypto;
const store = {};
const session = {};
const mkArea = (bag) => ({
  async get(keys) {
    if (keys == null) return { ...bag };
    if (typeof keys === 'string') return { [keys]: bag[keys] };
    if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, bag[k]]));
    return Object.fromEntries(Object.keys(keys).map((k) => [k, bag[k] !== undefined ? bag[k] : keys[k]]));
  },
  async set(items) { Object.assign(bag, items || {}); },
  async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete bag[k]); },
  async clear() { Object.keys(bag).forEach((k) => delete bag[k]); }
});
globalThis.chrome = {
  runtime: { id: 'test', getURL: (p = '') => `chrome-extension://test/${p}`, sendMessage: async () => ({ success: true }) },
  storage: { local: mkArea(store), session: mkArea(session), onChanged: { addListener() {}, removeListener() {} } }
};
const reset = () => { for (const b of [store, session]) for (const k of Object.keys(b)) delete b[k]; };

const { NETWORKS, DEFAULT_NETWORK, formatNetworkConfig } = await import('../js/config/network-config.js');
const { ensureDefaultNetworks, getNetworks, getSelectedNetworkName, saveSelectedNetworkName, getNetworkConfigByKey, isLegacyYeyingNetwork } =
  await import('../js/storage/network-storage.js');
const { chainKeyFromNetwork, isEvmChainKey } = await import('../js/chain/chain-key.js');
const { state } = await import('../js/background/state.js');
const { handleRpcMethod } = await import('../js/background/rpc-handler.js');
const { handleGetBalance, handleGetTokenBalances } = await import('../js/background/operations/tokens.js');

const LEGACY = {
  key: 'yeying', id: 'yeying', name: 'YeYing Mainnet', chainId: 5432, chainIdHex: '0x1538',
  rpc: 'https://blockchain.yeying.pub', rpcUrl: 'https://blockchain.yeying.pub', symbol: 'YYT', decimals: 18
};

test('formatNetworkConfig / chainKeyFromNetwork 认识知行图(不落进 EVM 分支产生 NaN chainId)', () => {
  const f = formatNetworkConfig({ namespace: 'zhixing', reference: 'testnet', name: 'x', rpcUrl: 'https://r/rpc' });
  assert.equal(f.chainKey, 'zhixing:testnet');
  assert.equal(f.chainId, undefined);
  assert.equal(f.hasAssets, false);
  assert.equal(chainKeyFromNetwork(NETWORKS.zhixingTestnet), 'zhixing:testnet');
  assert.equal(isEvmChainKey('zhixing:testnet'), false);
  assert.equal(isEvmChainKey('eip155:1'), true);
});

test('迁移:存储里的旧 YeYing 网络被移除,选中它的切到知行图', async () => {
  reset();
  store.networks = [LEGACY];
  await saveSelectedNetworkName('yeying');
  const merged = await ensureDefaultNetworks(NETWORKS);
  assert.ok(!merged.some((n) => n.key === 'yeying'));
  assert.ok(!(await getNetworks()).some((n) => n.key === 'yeying'));
  assert.ok(merged.some((n) => n.key === 'zhixingTestnet'));
  assert.equal(await getSelectedNetworkName(), DEFAULT_NETWORK);
  const cfg = await getNetworkConfigByKey(DEFAULT_NETWORK);
  assert.equal(cfg.chainKey, 'zhixing:testnet');
});

test('迁移:选中项存成 0x1538 / 5432 也能识别', async () => {
  for (const sel of ['0x1538', '5432']) {
    reset();
    store.networks = [LEGACY];
    await saveSelectedNetworkName(sel);
    await ensureDefaultNetworks(NETWORKS);
    assert.equal(await getSelectedNetworkName(), DEFAULT_NETWORK, sel);
  }
});

test('迁移:旧 legacy 键里的 YeYing 也清掉,下次启动不会被合并回来', async () => {
  reset();
  store.networkConfigs = [LEGACY];
  store.customNetworks = [LEGACY];
  await ensureDefaultNetworks(NETWORKS);
  await ensureDefaultNetworks(NETWORKS); // 第二次启动
  assert.ok(!(await getNetworks()).some(isLegacyYeyingNetwork));
  assert.deepEqual(store.networkConfigs, []);
  assert.deepEqual(store.customNetworks, []);
});

test('迁移:用户自己加的、指向别的 RPC 的 5432 网络保留,选中项也不动', async () => {
  reset();
  const mine = { ...LEGACY, key: undefined, id: 'my-5432', name: 'My 5432', rpc: 'https://rpc.example.org', rpcUrl: 'https://rpc.example.org' };
  store.networks = [mine];
  await saveSelectedNetworkName('0x1538');
  const merged = await ensureDefaultNetworks(NETWORKS);
  assert.ok(merged.some((n) => n.id === 'my-5432'));
  assert.equal(await getSelectedNetworkName(), '0x1538');
});

test('迁移是幂等的:没有旧网络时什么都不改', async () => {
  reset();
  await saveSelectedNetworkName('ethereum');
  await ensureDefaultNetworks(NETWORKS);
  const first = JSON.stringify(await getNetworks());
  await ensureDefaultNetworks(NETWORKS);
  assert.equal(JSON.stringify(await getNetworks()), first);
  assert.equal(await getSelectedNetworkName(), 'ethereum');
});

test('选中知行图时:不把 JSON-RPC 发到知行图接口(4901),不查余额、不列通证', async () => {
  reset();
  state.currentChainKey = 'zhixing:testnet';
  state.currentRpcUrl = 'https://blockchain.yeying.pub/rpc';
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called += 1; throw new Error('should not be called'); };
  try {
    await assert.rejects(() => handleRpcMethod('eth_blockNumber', []), (e) => e.code === 4901);
    const bal = await handleGetBalance('0x' + '11'.repeat(20));
    assert.equal(bal.success, false);
    assert.match(bal.error, /知行图没有余额/);
    const tok = await handleGetTokenBalances('0x' + '11'.repeat(20));
    assert.deepEqual(tok, { success: true, tokens: [] });
    assert.equal(called, 0, '不应发出任何网络请求');
  } finally {
    globalThis.fetch = realFetch;
    state.currentChainKey = null;
    state.currentRpcUrl = null;
  }
});

test('重置钱包后落在知行图上,不再因推导数字 chainId 而失败', async () => {
  reset();
  const ops = await import('../js/background/operations/wallet.js');
  const created = await ops.handleCreateHDWallet('Acc1', 'Pass-1111');
  assert.equal(created.success, true);
  const r = await ops.handleResetWallet();
  assert.equal(r.success, true);
  assert.equal(state.currentChainKey, 'zhixing:testnet');
  assert.equal(state.currentRpcUrl, 'https://blockchain.yeying.pub/rpc');
  assert.equal(await getSelectedNetworkName(), DEFAULT_NETWORK);
});
