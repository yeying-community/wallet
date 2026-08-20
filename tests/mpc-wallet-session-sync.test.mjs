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

const { mpcService } = await import('../js/background/mpc-service.js');
const { getMpcWallet, saveMpcSession, saveMpcWallet } = await import('../js/storage/index.js');

test.beforeEach(async () => {
  await chrome.storage.local.clear();
});

test('keygen session 完成时同步本地 MPC 钱包状态和地址', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '团队金库',
    type: 'mpc',
    status: 'keygen_pending',
    keygenSessionId: 'session-1',
    threshold: 2,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: 'session-1',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'completed',
    threshold: 2,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 2000,
  });

  await mpcService.syncWalletFromSession({
    id: 'session-1',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'completed',
    result: {
      address: '0x1111111111111111111111111111111111111111',
      groupPublicKey: '03abcdef',
    },
    keyVersion: 2,
    shareVersion: 3,
  });

  const wallet = await getMpcWallet('mpc-wallet-1');
  assert.equal(wallet.status, 'active');
  assert.equal(wallet.address, '0x1111111111111111111111111111111111111111');
  assert.equal(wallet.publicKey, '03abcdef');
  assert.equal(wallet.keyVersion, 2);
  assert.equal(wallet.shareVersion, 3);
});

