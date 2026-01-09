import { showPage, showStatus, showSuccess } from '../../common/ui/index.js';

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
      showStatus('unlockStatus', '请输入密码', 'error');
      return;
    }

    if (password.length < 8) {
      showStatus('unlockStatus', '密码至少8位', 'error');
      return;
    }

    try {
      showStatus('unlockStatus', '解锁中...', 'info');

      const currentAccount = await this.wallet.getCurrentAccount();
      await this.wallet.unlock(password, currentAccount?.id);

      showStatus('unlockStatus', '解锁成功！', 'success');

      setTimeout(async () => {
        showPage('walletPage');
        if (this.onUnlocked) {
          await this.onUnlocked();
        }
        showSuccess('欢迎回来！');
      }, 500);
    } catch (error) {
      console.error('[UnlockWalletController] 解锁失败:', error);
      showStatus('unlockStatus', '密码错误', 'error');
    }
  }
}
