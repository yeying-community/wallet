// 钱包管理模块
const WalletManager = {
  wallet: null,
  currentPassword: null, // 临时存储当前会话密码

  // 创建钱包（需要密码）
  async createWallet() {
    const wallet = ethers.Wallet.createRandom();

    // 临时存储私钥，等待设置密码
    sessionStorage.setItem('temp_private_key', wallet.privateKey);

    // 保存助记词
    sessionStorage.setItem('temp_mnemonic', wallet.mnemonic.phrase);

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
      const mnemonic = sessionStorage.getItem('temp_mnemonic');

      // 加密保存
      await Storage.saveEncryptedWallet(privateKey, password, mnemonic);

      // 清除临时数据
      sessionStorage.removeItem('temp_private_key');
      sessionStorage.removeItem('temp_mnemonic');

      // 加载钱包
      this.currentPassword = password;
      await this.loadWallet(privateKey, mnemonic);

      UI.showPage('wallet');
      UI.showStatus('钱包创建成功！', 'success');
    } catch (error) {
      console.error('设置密码失败:', error);
      UI.showStatus('设置密码失败', 'error', 'passwordStatus');
    }
  },

  // 导入钱包（需要密码）
  async importWallet() {
    const input = document.getElementById('privateKeyInput').value.trim();

    if (!input) {
      UI.showStatus('请输入私钥或助记词', 'error', 'importStatus');
      return;
    }

    try {
      let wallet;
      if (input.split(' ').length >= 12) {
        // 助记词导入
        wallet = ethers.Wallet.fromMnemonic(input);
        sessionStorage.setItem('temp_mnemonic', input);
        sessionStorage.setItem('temp_private_key', wallet.privateKey);
      } else {
        // 私钥导入
        wallet = new ethers.Wallet(input);
        sessionStorage.setItem('temp_private_key', input);
        sessionStorage.removeItem('temp_mnemonic');
      }

      UI.showPage('setPassword');
    } catch (error) {
      UI.showStatus('私钥或助记词格式不正确', 'error', 'importStatus');
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

      let privateKey;
      let wallet;
      let mnemonic;

      // 先尝试读取加密的助记词
      const encryptedMnemonic = await Storage.getEncryptedMnemonic();
      if (encryptedMnemonic) {
        // 解密助记词
        mnemonic = await Storage.decryptString(encryptedMnemonic, password);
        // 从助记词恢复钱包
        wallet = ethers.Wallet.fromMnemonic(mnemonic);
      } else {
        // 如果没有助记词，则用加密的私钥恢复
        const encryptedPrivateKey = await Storage.getEncryptedPrivateKey();
        if (!encryptedPrivateKey) {
          throw new Error('没有找到钱包数据');
        }
        privateKey = await Storage.decryptString(encryptedPrivateKey, password);
        wallet = new ethers.Wallet(privateKey);
      }

      // 保存到 session storage (仅在当前会话有效)
      await chrome.storage.session.set({
        wallet_privateKey: privateKey,
        wallet_address: wallet.address
      });

      // 更新过期时间
      await Storage.updateExpireTime();

      // 加载钱包
      this.currentPassword = password;
      await this.loadWallet(privateKey, mnemonic);

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
  async loadWallet(privateKey, mnemonic) {
    try {
      // 获取当前网络
      const networkUrl = document.getElementById('networkSelect').value;
      const provider = await Network.initProvider(networkUrl);

      // 创建钱包实例
      if (mnemonic) {
        // 如果有助记词，用助记词恢复钱包
        this.wallet = ethers.Wallet.fromMnemonic(mnemonic).connect(provider);
      } else {
        // 否则用私钥恢复
        this.wallet = new ethers.Wallet(privateKey, provider);
      }

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

  showMnemonic() {
    if (!this.wallet || !this.wallet.mnemonic) {
      UI.showStatus('当前钱包没有助记词', 'error');
      return;
    }
    UI.toggleMnemonic(this.wallet.mnemonic.phrase);
  },

  copyMnemonic() {
    if (this.wallet && this.wallet.mnemonic) {
      Utils.copyToClipboard(this.wallet.mnemonic.phrase);
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
