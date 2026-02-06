import { showPage, getCurrentPage, getPageOrigin, showError } from '../common/ui/index.js';
import { formatLocaleDateTime } from '../common/utils/time-utils.js';
import { POLLING_CONFIG } from '../config/index.js';
import { WelcomeController } from './welcome-controller.js';
import { UnlockWalletController } from './wallet/unlock-wallet-controller.js';
import { NetworkController } from './network-controller.js';
import { TokensListController } from './tokens/tokens-list-controller.js';
import { AddTokenController } from './tokens/add-token-controller.js';
import {
  AccountsListController,
  AccountDetailController,
  AccountModalsController,
  AccountHeaderController
} from './accounts/index.js';
import { TokenBalanceController } from './tokens/index.js';
import { SettingsController } from './settings-controller.js';
import { ContactsController } from './contacts-controller.js';
import { ImportWalletController } from './wallet/import-wallet-controller.js';
import { CreateWalletController } from './wallet/create-wallet-controller.js';
import {
  TransactionListController,
  TransactionDetailController,
  TransactionSendController
} from './transaction/index.js';
import { NetworkStorageKeys, SettingsStorageKeys, onStorageChanged } from '../storage/index.js';

export class PopupController {
  constructor({ wallet, transaction, network, token }) {
    this.wallet = wallet;
    this.transaction = transaction;
    this.network = network;
    this.token = token;
    this.transactionPollingTimer = null;
    this.storageUnsubscribe = null;

    this.welcomeController = new WelcomeController();
    this.unlockWalletController = new UnlockWalletController({
      wallet: this.wallet,
      onUnlocked: () => this.refreshWalletData()
    });
    this.settingsController = new SettingsController({
      wallet: this.wallet,
      transaction: this.transaction,
      requestPassword: () => this.promptWalletPassword()
    });
    this.contactsController = new ContactsController({ wallet: this.wallet });
    this.transactionDetailController = new TransactionDetailController({
      transaction: this.transaction,
      network: this.network
    });
    this.transactionListController = new TransactionListController({
      wallet: this.wallet,
      transaction: this.transaction,
      network: this.network,
      detailController: this.transactionDetailController
    });
    this.accountHeaderController = new AccountHeaderController({
      wallet: this.wallet
    });
    this.tokenBalanceController = new TokenBalanceController({
      wallet: this.wallet
    });
    this.transactionSendController = new TransactionSendController({
      wallet: this.wallet,
      transaction: this.transaction,
      network: this.network,
      balanceController: this.tokenBalanceController,
      transactionListController: this.transactionListController
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
      onNetworkChanged: () => this.handleNetworkChanged()
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
    await this.networkController?.prefillNetworkLabels?.();
    await this.networkController?.syncSelectedNetwork?.();
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
    this.renderUnlockReason(state?.lastUnlockRequest || null);
  }

  renderUnlockReason(info) {
    const container = document.getElementById('unlockReason');
    if (!container) return;

    const originEl = document.getElementById('unlockReasonOrigin');
    const methodEl = document.getElementById('unlockReasonMethod');
    const timeEl = document.getElementById('unlockReasonTime');

    if (!info || (!info.origin && !info.method && !info.timestamp)) {
      container.classList.add('hidden');
      return;
    }

    if (originEl) originEl.textContent = info.origin || '-';
    if (methodEl) methodEl.textContent = info.method || '-';
    if (timeEl) {
      timeEl.textContent = info.timestamp ? formatLocaleDateTime(info.timestamp) : '-';
    }
    container.classList.remove('hidden');
  }

  bindEvents() {
    this.bindBackEvents();
    this.bindWalletPageEvents();
    this.bindStorageEvents();

    this.welcomeController.bindEvents();
    this.unlockWalletController.bindEvents();
    this.transactionListController.bindEvents();
    this.transactionDetailController.bindEvents();
    this.tokensListController.bindEvents();
    this.addTokenController.bindEvents();
    this.networkController.bindEvents();
    this.accountsListController.bindEvents();
    this.accountDetailController.bindEvents();
    this.accountModalsController.bindEvents();
    this.settingsController.bindEvents();
    this.contactsController.bindEvents();
    this.importWalletController.bindEvents();
    this.createWalletController.bindEvents();
  }

  bindStorageEvents() {
    if (this.storageUnsubscribe) return;
    this.storageUnsubscribe = onStorageChanged(async (changes, areaName) => {
      if (areaName && areaName !== 'local') return;
      if (!changes) return;
      if (changes[NetworkStorageKeys.SELECTED_NETWORK]) {
        await this.networkController?.syncSelectedNetwork?.();
        await this.networkController?.refreshNetworkState?.();
        await this.handleNetworkChanged();
      }
      if (changes[SettingsStorageKeys.USER_SETTINGS]) {
        await this.updateBackupSyncStatus();
      }
      if (getCurrentPage() === 'walletPage') {
        const activityContent = document.getElementById('activityContent');
        if (activityContent && !activityContent.classList.contains('hidden')) {
          await this.transactionListController.loadTransactions();
        }
      }
    });
  }

  async updateBackupSyncStatus() {
    const badge = document.getElementById('backupSyncStatusBadge');
    if (!badge) return;

    try {
      const settings = await this.wallet.getBackupSyncSettings();
      const enabled = Boolean(settings?.enabled);
      const conflicts = Array.isArray(settings?.conflicts) ? settings.conflicts : [];
      const authMode = settings?.authMode || 'siwe';
      const hasAuth = authMode === 'basic'
        ? Boolean(settings?.basicAuth)
        : authMode === 'ucan'
          ? Boolean(settings?.ucanToken)
          : Boolean(settings?.authToken);

      let statusText = '同步状态未知';
      if (!enabled) {
        statusText = '同步已关闭';
        badge.className = 'sync-status-badge disabled';
      } else if (conflicts.length > 0) {
        statusText = `同步冲突 ${conflicts.length}`;
        badge.className = 'sync-status-badge danger';
      } else if (!hasAuth) {
        statusText = '同步未登录';
        badge.className = 'sync-status-badge warning';
      } else {
        statusText = '同步已开启';
        badge.className = 'sync-status-badge success';
      }

      const pullText = settings?.lastPullAt ? formatLocaleDateTime(settings.lastPullAt) : '-';
      const pushText = settings?.lastPushAt ? formatLocaleDateTime(settings.lastPushAt) : '-';
      badge.title = `${statusText} · 最近拉取: ${pullText} · 最近推送: ${pushText}`;
      badge.setAttribute('aria-label', statusText);
    } catch (error) {
      badge.className = 'sync-status-badge';
      badge.title = '同步状态未知';
      badge.setAttribute('aria-label', '同步状态未知');
    }
  }

  bindBackEvents() {
    document.querySelectorAll('.back-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleBackNavigation();
      });
    });
  }

  async handleBackNavigation() {
    const currentPage = getCurrentPage();

    if (currentPage === 'transactionDetailPage') {
      showPage('walletPage');
      this.switchWalletTab('activity');
      await this.transactionListController.loadTransactions();
      this.transactionListController.restoreActivityScrollPosition();
      return;
    }

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
      contactsPage: 'walletPage',
      sitesPage: 'walletPage',
      backupSyncLogsPage: 'settingsPage',
      mpcLogsPage: 'settingsPage',
    };

    const targetPage = backMap[currentPage];
    if (targetPage) {
      showPage(targetPage);
      if (targetPage === 'networkManagePage') {
        await this.networkController?.loadNetworkList();
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
    this.stopTransactionPolling();
    showPage('accountsPage');
    await this.accountsListController.loadWalletList();
  }

  async openSettingsPage() {
    this.stopTransactionPolling();
    showPage('settingsPage');
    await this.settingsController.loadBackupSyncSettings();
    await this.settingsController.loadMpcSettings();
    await this.settingsController.loadMpcSessions();
  }

  async openBackupSyncSettings() {
    await this.openSettingsPage();
    requestAnimationFrame(() => {
      const section = document.getElementById('backupSyncSection');
      if (section?.scrollIntoView) {
        section.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    });
  }

  async openSitesPage() {
    this.stopTransactionPolling();
    showPage('sitesPage');
    const searchInput = document.getElementById('siteSearchInput');
    if (searchInput) {
      searchInput.value = '';
    }
    await this.settingsController.loadAuthorizedSites();
  }

  async openContactsPage() {
    this.stopTransactionPolling();
    showPage('contactsPage');
    await this.contactsController.loadContacts();
  }

  async openTransferPage() {
    this.stopTransactionPolling();
    showPage('transferPage');
    await this.tokensListController?.prepareTransferSelectors?.();
    await this.contactsController?.loadContacts?.();
  }

  async refreshWalletData() {
    await this.accountHeaderController?.refreshHeader?.();
    await this.tokenBalanceController?.refreshBalanceSilently?.();

    if (this.networkController) {
      await this.networkController.refreshNetworkState();
    }

    await this.updateBackupSyncStatus();

    const tokensContent = document.getElementById('tokensContent');
    if (tokensContent && !tokensContent.classList.contains('hidden')) {
      await this.tokensListController?.loadTokenBalances?.();
    }
  }

  startTransactionPolling() {
    this.stopTransactionPolling();
    const interval = POLLING_CONFIG?.TRANSACTION || 5000;
    this.transactionPollingTimer = setInterval(async () => {
      if (getCurrentPage() !== 'walletPage') return;
      const activityContent = document.getElementById('activityContent');
      if (!activityContent || activityContent.classList.contains('hidden')) return;
      await this.transactionListController.loadTransactions();
    }, interval);
  }

  stopTransactionPolling() {
    if (!this.transactionPollingTimer) return;
    clearInterval(this.transactionPollingTimer);
    this.transactionPollingTimer = null;
  }

  async handleNetworkChanged() {
    await this.accountHeaderController?.refreshHeader?.();
    await this.tokenBalanceController?.refreshBalanceSilently?.();
    await this.tokensListController?.loadTokenBalances?.();
  }

  bindWalletPageEvents() {
    const accountDropdownBtn = document.getElementById('accountDropdownBtn');
    if (accountDropdownBtn) {
      accountDropdownBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        await this.openAccountsPage();
      });
    }

    const syncBadge = document.getElementById('backupSyncStatusBadge');
    if (syncBadge) {
      syncBadge.addEventListener('click', async (event) => {
        event.preventDefault();
        await this.openBackupSyncSettings();
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

    const sitesManageBtn = document.getElementById('sitesManageBtn');
    if (sitesManageBtn) {
      sitesManageBtn.addEventListener('click', async () => {
        await this.openSitesPage();
      });
    }

    const contactsBtn = document.getElementById('contactsBtn');
    if (contactsBtn) {
      contactsBtn.addEventListener('click', async () => {
        await this.openContactsPage();
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
        await this.transactionSendController.handleSendTransaction({
          requestPassword: () => this.promptWalletPassword(),
          silentBalanceRefresh: true,
          onSuccess: async () => {
            showPage('walletPage');
            this.switchWalletTab('activity');
          }
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
        await this.transactionListController.loadTransactions();
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

    if (tabId === 'activity') {
      this.startTransactionPolling();
    } else {
      this.stopTransactionPolling();
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
