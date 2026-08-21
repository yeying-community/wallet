import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './_helpers/dom-stub.js';
import { MpcSettingsController } from '../js/controller/setting/mpc-settings-controller.js';

function setup() {
  const { document, elements } = createDocument({
    mpcInvitesList: { tagName: 'div' },
    mpcLogsList: { tagName: 'div' },
    mpcLogsTotal: { tagName: 'div' },
    globalWaitingOverlay: { tagName: 'div', _classes: 'hidden' },
    globalToast: { tagName: 'div' },
  });
  globalThis.document = document;
  globalThis.window = {
    refreshWalletSelects: () => {},
  };
  return elements;
}

test.afterEach(() => {
  delete globalThis.document;
  delete globalThis.window;
});

test('loadMpcInvites 渲染待处理 MPC 邀请', async () => {
  const elements = setup();
  const controller = new MpcSettingsController({
    wallet: {
      listMpcInvites: async () => ({
        success: true,
        items: [{
          notificationUid: 'notification-1',
          title: 'MPC 钱包创建邀请',
          subjectId: 'session-1',
          payload: {
            name: '团队金库',
            sessionId: 'session-1',
            walletId: 'wallet-1',
            threshold: 2,
            participants: ['0x111', '0x222'],
            inviter: '0x111',
          },
        }],
      }),
    },
    requestPassword: async () => 'password123',
  });

  await controller.loadMpcInvites(false);

  assert.equal(controller.mpcInvites.length, 1);
  assert.match(elements.mpcInvitesList.innerHTML, /data-mpc-invite-accept/);
  assert.match(elements.mpcInvitesList.innerHTML, /mpc-invite-item/);
  assert.match(elements.mpcInvitesList.innerHTML, /团队金库/);
});

test('handleMpcInviteAccept 使用通知 payload 接受邀请', async () => {
  setup();
  let accepted = null;
  let auditLoaded = false;
  const controller = new MpcSettingsController({
    wallet: {
      acceptMpcInvite: async (input) => {
        accepted = input;
        return { success: true };
      },
      listMpcInvites: async () => ({ success: true, items: [] }),
      getMpcAuditLogs: async () => {
        auditLoaded = true;
        return { logs: [] };
      },
    },
    requestPassword: async () => 'password123',
  });
  controller.mpcInvites = [{
    notificationUid: 'notification-1',
    subjectId: 'session-1',
    payload: {
      name: '团队金库',
      sessionId: 'session-1',
      walletId: 'wallet-1',
      participants: ['0x111', '0x222'],
    },
  }];

  await controller.handleMpcInviteAccept('notification-1');

  assert.deepEqual(accepted, {
    notificationUid: 'notification-1',
    sessionId: 'session-1',
    walletId: 'wallet-1',
    payload: {
      name: '团队金库',
      sessionId: 'session-1',
      walletId: 'wallet-1',
      participants: ['0x111', '0x222'],
    },
    password: 'password123',
  });
  assert.equal(auditLoaded, true);
});

test('renderMpcLogsList 会展示 MPC 签名请求活动', async () => {
  const elements = setup();
  const controller = new MpcSettingsController({
    wallet: {},
    requestPassword: async () => 'password123',
  });
  controller.mpcSignRequests = [{
    id: 'sign-request-1',
    walletId: 'mpc-wallet-1',
    sessionId: 'session-1',
    payloadType: 'message',
    payloadHash: '0x1234567890abcdef1234',
    status: 'pending',
    createdAt: '1787270000000',
  }];
  controller.mpcLogs = [];

  controller.renderMpcLogsList();
  controller.updateMpcLogsSummary();

  assert.match(elements.mpcLogsList.innerHTML, /消息签名请求/);
  assert.match(elements.mpcLogsList.innerHTML, /待处理/);
  assert.match(elements.mpcLogsList.innerHTML, /0x12345678/);
  assert.equal(elements.mpcLogsTotal.textContent, '1');
});
