import { showPage, getCurrentPage, getPageOrigin } from './ui.js';
import { WelcomeController } from './welcome-controller.js';
import { UnlockController } from './unlock-controller.js';
import { WalletController } from './wallet-controller.js';
import { NetworkController } from './network-controller.js';
import { AccountsController } from './accounts-controller.js';
import { SettingsController } from './settings-controller.js';
import { ImportController } from './import-controller.js';
import { CreateWalletController } from './create-wallet-controller.js';

export class PopupController {
  constructor({ wallet, transaction, network }) {
    this.wallet = wallet;
    this.transaction = transaction;
    this.network = network;

    this.welcomeController = new WelcomeController();
    this.unlockController = new UnlockController({
      wallet: this.wallet,
      onUnlocked: () => this.walletController.refreshWalletData()
    });
    this.settingsController = new SettingsController({ wallet: this.wallet });
    this.walletController = new WalletController({
      wallet: this.wallet,
      transaction: this.transaction,
      network: this.network,
      networkController: null,
      onOpenAccounts: () => this.openAccountsPage(),
      onOpenSettings: () => this.openSettingsPage()
    });
    this.networkController = new NetworkController({
      network: this.network,
      wallet: this.wallet,
      onNetworkChanged: () => this.walletController.handleRefreshBalance(),
      onTokenAdded: () => this.walletController.refreshWalletData()
    });
    this.walletController.setNetworkController(this.networkController);
    this.accountsController = new AccountsController({
      wallet: this.wallet,
      onWalletUpdated: () => this.walletController.refreshWalletData()
    });
    this.importController = new ImportController({
      wallet: this.wallet,
      onImportSuccess: () => this.walletController.refreshWalletData()
    });
    this.createWalletController = new CreateWalletController({
      wallet: this.wallet,
      onCreated: () => this.walletController.refreshWalletData()
    });
  }

  async init() {
    await this.showInitialPage();
    this.bindEvents();
  }

  async showInitialPage() {
    const isInitialized = await this.wallet.isInitialized();

    if (!isInitialized) {
      showPage('welcomePage');
      return;
    }

    const state = await this.wallet.getWalletState();
    if (state && state.unlocked) {
      showPage('walletPage');
      await this.walletController.refreshWalletData();
      return;
    }

    showPage('unlockPage');
  }

  bindEvents() {
    this.bindBackEvents();

    this.welcomeController.bindEvents();
    this.unlockController.bindEvents();
    this.walletController.bindEvents();
    this.networkController.bindEvents();
    this.accountsController.bindEvents();
    this.settingsController.bindEvents();
    this.importController.bindEvents();
    this.createWalletController.bindEvents();
  }

  bindBackEvents() {
    document.querySelectorAll('.back-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleBackNavigation();
      });
    });
  }

  handleBackNavigation() {
    const currentPage = getCurrentPage();

    const backMap = {
      setPasswordPage: this.getSetPasswordBackTarget(),
      importPage: this.getImportBackTarget(),
      transferPage: 'walletPage',
      accountsPage: 'walletPage',
      networkManagePage: 'walletPage',
      networkFormPage: 'networkManagePage',
      tokenAddPage: 'walletPage',
      accountDetailPage: 'accountsPage',
      settingsPage: 'walletPage',
    };

    const targetPage = backMap[currentPage];
    if (targetPage) {
      showPage(targetPage);
      if (targetPage === 'networkManagePage') {
        this.networkController?.loadNetworkList();
      }
    } else {
      showPage('walletPage');
    }
  }

  getSetPasswordBackTarget() {
    const origin = getPageOrigin('setPasswordPage', 'welcome');
    return origin === 'accounts' ? 'accountsPage' : 'welcomePage';
  }

  getImportBackTarget() {
    const origin = getPageOrigin('importPage', 'welcome');
    return origin === 'accounts' ? 'accountsPage' : 'welcomePage';
  }

  async openAccountsPage() {
    showPage('accountsPage');
    await this.accountsController.loadWalletList();
  }

  async openSettingsPage() {
    showPage('settingsPage');
    await this.settingsController.loadAuthorizedSites();
  }
}
