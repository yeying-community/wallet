import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './_helpers/dom-stub.js';
import { AccountListController } from '../js/controller/account/account-list-controller.js';

test('账户管理按三行结构展示待 Keygen 的 MPC 钱包', () => {
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
    assert.match(elements.walletList.innerHTML, /等待密钥生成/);
    assert.match(elements.walletList.innerHTML, /门限 2 \/ 3 · 等待密钥生成/);
    assert.match(elements.walletList.innerHTML, /增加参与方/);
    assert.match(elements.walletList.innerHTML, /移除参与方/);
    assert.match(elements.walletList.innerHTML, /查看 MPC 钱包详情/);
    assert.doesNotMatch(elements.walletList.innerHTML, />查看详情<\/button>/);
    assert.doesNotMatch(elements.walletList.innerHTML, /暂无账户/);
  } finally {
    delete globalThis.document;
  }
});

test('账户管理把待处理 MPC 邀请展示为可接受的钱包卡片', () => {
  const { document, elements } = createDocument({ walletList: { tagName: 'div' } });
  globalThis.document = document;
  try {
    const controller = new AccountListController({ wallet: {} });
    controller.renderWalletList([], null, null, null, null, null, [{
      notificationUid: 'notification-1',
      subjectId: 'session-1',
      title: 'MPC 钱包创建邀请',
      actor: 'did:pkh:eth:0xabc',
      payload: {
        metadata: { walletName: '团队金库' },
        walletId: 'mpc-wallet-1',
        sessionId: 'session-1',
        threshold: 2,
        participants: ['a', 'b'],
      },
    }]);

    assert.match(elements.walletList.innerHTML, /MPC Wallet/);
    assert.match(elements.walletList.innerHTML, /团队金库/);
    assert.match(elements.walletList.innerHTML, /待接受邀请/);
    assert.match(elements.walletList.innerHTML, /接受邀请/);
    assert.match(elements.walletList.innerHTML, /mpc-invite-detail-btn/);
    assert.match(elements.walletList.innerHTML, /查看 MPC 钱包详情/);
    assert.match(elements.walletList.innerHTML, /data-mpc-invite-accept="notification-1"/);
    assert.doesNotMatch(elements.walletList.innerHTML, /暂无钱包/);
  } finally {
    delete globalThis.document;
  }
});

test('待接受 MPC 邀请详情图标打开邀请详情', () => {
  const { document, elements } = createDocument({
    walletList: { tagName: 'div' },
    mpcWalletDetailModal: { tagName: 'div', _classes: 'hidden' },
    mpcWalletDetailName: { tagName: 'h3' },
    mpcWalletDetailStatus: { tagName: 'div' },
    mpcWalletDetailAddress: { tagName: 'div' },
    mpcWalletDetailThreshold: { tagName: 'div' },
    mpcWalletDetailParticipants: { tagName: 'div' },
    mpcWalletDetailSessions: { tagName: 'div' },
    cancelMpcWalletCreationBtn: { tagName: 'button', _classes: 'hidden' },
    mpcWalletDetailFooter: { tagName: 'div', _classes: 'modal-footer' },
  });
  elements.cancelMpcWalletCreationBtn.closest = () => elements.mpcWalletDetailFooter;
  globalThis.document = document;
  try {
    const controller = new AccountListController({ wallet: {} });
    controller.pendingMpcInvites = [{
      notificationUid: 'notification-1',
      subjectId: '61705018-13b2-43e9-ab09-2698b64759f6',
      payload: {
        name: 'mcp10',
        walletId: 'mpc-wallet-1',
        sessionId: '61705018-13b2-43e9-ab09-2698b64759f6',
        threshold: 2,
        participants: ['0x1', '0x2'],
      },
      session: { status: 'created', round: 0 },
    }];

    controller.openMpcInviteDetail('notification-1');

    assert.equal(elements.mpcWalletDetailModal.classList.contains('hidden'), false);
    assert.equal(elements.mpcWalletDetailName.textContent, 'mcp10');
    assert.equal(elements.mpcWalletDetailStatus.textContent, '待接受邀请');
    assert.equal(elements.mpcWalletDetailThreshold.textContent, '2 / 2');
    assert.equal(elements.mpcWalletDetailParticipants.textContent, '0x1, 0x2');
    assert.match(elements.mpcWalletDetailSessions.innerHTML, /61705018-13b2-43e9-ab09-2698b64759f6/);
  } finally {
    delete globalThis.document;
  }
});

