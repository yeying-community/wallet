import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './_helpers/dom-stub.js';
import { UnlockWalletController } from '../js/controller/wallet/unlock-wallet-controller.js';

test('解锁成功后立即关闭全局遮罩，首页数据在后台刷新', async () => {
  const { document, elements } = createDocument({
    unlockPassword: { tagName: 'input', value: 'password123' },
    walletPage: { tagName: 'div', _classes: 'page hidden' },
  });
  globalThis.document = document;
  let finishRefresh;
  const refreshPending = new Promise(resolve => { finishRefresh = resolve; });

  try {
    const controller = new UnlockWalletController({
      wallet: {
        getCurrentAccount: async () => ({ id: 'account-1' }),
        unlock: async () => ({ success: true }),
      },
      onUnlocked: async () => await refreshPending,
    });

    await controller.handleUnlock();

    assert.equal(elements.walletPage.classList.contains('hidden'), false);
    assert.equal(elements.globalWaitingOverlay.classList.contains('hidden'), true);
    finishRefresh();
    await refreshPending;
  } finally {
    delete globalThis.document;
  }
});
