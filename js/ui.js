// UI 交互模块
const UI = {
  pages: {
    welcome: document.getElementById('welcomePage'),
    import: document.getElementById('importPage'),
    wallet: document.getElementById('walletPage'),
    setPassword: document.getElementById('setPasswordPage'),
    unlock: document.getElementById('unlockPage'),
    settings: document.getElementById('settingsPage'),
    history: document.getElementById('historyPage'),
  },

  // 显示页面
  showPage(pageName) {
    Object.values(this.pages).forEach(page => page.classList.add('hidden'));
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

  // 更新钱包地址显示
  updateAddressDisplay(address) {
    const shortAddress = Utils.shortenAddress(address);
    document.getElementById('walletAddress').textContent = shortAddress;
    document.getElementById('receiveAddress').textContent = address;

    // 添加点击复制功能
    document.getElementById('walletAddress').addEventListener('click', () => {
      Utils.copyToClipboard(address);
    });
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

  // 更新余额显示
  updateBalanceDisplay(balance) {
    document.getElementById('balance').textContent = parseFloat(balance).toFixed(4);
  },

  // 清空转账表单
  clearSendForm() {
    document.getElementById('recipientAddress').value = '';
    document.getElementById('amount').value = '';
  },

  // 显示/隐藏私钥
  togglePrivateKey(privateKey) {
    const privateKeyDisplay = document.getElementById('privateKeyDisplay');
    const copyBtn = document.getElementById('copyPrivateKeyBtn');
    const showBtn = document.getElementById('showPrivateKeyBtn');

    if (privateKeyDisplay.classList.contains('hidden')) {
      privateKeyDisplay.textContent = privateKey;
      privateKeyDisplay.classList.remove('hidden');
      copyBtn.classList.remove('hidden');
      showBtn.textContent = '隐藏私钥';
    } else {
      privateKeyDisplay.classList.add('hidden');
      copyBtn.classList.add('hidden');
      showBtn.textContent = '显示私钥';
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

  // 🔥 显示解锁原因
  showUnlockReason(origin) {
    const unlockPage = document.getElementById('unlockPage');

    // 检查是否已有提示
    let reasonEl = unlockPage.querySelector('.unlock-reason');

    if (!reasonEl && origin) {
      reasonEl = document.createElement('div');
      reasonEl.className = 'unlock-reason';
      reasonEl.innerHTML = `
        <p><strong>${origin}</strong></p>
        <p>请求连接您的钱包</p>
      `;
      // 插入到密码输入框之前
      const form = unlockPage.querySelector('.unlock-form');
      form.insertBefore(reasonEl, form.firstChild);
    }
  },
};
