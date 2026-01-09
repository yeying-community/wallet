import { isValidAddress, shortenAddress, normalizeChainId } from '../common/utils/index.js';
import { getNetworkByChainId } from '../config/index.js';
import {
  showPage,
  showStatus,
  clearStatus,
  showError,
  showSuccess,
  copyToClipboard,
  updateAccountInfo,
  updateBalance,
  switchTab,
  promptPassword
} from './ui.js';

export class WalletController {
  constructor({ wallet, transaction, network, networkController, onOpenAccounts, onOpenSettings }) {
    this.wallet = wallet;
    this.transaction = transaction;
    this.network = network;
    this.networkController = networkController || null;
    this.onOpenAccounts = onOpenAccounts;
    this.onOpenSettings = onOpenSettings;
    this.lastTokenList = [];
    this.transferTokenMap = new Map();
    this.currentTransferToken = null;
    this.boundTokenDocClick = false;
  }

  setNetworkController(controller) {
    this.networkController = controller;
  }

  bindEvents() {
    this.bindTabSwitchEvents();

    const accountHeader = document.getElementById('accountHeader');
    if (accountHeader) {
      accountHeader.addEventListener('click', async () => {
        await this.handleOpenAccounts();
      });
    }

    const transferBtn = document.getElementById('transferBtn');
    if (transferBtn) {
      transferBtn.addEventListener('click', async () => {
        await this.handleOpenTransfer();
      });
    }

    const refreshBtn = document.getElementById('refreshBalanceBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        await this.handleRefreshBalance();
      });
    }

    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
      sendBtn.addEventListener('click', async () => {
        await this.handleSendTransaction();
      });
    }

    this.bindTransferTokenSelector();

    const showPrivateKeyBtn = document.getElementById('showPrivateKeyBtn');
    if (showPrivateKeyBtn) {
      showPrivateKeyBtn.addEventListener('click', async () => {
        await this.handleShowPrivateKey();
      });
    }

    const copyPrivateKeyBtn = document.getElementById('copyPrivateKeyBtn');
    if (copyPrivateKeyBtn) {
      copyPrivateKeyBtn.addEventListener('click', async () => {
        const privateKey = document.getElementById('privateKeyValue').value;
        await copyToClipboard(privateKey, '私钥已复制');
      });
    }

    const showMnemonicBtn = document.getElementById('showMnemonicBtn');
    if (showMnemonicBtn) {
      showMnemonicBtn.addEventListener('click', async () => {
        await this.handleShowMnemonic();
      });
    }

    const copyMnemonicBtn = document.getElementById('copyMnemonicBtn');
    if (copyMnemonicBtn) {
      copyMnemonicBtn.addEventListener('click', async () => {
        const mnemonic = document.getElementById('mnemonicValue').value;
        await copyToClipboard(mnemonic, '助记词已复制');
      });
    }

    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', async () => {
        await this.handleOpenSettings();
      });
    }

    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    if (clearHistoryBtn) {
      clearHistoryBtn.addEventListener('click', async () => {
        await this.handleClearHistory();
      });
    }
  }

  bindTabSwitchEvents() {
    const tokensTab = document.getElementById('tokensTab');
    const collectiblesTab = document.getElementById('collectiblesTab');
    const activityTab = document.getElementById('activityTab');
    const advancedTab = document.getElementById('advancedTab');

    if (tokensTab) {
      tokensTab.addEventListener('click', async () => {
        switchTab('tokens');
        await this.loadTokenBalances();
      });
    }
    if (collectiblesTab) {
      collectiblesTab.addEventListener('click', () => {
        switchTab('collectibles');
      });
    }
    if (activityTab) {
      activityTab.addEventListener('click', async () => {
        switchTab('activity');
        await this.loadTransactionHistory();
      });
    }
    if (advancedTab) {
      advancedTab.addEventListener('click', () => switchTab('advanced'));
    }
  }

  async handleOpenAccounts() {
    if (this.onOpenAccounts) {
      await this.onOpenAccounts();
      return;
    }
    showPage('accountsPage');
  }

  async handleOpenHistory() {
    showPage('walletPage');
    switchTab('activity');
    await this.loadTransactionHistory();
  }

  async handleOpenSettings() {
    if (this.onOpenSettings) {
      await this.onOpenSettings();
      return;
    }
    showPage('settingsPage');
  }

  async handleOpenTransfer() {
    showPage('transferPage');
    await this.prepareTransferSelectors();
  }

  async refreshWalletData() {
    try {
      const account = await this.wallet.getCurrentAccount();
      if (!account) return;

      updateAccountInfo(account);

      const balance = await this.wallet.getBalance(account.address);
      updateBalance(balance);

      if (this.networkController) {
        await this.networkController.refreshNetworkState();
      }

      const tokensContent = document.getElementById('tokensContent');
      if (tokensContent && !tokensContent.classList.contains('hidden')) {
        await this.loadTokenBalances();
      }
    } catch (error) {
      console.error('[WalletController] 刷新钱包数据失败:', error);
    }
  }

  async handleRefreshBalance() {
    try {
      const account = await this.wallet.getCurrentAccount();
      if (!account) {
        showError('请先创建或导入钱包');
        return;
      }

      showStatus('sendStatus', '刷新中...', 'info');

      const balance = await this.wallet.getBalance(account.address);
      updateBalance(balance);

      clearStatus('sendStatus');
      showSuccess('余额已更新');
    } catch (error) {
      console.error('[WalletController] 刷新余额失败:', error);
      showStatus('sendStatus', '刷新失败: ' + error.message, 'error');
    }
  }

  async handleSendTransaction() {
    const recipientInput = document.getElementById('recipientAddress');
    const amountInput = document.getElementById('amount');

    const recipient = recipientInput?.value.trim();
    const amount = amountInput?.value;

    if (!recipient) {
      showStatus('sendStatus', '请输入接收地址', 'error');
      return;
    }

    if (!isValidAddress(recipient)) {
      showStatus('sendStatus', '地址格式无效', 'error');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      showStatus('sendStatus', '请输入有效金额', 'error');
      return;
    }

    try {
      showStatus('sendStatus', '交易签名中...', 'info');

      const account = await this.wallet.getCurrentAccount();
      if (!account) {
        throw new Error('未找到账户');
      }

      const chainId = await this.network.getChainId();
      const rpcUrl = await this.network.getRpcUrl();

    const selectedToken = this.currentTransferToken;
    if (selectedToken && !selectedToken.isNative) {
      showStatus('sendStatus', '暂不支持通证转账', 'error');
      return;
    }

    const txHash = await this.transaction.sendTransaction({
      from: account.address,
      to: recipient,
      value: this.transaction.parseEther(amount),
      chainId: chainId,
      rpcUrl: rpcUrl
    });

      showStatus('sendStatus', `交易已发送: ${shortenAddress(txHash)}`, 'success');

      recipientInput.value = '';
      amountInput.value = '';

      await this.handleRefreshBalance();
    } catch (error) {
      console.error('[WalletController] 发送交易失败:', error);
      showStatus('sendStatus', '发送失败: ' + error.message, 'error');
    }
  }

  async handleShowPrivateKey() {
    try {
      const account = await this.wallet.getCurrentAccount();
      if (!account?.id) {
        showError('请先创建或选择账户');
        return;
      }

      let privateKey = null;
      const password = await promptPassword({
        title: '显示私钥',
        confirmText: '显示',
        placeholder: '输入密码',
        onConfirm: async (input) => {
          if (!input || input.length < 8) {
            throw new Error('密码至少需要8位字符');
          }
          privateKey = await this.wallet.exportPrivateKey(account.id, input);
        }
      });
      if (!password) return;
      if (!privateKey) return;

      const displayEl = document.getElementById('privateKeyDisplay');
      const valueEl = document.getElementById('privateKeyValue');
      const btnEl = document.getElementById('showPrivateKeyBtn');

      if (displayEl && valueEl) {
        valueEl.value = privateKey;
        displayEl.classList.remove('hidden');
        btnEl.classList.add('hidden');
      }
    } catch (error) {
      showError('获取私钥失败: ' + error.message);
    }
  }

  async handleShowMnemonic() {
    try {
      const account = await this.wallet.getCurrentAccount();
      if (!account?.walletId) {
        showError('请先创建或选择账户');
        return;
      }

      let mnemonic = null;
      const password = await promptPassword({
        title: '显示助记词',
        confirmText: '显示',
        placeholder: '输入密码',
        onConfirm: async (input) => {
          if (!input || input.length < 8) {
            throw new Error('密码至少需要8位字符');
          }
          mnemonic = await this.wallet.exportMnemonic(account.walletId, input);
        }
      });
      if (!password) return;
      if (!mnemonic) return;

      const displayEl = document.getElementById('mnemonicDisplay');
      const valueEl = document.getElementById('mnemonicValue');
      const btnEl = document.getElementById('showMnemonicBtn');

      if (displayEl && valueEl) {
        valueEl.value = mnemonic;
        displayEl.classList.remove('hidden');
        btnEl.classList.add('hidden');
      }
    } catch (error) {
      showError('获取助记词失败: ' + error.message);
    }
  }

  async loadTransactionHistory() {
    try {
      const account = await this.wallet.getCurrentAccount();
      if (!account) {
        this.renderTransactionHistory([]);
        return;
      }

      const transactions = await this.transaction.getTransactionHistory(account.address);
      this.renderTransactionHistory(transactions);
    } catch (error) {
      console.error('[WalletController] 加载交易历史失败:', error);
      this.renderTransactionHistory([]);
    }
  }

  async loadTokenBalances() {
    try {
      const account = await this.wallet.getCurrentAccount();
      if (!account) {
        this.renderTokenBalances([]);
        return;
      }

      const nativeToken = await this.buildNativeToken(account.address);
      const tokens = await this.wallet.getTokenBalances(account.address);
      const list = nativeToken ? [nativeToken, ...tokens] : tokens;
      this.lastTokenList = list;
      this.updateTransferTokenOptions(list);
      this.renderTokenBalances(list);
    } catch (error) {
      console.error('[WalletController] 加载通证余额失败:', error);
      this.renderTokenBalances([]);
    }
  }

  async prepareTransferSelectors() {
    if (this.networkController) {
      await this.networkController.refreshNetworkOptions();
    }
    const account = await this.wallet.getCurrentAccount();
    const senderInput = document.getElementById('senderAddress');
    if (senderInput) {
      senderInput.value = account?.address || '';
    }
    if (!this.lastTokenList || this.lastTokenList.length === 0) {
      await this.loadTokenBalances();
    } else {
      this.updateTransferTokenOptions(this.lastTokenList);
    }
    this.updateTransferTokenSelection();
  }

  updateTransferTokenOptions(tokens) {
    const selector = document.querySelector('.token-selector');
    if (!selector) return;

    this.transferTokenMap = new Map();
    const menu = selector.querySelector('.token-menu');
    const labelEl = selector.querySelector('.token-label');
    if (!menu || !labelEl) return;
    menu.innerHTML = '';

    const list = Array.isArray(tokens) ? tokens : [];
    if (list.length === 0) {
      this.transferTokenMap.set('native', { symbol: 'ETH', name: '原生代币', isNative: true });
      labelEl.textContent = '原生代币';
      labelEl.dataset.value = 'native';
      return;
    }

    list.forEach((token) => {
      const id = token.isNative ? 'native' : (token.address || token.symbol || '');
      if (!id) return;
      const label = token.isNative
        ? `${token.symbol || 'ETH'} (原生)`
        : `${token.symbol || '-'}${token.name ? ` · ${token.name}` : ''}`;
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'token-option';
      option.dataset.value = id;
      option.textContent = label;
      option.addEventListener('click', (event) => {
        event.stopPropagation();
        this.setTransferTokenSelection(id);
        this.closeTokenMenu();
      });
      menu.appendChild(option);
      this.transferTokenMap.set(id, token);
    });

    if (menu.children.length === 0) {
      this.transferTokenMap.set('native', { symbol: 'ETH', name: '原生代币', isNative: true });
      labelEl.textContent = '原生代币';
      labelEl.dataset.value = 'native';
      return;
    }

    const preferred = menu.children[0]?.dataset?.value || 'native';
    if (this.currentTransferToken) {
      const currentId = this.currentTransferToken.isNative ? 'native' : this.currentTransferToken.address;
      const hasCurrent = Array.from(menu.children).some(option => option.dataset.value === currentId);
      this.setTransferTokenSelection(hasCurrent ? currentId : preferred);
    } else {
      this.setTransferTokenSelection(preferred);
    }
  }

  updateTransferTokenSelection() {
    const selector = document.querySelector('.token-selector');
    if (!selector) return;
    const labelEl = selector.querySelector('.token-label');
    if (!labelEl) return;
    const selectedId = labelEl.dataset.value || 'native';
    const token = this.transferTokenMap.get(selectedId) || null;
    this.currentTransferToken = token;

    const symbolEl = document.getElementById('transferTokenSymbol');
    if (symbolEl) {
      const symbol = token?.symbol || 'ETH';
      symbolEl.textContent = `(${symbol})`;
    }

    const menu = selector.querySelector('.token-menu');
    if (menu) {
      Array.from(menu.children).forEach((option) => {
        option.classList.toggle('active', option.dataset.value === selectedId);
      });
    }

    this.updateTransferMaxHint(token);
  }

  updateTransferMaxHint(token) {
    const hintEl = document.getElementById('transferMaxHint');
    if (!hintEl) return;
    if (!token) {
      hintEl.textContent = '';
      return;
    }
    const balance = token.balance ?? '';
    const symbol = token.symbol || 'ETH';
    if (balance === '' || balance === null || balance === undefined) {
      hintEl.textContent = '';
      return;
    }
    hintEl.textContent = `可转数量：${balance} ${symbol}`;
  }

  bindTransferTokenSelector() {
    const selector = document.querySelector('.token-selector');
    if (!selector) return;
    const trigger = selector.querySelector('.token-trigger');
    if (trigger && !trigger.dataset.bound) {
      trigger.dataset.bound = '1';
      trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggleTokenMenu();
      });
    }

    if (!this.boundTokenDocClick) {
      this.boundTokenDocClick = true;
      document.addEventListener('click', () => {
        this.closeTokenMenu();
      });
    }
  }

  toggleTokenMenu() {
    const selector = document.querySelector('.token-selector');
    if (!selector) return;
    const menu = selector.querySelector('.token-menu');
    const trigger = selector.querySelector('.token-trigger');
    if (!menu || !trigger) return;
    const isHidden = menu.classList.contains('hidden');
    this.closeTokenMenu();
    if (isHidden) {
      menu.classList.remove('hidden');
      trigger.setAttribute('aria-expanded', 'true');
    }
  }

  closeTokenMenu() {
    const selector = document.querySelector('.token-selector');
    if (!selector) return;
    const menu = selector.querySelector('.token-menu');
    const trigger = selector.querySelector('.token-trigger');
    if (menu) {
      menu.classList.add('hidden');
    }
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
    }
  }

  setTransferTokenSelection(selectedId) {
    const selector = document.querySelector('.token-selector');
    if (!selector) return;
    const labelEl = selector.querySelector('.token-label');
    if (!labelEl) return;

    const token = this.transferTokenMap.get(selectedId) || null;
    this.currentTransferToken = token;
    labelEl.textContent = token?.isNative
      ? `${token.symbol || 'ETH'} (原生)`
      : (token?.symbol || '原生代币');
    labelEl.dataset.value = selectedId;
    this.updateTransferTokenSelection();
  }

  async buildNativeToken(address) {
    if (!address) return null;

    let chainId = null;
    try {
      chainId = await this.network.getChainId();
    } catch (error) {
      console.warn('[WalletController] 获取链 ID 失败:', error);
    }

    let symbol = 'ETH';
    let name = '原生代币';

    if (chainId) {
      const networkConfig = getNetworkByChainId(chainId);
      if (networkConfig) {
        symbol = networkConfig.symbol || symbol;
        name = networkConfig.name || name;
      } else {
        try {
          const customNetworks = await this.network.getCustomNetworks();
          const normalized = normalizeChainId(chainId);
          const custom = customNetworks.find(item => {
            try {
              return normalizeChainId(item.chainId) === normalized;
            } catch {
              return false;
            }
          });
          if (custom) {
            symbol = custom.symbol || symbol;
            name = custom.chainName || custom.name || name;
          }
        } catch (error) {
          console.warn('[WalletController] 获取自定义网络失败:', error);
        }
      }
    }

    let balance = '0';
    try {
      const result = await this.wallet.getBalance(address);
      if (result !== undefined && result !== null && result !== '') {
        balance = result;
      }
    } catch (error) {
      console.warn('[WalletController] 获取原生代币余额失败:', error);
    }

    return {
      symbol,
      name,
      balance,
      isNative: true
    };
  }

  renderTokenBalances(tokens) {
    const container = document.getElementById('tokenList');
    if (!container) return;

    if (!tokens || tokens.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>🪙</p>
          <p>暂无通证</p>
        </div>
      `;
      return;
    }

    container.innerHTML = tokens.map(token => `
      <div class="token-item ${token.isNative ? 'native' : ''}">
        <div class="token-info">
          <div class="token-symbol">
            ${token.symbol || '-'}
            ${token.isNative ? '<span class="token-badge">原生</span>' : ''}
          </div>
          <div class="token-name">${token.name || (token.address ? shortenAddress(token.address) : '')}</div>
        </div>
        <div class="token-balance">
          ${token.balance ?? '0'}
          <span>${token.symbol || ''}</span>
        </div>
      </div>
    `).join('');
  }

  renderTransactionHistory(transactions) {
    const container = document.getElementById('transactionList');
    if (!container) return;

    if (!transactions || transactions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>📭</p>
          <p>暂无交易记录</p>
        </div>
      `;
      return;
    }

    container.innerHTML = transactions
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 50)
      .map(tx => `
        <div class="transaction-item">
          <div class="tx-icon">${tx.hash ? '↗' : '📥'}</div>
          <div class="tx-info">
            <div class="tx-direction">${tx.hash ? '发送' : '接收'}</div>
            <div class="tx-address">${shortenAddress(tx.to || tx.from)}</div>
            <div class="tx-time">${new Date(tx.timestamp).toLocaleString()}</div>
          </div>
          <div class="tx-amount ${tx.hash ? 'sent' : 'received'}">
            ${tx.hash ? '-' : '+'}${tx.value} ETH
          </div>
        </div>
      `).join('');
  }

  async handleClearHistory() {
    if (!confirm('确定要清除所有交易记录吗？')) {
      return;
    }

    try {
      await this.transaction.clearHistory();
      this.renderTransactionHistory([]);
      showSuccess('历史记录已清除');
    } catch (error) {
      console.error('[WalletController] 清除历史记录失败:', error);
      showError('清除失败: ' + error.message);
    }
  }
}

