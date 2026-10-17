import test from 'node:test';
import assert from 'node:assert/strict';

const store = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return structuredClone(store);
        if (typeof keys === 'string') return { [keys]: structuredClone(store[keys]) };
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.map((key) => [key, structuredClone(store[key])]));
        }
        return Object.fromEntries(
          Object.keys(keys).map((key) => [key, store[key] !== undefined ? structuredClone(store[key]) : keys[key]])
        );
      },
      async set(items) {
        Object.assign(store, structuredClone(items || {}));
      },
      async remove(keys) {
        (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete store[key]);
      },
      async clear() {
        Object.keys(store).forEach((key) => delete store[key]);
      }
    },
    onChanged: {
      addListener() {},
      removeListener() {}
    }
  }
};

const { state } = await import('../js/background/state.js');
const { handleEthAccounts } = await import('../js/background/account-handler.js');
const {
  saveAccount,
  saveAuthorization,
  saveMpcWallet,
  setSelectedAccountId
} = await import('../js/storage/index.js');

test.beforeEach(async () => {
  await chrome.storage.local.clear();
  state.keyring = new Map();
  state.connectedSites = new Map();
});

test.afterEach(() => {
  state.keyring = null;
  state.connectedSites = new Map();
});

test('eth_accounts 会返回授权且已生成地址的 keygen completed MPC 钱包地址', async () => {
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: '0x1111111111111111111111111111111111111111',
  });
  await setSelectedAccountId('account-1');
  state.keyring.set('account-1', {});
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'keygen_completed',
    address: '0x2222222222222222222222222222222222222222',
    publicKey: '03abcdef',
  });
  await saveAuthorization(
    'https://dapp.example',
    '0x1111111111111111111111111111111111111111',
    undefined,
    [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ]
  );

  const accounts = await handleEthAccounts('https://dapp.example');

  assert.deepEqual(accounts, [
    '0x1111111111111111111111111111111111111111',
    '0x2222222222222222222222222222222222222222',
  ]);
});

test('切换账户后 eth_accounts 将当前选中且已授权地址放在首位', async () => {
  const oldAddress = '0x1111111111111111111111111111111111111111';
  const selectedAddress = '0x2222222222222222222222222222222222222222';
  const unauthorizedAddress = '0x3333333333333333333333333333333333333333';
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'previous mpc wallet',
    type: 'mpc',
    status: 'keygen_completed',
    address: oldAddress,
    publicKey: '03abcdef',
  });
  await saveMpcWallet({
    id: 'mpc-wallet-2',
    name: 'selected mpc wallet',
    type: 'mpc',
    status: 'keygen_completed',
    address: selectedAddress,
    publicKey: '03abcdee',
  });
  await saveMpcWallet({
    id: 'mpc-wallet-3',
    name: 'unauthorized mpc wallet',
    type: 'mpc',
    status: 'keygen_completed',
    address: unauthorizedAddress,
    publicKey: '03fedcba',
  });
  await setSelectedAccountId('mpc:mpc-wallet-2');
  state.keyring.set('mpc:mpc-wallet-2', {});
  await saveAuthorization('https://dapp.example', oldAddress, undefined, [oldAddress, selectedAddress]);

  const accounts = await handleEthAccounts('https://dapp.example');

  assert.deepEqual(accounts, [selectedAddress, oldAddress]);
  assert.equal(accounts.includes(unauthorizedAddress), false);
});
