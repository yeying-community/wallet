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
const { handleCreateMpcWallet, handleMpcAcceptInvite, handleMpcCancelSession, handleMpcDeleteWallet, handleMpcDiagnoseWallet, handleMpcDismissInvite, handleMpcPrepareWalletSigning } = await import('../js/background/operations/mpc.js');
const { setMpcTssEngineForTests, resetMpcTssEngineForTests } = await import('../js/background/mpc-tss-engine.js');
const { state } = await import('../js/background/state.js');
const {
  HandleGetWalletList,
  handleGetAccountById,
  handleSwitchAccount,
  handleUpdateAccountName
} = await import('../js/background/operations/wallet.js');
const {
  getSelectedAccount,
  getMpcWallet,
  getMpcSession,
  getMpcSignRequest,
  getMpcKeyShare,
  getMpcMessage,
  getMpcParticipant,
  getMpcWireState,
  saveAccount,
  saveMpcKeyShare,
  saveMpcMessage,
  saveMpcParticipant,
  saveMpcSignRequest,
  saveMpcSession,
  saveMpcWireState,
  saveMpcWallet,
  setSelectedAccountId
} = await import('../js/storage/index.js');

test.beforeEach(async () => {
  await chrome.storage.local.clear();
  state.keyring = null;
  for (const pump of mpcService._wireSessionPumps.values()) {
    pump.stop?.();
  }
  mpcService._wireSessionCursors.clear();
  mpcService._wireSessionAdapters.clear();
  mpcService._wireSessionPumps.clear();
  resetMpcTssEngineForTests();
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

test('session 同步会把被邀请者本地 MPC 钱包收敛到共同记录', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'MPC Wallet',
    type: 'mpc',
    status: 'keygen_pending',
    keygenSessionId: 'session-1',
    curve: 'secp256k1',
    threshold: 0,
    participants: [],
    keyVersion: 1,
    shareVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
  });

  await mpcService.syncWalletFromSession({
    id: 'session-1',
    name: '社区金库',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'created',
    curve: 'secp256k1',
    threshold: 2,
    participants: [
      { participantId: '0x1111111111111111111111111111111111111111' },
      { id: '0x2222222222222222222222222222222222222222' },
    ],
    keyVersion: 4,
    shareVersion: 5,
  });

  const wallet = await getMpcWallet('mpc-wallet-1');
  assert.equal(wallet.name, '社区金库');
  assert.equal(wallet.keygenSessionId, 'session-1');
  assert.equal(wallet.curve, 'secp256k1');
  assert.equal(wallet.threshold, 2);
  assert.deepEqual(wallet.participants, [
    '0x1111111111111111111111111111111111111111',
    '0x2222222222222222222222222222222222222222',
  ]);
  assert.equal(wallet.keyVersion, 4);
  assert.equal(wallet.shareVersion, 5);
});

test('ready session 会把本地 MPC 钱包状态收敛为等待密钥生成', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '团队金库',
    type: 'mpc',
    status: 'keygen_pending',
    keygenSessionId: 'session-1',
    threshold: 1,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });

  await mpcService.syncWalletFromSession({
    id: 'session-1',
    name: '团队金库',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'ready',
    threshold: 1,
    participants: ['0x1', '0x2'],
  });

  const wallet = await getMpcWallet('mpc-wallet-1');
  assert.equal(wallet.status, 'keygen_ready');
  assert.equal(wallet.address || '', '');
});

test('rounds session 不会把已有地址的钱包降级回密钥生成中', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '团队金库',
    type: 'mpc',
    status: 'keygen_running',
    address: '0xfd608b60f57f1cade5006faaca5f8df812a0e093',
    publicKey: '03abcdef',
    keygenSessionId: 'session-1',
    threshold: 2,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });

  await mpcService.syncWalletFromSession({
    id: 'session-1',
    name: '团队金库',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'rounds',
    threshold: 2,
    participants: ['0x1', '0x2'],
  });

  const wallet = await getMpcWallet('mpc-wallet-1');
  assert.equal(wallet.status, 'keygen_completed');
  assert.equal(wallet.address, '0xfd608b60f57f1cade5006faaca5f8df812a0e093');
});

test('本地已完成 keygen 的钱包同步后会自动继续 aux-info 启用签名', async () => {
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
  });
  await setSelectedAccountId('account-1');
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '团队金库',
    type: 'mpc',
    status: 'keygen_running',
    address: '0xfd608b60f57f1cade5006faaca5f8df812a0e093',
    publicKey: '03abcdef',
    keygenSessionId: 'session-1',
    threshold: 2,
    participants: [
      '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    ],
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcKeyShare({
    id: 'mpc-wallet-1:0x5c7bf91C493126314bb821C123Dee889FFCa3932:1',
    walletId: 'mpc-wallet-1',
    sessionId: 'session-1',
    participantId: '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    participantIndex: 1,
    curve: 'secp256k1',
    publicKey: '03abcdef',
    address: '0xfd608b60f57f1cade5006faaca5f8df812a0e093',
    share: { fixture: true },
    keyVersion: 1,
    shareVersion: 1,
  });

  const originalStartAuxInfo = mpcService._startAuxInfoAfterWireKeygen;
  let auxInfoInput = null;
  mpcService._startAuxInfoAfterWireKeygen = async (input) => {
    auxInfoInput = input;
    return { started: true };
  };
  try {
    await mpcService.syncWalletFromSession({
      id: 'session-1',
      name: '团队金库',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      status: 'rounds',
      threshold: 2,
    });

    const wallet = await getMpcWallet('mpc-wallet-1');
    assert.equal(wallet.status, 'keygen_completed');
    assert.equal(auxInfoInput?.participantId, '0x5c7bf91C493126314bb821C123Dee889FFCa3932');
    assert.equal(auxInfoInput?.participantIndex, 1);
    assert.deepEqual(auxInfoInput?.session?.participants, [
      '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    ]);
  } finally {
    mpcService._startAuxInfoAfterWireKeygen = originalStartAuxInfo;
  }
});

test('钱包列表会用本地 ready session 修复 MPC 钱包状态', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'keygen_pending',
    keygenSessionId: 'session-1',
    threshold: 1,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: 'session-1',
    name: 'mpc10',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'ready',
    threshold: 1,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });

  const result = await HandleGetWalletList();

  assert.equal(result.success, true);
  assert.equal(result.wallets.find((wallet) => wallet.id === 'mpc-wallet-1')?.status, 'keygen_ready');
});

test('钱包列表暴露可选择的 MPC 钱包账户并支持切换', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'active',
    address: '0x2222222222222222222222222222222222222222',
    publicKey: '03abcdef',
    keygenSessionId: 'session-1',
    threshold: 2,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });

  const listBeforeSwitch = await HandleGetWalletList();
  const mpcWallet = listBeforeSwitch.wallets.find((wallet) => wallet.id === 'mpc-wallet-1');
  assert.equal(mpcWallet.accounts.length, 1);
  assert.equal(mpcWallet.accounts[0].id, 'mpc:mpc-wallet-1');
  assert.equal(mpcWallet.accounts[0].name, 'mpc10');
  assert.equal(mpcWallet.accounts[0].address, '0x2222222222222222222222222222222222222222');
  assert.equal(mpcWallet.accounts[0].isSelected, false);

  const switched = await handleSwitchAccount('mpc:mpc-wallet-1');
  assert.equal(switched.success, true);
  assert.equal(switched.account.id, 'mpc:mpc-wallet-1');
  assert.equal(switched.account.walletType, 'mpc');
  assert.equal(state.keyring.get('mpc:mpc-wallet-1')?.type, 'mpc');

  const selected = await getSelectedAccount();
  assert.equal(selected.id, 'mpc:mpc-wallet-1');
  assert.equal(selected.address, '0x2222222222222222222222222222222222222222');

  const listAfterSwitch = await HandleGetWalletList();
  assert.equal(
    listAfterSwitch.wallets.find((wallet) => wallet.id === 'mpc-wallet-1')?.accounts[0]?.isSelected,
    true
  );
});

test('MPC 钱包账户支持账户详情读取和名称更新', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'active',
    address: '0x2222222222222222222222222222222222222222',
    publicKey: '03abcdef',
    keygenSessionId: 'session-1',
    threshold: 2,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });

  const detail = await handleGetAccountById('mpc:mpc-wallet-1');
  assert.equal(detail.success, true);
  assert.equal(detail.account.id, 'mpc:mpc-wallet-1');
  assert.equal(detail.account.name, 'mpc10');
  assert.equal(detail.account.walletType, 'mpc');
  assert.equal(detail.account.address, '0x2222222222222222222222222222222222222222');

  const updated = await handleUpdateAccountName('mpc:mpc-wallet-1', '团队金库');
  assert.equal(updated.success, true);
  assert.equal(updated.account.name, '团队金库');

  const wallet = await getMpcWallet('mpc-wallet-1');
  assert.equal(wallet.name, '团队金库');
});

