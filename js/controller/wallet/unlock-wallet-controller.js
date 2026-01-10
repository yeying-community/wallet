import { showPage, showError, showSuccess, showWaiting } from '../../common/ui/index.js';

export class UnlockWalletController {
  constructor({ wallet, onUnlocked }) {
    this.wallet = wallet;
    this.onUnlocked = onUnlocked;
  }

  bindEvents() {
    const unlockBtn = document.getElementById('unlockBtn');
    if (unlockBtn) {
      unlockBtn.addEventListener('click', async () => {
        await this.handleUnlock();
      });
    }

    const passwordInput = document.getElementById('unlockPassword');
    if (passwordInput) {
      passwordInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
          await this.handleUnlock();
        }
      });
    }
  }

  async handleUnlock() {
    const passwordInput = document.getElementById('unlockPassword');
    const password = passwordInput?.value;

    if (!password) {
      showError('请输入密码');
      return;
    }

    if (password.length < 8) {
      showError('密码至少8位');
      return;
    }

    try {
      showWaiting();

      const currentAccount = await this.wallet.getCurrentAccount();
      await this.wallet.unlock(password, currentAccount?.id);

      showSuccess('解锁成功！');

      setTimeout(async () => {
        showPage('walletPage');
        if (this.onUnlocked) {
          await this.onUnlocked();
        }
        showSuccess('欢迎回来！');
      }, 500);
    } catch (error) {
      console.error('[UnlockWalletController] 解锁失败:', error);
      showError('密码错误');
    }
  }
}
