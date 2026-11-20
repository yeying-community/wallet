/**
 * 知行图账户:在「账户管理 → 导入钱包」里按链导入,是普通的钱包账户(namespace=zhixing)。
 *
 * 守门点:
 *   - 助记词 / 64 位十六进制种子 / node keygen 的明文种子文件 / 加密密钥文件四种方式,
 *     得到的都是既有成员的同一个公钥;私钥字段加密保存,明文种子不落盘;
 *   - 同一个知行图账户不能重复导入;
 *   - 解锁 / 锁定 / 改密都走普通账户的路径(锁定清掉内存里的 ed25519 密钥,改密后只认新密码);
 *   - 选中哪个知行图账户就用哪个签名;站点授权按网站记录,换了账户不再算授权;
 *   - 网页给的签名请求在弹窗前就被校验;签出的字节与知行图节点一致。
 *
 * 助记词是 BIP-39 官方测试向量(全零熵),不是任何真实成员的密钥。
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
    sendMessage: async () => ({ success: true })
  },
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return { ...store };
        if (typeof keys === 'string') return { [keys]: store[keys] };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, store[k]]));
        return Object.fromEntries(Object.keys(keys).map((k) => [k, store[k] !== undefined ? store[k] : keys[k]]));
      },
      async set(items) { Object.assign(store, items || {}); },
      async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]); },
      async clear() { Object.keys(store).forEach((k) => delete store[k]); }
    },
    onChanged: { addListener() {}, removeListener() {} }
  }
};

const Z = await import('../js/background/operations/zhixing.js');
const ops = await import('../js/background/operations/wallet.js');
const keyring = await import('../js/background/keyring.js');
const { state } = await import('../js/background/state.js');
const { cachePassword, clearPasswordCache } = await import('../js/background/password-cache.js');
const { ZhixingStorageKeys } = await import('../js/storage/storage-keys.js');

const ZERO24 = Array(23).fill('abandon').join(' ') + ' art';
// 知行图节点 `node keygen` 对 ZERO24 给出的公钥(**旧规则**:BIP-39 种子前 32 字节)。
// 2026-11-20 起,助记词默认按**标准规则**(SLIP-0010 m/44'/1105'/0'/0'/0')派生,
// 旧规则只在明确要求时用(恢复早期成员的密钥)。
const ZERO24_LEGACY_PUBKEY = '1de352e44cd333672593f2334a730e180aaf290de89aa16d480de594e34e2961';
// 标准规则下 ZERO24 的公钥(与 `node keygen --mnemonic` 默认一致)
const ZERO24_PUBKEY = '741c8d9dcb69f5c2ae4e1009408613b47620f7360298c4bbae93f864364f9d57';
const P = 'Pass-1111';
const Q = 'Pass-2222';

function reset() {
  for (const k of Object.keys(store)) delete store[k];
  state.keyring = null;
  state.ed25519Keyring = null;
  clearPasswordCache?.();
}

const fs = await import('node:fs');
const RUST_KEYSTORE = fs.readFileSync(new URL('./fixtures/zhixing-keystore.json', import.meta.url), 'utf8');
const RUST_SEED_FILE = fs.readFileSync(new URL('./fixtures/zhixing-seed.txt', import.meta.url), 'utf8');
const RUST_SEED_HEX = RUST_SEED_FILE.split('\n').find((l) => /^[0-9a-f]{64}$/.test(l.trim())).trim();
const imp = (source, name = '成员', options = {}) => ops.handleImportZhixingWallet(name, source, P, options);



test('四种导入方式都得到既有成员的同一个公钥,账户是 namespace=zhixing 的普通钱包账户', async () => {
  const cases = [
    ['助记词', { mnemonic: ZERO24 }, ZERO24_PUBKEY],
    ['64 位种子', { privateKey: RUST_SEED_HEX }, ZERO24_LEGACY_PUBKEY],
    ['0x 种子', { privateKey: '0x' + RUST_SEED_HEX }, ZERO24_LEGACY_PUBKEY],
    ['明文种子文件', { privateKey: RUST_SEED_FILE }, ZERO24_LEGACY_PUBKEY],
    ['加密密钥文件', { privateKey: RUST_KEYSTORE, filePassword: 'ks-password-123' }, ZERO24_LEGACY_PUBKEY]
  ];
  for (const [label, source, expected] of cases) {
    reset();
    const r = await imp(source);
    assert.equal(r.success, true, label + ': ' + r.error);
    assert.equal(r.account.address, expected, label);
    assert.equal(r.account.namespace, 'zhixing', label);
    assert.equal(r.account.chainKey, 'zhixing:testnet', label);
    assert.equal(r.wallet.type, 'imported', label + ':一把种子一个账户,不能派生子账户');
    assert.equal(await Z.getZhixingKeyInfo().then((x) => x.address), expected, label);
    const raw = JSON.stringify(store);
    assert.ok(!raw.includes(RUST_SEED_HEX), label + ':存储里不能出现明文种子');
  }
});

test('导入失败的情形:助记词无效、加密文件缺口令/口令错、公钥注释对不上、重复导入', async () => {
  reset();
  assert.equal((await imp({ mnemonic: 'abandon abandon' })).success, false);
  const noPw = await imp({ privateKey: RUST_KEYSTORE });
  assert.match(noPw.error, /口令/);
  const wrongPw = await imp({ privateKey: RUST_KEYSTORE, filePassword: 'wrong' });
  assert.match(wrongPw.error, /口令不对/);
  const tampered = RUST_SEED_FILE.replace(/# pubkey: [0-9a-f]+/, '# pubkey: ' + 'ff'.repeat(32));
  assert.match((await imp({ privateKey: tampered })).error, /公钥不一致/);
  assert.equal((await imp({ mnemonic: ZERO24 })).success, true);
  // 助记词(标准规则)与种子文件(旧规则)派生出的是**不同的**公钥,所以不是重复导入
  const other = await imp({ privateKey: RUST_SEED_HEX });
  assert.equal(other.success, true, '标准规则与旧规则给的是不同账户');
  assert.notEqual(other.account.address, ZERO24_PUBKEY);
  // 同一把钥匙再导一次才是重复
  const dup = await imp({ privateKey: RUST_SEED_HEX });
  assert.equal(dup.success, false);
  assert.match(dup.error, /已经在钱包里/);
});

test('旧规则是显式选择:只有明确要求 legacy 才用旧派生', async () => {
  reset();
  const standard = await imp({ mnemonic: ZERO24 });
  assert.equal(standard.account.address, ZERO24_PUBKEY, '默认走标准规则');
  reset();
  const legacy = await imp({ mnemonic: ZERO24 }, '成员', { derivation: 'legacy' });
  assert.equal(legacy.success, true);
  assert.equal(legacy.account.address, ZERO24_LEGACY_PUBKEY, '明确要求才走旧规则');
  assert.equal(legacy.account.zhixingDerivation, 'legacy');
});

test('解锁 / 锁定 / 改密走普通账户的路径', async () => {
  reset();
  const r = await imp({ mnemonic: ZERO24 });
  // 导入后已解锁:ed25519 密钥在内存里
  assert.ok(state.ed25519Keyring?.has(r.account.id));
  await keyring.lockWallet();
  assert.equal(state.ed25519Keyring, null, '锁定后清掉内存里的密钥');
  clearPasswordCache?.();
  assert.equal(await Z.needsZhixingUnlock(), true);
  await assert.rejects(() => Z.loadZhixingKeypair(), /ZHIXING_LOCKED/);
  await keyring.unlockWallet(P, r.account.id, 'popup');
  const { keypair } = await Z.loadZhixingKeypair();
  assert.equal(Buffer.from(keypair.publicKey).toString('hex'), ZERO24_PUBKEY);

  // 改密(钱包里还有一个 EVM 钱包,改密要一起重加密)
  await ops.handleCreateHDWallet('EVM', P);
  const cp = await ops.changePassword(P, Q);
  assert.equal(cp.success, true);
  const exportedOld = await ops.handleExportPrivateKey(r.account.id, P);
  assert.equal(exportedOld.success, false, '旧密码不再能解开知行图账户');
  const exportedNew = await ops.handleExportPrivateKey(r.account.id, Q);
  assert.equal(exportedNew.success, true);
});

test('选中哪个知行图账户就用哪个签名;站点授权按网站记录,换了账户不再算授权', async () => {
  reset();
  const a = await imp({ mnemonic: ZERO24 }, 'alice');
  const otherMnemonic = Array(11).fill('abandon').join(' ') + ' about';
  const b = await imp({ mnemonic: otherMnemonic }, 'bob');
  assert.notEqual(a.account.address, b.account.address);
  assert.equal((await Z.getZhixingKeyInfo()).address, b.account.address, '刚导入的 bob 被选中');

  await Z.grantZhixingSite('https://a.example');
  assert.equal(await Z.isZhixingSiteAuthorized('https://a.example'), true);
  assert.equal(await Z.isZhixingSiteAuthorized('https://b.example'), false);

  await ops.handleSwitchAccount(a.account.id, P);
  assert.equal((await Z.getZhixingKeyInfo()).address, ZERO24_PUBKEY, '切到 alice');
  assert.equal(await Z.isZhixingSiteAuthorized('https://a.example'), false, '授权记在 bob 名下,alice 需要重新连接');

  await Z.revokeZhixingSite({ origin: 'https://a.example' });
  assert.deepEqual(await Z.listZhixingSites(), []);
});

test('签名请求:弹窗前校验,摘要可读,签出的字节与节点一致', async () => {
  reset();
  await imp({ mnemonic: ZERO24 });
  assert.throws(() => Z.prepareZhixingSignRequest([{ actor: 3, nonce: 7, action: { type: 'transfer' } }]), /ZHIXING_BAD_ACTION/);
  assert.throws(() => Z.prepareZhixingSignRequest([]), /ZHIXING_BAD_REQUEST/);
  const prepared = Z.prepareZhixingSignRequest([{ actor: 3, nonce: 7, action: { type: 'verify', unit: 8, version: 2, verdict: 'pass' } }]);
  assert.equal(prepared.summary.title, '核验单元 #8 的 v2:通过');
  const out = await Z.signZhixingRequest(prepared);
  assert.equal(out.address, ZERO24_PUBKEY);
  // 与 tests/zhixing-op.test.mjs 里节点生成的向量逐字节相同
  assert.equal(
    out.signed,
    '0000000000000003020000000000000008000000020000000000000000000000000000000000000000000000000000000000000000000000000000000007'
      + out.signed.slice(124)
  );
  assert.equal(out.signed.length, (62 + 64) * 2);
});

test('账户文件导出 → 导入:知行图账户原样恢复,重复导入时跳过', async () => {
  reset();
  await imp({ mnemonic: ZERO24 }, 'alice');
  const exp = await ops.handleExportAccountsFile(P);
  assert.equal(exp.success, true, exp.error);
  reset();
  const first = await ops.handleImportAccountsFile(exp.file, P);
  assert.equal(first.success, true, first.error);
  assert.equal(first.imported, 1);
  assert.equal((await Z.getZhixingKeyInfo()).address, ZERO24_PUBKEY);
  const again = await ops.handleImportAccountsFile(exp.file, P);
  assert.equal(again.imported, 0, '同一个知行图账户不应再导入一份');
  assert.equal(again.skipped, 1);
});
