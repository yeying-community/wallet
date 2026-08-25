import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createElement } from './_helpers/dom-stub.js';
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

test('账户管理把 ready 的 MPC 钱包展示为等待密钥生成', () => {
  const { document, elements } = createDocument({ walletList: { tagName: 'div' } });
  globalThis.document = document;
  try {
    const controller = new AccountListController({ wallet: {} });
    controller.renderWalletList([{
      id: 'mpc-1',
      name: 'mpc10',
      type: 'mpc',
      status: 'keygen_ready',
      threshold: 1,
      participants: ['0x1', '0x2'],
      accounts: [],
    }]);

    assert.match(elements.walletList.innerHTML, /门限 1 \/ 2 · 等待密钥生成/);
    assert.doesNotMatch(elements.walletList.innerHTML, /等待参与者完成密钥生成/);
  } finally {
    delete globalThis.document;
  }
});

test('账户管理把 rounds 的 MPC 钱包展示为密钥生成中', () => {
  const { document, elements } = createDocument({ walletList: { tagName: 'div' } });
  globalThis.document = document;
  try {
    const controller = new AccountListController({ wallet: {} });
    controller.renderWalletList([{
      id: 'mpc-1',
      name: 'mpc10',
      type: 'mpc',
      status: 'keygen_running',
      threshold: 1,
      participants: ['0x1', '0x2'],
      accounts: [],
    }]);

    assert.match(elements.walletList.innerHTML, /门限 1 \/ 2 · 密钥生成中/);
  } finally {
    delete globalThis.document;
  }
});

test('账户管理把 keygen completed 且签名未就绪的 MPC 钱包展示为签名准备中', () => {
  const { document, elements } = createDocument({ walletList: { tagName: 'div' } });
  globalThis.document = document;
  try {
    const controller = new AccountListController({ wallet: {} });
    controller.renderWalletList([{
      id: 'mpc-1',
      name: 'mpc10',
      type: 'mpc',
      status: 'keygen_completed',
      address: '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      threshold: 2,
      participants: ['0x1', '0x2'],
      accounts: [],
    }]);

    assert.match(elements.walletList.innerHTML, /门限 2 \/ 2 · 签名准备中/);
    assert.doesNotMatch(elements.walletList.innerHTML, /签名启用中/);
  } finally {
    delete globalThis.document;
  }
});

test('账户管理把 MPC 钱包地址缩短展示', () => {
  const { document, elements } = createDocument({ walletList: { tagName: 'div' } });
  globalThis.document = document;
  try {
    const controller = new AccountListController({ wallet: {} });
    controller.renderWalletList([{
      id: 'mpc-1',
      name: 'mpc10',
      type: 'mpc',
      status: 'active',
      address: '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      threshold: 2,
      participants: ['0x1', '0x2'],
      accounts: [],
    }]);

    assert.match(elements.walletList.innerHTML, /<div class="account-address">0x084A\.\.\.E630<\/div>/);
    assert.doesNotMatch(
      elements.walletList.innerHTML,
      /<div class="account-address">0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630<\/div>/
    );
  } finally {
    delete globalThis.document;
  }
});

