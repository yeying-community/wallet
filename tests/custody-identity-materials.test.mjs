import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';

globalThis.crypto ||= webcrypto;

const storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (key === null) return { ...storageData };
        return { [key]: storageData[key] };
      },
      async set(values) { Object.assign(storageData, values); },
      async remove(keys) {
        for (const key of (Array.isArray(keys) ? keys : [keys])) delete storageData[key];
      },
      async clear() { Object.keys(storageData).forEach(key => delete storageData[key]); }
    }
  }
};

const { createWalletIdentity } = await import('../js/common/identity/identity-document.js');
const { saveEncryptedIdentity, getIdentity } = await import('../js/storage/identity-storage.js');
const { ethers } = await import('../lib/ethers-6.16.esm.min.js');
const {
  importOrReuseCustodyWallet,
  resolveCustodyWalletName,
  validateCustodyIdentityMaterials,
  validateCustodySecret
} = await import('../js/background/operations/custody.js');
const { clearAllData, getAccountList, getWallets } = await import('../js/storage/index.js');
const { importHDWallet, deriveTronSubAccount } = await import('../js/background/vault.js');

const PASSWORD = 'Custody-Test-Password';

test('托管记录把历史默认钱包名替换为用户填写的主账户名称', () => {
  assert.equal(
    resolveCustodyWalletName(
      { name: 'HD Wallet' },
      [{ index: 0, name: '我的主钱包' }, { index: 1, name: '储蓄账户' }]
    ),
    '我的主钱包'
  );
  assert.equal(
    resolveCustodyWalletName({ name: '团队钱包' }, [{ index: 0, name: '主账户' }]),
    '团队钱包'
  );
});

test('custody Service Worker module does not use dynamic import', async () => {
  const source = await readFile(new URL('../js/background/operations/custody.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\s*\(/);
});

test('custody identity validation accepts wid map key and DID document id', async () => {
  const identity = await createWalletIdentity();
  const identityId = identity.document.walletIdentityId;
  await saveEncryptedIdentity(identityId, identity, PASSWORD);
  const stored = await getIdentity(identityId);

  assert.match(identity.document.id, new RegExp(`^did:yeying:${identityId}$`));
  assert.equal(stored.document.walletIdentityId, identityId);
  assert.equal(await validateCustodyIdentityMaterials({ [identityId]: stored }, PASSWORD), true);
});

test('Node Web bootstrap compatible custody v2 preserves and validates the same Wallet Identity', async () => {
  const identity = await createWalletIdentity();
  const identityId = identity.document.walletIdentityId;
  await saveEncryptedIdentity(identityId, identity, PASSWORD);
  const stored = await getIdentity(identityId);
  const wallet = ethers.Wallet.createRandom();
  const material = validateCustodySecret({
    version: 2,
    wallet: { id: 'node-web-wallet', name: 'Node Web Bootstrap', type: 'imported', accountCount: 1 },
    accounts: [{
      accountId: 'node-web-wallet_0',
      index: 0,
      name: '主账户',
      address: wallet.address,
      namespace: 'eip155',
      chainKey: 'eip155:1',
      privateKey: wallet.privateKey
    }],
    identities: { [identityId]: stored },
    selectedIdentityId: identityId,
    exportedAt: new Date().toISOString()
  });

  assert.equal(material.selectedIdentityId, identityId);
  assert.equal(material.identities[identityId].document.id, identity.document.id);
  assert.equal(material.address, wallet.address);
  assert.equal(await validateCustodyIdentityMaterials(material.identities, PASSWORD), true);
});

test('custody identity validation rejects a map key that is not walletIdentityId', async () => {
  const identity = await createWalletIdentity();
  const identityId = identity.document.walletIdentityId;
  await saveEncryptedIdentity(identityId, identity, PASSWORD);
  const stored = await getIdentity(identityId);

  await assert.rejects(
    () => validateCustodyIdentityMaterials({ [stored.document.id]: stored }, PASSWORD),
    error => error?.message === '托管记录身份材料无效'
  );
});

test('旧版 HD 托管记录按派生路径恢复账户索引和明确的默认名称', () => {
  const mnemonic = 'test test test test test test test test test test test junk';
  const accounts = [0, 1].map(index => {
    const derivationPath = `m/44'/60'/0'/0/${index}`;
    const wallet = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, derivationPath);
    return { address: wallet.address, derivationPath, privateKey: wallet.privateKey };
  });
  const material = validateCustodySecret({
    version: 2,
    wallet: { name: '工作钱包', type: 'hd' },
    mnemonic,
    accounts,
    identities: {}
  });

  assert.equal(material.type, 'hd');
  assert.deepEqual(material.accounts.map(account => account.index), [0, 1]);
  assert.deepEqual(material.accounts.map(account => account.name), ['工作钱包', '账户 2']);
});

test('私钥托管记录使用 imported 钱包类型', () => {
  const wallet = ethers.Wallet.createRandom();
  const material = validateCustodySecret({
    version: 2,
    wallet: { name: '导入钱包', type: 'imported' },
    accounts: [{ index: 0, name: '主账户', address: wallet.address, privateKey: wallet.privateKey }],
    identities: {}
  });

  assert.equal(material.type, 'imported');
  assert.equal(material.accounts.length, 1);
  assert.equal(material.accounts[0].name, '主账户');
});

test('云端密钥恢复重建完整 HD 账户清单并在重试时复用同一钱包', async () => {
  await clearAllData();
  const mnemonic = 'test test test test test test test test test test test junk';
  const accounts = [0, 1].map(index => {
    const derivationPath = `m/44'/60'/0'/0/${index}`;
    const wallet = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, derivationPath);
    return {
      index,
      name: index === 0 ? '日常账户' : '储蓄账户',
      address: wallet.address,
      derivationPath,
      privateKey: wallet.privateKey
    };
  });
  const material = validateCustodySecret({
    version: 2,
    wallet: { name: '团队钱包', type: 'hd' },
    mnemonic,
    accounts,
    identities: {}
  });

  const first = await importOrReuseCustodyWallet(material, PASSWORD);
  assert.equal(first.success, true);
  assert.equal(first.wallet.name, '团队钱包');
  assert.deepEqual(
    (await getAccountList()).map(account => account.name).sort(),
    ['储蓄账户', '日常账户'].sort()
  );

  const second = await importOrReuseCustodyWallet(material, PASSWORD);
  assert.equal(second.reused, true);
  assert.equal(Object.keys(await getWallets()).length, 1);
  assert.equal((await getAccountList()).length, 2);
  await clearAllData();
});

