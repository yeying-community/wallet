import assert from 'node:assert/strict';
import test from 'node:test';

import { createDocument } from './_helpers/dom-stub.js';

const sessionData = {};
globalThis.chrome = {
  storage: {
    session: {
      async get(key) { return { [key]: sessionData[key] }; },
      async set(items) { Object.assign(sessionData, structuredClone(items)); },
      async remove(key) { delete sessionData[key]; },
    },
  },
};

const {
  POPUP_SESSION_STATE_KEY,
  POPUP_SESSION_TTL_MS,
  applyPopupSessionFields,
  buildPopupSessionState,
  clearPopupSessionState,
  loadPopupSessionState,
  savePopupSessionState,
} = await import('../js/common/ui/popup-session-state.js');

test.beforeEach(() => {
  for (const key of Object.keys(sessionData)) delete sessionData[key];
});

test('转账页面只保存白名单字段', async () => {
  const { document } = createDocument({
    recipientAddress: { tagName: 'input', value: '0x1234' },
    amount: { tagName: 'input', value: '2.5' },
    unlockPassword: { tagName: 'input', value: 'secret' },
  });
  const state = buildPopupSessionState('transferPage', document);
  assert.deepEqual(state.fields, { recipientAddress: '0x1234', amount: '2.5' });
  assert.equal('unlockPassword' in state.fields, false);

  await savePopupSessionState('transferPage', document);
  assert.equal(sessionData[POPUP_SESSION_STATE_KEY].fields.amount, '2.5');
});

test('恢复字段时忽略非当前页面字段和敏感字段', () => {
  const { document, elements } = createDocument({
    networkNameInput: { tagName: 'input', value: '' },
    networkRpcInput: { tagName: 'input', value: '' },
    ignoredField: { tagName: 'input', value: '' },
  });
  applyPopupSessionFields({
    pageId: 'networkFormPage',
    fields: {
      networkNameInput: 'Solana RPC',
      networkRpcInput: 'https://rpc.example',
      ignoredField: 'must-not-restore',
    },
  }, document);
  assert.equal(elements.networkNameInput.value, 'Solana RPC');
  assert.equal(elements.networkRpcInput.value, 'https://rpc.example');
  assert.equal(elements.ignoredField.value, '');
});

test('过期页面状态被删除，锁定时可显式清除', async () => {
  sessionData[POPUP_SESSION_STATE_KEY] = {
    version: 1,
    pageId: 'settingsPage',
    updatedAt: 1000,
    fields: {},
  };
  assert.equal(await loadPopupSessionState(1000 + POPUP_SESSION_TTL_MS + 1), null);
  assert.equal(sessionData[POPUP_SESSION_STATE_KEY], undefined);

  sessionData[POPUP_SESSION_STATE_KEY] = { version: 1 };
  await clearPopupSessionState();
  assert.equal(sessionData[POPUP_SESSION_STATE_KEY], undefined);
});
