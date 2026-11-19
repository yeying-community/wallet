/**
 * 钱包自己的「导出账户文件 → 导入备份文件」:安全与往返正确性。
 *
 * 往返:每一种本地钱包(以太坊 / 波场 / 索拉纳 / 比特币 的 HD 钱包含子账户,以及各链的私钥钱包、
 * 知行图账户)导出后清空钱包、再用备份文件导入,地址、链、私钥都要和原来完全一样。
 *
 * 安全:
 *   - 文件里不能出现任何明文助记词、私钥或种子(只有 AES-GCM 密文);
 *   - 导出必须用当前钱包密码,密码不对拒绝;
 *   - 导入时密码不对、或密文被改动(AES-GCM 认证失败)拒绝,且不留下任何写入;
 *   - 往已有钱包里导入时,密码必须是当前钱包密码:否则导入的账户会被另一个密码加密,之后解不开;
 *   - 重复导入不会产生重复账户。
 *
 * 助记词是 BIP-39 官方测试向量,私钥是公开的测试值,都不是任何真实用户的密钥。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

globalThis.crypto ||= webcrypto;
const store = {};
globalThis.chrome = {
  runtime: { id: 'test-extension-id', getURL: (p = '') => `chrome-extension://test-extension-id/${p}`, sendMessage: async () => ({ success: true }) },
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
    onChanged: { addListener() {}, removeListener() {} }
  }
};

const ops = await import('../js/background/operations/wallet.js');
const { state } = await import('../js/background/state.js');
const { clearPasswordCache } = await import('../js/background/password-cache.js');

const P = 'Pass-1111';
const WRONG = 'Wrong-2222';
const M12 = Array(11).fill('abandon').join(' ') + ' about';
const M24 = Array(23).fill('abandon').join(' ') + ' art';
const EVM_PK = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';
const TRON_PK = '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';
const ZX_SEED = '1111111111111111111111111111111111111111111111111111111111111111';

function reset() {
  for (const k of Object.keys(store)) delete store[k];
  state.keyring = null;
  state.ed25519Keyring = null;
  clearPasswordCache?.();
}

const must = (r, label) => { assert.equal(r?.success, true, `${label}: ${r?.error}`); return r; };

/** 当前所有账户的快照:地址、链、所属钱包类型与名称、私钥(用钱包密码导出)。 */
async function snapshot(password = P) {
  const accounts = Object.values(store.accounts || {});
  const wallets = store.wallets || {};
  const out = [];
  for (const a of accounts) {
    const pk = await ops.handleExportPrivateKey(a.id, password);
    out.push({
      address: String(a.address),
      namespace: a.namespace || 'eip155',
      chainKey: a.chainKey || '',
      index: a.index ?? 0,
      walletType: wallets[a.walletId]?.type,
      privateKey: pk.success ? String(pk.privateKey).toLowerCase().replace(/^0x/, '') : `ERR:${pk.error}`
    });
  }
  return out.sort((x, y) => `${x.namespace}|${x.address}`.localeCompare(`${y.namespace}|${y.address}`));
}

/** 建一套覆盖每种本地钱包的数据。 */
async function buildEverything() {
  const evm = must(await ops.handleImportHDWallet('以太坊 HD', M12, P), 'EVM HD');
  must(await ops.handleCreateSubAccount(evm.wallet.id, '以太坊子账户', P), 'EVM 子账户');
  const tron = must(await ops.handleImportTronHDWallet('波场 HD', M24, P, { tronReference: 'nile' }), 'Tron HD');
  must(await ops.handleCreateTronSubAccount(tron.wallet.id, P), 'Tron 子账户');
  must(await ops.handleImportSolanaHDWallet('索拉纳 HD', M24, P, { solanaReference: 'devnet' }), 'Solana HD');
  must(await ops.handleImportBitcoinHDWallet('比特币 HD', M24, P, { bip122Reference: 'testnet' }), 'Bitcoin HD');
  must(await ops.handleImportPrivateKeyWallet('以太坊私钥', EVM_PK, P), 'EVM 私钥');
  must(await ops.handleImportTronPrivateKeyWallet('波场私钥', TRON_PK, P, { tronReference: 'nile' }), 'Tron 私钥');
  must(await ops.handleImportZhixingWallet('知行图', { privateKey: ZX_SEED }, P), '知行图');
}

test('往返:每种本地钱包导出后再导入,地址、链、私钥都和原来一样', async () => {
  reset();
  await buildEverything();
  const before = await snapshot();
  assert.equal(before.length, 9, `应有 9 个账户(以太坊 HD 2、波场 HD 2、索拉纳 HD 1、比特币 HD 1、以太坊私钥 1、波场私钥 1、知行图 1)`);
  const exp = must(await ops.handleExportAccountsFile(P), '导出');

  reset();
  const imp = must(await ops.handleImportAccountsFile(exp.file, P), '导入');
  const after = await snapshot();
  assert.deepEqual(after.map(({ address, namespace }) => `${namespace} ${address}`),
    before.map(({ address, namespace }) => `${namespace} ${address}`), '账户(链 + 地址)应完全一致');
  assert.deepEqual(after, before, '链标识、钱包类型与私钥也应一致');
  assert.equal(imp.imported, before.length);
});

