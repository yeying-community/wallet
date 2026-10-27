import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = {
  storage: {
    local: {
      _data: {},
      async get(key) { return typeof key === 'string' ? { [key]: this._data[key] } : { ...this._data }; },
      async set(values) { Object.assign(this._data, values); },
      async remove(key) { delete this._data[key]; },
      async clear() { this._data = {}; }
    }
  }
};

const PASSWORD = 'Backup-Pass-123';
const LEGACY_IDENTITY_PASSWORD = 'Identity-Old-456';
const { createHDWallet, deriveSubAccount, deriveTronSubAccount, importTronPrivateKeyWallet } = await import('../js/background/vault.js');
const { handleExportAccountsFile, handleImportAccountsFile } = await import('../js/background/operations/wallet.js');
const { saveWallet, saveAccount, getAccountList, clearAllData } = await import('../js/storage/index.js');
const { createWalletIdentity } = await import('../js/common/identity/identity-document.js');
const { encryptObject, decryptObject } = await import('../js/common/crypto/index.js');
const {
  saveEncryptedIdentity,
  saveIdentityCredentials,
  getIdentity,
  decryptIdentityKeyMaterial
} = await import('../js/storage/identity-storage.js');

test('encrypted account file restores HD accounts and metadata', async () => {
  await clearAllData();
  const { wallet, mainAccount } = await createHDWallet('Primary', PASSWORD);
  mainAccount.username = 'alice';
  const second = await deriveSubAccount(wallet, 1, 'Savings', PASSWORD);
  await saveWallet({ ...wallet, accountCount: 2 });
  await saveAccount(mainAccount);
  await saveAccount(second);

  const exported = await handleExportAccountsFile(PASSWORD);
  assert.equal(exported.success, true);
  assert.equal(exported.accountCount, 2);
  assert.equal(exported.file.format, 'yeying-wallet-accounts');
  assert.ok(exported.file.ciphertext);

  const addresses = [mainAccount.address, second.address].sort();
  await clearAllData();
  const imported = await handleImportAccountsFile(exported.file, PASSWORD);
  assert.deepEqual(imported, {
    success: true,
    imported: 2,
    skipped: 0,
    importedIdentities: 0,
    skippedIdentities: 0,
    warnings: []
  });

  const restored = await getAccountList();
  assert.deepEqual(restored.map(account => account.address).sort(), addresses);
  assert.equal(restored.find(account => account.index === 0)?.username, 'alice');
  assert.equal(restored.find(account => account.index === 0)?.name, 'Primary');
  assert.equal(restored.find(account => account.index === 1)?.name, 'Savings');
});

test('encrypted account file round-trips a non-EVM (Tron) HD sub-account by namespace', async () => {
  await clearAllData();
  const { wallet, mainAccount } = await createHDWallet('Primary', PASSWORD);
  const tron = await deriveTronSubAccount(wallet, 1, 'My Tron', PASSWORD, { tronReference: 'mainnet' });
  await saveWallet({ ...wallet, accountCount: 2 });
  await saveAccount(mainAccount);
  await saveAccount(tron);

  // Sanity: the derived account is a Tron Base58 (T…) address in the tron namespace.
  assert.match(String(tron.address), /^T[1-9A-HJ-NP-Za-km-z]+$/);
  assert.equal(tron.namespace, 'tron');

  const exported = await handleExportAccountsFile(PASSWORD);
  assert.equal(exported.success, true);
  assert.equal(exported.file.version, 2);

  await clearAllData();
  const imported = await handleImportAccountsFile(exported.file, PASSWORD);
  assert.equal(imported.success, true);
  assert.equal(imported.imported, 2);

  const restored = await getAccountList();
  const restoredTron = restored.find(account => account.index === 1);
  assert.ok(restoredTron, 'Tron 子账户应被恢复');
  // 关键：按 namespace 重派生为 Tron（修复前会被误派生成 EVM 0x 地址）
  assert.equal(restoredTron.namespace, 'tron');
  assert.equal(restoredTron.address, tron.address);
  assert.match(String(restoredTron.address), /^T/);
});

test('encrypted account file round-trips a non-EVM (Tron) IMPORTED private-key wallet', async () => {
  await clearAllData();
  const TRON_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const { wallet, mainAccount } = await importTronPrivateKeyWallet('My Tron Key', TRON_PK, PASSWORD, { tronReference: 'mainnet' });
  await saveWallet(wallet);
  await saveAccount(mainAccount);
  assert.match(String(mainAccount.address), /^T[1-9A-HJ-NP-Za-km-z]+$/);
  assert.equal(mainAccount.namespace, 'tron');

  const exported = await handleExportAccountsFile(PASSWORD);
  assert.equal(exported.success, true);
  assert.equal(exported.file.version, 2);

  await clearAllData();
  const imported = await handleImportAccountsFile(exported.file, PASSWORD);
  assert.equal(imported.success, true);
  assert.equal(imported.imported, 1);

  const restored = await getAccountList();
  assert.equal(restored.length, 1);
  // 关键：IMPORTED 私钥钱包按 namespace 还原为 Tron（修复前会被当 EVM 还原成 0x 地址）
  assert.equal(restored[0].namespace, 'tron');
  assert.equal(restored[0].address, mainAccount.address);
  assert.match(String(restored[0].address), /^T/);
});

