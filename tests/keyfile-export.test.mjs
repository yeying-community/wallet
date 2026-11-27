/**
 * 通用「加密导出」:任何链的账户都能把自己的密钥导成一个加密文件。
 *
 * 格式是钱包自己的 `yeying-wallet-key`(密文用 AES-256-GCM + PBKDF2),
 * 与钱包已有的备份文件格式(`yeying-wallet-accounts`)同族,但只含一个账户的密钥。
 *
 * 安全:
 *   - 文件里不能出现明文私钥/种子(只有密文);
 *   - 口令是**文件自己的**(与钱包密码无关):口令不对解不开;
 *   - 文件里带着 namespace/chainKey,消费方才知道怎么解释那段字节。
 *
 * 知行图账户另有一条路(`handleExportZhixingKeystore`):Web3 Secret Storage v3,
 * 链侧工具只认那个格式——由 tests/zhixing-keystore-export.test.mjs 守着。
 *
 * 私钥是公开的测试值,不是任何真实用户的密钥。
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
const { decryptString } = await import('../js/common/crypto/encryption.js');

const P = 'Pass-1111';
const FILE_PW = 'file-pass-123';
const WRONG_FILE_PW = 'wrong-file-pw';
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

async function buildAll() {
  const evm = must(await ops.handleImportPrivateKeyWallet('以太坊私钥', EVM_PK, P), 'EVM 私钥');
  const tron = must(await ops.handleImportTronPrivateKeyWallet('波场私钥', TRON_PK, P, { tronReference: 'nile' }), 'Tron 私钥');
  const zx = must(await ops.handleImportZhixingWallet('知行图', { privateKey: ZX_SEED }, P), '知行图');
  return { evm, tron, zx };
}

test('导出:文件里是密文,不含明文私钥', async () => {
  reset();
  const { evm } = await buildAll();
  const accountId = evm.account.id;
  const exp = must(await ops.handleExportAccountKeyfile(accountId, P, FILE_PW), '导出');
  const text = exp.keystore;
  assert.ok(!text.includes(EVM_PK), '文件里出现了明文私钥');
  assert.ok(!text.includes(EVM_PK.slice(2)), '文件里出现了不带 0x 的明文私钥');
  // 信封的形状
  const file = JSON.parse(text);
  assert.equal(file.format, 'yeying-wallet-key');
  assert.equal(file.version, 1);
  assert.equal(file.cipher, 'AES-GCM');
  assert.ok(file.ciphertext.startsWith('v2.'), '密文应是钱包自己的 v2 格式');
});

test('导出:用文件口令能解回同一个私钥', async () => {
  reset();
  const { evm, tron, zx } = await buildAll();
  for (const [label, wallet] of [['EVM', evm], ['Tron', tron], ['知行图', zx]]) {
    const exp = must(await ops.handleExportAccountKeyfile(wallet.account.id, P, FILE_PW), `${label} 导出`);
    const file = JSON.parse(exp.keystore);
    const secret = await decryptString(file.ciphertext, FILE_PW);
    const original = await ops.handleExportPrivateKey(wallet.account.id, P);
    assert.equal(String(secret).toLowerCase(), String(original.privateKey).toLowerCase(), `${label} 解出来的私钥应当一样`);
  }
});

test('导出:文件口令不对解不开', async () => {
  reset();
  const { evm } = await buildAll();
  const exp = must(await ops.handleExportAccountKeyfile(evm.account.id, P, FILE_PW), '导出');
  const file = JSON.parse(exp.keystore);
  await assert.rejects(() => decryptString(file.ciphertext, WRONG_FILE_PW));
});

test('导出:文件里带着链的信息,消费方才知道怎么解释', async () => {
  reset();
  const { evm, tron, zx } = await buildAll();
  const evmFile = JSON.parse((await ops.handleExportAccountKeyfile(evm.account.id, P, FILE_PW)).keystore);
  assert.equal(evmFile.chain.namespace, 'eip155');
  assert.equal(evmFile.chain.curve, 'secp256k1');
  const tronFile = JSON.parse((await ops.handleExportAccountKeyfile(tron.account.id, P, FILE_PW)).keystore);
  assert.equal(tronFile.chain.namespace, 'tron');
  const zxFile = JSON.parse((await ops.handleExportAccountKeyfile(zx.account.id, P, FILE_PW)).keystore);
  assert.equal(zxFile.chain.namespace, 'zhixing');
  assert.equal(zxFile.chain.curve, 'ed25519-seed', '知行图与索拉纳是 ed25519 种子');
});

test('导出:文件名带账户名', async () => {
  reset();
  const { evm } = await buildAll();
  const exp = must(await ops.handleExportAccountKeyfile(evm.account.id, P, FILE_PW), '导出');
  assert.match(exp.filename, /^wallet-key-.*-\d{4}-\d{2}-\d{2}\.json$/);
  assert.ok(exp.filename.includes('以太坊私钥'), `文件名应当带账户名:${exp.filename}`);
});

test('导出:参数不对时拒绝', async () => {
  reset();
  const { evm } = await buildAll();
  assert.equal((await ops.handleExportAccountKeyfile(evm.account.id, P, 'short')).success, false, '文件口令太短要拒绝');
  assert.equal((await ops.handleExportAccountKeyfile(evm.account.id, '', FILE_PW)).success, false, '没有钱包密码要拒绝');
  assert.equal((await ops.handleExportAccountKeyfile('', P, FILE_PW)).success, false, '没有账户号要拒绝');
  assert.equal((await ops.handleExportAccountKeyfile('no-such-account', P, FILE_PW)).success, false, '账户不存在要拒绝');
});

test('导出:钱包密码不对时拒绝', async () => {
  reset();
  const { evm } = await buildAll();
  const exp = await ops.handleExportAccountKeyfile(evm.account.id, 'Wrong-2222', FILE_PW);
  assert.equal(exp.success, false);
});
