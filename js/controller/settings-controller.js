import { showPage, showSuccess, showError, showWaiting } from '../common/ui/index.js';
import { formatLocaleDateTime, formatIsoTimestamp } from '../common/utils/time-utils.js';
import { shortenAddress } from '../common/chain/index.js';
import { escapeHtml } from '../common/ui/html-ui.js';

export class SettingsController {
  constructor({ wallet }) {
    this.wallet = wallet;
    this.cachedSites = [];
    this.activeSiteDetail = null;
    this.resetConfirmKeyword = 'RESET';
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

    const searchInput = document.getElementById('siteSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.filterAuthorizedSites(searchInput.value);
      });
    }

    const sitesList = document.getElementById('authorizedSitesList');
    if (sitesList) {
      sitesList.addEventListener('click', (event) => {
        const revokeBtn = event.target.closest('.btn-revoke');
        if (revokeBtn) {
          event.preventDefault();
          event.stopPropagation();
          const origin = revokeBtn.dataset.origin ? decodeURIComponent(revokeBtn.dataset.origin) : '';
          this.handleRevokeSite(origin);
          return;
        }

        const item = event.target.closest('.authorized-site-item');
        if (!item) return;

        const origin = item.dataset.origin ? decodeURIComponent(item.dataset.origin) : '';
        if (!origin) return;
        const address = item.dataset.address ? decodeURIComponent(item.dataset.address) : '';
        const timestamp = item.dataset.timestamp ? Number(item.dataset.timestamp) : null;
        this.openSiteDetailModal({ origin, address, timestamp });
      });
    }

    const closeDetailBtn = document.getElementById('closeSiteDetailBtn');
    if (closeDetailBtn) {
      closeDetailBtn.addEventListener('click', () => this.closeSiteDetailModal());
    }

    const closeDetailIcon = document.getElementById('closeSiteDetailModal');
    if (closeDetailIcon) {
      closeDetailIcon.addEventListener('click', () => this.closeSiteDetailModal());
    }

    const detailModal = document.getElementById('siteDetailModal');
    const detailOverlay = detailModal?.querySelector('.modal-overlay');
    if (detailOverlay) {
      detailOverlay.addEventListener('click', () => this.closeSiteDetailModal());
    }

    const revokeDetailBtn = document.getElementById('revokeSiteDetailBtn');
    if (revokeDetailBtn) {
      revokeDetailBtn.addEventListener('click', () => {
        const origin = this.activeSiteDetail?.origin;
        if (origin) {
          this.handleRevokeSite(origin);
        }
      });
    }
  }

  async loadAuthorizedSites() {
    try {
      const sites = await this.wallet.getAuthorizedSites();
      this.cachedSites = sites || [];
      const searchInput = document.getElementById('siteSearchInput');
      const keyword = searchInput?.value || '';
      if (keyword) {
        this.filterAuthorizedSites(keyword);
      } else {
        this.renderAuthorizedSites(this.cachedSites);
      }
    } catch (error) {
      console.error('[SettingsController] 加载授权网站失败:', error);
      this.cachedSites = [];
      this.renderAuthorizedSites([]);
    }
  }

  async handleRevokeSite(origin, options = {}) {
    const { skipConfirm = false } = options;
    if (!origin) {
      return;
    }

    if (!skipConfirm && !confirm(`确定要撤销 "${origin}" 的授权吗？`)) {
      return;
    }

    try {
      await this.wallet.revokeSite(origin);
      this.closeSiteDetailModal();
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
      this.closeSiteDetailModal();
      this.loadAuthorizedSites();
      showSuccess('所有授权已清除');
    } catch (error) {
      console.error('[SettingsController] 清除所有授权失败:', error);
      showError('清除失败: ' + error.message);
    }
  }

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
      console.error('[SettingsController] 重置钱包失败:', error);
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

  renderAuthorizedSites(sites) {
    const container = document.getElementById('authorizedSitesList');
    if (!container) return;

    if (!sites || sites.length === 0) {
      container.innerHTML = '<div class="empty-message">暂无授权网站</div>';
      return;
    }

    container.innerHTML = sites.map(site => {
      const originRaw = String(site?.origin || '');
      const addressRaw = String(site?.address || '');
      const originDisplay = escapeHtml(originRaw);
      const addressDisplay = escapeHtml(addressRaw);
      const shortAddress = escapeHtml(shortenAddress(addressRaw));
      const timestamp = site?.timestamp ? formatLocaleDateTime(site.timestamp) : '';
      const timeText = escapeHtml(timestamp);
      const timestampValue = site?.timestamp ? String(site.timestamp) : '';
      const originData = encodeURIComponent(originRaw);
      const addressData = encodeURIComponent(addressRaw);

      return `
        <div class="authorized-site-item" data-origin="${originData}" data-address="${addressData}" data-timestamp="${timestampValue}">
          <div class="site-details">
            <div class="site-origin">${originDisplay}</div>
            ${addressDisplay ? `<div class="site-address">${shortAddress}</div>` : ''}
            ${timeText ? `<div class="site-time">${timeText}</div>` : ''}
          </div>
          <button class="btn btn-danger btn-small btn-revoke" data-origin="${originData}">撤销</button>
        </div>
      `;
    }).join('');
  }

  filterAuthorizedSites(query) {
    const keyword = String(query || '').trim().toLowerCase();
    if (!keyword) {
      this.renderAuthorizedSites(this.cachedSites);
      return;
    }
    const filtered = (this.cachedSites || []).filter((site) => {
      const origin = String(site?.origin || '').toLowerCase();
      const address = String(site?.address || '').toLowerCase();
      return origin.includes(keyword) || address.includes(keyword);
    });
    this.renderAuthorizedSites(filtered);
  }

  openSiteDetailModal(site = {}) {
    const modal = document.getElementById('siteDetailModal');
    if (!modal) return;

    const origin = site?.origin || '';
    const address = site?.address || '';
    const timestampValue = site?.timestamp;
    const timeText = timestampValue ? formatLocaleDateTime(timestampValue) : '-';

    const originEl = document.getElementById('siteDetailOrigin');
    const addressEl = document.getElementById('siteDetailAddress');
    const timeEl = document.getElementById('siteDetailTime');

    if (originEl) originEl.textContent = origin;
    if (addressEl) addressEl.textContent = address || '-';
    if (timeEl) timeEl.textContent = timeText;

    this.activeSiteDetail = { origin, address, timestamp: timestampValue };
    modal.classList.remove('hidden');
    this.renderSiteUcanSession({ loading: true });
    void this.loadSiteUcanSession(origin, address);
  }

  closeSiteDetailModal() {
    const modal = document.getElementById('siteDetailModal');
    if (modal) {
      modal.classList.add('hidden');
    }
    this.activeSiteDetail = null;
  }

  async loadSiteUcanSession(origin, address) {
    try {
      const session = await this.wallet.getSiteUcanSession(origin, address);
      if (!this.activeSiteDetail || this.activeSiteDetail.origin !== origin || this.activeSiteDetail.address !== address) {
        return;
      }
      this.renderSiteUcanSession({ session });
    } catch (error) {
      console.error('[SettingsController] 获取 UCAN 会话失败:', error);
      if (!this.activeSiteDetail || this.activeSiteDetail.origin !== origin || this.activeSiteDetail.address !== address) {
        return;
      }
      this.renderSiteUcanSession({ error: true });
    }
  }

  renderSiteUcanSession({ session, loading, error } = {}) {
    const emptyEl = document.getElementById('siteDetailUcanEmpty');
    const rowsEl = document.getElementById('siteDetailUcanRows');
    const statusEl = document.getElementById('siteDetailUcanStatus');
    const sessionEl = document.getElementById('siteDetailUcanSession');
    const didEl = document.getElementById('siteDetailUcanDid');
    const createdEl = document.getElementById('siteDetailUcanCreated');
    const expiresEl = document.getElementById('siteDetailUcanExpires');

    if (!emptyEl || !rowsEl) return;

    if (loading) {
      emptyEl.textContent = '加载中...';
      emptyEl.classList.remove('hidden');
      rowsEl.classList.add('hidden');
      return;
    }

    if (error) {
      emptyEl.textContent = '获取失败';
      emptyEl.classList.remove('hidden');
      rowsEl.classList.add('hidden');
      return;
    }

    if (!session) {
      emptyEl.textContent = '暂无 UCAN 会话';
      emptyEl.classList.remove('hidden');
      rowsEl.classList.add('hidden');
      return;
    }

    const isActive = Boolean(session.isActive);
    const createdAt = session.createdAt ? formatIsoTimestamp(session.createdAt) : '-';
    const expiresAt = session.expiresAt ? formatIsoTimestamp(session.expiresAt) : '-';
    const statusText = isActive ? '当前有效' : '最近一次 (已过期)';

    if (statusEl) statusEl.textContent = statusText;
    if (sessionEl) sessionEl.textContent = session.id || '-';
    if (didEl) didEl.textContent = session.did || '-';
    if (createdEl) createdEl.textContent = createdAt;
    if (expiresEl) expiresEl.textContent = expiresAt;

    emptyEl.classList.add('hidden');
    rowsEl.classList.remove('hidden');
  }
}
