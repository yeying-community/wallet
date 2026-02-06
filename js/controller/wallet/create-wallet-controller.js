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

    const walletTypeSelect = document.getElementById('createWalletTypeSelect');
    if (walletTypeSelect) {
      walletTypeSelect.addEventListener('change', () => {
        const origin = getPageOrigin('setPasswordPage', 'welcome');
        this.applyCreateWalletType(walletTypeSelect.value, origin);
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
    const walletType = this.getCreateWalletType();

    if (origin !== 'accounts' && walletType === 'mpc') {
      showError('请先创建 HD 钱包，再添加 MPC 钱包');
      return;
    }

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

      if (walletType === 'mpc') {
        await this.handleCreateMpcWallet({
          name,
          password
        });
        return;
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
    const walletTypeSelect = document.getElementById('createWalletTypeSelect');
    const mpcWalletIdInput = document.getElementById('mpcCreateWalletIdInput');
    const mpcParticipantsInput = document.getElementById('mpcCreateParticipantsInput');
    const mpcThresholdInput = document.getElementById('mpcCreateThresholdInput');
    const mpcCurveSelect = document.getElementById('mpcCreateCurveSelect');
    const mpcResult = document.getElementById('mpcCreateWalletResult');

    if (nameInput) nameInput.value = '主钱包';
    if (passwordInput) passwordInput.value = '';
    if (confirmInput) confirmInput.value = '';
    if (walletTypeSelect) walletTypeSelect.value = 'hd';
    if (mpcWalletIdInput) mpcWalletIdInput.value = '';
    if (mpcParticipantsInput) mpcParticipantsInput.value = '';
    if (mpcThresholdInput) mpcThresholdInput.value = '';
    if (mpcCurveSelect) mpcCurveSelect.value = 'secp256k1';
    if (mpcResult) {
      mpcResult.textContent = '-';
      mpcResult.classList.add('hidden');
    }
    this.applyCreateWalletType('hd', getPageOrigin('setPasswordPage', 'welcome'));
  }

  async verifyExistingPassword(password) {
    const account = await this.wallet.getCurrentAccount();
    if (!account?.id) {
      throw new Error('未找到当前账户');
    }
    await this.wallet.exportPrivateKey(account.id, password);
  }

  getCreateWalletType() {
    const select = document.getElementById('createWalletTypeSelect');
    const value = String(select?.value || 'hd').toLowerCase();
    return value === 'mpc' ? 'mpc' : 'hd';
  }

  applyCreateWalletType(type, origin) {
    const group = document.getElementById('createWalletTypeGroup');
    const mpcFields = document.getElementById('mpcCreateWalletFields');
    const resultEl = document.getElementById('mpcCreateWalletResult');
    const setPasswordBtn = document.getElementById('setPasswordBtn');
    const isAccounts = origin === 'accounts';
    if (group) {
      group.classList.toggle('hidden', !isAccounts);
    }
    if (mpcFields) {
      mpcFields.classList.toggle('hidden', type !== 'mpc');
    }
    if (resultEl) {
      resultEl.classList.toggle('hidden', type !== 'mpc');
    }
    if (setPasswordBtn && isAccounts) {
      setPasswordBtn.textContent = type === 'mpc' ? '创建 MPC 钱包' : '创建钱包';
    }
  }

  parseParticipants(input) {
    const raw = String(input || '').trim();
    if (!raw) return [];
    return raw.split(',').map(item => item.trim()).filter(Boolean);
  }

  async handleCreateMpcWallet({ name, password }) {
    const walletIdInput = document.getElementById('mpcCreateWalletIdInput');
    const participantsInput = document.getElementById('mpcCreateParticipantsInput');
    const thresholdInput = document.getElementById('mpcCreateThresholdInput');
    const curveSelect = document.getElementById('mpcCreateCurveSelect');
    const resultEl = document.getElementById('mpcCreateWalletResult');

    const walletId = String(walletIdInput?.value || '').trim();
    const participants = this.parseParticipants(participantsInput?.value || '');
    const threshold = Number(thresholdInput?.value || 0);
    const curve = String(curveSelect?.value || 'secp256k1').trim();

    if (!participants.length) {
      showError('请填写参与者列表');
      return;
    }
    if (!Number.isFinite(threshold) || threshold <= 0) {
      showError('门限必须大于 0');
      return;
    }
    if (threshold > participants.length) {
      showError('门限不能大于参与者数量');
      return;
    }

    const response = await this.wallet.createMpcWallet({
      walletId,
      name,
      participants,
      threshold,
      curve
    });
    if (!response?.success) {
      throw new Error(response?.error || '创建失败');
    }

    const createdId = response?.wallet?.id || walletId || '-';
    const sessionId = response?.session?.id || response?.session?.sessionId || '-';
    if (resultEl) {
      resultEl.textContent = `MPC 钱包已创建: ${createdId} · Keygen 会话: ${sessionId}`;
      resultEl.classList.remove('hidden');
    }

    showSuccess('MPC 钱包已创建');
    showPage('accountsPage');
    this.resetForm();
    if (this.onCreated) {
      await this.onCreated();
    }
  }
}
