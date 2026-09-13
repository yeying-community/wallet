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
