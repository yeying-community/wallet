import { showWaiting, showSuccess, showError } from '../../common/ui/index.js';

export class TokenBalanceController {
  constructor({ wallet } = {}) {
    this.wallet = wallet;
  }

  async refreshBalance({ silent = false } = {}) {
    if (!this.wallet) return;
    try {
      if (!silent) {
        showWaiting();
      }
      const account = await this.wallet.getCurrentAccount();
      if (!account) {
        if (!silent) {
          showError('请先创建或导入钱包');
        }
        return;
      }
      const balance = await this.wallet.getBalance(account.address);
      this.updateBalance(balance);
      if (!silent) {
        showSuccess('余额已更新');
      }
    } catch (error) {
      if (!silent) {
        showError('刷新失败: ' + error.message);
      } else {
        console.warn('[TokenBalanceController] 静默刷新余额失败:', error);
      }
    }
  }

  async refreshBalanceSilently() {
    await this.refreshBalance({ silent: true });
  }

  updateBalance(balance) {
    const balanceEl = document.getElementById('balance');
    if (!balanceEl) return;
    const formatted = typeof balance === 'string'
      ? balance
      : parseFloat(balance || 0).toFixed(4);
    balanceEl.textContent = formatted;
  }
}
