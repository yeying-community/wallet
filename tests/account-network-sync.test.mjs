/**
 * 首页「通证」页签的币种与账户 / 网络一致性。
 *
 * 根因与守门点:
 *   1. 非 EVM 网络(波场 / 索拉纳 / 比特币)的网络信息只返回 chainKey,没有原生币的符号与名称,
 *      首页只能显示默认的「ETH / 原生代币」→ GET_NETWORK_INFO 带上完整网络配置;
 *   2. 原生币只在有数字 chainId 时才读网络信息,非 EVM 网络永远拿不到 → 总是按网络信息取;
 *   3. 网络与账户各选各的:「以太坊网络 + 波场账户」查不到余额(显示「暂无通证」),
 *      「波场网络 + 以太坊地址」拿以太坊地址去查波场 → 切网络时换成该链的账户,切账户时换到该账户的链。
 *
 * 助记词是 BIP-39 官方测试向量,不是任何真实用户的密钥。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

globalThis.crypto ||= webcrypto;
const store = {};
globalThis.chrome = {
  runtime: {
    id: 'test-extension-id',
    getURL: (p = '') => `chrome-extension://test-extension-id/${p}`,
    sendMessage: async () => ({ success: true }),
    onMessage: { addListener() {} }, onConnect: { addListener() {} },
    onInstalled: { addListener() {} }, onStartup: { addListener() {} }
  },
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
  },
  windows: { onRemoved: { addListener() {} } }
};

const { handlePopupMessage } = await import('../js/background/message-handler.js');
const { ensureDefaultNetworks } = await import('../js/storage/network-storage.js');
const { NETWORKS } = await import('../js/config/network-config.js');
const { state } = await import('../js/background/state.js');
const { TokenDomain } = await import('../js/domain/token-domain.js');
const { WalletDomain } = await import('../js/domain/wallet-domain.js');

const P = 'Pass-1111';
const M12 = Array(11).fill('abandon').join(' ') + ' about';
const M24 = Array(23).fill('abandon').join(' ') + ' art';

const call = (type, data = {}) => new Promise((resolve) => handlePopupMessage({ type, data }, resolve));

async function setup() {
  for (const k of Object.keys(store)) delete store[k];
  state.keyring = null;
  state.ed25519Keyring = null;
  await ensureDefaultNetworks(NETWORKS);
  const evm = await call('IMPORT_HD_WALLET', { accountName: '以太坊', mnemonic: M12, password: P });
  await call('IMPORT_TRON_HD_WALLET', { accountName: '波场', mnemonic: M24, password: P, options: {} });
  await call('IMPORT_SOLANA_HD_WALLET', { accountName: '索拉纳', mnemonic: M24, password: P, options: {} });
  await call('IMPORT_BITCOIN_HD_WALLET', { accountName: '比特币', mnemonic: M24, password: P, options: {} });
  const accounts = Object.values(store.accounts);
  return { evm, byNs: (ns) => accounts.find((a) => (a.namespace || 'eip155') === ns) };
}
const currentNs = async () => (await call('GET_CURRENT_ACCOUNT')).account?.namespace || 'eip155';

test('非 EVM 网络的网络信息带原生币:波场 TRX、索拉纳 SOL、比特币 BTC', async () => {
  await setup();
  for (const [key, symbol] of [['tronMainnet', 'TRX'], ['tronNile', 'TRX'], ['solanaMainnet', 'SOL'], ['bitcoinMainnet', 'BTC']]) {
    assert.equal((await call('SWITCH_NETWORK', { networkKey: key })).success, true, key);
    const info = (await call('GET_NETWORK_INFO')).network;
    assert.equal(info.chainKey, NETWORKS[key].chainKey, key);
    assert.equal(info.nativeCurrency?.symbol, symbol, key);
    assert.equal(info.chainId, null, `${key} 仍然没有数字 chainId`);
  }
});

test('原生币按网络信息取:非 EVM 网络不再显示「ETH / 原生代币」', async () => {
  const fakeNetwork = (info) => ({ getChainId: async () => info.chainId ?? null, getNetworkInfo: async () => info });
  const domain = (info) => {
    const d = new TokenDomain({ network: fakeNetwork(info) });
    d._sendMessage = async () => ({ balance: '0' });
    return d;
  };
  const tron = await domain({ chainId: null, chainKey: 'tron:mainnet', ...NETWORKS.tronMainnet }).getNativeToken('TG6Z27SW1WEX8BD1psgCiZc9UT1Z2vtE6L');
  assert.equal(tron.symbol, 'TRX');
  assert.equal(tron.name, 'TRX');
  const sol = await domain({ chainId: null, chainKey: 'solana:devnet', ...NETWORKS.solanaDevnet }).getNativeToken('FpDYyXCg4AW2NjBvNQ9vXHWqsDaX9JbKGgvSDyqLhXXN');
  assert.equal(sol.symbol, 'SOL');
  const eth = await domain({ chainId: '0x1', ...NETWORKS.ethereum }).getNativeToken('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
  assert.equal(eth.symbol, 'ETH');
  assert.equal(eth.name, 'Ether');
});

test('切网络:当前账户不在这条链上,就换成这条链的账户', async () => {
  const { byNs } = await setup();
  await call('SWITCH_ACCOUNT', { accountId: byNs('eip155').id, password: P });
  for (const [key, ns] of [['tronMainnet', 'tron'], ['solanaMainnet', 'solana'], ['bitcoinMainnet', 'bip122'], ['ethereum', 'eip155'], ['sepolia', 'eip155']]) {
    await call('SWITCH_NETWORK', { networkKey: key });
    assert.equal(await currentNs(), ns, `切到 ${key} 后账户应在 ${ns} 上`);
  }
  // 知行图首页用钱包里的知行图账户,不改当前账户
  await call('SWITCH_NETWORK', { networkKey: 'zhixingTestnet' });
  assert.equal(await currentNs(), 'eip155');
});

test('切账户:网络跟着换到该账户的链;同一族内不动网络', async () => {
  const { evm, byNs } = await setup();
  await call('SWITCH_NETWORK', { networkKey: 'sepolia' });
  for (const [ns, chainPrefix] of [['tron', 'tron:'], ['solana', 'solana:'], ['bip122', 'bip122:'], ['eip155', 'eip155:']]) {
    const r = await call('SWITCH_ACCOUNT', { accountId: byNs(ns).id, password: P });
    assert.equal(r.success, true, ns);
    assert.ok(String(state.currentChainKey).startsWith(chainPrefix), `切到 ${ns} 账户后网络应是 ${chainPrefix}…,实际 ${state.currentChainKey}`);
  }
  // 以太坊账户在 Sepolia 上切到另一个以太坊账户:网络保持 Sepolia,不跳回主网
  await call('SWITCH_NETWORK', { networkKey: 'sepolia' });
  const sub = await call('CREATE_SUB_ACCOUNT', { walletId: evm.wallet.id, accountName: '以太坊 2', password: P });
  assert.equal(sub.success, true, sub.error);
  await call('SWITCH_ACCOUNT', { accountId: sub.account.id, password: P });
  assert.equal(state.currentChainKey, 'eip155:11155111');
});

test('这条链上没有账户:不换账户(首页提示去新建或导入)', async () => {
  for (const k of Object.keys(store)) delete store[k];
  state.keyring = null;
  await ensureDefaultNetworks(NETWORKS);
  await call('IMPORT_HD_WALLET', { accountName: '以太坊', mnemonic: M12, password: P });
  const r = await call('SWITCH_NETWORK', { networkKey: 'tronMainnet' });
  assert.equal(r.success, true);
  assert.equal(r.accountId, undefined);
  assert.equal(await currentNs(), 'eip155');
});


// ---- 隐藏 bug:切换账户 / 解锁只回 { id, name, address },popup 把它缓存成「当前账户」----
// 缺了 namespace / chainKey,popup 里所有判断账户所在链的地方都退回以太坊:
// 首页网络菜单(按账户过滤)一直列以太坊网络、发送页按以太坊处理比特币账户……刷新页面才恢复。

function assertPublicAccount(account, label) {
  assert.ok(account, `${label}:应返回账户`);
  assert.ok(account.namespace && account.chainKey, `${label}:必须带 namespace 与 chainKey,实际 ${JSON.stringify(Object.keys(account))}`);
  for (const key of Object.keys(account)) assert.ok(!/^encrypted/i.test(key), `${label}:不能带加密的密钥材料 ${key}`);
}

test('切换账户、解锁、读当前账户都返回带链身份、不带密钥材料的账户', async () => {
  const { byNs } = await setup();
  for (const ns of ['bip122', 'tron', 'solana', 'eip155']) {
    const target = byNs(ns);
    const switched = await call('SWITCH_ACCOUNT', { accountId: target.id, password: P });
    assert.equal(switched.success, true, ns);
    assertPublicAccount(switched.account, `SWITCH_ACCOUNT ${ns}`);
    assert.equal(switched.account.namespace, ns);
    assert.equal(switched.account.chainKey, target.chainKey);
    assertPublicAccount((await call('GET_CURRENT_ACCOUNT')).account, `GET_CURRENT_ACCOUNT ${ns}`);
  }
  await call('SWITCH_ACCOUNT', { accountId: byNs('bip122').id, password: P });
  await call('LOCK_WALLET');
  const unlocked = await call('UNLOCK_WALLET', { password: P });
  assert.equal(unlocked.success, true);
  assertPublicAccount(unlocked.account, 'UNLOCK_WALLET');
  assert.equal(unlocked.account.namespace, 'bip122', '解锁后仍是比特币账户');
});

test('popup 的账户缓存:连续切换账户后,读到的始终是带链身份的当前账户', async () => {
  const { byNs } = await setup();
  const wallet = new WalletDomain();
  wallet._sendMessage = (type, data) => call(type, data).then((r) => {
    if (r?.success === false) throw new Error(r.error);
    return r;
  });
  for (const ns of ['tron', 'bip122', 'eip155', 'solana', 'bip122']) {
    await wallet.switchAccount(byNs(ns).id, P);
    const cur = await wallet.getCurrentAccount();
    assert.equal(cur?.namespace, ns, `切到 ${ns} 后缓存的账户`);
  }
  // 旧后台只回 id / 名称 / 地址:不缓存,下次读向后台重取,而不是当成以太坊账户
  wallet._cacheAccount({ id: byNs('tron').id, name: '波场', address: 'T…' });
  assert.equal(wallet._currentAccount, null);
  // 后台在 popup 之外换了账户(切到别的链):失效后重取
  await call('SWITCH_NETWORK', { networkKey: 'tronMainnet' });
  wallet.invalidateCurrentAccount();
  assert.equal((await wallet.getCurrentAccount())?.namespace, 'tron');
});
