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
  getMpcAccountId,
  resolveMpcAccountIdByAddress,
  signMessage,
  signTransaction,
  signTypedData
} = await import('../js/background/signing.js');
const { saveMpcWallet } = await import('../js/storage/index.js');

test.beforeEach(async () => {
  await chrome.storage.local.clear();
});

test('active MPC 钱包地址会解析为 MPC signer id', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'active',
    address: '0x1111111111111111111111111111111111111111',
    publicKey: '03abcdef',
    keygenSessionId: 'session-1',
  });

  const accountId = await resolveMpcAccountIdByAddress('0x1111111111111111111111111111111111111111');

  assert.equal(accountId, 'mpc:mpc-wallet-1');
});

test('未完成 keygen 的 MPC 钱包不能进入签名', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'keygen_ready',
    keygenSessionId: 'session-1',
  });

  await assert.rejects(
    () => signMessage(getMpcAccountId('mpc-wallet-1'), 'hello'),
    /MPC_KEYGEN_NOT_COMPLETED/
  );
});

test('active MPC 钱包在 TSS signer 接入前明确阻断签名', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'active',
    address: '0x1111111111111111111111111111111111111111',
    publicKey: '03abcdef',
    keygenSessionId: 'session-1',
  });

  await assert.rejects(
    () => signMessage(getMpcAccountId('mpc-wallet-1'), 'hello'),
    /MPC_SIGNER_NOT_CONFIGURED/
  );
  await assert.rejects(
    () => signTransaction(getMpcAccountId('mpc-wallet-1'), {
      to: '0x2222222222222222222222222222222222222222',
      value: '0x0',
    }),
    /MPC_SIGNER_NOT_CONFIGURED/
  );
  await assert.rejects(
    () => signTypedData(
      getMpcAccountId('mpc-wallet-1'),
      { name: 'App', chainId: 1 },
      { Mail: [{ name: 'contents', type: 'string' }] },
      { contents: 'hello' }
    ),
    /MPC_SIGNER_NOT_CONFIGURED/
  );
});