test('钱包列表按本地 completeKeyShare 明确收敛 MPC 签名能力状态', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'active',
    address: '0x2222222222222222222222222222222222222222',
    publicKey: '03abcdef',
    keygenSessionId: 'session-1',
    threshold: 2,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcKeyShare({
    id: 'share-1',
    walletId: 'mpc-wallet-1',
    sessionId: 'session-1',
    participantId: '0x1',
    share: { secret: 'local-share' },
    shareVersion: 1,
    keyVersion: 1,
  });

  let result = await HandleGetWalletList();
  let wallet = result.wallets.find((item) => item.id === 'mpc-wallet-1');
  assert.equal(wallet.status, 'keygen_completed');
  assert.equal(wallet.signingStatus, 'unavailable');
  assert.equal(wallet.signingUnavailableReason, 'MPC_COMPLETE_KEY_SHARE_NOT_FOUND');

  await saveMpcKeyShare({
    id: 'share-1',
    walletId: 'mpc-wallet-1',
    sessionId: 'session-1',
    participantId: '0x1',
    share: { secret: 'local-share' },
    completeKeyShare: { secret: 'complete-local-share' },
    completeKeyShareStatus: 'completed',
    auxInfoStatus: 'completed',
    shareVersion: 1,
    keyVersion: 1,
  });

  result = await HandleGetWalletList();
  wallet = result.wallets.find((item) => item.id === 'mpc-wallet-1');
  assert.equal(wallet.status, 'active');
  assert.equal(wallet.signingStatus, 'available');
  assert.equal(wallet.signingUnavailableReason, '');
});

test('MPC 钱包诊断只返回签名材料状态，不泄露本地密钥内容', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'keygen_completed',
    address: '0x2222222222222222222222222222222222222222',
    publicKey: '03abcdef',
    keygenSessionId: 'session-1',
    threshold: 2,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcKeyShare({
    id: 'share-1',
    walletId: 'mpc-wallet-1',
    sessionId: 'session-1',
    participantId: '0x1',
    share: { secret: 'local-share' },
    auxInfo: { secret: 'aux-info' },
    auxInfoStatus: 'completed',
    completeKeyShare: { secret: 'complete-local-share' },
    completeKeyShareStatus: 'completed',
    signingStatus: 'available',
    shareVersion: 1,
    keyVersion: 1,
  });

  const result = await handleMpcDiagnoseWallet({ walletId: 'mpc-wallet-1' });

  assert.equal(result.success, true);
  assert.equal(result.diagnosis.walletId, 'mpc-wallet-1');
  assert.equal(result.diagnosis.name, 'mpc10');
  assert.equal(result.diagnosis.address, '0x2222222222222222222222222222222222222222');
  assert.equal(result.diagnosis.canSign, true);
  assert.equal(result.diagnosis.hasAddress, true);
  assert.equal(result.diagnosis.hasKeyShare, true);
  assert.equal(result.diagnosis.hasAuxInfo, true);
  assert.equal(result.diagnosis.hasCompleteKeyShare, true);
  assert.equal(result.diagnosis.auxInfoStatus, 'completed');
  assert.equal(result.diagnosis.completeKeyShareStatus, 'completed');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('local-share'), false);
  assert.equal(serialized.includes('aux-info'), false);
  assert.equal(serialized.includes('complete-local-share'), false);
});

test('MPC 钱包诊断支持按链地址定位本地钱包记录', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-by-address',
    name: 'mpc-by-address',
    type: 'mpc',
    status: 'keygen_completed',
    address: '0xFD608B60F57F1CaDE5006FaACa5F8DF812A0e093',
    publicKey: '03abcdef',
    keygenSessionId: 'session-by-address',
    threshold: 2,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcKeyShare({
    id: 'share-by-address',
    walletId: 'mpc-wallet-by-address',
    sessionId: 'session-by-address',
    participantId: '0x1',
    share: { secret: 'local-share' },
    auxInfo: { secret: 'aux-info' },
    auxInfoStatus: 'completed',
    completeKeyShare: { secret: 'complete-local-share' },
    completeKeyShareStatus: 'completed',
    signingStatus: 'available',
    shareVersion: 1,
    keyVersion: 1,
  });

  const result = await handleMpcDiagnoseWallet({ address: '0xfd608b60f57f1cade5006faaca5f8df812a0e093' });

  assert.equal(result.success, true);
  assert.equal(result.diagnosis.walletId, 'mpc-wallet-by-address');
  assert.equal(result.diagnosis.name, 'mpc-by-address');
  assert.equal(result.diagnosis.address, '0xFD608B60F57F1CaDE5006FaACa5F8DF812A0e093');
  assert.equal(result.diagnosis.canSign, true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('local-share'), false);
  assert.equal(serialized.includes('aux-info'), false);
  assert.equal(serialized.includes('complete-local-share'), false);
});

test('MPC 钱包签名准备可基于已保存 aux-info 修复 completeKeyShare', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-prepare',
    name: 'mpc-prepare',
    type: 'mpc',
    status: 'keygen_completed',
    address: '0xfd608b60f57f1cade5006faaca5f8df812a0e093',
    publicKey: '03abcdef',
    keygenSessionId: 'session-prepare',
    threshold: 2,
    participants: ['0x1', '0x2'],
    signingStatus: 'unavailable',
    signingUnavailableReason: 'MPC_COMPLETE_KEY_SHARE_NOT_FOUND',
    completeKeyShareStatus: 'missing',
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: 'session-prepare',
    walletId: 'mpc-wallet-prepare',
    name: 'mpc-prepare',
    type: 'keygen',
    status: 'keygen_completed',
    auxInfoStatus: 'completed',
    participants: ['0x1', '0x2'],
    threshold: 2,
    result: {
      address: '0xfd608b60f57f1cade5006faaca5f8df812a0e093'
    },
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcKeyShare({
    id: 'share-prepare',
    walletId: 'mpc-wallet-prepare',
    sessionId: 'session-prepare',
    participantId: '0x1',
    share: { secret: 'local-share' },
    auxInfo: { secret: 'aux-info' },
    auxInfoStatus: 'completed',
    completeKeyShareStatus: 'missing',
    signingStatus: 'unavailable',
    signingUnavailableReason: 'MPC_COMPLETE_KEY_SHARE_NOT_FOUND',
    shareVersion: 1,
    keyVersion: 1,
  });
  setMpcTssEngineForTests({
    isLoaded: () => true,
    combineKeyShare(coreKeyShare, auxInfo) {
      assert.deepEqual(coreKeyShare, { secret: 'local-share' });
      assert.deepEqual(auxInfo, { secret: 'aux-info' });
      return {
        keyShare: { secret: 'complete-local-share' },
        compressedPublicKeyHex: '03abcdef',
        uncompressedPublicKeyHex: '04abcdef',
        ethereumAddress: '0xfd608b60f57f1cade5006faaca5f8df812a0e093',
        curve: 'secp256k1'
      };
    }
  });

  const result = await handleMpcPrepareWalletSigning({ address: '0xfd608b60f57f1cade5006faaca5f8df812a0e093' });

  assert.equal(result.success, true);
  assert.equal(result.repaired, true);
  assert.equal(result.diagnosis.canSign, true);
  assert.equal(result.diagnosis.signingStatus, 'available');
  assert.equal(result.diagnosis.hasCompleteKeyShare, true);
  const wallet = await getMpcWallet('mpc-wallet-prepare');
  assert.equal(wallet.status, 'active');
  assert.equal(wallet.signingStatus, 'available');
  const share = await getMpcKeyShare('share-prepare');
  assert.equal(share.completeKeyShareStatus, 'completed');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('local-share'), false);
  assert.equal(serialized.includes('aux-info'), false);
  assert.equal(serialized.includes('complete-local-share'), false);
});

