import { showPage, showError, showSuccess, getPageOrigin } from '../../common/ui/index.js';

export class CreateWalletController {
  constructor({ wallet, onCreated }) {
    this.wallet = wallet;
    this.onCreated = onCreated;
  }

  bindEvents() {
    const setPasswordBtn = document.getElementById('setPasswordBtn');
    if (setPasswordBtn) {
      setPasswordBtn.addEventListener('click', async () => {
        await this.handleCreateWallet();
      });
    }

    const cancelPasswordBtn = document.getElementById('cancelPasswordBtn');
    if (cancelPasswordBtn) {
      cancelPasswordBtn.addEventListener('click', () => {
        this.handleCancel();
      });
    }

    const confirmInput = document.getElementById('confirmPassword');
    if (confirmInput) {
      confirmInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
          await this.handleCreateWallet();
        }
      });
    }
  }

  async handleCreateWallet() {
    const name = document.getElementById('setWalletName')?.value.trim() || '主钱包';
    const password = document.getElementById('newPassword')?.value;
    const confirmPassword = document.getElementById('confirmPassword')?.value;
    const origin = getPageOrigin('setPasswordPage', 'welcome');
    const useExistingPassword = origin === 'accounts';

    if (!password) {
      showError(useExistingPassword ? '请输入当前密码' : '请输入密码');
      return;
    }

    if (password.length < 8) {
      showError('密码至少需要8位字符');
      return;
    }

    if (!useExistingPassword) {
      if (!confirmPassword) {
        showError('请再次输入密码');
        return;
      }

      if (password !== confirmPassword) {
        showError('两次密码不一致');
        return;
      }
    }

    try {
      if (useExistingPassword) {
        await this.verifyExistingPassword(password);
      }

      await this.wallet.createHDWallet(name, password);

      showSuccess('钱包创建成功');
      showPage('walletPage');

      this.resetForm();

      if (this.onCreated) {
        await this.onCreated();
      }
    } catch (error) {
      showError('创建失败: ' + error.message);
    }
  }

  handleCancel() {
    const origin = getPageOrigin('setPasswordPage', 'welcome');
    if (origin === 'accounts') {
      showPage('accountsPage');
      return;
    }

    showPage('welcomePage');
  }

  resetForm() {
    const nameInput = document.getElementById('setWalletName');
    const passwordInput = document.getElementById('newPassword');
    const confirmInput = document.getElementById('confirmPassword');

    if (nameInput) nameInput.value = '主钱包';
    if (passwordInput) passwordInput.value = '';
    if (confirmInput) confirmInput.value = '';
  }

  async verifyExistingPassword(password) {
    const account = await this.wallet.getCurrentAccount();
    if (!account?.id) {
      throw new Error('未找到当前账户');
    }
    await this.wallet.exportPrivateKey(account.id, password);
  }
}
