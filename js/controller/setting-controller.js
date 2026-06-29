import { BackupSyncSettingsController } from './setting/backup-sync-settings-controller.js';
import { MpcSettingsController } from './setting/mpc-settings-controller.js';
import { AuthorizedSitesController } from './setting/authorized-sites-controller.js';
import { AccountSettingsController } from './setting/account-settings-controller.js';

export class SettingController {
  constructor({ wallet, transaction, requestPassword }) {
    this.wallet = wallet;
    this.transaction = transaction;
    this.requestPassword = requestPassword;
    this.backupController = new BackupSyncSettingsController({ wallet, transaction, requestPassword });
    this.mpcController = new MpcSettingsController({ wallet, requestPassword });
    this.sitesController = new AuthorizedSitesController({ wallet });
    this.accountController = new AccountSettingsController({
      wallet,
      onClearAllAuthorizations: () => this.sitesController.handleClearAllAuthorizations()
    });
  }

  bindEvents() {
    this.backupController.bindEvents();
    this.mpcController.bindEvents();
    this.sitesController.bindEvents();
    this.accountController.bindEvents();
  }

  // ==================== 委托给子控制器（popup-controller 调用） ====================

  async loadAuthorizedSites() {
    return this.sitesController.loadAuthorizedSites();
  }

  async loadBackupSyncSettings() {
    return this.backupController.loadSettings();
  }

  async loadMpcSettings() {
    return this.mpcController.loadSettings();
  }

  async loadMpcSessions() {
    return this.mpcController.loadSessions();
  }
}