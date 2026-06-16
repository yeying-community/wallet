import { shortenAddress } from '../../common/chain/index.js';
import { showError, showSuccess } from '../../common/ui/index.js';
import { formatLocaleDateTime, getTimestamp } from '../../common/utils/time-utils.js';

export class TransactionListController {
  constructor({ wallet, transaction, network, detailController } = {}) {
    this.wallet = wallet;
    this.transaction = transaction;
    this.network = network;
    this.detailController = detailController || null;
    this.lastTransactions = [];
    this.activityScrollTop = 0;
  }

  setDetailController(controller) {
    this.detailController = controller;
  }

  bindEvents() {
    const clearTransactionsBtn = document.getElementById('clearTransactionsBtn');
    if (clearTransactionsBtn) {
      clearTransactionsBtn.addEventListener('click', async () => {
        await this.handleClearTransactions();
      });
    }
  }

  async loadTransactions() {
    try {
      const account = await this.wallet.getCurrentAccount();
      if (!account) {
        this.renderTransactions([]);
        return;
      }
      let chainId = null;
      try {
        chainId = await this.network?.getChainId?.();
      } catch (error) {
        chainId = null;
      }
      const transactions = await this.transaction.getTransactions(account.address, chainId);
      this.lastTransactions = Array.isArray(transactions) ? transactions : [];
      this.renderTransactions(this.lastTransactions, account.address);
    } catch (error) {
      console.error('[TransactionListController] 加载交易记录失败:', error);
      this.lastTransactions = [];
      this.renderTransactions([]);
    }
  }

  renderTransactions(transactions, currentAddress = null) {
    const container = document.getElementById('transactionList');
    if (!container) return;
    const previousScrollTop = container.scrollTop;

    if (!transactions || transactions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>📭</p>
          <p>暂无交易记录</p>
        </div>
      `;
      return;
    }

    const normalizedCurrent = currentAddress ? currentAddress.toLowerCase() : null;
    container.innerHTML = transactions
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 50)
      .map(tx => {
        const from = tx?.from || '';
        const to = tx?.to || '';
        const isSent = normalizedCurrent
          ? from.toLowerCase() === normalizedCurrent
          : Boolean(tx?.hash);
        const token = tx?.token || null;
        const counterparty = token?.recipient || (isSent ? to : from);
        const amountText = this.formatTransactionAmount(tx, isSent);
        const statusText = this.transaction.getStatusText(tx?.status || 'pending');
        const timeValue = tx?.timestamp ? tx.timestamp : getTimestamp();
        return `
          <div class="transaction-item" data-tx-hash="${tx?.hash || ''}">
            <div class="tx-icon">${isSent ? '↗' : '↙'}</div>
            <div class="tx-info">
              <div class="tx-type">${isSent ? '发送' : '接收'}</div>
              <div class="tx-address">${shortenAddress(counterparty || '')}</div>
              <div class="tx-time">${formatLocaleDateTime(timeValue)}</div>
            </div>
            <div class="tx-amount">
              <div class="tx-value">${amountText}</div>
              <div class="tx-status ${tx?.status || 'pending'}">${statusText}</div>
            </div>
          </div>
        `;
      }).join('');

    container.querySelectorAll('.transaction-item').forEach((item) => {
      item.addEventListener('click', () => {
        const hash = item.dataset.txHash;
        if (!hash) return;
        this.openTransactionDetail(hash);
      });
    });

    container.scrollTop = previousScrollTop;
  }

  formatTransactionAmount(tx, isSent) {
    const token = tx?.token || null;
    if (token?.amount) {
      const decimals = Number.isFinite(Number(token.decimals)) ? Number(token.decimals) : 18;
      const value = this.transaction?.formatUnits?.(token.amount, decimals) || '0';
      const prefix = isSent ? '-' : '+';
      return `${prefix}${value} ${token.symbol || 'TOKEN'}`;
    }
    return this.transaction.formatTransactionValue(tx?.value || '0', isSent);
  }

  openTransactionDetail(txHash) {
    this.storeActivityScrollPosition();
    const hashKey = String(txHash || '').toLowerCase();
    const tx = this.lastTransactions.find(item => String(item?.hash || '').toLowerCase() === hashKey);
    if (!tx) {
      showError('交易信息不存在');
      return;
    }
    if (this.detailController?.openTransactionDetail) {
      this.detailController.openTransactionDetail(tx);
      return;
    }
    showError('交易详情不可用');
  }

  storeActivityScrollPosition() {
    const list = document.getElementById('transactionList');
    if (!list) return;
    this.activityScrollTop = list.scrollTop;
  }

  restoreActivityScrollPosition() {
    const list = document.getElementById('transactionList');
    if (!list) return;
    const target = Number.isFinite(this.activityScrollTop) ? this.activityScrollTop : 0;
    requestAnimationFrame(() => {
      list.scrollTop = target;
    });
  }

  async handleClearTransactions() {
    if (!confirm('确定要清除所有交易记录吗？')) {
      return;
    }

    try {
      const account = await this.wallet.getCurrentAccount();
      let chainId = null;
      try {
        chainId = await this.network?.getChainId?.();
      } catch (error) {
        chainId = null;
      }
      await this.transaction.clearTransactions(account?.address || null, chainId);
      this.renderTransactions([]);
      showSuccess('交易记录已清除');
    } catch (error) {
      console.error('[TransactionListController] 清除交易记录失败:', error);
      showError('清除失败: ' + error.message);
    }
  }
}
