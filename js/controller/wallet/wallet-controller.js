import { isValidAddress, shortenAddress, generateAvatar } from '../../common/chain/index.js';
import {
  showError,
  showSuccess,
  showWaiting,
  hideToast
} from '../../common/ui/index.js';
import { isWalletLockedError } from '../../common/errors/index.js';
import { formatLocaleDateTime, getTimestamp } from '../../common/utils/time-utils.js';

export class WalletController {
  constructor({ wallet, transaction, network }) {
    this.wallet = wallet;
    this.transaction = transaction;
    this.network = network;
  }

  bindEvents() {
    const clearTransactionsBtn = document.getElementById('clearTransactionsBtn');
    if (clearTransactionsBtn) {
      clearTransactionsBtn.addEventListener('click', async () => {
        await this.handleClearTransactions();
      });
    }
  }

  async refreshWalletData() {
    try {
      const account = await this.wallet.getCurrentAccount();
      if (!account) return;

      updateAccountInfo(account);

      const balance = await this.wallet.getBalance(account.address);
      updateBalance(balance);
    } catch (error) {
      console.error('[WalletController] 刷新钱包数据失败:', error);
    }
  }

  async handleRefreshBalance() {
    try {
      const account = await this.wallet.getCurrentAccount();
      if (!account) {
        showError('请先创建或导入钱包');
        return;
      }

      showWaiting();

      const balance = await this.wallet.getBalance(account.address);
      updateBalance(balance);

      showSuccess('余额已更新');
    } catch (error) {
      console.error('[WalletController] 刷新余额失败:', error);
      showError('刷新失败: ' + error.message);
    }
  }

  async handleSendTransaction({ requestPassword } = {}) {
    const recipientInput = document.getElementById('recipientAddress');
    const amountInput = document.getElementById('amount');

    const recipient = recipientInput?.value.trim();
    const amount = amountInput?.value;

    if (!recipient) {
      showError('请输入接收地址');
      return;
    }

    if (!isValidAddress(recipient)) {
      showError('地址格式无效');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      showError('请输入有效金额');
      return;
    }

    const sendTransaction = async () => {
      showWaiting();

      const account = await this.wallet.getCurrentAccount();
      if (!account) {
        throw new Error('未找到账户');
      }

      const chainId = await this.network.getChainId();
      const rpcUrl = await this.network.getRpcUrl();

      const txHash = await this.transaction.sendTransaction({
        from: account.address,
        to: recipient,
        value: this.transaction.parseEther(amount),
        chainId: chainId,
        rpcUrl: rpcUrl
      });

      showSuccess(`交易已发送: ${shortenAddress(txHash)}`);

      recipientInput.value = '';
      amountInput.value = '';

      await this.handleRefreshBalance();
      await this.loadTransactions();
    };

    try {
      await sendTransaction();
    } catch (error) {
      console.error('[WalletController] 发送交易失败:', error);
      if (isWalletLockedError(error) && requestPassword) {
        hideToast();
        const password = await requestPassword();
        if (!password) {
          return;
        }
        try {
          showWaiting('解锁中...');
          const account = await this.wallet.getCurrentAccount();
          await this.wallet.unlock(password, account?.id);
        } catch (unlockError) {
          console.error('[WalletController] 解锁失败:', unlockError);
          showError('密码错误');
          return;
        }
        try {
          await sendTransaction();
        } catch (retryError) {
          console.error('[WalletController] 重试发送失败:', retryError);
          showError('发送失败: ' + retryError.message);
        }
        return;
      }
      showError('发送失败: ' + error.message);
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
      this.renderTransactions(transactions, account.address);
    } catch (error) {
      console.error('[WalletController] 加载交易记录失败:', error);
      this.renderTransactions([]);
    }
  }

  renderTransactions(transactions, currentAddress = null) {
    const container = document.getElementById('transactionList');
    if (!container) return;

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
        const counterparty = isSent ? to : from;
        const amountText = this.transaction.formatTransactionValue(tx?.value || '0', isSent);
        const statusText = this.transaction.getStatusText(tx?.status || 'pending');
        const timeValue = tx?.timestamp ? tx.timestamp : getTimestamp();
        return `
          <div class="transaction-item">
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
      console.error('[WalletController] 清除交易记录失败:', error);
      showError('清除失败: ' + error.message);
    }
  }

}

function updateAccountInfo(account) {
  const nameEl = document.getElementById('accountName');
  if (nameEl) {
    nameEl.textContent = account?.name || '未知账户';
  }

  const avatarEl = document.getElementById('walletAvatar');
  if (avatarEl) {
    avatarEl.innerHTML = '';
    if (account?.address) {
      try {
        const size = avatarEl.clientWidth || 40;
        const canvas = generateAvatar(account.address, size);
        avatarEl.appendChild(canvas);
      } catch (error) {
        avatarEl.textContent = (account?.name || '?').charAt(0).toUpperCase();
      }
    } else {
      avatarEl.textContent = (account?.name || '?').charAt(0).toUpperCase();
    }
  }
}

function updateBalance(balance) {
  const balanceEl = document.getElementById('balance');
  if (balanceEl) {
    const formatted = typeof balance === 'string'
      ? balance
      : parseFloat(balance || 0).toFixed(4);
    balanceEl.textContent = formatted;
  }
}
