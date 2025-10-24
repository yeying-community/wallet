const { ethers } = window;

// 网络管理模块
const Network = {
  provider: null,

  // 默认网络配置
  networks: {
    'paix': {
      name: 'YeYing Network',
      rpc: 'https://blockchain.yeying.pub',
      chainId: 5432,
      symbol: 'YYC',
      explorer: 'https://blockscout.yeying.pub',
    }
  },

  // 初始化 Provider
  async initProvider(networkUrl) {
    try {
      this.provider = new ethers.providers.JsonRpcProvider(networkUrl);
      await this.provider.getNetwork(); // 测试连接
      return this.provider;
    } catch (error) {
      console.error('初始化网络失败:', error);
      throw error;
    }
  },

  // 获取当前 Provider
  getProvider() {
    return this.provider;
  },

  // 切换网络
  async switchNetwork(networkUrl) {
    try {
      const testProvider = new ethers.providers.JsonRpcProvider(networkUrl);
      await testProvider.getNetwork(); // 测试连接

      this.provider = testProvider;
      await Storage.saveNetwork(networkUrl);

      return this.provider;
    } catch (error) {
      console.error('切换网络失败:', error);
      throw error;
    }
  },

  // 处理网络选择变化
  async handleNetworkChange() {
    const select = document.getElementById('networkSelect');
    const customInput = document.getElementById('customRpcInput');

    if (select.value === 'custom') {
      UI.toggleCustomRpcInput(true);
    } else {
      UI.toggleCustomRpcInput(false);
      return await this.changeNetwork();
    }
  },

  // 切换网络（从 UI）
  async changeNetwork() {
    if (!WalletManager.wallet) return;

    try {
      const select = document.getElementById('networkSelect');
      const customInput = document.getElementById('customRpcInput');

      let networkUrl;
      if (select.value === 'custom') {
        networkUrl = customInput.value.trim();
        if (!networkUrl) {
          UI.showStatus('请输入有效的RPC URL', 'error');
          return;
        }
      } else {
        networkUrl = select.value;
      }

      const newProvider = await this.switchNetwork(networkUrl);
      WalletManager.wallet = WalletManager.wallet.connect(newProvider);

      await WalletManager.updateBalance();
      UI.showStatus('网络切换成功', 'success');
    } catch (error) {
      console.error('切换网络失败:', error);
      UI.showStatus('网络连接失败，请检查RPC URL', 'error');
    }
  }
};