test('MPC 钱包签名准备优先使用本地 keyShare participantIndex 恢复 aux-info', async () => {
  await saveAccount({
    id: 'account-non-participant',
    walletId: 'wallet-1',
    address: '0xffffffffffffffffffffffffffffffffffffffff',
    name: '非参与者',
  });
  await setSelectedAccountId('account-non-participant');
  await saveMpcWallet({
    id: 'mpc-wallet-prepare-index',
    name: 'mpc-prepare-index',
    type: 'mpc',
    status: 'keygen_completed',
    address: '0xfd608b60f57f1cade5006faaca5f8df812a0e093',
    keygenSessionId: 'session-prepare-index',
    threshold: 2,
    participants: [
      '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    ],
    signingStatus: 'unavailable',
    signingUnavailableReason: 'MPC_COMPLETE_KEY_SHARE_NOT_FOUND',
    completeKeyShareStatus: 'missing',
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: 'session-prepare-index',
    walletId: 'mpc-wallet-prepare-index',
    name: 'mpc-prepare-index',
    type: 'keygen',
    status: 'keygen_completed',
    participants: ['0x9999999999999999999999999999999999999999'],
    threshold: 2,
    result: {
      address: '0xfd608b60f57f1cade5006faaca5f8df812a0e093'
    },
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcKeyShare({
    id: 'mpc-wallet-prepare-index:0x5c7bf91C493126314bb821C123Dee889FFCa3932:1',
    walletId: 'mpc-wallet-prepare-index',
    sessionId: 'session-prepare-index',
    participantId: '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    participantIndex: 1,
    share: { secret: 'local-share' },
    auxInfoStatus: 'missing',
    completeKeyShareStatus: 'missing',
    signingStatus: 'unavailable',
    signingUnavailableReason: 'MPC_COMPLETE_KEY_SHARE_NOT_FOUND',
    shareVersion: 1,
    keyVersion: 1,
  });
  const originalStartWireSession = mpcService.startWireSession;
  const originalStartWireSessionPump = mpcService._startWireSessionPump;
  let startedInput = null;
  let pumpInput = null;
  mpcService.startWireSession = async (input) => {
    startedInput = input;
    return { started: true };
  };
  mpcService._startWireSessionPump = (input) => {
    pumpInput = input;
    return { started: true };
  };

  try {
    const result = await handleMpcPrepareWalletSigning({ walletId: 'mpc-wallet-prepare-index' });

    assert.equal(result.success, true);
    assert.equal(result.started, true);
    assert.equal(result.pending, true);
    assert.equal(startedInput.participantId, '0x5c7bf91C493126314bb821C123Dee889FFCa3932');
    assert.equal(startedInput.recipientIndex, 1);
    assert.deepEqual(startedInput.parties, [0, 1]);
    assert.deepEqual(startedInput.session.participants, [
      '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    ]);
    assert.equal(pumpInput.participantId, '0x5c7bf91C493126314bb821C123Dee889FFCa3932');
    assert.equal(pumpInput.recipientIndex, 1);
    const session = await getMpcSession('session-prepare-index');
    assert.deepEqual(session.participants, [
      '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    ]);
  } finally {
    mpcService.startWireSession = originalStartWireSession;
    mpcService._startWireSessionPump = originalStartWireSessionPump;
  }
});

test('MPC 钱包签名准备启动 aux-info 超时时返回 pending', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-prepare-timeout',
    name: 'mpc-prepare-timeout',
    type: 'mpc',
    status: 'keygen_completed',
    address: '0xfd608b60f57f1cade5006faaca5f8df812a0e093',
    keygenSessionId: 'session-prepare-timeout',
    threshold: 2,
    participants: [
      '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    ],
    signingStatus: 'unavailable',
    signingUnavailableReason: 'MPC_COMPLETE_KEY_SHARE_NOT_FOUND',
    completeKeyShareStatus: 'missing',
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: 'session-prepare-timeout',
    walletId: 'mpc-wallet-prepare-timeout',
    name: 'mpc-prepare-timeout',
    type: 'keygen',
    status: 'keygen_completed',
    participants: [
      '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    ],
    threshold: 2,
    result: {
      address: '0xfd608b60f57f1cade5006faaca5f8df812a0e093'
    },
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcKeyShare({
    id: 'mpc-wallet-prepare-timeout:0x5c7bf91C493126314bb821C123Dee889FFCa3932:1',
    walletId: 'mpc-wallet-prepare-timeout',
    sessionId: 'session-prepare-timeout',
    participantId: '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    participantIndex: 1,
    share: { secret: 'local-share' },
    auxInfoStatus: 'missing',
    completeKeyShareStatus: 'missing',
    signingStatus: 'unavailable',
    signingUnavailableReason: 'MPC_COMPLETE_KEY_SHARE_NOT_FOUND',
    shareVersion: 1,
    keyVersion: 1,
  });
  const originalStartWireSession = mpcService.startWireSession;
  const originalStartWireSessionPump = mpcService._startWireSessionPump;
  const originalSetTimeout = globalThis.setTimeout;
  let pumpStarted = false;
  mpcService.startWireSession = async () => new Promise(() => {});
  mpcService._startWireSessionPump = () => {
    pumpStarted = true;
    return { started: true };
  };
  globalThis.setTimeout = (fn) => {
    queueMicrotask(fn);
    return { unref() {} };
  };

  try {
    const result = await handleMpcPrepareWalletSigning({ walletId: 'mpc-wallet-prepare-timeout' });

    assert.equal(result.success, true);
    assert.equal(result.started, true);
    assert.equal(result.pending, true);
    assert.equal(result.action, 'started');
    const wallet = await getMpcWallet('mpc-wallet-prepare-timeout');
    assert.equal(wallet.auxInfoStatus, 'running');
    assert.equal(pumpStarted, false);
  } finally {
    mpcService.startWireSession = originalStartWireSession;
    mpcService._startWireSessionPump = originalStartWireSessionPump;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('MPC 钱包签名准备启动 aux-info 失败时返回错误', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-prepare-failed',
    name: 'mpc-prepare-failed',
    type: 'mpc',
    status: 'keygen_completed',
    address: '0xfd608b60f57f1cade5006faaca5f8df812a0e093',
    keygenSessionId: 'session-prepare-failed',
    threshold: 2,
    participants: [
      '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    ],
    signingStatus: 'unavailable',
    signingUnavailableReason: 'MPC_COMPLETE_KEY_SHARE_NOT_FOUND',
    completeKeyShareStatus: 'missing',
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: 'session-prepare-failed',
    walletId: 'mpc-wallet-prepare-failed',
    name: 'mpc-prepare-failed',
    type: 'keygen',
    status: 'keygen_completed',
    participants: [
      '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    ],
    threshold: 2,
    result: {
      address: '0xfd608b60f57f1cade5006faaca5f8df812a0e093'
    },
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcKeyShare({
    id: 'mpc-wallet-prepare-failed:0x5c7bf91C493126314bb821C123Dee889FFCa3932:1',
    walletId: 'mpc-wallet-prepare-failed',
    sessionId: 'session-prepare-failed',
    participantId: '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    participantIndex: 1,
    share: { secret: 'local-share' },
    auxInfoStatus: 'missing',
    completeKeyShareStatus: 'missing',
    signingStatus: 'unavailable',
    signingUnavailableReason: 'MPC_COMPLETE_KEY_SHARE_NOT_FOUND',
    shareVersion: 1,
    keyVersion: 1,
  });
  const originalStartWireSession = mpcService.startWireSession;
  const originalStartWireSessionPump = mpcService._startWireSessionPump;
  let pumpStarted = false;
  mpcService.startWireSession = async () => {
    throw new Error('Wallet is locked');
  };
  mpcService._startWireSessionPump = () => {
    pumpStarted = true;
    return { started: true };
  };

  try {
    const result = await handleMpcPrepareWalletSigning({ walletId: 'mpc-wallet-prepare-failed' });

    assert.equal(result.success, false);
    assert.equal(result.action, 'failed');
    assert.equal(result.error, 'Wallet is locked');
    assert.equal(result.diagnosis.signingStatus, 'unavailable');
    assert.equal(result.diagnosis.reason, 'Wallet is locked');
    assert.equal(pumpStarted, false);
    const wallet = await getMpcWallet('mpc-wallet-prepare-failed');
    assert.equal(wallet.auxInfoStatus, 'failed');
    assert.equal(wallet.signingUnavailableReason, 'Wallet is locked');
  } finally {
    mpcService.startWireSession = originalStartWireSession;
    mpcService._startWireSessionPump = originalStartWireSessionPump;
  }
});

test('MPC 钱包签名准备在 aux-info delayed start 完成后才启动 pump', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-prepare-delayed',
    name: 'mpc-prepare-delayed',
    type: 'mpc',
    status: 'keygen_completed',
    address: '0xfd608b60f57f1cade5006faaca5f8df812a0e093',
    keygenSessionId: 'session-prepare-delayed',
    threshold: 2,
    participants: [
      '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    ],
    signingStatus: 'unavailable',
    signingUnavailableReason: 'MPC_COMPLETE_KEY_SHARE_NOT_FOUND',
    completeKeyShareStatus: 'missing',
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: 'session-prepare-delayed',
    walletId: 'mpc-wallet-prepare-delayed',
    name: 'mpc-prepare-delayed',
    type: 'keygen',
    status: 'keygen_completed',
    participants: [
      '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    ],
    threshold: 2,
    result: {
      address: '0xfd608b60f57f1cade5006faaca5f8df812a0e093'
    },
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcKeyShare({
    id: 'mpc-wallet-prepare-delayed:0x5c7bf91C493126314bb821C123Dee889FFCa3932:1',
    walletId: 'mpc-wallet-prepare-delayed',
    sessionId: 'session-prepare-delayed',
    participantId: '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    participantIndex: 1,
    share: { secret: 'local-share' },
    auxInfoStatus: 'missing',
    completeKeyShareStatus: 'missing',
    signingStatus: 'unavailable',
    signingUnavailableReason: 'MPC_COMPLETE_KEY_SHARE_NOT_FOUND',
    shareVersion: 1,
    keyVersion: 1,
  });
  const originalStartWireSession = mpcService.startWireSession;
  const originalStartWireSessionPump = mpcService._startWireSessionPump;
  const originalSetTimeout = globalThis.setTimeout;
  const realSetTimeout = originalSetTimeout;
  let resolveStart;
  const startPromise = new Promise((resolve) => {
    resolveStart = resolve;
  });
  const pumpInputs = [];
  mpcService.startWireSession = async () => startPromise;
  mpcService._startWireSessionPump = (input) => {
    pumpInputs.push(input);
    return { started: true };
  };
  globalThis.setTimeout = (fn) => {
    queueMicrotask(fn);
    return { unref() {} };
  };

  try {
    const result = await handleMpcPrepareWalletSigning({ walletId: 'mpc-wallet-prepare-delayed' });

    assert.equal(result.success, true);
    assert.equal(result.started, true);
    assert.equal(pumpInputs.length, 0);
    resolveStart({ started: true });
    await new Promise((resolve) => realSetTimeout(resolve, 0));
    assert.equal(pumpInputs.length, 1);
    assert.equal(pumpInputs[0].protocol, 'aux-info');
    assert.equal(pumpInputs[0].requestId, 'aux-info:v2:session-prepare-delayed:1:1');
    assert.equal(pumpInputs[0].maxIdleTicks > 12, true);
  } finally {
    mpcService.startWireSession = originalStartWireSession;
    mpcService._startWireSessionPump = originalStartWireSessionPump;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('MPC 钱包签名准备会重启旧版本遗留的 running aux-info 状态', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-prepare-stale-running',
    name: 'mpc-prepare-stale-running',
    type: 'mpc',
    status: 'keygen_completed',
    address: '0xfd608b60f57f1cade5006faaca5f8df812a0e093',
    keygenSessionId: 'session-prepare-stale-running',
    threshold: 2,
    participants: [
      '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    ],
    auxInfoStatus: 'running',
    signingStatus: 'unavailable',
    signingUnavailableReason: 'MPC_COMPLETE_KEY_SHARE_NOT_FOUND',
    completeKeyShareStatus: 'missing',
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: 'session-prepare-stale-running',
    walletId: 'mpc-wallet-prepare-stale-running',
    name: 'mpc-prepare-stale-running',
    type: 'keygen',
    status: 'keygen_completed',
    auxInfoStatus: 'running',
    participants: [
      '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    ],
    threshold: 2,
    result: {
      address: '0xfd608b60f57f1cade5006faaca5f8df812a0e093'
    },
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcKeyShare({
    id: 'mpc-wallet-prepare-stale-running:0x5c7bf91C493126314bb821C123Dee889FFCa3932:1',
    walletId: 'mpc-wallet-prepare-stale-running',
    sessionId: 'session-prepare-stale-running',
    participantId: '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    participantIndex: 1,
    share: { secret: 'local-share' },
    auxInfoStatus: 'missing',
    completeKeyShareStatus: 'missing',
    signingStatus: 'unavailable',
    signingUnavailableReason: 'MPC_COMPLETE_KEY_SHARE_NOT_FOUND',
    shareVersion: 1,
    keyVersion: 1,
  });
  await saveMpcWireState({
    sessionId: 'session-prepare-stale-running',
    protocol: 'aux-info',
    participantIndex: 1,
    snapshot: {
      persistable: true,
      protocol: 'aux-info',
      legacyState: true
    },
    updatedAt: 1000
  });

  const originalStartWireSession = mpcService.startWireSession;
  const originalStartWireSessionPump = mpcService._startWireSessionPump;
  let startedInput = null;
  let pumpInput = null;
  mpcService.startWireSession = async (input) => {
    startedInput = input;
    return { started: true };
  };
  mpcService._startWireSessionPump = (input) => {
    pumpInput = input;
    return { started: true };
  };

  try {
    const result = await handleMpcPrepareWalletSigning({ walletId: 'mpc-wallet-prepare-stale-running' });

    assert.equal(result.success, true);
    assert.equal(result.started, true);
    assert.equal(result.resumed, false);
    assert.equal(result.pending, true);
    assert.equal(startedInput.protocol, 'aux-info');
    assert.equal(startedInput.recipientIndex, 1);
    assert.equal(pumpInput.protocol, 'aux-info');
    assert.equal(pumpInput.recipientIndex, 1);
    const staleWireState = await getMpcWireState({
      sessionId: 'session-prepare-stale-running',
      protocol: 'aux-info',
      participantIndex: 1
    });
    assert.equal(staleWireState, null);
  } finally {
    mpcService.startWireSession = originalStartWireSession;
    mpcService._startWireSessionPump = originalStartWireSessionPump;
  }
});

test('session 数字字段缺失时不会把本地值误同步为 0', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '社区金库',
    type: 'mpc',
    status: 'keygen_pending',
    keygenSessionId: 'session-1',
    threshold: 2,
    participants: ['0x1', '0x2'],
  });

  await mpcService.syncWalletFromSession({
    id: 'session-1',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'created',
    threshold: null,
    participants: [],
  });

  const wallet = await getMpcWallet('mpc-wallet-1');
  assert.equal(wallet.threshold, 2);
  assert.deepEqual(wallet.participants, ['0x1', '0x2']);
});

test('session 同步不会把通用邀请标题写成 MPC 钱包名称', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '社区金库',
    type: 'mpc',
    status: 'keygen_pending',
    keygenSessionId: 'session-1',
    threshold: 2,
    participants: ['0x1', '0x2'],
  });

  await mpcService.syncWalletFromSession({
    id: 'session-1',
    name: 'MPC 钱包邀请',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'created',
  });

  const wallet = await getMpcWallet('mpc-wallet-1');
  assert.equal(wallet.name, '社区金库');
});


test('listInvites 过滤本地已接受的 MPC 邀请', async () => {
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    listNotifications: async () => ({
      items: [{
        type: 'mpc.keygen.invited',
        notificationUid: 'notification-1',
        subjectId: 'session-1',
        payload: {
          sessionId: 'session-1',
          walletId: 'mpc-wallet-1',
          participants: ['0x1', '0x2'],
        },
      }],
    }),
    getSession: async () => ({
      id: 'session-1',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      status: 'created',
    }),
  };
  try {
    await saveMpcWallet({
      id: 'mpc-wallet-1',
      name: '团队金库',
      type: 'mpc',
      status: 'keygen_pending',
      keygenSessionId: 'session-1',
    });

    const result = await mpcService.listInvites({ unreadOnly: true });

    assert.deepEqual(result.items, []);
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('listInvites 过滤本地已移除的未接受 MPC 邀请', async () => {
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  const marked = [];
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    listNotifications: async () => ({
      items: [{
        uid: 'item-1',
        type: 'mpc.keygen.invited',
        notificationUid: 'notification-1',
        subjectId: 'session-1',
        payload: {
          sessionId: 'session-1',
          walletId: 'mpc-wallet-1',
          name: '团队金库',
          participants: ['0x1', '0x2'],
        },
      }],
    }),
    getSession: async () => ({
      id: 'session-1',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      status: 'created',
    }),
    markNotificationRead: async (notificationUid) => {
      marked.push(notificationUid);
      return { success: true };
    },
  };
  try {
    const dismissed = await handleMpcDismissInvite({
      uid: 'item-1',
      notificationUid: 'notification-1',
      subjectId: 'session-1',
      payload: {
        sessionId: 'session-1',
        walletId: 'mpc-wallet-1',
      },
    });
    assert.equal(dismissed.success, true);
    assert.deepEqual(marked, ['notification-1']);

    const result = await mpcService.listInvites({ unreadOnly: true });

    assert.deepEqual(result.items, []);
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('listInvites 不因本地 participant 记录隐藏缺失钱包的 MPC 邀请', async () => {
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    listNotifications: async () => ({
      items: [{
        type: 'mpc.keygen.invited',
        notificationUid: 'notification-1',
        subjectId: 'session-1',
        payload: {
          sessionId: 'session-1',
          walletId: 'mpc-wallet-1',
          name: '团队金库',
          participants: ['0x1', '0x2'],
        },
      }],
    }),
    getSession: async () => ({
      id: 'session-1',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      status: 'created',
    }),
  };
  try {
    await saveMpcParticipant({
      id: '0x2',
      sessionId: 'session-1',
      status: 'active',
    });

    const result = await mpcService.listInvites({ unreadOnly: true });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].payload.name, '团队金库');
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('listInvites 用 session 详情补齐邀请中的 MPC 钱包名称', async () => {
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    listNotifications: async () => ({
      items: [{
        type: 'mpc.keygen.invited',
        notificationUid: 'notification-1',
        subjectId: '61705018-13b2-43e9-ab09-2698b64759f6',
        payload: {
          sessionId: '61705018-13b2-43e9-ab09-2698b64759f6',
          walletId: 'mpc-wallet-1',
        },
      }],
    }),
    getSession: async () => ({
      id: '61705018-13b2-43e9-ab09-2698b64759f6',
      name: 'mcp10',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      status: 'created',
      threshold: 2,
      participants: ['0x1', '0x2'],
    }),
  };
  try {
    const result = await mpcService.listInvites({ unreadOnly: true });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].payload.name, 'mcp10');
    assert.equal(result.items[0].payload.threshold, 2);
    assert.deepEqual(result.items[0].payload.participants, ['0x1', '0x2']);
    assert.equal(result.items[0].session.name, 'mcp10');
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('接受邀请会用协议 name 修复已有本地 MPC 钱包名称', async () => {
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: '0x5c7bf91c493126314bb821c123dee889ffca3932',
  });
  await setSelectedAccountId('account-1');
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '名称缺失',
    type: 'mpc',
    status: 'keygen_pending',
    keygenSessionId: 'session-1',
    threshold: 1,
    participants: [
      '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
    ],
    createdAt: 1000,
    updatedAt: 1000,
  });

  const originalJoinSession = mpcService.joinSession;
  const originalStartEventStream = mpcService.startEventStream;
  const originalSyncWalletFromSession = mpcService.syncWalletFromSession;
  const originalMarkInviteRead = mpcService.markInviteRead;
  mpcService.joinSession = async () => ({
    session: {
      id: 'session-1',
      name: 'mpc10',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      status: 'created',
      threshold: 1,
      participants: [
        '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
        '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
      ],
    },
    response: {},
  });
  mpcService.startEventStream = async () => ({ started: true });
  mpcService.syncWalletFromSession = async () => null;
  mpcService.markInviteRead = async () => null;

  try {
    const result = await handleMpcAcceptInvite({
      notificationUid: 'notification-1',
      sessionId: 'session-1',
      walletId: 'mpc-wallet-1',
      payload: {
        sessionId: 'session-1',
        walletId: 'mpc-wallet-1',
        name: 'mpc10',
        threshold: 1,
        participants: [
          '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
          '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
        ],
      },
      password: 'password123',
    });

    assert.equal(result.success, true);
    const wallet = await getMpcWallet('mpc-wallet-1');
    assert.equal(wallet.name, 'mpc10');
  } finally {
    mpcService.joinSession = originalJoinSession;
    mpcService.startEventStream = originalStartEventStream;
    mpcService.syncWalletFromSession = originalSyncWalletFromSession;
    mpcService.markInviteRead = originalMarkInviteRead;
  }
});

test('接受邀请在本地钱包保存后启动 ready keygen', async () => {
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: '0x5c7bf91c493126314bb821c123dee889ffca3932',
  });
  await setSelectedAccountId('account-1');

  const originalJoinSession = mpcService.joinSession;
  const originalStartEventStream = mpcService.startEventStream;
  const originalSyncWalletFromSession = mpcService.syncWalletFromSession;
  const originalStartKeygenSession = mpcService.startKeygenSession;
  const originalMarkInviteRead = mpcService.markInviteRead;
  let startedAfterWalletSave = false;
  mpcService.joinSession = async () => ({
    session: {
      id: 'session-ready',
      name: 'mpc10',
      type: 'keygen',
      walletId: 'mpc-wallet-ready',
      status: 'ready',
      threshold: 1,
      participants: [
        '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
        '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
      ],
    },
    response: {},
  });
  mpcService.startEventStream = async () => ({ started: true });
  mpcService.syncWalletFromSession = async () => null;
  mpcService.startKeygenSession = async ({ sessionId }) => {
    const wallet = await getMpcWallet('mpc-wallet-ready');
    startedAfterWalletSave = sessionId === 'session-ready' && Boolean(wallet);
    return { started: true };
  };
  mpcService.markInviteRead = async () => null;

  try {
    const result = await handleMpcAcceptInvite({
      notificationUid: 'notification-ready',
      sessionId: 'session-ready',
      walletId: 'mpc-wallet-ready',
      payload: {
        sessionId: 'session-ready',
        walletId: 'mpc-wallet-ready',
        name: 'mpc10',
        threshold: 1,
        participants: [
          '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
          '0x5c7bf91C493126314bb821C123Dee889FFCa3932',
        ],
      },
      password: 'password123',
    });

    assert.equal(result.success, true);
    assert.equal(startedAfterWalletSave, true);
  } finally {
    mpcService.joinSession = originalJoinSession;
    mpcService.startEventStream = originalStartEventStream;
    mpcService.syncWalletFromSession = originalSyncWalletFromSession;
    mpcService.startKeygenSession = originalStartKeygenSession;
    mpcService.markInviteRead = originalMarkInviteRead;
  }
});

test('取消旧 MPC 创建遇到远端不可取消时会清理本地未完成记录', async () => {
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: '0x1111111111111111111111111111111111111111',
  });
  await setSelectedAccountId('account-1');
  state.keyring = new Map([
    ['account-1', { signMessage: async (message) => `signed:${message}` }],
  ]);
  await saveMpcWallet({
    id: 'mpc-wallet-stale',
    name: 'mpc10',
    type: 'mpc',
    status: 'keygen_running',
    keygenSessionId: '868d2738-d7fe-4ae2-82f3-135f5454aad9',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: '868d2738-d7fe-4ae2-82f3-135f5454aad9',
    type: 'keygen',
    walletId: 'mpc-wallet-stale',
    status: 'running',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
    createdAt: 1000,
    updatedAt: 1000,
  });

  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    cancelSession: async () => {
      throw new Error('Session is not cancellable');
    },
  };

  try {
    const result = await handleMpcCancelSession({
      walletId: 'mpc-wallet-stale',
      sessionId: '868d2738-d7fe-4ae2-82f3-135f5454aad9',
      password: 'password123',
    });

    assert.equal(result.success, true);
    assert.equal(result.remoteCancelled, false);
    assert.match(result.warning, /已移除本地未完成 MPC 钱包记录/);
    assert.equal(await getMpcWallet('mpc-wallet-stale'), null);
    assert.equal(await getMpcSession('868d2738-d7fe-4ae2-82f3-135f5454aad9'), null);
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('被邀请方取消未完成 MPC 创建遇到远端 Forbidden 时会清理本地记录', async () => {
  await saveAccount({
    id: 'account-invitee',
    walletId: 'wallet-invitee',
    address: '0x2222222222222222222222222222222222222222',
  });
  await setSelectedAccountId('account-invitee');
  state.keyring = new Map([
    ['account-invitee', { signMessage: async (message) => `signed:${message}` }],
  ]);
  await saveMpcWallet({
    id: 'mpc-wallet-invitee',
    name: 'mpc10',
    type: 'mpc',
    status: 'keygen_running',
    keygenSessionId: 'session-forbidden',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
  });
  await saveMpcSession({
    id: 'session-forbidden',
    type: 'keygen',
    walletId: 'mpc-wallet-invitee',
    status: 'running',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
  });

  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    cancelSession: async () => {
      const error = new Error('Forbidden');
      error.status = 403;
      throw error;
    },
  };

  try {
    const result = await handleMpcCancelSession({
      walletId: 'mpc-wallet-invitee',
      sessionId: 'session-forbidden',
      password: 'password123',
    });

    assert.equal(result.success, true);
    assert.equal(result.remoteCancelled, false);
    assert.match(result.warning, /已移除本地未完成 MPC 钱包记录/);
    assert.equal(await getMpcWallet('mpc-wallet-invitee'), null);
    assert.equal(await getMpcSession('session-forbidden'), null);
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('取消未完成 MPC 创建遇到远端 Session not found 时会清理本地记录', async () => {
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: '0x1111111111111111111111111111111111111111',
  });
  await setSelectedAccountId('account-1');
  state.keyring = new Map([
    ['account-1', { signMessage: async (message) => `signed:${message}` }],
  ]);
  await saveMpcWallet({
    id: 'mpc-wallet-missing-session',
    name: 'mpc10',
    type: 'mpc',
    status: 'keygen_running',
    keygenSessionId: 'e87388c7-1e74-4031-a41e-9357ad72d3d5',
    threshold: 1,
    participants: ['0x1', '0x2'],
  });
  await saveMpcSession({
    id: 'e87388c7-1e74-4031-a41e-9357ad72d3d5',
    type: 'keygen',
    walletId: 'mpc-wallet-missing-session',
    status: 'running',
    threshold: 1,
    participants: ['0x1', '0x2'],
  });

  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    cancelSession: async () => {
      const error = new Error('Session not found');
      error.status = 404;
      throw error;
    },
  };

  try {
    const result = await handleMpcCancelSession({
      walletId: 'mpc-wallet-missing-session',
      sessionId: 'e87388c7-1e74-4031-a41e-9357ad72d3d5',
      password: 'password123',
    });

    assert.equal(result.success, true);
    assert.equal(result.remoteCancelled, false);
    assert.match(result.warning, /已移除本地未完成 MPC 钱包记录/);
    assert.equal(await getMpcWallet('mpc-wallet-missing-session'), null);
    assert.equal(await getMpcSession('e87388c7-1e74-4031-a41e-9357ad72d3d5'), null);
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('已生成地址的 MPC 钱包不能通过取消创建入口移除', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-active',
    name: 'mpc10',
    type: 'mpc',
    status: 'keygen_running',
    address: '0x1111111111111111111111111111111111111111',
    keygenSessionId: 'session-active',
    threshold: 1,
    participants: ['0x1', '0x2'],
  });
  await saveMpcSession({
    id: 'session-active',
    type: 'keygen',
    walletId: 'mpc-wallet-active',
    status: 'running',
    threshold: 1,
    participants: ['0x1', '0x2'],
  });

  const result = await handleMpcCancelSession({
    walletId: 'mpc-wallet-active',
    sessionId: 'session-active',
    password: 'password123',
  });

  assert.equal(result.success, false);
  assert.match(result.error, /已创建成功/);
  assert.notEqual(await getMpcWallet('mpc-wallet-active'), null);
  assert.notEqual(await getMpcSession('session-active'), null);
});

test('删除 MPC 钱包会清理本地关联数据', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-delete',
    name: 'delete-me',
    type: 'mpc',
    status: 'keygen_completed',
    address: '0x1234567890123456789012345678901234567890',
    keygenSessionId: 'session-delete',
    threshold: 2,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: 'session-delete',
    walletId: 'mpc-wallet-delete',
    type: 'keygen',
    status: 'keygen_completed',
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcKeyShare({
    id: 'share-delete',
    walletId: 'mpc-wallet-delete',
    sessionId: 'session-delete',
    participantId: '0x1',
    participantIndex: 0,
    share: { secret: 'local-share' },
  });
  await saveMpcWireState({
    sessionId: 'session-delete',
    participantIndex: 0,
    protocol: 'aux-info',
    requestId: 'request-delete',
    cursor: 10,
  });
  await saveMpcSignRequest({
    id: 'sign-delete',
    walletId: 'mpc-wallet-delete',
    sessionId: 'session-delete',
    status: 'pending',
  });
  await saveMpcMessage({
    id: 'message-delete',
    sessionId: 'session-delete',
    senderIndex: 0,
    recipientIndex: 1,
    payload: {},
  });
  await saveMpcParticipant({
    id: '0x1',
    sessionId: 'session-delete',
    address: '0x1',
  });

  const result = await handleMpcDeleteWallet({ walletId: 'mpc-wallet-delete', password: 'password123' });

  assert.equal(result.success, true);
  assert.deepEqual(result.deleted, {
    wallet: true,
    sessions: 1,
    keyShares: 1,
    wireStates: 1,
    signRequests: 1,
    messages: 1,
    participants: 1,
  });
  assert.equal(await getMpcWallet('mpc-wallet-delete'), null);
  assert.equal(await getMpcSession('session-delete'), null);
  assert.equal(await getMpcKeyShare('share-delete'), null);
  assert.equal(await getMpcWireState({
    sessionId: 'session-delete',
    participantIndex: 0,
    protocol: 'aux-info',
    requestId: 'request-delete',
  }), null);
  assert.equal(await getMpcSignRequest('sign-delete'), null);
  assert.equal(await getMpcMessage('message-delete'), null);
  assert.equal(await getMpcParticipant('session-delete', '0x1'), null);
});

test('创建 MPC session 后会把创建方登记为 coordinator participant', async () => {
  const actor = '0x1111111111111111111111111111111111111111';
  const invited = '0x2222222222222222222222222222222222222222';
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: actor,
  });
  await setSelectedAccountId('account-1');
  state.keyring = new Map([
    ['account-1', { signMessage: async (message) => `signed:${message}` }],
  ]);

  const joinCalls = [];
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    createSession: async () => ({
      id: 'session-creator-join',
      name: 'mpc-4531',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      threshold: 1,
      participants: [actor, invited],
      status: 'created',
      round: 0,
      curve: 'secp256k1',
      keyVersion: 0,
      shareVersion: 0,
    }),
    joinSession: async (sessionId, payload) => {
      joinCalls.push({ sessionId, payload });
      return {
        id: sessionId,
        name: 'mpc-4531',
        type: 'keygen',
        walletId: 'mpc-wallet-1',
        threshold: 1,
        participants: [actor, invited],
        status: 'ready',
        round: 0,
        curve: 'secp256k1',
        keyVersion: 0,
        shareVersion: 0,
        joinedParticipants: [{
          participantId: actor,
          deviceId: payload.deviceId,
          identity: payload.identity,
          e2ePublicKey: payload.e2ePublicKey,
          signingPublicKey: payload.signingPublicKey,
          status: 'active',
          joinedAt: '1',
        }],
      };
    },
  };

  try {
    const result = await mpcService.createSession({
      type: 'keygen',
      name: 'mpc-4531',
      walletId: 'mpc-wallet-1',
      threshold: 1,
      participants: [actor, invited],
      curve: 'secp256k1',
      password: 'password123',
    });

    assert.equal(result.session.id, 'session-creator-join');
    assert.equal(joinCalls.length, 1);
    assert.equal(joinCalls[0].sessionId, 'session-creator-join');
    assert.equal(joinCalls[0].payload.participantId, actor);
    assert.equal(joinCalls[0].payload.identity, `did:pkh:eth:${actor.toLowerCase()}`);
    assert.match(joinCalls[0].payload.e2ePublicKey, /^x25519:/);
    assert.match(joinCalls[0].payload.signingPublicKey, /^ed25519:/);
    const localParticipant = await getMpcParticipant('session-creator-join', actor);
    assert.equal(localParticipant.id, actor);
    assert.equal(localParticipant.deviceId, joinCalls[0].payload.deviceId);
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('创建 MPC session 时选中 MPC 账号会使用 HD 账号登记 participant', async () => {
  const actor = '0x1111111111111111111111111111111111111111';
  const mpcAddress = '0x3333333333333333333333333333333333333333';
  const invited = '0x2222222222222222222222222222222222222222';
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: actor,
  });
  await saveMpcWallet({
    id: 'existing-mpc-wallet',
    name: 'existing mpc',
    type: 'mpc',
    status: 'active',
    address: mpcAddress,
  });
  await setSelectedAccountId('mpc:existing-mpc-wallet');
  state.keyring = new Map([
    ['account-1', { signMessage: async (message) => `signed:${message}` }],
  ]);

  const joinCalls = [];
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    createSession: async () => ({
      id: 'session-hd-fallback',
      name: 'mpc-hd-fallback',
      type: 'keygen',
      walletId: 'mpc-wallet-new',
      threshold: 1,
      participants: [actor, invited],
      status: 'created',
      round: 0,
      curve: 'secp256k1',
      keyVersion: 0,
      shareVersion: 0,
    }),
    joinSession: async (sessionId, payload) => {
      joinCalls.push({ sessionId, payload });
      return {
        id: sessionId,
        name: 'mpc-hd-fallback',
        type: 'keygen',
        walletId: 'mpc-wallet-new',
        threshold: 1,
        participants: [actor, invited],
        status: 'ready',
        round: 0,
        curve: 'secp256k1',
        keyVersion: 0,
        shareVersion: 0,
        joinedParticipants: [{
          participantId: actor,
          deviceId: payload.deviceId,
          identity: payload.identity,
          e2ePublicKey: payload.e2ePublicKey,
          signingPublicKey: payload.signingPublicKey,
          status: 'active',
          joinedAt: '1',
        }],
      };
    },
  };

  try {
    await mpcService.createSession({
      type: 'keygen',
      name: 'mpc-hd-fallback',
      walletId: 'mpc-wallet-new',
      threshold: 1,
      participants: [actor, invited],
      curve: 'secp256k1',
      password: 'password123',
    });

    assert.equal(joinCalls.length, 1);
    assert.equal(joinCalls[0].payload.participantId, actor);
    assert.equal(joinCalls[0].payload.identity, `did:pkh:eth:${actor.toLowerCase()}`);
    const localParticipant = await getMpcParticipant('session-hd-fallback', actor);
    assert.equal(localParticipant.id, actor);
    assert.equal(await getMpcParticipant('session-hd-fallback', mpcAddress), null);
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('创建 MPC 钱包时会用 HD 地址替换 UI 传入的当前 MPC 地址', async () => {
  const actor = '0x1111111111111111111111111111111111111111';
  const mpcAddress = '0x3333333333333333333333333333333333333333';
  const invited = '0x2222222222222222222222222222222222222222';
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: actor,
  });
  await saveMpcWallet({
    id: 'existing-mpc-wallet',
    name: 'existing mpc',
    type: 'mpc',
    status: 'active',
    address: mpcAddress,
  });
  await setSelectedAccountId('mpc:existing-mpc-wallet');
  state.keyring = new Map([
    ['account-1', { signMessage: async (message) => `signed:${message}` }],
  ]);

  let createPayload = null;
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    createSession: async (payload) => {
      createPayload = payload;
      return {
        id: 'session-create-wallet-fallback',
        name: payload.name,
        type: 'keygen',
        walletId: payload.walletId,
        threshold: payload.threshold,
        participants: payload.participants,
        status: 'created',
        round: 0,
        curve: payload.curve,
        keyVersion: 1,
        shareVersion: 1,
      };
    },
    joinSession: async (sessionId, payload) => ({
      id: sessionId,
      name: 'mpc-wallet-fallback',
      type: 'keygen',
      walletId: createPayload.walletId,
      threshold: createPayload.threshold,
      participants: createPayload.participants,
      status: 'created',
      round: 0,
      curve: createPayload.curve,
      keyVersion: 1,
      shareVersion: 1,
      joinedParticipants: [{
        participantId: payload.participantId,
        deviceId: payload.deviceId,
        identity: payload.identity,
        e2ePublicKey: payload.e2ePublicKey,
        signingPublicKey: payload.signingPublicKey,
        status: 'active',
        joinedAt: '1',
      }],
    }),
  };

  try {
    const result = await handleCreateMpcWallet({
      name: 'mpc-wallet-fallback',
      threshold: 2,
      participants: [mpcAddress, invited],
      password: 'password123',
    });

    assert.equal(result.success, true);
    assert.deepEqual(createPayload.participants, [actor, invited]);
    assert.equal(createPayload.participants.includes(mpcAddress), false);
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('钱包列表会用本地 session name 修复已有 MPC 钱包名称', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '名称缺失',
    type: 'mpc',
    status: 'keygen_pending',
    keygenSessionId: 'session-1',
    threshold: 1,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: 'session-1',
    name: 'mpc10',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'created',
    threshold: 1,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });

  const result = await HandleGetWalletList();

  assert.equal(result.success, true);
  assert.equal(result.wallets.find((wallet) => wallet.id === 'mpc-wallet-1')?.name, 'mpc10');
  const wallet = await getMpcWallet('mpc-wallet-1');
  assert.equal(wallet.name, 'mpc10');
});

test('钱包列表会自动同步未完成 MPC 钱包的远端 session 状态', async () => {
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: 'mpc10',
    type: 'mpc',
    status: 'keygen_pending',
    keygenSessionId: 'session-1',
    threshold: 1,
    participants: ['0x1', '0x2'],
    createdAt: 1000,
    updatedAt: 1000,
  });

  const originalGetSessions = mpcService.getSessions;
  mpcService.getSessions = async (walletId) => {
    assert.equal(walletId, 'mpc-wallet-1');
    const nextWallet = {
      id: 'mpc-wallet-1',
      name: 'mpc10',
      type: 'mpc',
      status: 'keygen_running',
      keygenSessionId: 'session-1',
      threshold: 1,
      participants: ['0x1', '0x2'],
      updatedAt: 2000,
    };
    await saveMpcWallet(nextWallet);
    return { wallet: nextWallet, sessions: [{ id: 'session-1', status: 'rounds' }] };
  };

  try {
    const result = await HandleGetWalletList();

    assert.equal(result.success, true);
    assert.equal(result.wallets.find((wallet) => wallet.id === 'mpc-wallet-1')?.status, 'keygen_running');
  } finally {
    mpcService.getSessions = originalGetSessions;
  }
});

test('startKeygenSession 启动 wire keygen 并推进本地钱包状态', async () => {
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: '0x1111111111111111111111111111111111111111',
  });
  await setSelectedAccountId('account-1');
  state.keyring = new Map([
    ['account-1', { signMessage: async (message) => `signed:${message}` }],
  ]);
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '团队金库',
    type: 'mpc',
    status: 'keygen_ready',
    keygenSessionId: 'session-1',
    curve: 'secp256k1',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
    keyVersion: 1,
    shareVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcParticipant({
    id: '0x1111111111111111111111111111111111111111',
    sessionId: 'session-1',
    status: 'active',
    signingPublicKey: '',
    e2ePublicKey: '',
  });

  const sentMessages = [];
  const joinCalls = [];
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  const originalSendWireMessage = mpcService.sendWireMessage;
  const originalFetchWireMessages = mpcService.fetchWireMessages;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    getSession: async () => ({
      id: 'session-1',
      name: '团队金库',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      status: 'ready',
      curve: 'secp256k1',
      threshold: 1,
      participants: [
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222',
      ],
      keyVersion: 1,
      shareVersion: 1,
    }),
    joinSession: async (sessionId, payload) => {
      joinCalls.push({ sessionId, payload });
      return { ok: true };
    },
  };
  mpcService.sendWireMessage = async (message) => {
    sentMessages.push(message);
    return {
      message: {
        id: `sent-${sentMessages.length}`,
        sessionId: message.sessionId,
        from: String(message.senderIndex),
        to: '',
        type: message.protocol,
        seq: sentMessages.length,
        envelope: message,
        createdAt: String(sentMessages.length),
      },
    };
  };
  mpcService.fetchWireMessages = async () => ({ messages: [], nextSequence: 0 });
  setMpcTssEngineForTests({
    startKeygen: async (input) => {
      assert.equal(input.sessionId, 'session-1');
      assert.equal(input.senderIndex, 0);
      assert.deepEqual(input.parties, [0, 1]);
      return {
        protocol: 'keygen',
        senderIndex: input.senderIndex,
        outgoing: [{
          protocol: 'keygen',
          senderIndex: input.senderIndex,
          recipientIndex: 1,
          payload: { Round1: { from: input.senderIndex } },
        }],
      };
    },
    getOutgoingMessages: async ({ state }) => {
      const outgoing = state.outgoing || [];
      state.outgoing = [];
      return outgoing;
    },
    advance: async ({ state }) => state,
    receiveMessage: async ({ state }) => state,
    getResult: async () => null,
  });

  try {
    const result = await mpcService.startKeygenSession({ sessionId: 'session-1' });

    assert.equal(result.started.protocol, 'keygen');
    assert.equal(result.participantIndex, 0);
    assert.equal(result.tickCount, 1);
    assert.equal(joinCalls.length, 1);
    assert.equal(joinCalls[0].sessionId, 'session-1');
    assert.equal(joinCalls[0].payload.participantId, '0x1111111111111111111111111111111111111111');
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].sessionId, 'session-1');
    assert.equal(sentMessages[0].protocol, 'keygen');
    assert.equal(sentMessages[0].senderIndex, 0);
    const wallet = await getMpcWallet('mpc-wallet-1');
    assert.equal(wallet.name, '团队金库');
    assert.equal(wallet.status, 'keygen_running');
    const session = await getMpcSession('session-1');
    assert.equal(session.status, 'running');
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
    mpcService.sendWireMessage = originalSendWireMessage;
    mpcService.fetchWireMessages = originalFetchWireMessages;
    resetMpcTssEngineForTests();
  }
});