test('导出的文件里没有任何明文助记词、私钥或种子', async () => {
  reset();
  await buildEverything();
  const exp = must(await ops.handleExportAccountsFile(P), '导出');
  const text = JSON.stringify(exp.file);
  for (const secret of [M12, M24, EVM_PK.slice(2), TRON_PK, ZX_SEED, 'abandon']) {
    assert.ok(!text.includes(secret), `文件里出现了明文:${secret.slice(0, 12)}…`);
  }
  assert.deepEqual(Object.keys(exp.file).sort(), ['cipher', 'ciphertext', 'format', 'version']);
  assert.equal(exp.file.cipher, 'AES-GCM');
});

test('导出:钱包密码不对时拒绝', async () => {
  reset();
  await buildEverything();
  const r = await ops.handleExportAccountsFile(WRONG);
  assert.equal(r.success, false);
  assert.equal(r.file, undefined);
});

test('导入:密码不对、或密文被改动,都拒绝且不写入任何东西', async () => {
  reset();
  await buildEverything();
  const exp = must(await ops.handleExportAccountsFile(P), '导出');

  reset();
  const wrong = await ops.handleImportAccountsFile(exp.file, WRONG);
  assert.equal(wrong.success, false);
  assert.equal(Object.keys(store.accounts || {}).length, 0, '密码不对时不应写入账户');

  const ct = exp.file.ciphertext;
  const i = Math.floor(ct.length / 2);
  const flipped = ct.slice(0, i) + (ct[i] === 'A' ? 'B' : 'A') + ct.slice(i + 1);
  const tampered = await ops.handleImportAccountsFile({ ...exp.file, ciphertext: flipped }, P);
  assert.equal(tampered.success, false);
  assert.equal(Object.keys(store.accounts || {}).length, 0, '密文被改动时不应写入账户');

  for (const bad of [null, {}, { format: 'other', version: 2, ciphertext: ct }, { format: 'yeying-wallet-accounts', version: 9, ciphertext: ct }]) {
    assert.equal((await ops.handleImportAccountsFile(bad, P)).success, false);
  }
});

test('往已有钱包里导入:密码必须是当前钱包密码,否则拒绝', async () => {
  reset();
  await buildEverything();
  const exp = must(await ops.handleExportAccountsFile(P), '导出');

  // 另一个钱包,密码是 Q
  reset();
  const Q = 'Other-3333';
  must(await ops.handleImportHDWallet('另一个钱包', Array(11).fill('zoo').join(' ') + ' wrong', Q), '另一个钱包');
  const countBefore = Object.keys(store.accounts).length;
  // 备份文件本身用 P 加密:用 P 能解开,但 P 不是这个钱包的密码 → 导入的账户将无法用 Q 解锁,必须拒绝
  const r = await ops.handleImportAccountsFile(exp.file, P);
  assert.equal(r.success, false, '密码与当前钱包不一致时应拒绝');
  assert.equal(Object.keys(store.accounts).length, countBefore, '不应写入任何账户');
});

test('重复导入同一个备份文件:跳过已有账户,不产生重复', async () => {
  reset();
  await buildEverything();
  const exp = must(await ops.handleExportAccountsFile(P), '导出');
  const count = Object.keys(store.accounts).length;
  const again = await ops.handleImportAccountsFile(exp.file, P);
  assert.equal(again.imported ?? 0, 0);
  assert.equal(Object.keys(store.accounts).length, count, '账户数不变');
});

test('测试网 HD 钱包派生的子账户仍在同一个测试网上(波场 Nile / 索拉纳 Devnet / 比特币 Testnet)', async () => {
  reset();
  const tron = must(await ops.handleImportTronHDWallet('波场', M24, P, { tronReference: 'nile' }), 'Tron HD');
  const tSub = must(await ops.handleCreateTronSubAccount(tron.wallet.id, P), 'Tron 子账户');
  assert.equal(tSub.account.chainKey, 'tron:nile');
  assert.ok(tSub.account.address.startsWith('27'), `Nile 地址应以 27 开头(前缀 0xa0),实际 ${tSub.account.address}`);
  const sol = must(await ops.handleImportSolanaHDWallet('索拉纳', M24, P, { solanaReference: 'devnet' }), 'Solana HD');
  const sSub = must(await ops.handleCreateSolanaSubAccount(sol.wallet.id, P), 'Solana 子账户');
  assert.equal(sSub.account.chainKey, sol.account.chainKey);
  const btc = must(await ops.handleImportBitcoinHDWallet('比特币', M24, P, { bip122Reference: 'testnet' }), 'Bitcoin HD');
  const bSub = must(await ops.handleCreateBitcoinSubAccount(btc.wallet.id, P), 'Bitcoin 子账户');
  assert.equal(bSub.account.chainKey, btc.account.chainKey);
  assert.ok(bSub.account.address.startsWith('tb1'), `测试网地址应以 tb1 开头,实际 ${bSub.account.address}`);
});

test('波场测试网地址(35 位)能被识别;多个测试网账户不会被当成重复', async () => {
  const { normalizeAddressForFamily } = await import('../js/common/chain/address-normalize.js');
  await import('../js/chain/adapters/tron/address.js'); // 注册 Base58Check 严格校验
  assert.equal(normalizeAddressForFamily('27T8ah1q7SgfBgPVedXbRFAZarHFLm7YxLJ', 'tron'), '27T8ah1q7SgfBgPVedXbRFAZarHFLm7YxLJ');
  assert.equal(normalizeAddressForFamily('TKkgw2wLr84qg3wB525orEpag6Ao3GF9xt', 'tron'), 'TKkgw2wLr84qg3wB525orEpag6Ao3GF9xt');
  assert.equal(normalizeAddressForFamily('27T8ah1q7SgfBgPVedXbRFAZarHFLm7YxLX', 'tron'), '', '校验和不对的地址仍然拒绝');
});
