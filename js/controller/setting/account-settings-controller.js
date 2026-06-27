/**
 * AccountSettingsController — 设置页「账户设置」子控制器
 * 从 SettingsController 拆出：修改密码、重置钱包、清除所有授权按钮。
 *
 * 依赖通过构造参数注入：{ wallet }
 */
import { showPage, showSuccess, showError, showWaiting } from '../../common/ui/index.js';

export class AccountSettingsController {
  constructor({ wallet, onClearAllAuthorizations }) {
    this.wallet = wallet;
    this.resetConfirmKeyword = 'RESET';
    // 清除全部授权的回调由 SettingsController 注入（实际逻辑在 AuthorizedSitesController），
    // 避免 sub-controller 之间互相依赖。
    this.onClearAllAuthorizations = typeof onClearAllAuthorizations === 'function'
      ? onClearAllAuthorizations
      : () => {};
  }

  bindEvents() {
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    if (changePasswordBtn) {
      changePasswordBtn.addEventListener('click', () => {
        this.openChangePasswordModal();
      });
    }

    const confirmChangePasswordBtn = document.getElementById('confirmChangePasswordBtn');
    if (confirmChangePasswordBtn) {
      confirmChangePasswordBtn.addEventListener('click', async () => {
        await this.handleChangePassword();
      });
    }

    const cancelChangePasswordBtn = document.getElementById('cancelChangePasswordBtn');
    if (cancelChangePasswordBtn) {
      cancelChangePasswordBtn.addEventListener('click', () => {
        this.closeChangePasswordModal();
      });
    }

    const closeChangePasswordModal = document.getElementById('closeChangePasswordModal');
    if (closeChangePasswordModal) {
      closeChangePasswordModal.addEventListener('click', () => {
        this.closeChangePasswordModal();
      });
    }

    const changePasswordModal = document.getElementById('changePasswordModal');
    const changePasswordOverlay = changePasswordModal?.querySelector('.modal-overlay');
    if (changePasswordOverlay) {
      changePasswordOverlay.addEventListener('click', () => {
        this.closeChangePasswordModal();
      });
    }

    const clearAuthBtn = document.getElementById('clearAllAuthBtn');
    if (clearAuthBtn) {
      clearAuthBtn.addEventListener('click', () => this.handleClearAllAuthorizationsClick());
    }

    const resetBtn = document.getElementById('resetWalletBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.openResetWalletModal();
      });
    }

    const resetModal = document.getElementById('resetWalletModal');
    const resetOverlay = resetModal?.querySelector('.modal-overlay');
    if (resetOverlay) {
      resetOverlay.addEventListener('click', () => this.closeResetWalletModal());
    }

    const closeResetBtn = document.getElementById('closeResetWalletModal');
    if (closeResetBtn) {
      closeResetBtn.addEventListener('click', () => this.closeResetWalletModal());
    }

    const cancelResetBtn = document.getElementById('cancelResetWalletBtn');
    if (cancelResetBtn) {
      cancelResetBtn.addEventListener('click', () => this.closeResetWalletModal());
    }

    const confirmResetBtn = document.getElementById('confirmResetWalletBtn');
    if (confirmResetBtn) {
      confirmResetBtn.addEventListener('click', async () => {
        await this.handleResetWallet();
      });
    }

    const resetInput = document.getElementById('resetWalletConfirmInput');
    if (resetInput) {
      resetInput.addEventListener('input', () => {
        this.updateResetWalletConfirmState();
      });
      resetInput.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          await this.handleResetWallet();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          this.closeResetWalletModal();
        }
      });
    }
  }

  handleClearAllAuthorizationsClick() {
    this.onClearAllAuthorizations();
  }

  // ==================== 修改密码 ====================

  openChangePasswordModal() {
    const modal = document.getElementById('changePasswordModal');
    if (modal) {
      modal.classList.remove('hidden');
    }
    const input = document.getElementById('oldPasswordInput');
    if (input) {
      input.focus();
    }
  }

  closeChangePasswordModal() {
    const modal = document.getElementById('changePasswordModal');
    if (modal) {
      modal.classList.add('hidden');
    }
    this.resetChangePasswordForm();
  }

  async handleChangePassword() {
    const oldInput = document.getElementById('oldPasswordInput');
    const newInput = document.getElementById('newPasswordInput');
    const confirmInput = document.getElementById('confirmNewPasswordInput');

    const oldPassword = oldInput?.value.trim() || '';
    const newPassword = newInput?.value.trim() || '';
    const confirmPassword = confirmInput?.value.trim() || '';

    if (!oldPassword) {
      showError('请输入旧密码');
      return;
    }

    if (!newPassword || newPassword.length < 8) {
      showError('新密码至少需要8位字符');
      return;
    }

    if (newPassword !== confirmPassword) {
      showError('两次输入的新密码不一致');
      return;
    }

    if (oldPassword === newPassword) {
      showError('新密码不能与旧密码相同');
      return;
    }

    try {
      showWaiting();
      await this.wallet.changePassword(oldPassword, newPassword);
      this.closeChangePasswordModal();
      showSuccess('密码已更新');
    } catch (error) {
      console.error('[AccountSettingsController] 修改密码失败:', error);
      showError('修改失败: ' + error.message);
    }
  }

  resetChangePasswordForm() {
    const oldInput = document.getElementById('oldPasswordInput');
    const newInput = document.getElementById('newPasswordInput');
    const confirmInput = document.getElementById('confirmNewPasswordInput');
    if (oldInput) oldInput.value = '';
    if (newInput) newInput.value = '';
    if (confirmInput) confirmInput.value = '';
  }

  // ==================== 重置钱包 ====================

  async handleResetWallet() {
    const confirmInput = document.getElementById('resetWalletConfirmInput');
    const confirmText = confirmInput?.value.trim() || '';
    if (confirmText !== this.resetConfirmKeyword) {
      showError(`请输入 "${this.resetConfirmKeyword}" 以确认`);
      confirmInput?.focus();
      return;
    }

    try {
      showWaiting();
      await this.wallet.resetWallet();
      showSuccess('钱包已重置');
      this.closeResetWalletModal();

      setTimeout(() => {
        showPage('welcomePage');
      }, 1000);
    } catch (error) {
      console.error('[AccountSettingsController] 重置钱包失败:', error);
      showError('重置失败: ' + error.message);
    }
  }

  openResetWalletModal() {
    const modal = document.getElementById('resetWalletModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    const input = document.getElementById('resetWalletConfirmInput');
    if (input) {
      input.value = '';
      input.focus();
    }
    this.updateResetWalletConfirmState();
  }

  closeResetWalletModal() {
    const modal = document.getElementById('resetWalletModal');
    if (modal) {
      modal.classList.add('hidden');
    }
    const input = document.getElementById('resetWalletConfirmInput');
    if (input) {
      input.value = '';
    }
    this.updateResetWalletConfirmState();
  }

  updateResetWalletConfirmState() {
    const input = document.getElementById('resetWalletConfirmInput');
    const confirmBtn = document.getElementById('confirmResetWalletBtn');
    if (!confirmBtn) return;
    const value = input?.value.trim() || '';
    confirmBtn.disabled = value !== this.resetConfirmKeyword;
  }
}