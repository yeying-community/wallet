import { showPage, showSuccess, showError, showWaiting } from '../common/ui/index.js';

export class SettingsController {
  constructor({ wallet }) {
    this.wallet = wallet;
  }

  bindEvents() {
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    if (changePasswordBtn) {
      changePasswordBtn.addEventListener('click', async () => {
        await this.handleChangePassword();
      });
    }

    const clearAuthBtn = document.getElementById('clearAllAuthBtn');
    if (clearAuthBtn) {
      clearAuthBtn.addEventListener('click', async () => {
        await this.handleClearAllAuthorizations();
      });
    }

    const resetBtn = document.getElementById('resetWalletBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        await this.handleResetWallet();
      });
    }
  }

  async loadAuthorizedSites() {
    try {
      const sites = await this.wallet.getAuthorizedSites();

      this.renderAuthorizedSites(
        sites,
        (origin) => this.handleRevokeSite(origin)
      );
    } catch (error) {
      console.error('[SettingsController] 加载授权网站失败:', error);
      this.renderAuthorizedSites([]);
    }
  }

  async handleRevokeSite(origin) {
    if (!confirm(`确定要撤销 "${origin}" 的授权吗？`)) {
      return;
    }

    try {
      await this.wallet.revokeSite(origin);
      this.loadAuthorizedSites();
      showSuccess('授权已撤销');
    } catch (error) {
      console.error('[SettingsController] 撤销授权失败:', error);
      showError('撤销失败: ' + error.message);
    }
  }

  async handleClearAllAuthorizations() {
    if (!confirm('确定要清除所有网站授权吗？清除后需要重新授权才能使用。')) {
      return;
    }

    try {
      await this.wallet.clearAllAuthorizations();
      this.loadAuthorizedSites();
      showSuccess('所有授权已清除');
    } catch (error) {
      console.error('[SettingsController] 清除所有授权失败:', error);
      showError('清除失败: ' + error.message);
    }
  }

  async handleResetWallet() {
    const confirmText = prompt('警告：此操作将删除所有钱包数据，且无法恢复！\n\n请输入 "RESET" 以确认:');

    if (confirmText !== 'RESET') {
      if (confirmText !== null) {
        showError('输入不正确，取消操作');
      }
      return;
    }

    try {
      await this.wallet.resetWallet();
      showSuccess('钱包已重置');

      setTimeout(() => {
        showPage('welcomePage');
      }, 1000);
    } catch (error) {
      console.error('[SettingsController] 重置钱包失败:', error);
      showError('重置失败: ' + error.message);
    }
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
      this.resetChangePasswordForm();
      showSuccess('密码已更新');
    } catch (error) {
      console.error('[SettingsController] 修改密码失败:', error);
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

  renderAuthorizedSites(sites, onRevoke) {
    const container = document.getElementById('authorizedSitesList');
    if (!container) return;

    if (!sites || sites.length === 0) {
      container.innerHTML = '<div class="empty-message">暂无授权网站</div>';
      return;
    }

    container.innerHTML = sites.map(site => `
      <div class="authorized-site-item">
        <span class="site-origin">${site.origin}</span>
        <button class="btn btn-danger btn-small btn-revoke" data-origin="${site.origin}">撤销</button>
      </div>
    `).join('');

    container.querySelectorAll('.btn-danger').forEach(btn => {
      btn.addEventListener('click', () => {
        const origin = btn.dataset.origin;
        onRevoke?.(origin);
      });
    });
  }
}
