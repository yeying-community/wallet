// UI 交互模块
const UI = {
  pages: {
    loading: document.getElementById('loadingPage'),
    welcome: document.getElementById('welcomePage'),
    import: document.getElementById('importPage'),
    wallet: document.getElementById('walletPage'),
    setPassword: document.getElementById('setPasswordPage'),
    unlock: document.getElementById('unlockPage'),
    settings: document.getElementById('settingsPage'),
    history: document.getElementById('historyPage'),
    accounts: document.getElementById('accountsPage'),
  },

  // 显示页面
  showPage(pageName) {
    console.log('🔄 Switching to page:', pageName);

    // 隐藏所有已知页面
    Object.values(this.pages).forEach(page => page?.classList.add('hidden'));

    // 隐藏动态创建的助记词备份页面
    const mnemonicBackup = document.getElementById('mnemonicBackup');
    if (mnemonicBackup) {
      mnemonicBackup.remove();
    }

    // 显示目标页面
    this.pages[pageName].classList.remove('hidden');
  },

  // 显示状态消息
  showStatus(message, type = 'info', elementId = 'sendStatus') {
    const statusElement = document.getElementById(elementId);
    if (!statusElement) return;

    statusElement.textContent = message;
    statusElement.className = 'status ' + type;
    statusElement.style.display = 'block';

    setTimeout(() => {
      statusElement.style.display = 'none';
    }, 5000);
  },

  // 显示全局悬浮提示
  showToast(message, type = 'info', duration = 3000) {
    const toast = document.getElementById('globalToast');
    if (!toast) return;

    // 清除之前的定时器
    if (this.currentToastTimeout) {
      clearTimeout(this.currentToastTimeout);
    }

    // 移除所有类型类
    toast.className = 'toast';

    // 设置内容和类型
    toast.textContent = message;
    toast.classList.add(type);
    toast.classList.remove('hidden', 'fade-out');

    // 设置自动隐藏
    this.currentToastTimeout = setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => {
        toast.classList.add('hidden');
      }, 300); // 等待淡出动画完成
    }, duration);
  },

  // 切换标签页
  switchTab(tabName) {
    // 更新标签按钮状态
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.getElementById(tabName + 'Tab').classList.add('active');

    // 显示对应内容
    document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
    document.getElementById(tabName + 'Content').classList.remove('hidden');
  },

  // 更新头像显示
  updateAvatar(address) {
    const avatarDiv = document.getElementById('walletAvatar');
    if (avatarDiv) {
      avatarDiv.innerHTML = '';
      const canvas = Utils.generateAvatar(address);
      avatarDiv.appendChild(canvas);
    }
  },

  // 更新账户名称显示
  updateAccountName(name) {
    const accountNameEl = document.getElementById('accountName');
    if (accountNameEl) {
      accountNameEl.textContent = name;
    }
  },

  // 更新余额显示
  updateBalanceDisplay(balance) {
    document.getElementById('balance').textContent = parseFloat(balance).toFixed(4);
  },

  // 清空转账表单
  clearSendForm() {
    document.getElementById('recipientAddress').value = '';
    document.getElementById('amount').value = '';
  },

  // 显示助记词备份页面
  showMnemonicBackup(mnemonic) {
    console.log('🔐 Showing mnemonic backup page');

    // 先隐藏所有页面
    Object.values(this.pages).forEach(page => {
      if (page) page.classList.add('hidden');
    });

    // 移除旧的备份页面（如果存在）
    const oldBackup = document.getElementById('mnemonicBackup');
    if (oldBackup) {
      oldBackup.remove();
    }

    // 创建新的备份页面
    const backupPage = document.createElement('div');
    backupPage.id = 'mnemonicBackup';
    backupPage.className = 'page'; // 🔥 移除 hidden 类，直接显示
    backupPage.innerHTML = `
      <div class="backup-container">
        <h2>🔐 备份助记词</h2>
        <p class="warning">⚠️ 请妥善保管助记词，这是恢复钱包的唯一方式！</p>
        
        <div class="mnemonic-box">
          ${mnemonic.split(' ').map((word, i) => `
            <div class="mnemonic-word">
              <span class="word-number">${i + 1}</span>
              <span class="word-text">${word}</span>
            </div>
          `).join('')}
        </div>

        <div class="backup-actions">
          <button class="btn btn-secondary" id="btnCopyMnemonicBackup">📋 复制助记词</button>
          <button class="btn btn-primary" id="btnConfirmBackup">✅ 我已备份</button>
        </div>
      </div>
    `;

    // 添加到容器中
    const container = document.querySelector('.container');
    if (container) {
      container.appendChild(backupPage);
    } else {
      document.body.appendChild(backupPage);
    }

    console.log('✅ Mnemonic backup page created');

    // 绑定事件
    const copyBtn = document.getElementById('btnCopyMnemonicBackup');
    const confirmBtn = document.getElementById('btnConfirmBackup');

    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        Utils.copyToClipboard(mnemonic);
        this.showToast('助记词已复制', 'success');
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        console.log('✅ User confirmed backup');
        backupPage.remove();
        this.showPage('wallet');
        this.showToast('钱包创建成功！', 'success');
      });
    }
  },

  // 显示账户选择器
  async showAccountSelector() {
    try {
      const accounts = await Storage.getAllAccounts();
      const currentAccount = await Storage.getCurrentAccount();

      const selector = document.createElement('div');
      selector.className = 'account-selector-modal';
      selector.innerHTML = `
        <div class="modal-overlay"></div>
        <div class="account-selector-content">
          <div class="selector-header">
            <h3>选择账户</h3>
            <button class="btn-close">✕</button>
          </div>
          <div class="account-list">
            ${Object.values(accounts).map(account => `
              <div class="account-item ${currentAccount?.id === account.id ? 'active' : ''}" 
                   data-account-id="${account.id}">
                <div class="account-avatar" data-address="${account.address}"></div>
                <div class="account-info">
                  <div class="account-name">${Utils.escapeHtml(account.name)}</div>
                  <div class="account-address">${Utils.shortenAddress(account.address)}</div>
                </div>
                ${currentAccount?.id === account.id ? '<span class="badge-active">当前</span>' : ''}
              </div>
            `).join('')}
          </div>
          <div class="selector-footer">
            <button class="btn-primary" id="btnManageAccounts">管理账户</button>
          </div>
        </div>
      `;

      document.body.appendChild(selector);

      // 生成头像
      selector.querySelectorAll('.account-avatar').forEach(avatarDiv => {
        const address = avatarDiv.dataset.address;
        const canvas = Utils.generateAvatar(address);
        avatarDiv.appendChild(canvas);
      });

      // 绑定关闭事件
      const closeSelector = () => selector.remove();

      selector.querySelector('.btn-close').addEventListener('click', closeSelector);
      selector.querySelector('.modal-overlay').addEventListener('click', closeSelector);

      // 绑定账户切换事件
      selector.querySelectorAll('.account-item').forEach(item => {
        item.addEventListener('click', async () => {
          const accountId = item.dataset.accountId;
          if (accountId !== currentAccount?.id) {
            closeSelector();
            await WalletManager.switchAccount(accountId);
          }
        });
      });

      // 切换到账户管理页面
      selector.querySelector('#btnManageAccounts').addEventListener('click', () => {
        closeSelector();
        // 内显示账户管理页面
        this.showPage('accounts');
        // 触发加载账户列表
        AccountManager.loadAccountManageList();
      });

    } catch (error) {
      console.error('❌ Show account selector failed:', error);
      this.showToast('显示账户选择器失败', 'error');
    }
  },

  // 显示/隐藏私钥
  togglePrivateKey(privateKey) {
    const privateKeyDisplay = document.getElementById('privateKeyDisplay');
    const privateKeyValue = document.getElementById('privateKeyValue');
    const showBtn = document.getElementById('showPrivateKeyBtn');

    if (!privateKeyDisplay || !privateKeyValue || !showBtn) return;

    const isHidden = privateKeyDisplay.classList.contains('hidden');

    if (isHidden) {
      privateKeyValue.value = privateKey;
      privateKeyDisplay.classList.remove('hidden');
      showBtn.textContent = '隐藏私钥';
      showBtn.classList.add('active');
    } else {
      privateKeyValue.value = '';
      privateKeyDisplay.classList.add('hidden');
      showBtn.textContent = '显示私钥';
      showBtn.classList.remove('active');
    }
  },

  // 显示/隐藏自定义 RPC 输入框
  toggleCustomRpcInput(show) {
    const customInput = document.getElementById('customRpcInput');
    if (show) {
      customInput.classList.remove('hidden');
      customInput.focus();
    } else {
      customInput.classList.add('hidden');
    }
  },

  // 显示解锁原因
  showUnlockReason(origin) {
    const unlockPage = document.getElementById('unlockPage');
    if (!unlockPage) return;

    // 查找或创建提示元素
    let reasonEl = unlockPage.querySelector('.unlock-reason');

    if (!reasonEl) {
      reasonEl = document.createElement('div');
      reasonEl.className = 'unlock-reason';

      // 插入到解锁按钮之前
      const unlockBtn = unlockPage.querySelector('#unlockBtn');
      if (unlockBtn) {
        unlockBtn.parentNode.insertBefore(reasonEl, unlockBtn);
      } else {
        unlockPage.appendChild(reasonEl);
      }
    }

    // 设置提示内容
    reasonEl.innerHTML = `
      <div class="unlock-reason-icon">🔗</div>
      <div class="unlock-reason-text">
        <strong>${origin}</strong> 请求连接到您的钱包
      </div>
    `;

    console.log('📢 Unlock reason displayed:', origin);
  },

  toggleMnemonic(mnemonic) {
    const display = document.getElementById('mnemonicDisplay');
    const value = document.getElementById('mnemonicValue');
    const showBtn = document.getElementById('showMnemonicBtn');

    if (!display || !value || !showBtn) return;

    const isHidden = display.classList.contains('hidden');

    if (isHidden) {
      value.value = mnemonic;
      display.classList.remove('hidden');
      showBtn.textContent = '隐藏助记词';
      showBtn.classList.add('active');
    } else {
      display.classList.add('hidden');
      value.value = '';
      showBtn.textContent = '显示助记词';
      showBtn.classList.remove('active');
    }
  },
};
