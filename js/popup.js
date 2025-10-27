// 初始化应用
document.addEventListener('DOMContentLoaded', async () => {
  await initializeApp();
  bindEvents();
});

async function initializeApp() {
  try {
    // 🔥 检查 URL 参数
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    const requestId = urlParams.get('requestId');
    const origin = urlParams.get('origin');

    const hasWallet = await Storage.hasWallet();
    if (!hasWallet) {
      UI.showPage('welcome');
      return;
    }

    // 🔥 如果是解锁请求
    if (action === 'unlock' && requestId) {
      // 保存请求信息到 sessionStorage
      sessionStorage.setItem('pendingRequest', JSON.stringify({
        requestId,
        origin: decodeURIComponent(origin || '')
      }));
      // 显示解锁页面，并提示来源
      UI.showPage('unlock');
      UI.showUnlockReason(decodeURIComponent(origin || ''));
      return;
    }

    // 正常流程：检查是否过期
    const isExpired = await Storage.isExpired();
    if (isExpired) {
      UI.showPage('unlock');
    } else {
      // 检查 session 中是否有钱包
      const session = await chrome.storage.session.get('wallet_privateKey');
      if (session.wallet_privateKey) {
        await WalletManager.loadWallet(session.wallet_privateKey);
        UI.showPage('wallet');
      } else {
        UI.showPage('unlock');
      }
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

  document.getElementById('advancedTab')?.addEventListener('click', () => {
    UI.switchTab('advanced');
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
  document.getElementById('unlockBtn')?.addEventListener('click', async () => {
    const success = await WalletManager.unlockWallet();

    if (success) {
      // 检查是否有待处理的连接请求
      const pendingRequest = sessionStorage.getItem('pendingRequest');

      if (pendingRequest) {
        const { requestId } = JSON.parse(pendingRequest);
        sessionStorage.removeItem('pendingRequest');

        // 自动处理连接请求
        await handlePostUnlock(requestId);
      } else {
        // 正常解锁流程
        UI.showPage('wallet');
        await WalletManager.updateBalance();
      }
    }
  });

  // 支持回车键
  document.getElementById('unlockPassword')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      WalletManager.unlockWallet();
    }
  });

  // 交易历史
  document.getElementById('historyBtn').addEventListener('click', () => {
    UI.showPage('history');
    TransactionHistory.loadHistory();
  });

  document.getElementById('historyBackBtn').addEventListener('click', () => {
    UI.showPage('wallet');
  });

  // 交易项点击事件
  document.getElementById('transactionList').addEventListener('click', (e) => {
    const txItem = e.target.closest('.transaction-item');
    if (txItem) {
      const hash = txItem.dataset.hash;
      if (hash) {
        TransactionHistory.showDetail(hash);
      }
    }
  });

  document.getElementById('clearHistoryBtn').addEventListener('click', () => {
    TransactionHistory.clearHistory();
  });

  // 钱包设置
  document.getElementById('settingsBtn').addEventListener('click', () => {
    UI.showPage('settings');
    Settings.loadAuthorizedSites();
  });

  document.getElementById('settingsBackBtn').addEventListener('click', () => {
    UI.showPage('wallet');
  });

  document.getElementById('clearAllAuthBtn').addEventListener('click', () => {
    Settings.clearAllAuthorizations();
  });

  document.getElementById('resetWalletBtn').addEventListener('click', () => {
    if (confirm('确定要重置钱包吗？这将清除所有数据，请确保已备份私钥！')) {
      WalletManager.resetWallet();
    }
  });
}

// 🔥 显示连接请求的解锁界面
function showUnlockForConnection(origin) {
  UI.showPage('unlock');

  // 修改解锁页面的提示文字
  const unlockPage = document.getElementById('unlockPage');
  const title = unlockPage.querySelector('h2');

  if (title) {
    title.textContent = '解锁钱包以连接';
  }

  // 添加请求来源提示
  const passwordGroup = unlockPage.querySelector('.form-group');
  if (passwordGroup && !document.getElementById('connectionHint')) {
    const hint = document.createElement('div');
    hint.id = 'connectionHint';
    hint.className = 'connection-hint';
    hint.innerHTML = `
      <p><strong>${origin}</strong> 请求连接您的钱包</p>
    `;
    passwordGroup.parentNode.insertBefore(hint, passwordGroup);
  }
}

// 🔥 解锁后自动处理连接请求
async function handlePostUnlock(requestId) {
  try {
    const session = await chrome.storage.session.get('wallet_address');

    if (!session.wallet_address) {
      throw new Error('解锁失败');
    }

    // 通知 background script
    chrome.runtime.sendMessage({
      type: 'UNLOCK_SUCCESS',
      requestId: requestId,
      address: session.wallet_address
    });

    // 关闭弹窗
    window.close();
  } catch (error) {
    console.error('处理连接请求失败:', error);
    UI.showStatus('连接失败: ' + error.message, 'error');
  }
}
