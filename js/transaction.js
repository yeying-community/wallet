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
      UI.showStatus('正在发送交易...', 'info', 'sendStatus');

      const wallet = WalletManager.getWallet();
      const tx = await wallet.sendTransaction({
        to: recipientAddress,
        value: ethers.utils.parseEther(amount)
      });

      UI.showStatus('交易已提交，等待确认...', 'info', 'sendStatus');

      await tx.wait();

      UI.showStatus('交易成功！交易哈希: ' + tx.hash.substring(0, 10) + '...', 'success', 'sendStatus');

      // 清空表单
      UI.clearSendForm();

      // 更新余额
      setTimeout(() => WalletManager.updateBalance(), 2000);
    } catch (error) {
      console.error('交易失败:', error);
      this.handleTransactionError(error);
    }
  },

  // 验证交易输入
  validateTransactionInputs(recipientAddress, amount) {
    if (!recipientAddress || !amount) {
      UI.showStatus('请填写完整信息', 'error', 'sendStatus');
      return false;
    }

    if (!ethers.utils.isAddress(recipientAddress)) {
      UI.showStatus('接收地址格式不正确', 'error', 'sendStatus');
      return false;
    }

    if (parseFloat(amount) <= 0) {
      UI.showStatus('金额必须大于0', 'error', 'sendStatus');
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
      errorMsg = error.message.substring(0, 50);
    }

    UI.showStatus(errorMsg, 'error', 'sendStatus');
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

  // 获取交易历史（需要区块链浏览器 API）
  async getTransactionHistory(address, limit = 10) {
    // 这里可以集成 Etherscan API 或其他区块链浏览器 API
    // 暂时返回空数组
    return [];
  }
};

