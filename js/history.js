// 交易历史管理
const TransactionHistory = {
  // 加载交易历史
  async loadHistory() {
    try {
      const result = await chrome.storage.local.get('transactionHistory');
      const history = result.transactionHistory || [];

      console.log('📜 Loading transaction history:', history.length, 'transactions');

      const listEl = document.getElementById('transactionList');

      if (!listEl) {
        console.error('❌ Transaction list element not found');
        return;
      }

      if (history.length === 0) {
        listEl.innerHTML = `
          <div class="empty-state">
            <p style="font-size: 48px; margin: 20px 0;">📭</p>
            <p style="font-size: 16px; color: #666;">暂无交易记录</p>
            <p style="font-size: 12px; color: #999; margin-top: 10px;">
              发送交易后将在这里显示
            </p>
          </div>
        `;
        return;
      }

      listEl.innerHTML = history.map(tx => this.renderTransaction(tx)).join('');

    } catch (error) {
      console.error('❌ Load history failed:', error);
      const listEl = document.getElementById('transactionList');
      if (listEl) {
        listEl.innerHTML = `
          <div class="empty-state">
            <p style="color: red;">加载失败</p>
            <p style="font-size: 12px;">${error.message}</p>
          </div>
        `;
      }
    }
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

    const statusClass = {
      'pending': 'status-pending',
      'success': 'status-success',
      'failed': 'status-failed'
    }[tx.status] || '';

    const date = new Date(tx.timestamp).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    let value;
    try {
      value = ethers.utils.formatEther(tx.value);
    } catch (error) {
      console.error('Format value error:', error, tx.value);
      value = '0';
    }

    // 🔥 判断交易类型（发送/接收）
    const session = WalletManager.currentWallet;
    const isSent = session && tx.from.toLowerCase() === session.address.toLowerCase();
    const txType = isSent ? '发送' : '接收';
    const txSign = isSent ? '-' : '+';
    const txColor = isSent ? '#ff4444' : '#00cc66';

    return `
      <div class="transaction-item" data-hash="${tx.hash}">
        <div class="tx-icon">${statusIcon}</div>
        <div class="tx-info">
          <div class="tx-type">${txType}</div>
          <div class="tx-address">${this.formatAddress(isSent ? tx.to : tx.from)}</div>
          <div class="tx-time">${date}</div>
        </div>
        <div class="tx-amount">
          <div class="tx-value" style="color: ${txColor}">
            ${txSign}${parseFloat(value).toFixed(4)} ETH
          </div>
          <div class="tx-status ${statusClass}">${statusText}</div>
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

    const value = ethers.utils.formatEther(tx.value);
    const date = new Date(tx.timestamp).toLocaleString('zh-CN');

    const detail = `
交易详情
━━━━━━━━━━━━━━━━━━━━
状态: ${tx.status}
金额: ${value} ETH
━━━━━━━━━━━━━━━━━━━━
发送方: ${tx.from}
接收方: ${tx.to}
━━━━━━━━━━━━━━━━━━━━
交易哈希: ${tx.hash}
时间: ${date}
网络: ${tx.network}
━━━━━━━━━━━━━━━━━━━━

点击确定在区块浏览器中查看
    `.trim();

    if (confirm(detail)) {
      chrome.tabs.create({ url: explorerUrl });
    }
  },

  // 获取区块浏览器 URL
  getExplorerUrl(hash, network) {
    const explorers = {
      'Ethereum Mainnet': 'https://etherscan.io',
      'Sepolia Testnet': 'https://sepolia.etherscan.io',
      'Goerli Testnet': 'https://goerli.etherscan.io',
      'YeYing Network': 'https://blockscout.yeying.pub'
    };
    
    const baseUrl = explorers[network] || 'https://blockscout.yeying.pub';
    return `${baseUrl}/tx/${hash}`;
  },

    // 🔥 清除所有历史记录
  async clearHistory() {
    if (!confirm('确定要清除所有交易历史吗？此操作不可恢复。')) {
      return;
    }
    
    try {
      await chrome.storage.local.set({ transactionHistory: [] });
      await this.loadHistory();
      UI.showToast('历史记录已清除', 'success');
    } catch (error) {
      console.error('清除历史失败:', error);
      UI.showToast('清除失败: ' + error.message, 'error');
    }
  },
};

