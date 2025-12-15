const WalletManager = {
  wallet: null,
  currentAccount: null,
  currentPassword: null,

  // 初始化钱包
  async init() {
    try {
      console.log('🔄 Initializing wallet...');

      // 检查是否有账户
      const hasAccounts = await Storage.hasAccounts();

      if (!hasAccounts) {
        console.log('📝 No accounts found, showing welcome page');
        UI.showPage('welcome');
        return;
      }

      console.log('✅ Accounts found');

      // 检查 URL 参数（处理外部解锁请求）
      const urlParams = new URLSearchParams(window.location.search);
      const action = urlParams.get('action');
      const origin = urlParams.get('origin');

      if (action === 'unlock' && origin) {
        console.log('🔐 External unlock request from:', origin);

        // 获取当前账户信息（用于显示头像和名称）
        const currentAccount = await Storage.getCurrentAccount();
        if (currentAccount) {
          this.currentAccount = currentAccount;
          UI.updateAvatar(currentAccount.address);
          UI.updateAccountName(currentAccount.name);
        }

        UI.showPage('unlock');
        UI.showUnlockReason(decodeURIComponent(origin));

        // 启动自动锁定检查（即使在解锁页面也需要）
        this.startAutoLockCheck();
        return;
      }

      // 检查会话是否过期
      const isExpired = await Storage.isExpired();

      if (isExpired) {
        console.log('🔒 Session expired, showing unlock page');

        // 获取当前账户信息（不需要密码）
        const currentAccount = await Storage.getCurrentAccount();
        if (currentAccount) {
          this.currentAccount = currentAccount;
          // 显示账户信息但不显示余额
          UI.updateAvatar(currentAccount.address);
          UI.updateAccountName(currentAccount.name);
        }

        UI.showPage('unlock');
      } else {
        console.log('✅ Session valid, loading wallet from session');
        await this.loadWalletFromSession();
      }

      // 启动自动锁定检查
      this.startAutoLockCheck();

    } catch (error) {
      console.error('❌ Wallet init failed:', error);
      UI.showPage('welcome');
    }
  },

  // 从 session 加载钱包
  async loadWalletFromSession() {
    try {
      const session = await chrome.storage.session.get([
        'wallet_privateKey',
        'wallet_address',
        'current_account_id'
      ]);

      console.log('📦 Session data:', {
        hasPrivateKey: !!session.wallet_privateKey,
        hasAddress: !!session.wallet_address,
        hasAccountId: !!session.current_account_id
      });

      if (!session.wallet_privateKey || !session.current_account_id) {
        throw new Error('Session data not found');
      }

      // 获取账户信息
      this.currentAccount = await AccountManager.getAccount(session.current_account_id);

      if (!this.currentAccount) {
        throw new Error('Account not found');
      }

      console.log('✅ Account loaded:', this.currentAccount.name);

      // 创建钱包实例
      const networkUrl = document.getElementById('networkSelect')?.value || 'https://blockchain.yeying.pub';
      const provider = await Network.initProvider(networkUrl);
      this.wallet = new ethers.Wallet(session.wallet_privateKey, provider);

      // 验证地址
      if (this.wallet.address.toLowerCase() !== this.currentAccount.address.toLowerCase()) {
        throw new Error('Address mismatch');
      }

      console.log('✅ Wallet address verified:', this.wallet.address);

      // 🔥 先显示页面，再更新 UI
      UI.showPage('wallet');

      // 更新 UI
      UI.updateAvatar(this.wallet.address);
      UI.updateAccountName(this.currentAccount.name);

      // 更新余额
      await this.updateBalance();

      // 生成二维码
      Utils.generateQRCode(this.wallet.address, 'qrcode');

      console.log('✅ Wallet loaded from session');

    } catch (error) {
      console.error('❌ Load wallet from session failed:', error);
      // 清除无效的 session
      await chrome.storage.session.clear();
      UI.showPage('unlock');
    }
  },

  // 创建新钱包（主账户）
  async createWallet() {
    try {
      // 生成助记词
      const wallet = ethers.Wallet.createRandom();
      const mnemonic = wallet.mnemonic.phrase;

      // 临时存储
      sessionStorage.setItem('temp_mnemonic', mnemonic);
      sessionStorage.setItem('temp_action', 'create');

      // 显示设置密码页面
      UI.showPage('setPassword');

    } catch (error) {
      console.error('❌ Create wallet failed:', error);
      UI.showStatus('创建钱包失败', 'error');
    }
  },

  // 导入钱包（主账户）
  async importWallet() {
    try {
      const input = document.getElementById('privateKeyInput').value.trim();

      if (!input) {
        UI.showStatus('请输入助记词', 'error', 'importStatus');
        return;
      }

      // 验证助记词
      const words = input.split(/\s+/);
      if (words.length !== 12 && words.length !== 24) {
        UI.showStatus('助记词必须是12或24个单词', 'error', 'importStatus');
        return;
      }

      // 验证助记词有效性
      try {
        const wallet = ethers.Wallet.fromMnemonic(input);

        // 临时存储
        sessionStorage.setItem('temp_mnemonic', input);
        sessionStorage.setItem('temp_action', 'import');

        // 显示设置密码页面
        UI.showPage('setPassword');

      } catch (error) {
        UI.showStatus('助记词格式不正确', 'error', 'importStatus');
      }

    } catch (error) {
      console.error('❌ Import wallet failed:', error);
      UI.showStatus('导入失败', 'error', 'importStatus');
    }
  },

  // 设置密码并创建账户
  async setPassword() {
    try {
      const password = document.getElementById('newPassword').value;
      const confirmPassword = document.getElementById('confirmPassword').value;
      const accountName = document.getElementById('setAccountName').value.trim() || '主账户';

      // 验证密码
      if (!password || password.length < 8) {
        UI.showStatus('密码至少需要8位字符', 'error', 'passwordStatus');
        return;
      }

      if (password !== confirmPassword) {
        UI.showStatus('两次密码不一致', 'error', 'passwordStatus');
        return;
      }

      // 获取临时数据
      const mnemonic = sessionStorage.getItem('temp_mnemonic');
      const action = sessionStorage.getItem('temp_action');

      if (!mnemonic) {
        throw new Error('No mnemonic found');
      }

      UI.showStatus('正在创建账户...', 'info', 'passwordStatus');

      // 创建主账户
      const mainAccount = await Storage.createMainAccount(
        accountName,
        mnemonic,
        password
      );

      // 获取钱包实例
      const wallet = await AccountManager.getAccountWallet(mainAccount.id, password);

      // 保存到 session
      await chrome.storage.session.set({
        wallet_address: wallet.address,
        wallet_privateKey: wallet.privateKey,
        wallet_password: password,
        current_account_id: mainAccount.id
      });

      // 更新过期时间
      await Storage.updateExpireTime();

      // 清除临时数据
      sessionStorage.removeItem('temp_mnemonic');
      sessionStorage.removeItem('temp_action');

      // 设置当前账户
      this.currentAccount = mainAccount;
      this.currentPassword = password;

      // 加载钱包
      const networkUrl = document.getElementById('networkSelect').value;
      const provider = await Network.initProvider(networkUrl);
      this.wallet = wallet.connect(provider);

      // 更新 UI
      UI.updateAvatar(this.wallet.address);
      UI.updateAccountName(mainAccount.name);
      await this.updateBalance();
      Utils.generateQRCode(this.wallet.address, 'qrcode');

      // 如果是创建新钱包，显示助记词
      if (action === 'create') {
        UI.showMnemonicBackup(mnemonic);
      } else {
        UI.showPage('wallet');
        UI.showToast('账户导入成功！', 'success');
      }

    } catch (error) {
      console.error('❌ Set password failed:', error);
      UI.showStatus('设置密码失败: ' + error.message, 'error', 'passwordStatus');
    }
  },

  // 解锁钱包
  async unlockWallet() {
    try {
      const password = document.getElementById('unlockPassword').value;

      if (!password) {
        UI.showStatus('请输入密码', 'error', 'unlockStatus');
        return;
      }

      UI.showStatus('正在解锁...', 'info', 'unlockStatus');

      // 获取当前账户
      let currentAccount = await Storage.getCurrentAccount();

      // 如果没有当前账户，选择第一个
      if (!currentAccount) {
        const accounts = await Storage.getAllAccounts();
        const firstAccount = Object.values(accounts)[0];
        if (!firstAccount) {
          throw new Error('没有找到账户');
        }
        await Storage.setCurrentAccount(firstAccount.id);
        currentAccount = firstAccount;
      }

      // 获取钱包实例（这会验证密码）
      const wallet = await AccountManager.getAccountWallet(currentAccount.id, password);

      // 保存到 session
      await chrome.storage.session.set({
        wallet_address: wallet.address,
        wallet_privateKey: wallet.privateKey,
        wallet_password: password,
        current_account_id: currentAccount.id
      });

      // 更新过期时间
      await Storage.updateExpireTime();

      // 设置当前状态
      this.currentAccount = currentAccount;
      this.currentPassword = password;

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
        });

        // 关闭弹窗
        window.close();
        return;
      }

      // 正常解锁流程 - 加载钱包
      const networkUrl = document.getElementById('networkSelect').value;
      const provider = await Network.initProvider(networkUrl);
      this.wallet = wallet.connect(provider);

      // 更新 UI
      UI.updateAvatar(this.wallet.address);
      UI.updateAccountName(currentAccount.name);
      await this.updateBalance();
      Utils.generateQRCode(this.wallet.address, 'qrcode');

      UI.showPage('wallet');
      UI.showToast('解锁成功！', 'success');

    } catch (error) {
      console.error('❌ Unlock failed:', error);
      UI.showStatus('密码错误或账户不存在', 'error', 'unlockStatus');
    }
  },

  // 切换账户
  async switchAccount(accountId) {
    try {
      // 优先从 session 获取密码
      let password = this.currentPassword;

      if (!password) {
        const sessionData = await chrome.storage.session.get('wallet_password');
        password = sessionData.wallet_password;
      }

      if (!password) {
        console.warn('⚠️ No password available, prompting user');
        password = prompt('请输入密码以切换账户：');
        if (!password) {
          console.log('❌ User cancelled password input');
          return;
        }
      }

      // 获取账户
      const account = await Storage.getAccount(accountId);
      if (!account) {
        throw new Error('账户不存在');
      }

      // 获取钱包实例
      const wallet = await AccountManager.getAccountWallet(accountId, password);

      // 设置为当前账户
      await Storage.setCurrentAccount(accountId);

      // 更新 session
      await chrome.storage.session.set({
        wallet_address: wallet.address,
        wallet_privateKey: wallet.privateKey,
        wallet_password: password,
        current_account_id: accountId
      });

      // 更新过期时间
      await Storage.updateExpireTime();

      // 更新当前状态
      this.currentAccount = account;
      this.currentPassword = password;

      // 重新连接 provider
      const networkUrl = document.getElementById('networkSelect').value;
      const provider = await Network.initProvider(networkUrl);
      this.wallet = wallet.connect(provider);

      // 更新 UI
      UI.updateAvatar(this.wallet.address);
      UI.updateAccountName(account.name);
      await this.updateBalance();
      Utils.generateQRCode(this.wallet.address, 'qrcode');

      UI.showToast('账户切换成功！', 'success');

    } catch (error) {
      console.error('❌ Switch account failed:', error);
      UI.showToast('切换账户失败: ' + error.message, 'error');
      this.currentPassword = null; // 清除密码，下次重新输入
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
      console.error('❌ Get balance failed:', error);
      UI.showStatus('获取余额失败', 'error');
    }
  },

  // 显示助记词
  async showMnemonic() {
    try {
      if (!this.currentAccount) {
        UI.showToast('请先解锁钱包', 'error');
        return;
      }

      // 只有主账户才有助记词
      if (this.currentAccount.type !== 'main') {
        UI.showToast('子账户没有独立的助记词，请查看主账户', 'info');
        return;
      }

      // 需要密码
      if (!this.currentPassword) {
        const password = prompt('请输入密码以查看助记词：');
        if (!password) return;
        this.currentPassword = password;
      }

      // 解密助记词
      const mnemonic = await Utils.decryptString(
        this.currentAccount.encryptedMnemonic,
        this.currentPassword
      );

      UI.toggleMnemonic(mnemonic);

    } catch (error) {
      console.error('❌ Show mnemonic failed:', error);
      UI.showToast('密码错误', 'error');
      this.currentPassword = null;
    }
  },

  // 复制助记词
  async copyMnemonic() {
    try {
      if (!this.currentAccount || this.currentAccount.type !== 'main') {
        UI.showToast('当前账户没有助记词', 'error');
        return;
      }

      if (!this.currentPassword) {
        const password = prompt('请输入密码以复制助记词：');
        if (!password) return;
        this.currentPassword = password;
      }

      const mnemonic = await Utils.decryptString(
        this.currentAccount.encryptedMnemonic,
        this.currentPassword
      );

      Utils.copyToClipboard(mnemonic);
      UI.showToast('助记词已复制', 'success');

    } catch (error) {
      console.error('❌ Copy mnemonic failed:', error);
      UI.showToast('密码错误', 'error');
      this.currentPassword = null;
    }
  },

  // 显示私钥
  async showPrivateKey() {
    try {
      if (!this.wallet) {
        UI.showToast('请先解锁钱包', 'error');
        return;
      }

      UI.togglePrivateKey(this.wallet.privateKey);

    } catch (error) {
      console.error('❌ Show private key failed:', error);
      UI.showToast('获取私钥失败', 'error');
    }
  },

  // 复制私钥
  copyPrivateKey() {
    if (this.wallet) {
      Utils.copyToClipboard(this.wallet.privateKey);
      UI.showToast('私钥已复制', 'success');
    }
  },

  // 重置钱包（删除所有账户）
  async resetWallet() {
    try {
      const confirmed = confirm(
        '⚠️ 警告：这将删除所有账户和数据！\n\n' +
        '请确保已备份所有助记词和私钥！\n\n' +
        '确定要继续吗？'
      );

      if (!confirmed) return;

      const doubleConfirm = prompt('请输入 "DELETE" 以确认删除：');
      if (doubleConfirm !== 'DELETE') {
        UI.showToast('已取消', 'info');
        return;
      }

      // 清除所有数据
      await chrome.storage.local.clear();
      await chrome.storage.session.clear();

      // 重置状态
      this.wallet = null;
      this.currentAccount = null;
      this.currentPassword = null;

      UI.showPage('welcome');
      UI.showToast('钱包已重置', 'success');

    } catch (error) {
      console.error('❌ Reset wallet failed:', error);
      UI.showToast('重置失败', 'error');
    }
  },

  // 登出（锁定钱包）
  async logout() {
    try {
      // 清除 session
      await chrome.storage.session.clear();

      // 重置状态
      this.wallet = null;
      this.currentPassword = null;

      UI.showPage('unlock');
      UI.showToast('已登出', 'success');

    } catch (error) {
      console.error('❌ Logout failed:', error);
      UI.showToast('登出失败', 'error');
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
        console.log('🔒 Session expired, locking wallet');
        await this.logout();
      }
    }, 60000); // 每分钟检查一次
  },
};