test('fetchSessionMessages 会把对端 keygen 消息交给 TSS 引擎处理', async () => {
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: '0x1111111111111111111111111111111111111111',
  });
  await setSelectedAccountId('account-1');
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '团队金库',
    type: 'mpc',
    status: 'keygen_running',
    keygenSessionId: 'session-1',
    curve: 'secp256k1',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
    keyVersion: 1,
    shareVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: 'session-1',
    name: '团队金库',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'rounds',
    curve: 'secp256k1',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
    keyVersion: 1,
    shareVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcParticipant({
    id: '0x1111111111111111111111111111111111111111',
    sessionId: 'session-1',
    status: 'active',
    signingPublicKey: '',
    e2ePublicKey: '',
  });

  const sentMessages = [];
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  const originalSendSessionMessage = mpcService.sendSessionMessage;
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    fetchMessages: async () => ({
      messages: [{
        id: 'message-1',
        sessionId: 'session-1',
        from: '0x2222222222222222222222222222222222222222',
        to: '0x1111111111111111111111111111111111111111',
        round: 1,
        type: 'keygen.round1',
        payload: { commitment: 'c1' },
        createdAt: 2000,
      }],
      nextCursor: 'message-1',
    }),
  };
  mpcService.sendSessionMessage = async (message) => {
    sentMessages.push(message);
    return { message: { id: `sent-${sentMessages.length}`, ...message } };
  };
  setMpcTssEngineForTests({
    handleKeygenMessage: async ({ message, payload, participantId }) => {
      assert.equal(message.id, 'message-1');
      assert.deepEqual(payload, { commitment: 'c1' });
      assert.equal(participantId, '0x1111111111111111111111111111111111111111');
      return {
        messages: [{
          toParticipantId: '0x2222222222222222222222222222222222222222',
          round: 2,
          type: 'keygen.round2',
          payload: { response: 'r2' },
        }],
      };
    },
  });

  try {
    const result = await mpcService.fetchSessionMessages('session-1');

    assert.equal(result.messages.length, 1);
    assert.equal(result.processed.length, 1);
    assert.equal(result.processed[0].id, 'message-1');
    assert.ok(result.processed[0].processedAt);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].type, 'keygen.round2');
    assert.equal(sentMessages[0].toParticipantId, '0x2222222222222222222222222222222222222222');
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
    mpcService.sendSessionMessage = originalSendSessionMessage;
    resetMpcTssEngineForTests();
  }
});