test('encrypted account file carries the identity service endpoint and restores it', async () => {
  await clearAllData();
  const { wallet, mainAccount } = await createHDWallet('Primary', PASSWORD);
  await saveWallet(wallet);
  await saveAccount(mainAccount);

  const exported = await handleExportAccountsFile(PASSWORD, 'http://localhost:8100/');
  assert.equal(exported.success, true);

  await clearAllData();
  const imported = await handleImportAccountsFile(exported.file, PASSWORD);
  assert.equal(imported.success, true);
  assert.equal(imported.identityEndpoint, 'http://localhost:8100');
});

test('legacy encrypted account file without an identity endpoint remains importable', async () => {
  await clearAllData();
  const { wallet, mainAccount } = await createHDWallet('Primary', PASSWORD);
  await saveWallet(wallet);
  await saveAccount(mainAccount);

  const exported = await handleExportAccountsFile(PASSWORD);
  assert.equal(exported.success, true);

  await clearAllData();
  const imported = await handleImportAccountsFile(exported.file, PASSWORD);
  assert.deepEqual(imported, {
    success: true,
    imported: 1,
    skipped: 0,
    importedIdentities: 0,
    skippedIdentities: 0,
    warnings: []
  });
});

test('wrong password cannot import encrypted account file', async () => {
  await clearAllData();
  const { wallet, mainAccount } = await createHDWallet('Primary', PASSWORD);
  await saveWallet(wallet);
  await saveAccount(mainAccount);
  const exported = await handleExportAccountsFile(PASSWORD);
  await clearAllData();
  const result = await handleImportAccountsFile(exported.file, 'Wrong-Pass-123');
  assert.equal(result.success, false);
});

test('encrypted account file restores Wallet Identity control material and credentials', async () => {
  await clearAllData();
  const { wallet, mainAccount } = await createHDWallet('Primary', PASSWORD);
  await saveWallet(wallet);
  await saveAccount(mainAccount);

  const identity = await createWalletIdentity();
  const identityId = identity.document.walletIdentityId;
  await saveEncryptedIdentity(identityId, identity, PASSWORD);
  await saveIdentityCredentials(identityId, [{
    credential: 'header.payload.signature',
    type: ['VerifiableCredential', 'UsernameCredential']
  }]);

  const exported = await handleExportAccountsFile(PASSWORD);
  assert.equal(exported.success, true);
  await clearAllData();

  const imported = await handleImportAccountsFile(exported.file, PASSWORD);
  assert.equal(imported.success, true);

  const restored = await getIdentity(identityId);
  assert.equal(restored.document.id, identity.document.id);
  assert.deepEqual(restored.credentials, [{
    credential: 'header.payload.signature',
    type: ['VerifiableCredential', 'UsernameCredential']
  }]);
  const material = await decryptIdentityKeyMaterial(restored, PASSWORD);
  assert.equal(material.privateJwk.d, identity.privateJwk.d);
  assert.equal(material.recoveryPrivateJwk.d, identity.recoveryPrivateJwk.d);
});

test('backup rejects or skips Wallet Identity material whose private and public keys do not match', async () => {
  await clearAllData();
  const { wallet, mainAccount } = await createHDWallet('Primary', PASSWORD);
  await saveWallet(wallet);
  await saveAccount(mainAccount);

  const identity = await createWalletIdentity();
  const identityId = identity.document.walletIdentityId;
  await saveEncryptedIdentity(identityId, {
    ...identity,
    publicJwk: {
      ...identity.publicJwk,
      x: identity.recoveryPublicJwk.x
    }
  }, PASSWORD);

  const rejectedExport = await handleExportAccountsFile(PASSWORD);
  assert.equal(rejectedExport.success, false);
  assert.match(rejectedExport.error, /控制密钥与公钥不匹配/);

  await saveEncryptedIdentity(identityId, identity, PASSWORD);
  const validExport = await handleExportAccountsFile(PASSWORD);
  assert.equal(validExport.success, true);
  const payload = await decryptObject(validExport.file.ciphertext, PASSWORD);
  payload.identities[0].publicJwk.x = identity.recoveryPublicJwk.x;
  payload.selectedIdentityId = identityId;
  const tamperedFile = {
    ...validExport.file,
    ciphertext: await encryptObject(payload, PASSWORD)
  };

  await clearAllData();
  const imported = await handleImportAccountsFile(tamperedFile, PASSWORD);
  assert.equal(imported.success, true);
  assert.equal(imported.imported, 1);
  assert.equal(imported.importedIdentities, 0);
  assert.equal(imported.skippedIdentities, 1);
  assert.equal(imported.warnings.length, 1);
  assert.equal(await getIdentity(identityId), null);
});

