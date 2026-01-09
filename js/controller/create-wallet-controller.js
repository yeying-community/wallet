import { showPage, showError, showSuccess, getPageOrigin } from './ui.js';

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

    if (!password) {
      showError('请输入密码');
      return;
    }

    if (password.length < 8) {
      showError('密码至少需要8位字符');
      return;
    }

    if (!confirmPassword) {
      showError('请再次输入密码');
      return;
    }

    if (password !== confirmPassword) {
      showError('两次密码不一致');
      return;
    }

    try {
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
}
