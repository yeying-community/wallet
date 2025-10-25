// 钱包管理模块
const WalletManager = {
  wallet: null,
  currentPassword: null, // 临时存储当前会话密码

  // 创建钱包（需要密码）
  async createWallet() {
    const wallet = ethers.Wallet.createRandom();

    // 临时存储私钥，等待设置密码
    sessionStorage.setItem('temp_private_key', wallet.privateKey);

    UI.showPage('setPassword');
  },

  // 设置密码并保存钱包
  async setPassword() {
    const password = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!password || password.length < 8) {
      UI.showStatus('密码至少需要8位字符', 'error', 'passwordStatus');
      return;
    }

    if (password !== confirmPassword) {
      UI.showStatus('两次密码不一致', 'error', 'passwordStatus');
      return;
    }

    try {
      const privateKey = sessionStorage.getItem('temp_private_key');

      // 加密保存
      await Storage.saveEncryptedWallet(privateKey, password);

      // 清除临时数据
      sessionStorage.removeItem('temp_private_key');

      // 加载钱包
      this.currentPassword = password;
      await this.loadWallet(privateKey);

      UI.showPage('wallet');
      UI.showStatus('钱包创建成功！', 'success');
    } catch (error) {
      console.error('设置密码失败:', error);
      UI.showStatus('设置密码失败', 'error', 'passwordStatus');
    }
  },

  // 导入钱包（需要密码）
  async importWallet() {
    const privateKey = document.getElementById('privateKeyInput').value.trim();

    if (!privateKey) {
      UI.showStatus('请输入私钥', 'error', 'importStatus');
      return;
    }

    try {
      // 验证私钥
      new ethers.Wallet(privateKey);

      // 临时存储
      sessionStorage.setItem('temp_private_key', privateKey);

      UI.showPage('setPassword');
    } catch (error) {
      UI.showStatus('私钥格式不正确', 'error', 'importStatus');
    }
  },

  // 解锁钱包时保存到 session
  async unlockWallet() {
    const password = document.getElementById('unlockPassword').value;

    if (!password) {
      UI.showStatus('请输入密码', 'error', 'unlockStatus');
      return;
    }

    try {
      UI.showStatus('正在解锁...', 'info', 'unlockStatus');

      const encryptedData = await Storage.getEncryptedWallet();
      const privateKey = await Storage.decryptPrivateKey(encryptedData, password);

      // 创建钱包实例
      const wallet = new ethers.Wallet(privateKey);

      // 保存到 session storage (仅在当前会话有效)
      await chrome.storage.session.set({
        wallet_privateKey: privateKey,
        wallet_address: wallet.address
      });

      // 更新过期时间
      await Storage.updateExpireTime();

      // 加载钱包
      this.currentPassword = password;
      await this.loadWallet(privateKey);

      // 🔥 检查是否有待处理的请求
      const pendingRequest = sessionStorage.getItem('pendingRequest');
      
      if (pendingRequest) {
        const { requestId, origin } = JSON.parse(pendingRequest);
        
        // 清除待处理请求
        sessionStorage.removeItem('pendingRequest');
        
        // 通知 background 解锁成功
        chrome.runtime.sendMessage({
          type: 'UNLOCK_SUCCESS',
          requestId: requestId,
          address: wallet.address,
          origin: origin
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('发送解锁成功消息失败:', chrome.runtime.lastError);
          }
          
          // 关闭弹窗
          window.close();
        });
        
        return; // 不显示钱包页面，直接关闭
      }

      // 正常解锁流程
      UI.showPage('wallet');
      UI.showToast('解锁成功！', 'success');
      
    } catch (error) {
      console.error('解锁失败:', error);
      UI.showStatus('密码错误', 'error', 'unlockStatus');
    }
  },

  // 重置钱包
  async resetWallet() {
    if (confirm('确定要重置钱包吗？这将删除所有数据！')) {
      await Storage.removeWallet();
      this.wallet = null;
      this.currentPassword = null;
      UI.showPage('welcome');
    }
  },

  // 加载钱包
  async loadWallet(privateKey) {
    try {
      // 获取当前网络
      const networkUrl = document.getElementById('networkSelect').value;
      const provider = await Network.initProvider(networkUrl);

      // 创建钱包实例
      this.wallet = new ethers.Wallet(privateKey, provider);

      // 更新 UI
      UI.updateAvatar(this.wallet.address);
      UI.updateAddressDisplay(this.wallet.address);

      // 更新余额
      await this.updateBalance();

      // 生成二维码
      Utils.generateQRCode(this.wallet.address, 'qrcode');

    } catch (error) {
      console.error('加载钱包失败:', error);
      UI.showStatus('加载钱包失败', 'error');
    }
  },

  // 更新余额
  async updateBalance() {
    if (!this.wallet) return;

    try {
      const provider = Network.getProvider();
      const balance = await provider.getBalance(this.wallet.address);
      const balanceInEth = ethers.utils.formatEther(balance);
      UI.updateBalanceDisplay(balanceInEth);
    } catch (error) {
      console.error('获取余额失败:', error);
      UI.showStatus('获取余额失败', 'error');
    }
  },

  // 登出
  async logout() {
    if (confirm('确定要登出吗？请确保已备份私钥！')) {
      await Storage.removeWallet();
      this.wallet = null;
      UI.showPage('welcome');
    }
  },

  // 显示私钥
  showPrivateKey() {
    if (!this.wallet) return;
    UI.togglePrivateKey(this.wallet.privateKey);
  },

  // 复制私钥
  copyPrivateKey() {
    if (this.wallet) {
      Utils.copyToClipboard(this.wallet.privateKey);
    }
  },

  // 获取钱包实例
  getWallet() {
    return this.wallet;
  },

  // 启动自动锁定检查
  startAutoLockCheck() {
    setInterval(async () => {
      const isExpired = await Storage.isExpired();
      if (isExpired && this.wallet) {
        this.wallet = null;
        this.currentPassword = null;
        UI.showPage('unlock');
        UI.showStatus('会话已过期，请重新解锁', 'info');
      }
    }, 60000); // 每分钟检查一次
  }
};