test('listSignRequests 使用协调器业务接口并同步本地签名请求', async () => {
  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  const queries = [];
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    listSignRequests: async (query) => {
      queries.push(query);
      return {
        items: [{
          id: 'sign-request-1',
          walletId: 'mpc-wallet-1',
          sessionId: 'session-1',
          payloadType: 'message',
          payloadHash: 'hash-1',
          status: 'pending',
          createdAt: '1',
        }],
        page: { total: 1, page: 1, pageSize: 20 },
      };
    },
  };

  try {
    const result = await mpcService.listSignRequests({
      sessionId: 'session-1',
      status: 'pending',
    });

    assert.equal(queries.length, 1);
    assert.equal(queries[0].sessionId, 'session-1');
    assert.equal(queries[0].status, 'pending');
    assert.equal(result.items.length, 1);
    const stored = await getMpcSignRequest('sign-request-1');
    assert.equal(stored.status, 'pending');
    assert.equal(stored.payloadType, 'message');
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
  }
});

test('stream sign request 事件会同步本地签名请求', async () => {
  const originalProcessPending = mpcService.processPendingWireSignRequests;
  const processed = [];
  mpcService.processPendingWireSignRequests = async (options) => {
    processed.push(options);
    return { processed: [], count: 0 };
  };
  try {
    await mpcService._handleStreamEvent('session-1', {
      id: 'event-1',
      type: 'sign-request',
      data: {
        type: 'sign-request',
        sessionId: 'session-1',
        data: {
          id: 'sign-request-1',
          walletId: 'mpc-wallet-1',
          sessionId: 'session-1',
          payloadType: 'message',
          payloadHash: 'hash-1',
          status: 'pending',
          createdAt: '1',
        },
        timestamp: 2000,
      },
    });

    let stored = await getMpcSignRequest('sign-request-1');
    assert.equal(stored.status, 'pending');
    assert.equal(stored.payloadHash, 'hash-1');
    assert.deepEqual(processed, [{
      syncRemote: false,
      sessionId: 'session-1',
      requestId: 'sign-request-1',
    }]);

    await mpcService._handleStreamEvent('session-1', {
      id: 'event-2',
      type: 'sign-request-completed',
      data: {
        type: 'sign-request-completed',
        sessionId: 'session-1',
        data: {
          id: 'sign-request-1',
          status: 'completed',
          signature: '0xmpcsig',
          completedAt: '2',
        },
        timestamp: 3000,
      },
    });

    stored = await getMpcSignRequest('sign-request-1');
    assert.equal(stored.status, 'completed');
    assert.equal(stored.signature, '0xmpcsig');
    assert.equal(stored.walletId, 'mpc-wallet-1');
    assert.equal(processed.length, 1);
  } finally {
    mpcService.processPendingWireSignRequests = originalProcessPending;
  }
});

