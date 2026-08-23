import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './_helpers/dom-stub.js';
import { ApprovalController } from '../js/controller/approval-controller.js';
import { ApprovalMessageType } from '../js/protocol/extension-protocol.js';

function setupApprovalDom() {
  const { document, elements } = createDocument({
    approvalWaiting: { tagName: 'div', _classes: 'request-view hidden' },
    waitingTitle: { tagName: 'h2' },
    waitingDescription: { tagName: 'div' },
    waitingHint: { tagName: 'div' },
    waitingCloseButton: { tagName: 'button' },
    signRequest: { tagName: 'div', _classes: 'request-view' },
    transactionRequest: { tagName: 'div', _classes: 'request-view' },
    approveSign: { tagName: 'button' },
    approveTx: { tagName: 'button' },
    globalWaitingOverlay: { tagName: 'div', _classes: 'hidden' },
    globalToast: { tagName: 'div', _classes: 'hidden' },
  });
  globalThis.document = document;
  return elements;
}

function setupChrome(sendMessages) {
  globalThis.chrome = {
    runtime: {
      async sendMessage(message) {
        sendMessages.push(message);
        return { success: true };
      }
    }
  };
}

test.afterEach(() => {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.chrome;
});

test('MPC 消息签名确认后展示多签等待提示而不是立即关闭', async () => {
  const elements = setupApprovalDom();
  const sendMessages = [];
  let closed = false;
  globalThis.window = { close: () => { closed = true; } };
  setupChrome(sendMessages);

  const controller = new ApprovalController({
    wallet: {},
    transaction: {},
    network: {},
    token: {},
    requestId: 'request-1',
    requestType: 'sign',
    requestData: {
      accountId: 'mpc:wallet-1',
      origin: 'https://dapp.example'
    }
  });

  await controller.approveSign();

  assert.equal(closed, false);
  assert.equal(elements.approvalWaiting.classList.contains('hidden'), false);
  assert.equal(elements.waitingTitle.textContent, '签名已确认');
  assert.match(elements.waitingDescription.textContent, /等待其他成员确认/);
  assert.match(elements.waitingHint.textContent, /多签活动/);
  assert.deepEqual(sendMessages, [{
    type: ApprovalMessageType.APPROVAL_RESPONSE,
    requestId: 'request-1',
    approved: true
  }]);

  controller.dispose();
});

test('HD 消息签名确认后保持立即关闭', async () => {
  const elements = setupApprovalDom();
  const sendMessages = [];
  let closed = false;
  globalThis.window = { close: () => { closed = true; } };
  setupChrome(sendMessages);

  const controller = new ApprovalController({
    wallet: {},
    transaction: {},
    network: {},
    token: {},
    requestId: 'request-2',
    requestType: 'sign',
    requestData: {
      accountId: 'wallet-1',
      origin: 'https://dapp.example'
    }
  });

  await controller.approveSign();

  assert.equal(closed, true);
  assert.equal(elements.approvalWaiting.classList.contains('hidden'), true);
  assert.equal(sendMessages.length, 1);
});

test('MPC 交易确认后展示多签等待提示', async () => {
  const elements = setupApprovalDom();
  const sendMessages = [];
  let closed = false;
  globalThis.window = { close: () => { closed = true; } };
  setupChrome(sendMessages);

  const controller = new ApprovalController({
    wallet: {},
    transaction: {},
    network: {},
    token: {},
    requestId: 'request-3',
    requestType: 'transaction',
    requestData: {
      accountId: 'mpc:wallet-1',
      origin: 'https://dapp.example'
    }
  });

  await controller.approveTransaction();

  assert.equal(closed, false);
  assert.equal(elements.approvalWaiting.classList.contains('hidden'), false);
  assert.equal(elements.waitingTitle.textContent, '交易已确认');
  assert.match(elements.waitingDescription.textContent, /MPC 多方签名请求/);

  controller.dispose();
});
