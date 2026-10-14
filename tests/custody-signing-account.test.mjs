import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';

globalThis.crypto ||= webcrypto;

// Minimal chrome.storage.local mock (mirrors custody-identity-materials.test.mjs).
const storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(key) { if (key === null) return { ...storageData }; return { [key]: storageData[key] }; },
      async set(values) { Object.assign(storageData, values); },
      async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) delete storageData[key]; },
      async clear() { Object.keys(storageData).forEach(key => delete storageData[key]); }
    }
  }
};

const { getCustodySigningAccount, resolveIdentityBoundAddress } = await import('../js/background/operations/custody.js');
const { saveIdentity } = await import('../js/storage/identity-storage.js');
const { setValue } = await import('../js/storage/storage-base.js');
const { saveAccount, clearAllData, setSelectedAccountId } = await import('../js/storage/index.js');
const { IdentityStorageKeys } = await import('../js/storage/storage-keys.js');

function base64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Build a JWT-shaped VC string; resolveIdentityBoundAddress only reads the middle segment.
function walletAccountCredential(address, chainKey = 'eip155:1') {
  const payload = { vc: { type: ['VerifiableCredential', 'WalletAccountCredential'], credentialSubject: { chainKey, address } } };
  return { credential: `header.${base64url(payload)}.signature` };
}

test.beforeEach(async () => { await clearAllData(); });

test('resolveIdentityBoundAddress extracts the eip155 WalletAccountCredential address', () => {
  const addr = '0xAbc0000000000000000000000000000000000001';
  assert.equal(resolveIdentityBoundAddress({ credentials: [walletAccountCredential(addr)] }), addr);
  // No credentials → empty.
  assert.equal(resolveIdentityBoundAddress({ credentials: [] }), '');
  // Non-eip155 binding does not count for the EVM custody subject.
  assert.equal(resolveIdentityBoundAddress({ credentials: [walletAccountCredential('TronAddr', 'tron:mainnet')] }), '');
});

test('getCustodySigningAccount anchors to the identity-bound account, not the selected account', async () => {
  const boundAddr = '0x1111111111111111111111111111111111111111';
  const otherAddr = '0x2222222222222222222222222222222222222222';
  await saveIdentity('wid_1', { document: { walletIdentityId: 'wid_1' }, credentials: [walletAccountCredential(boundAddr)] });
  await setValue(IdentityStorageKeys.SELECTED_IDENTITY, 'wid_1');
  // Two local accounts; the bound one differs from an arbitrary "other" account.
  await saveAccount({ id: 'acc_bound', address: boundAddr, namespace: 'eip155', walletId: 'w1' });
  await saveAccount({ id: 'acc_other', address: otherAddr, namespace: 'eip155', walletId: 'w2' });

  const { account, boundAddress } = await getCustodySigningAccount();
  assert.equal(account.id, 'acc_bound');
  assert.equal(boundAddress, boundAddr.toLowerCase());
});

test('getCustodySigningAccount falls back to the selected account when no identity is set up', async () => {
  const addr = '0x9999999999999999999999999999999999999999';
  await saveAccount({ id: 'acc_sel', address: addr, namespace: 'eip155', walletId: 'w1' });
  await setSelectedAccountId('acc_sel');
  // No selected identity → legacy fallback to the selected account (no throw).
  const { account, boundAddress } = await getCustodySigningAccount();
  assert.equal(account.id, 'acc_sel');
  assert.equal(boundAddress, addr.toLowerCase());
});

test('getCustodySigningAccount throws only when no account is available at all', async () => {
  // Selected identity without a bound address AND no accounts/selection → the
  // final guard throws. (Unreachable in practice: a wallet always has an account.)
  await saveIdentity('wid_x', { document: { walletIdentityId: 'wid_x' }, credentials: [] });
  await setValue(IdentityStorageKeys.SELECTED_IDENTITY, 'wid_x');
  await assert.rejects(getCustodySigningAccount(), /未找到当前账户/);
});
