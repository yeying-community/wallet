import { showPage, getCurrentPage, getPageOrigin, showError } from '../common/ui/index.js';
import { WelcomeController } from './welcome-controller.js';
import { UnlockWalletController } from './wallet/unlock-wallet-controller.js';
import { WalletController } from './wallet/wallet-controller.js';
import { NetworkController } from './network-controller.js';
import { TokensListController } from './tokens/tokens-list-controller.js';
import { AddTokenController } from './tokens/add-token-controller.js';
import { AccountsListController, AccountDetailController, AccountModalsController } from './accounts/index.js';
import { SettingsController } from './settings-controller.js';
import { ImportWalletController } from './wallet/import-wallet-controller.js';
import { CreateWalletController } from './wallet/create-wallet-controller.js';

export class PopupController {
  constructor({ wallet, transaction, network, token }) {
    this.wallet = wallet;
    this.transaction = transaction;
    this.network = network;
    this.token = token;

    this.welcomeController = new WelcomeController();
    this.unlockWalletController = new UnlockWalletController({
      wallet: this.wallet,
      onUnlocked: () => this.refreshWalletData()
    });
    this.settingsController = new SettingsController({ wallet: this.wallet });
    this.walletController = new WalletController({
      wallet: this.wallet,
      transaction: this.transaction,
      network: this.network
    });
    this.tokensListController = new TokensListController({
      token: this.token,
      wallet: this.wallet,
      networkController: null
    });
    this.addTokenController = new AddTokenController({
      token: this.token,
      network: this.network,
      networkController: null,
      onTokenAdded: () => this.tokensListController.loadTokenBalances()
    });
    this.networkController = new NetworkController({
      network: this.network,
      onNetworkChanged: () => this.walletController.handleRefreshBalance()
    });
    this.tokensListController.setNetworkController(this.networkController);
    this.addTokenController.setNetworkController(this.networkController);
    this.accountsListController = null;
    this.accountDetailController = new AccountDetailController({
      wallet: this.wallet,
      onWalletListRefresh: () => this.accountsListController?.loadWalletList()
    });
    this.accountModalsController = new AccountModalsController({
      wallet: this.wallet,
      onWalletListRefresh: () => this.accountsListController?.loadWalletList(),
      onWalletUpdated: () => this.refreshWalletData(),
      onAccountSelected: (accountId) => this.accountsListController?.handleSelectAccount(accountId)
    });
    this.accountsListController = new AccountsListController({
      wallet: this.wallet,
      onWalletUpdated: () => this.refreshWalletData(),
      onOpenAccountDetails: (accountId) => this.accountDetailController.openAccountDetails(accountId),
      onOpenDeleteAccount: (accountId) => this.accountModalsController.openDeleteAccount(accountId),
      onOpenCreateAccount: (walletId) => this.accountModalsController.openCreateAccount(walletId),
      onViewMnemonic: (walletId) => this.accountModalsController.openMnemonic(walletId),
      onViewPrivateKey: (accountId) => this.accountModalsController.openPrivateKey(accountId),
      promptPassword: (options) => this.accountModalsController.promptPassword(options)
    });
    this.importWalletController = new ImportWalletController({
      wallet: this.wallet,
      onImportSuccess: () => this.refreshWalletData()
    });
    this.createWalletController = new CreateWalletController({
      wallet: this.wallet,
      onCreated: () => this.refreshWalletData()
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
      await this.refreshWalletData();
      return;
    }

    showPage('unlockPage');
  }

  bindEvents() {
    this.bindBackEvents();
    this.bindWalletPageEvents();

    this.welcomeController.bindEvents();
    this.unlockWalletController.bindEvents();
    this.walletController.bindEvents();
    this.tokensListController.bindEvents();
    this.addTokenController.bindEvents();
    this.networkController.bindEvents();
    this.accountsListController.bindEvents();
    this.accountDetailController.bindEvents();
    this.accountModalsController.bindEvents();
    this.settingsController.bindEvents();
    this.importWalletController.bindEvents();
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
    await this.accountsListController.loadWalletList();
  }

  async openSettingsPage() {
    showPage('settingsPage');
    await this.settingsController.loadAuthorizedSites();
  }

  async openTransferPage() {
    showPage('transferPage');
    await this.tokensListController?.prepareTransferSelectors?.();
  }

  async refreshWalletData() {
    await this.walletController.refreshWalletData();

    if (this.networkController) {
      await this.networkController.refreshNetworkState();
    }

    const tokensContent = document.getElementById('tokensContent');
    if (tokensContent && !tokensContent.classList.contains('hidden')) {
      await this.tokensListController?.loadTokenBalances?.();
    }
  }

  bindWalletPageEvents() {
    const accountHeader = document.getElementById('accountHeader');
    if (accountHeader) {
      accountHeader.addEventListener('click', async () => {
        await this.openAccountsPage();
      });
    }

    const transferBtn = document.getElementById('transferBtn');
    if (transferBtn) {
      transferBtn.addEventListener('click', async () => {
        await this.openTransferPage();
      });
    }

    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', async () => {
        await this.openSettingsPage();
      });
    }

    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
      sendBtn.addEventListener('click', async () => {
        const selectedToken = this.tokensListController?.getCurrentTransferToken?.();
        if (selectedToken && !selectedToken.isNative) {
          showError('暂不支持通证转账');
          return;
        }
        await this.walletController.handleSendTransaction({
          requestPassword: () => this.promptWalletPassword()
        });
      });
    }

    const collectiblesTab = document.getElementById('collectiblesTab');
    if (collectiblesTab) {
      collectiblesTab.addEventListener('click', () => {
        this.switchWalletTab('collectibles');
      });
    }

    const tokensTab = document.getElementById('tokensTab');
    if (tokensTab) {
      tokensTab.addEventListener('click', async () => {
        this.switchWalletTab('tokens');
        await this.tokensListController?.loadTokenBalances?.();
      });
    }

    const activityTab = document.getElementById('activityTab');
    if (activityTab) {
      activityTab.addEventListener('click', async () => {
        this.switchWalletTab('activity');
        await this.walletController.loadTransactionHistory();
      });
    }

  }

  switchWalletTab(tabId) {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.classList.remove('active');
    });
    const tabBtn = document.getElementById(`${tabId}Tab`);
    if (tabBtn) {
      tabBtn.classList.add('active');
    }

    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.add('hidden');
    });

    const targetContent = document.getElementById(`${tabId}Content`);
    if (targetContent) {
      targetContent.classList.remove('hidden');
      console.log(`[UI] 切换标签: ${tabId}`);
    }
  }

  async promptWalletPassword() {
    if (!this.accountModalsController?.promptPassword) {
      return null;
    }
    return await this.accountModalsController.promptPassword({
      title: '解锁钱包',
      confirmText: '确认',
      placeholder: '输入密码',
      onConfirm: async (input) => {
        if (!input || input.length < 8) {
          throw new Error('密码至少需要8位字符');
        }
      }
    });
  }
}
