import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './_helpers/dom-stub.js';
import { MpcSettingsController } from '../js/controller/setting/mpc-settings-controller.js';

test.afterEach(() => {
  delete globalThis.document;
});

test('renderCustodySettings keeps summary values unbolded and allows sync when enabled', () => {
  const { document, elements } = createDocument({
    custodyEnabledToggle: { tagName: 'input' },
    custodyEndpointInput: { tagName: 'input' },
    custodyStatusText: { tagName: 'span' },
    custodyPasskeyStatus: { tagName: 'span' },
    custodyRecordSummary: { tagName: 'span' },
    custodyLastSyncSummary: { tagName: 'span' },
    custodySyncBtn: { tagName: 'button' }
  });
  globalThis.document = document;
  const controller = new MpcSettingsController({ wallet: {} });

  controller.renderCustodySettings({
    enabled: true,
    lastStatus: { passkeyBound: false, recordCount: 0 }
  });

  assert.equal(elements.custodyPasskeyStatus.textContent, '尚未绑定');
  assert.equal(elements.custodySyncBtn.disabled, false);
  assert.equal(elements.custodySyncBtn.title, '立即同步托管数据');
});

test('handleCustodySync lets backend refresh passkey binding state', async () => {
  const { document, elements } = createDocument({
    globalToast: { tagName: 'div' },
    globalWaitingOverlay: { tagName: 'div', _classes: 'hidden' },
    custodyEnabledToggle: { tagName: 'input' },
    custodyEndpointInput: { tagName: 'input' },
    custodyStatusText: { tagName: 'span' },
    custodyPasskeyStatus: { tagName: 'span' },
    custodyRecordSummary: { tagName: 'span' },
    custodyLastSyncSummary: { tagName: 'span' },
    custodySyncBtn: { tagName: 'button' }
  });
  globalThis.document = document;
  let passwordRequested = false;
  let custodyEnabled = false;
  const controller = new MpcSettingsController({
    wallet: {
      enableCustody: async (input) => {
        custodyEnabled = true;
        assert.equal(input.password, 'password');
        assert.equal(input.forceRefresh, true);
        return { success: true, settings: { enabled: true, lastStatus: { passkeyBound: true, recordCount: 1 } } };
      }
    },
    requestPassword: async () => {
      passwordRequested = true;
      return 'password';
    }
  });
  controller.custodySettings = {
    enabled: true,
    lastStatus: { passkeyBound: false }
  };

  await controller.handleCustodySync();

  assert.equal(passwordRequested, true);
  assert.equal(custodyEnabled, true);
  assert.equal(elements.globalToast.textContent, '托管数据已同步');
});