test('账户管理接受 MPC 邀请后刷新钱包列表和外层钱包状态', async () => {
  const { document } = createDocument({
    walletList: { tagName: 'div' },
    globalWaitingOverlay: { tagName: 'div', _classes: 'hidden' },
    globalToast: { tagName: 'div' },
  });
  globalThis.document = document;
  globalThis.window = { refreshWalletSelects: () => {} };
  let accepted = null;
  let walletListLoads = 0;
  let outerRefreshes = 0;
  try {
    const controller = new AccountListController({
      wallet: {
        getWalletList: async () => {
          walletListLoads += 1;
          return [];
        },
        listMpcInvites: async () => ({ success: true, items: [] }),
        acceptMpcInvite: async (input) => {
          accepted = input;
          return { success: true };
        },
      },
      promptPassword: async () => 'password123',
      onWalletUpdated: async () => {
        outerRefreshes += 1;
      },
    });
    controller.pendingMpcInvites = [{
      notificationUid: 'notification-1',
      subjectId: 'session-1',
      payload: {
        walletId: 'mpc-wallet-1',
        sessionId: 'session-1',
        participants: ['a', 'b'],
      },
    }];

    await controller.handleMpcInviteAccept('notification-1');

    assert.deepEqual(accepted, {
      notificationUid: 'notification-1',
      sessionId: 'session-1',
      walletId: 'mpc-wallet-1',
      payload: {
        walletId: 'mpc-wallet-1',
        sessionId: 'session-1',
        participants: ['a', 'b'],
      },
      password: 'password123',
    });
    assert.equal(walletListLoads, 1);
    assert.equal(outerRefreshes, 1);
  } finally {
    delete globalThis.document;
    delete globalThis.window;
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
    cancelMpcWalletCreationBtn: { tagName: 'button', _classes: 'hidden' },
    mpcWalletDetailFooter: { tagName: 'div', _classes: 'modal-footer' },
  });
  elements.cancelMpcWalletCreationBtn.closest = () => elements.mpcWalletDetailFooter;
  globalThis.document = document;
  const requestedWalletIds = [];
  try {
    const controller = new AccountListController({
      wallet: {
        getMpcSessions: async (walletId) => {
          requestedWalletIds.push(walletId);
          return {
            success: true,
            wallet: {
              id: 'mpc-1',
              name: '家庭金库',
              type: 'mpc',
              status: 'active',
              address: '0x1111111111111111111111111111111111111111',
              threshold: 2,
              participants: ['0x1', '0x2', '0x3'],
            },
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
    assert.equal(elements.mpcWalletDetailStatus.textContent, '可用');
    assert.equal(elements.mpcWalletDetailAddress.textContent, '0x1111111111111111111111111111111111111111');
    assert.equal(elements.mpcWalletDetailThreshold.textContent, '2 / 3');
    assert.equal(elements.cancelMpcWalletCreationBtn.classList.contains('hidden'), true);
    assert.equal(elements.mpcWalletDetailFooter.classList.contains('hidden'), true);
    assert.match(elements.mpcWalletDetailSessions.innerHTML, /轮次 2/);
    assert.doesNotMatch(elements.mpcWalletDetailSessions.innerHTML, /暂无会话/);
  } finally {
    delete globalThis.document;
  }
});

test('取消未完成 MPC 钱包创建会调用取消会话并刷新列表', async () => {
  const { document, elements } = createDocument({
    walletList: { tagName: 'div' },
    mpcWalletDetailModal: { tagName: 'div', _classes: 'hidden' },
    mpcWalletDetailName: { tagName: 'h3' },
    mpcWalletDetailStatus: { tagName: 'div' },
    mpcWalletDetailAddress: { tagName: 'div' },
    mpcWalletDetailThreshold: { tagName: 'div' },
    mpcWalletDetailParticipants: { tagName: 'div' },
    mpcWalletDetailSessions: { tagName: 'div' },
    cancelMpcWalletCreationBtn: { tagName: 'button', _classes: 'hidden' },
    mpcWalletDetailFooter: { tagName: 'div', _classes: 'modal-footer' },
    globalWaitingOverlay: { tagName: 'div', _classes: 'hidden' },
    globalToast: { tagName: 'div' },
  });
  elements.cancelMpcWalletCreationBtn.closest = () => elements.mpcWalletDetailFooter;
  globalThis.document = document;
  let cancelled = null;
  let refreshed = 0;
  try {
    const controller = new AccountListController({
      wallet: {
        getMpcSessions: async () => ({ success: true, sessions: [] }),
        cancelMpcSession: async (input) => {
          cancelled = input;
          return { success: true };
        },
      },
      promptPassword: async () => 'password123',
      onWalletUpdated: async () => {
        refreshed += 1;
      },
    });
    controller.renderWalletList([{
      id: 'mpc-1',
      name: '家庭金库',
      type: 'mpc',
      status: 'keygen_pending',
      keygenSessionId: 'session-keygen-1',
      threshold: 2,
      participants: ['0x1', '0x2', '0x3'],
      accounts: [],
    }]);
    await controller.openMpcWalletDetail('mpc-1');

    await controller.handleCancelMpcWalletCreation();

    assert.deepEqual(cancelled, {
      walletId: 'mpc-1',
      sessionId: 'session-keygen-1',
      password: 'password123',
    });
    assert.equal(refreshed, 1);
    assert.equal(elements.mpcWalletDetailModal.classList.contains('hidden'), true);
  } finally {
    delete globalThis.document;
  }
});
