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

const {
  getCoordinatorSigningAccount,
  getUnlockedCoordinatorSigningAccount,
  isMpcAccount
} = await import('../js/background/coordinator-signing-account.js');
const { state } = await import('../js/background/state.js');
const { encryptString } = await import('../js/common/crypto/index.js');
const {
  saveAccount,
  saveMpcWallet,
  setSelectedAccountId
} = await import('../js/storage/index.js');

test.beforeEach(async () => {
  await chrome.storage.local.clear();
  state.keyring = null;
});

test('coordinator signing account uses selected HD account when available', async () => {
  await saveAccount({
    id: 'wallet-1:account-1',
    walletId: 'wallet-1',
    name: 'HD 1',
    address: '0x1111111111111111111111111111111111111111'
  });
  await setSelectedAccountId('wallet-1:account-1');

  const account = await getCoordinatorSigningAccount();
  assert.equal(account.id, 'wallet-1:account-1');
  assert.equal(isMpcAccount(account), false);
});

test('coordinator signing account falls back to HD account when selected account is MPC', async () => {
  await saveAccount({
    id: 'wallet-1:account-1',
    walletId: 'wallet-1',
    name: 'HD 1',
    address: '0x1111111111111111111111111111111111111111'
  });
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'MPC 1',
    type: 'mpc',
    status: 'keygen_completed',
    address: '0x2222222222222222222222222222222222222222'
  });
  await setSelectedAccountId('mpc:mpc-wallet-1');

  const account = await getCoordinatorSigningAccount();
  assert.equal(account.id, 'wallet-1:account-1');
  assert.equal(isMpcAccount(account), false);
});

test('coordinator signing account fails clearly when only MPC account exists', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'MPC 1',
    type: 'mpc',
    status: 'keygen_completed',
    address: '0x2222222222222222222222222222222222222222'
  });
  await setSelectedAccountId('mpc:mpc-wallet-1');

  await assert.rejects(
    () => getCoordinatorSigningAccount(),
    /需要使用已解锁的 HD 钱包完成协调器授权/
  );
});

test('unlocked coordinator signing account unlocks HD fallback when selected account is MPC', async () => {
  const password = 'test-password-123';
  const privateKey = '0x59c6995e998f97a5a004497e5da9a4509e20ec6d9d0ce8b69182570917c578b1';
  await saveAccount({
    id: 'wallet-1:account-1',
    walletId: 'wallet-1',
    name: 'HD 1',
    address: '0xb0f97686Ac83C7D3FD12AF046553888ff6becEc8',
    encryptedPrivateKey: await encryptString(privateKey, password)
  });
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'MPC 1',
    type: 'mpc',
    status: 'keygen_completed',
    address: '0x2222222222222222222222222222222222222222'
  });
  await setSelectedAccountId('mpc:mpc-wallet-1');

  const account = await getUnlockedCoordinatorSigningAccount(password);

  assert.equal(account.id, 'wallet-1:account-1');
  assert.equal(state.keyring.has('wallet-1:account-1'), true);
  assert.equal(typeof state.keyring.get('wallet-1:account-1')?.signMessage, 'function');
});
