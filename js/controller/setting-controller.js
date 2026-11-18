import { BackupSyncSettingsController } from './setting/backup-sync-settings-controller.js';
import { MpcSettingsController } from './setting/mpc-settings-controller.js';
import { AuthorizedSitesController } from './setting/authorized-sites-controller.js';
import { AccountSettingsController } from './setting/account-settings-controller.js';
import { WalletIdentitySettingsController } from './setting/wallet-identity-settings-controller.js';
import { getLocale, setLocale, SUPPORTED_LOCALES, t } from '../common/i18n/index.js';

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
    this.walletIdentityController = new WalletIdentitySettingsController({ wallet, transaction, requestPassword });
  }

  bindEvents() {
    this.bindLanguageEvents();
    this.backupController.bindEvents();
    this.mpcController.bindEvents();
    this.sitesController.bindEvents();
    this.accountController.bindEvents();
    this.walletIdentityController.bindEvents();
  }

  bindLanguageEvents() {
    const select = document.getElementById('languageSelect');
    if (!select) return;
    select.value = getLocale();
    select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        await setLocale(select.value);
        select.value = getLocale();
        globalThis.window?.refreshWalletSelects?.();
      } catch (error) {
        console.error('[i18n] language switch failed:', error);
        select.value = getLocale();
      } finally {
        select.disabled = false;
      }
    });
    for (const locale of SUPPORTED_LOCALES) {
      if (!select.querySelector(`option[value="${locale}"]`)) {
        const option = document.createElement('option');
        option.value = locale;
        option.textContent = t(`language.${locale}`);
        select.appendChild(option);
      }
    }
    select.value = getLocale();
  }

  // ==================== 委托给子控制器（popup-controller 调用） ====================

  async loadAuthorizedSites() {
    return this.sitesController.loadAuthorizedSites();
  }

  async loadBackupSyncSettings() {
    await this.walletIdentityController.load();
    return this.backupController.loadSettings();
  }

  async loadMpcSettings() {
    return this.mpcController.loadSettings();
  }

  async loadCustodySettings() {
    return this.mpcController.loadCustodySettings();
  }
}
