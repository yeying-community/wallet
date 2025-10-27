// 交易管理模块
const Transaction = {
  // 发送交易
  async sendTransaction() {
    const recipientAddress = document.getElementById('recipientAddress').value.trim();
    const amount = document.getElementById('amount').value.trim();

    // 验证输入
    if (!this.validateTransactionInputs(recipientAddress, amount)) {
      return;
    }

    try {
      UI.showToast('正在发送交易...', 'info');

      const wallet = WalletManager.getWallet();
      // 🔥 准备交易参数
      const txParams = {
         to: recipientAddress,
         value: ethers.utils.parseEther(amount)
      };

      // 🔥 发送交易
      const tx = await wallet.sendTransaction(txParams);

      console.log('✅ Transaction sent:', tx.hash);
      UI.showToast('交易已提交，等待确认...', 'info');

      // 🔥 立即保存交易历史（pending 状态）
      await this.saveTransactionToHistory({
        hash: tx.hash,
        from: wallet.address,
        to: recipientAddress,
        value: txParams.value.toHexString(),
        timestamp: Date.now(),
        status: 'pending',
        network: await this.getCurrentNetworkName(),
        source: 'wallet' // 标记来源
      });

      // 🔥 等待交易确认
      const receipt = await tx.wait();
      console.log('✅ Transaction confirmed:', receipt);
      UI.showToast('交易成功！', 'success');

      // 🔥 更新交易状态
      await this.updateTransactionStatus(tx.hash, receipt.status === 1 ? 'success' : 'failed');

      document.getElementById('recipientAddress').value = '';
      document.getElementById('amount').value = '';

      // 更新余额
      setTimeout(() => WalletManager.updateBalance(), 2000);
    } catch (error) {
      console.error('❌ Transaction failed:', error);
      this.handleTransactionError(error);
    }
  },

  // 验证交易输入
  validateTransactionInputs(recipientAddress, amount) {
    if (!recipientAddress || !amount) {
      UI.showToast('请填写完整信息', 'error');
      return false;
    }

    if (!ethers.utils.isAddress(recipientAddress)) {
      UI.showToast('接收地址格式不正确', 'error');
      return false;
    }

    if (parseFloat(amount) <= 0) {
      UI.showToast('金额必须大于0', 'error');
      return false;
    }

    return true;
  },

  // 处理交易错误
  handleTransactionError(error) {
    let errorMsg = '交易失败';

    if (error.code === 'INSUFFICIENT_FUNDS') {
      errorMsg = '余额不足';
    } else if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
      errorMsg = '无法估算 Gas，请检查接收地址';
    } else if (error.code === 'NETWORK_ERROR') {
      errorMsg = '网络错误，请检查网络连接';
    } else if (error.message) {
       errorMsg = error.message.substring(0, 100);
    }

    UI.showToast(errorMsg, 'error', 5000);
  },

  // 估算 Gas
  async estimateGas(to, value) {
    try {
      const wallet = WalletManager.getWallet();
      const gasLimit = await wallet.estimateGas({
        to: to,
        value: ethers.utils.parseEther(value)
      });
      return gasLimit;
    } catch (error) {
      console.error('估算 Gas 失败:', error);
      throw error;
    }
  },

  // 🔥 保存交易到历史记录
  async saveTransactionToHistory(txData) {
    try {
      const result = await chrome.storage.local.get('transactionHistory');
      const history = result.transactionHistory || [];

      // 添加到历史记录开头
      history.unshift(txData);

      // 只保留最近 100 条
      if (history.length > 100) {
        history.splice(100);
      }

      await chrome.storage.local.set({ transactionHistory: history });

      console.log('✅ Transaction saved to history:', txData.hash);

      return true;
    } catch (error) {
      console.error('❌ Save transaction history failed:', error);
      return false;
    }
  },

  // 🔥 获取当前网络名称
  async getCurrentNetworkName() {
    try {
      const result = await chrome.storage.local.get('selectedNetwork');
      const networkKey = result.selectedNetwork || 'yeying';

      const networkNames = {
        'mainnet': 'Ethereum Mainnet',
        'yeying': 'YeYing Network',
        'sepolia': 'Sepolia Testnet',
        'goerli': 'Goerli Testnet',
      };

      return networkNames[networkKey] || 'YeYing Network';
    } catch (error) {
      console.error('获取网络名称失败:', error);
      return 'Unknown Network';
    }
  },

  // 🔥 更新交易状态
  async updateTransactionStatus(hash, status) {
    try {
      const result = await chrome.storage.local.get('transactionHistory');
      const history = result.transactionHistory || [];

      const tx = history.find(t => t.hash === hash);
      if (tx) {
        tx.status = status;
        await chrome.storage.local.set({ transactionHistory: history });
        console.log('✅ Transaction status updated:', hash, status);
      }
      return true;
    } catch (error) {
      console.error('❌ Update transaction status failed:', error);
      return false;
    }
  },
};

