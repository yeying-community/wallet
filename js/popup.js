// 初始化应用
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Popup initializing...');

  // 检查 URL 参数（处理外部请求）
  const urlParams = new URLSearchParams(window.location.search);
  const action = urlParams.get('action');
  const requestId = urlParams.get('requestId');
  const origin = urlParams.get('origin');

  console.log('📋 URL params:', { action, requestId, origin });

  // 如果是解锁请求，保存请求信息
  if (action === 'unlock' && requestId) {
    const pendingRequest = {
      requestId,
      origin: decodeURIComponent(origin || ''),
      timestamp: Date.now()
    };

    sessionStorage.setItem('pendingRequest', JSON.stringify(pendingRequest));
    console.log('💾 Pending request saved:', pendingRequest);
  }

  // 初始化钱包（会自动处理页面显示）
  await WalletManager.init();

  // 绑定事件
  bindEvents();

  console.log('✅ Popup initialized');
});

// 绑定所有事件
function bindEvents() {
  // ========== 欢迎页面 ==========
  const createWalletBtn = document.getElementById('createWalletBtn');
  if (createWalletBtn) {
    createWalletBtn.addEventListener('click', () => {
      console.log('📝 Create wallet clicked');
      WalletManager.createWallet();
    });
  }

  const importWalletBtn = document.getElementById('importWalletBtn');
  if (importWalletBtn) {
    importWalletBtn.addEventListener('click', () => {
      console.log('📥 Import wallet clicked');
      UI.showPage('import');
    });
  }

  // ========== 导入页面 ==========
  const importBtn = document.getElementById('importBtn');
  if (importBtn) {
    importBtn.addEventListener('click', () => {
      WalletManager.importWallet();
    });
  }

  const backToWelcomeBtn = document.getElementById('backToWelcomeBtn');
  if (backToWelcomeBtn) {
    backToWelcomeBtn.addEventListener('click', () => {
      UI.showPage('welcome');
    });
  }

  const privateKeyInput = document.getElementById('privateKeyInput');
  if (privateKeyInput) {
    privateKeyInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        WalletManager.importWallet();
      }
    });
  }

  // ========== 设置密码页面 ==========
  const setPasswordBtn = document.getElementById('setPasswordBtn');
  if (setPasswordBtn) {
    setPasswordBtn.addEventListener('click', () => {
      WalletManager.setPassword();
    });
  }

  const cancelPasswordBtn = document.getElementById('cancelPasswordBtn');
  if (cancelPasswordBtn) {
    cancelPasswordBtn.addEventListener('click', () => {
      sessionStorage.removeItem('temp_mnemonic');
      sessionStorage.removeItem('temp_action');
      UI.showPage('welcome');
    });
  }

  // 支持回车键
  const confirmPassword = document.getElementById('confirmPassword');
  if (confirmPassword) {
    confirmPassword.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        WalletManager.setPassword();
      }
    });
  }

  // ========== 解锁页面 ==========
  const unlockBtn = document.getElementById('unlockBtn');
  if (unlockBtn) {
    unlockBtn.addEventListener('click', async () => {
      await WalletManager.unlockWallet();
    });
  }

  const unlockPassword = document.getElementById('unlockPassword');
  if (unlockPassword) {
    unlockPassword.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        WalletManager.unlockWallet();
      }
    });
  }

  const resetWalletBtnUnlock = document.getElementById('resetWalletBtn');
  if (resetWalletBtnUnlock) {
    resetWalletBtnUnlock.addEventListener('click', () => {
      WalletManager.resetWallet();
    });
  }

  // ========== 钱包主页面 ==========

  // 账户选择器
  const accountHeader = document.getElementById('accountHeader');
  if (accountHeader) {
    accountHeader.addEventListener('click', () => {
      UI.showAccountSelector();
    });
  }

  // 刷新余额
  const refreshBalanceBtn = document.getElementById('refreshBalanceBtn');
  if (refreshBalanceBtn) {
    refreshBalanceBtn.addEventListener('click', () => {
      WalletManager.updateBalance();
    });
  }

  // 网络切换
  const networkSelect = document.getElementById('networkSelect');
  if (networkSelect) {
    networkSelect.addEventListener('change', () => {
      Network.handleNetworkChange();
    });
  }

  const customRpcInput = document.getElementById('customRpcInput');
  if (customRpcInput) {
    customRpcInput.addEventListener('blur', () => {
      Network.changeNetwork();
    });
  }

  // 标签页切换
  const sendTab = document.getElementById('sendTab');
  if (sendTab) {
    sendTab.addEventListener('click', () => {
      UI.switchTab('send');
    });
  }

  const receiveTab = document.getElementById('receiveTab');
  if (receiveTab) {
    receiveTab.addEventListener('click', () => {
      UI.switchTab('receive');
    });
  }

  const advancedTab = document.getElementById('advancedTab');
  if (advancedTab) {
    advancedTab.addEventListener('click', () => {
      UI.switchTab('advanced');
    });
  }

  // ========== 转账 ==========
  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      Transaction.sendTransaction();
    });
  }

  const amount = document.getElementById('amount');
  if (amount) {
    amount.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        Transaction.sendTransaction();
      }
    });
  }

  // ========== 接收 ==========
  const copyReceiveAddressBtn = document.getElementById('copyReceiveAddressBtn');
  if (copyReceiveAddressBtn) {
    copyReceiveAddressBtn.addEventListener('click', () => {
      const wallet = WalletManager.getWallet();
      if (wallet) {
        Utils.copyToClipboard(wallet.address);
        UI.showToast('地址已复制', 'success');
      }
    });
  }

  // ========== 高级设置 ==========

  // 显示私钥
  const showPrivateKeyBtn = document.getElementById('showPrivateKeyBtn');
  if (showPrivateKeyBtn) {
    showPrivateKeyBtn.addEventListener('click', () => {
      WalletManager.showPrivateKey();
    });
  }

  // 复制私钥
  const copyPrivateKeyBtn = document.getElementById('copyPrivateKeyBtn');
  if (copyPrivateKeyBtn) {
    copyPrivateKeyBtn.addEventListener('click', () => {
      WalletManager.copyPrivateKey();
    });
  }

  // 显示助记词
  const showMnemonicBtn = document.getElementById('showMnemonicBtn');
  if (showMnemonicBtn) {
    showMnemonicBtn.addEventListener('click', () => {
      WalletManager.showMnemonic();
    });
  }

  // 复制助记词
  const copyMnemonicBtn = document.getElementById('copyMnemonicBtn');
  if (copyMnemonicBtn) {
    copyMnemonicBtn.addEventListener('click', () => {
      WalletManager.copyMnemonic();
    });
  }

  // ========== 交易历史 ==========
  const historyBtn = document.getElementById('historyBtn');
  if (historyBtn) {
    historyBtn.addEventListener('click', () => {
      UI.showPage('history');
      TransactionHistory.loadHistory();
    });
  }

  const historyBackBtn = document.getElementById('historyBackBtn');
  if (historyBackBtn) {
    historyBackBtn.addEventListener('click', () => {
      UI.showPage('wallet');
    });
  }

  const transactionList = document.getElementById('transactionList');
  if (transactionList) {
    transactionList.addEventListener('click', (e) => {
      const txItem = e.target.closest('.transaction-item');
      if (txItem) {
        const hash = txItem.dataset.hash;
        if (hash) {
          TransactionHistory.showDetail(hash);
        }
      }
    });
  }

  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
      TransactionHistory.clearHistory();
    });
  }

  // ========== 设置页面 ==========
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      UI.showPage('settings');
      Settings.loadAuthorizedSites();
    });
  }

  const settingsBackBtn = document.getElementById('settingsBackBtn');
  if (settingsBackBtn) {
    settingsBackBtn.addEventListener('click', () => {
      UI.showPage('wallet');
    });
  }

  const clearAllAuthBtn = document.getElementById('clearAllAuthBtn');
  if (clearAllAuthBtn) {
    clearAllAuthBtn.addEventListener('click', () => {
      Settings.clearAllAuthorizations();
    });
  }

  const resetWalletBtnSettings = document.querySelector('#settingsPage #resetWalletBtn');
  if (resetWalletBtnSettings) {
    resetWalletBtnSettings.addEventListener('click', () => {
      WalletManager.resetWallet();
    });
  }

  // ========== 账户管理页面 ==========

  // 账户管理按钮
  const accountManageBtn = document.getElementById('accountManageBtn');
  if (accountManageBtn) {
    accountManageBtn.addEventListener('click', () => {
      UI.showPage('accounts');
      AccountManager.loadAccountManageList();
    });
  }

  // 返回按钮
  const backFromAccountManage = document.getElementById('backFromAccounts');
  if (backFromAccountManage) {
    backFromAccountManage.addEventListener('click', () => {
      UI.showPage('wallet');
    });
  }

  // 创建账户按钮
  const createAccountBtn = document.getElementById('createAccountBtn');
  const createAccountModal = document.getElementById('createAccountModal');
  if (createAccountBtn && createAccountModal) {
    createAccountBtn.addEventListener('click', () => {
      createAccountModal.classList.remove('hidden');
      document.getElementById('newAccountName').value = '';
    });
  }

  // 关闭创建账户模态框
  const closeCreateAccountModal = document.getElementById('closeCreateAccountModal');
  const cancelCreateAccount = document.getElementById('cancelCreateAccount');
  if (closeCreateAccountModal && createAccountModal) {
    closeCreateAccountModal.addEventListener('click', () => {
      createAccountModal.classList.add('hidden');
    });
  }
  if (cancelCreateAccount && createAccountModal) {
    cancelCreateAccount.addEventListener('click', () => {
      createAccountModal.classList.add('hidden');
    });
  }

  // 确认创建账户
  const confirmCreateAccount = document.getElementById('confirmCreateAccount');
  if (confirmCreateAccount && createAccountModal) {
    confirmCreateAccount.addEventListener('click', async () => {
      await AccountManager.confirmCreateAccount()
    });
  }

  // 导入账户按钮
  const importAccountBtn = document.getElementById('importAccountBtn');
  const importAccountModal = document.getElementById('importAccountModal');
  if (importAccountBtn && importAccountModal) {
    importAccountBtn.addEventListener('click', () => {
      importAccountModal.classList.remove('hidden');
      document.getElementById('importAccountName').value = '';
      document.getElementById('importPrivateKey').value = '';
    });
  }

  // 关闭导入账户模态框
  const closeImportAccountModal = document.getElementById('closeImportAccountModal');
  const cancelImportAccount = document.getElementById('cancelImportAccount');
  if (closeImportAccountModal && importAccountModal) {
    closeImportAccountModal.addEventListener('click', () => {
      importAccountModal.classList.add('hidden');
    });
  }

  if (cancelImportAccount && importAccountModal) {
    cancelImportAccount.addEventListener('click', () => {
      importAccountModal.classList.add('hidden');
    });
  }

  // 确认导入账户
  const confirmImportAccount = document.getElementById('confirmImportAccount');
  if (confirmImportAccount && importAccountModal) {
    confirmImportAccount.addEventListener('click', async () => {
      await AccountManager.confirmImportAccount()
    });
  }

  // 点击模态框背景关闭
  if (createAccountModal) {
    createAccountModal.querySelector('.modal-overlay').addEventListener('click', () => {
      createAccountModal.classList.add('hidden');
    });
  }

  if (importAccountModal) {
    importAccountModal.querySelector('.modal-overlay').addEventListener('click', () => {
      importAccountModal.classList.add('hidden');
    });
  }

  // ========== 编辑账户模态框 ==========
  const editAccountModal = document.getElementById('editAccountModal');
  const closeEditAccountModal = document.getElementById('closeEditAccountModal');
  const cancelEditAccount = document.getElementById('cancelEditAccount');
  const confirmEditAccountBtn = document.getElementById('confirmEditAccount');

  if (closeEditAccountModal && editAccountModal) {
    closeEditAccountModal.addEventListener('click', () => {
      editAccountModal.classList.add('hidden');
    });
  }

  if (cancelEditAccount && editAccountModal) {
    cancelEditAccount.addEventListener('click', () => {
      editAccountModal.classList.add('hidden');
    });
  }

  if (confirmEditAccountBtn) {
    confirmEditAccountBtn.addEventListener('click', () => {
      AccountManager.confirmEditAccount();
    });
  }

  // 支持回车键提交
  const editAccountNameInput = document.getElementById('editAccountName');
  if (editAccountNameInput) {
    editAccountNameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        AccountManager.confirmEditAccount();
      }
    });
  }

  // ========== 删除账户模态框 ==========
  const deleteAccountModal = document.getElementById('deleteAccountModal');
  const closeDeleteAccountModal = document.getElementById('closeDeleteAccountModal');
  const cancelDeleteAccount = document.getElementById('cancelDeleteAccount');
  const confirmDeleteAccountBtn = document.getElementById('confirmDeleteAccount');

  if (closeDeleteAccountModal && deleteAccountModal) {
    closeDeleteAccountModal.addEventListener('click', () => {
      deleteAccountModal.classList.add('hidden');
    });
  }

  if (cancelDeleteAccount && deleteAccountModal) {
    cancelDeleteAccount.addEventListener('click', () => {
      deleteAccountModal.classList.add('hidden');
    });
  }

  if (confirmDeleteAccountBtn) {
    confirmDeleteAccountBtn.addEventListener('click', () => {
      AccountManager.confirmDeleteAccount();
    });
  }

  // 支持回车键提交删除
  const deleteAccountPasswordInput = document.getElementById('deleteAccountPassword');
  if (deleteAccountPasswordInput) {
    deleteAccountPasswordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        AccountManager.confirmDeleteAccount();
      }
    });
  }

  console.log('✅ All events bound');
}
