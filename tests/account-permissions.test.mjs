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
  },
  offscreen: {}
};

const { clearAllData } = await import('../js/storage/index.js');
const { saveAuthorization } = await import('../js/storage/permission-storage.js');
const { handleWalletGetPermissions } = await import('../js/background/account-handler.js');

test.beforeEach(async () => {
  await clearAllData();
});

test('wallet_getPermissions exposes granted identity scopes', async () => {
  const address = '0x1111111111111111111111111111111111111111';
  await saveAuthorization(
    'https://chat.example',
    address,
    undefined,
    [address],
    ['identity.basic', 'identity.wallet', 'identity.email']
  );

  const permissions = await handleWalletGetPermissions('https://chat.example');

  assert.deepEqual(permissions, [
    {
      parentCapability: 'eth_accounts',
      caveats: [
        {
          type: 'restrictReturnedAccounts',
          value: [address]
        }
      ]
    },
    {
      parentCapability: 'wallet_identity',
      caveats: [
        {
          type: 'restrictIdentityScopes',
          value: ['identity.basic', 'identity.wallet', 'identity.email']
        }
      ]
    }
  ]);
});
