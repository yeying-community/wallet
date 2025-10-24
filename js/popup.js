// 初始化应用
document.addEventListener('DOMContentLoaded', async () => {
  await initializeApp();
  bindEvents();
});

async function initializeApp() {
  try {
    const hasWallet = await Storage.hasWallet();

    if (hasWallet) {
      const isExpired = await Storage.isExpired();

      if (isExpired) {
        // 过期，需要解锁
        UI.showPage('unlock');
      } else {
        // 未过期，但仍需要密码（这里可以优化为自动解锁）
        UI.showPage('unlock');
      }
    } else {
      UI.showPage('welcome');
    }
  } catch (error) {
    console.error('初始化失败:', error);
    UI.showStatus('初始化失败，请刷新页面', 'error');
  }
}

// 绑定所有事件
function bindEvents() {
  // 欢迎页面
  document.getElementById('createWalletBtn')?.addEventListener('click', () => {
    WalletManager.createWallet();
  });

  document.getElementById('importWalletBtn')?.addEventListener('click', () => {
    UI.showPage('import');
  });

  // 导入页面
  document.getElementById('importBtn')?.addEventListener('click', () => {
    WalletManager.importWallet();
  });

  document.getElementById('backToWelcomeBtn')?.addEventListener('click', () => {
    UI.showPage('welcome');
  });

  // 钱包页面
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    WalletManager.logout();
  });

  document.getElementById('refreshBalanceBtn')?.addEventListener('click', () => {
    WalletManager.updateBalance();
  });

  // 网络管理
  document.getElementById('networkSelect')?.addEventListener('change', () => {
    Network.handleNetworkChange();
  });

  document.getElementById('customRpcInput')?.addEventListener('blur', () => {
    Network.changeNetwork();
  });

  // 标签页切换
  document.getElementById('sendTab')?.addEventListener('click', () => {
    UI.switchTab('send');
  });

  document.getElementById('receiveTab')?.addEventListener('click', () => {
    UI.switchTab('receive');
  });

  document.getElementById('settingsTab')?.addEventListener('click', () => {
    UI.switchTab('settings');
  });

  // 转账
  document.getElementById('sendBtn')?.addEventListener('click', () => {
    Transaction.sendTransaction();
  });

  // 接收
  document.getElementById('copyReceiveAddressBtn')?.addEventListener('click', () => {
    const wallet = WalletManager.getWallet();
    if (wallet) {
      Utils.copyToClipboard(wallet.address);
    }
  });

  // 设置
  document.getElementById('showPrivateKeyBtn')?.addEventListener('click', () => {
    WalletManager.showPrivateKey();
  });

  document.getElementById('copyPrivateKeyBtn')?.addEventListener('click', () => {
    WalletManager.copyPrivateKey();
  });

  // 支持回车键提交
  document.getElementById('privateKeyInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      WalletManager.importWallet();
    }
  });

  document.getElementById('amount')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      Transaction.sendTransaction();
    }
  });

  // 密码设置
  document.getElementById('setPasswordBtn')?.addEventListener('click', () => {
    WalletManager.setPassword();
  });

  document.getElementById('cancelPasswordBtn')?.addEventListener('click', () => {
    sessionStorage.removeItem('temp_private_key');
    UI.showPage('welcome');
  });

  // 解锁
  document.getElementById('unlockBtn')?.addEventListener('click', () => {
    WalletManager.unlockWallet();
  });

  document.getElementById('resetWalletBtn')?.addEventListener('click', () => {
    WalletManager.resetWallet();
  });

  // 支持回车键
  document.getElementById('unlockPassword')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      WalletManager.unlockWallet();
    }
  });
}