async function createLegacyIdentityPasswordBackup() {
  await clearAllData();
  const { wallet, mainAccount } = await createHDWallet('Primary', PASSWORD);
  await saveWallet(wallet);
  await saveAccount(mainAccount);

  const identity = await createWalletIdentity();
  const identityId = identity.document.walletIdentityId;
  await saveEncryptedIdentity(identityId, identity, LEGACY_IDENTITY_PASSWORD);
  const legacyIdentityRecord = await getIdentity(identityId);

  const repairedExport = await handleExportAccountsFile(PASSWORD, '', {
    identityPassword: LEGACY_IDENTITY_PASSWORD
  });
  assert.equal(repairedExport.success, true);
  const payload = await decryptObject(repairedExport.file.ciphertext, PASSWORD);
  payload.identities = [legacyIdentityRecord];
  return {
    identity,
    identityId,
    file: {
      ...repairedExport.file,
      ciphertext: await encryptObject(payload, PASSWORD)
    }
  };
}

test('export requests the previous wallet password and re-wraps legacy Identity material', async () => {
  const { identity, identityId } = await createLegacyIdentityPasswordBackup();

  const withoutLegacyPassword = await handleExportAccountsFile(PASSWORD);
  assert.equal(withoutLegacyPassword.success, false);
  assert.equal(withoutLegacyPassword.requirePassword, true);
  assert.equal(withoutLegacyPassword.identityPasswordRequired, true);

  const withWrongLegacyPassword = await handleExportAccountsFile(PASSWORD, '', {
    identityPassword: 'Wrong-Old-Pass-789'
  });
  assert.equal(withWrongLegacyPassword.success, false);
  assert.equal(withWrongLegacyPassword.requirePassword, true);

  const repaired = await handleExportAccountsFile(PASSWORD, '', {
    identityPassword: LEGACY_IDENTITY_PASSWORD
  });
  assert.equal(repaired.success, true);
  assert.equal(repaired.repairedIdentities, 1);
  const repairedPayload = await decryptObject(repaired.file.ciphertext, PASSWORD);
  assert.equal(repairedPayload.identities[0].privateJwk, undefined);
  assert.equal(repairedPayload.identities[0].recoveryPrivateJwk, undefined);

  await clearAllData();
  const imported = await handleImportAccountsFile(repaired.file, PASSWORD);
  assert.equal(imported.success, true);
  assert.equal(imported.importedIdentities, 1);
  const restored = await getIdentity(identityId);
  const material = await decryptIdentityKeyMaterial(restored, PASSWORD);
  assert.equal(material.privateJwk.d, identity.privateJwk.d);
  await assert.rejects(() => decryptIdentityKeyMaterial(restored, LEGACY_IDENTITY_PASSWORD));
});

test('legacy v2 backup restores Identity with the previous wallet password and re-wraps it', async () => {
  const { identity, identityId, file } = await createLegacyIdentityPasswordBackup();
  await clearAllData();

  const requiresLegacyPassword = await handleImportAccountsFile(file, PASSWORD);
  assert.equal(requiresLegacyPassword.success, false);
  assert.equal(requiresLegacyPassword.requirePassword, true);
  assert.equal((await getAccountList()).length, 0, '请求旧密码前不得写入钱包账户');

  const imported = await handleImportAccountsFile(file, PASSWORD, {
    identityPassword: LEGACY_IDENTITY_PASSWORD
  });
  assert.equal(imported.success, true);
  assert.equal(imported.imported, 1);
  assert.equal(imported.importedIdentities, 1);
  assert.equal(imported.skippedIdentities, 0);
  assert.deepEqual(imported.warnings, []);

  const restored = await getIdentity(identityId);
  const material = await decryptIdentityKeyMaterial(restored, PASSWORD);
  assert.equal(material.privateJwk.d, identity.privateJwk.d);
  await assert.rejects(() => decryptIdentityKeyMaterial(restored, LEGACY_IDENTITY_PASSWORD));
});

test('legacy v2 backup can skip an unreadable Identity and still restore wallet accounts', async () => {
  const { identityId, file } = await createLegacyIdentityPasswordBackup();
  await clearAllData();

  const imported = await handleImportAccountsFile(file, PASSWORD, {
    skipInvalidIdentities: true
  });
  assert.equal(imported.success, true);
  assert.equal(imported.imported, 1);
  assert.equal(imported.importedIdentities, 0);
  assert.equal(imported.skippedIdentities, 1);
  assert.equal(imported.warnings.length, 1);
  assert.match(imported.warnings[0], /Wallet Identity 未恢复/);
  assert.equal(await getIdentity(identityId), null);
  assert.equal((await getAccountList()).length, 1);
});
