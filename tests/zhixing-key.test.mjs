/**
 * 知行图成员密钥:保存、解锁、改密、站点授权、签名请求。
 *
 * 守门点:
 *   - 密钥用钱包密码加密保存,明文种子不落盘;导入的助记词得到既有成员的同一个公钥;
 *   - 修改钱包密码后,知行图密钥只认新密码(与钱包、钱包身份在同一次原子写入里重加密);
 *   - 锁定钱包清除内存里的密钥;
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
// 知行图节点 `node keygen` 对 ZERO24 给出的公钥
const ZERO24_PUBKEY = '1de352e44cd333672593f2334a730e180aaf290de89aa16d480de594e34e2961';
const P = 'Pass-1111';
const Q = 'Pass-2222';

function reset() {
  for (const k of Object.keys(store)) delete store[k];
  state.zhixingKeypair = null;
  clearPasswordCache?.();
}

test('导入助记词:得到既有成员的同一个公钥;种子加密保存,不落明文', async () => {
  reset();
  const r = await Z.handleImportZhixingKey({ mnemonic: ZERO24, password: P });
  assert.equal(r.address, ZERO24_PUBKEY);
  const saved = store[ZhixingStorageKeys.KEY];
  assert.equal(saved.address, ZERO24_PUBKEY);
  assert.ok(saved.encryptedSeed);
  const raw = JSON.stringify(store);
  assert.ok(!raw.includes('5eb00bbddcf069084889a8ab9155568165f5c453'), '存储里不能出现明文 BIP-39 种子');
  assert.deepEqual(await Z.getZhixingKeyInfo(), { address: ZERO24_PUBKEY, source: 'mnemonic', createdAt: saved.createdAt });
});

test('一个钱包只保存一把知行图密钥;助记词无效时报错', async () => {
  reset();
  await assert.rejects(() => Z.handleImportZhixingKey({ mnemonic: 'abandon abandon', password: P }), /ZHIXING_BAD_MNEMONIC/);
  await Z.handleImportZhixingKey({ mnemonic: ZERO24, password: P });
  await assert.rejects(() => Z.handleCreateZhixingKey({ password: P }), /ZHIXING_KEY_EXISTS/);
});

test('生成新密钥:返回 24 词,再导入同一组词得到同一公钥', async () => {
  reset();
  const created = await Z.handleCreateZhixingKey({ password: P });
  assert.equal(created.mnemonic.split(' ').length, 24);
  assert.match(created.address, /^[0-9a-f]{64}$/);
  const firstAddress = created.address;
  await Z.handleRemoveZhixingKey({ password: P });
  const again = await Z.handleImportZhixingKey({ mnemonic: created.mnemonic, password: P });
  assert.equal(again.address, firstAddress);
});

test('解锁靠缓存的钱包密码;锁定钱包后内存里的密钥被清除', async () => {
  reset();
  await Z.handleImportZhixingKey({ mnemonic: ZERO24, password: P });
  state.zhixingKeypair = null;
  clearPasswordCache?.();
  assert.equal(Z.needsZhixingUnlock(), true);
  await assert.rejects(() => Z.loadZhixingKeypair(), /ZHIXING_LOCKED/);
  cachePassword(P);
  const kp = await Z.loadZhixingKeypair();
  assert.equal(Buffer.from(kp.publicKey).toString('hex'), ZERO24_PUBKEY);
  await keyring.lockWallet();
  assert.equal(state.zhixingKeypair, null);
});

test('移除需要正确的钱包密码,并一并清掉站点授权', async () => {
  reset();
  await Z.handleImportZhixingKey({ mnemonic: ZERO24, password: P });
  await Z.grantZhixingSite('https://blockchain.yeying.pub');
  await assert.rejects(() => Z.handleRemoveZhixingKey({ password: 'wrong' }));
  assert.ok(await Z.getZhixingKeyInfo());
  await Z.handleRemoveZhixingKey({ password: P });
  assert.equal(await Z.getZhixingKeyInfo(), null);
  assert.deepEqual(await Z.listZhixingSites(), []);
});

test('修改钱包密码后,知行图密钥只认新密码', async () => {
  reset();
  const created = await ops.handleCreateHDWallet('Acc1', P);
  assert.equal(created.success, true);
  await Z.handleImportZhixingKey({ mnemonic: ZERO24, password: P });
  const cp = await ops.changePassword(P, Q);
  assert.equal(cp.success, true);
  state.zhixingKeypair = null;
  await assert.rejects(() => Z.loadZhixingKeypair(P));
  const kp = await Z.loadZhixingKeypair(Q);
  assert.equal(Buffer.from(kp.publicKey).toString('hex'), ZERO24_PUBKEY);
});

test('站点授权:按网站记录,换了密钥就不再算授权', async () => {
  reset();
  assert.equal(await Z.isZhixingSiteAuthorized('https://a.example'), false);
  await Z.handleImportZhixingKey({ mnemonic: ZERO24, password: P });
  await Z.grantZhixingSite('https://a.example');
  assert.equal(await Z.isZhixingSiteAuthorized('https://a.example'), true);
  assert.equal(await Z.isZhixingSiteAuthorized('https://b.example'), false);
  // 记录的公钥与当前密钥不一致(例如换过密钥)⇒ 不算授权
  store[ZhixingStorageKeys.SITES]['https://a.example'].address = 'ff'.repeat(32);
  assert.equal(await Z.isZhixingSiteAuthorized('https://a.example'), false);
  await Z.revokeZhixingSite({ origin: 'https://a.example' });
  assert.deepEqual(await Z.listZhixingSites(), []);
});

test('签名请求:弹窗前校验,摘要可读,签出的字节与节点一致', async () => {
  reset();
  await Z.handleImportZhixingKey({ mnemonic: ZERO24, password: P });
  assert.throws(() => Z.prepareZhixingSignRequest([{ actor: 3, nonce: 7, action: { type: 'transfer' } }]), /ZHIXING_BAD_ACTION/);
  assert.throws(() => Z.prepareZhixingSignRequest([]), /ZHIXING_BAD_REQUEST/);

  const prepared = Z.prepareZhixingSignRequest([{ actor: 3, nonce: 7, action: { type: 'verify', unit: 8, version: 2, verdict: 'pass' } }]);
  assert.equal(prepared.summary.title, '核验单元 #8 的 v2:通过');
  cachePassword(P);
  const out = await Z.signZhixingRequest(prepared);
  assert.equal(out.address, ZERO24_PUBKEY);
  // 与 tests/zhixing-op.test.mjs 的节点向量相同
  assert.equal(
    out.signed,
    '0000000000000003020000000000000008000000020000000000000000000000000000000000000000000000000000000000000000000000000000000007'
      + out.signed.slice(124)
  );
  assert.equal(out.signed.length, (62 + 64) * 2);
});

test('用 node keygen 的密钥文件导入:加密 .json 与明文种子文件都得到既有成员的同一个公钥', async () => {
  const fs = await import('node:fs');
  const ks = fs.readFileSync(new URL('./fixtures/zhixing-keystore.json', import.meta.url), 'utf8');
  const seedFile = fs.readFileSync(new URL('./fixtures/zhixing-seed.txt', import.meta.url), 'utf8');

  reset();
  await assert.rejects(() => Z.handleImportZhixingKeyFile({ fileText: ks, password: P }), /ZHIXING_KEY_FILE_PASSWORD_REQUIRED/);
  await assert.rejects(() => Z.handleImportZhixingKeyFile({ fileText: ks, filePassword: 'wrong', password: P }), /口令不对/);
  const a = await Z.handleImportZhixingKeyFile({ fileText: ks, filePassword: 'ks-password-123', password: P });
  assert.equal(a.address, ZERO24_PUBKEY);

  reset();
  const b = await Z.handleImportZhixingKeyFile({ fileText: seedFile, password: P });
  assert.equal(b.address, ZERO24_PUBKEY);

  // 文件里记的公钥与种子对不上 ⇒ 拒绝(文件被改过或拼错了)
  reset();
  const tampered = seedFile.replace(/# pubkey: [0-9a-f]+/, '# pubkey: ' + 'ff'.repeat(32));
  await assert.rejects(() => Z.handleImportZhixingKeyFile({ fileText: tampered, password: P }), /ZHIXING_BAD_KEY_FILE/);
});