test('fetchSessionMessages 会把对端 sign 消息交给 TSS 引擎处理', async () => {
  await saveAccount({
    id: 'account-1',
    walletId: 'wallet-1',
    address: '0x1111111111111111111111111111111111111111',
  });
  await setSelectedAccountId('account-1');
  state.keyring = new Map([
    ['account-1', { signMessage: async (message) => `signed:${message}` }],
  ]);
  await saveMpcWallet({
    id: 'mpc-wallet-1',
    name: '团队金库',
    type: 'mpc',
    status: 'active',
    address: '0x9999999999999999999999999999999999999999',
    publicKey: '03abcdef',
    keygenSessionId: 'session-1',
    curve: 'secp256k1',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
    keyVersion: 1,
    shareVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcSession({
    id: 'session-1',
    name: '团队金库',
    type: 'keygen',
    walletId: 'mpc-wallet-1',
    status: 'completed',
    curve: 'secp256k1',
    threshold: 1,
    participants: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
    keyVersion: 1,
    shareVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
  });
  await saveMpcParticipant({
    id: '0x1111111111111111111111111111111111111111',
    sessionId: 'session-1',
    status: 'active',
    signingPublicKey: '',
    e2ePublicKey: '',
  });
  await saveMpcSignRequest({
    id: 'sign-request-1',
    walletId: 'mpc-wallet-1',
    sessionId: 'session-1',
    type: 'message',
    status: 'pending',
    payload: { message: 'hello' },
    keyVersion: 1,
    shareVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
  });

  const originalEnsure = mpcService._ensureCoordinatorToken;
  const originalCoordinator = mpcService._coordinator;
  const originalSendSessionMessage = mpcService.sendSessionMessage;
  const sentMessages = [];
  const completedRequests = [];
  mpcService._ensureCoordinatorToken = async () => ({ token: 'token' });
  mpcService._coordinator = {
    setEndpoint() {},
    fetchMessages: async () => ({
      messages: [{
        id: 'message-1',
        sessionId: 'session-1',
        from: '0x2222222222222222222222222222222222222222',
        to: '0x1111111111111111111111111111111111111111',
        round: 1,
        type: 'sign.round1',
        payload: { requestId: 'sign-request-1', partial: 'p1' },
        createdAt: 2000,
      }],
      nextCursor: 'message-1',
    }),
    completeSignRequest: async (requestId, payload, signature) => {
      completedRequests.push({ requestId, payload, signature });
      return {
        id: requestId,
        status: 'completed',
        signature: payload.signature,
        result: payload.result,
        completedAt: '3000',
      };
    },
  };
  mpcService.sendSessionMessage = async (message) => {
    sentMessages.push(message);
    return { message: { id: `sent-${sentMessages.length}`, ...message } };
  };
  setMpcTssEngineForTests({
    handleSignMessage: async ({ message, payload, signRequest, participantId }) => {
      assert.equal(message.id, 'message-1');
      assert.deepEqual(payload, { requestId: 'sign-request-1', partial: 'p1' });
      assert.equal(signRequest.id, 'sign-request-1');
      assert.equal(participantId, '0x1111111111111111111111111111111111111111');
      return {
        messages: [{
          toParticipantId: '0x2222222222222222222222222222222222222222',
          round: 2,
          type: 'sign.round2',
          payload: { partial: 'p2' },
        }],
        status: 'completed',
        signature: '0xmpcsig',
      };
    },
  });

  try {
    const result = await mpcService.fetchSessionMessages('session-1');

    assert.equal(result.messages.length, 1);
    assert.equal(result.processed.length, 1);
    assert.equal(result.processed[0].id, 'message-1');
    assert.ok(result.processed[0].processedAt);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].type, 'sign.round2');
    assert.deepEqual(sentMessages[0].payload, { partial: 'p2', requestId: 'sign-request-1' });
    assert.equal(completedRequests.length, 1);
    assert.equal(completedRequests[0].requestId, 'sign-request-1');
    assert.equal(completedRequests[0].payload.signature, '0xmpcsig');
    assert.equal(completedRequests[0].signature.signature.startsWith('signed:'), true);
    const signRequest = await getMpcSignRequest('sign-request-1');
    assert.equal(signRequest.status, 'completed');
    assert.equal(signRequest.signature, '0xmpcsig');
    assert.ok(signRequest.completedAt);
  } finally {
    mpcService._ensureCoordinatorToken = originalEnsure;
    mpcService._coordinator = originalCoordinator;
    mpcService.sendSessionMessage = originalSendSessionMessage;
    resetMpcTssEngineForTests();
  }
});