const TransactionHistory = {
  // 加载交易历史
  async loadHistory() {
    const result = await chrome.storage.local.get('transactionHistory');
    const history = result.transactionHistory || [];
    
    const listEl = document.getElementById('transactionList');
    
    if (history.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p>📝</p>
          <p>暂无交易记录</p>
        </div>
      `;
      return;
    }
    
    listEl.innerHTML = history.map(tx => this.renderTransaction(tx)).join('');
  },

  // 渲染单个交易
  renderTransaction(tx) {
    const statusIcon = {
      'pending': '⏳',
      'success': '✅',
      'failed': '❌'
    }[tx.status] || '❓';
    
    const statusText = {
      'pending': '待确认',
      'success': '成功',
      'failed': '失败'
    }[tx.status] || '未知';
    
    const date = new Date(tx.timestamp).toLocaleString('zh-CN');
    const value = ethers.utils.formatEther(tx.value);
    
    return `
      <div class="transaction-item" onclick="TransactionHistory.showDetail('${tx.hash}')">
        <div class="tx-icon">${statusIcon}</div>
        <div class="tx-info">
          <div class="tx-type">发送</div>
          <div class="tx-address">${this.formatAddress(tx.to)}</div>
          <div class="tx-time">${date}</div>
        </div>
        <div class="tx-amount">
          <div class="tx-value">-${value} ETH</div>
          <div class="tx-status">${statusText}</div>
        </div>
      </div>
    `;
  },

  // 格式化地址
  formatAddress(address) {
    if (!address) return '-';
    return `${address.substring(0, 6)}...${address.substring(38)}`;
  },

  // 显示交易详情
  async showDetail(hash) {
    const result = await chrome.storage.local.get('transactionHistory');
    const history = result.transactionHistory || [];
    const tx = history.find(t => t.hash === hash);
    
    if (!tx) return;

    const explorerUrl = this.getExplorerUrl(tx.hash, tx.network);
    
    const detail = `
      交易哈希: ${tx.hash}
      
      状态: ${tx.status}
      发送方: ${tx.from}
      接收方: ${tx.to}
      金额: ${ethers.utils.formatEther(tx.value)} ETH
      时间: ${new Date(tx.timestamp).toLocaleString('zh-CN')}
      网络: ${tx.network}
      
      在区块浏览器中查看:
      ${explorerUrl}
    `;
    
    if (confirm(detail + '\n\n点击确定在浏览器中打开')) {
      chrome.tabs.create({ url: explorerUrl });
    }
  },

  // 获取区块浏览器 URL
  getExplorerUrl(hash, network) {
    const explorers = {
      'Ethereum Mainnet': 'https://etherscan.io',
      'Sepolia Testnet': 'https://sepolia.etherscan.io',
      'Goerli Testnet': 'https://goerli.etherscan.io',
      'YeYing Network': 'https://blockscout.yeying.pub',
    };
    
    const baseUrl = explorers[network] || 'https://etherscan.io';
    return `${baseUrl}/tx/${hash}`;
  }
};
