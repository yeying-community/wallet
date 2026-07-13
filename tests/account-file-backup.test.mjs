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
const { createHDWallet, deriveSubAccount } = await import('../js/background/vault.js');
const { handleExportAccountsFile, handleImportAccountsFile } = await import('../js/background/operations/wallet.js');
const { saveWallet, saveAccount, getAccountList, clearAllData } = await import('../js/storage/index.js');

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
  assert.deepEqual(imported, { success: true, imported: 2, skipped: 0 });

  const restored = await getAccountList();
  assert.deepEqual(restored.map(account => account.address).sort(), addresses);
  assert.equal(restored.find(account => account.index === 0)?.username, 'alice');
  assert.equal(restored.find(account => account.index === 0)?.name, 'Primary');
  assert.equal(restored.find(account => account.index === 1)?.name, 'Savings');
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
