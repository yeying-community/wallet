import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = {
  storage: {
    local: {
      _data: {},
      async get(key) { return { [key]: this._data[key] }; },
      async set(values) { Object.assign(this._data, values); },
      async remove(key) { delete this._data[key]; },
      async clear() { this._data = {}; }
    }
  }
};

const { saveAccount, setSelectedAccountId, updateUserSetting, clearAllData } = await import('../js/storage/index.js');
const { saveAuthorization } = await import('../js/storage/permission-storage.js');
const { handleYeyingGetProfile } = await import('../js/background/profile-handler.js');

const account = {
  id: 'account-1', walletId: 'wallet-1', address: '0x1111111111111111111111111111111111111111',
  name: 'Local label', username: 'alice'
};

test.beforeEach(async () => {
  await clearAllData();
  await saveAccount(account);
  await setSelectedAccountId(account.id);
  await updateUserSetting('profileEmail', 'alice@example.com');
});

test('returns only explicitly requested and granted fields', async () => {
  await saveAuthorization('https://app.example', account.address, ['username']);
  const result = await handleYeyingGetProfile('https://app.example', [{ fields: ['username'] }]);
  assert.deepEqual(result.profile, { username: 'alice' });
  assert.equal(result.address, account.address);
});

test('rejects fields that the origin has not been granted', async () => {
  await saveAuthorization('https://app.example', account.address, ['username']);
  await assert.rejects(
    () => handleYeyingGetProfile('https://app.example', [{ fields: ['email'] }]),
    error => error?.message === 'Profile field permission not granted'
  );
});

test('returns email only after email permission is granted', async () => {
  await saveAuthorization('https://app.example', account.address, ['email']);
  const result = await handleYeyingGetProfile('https://app.example', [{ fields: ['email'] }]);
  assert.deepEqual(result.profile, { email: 'alice@example.com' });
});
