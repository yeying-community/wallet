import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './_helpers/dom-stub.js';
import { BackupSyncSettingsController } from '../js/controller/setting/backup-sync-settings-controller.js';

test('同步冲突只通过标题行按钮进入，清零后按钮和弹窗隐藏', () => {
  const { document, elements } = createDocument({
    backupSyncConflictBtn: { tagName: 'button', _classes: 'hidden' },
    backupSyncConflictModal: { tagName: 'div', _classes: 'modal hidden' },
    backupSyncConflictsList: { tagName: 'div' },
  });
  globalThis.document = document;
  try {
    const controller = new BackupSyncSettingsController({ wallet: {}, transaction: {}, requestPassword: null });
    const conflicts = [{
      id: 'account:a1:1',
      type: 'account',
      index: 0,
      localName: '本地账户',
      remoteName: '远端账户',
      timestamp: 1,
    }];
    controller.syncSettings = { conflicts };
    controller.renderBackupSyncConflicts(conflicts);

    assert.equal(elements.backupSyncConflictBtn.classList.contains('hidden'), false);
    assert.equal(elements.backupSyncConflictBtn.textContent, '冲突 1');
    controller.openBackupSyncConflictModal();
    assert.equal(elements.backupSyncConflictModal.classList.contains('hidden'), false);

    controller.renderBackupSyncConflicts([]);
    assert.equal(elements.backupSyncConflictBtn.classList.contains('hidden'), true);
    assert.equal(elements.backupSyncConflictModal.classList.contains('hidden'), true);
    assert.equal(elements.backupSyncConflictsList.innerHTML, '');
  } finally {
    delete globalThis.document;
  }
});