test('云端密钥恢复支持含非 EVM（Tron）子账户的 HD 钱包', async () => {
  await clearAllData();
  const mnemonic = 'test test test test test test test test test test test junk';
  // 用同一助记词建钱包并派生出真实的 EVM 主账户(0) 与 Tron 子账户(1)。
  const { wallet, mainAccount } = await importHDWallet('多链钱包', mnemonic, PASSWORD);
  const tron = await deriveTronSubAccount(wallet, 1, 'Tron 账户', PASSWORD, { tronReference: 'mainnet' });
  assert.match(String(tron.address), /^T[1-9A-HJ-NP-Za-km-z]+$/);

  const secret = {
    version: 2,
    wallet: { name: '多链钱包', type: 'hd' },
    mnemonic,
    accounts: [
      { index: 0, name: '日常账户', address: mainAccount.address, derivationPath: mainAccount.derivationPath, namespace: 'eip155', chainKey: 'eip155:1' },
      { index: 1, name: 'Tron 账户', address: tron.address, namespace: 'tron', chainKey: 'tron:mainnet', privateKey: '' }
    ],
    identities: {}
  };

  // 修复前：validateCustodySecret 遇 namespace='tron' 直接抛「不支持 Tron 账户」。
  const material = validateCustodySecret(secret);
  assert.equal(material.accounts.length, 2);

  await clearAllData();
  const restored = await importOrReuseCustodyWallet(material, PASSWORD);
  assert.equal(restored.success, true);

  const list = await getAccountList();
  const restoredTron = list.find(account => account.namespace === 'tron');
  assert.ok(restoredTron, 'Tron 子账户应被按 namespace 恢复');
  assert.equal(restoredTron.address, tron.address);
  assert.match(String(restoredTron.address), /^T/);
  await clearAllData();
});
