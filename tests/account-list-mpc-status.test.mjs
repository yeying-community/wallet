import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './_helpers/dom-stub.js';
import { AccountListController } from '../js/controller/account/account-list-controller.js';

test('账户管理为待 Keygen 的 MPC 钱包显示协作状态而不是暂无账户', () => {
  const { document, elements } = createDocument({ walletList: { tagName: 'div' } });
  globalThis.document = document;
  try {
    const controller = new AccountListController({ wallet: {} });
    controller.renderWalletList([{
      id: 'mpc-1',
      name: '家庭金库',
      type: 'mpc',
      status: 'keygen_pending',
      threshold: 2,
      participants: ['0x1', '0x2', '0x3'],
      accounts: [],
    }]);

    assert.match(elements.walletList.innerHTML, /MPC Wallet/);
    assert.match(elements.walletList.innerHTML, /等待参与者完成密钥生成/);
    assert.match(elements.walletList.innerHTML, /门限 2 \/ 3/);
    assert.doesNotMatch(elements.walletList.innerHTML, /暂无账户/);
  } finally {
    delete globalThis.document;
  }
});

test('MPC 钱包详情只请求并展示当前钱包的会话', async () => {
  const { document, elements } = createDocument({
    walletList: { tagName: 'div' },
    mpcWalletDetailModal: { tagName: 'div', _classes: 'hidden' },
    mpcWalletDetailName: { tagName: 'h3' },
    mpcWalletDetailStatus: { tagName: 'div' },
    mpcWalletDetailAddress: { tagName: 'div' },
    mpcWalletDetailThreshold: { tagName: 'div' },
    mpcWalletDetailParticipants: { tagName: 'div' },
    mpcWalletDetailSessions: { tagName: 'div' },
  });
  globalThis.document = document;
  const requestedWalletIds = [];
  try {
    const controller = new AccountListController({
      wallet: {
        getMpcSessions: async (walletId) => {
          requestedWalletIds.push(walletId);
          return {
            success: true,
            sessions: [{ id: 'session-keygen-1', type: 'keygen', status: 'active', round: 2 }],
          };
        },
      },
    });
    controller.renderWalletList([{
      id: 'mpc-1',
      name: '家庭金库',
      type: 'mpc',
      status: 'keygen_pending',
      threshold: 2,
      participants: ['0x1', '0x2', '0x3'],
      accounts: [],
    }]);

    await controller.openMpcWalletDetail('mpc-1');

    assert.deepEqual(requestedWalletIds, ['mpc-1']);
    assert.equal(elements.mpcWalletDetailName.textContent, '家庭金库');
    assert.equal(elements.mpcWalletDetailThreshold.textContent, '2 / 3');
    assert.match(elements.mpcWalletDetailSessions.innerHTML, /轮次 2/);
    assert.doesNotMatch(elements.mpcWalletDetailSessions.innerHTML, /暂无会话/);
  } finally {
    delete globalThis.document;
  }
});