test('账户管理给可用 MPC 钱包渲染账户详情入口', () => {
  const { document, elements } = createDocument({ walletList: { tagName: 'div' } });
  globalThis.document = document;
  try {
    const controller = new AccountListController({ wallet: {} });
    controller.renderWalletList([{
      id: 'mpc-1',
      name: 'mpc10',
      type: 'mpc',
      status: 'active',
      address: '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      threshold: 2,
      participants: ['0x1', '0x2'],
      accounts: [{
        id: 'mpc:mpc-1',
        name: 'mpc10',
        address: '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      }],
    }]);

    assert.match(elements.walletList.innerHTML, /data-primary-account-id="mpc:mpc-1"/);
    assert.match(elements.walletList.innerHTML, /data-account-id="mpc:mpc-1"/);
    assert.match(elements.walletList.innerHTML, /mpc-wallet-detail-btn/);
    assert.match(elements.walletList.innerHTML, /查看 MPC 钱包详情/);
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
        name: '团队金库',
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
    assert.match(elements.walletList.innerHTML, /拒绝邀请/);
    assert.match(elements.walletList.innerHTML, /mpc-invite-detail-btn/);
    assert.match(elements.walletList.innerHTML, /查看 MPC 钱包详情/);
    assert.match(elements.walletList.innerHTML, /data-mpc-invite-dismiss="notification-1"/);
    assert.match(elements.walletList.innerHTML, /data-mpc-invite-accept="notification-1"/);
    assert.doesNotMatch(elements.walletList.innerHTML, /暂无钱包/);
  } finally {
    delete globalThis.document;
  }
});

test('待接受 MPC 邀请详情图标打开邀请详情', () => {
  const { document, elements } = createDocument({
    accountsPage: { tagName: 'div', _classes: 'page' },
    mpcWalletDetailPage: { tagName: 'div', _classes: 'page hidden' },
    walletList: { tagName: 'div' },
    mpcWalletDetailName: { tagName: 'h3' },
    mpcWalletDetailStatus: { tagName: 'div' },
    mpcWalletDetailSigningStatus: { tagName: 'div' },
    mpcWalletDetailAddress: { tagName: 'div' },
    mpcWalletDetailThreshold: { tagName: 'div' },
    mpcWalletDetailParticipants: { tagName: 'div' },
    mpcWalletDetailSessions: { tagName: 'div' },
    cancelMpcWalletCreationBtn: { tagName: 'button', _classes: 'hidden' },
    prepareMpcWalletSigningBtn: { tagName: 'button', _classes: 'hidden' },
  });
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

    assert.equal(elements.mpcWalletDetailPage.classList.contains('hidden'), false);
    assert.equal(elements.accountsPage.classList.contains('hidden'), true);
    assert.equal(elements.mpcWalletDetailName.textContent, 'mcp10');
    assert.equal(elements.mpcWalletDetailStatus.textContent, '待接受邀请');
    assert.equal(elements.mpcWalletDetailSigningStatus.textContent, '不可签名');
    assert.equal(elements.mpcWalletDetailThreshold.textContent, '2 / 2');
    assert.match(elements.mpcWalletDetailParticipants.innerHTML, /mpc-participants-list/);
    assert.match(elements.mpcWalletDetailParticipants.innerHTML, /mpc-participant-item/);
    assert.match(elements.mpcWalletDetailParticipants.innerHTML, /0x1/);
    assert.match(elements.mpcWalletDetailParticipants.innerHTML, /0x2/);
    assert.doesNotMatch(elements.mpcWalletDetailParticipants.innerHTML, /0x1, 0x2/);
    assert.equal(elements.cancelMpcWalletCreationBtn.classList.contains('hidden'), false);
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
    accountsPage: { tagName: 'div', _classes: 'page' },
    mpcWalletDetailPage: { tagName: 'div', _classes: 'page hidden' },
    walletList: { tagName: 'div' },
    mpcWalletDetailName: { tagName: 'h3' },
    mpcWalletDetailStatus: { tagName: 'div' },
    mpcWalletDetailSigningStatus: { tagName: 'div' },
    mpcWalletDetailAddress: { tagName: 'div' },
    mpcWalletDetailThreshold: { tagName: 'div' },
    mpcWalletDetailParticipants: { tagName: 'div' },
    mpcWalletDetailSessions: { tagName: 'div' },
    cancelMpcWalletCreationBtn: { tagName: 'button', _classes: 'hidden' },
    prepareMpcWalletSigningBtn: { tagName: 'button', _classes: 'hidden' },
  });
  globalThis.document = document;
  const requestedWalletIds = [];
  try {
    const controller = new AccountListController({
      wallet: {
        getMpcSessions: async (walletId, options) => {
          requestedWalletIds.push(walletId);
          assert.deepEqual(options, { localOnly: true });
          return {
            success: true,
            wallet: {
              id: 'mpc-1',
              name: '家庭金库',
              type: 'mpc',
              status: 'active',
              signingStatus: 'available',
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
    assert.equal(elements.mpcWalletDetailPage.classList.contains('hidden'), false);
    assert.equal(elements.accountsPage.classList.contains('hidden'), true);
    assert.equal(elements.mpcWalletDetailName.textContent, '家庭金库');
    assert.equal(elements.mpcWalletDetailStatus.textContent, '已完成');
    assert.equal(elements.mpcWalletDetailSigningStatus.textContent, '可签名');
    assert.equal(elements.mpcWalletDetailAddress.textContent, '0x1111...1111');
    assert.equal(elements.mpcWalletDetailThreshold.textContent, '2 / 3');
    assert.equal(elements.cancelMpcWalletCreationBtn.classList.contains('hidden'), true);
    assert.match(elements.mpcWalletDetailSessions.innerHTML, /轮次 2/);
    assert.doesNotMatch(elements.mpcWalletDetailSessions.innerHTML, /暂无会话/);
  } finally {
    delete globalThis.document;
  }
});

test('MPC 钱包详情把签名材料缺失展示为短状态', () => {
  const { document, elements } = createDocument({
    mpcWalletDetailName: { tagName: 'h3' },
    mpcWalletDetailStatus: { tagName: 'div' },
    mpcWalletDetailSigningStatus: { tagName: 'div' },
    mpcWalletDetailAddress: { tagName: 'div' },
    mpcWalletDetailThreshold: { tagName: 'div' },
    mpcWalletDetailParticipants: { tagName: 'div' },
    mpcWalletDetailSessions: { tagName: 'div' },
    cancelMpcWalletCreationBtn: { tagName: 'button', _classes: 'hidden' },
    prepareMpcWalletSigningBtn: { tagName: 'button', _classes: 'hidden' },
  });
  globalThis.document = document;
  try {
    const controller = new AccountListController({ wallet: {} });
    controller.renderMpcWalletDetail({
      id: 'mpc-1',
      name: 'mpc10',
      type: 'mpc',
      status: 'keygen_completed',
      signingStatus: 'unavailable',
      signingUnavailableReason: 'MPC_COMPLETE_KEY_SHARE_NOT_FOUND',
      address: '0x1111111111111111111111111111111111111111',
      threshold: 2,
      participants: ['0x1', '0x2'],
    }, []);

    assert.equal(elements.mpcWalletDetailStatus.textContent, '签名准备中');
    assert.equal(elements.mpcWalletDetailSigningStatus.textContent, '准备中');
    assert.equal(elements.prepareMpcWalletSigningBtn.classList.contains('hidden'), false);
  } finally {
    delete globalThis.document;
  }
});

test('HD 钱包头部点击打开第一个账户详情', () => {
  const header = createElement({
    tagName: 'div',
    _classes: 'wallet-header',
    dataset: { primaryAccountId: 'account-1' },
  });
  const { document, elements } = createDocument({
    walletList: {
      tagName: 'div',
      children: [header],
    },
  });
  globalThis.document = document;
  const opened = [];
  try {
    const controller = new AccountListController({ wallet: {} });
    controller.bindWalletListEvents(
      (accountId) => opened.push(accountId),
      null,
      null,
      null,
      null
    );

    elements.walletList.children[0].dispatchEvent({ type: 'click' });

    assert.deepEqual(opened, ['account-1']);
  } finally {
    delete globalThis.document;
  }
});

test('MPC 钱包账户行点击打开账户详情，右上角详情图标打开 MPC 详情', async () => {
  const mpcItem = createElement({
    tagName: 'div',
    _classes: 'account-item mpc-wallet-identity',
    dataset: { walletId: 'mpc-1', accountId: 'mpc:mpc-1' },
  });
  const detailBtn = createElement({
    tagName: 'button',
    _classes: 'wallet-header-btn mpc-wallet-detail-btn',
    dataset: { walletId: 'mpc-1' },
  });
  const { document, elements } = createDocument({
    walletList: {
      tagName: 'div',
      children: [mpcItem, detailBtn],
    },
    mpcWalletDetailPage: { tagName: 'div', _classes: 'page hidden' },
    mpcWalletDetailName: { tagName: 'h3' },
    mpcWalletDetailStatus: { tagName: 'div' },
    mpcWalletDetailSigningStatus: { tagName: 'div' },
    mpcWalletDetailAddress: { tagName: 'div' },
    mpcWalletDetailThreshold: { tagName: 'div' },
    mpcWalletDetailParticipants: { tagName: 'div' },
    mpcWalletDetailSessions: { tagName: 'div' },
    cancelMpcWalletCreationBtn: { tagName: 'button', _classes: 'hidden' },
  });
  globalThis.document = document;
  const openedAccounts = [];
  try {
    const controller = new AccountListController({
      wallet: {
        getMpcSessions: async () => ({
          success: true,
          wallet: {
            id: 'mpc-1',
            name: 'mpc10',
            type: 'mpc',
            status: 'active',
            signingStatus: 'available',
            address: '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
            threshold: 2,
            participants: ['0x1', '0x2'],
          },
          sessions: [],
        }),
      },
    });
    controller.mpcWalletsById.set('mpc-1', {
      id: 'mpc-1',
      name: 'mpc10',
      type: 'mpc',
      status: 'active',
      address: '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      threshold: 2,
      participants: ['0x1', '0x2'],
    });
    controller.bindWalletListEvents(
      (accountId) => openedAccounts.push(accountId),
      null,
      null,
      null,
      null
    );

    elements.walletList.children[0].dispatchEvent({ type: 'click' });
    elements.walletList.children[1].dispatchEvent({ type: 'click' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(openedAccounts, ['mpc:mpc-1']);
    assert.equal(elements.mpcWalletDetailPage.classList.contains('hidden'), false);
  } finally {
    delete globalThis.document;
  }
});

test('取消未完成 MPC 钱包创建会调用取消会话并刷新列表', async () => {
  const { document, elements } = createDocument({
    accountsPage: { tagName: 'div', _classes: 'page' },
    mpcWalletDetailPage: { tagName: 'div', _classes: 'page hidden' },
    walletList: { tagName: 'div' },
    mpcWalletDetailName: { tagName: 'h3' },
    mpcWalletDetailStatus: { tagName: 'div' },
    mpcWalletDetailAddress: { tagName: 'div' },
    mpcWalletDetailThreshold: { tagName: 'div' },
    mpcWalletDetailParticipants: { tagName: 'div' },
    mpcWalletDetailSessions: { tagName: 'div' },
    cancelMpcWalletCreationBtn: { tagName: 'button', _classes: 'hidden' },
    globalWaitingOverlay: { tagName: 'div', _classes: 'hidden' },
    globalToast: { tagName: 'div' },
  });
  globalThis.document = document;
  let cancelled = null;
  let walletListLoads = 0;
  let refreshed = 0;
  try {
    const controller = new AccountListController({
      wallet: {
        getWalletList: async () => {
          walletListLoads += 1;
          return [];
        },
        listMpcInvites: async () => ({ success: true, items: [] }),
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
      status: 'keygen_running',
      keygenSessionId: 'session-keygen-1',
      threshold: 2,
      participants: ['0x1', '0x2', '0x3'],
      accounts: [],
    }]);
    await controller.openMpcWalletDetail('mpc-1');
    assert.equal(elements.cancelMpcWalletCreationBtn.classList.contains('hidden'), false);

    await controller.handleCancelMpcWalletCreation();

    assert.deepEqual(cancelled, {
      walletId: 'mpc-1',
      sessionId: 'session-keygen-1',
      password: 'password123',
    });
    assert.equal(walletListLoads, 1);
    assert.equal(refreshed, 1);
    assert.equal(elements.accountsPage.classList.contains('hidden'), false);
    assert.equal(elements.mpcWalletDetailPage.classList.contains('hidden'), true);
    assert.match(elements.walletList.innerHTML, /暂无钱包/);
    assert.equal(controller.mpcWalletsById.has('mpc-1'), false);
  } finally {
    delete globalThis.document;
  }
});

test('账户管理可从 MPC 钱包卡片删除已生成地址但不可用的钱包', async () => {
  const { document, elements } = createDocument({
    accountsPage: { tagName: 'div', _classes: 'page' },
    mpcWalletDetailPage: { tagName: 'div', _classes: 'page hidden' },
    walletList: { tagName: 'div' },
  });
  globalThis.document = document;
  let deleted = null;
  let walletListLoads = 0;
  let refreshed = 0;
  try {
    const controller = new AccountListController({
      wallet: {
        getWalletList: async () => {
          walletListLoads += 1;
          return [];
        },
        listMpcInvites: async () => ({ success: true, items: [] }),
        deleteMpcWallet: async (input) => {
          deleted = input;
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
      name: '坏的钱包',
      type: 'mpc',
      status: 'keygen_completed',
      signingStatus: 'unavailable',
      signingUnavailableReason: 'MPC_COMPLETE_KEY_SHARE_NOT_FOUND',
      address: '0x1234567890123456789012345678901234567890',
      keygenSessionId: 'session-keygen-1',
      threshold: 2,
      participants: ['0x1', '0x2'],
      accounts: [],
    }]);

    assert.match(elements.walletList.innerHTML, /mpc-wallet-delete-btn/);
    assert.match(elements.walletList.innerHTML, /data-wallet-id="mpc-1"/);

    await controller.handleDeleteMpcWallet('mpc-1');

    assert.deepEqual(deleted, {
      walletId: 'mpc-1',
      password: 'password123',
    });
    assert.equal(walletListLoads, 1);
    assert.equal(refreshed, 1);
    assert.match(elements.walletList.innerHTML, /暂无钱包/);
    assert.equal(controller.mpcWalletsById.has('mpc-1'), false);
  } finally {
    delete globalThis.document;
  }
});

test('重试 MPC 签名准备会调用钱包操作并刷新详情', async () => {
  const { document } = createDocument({
    walletList: { tagName: 'div' },
    mpcWalletDetailPage: { tagName: 'div', _classes: 'page' },
    mpcWalletDetailName: { tagName: 'h3' },
    mpcWalletDetailStatus: { tagName: 'div' },
    mpcWalletDetailSigningStatus: { tagName: 'div' },
    mpcWalletDetailAddress: { tagName: 'div' },
    mpcWalletDetailThreshold: { tagName: 'div' },
    mpcWalletDetailParticipants: { tagName: 'div' },
    mpcWalletDetailSessions: { tagName: 'div' },
    cancelMpcWalletCreationBtn: { tagName: 'button', _classes: 'hidden' },
    prepareMpcWalletSigningBtn: { tagName: 'button', _classes: 'hidden' },
    globalWaitingOverlay: { tagName: 'div', _classes: 'hidden' },
    globalToast: { tagName: 'div' },
  });
  globalThis.document = document;
  let prepareInput = null;
  let walletListLoads = 0;
  let refreshed = 0;
  let sessionRequest = null;
  try {
    const controller = new AccountListController({
      wallet: {
        prepareMpcWalletSigning: async (input) => {
          prepareInput = input;
          return {
            success: true,
            repaired: true,
            diagnosis: { canSign: true }
          };
        },
        getWalletList: async () => {
          walletListLoads += 1;
          return [];
        },
        listMpcInvites: async () => ({ success: true, items: [] }),
        getMpcSessions: async (walletId, options) => {
          sessionRequest = { walletId, options };
          throw new Error('加载超时');
        },
      },
      promptPassword: async () => 'password123',
      onWalletUpdated: async () => {
        refreshed += 1;
      },
    });
    controller.activeMpcWalletId = 'mpc-1';
    controller.mpcWalletsById.set('mpc-1', {
      id: 'mpc-1',
      name: 'mpc10',
      type: 'mpc',
      status: 'keygen_completed',
      signingStatus: 'unavailable',
      address: '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      threshold: 2,
      participants: ['0x1', '0x2'],
    });

    await controller.handlePrepareMpcWalletSigning();

    assert.deepEqual(prepareInput, {
      walletId: 'mpc-1',
      password: 'password123',
    });
    assert.equal(walletListLoads, 1);
    assert.equal(refreshed, 1);
    assert.deepEqual(sessionRequest, {
      walletId: 'mpc-1',
      options: { localOnly: true },
    });
    assert.doesNotMatch(document.getElementById('globalToast').textContent, /MPC 会话加载失败/);
    assert.match(document.getElementById('globalToast').textContent, /MPC 钱包签名能力已就绪/);
  } finally {
    delete globalThis.document;
  }
});

test('重试 MPC 签名准备超时时不会让等待层一直阻塞', async () => {
  const { document, elements } = createDocument({
    walletList: { tagName: 'div' },
    mpcWalletDetailPage: { tagName: 'div', _classes: 'page' },
    mpcWalletDetailName: { tagName: 'h3' },
    mpcWalletDetailStatus: { tagName: 'div' },
    mpcWalletDetailSigningStatus: { tagName: 'div' },
    mpcWalletDetailAddress: { tagName: 'div' },
    mpcWalletDetailThreshold: { tagName: 'div' },
    mpcWalletDetailParticipants: { tagName: 'div' },
    mpcWalletDetailSessions: { tagName: 'div' },
    cancelMpcWalletCreationBtn: { tagName: 'button', _classes: 'hidden' },
    prepareMpcWalletSigningBtn: { tagName: 'button', _classes: 'hidden' },
    globalWaitingOverlay: { tagName: 'div', _classes: 'hidden' },
    globalToast: { tagName: 'div' },
  });
  globalThis.document = document;
  const originalSetTimeout = globalThis.setTimeout;
  try {
    globalThis.setTimeout = (fn) => {
      queueMicrotask(fn);
      return 1;
    };
    const controller = new AccountListController({
      wallet: {
        prepareMpcWalletSigning: async () => new Promise(() => {}),
        getWalletList: async () => [],
        listMpcInvites: async () => ({ success: true, items: [] }),
        getMpcSessions: async () => ({ success: true, sessions: [] }),
      },
      promptPassword: async () => 'password123',
      onWalletUpdated: async () => {},
    });
    controller.activeMpcWalletId = 'mpc-1';
    controller.mpcWalletsById.set('mpc-1', {
      id: 'mpc-1',
      name: 'mpc10',
      type: 'mpc',
      status: 'keygen_completed',
      signingStatus: 'unavailable',
      address: '0x084A6171f6eCf0A4C8fA1C88ce53Cf725a23E630',
      threshold: 2,
      participants: ['0x1', '0x2'],
    });

    await controller.handlePrepareMpcWalletSigning();

    assert.equal(elements.globalWaitingOverlay.classList.contains('hidden'), true);
    assert.match(elements.globalToast.textContent, /签名准备已启动/);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    delete globalThis.document;
  }
});

test('拒绝未接受 MPC 邀请会忽略邀请并刷新列表', async () => {
  const { document, elements } = createDocument({
    accountsPage: { tagName: 'div', _classes: 'page' },
    mpcWalletDetailPage: { tagName: 'div', _classes: 'page' },
    walletList: { tagName: 'div' },
    globalWaitingOverlay: { tagName: 'div', _classes: 'hidden' },
    globalToast: { tagName: 'div' },
  });
  globalThis.document = document;
  let dismissed = null;
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
        dismissMpcInvite: async (input) => {
          dismissed = input;
          return { success: true };
        },
      },
      onWalletUpdated: async () => {
        outerRefreshes += 1;
      },
    });
    controller.pendingMpcInvites = [{
      uid: 'item-1',
      notificationUid: 'notification-1',
      subjectId: 'session-1',
      payload: {
        name: '团队金库',
        walletId: 'mpc-wallet-1',
        sessionId: 'session-1',
        participants: ['a', 'b'],
      },
    }];
    controller.activeMpcInviteId = 'notification-1';

    await controller.handleMpcInviteDismiss('notification-1');

    assert.deepEqual(dismissed, {
      notificationUid: 'notification-1',
      uid: 'item-1',
      subjectId: 'session-1',
      sessionId: 'session-1',
      walletId: 'mpc-wallet-1',
      payload: {
        name: '团队金库',
        walletId: 'mpc-wallet-1',
        sessionId: 'session-1',
        participants: ['a', 'b'],
      },
    });
    assert.equal(walletListLoads, 1);
    assert.equal(outerRefreshes, 1);
    assert.equal(controller.activeMpcInviteId, '');
    assert.equal(elements.accountsPage.classList.contains('hidden'), false);
    assert.equal(elements.mpcWalletDetailPage.classList.contains('hidden'), true);
  } finally {
    delete globalThis.document;
  }
});
