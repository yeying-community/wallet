import { showPage, showSuccess, showError, showWaiting, hideWaiting } from '../common/ui/index.js';
import { formatLocaleDateTime, formatIsoTimestamp } from '../common/utils/time-utils.js';
import { shortenAddress } from '../common/chain/index.js';
import { escapeHtml } from '../common/ui/html-ui.js';
import { isDeveloperFeatureEnabled } from '../config/index.js';

const LEGACY_DEFAULT_APP_ID = 'yeying-wallet';
const DEFAULT_UCAN_ACTION = 'write';
const DEFAULT_LOG_MAX_COUNT = 100000;
const DEFAULT_LOG_RETENTION_DAYS = 30;
const LOG_MAX_COUNT_MIN = 50;
const LOG_MAX_COUNT_MAX = 100000;
const LOG_RETENTION_MIN_DAYS = 1;
const LOG_RETENTION_MAX_DAYS = 365;
const LEGACY_UCAN_RESOURCES = new Set([
  'profile',
  'webdav/*',
  'webdav#access',
  'webdav/access',
  'webdav'
]);

export class SettingsController {
  constructor({ wallet, transaction, requestPassword }) {
    this.wallet = wallet;
    this.transaction = transaction;
    this.requestPassword = requestPassword;
    this.cachedSites = [];
    this.activeSiteDetail = null;
    this.resetConfirmKeyword = 'RESET';
    this.syncSettings = null;
    this.syncLogs = [];
    this.syncLogQuery = '';
    this.syncLogFiltered = [];
    this.syncLogPageSize = 30;
    this.syncLogVisibleCount = 0;
  }

  bindEvents() {
    const backupSyncEnabledToggle = document.getElementById('backupSyncEnabledToggle');
    if (backupSyncEnabledToggle) {
      backupSyncEnabledToggle.addEventListener('change', async () => {
        await this.handleBackupSyncToggle(backupSyncEnabledToggle.checked);
      });
    }

    const backupSyncEndpointInput = document.getElementById('backupSyncEndpointInput');
    if (backupSyncEndpointInput) {
      backupSyncEndpointInput.addEventListener('blur', async () => {
        await this.handleBackupSyncEndpointUpdate(backupSyncEndpointInput.value);
      });
    }

    const backupSyncAuthModeSelect = document.getElementById('backupSyncAuthModeSelect');
    if (backupSyncAuthModeSelect) {
      backupSyncAuthModeSelect.addEventListener('change', async () => {
        const mode = backupSyncAuthModeSelect.value;
        await this.handleBackupSyncAuthModeChange(mode);
      });
    }

    const backupSyncSiweLoginBtn = document.getElementById('backupSyncSiweLoginBtn');
    if (backupSyncSiweLoginBtn) {
      backupSyncSiweLoginBtn.addEventListener('click', async () => {
        await this.handleBackupSyncSiweLogin();
      });
    }

    const backupSyncSiweRefreshBtn = document.getElementById('backupSyncSiweRefreshBtn');
    if (backupSyncSiweRefreshBtn) {
      backupSyncSiweRefreshBtn.addEventListener('click', async () => {
        await this.handleBackupSyncSiweRefresh();
      });
    }

    const backupSyncUcanGenerateBtn = document.getElementById('backupSyncUcanGenerateBtn');
    if (backupSyncUcanGenerateBtn) {
      backupSyncUcanGenerateBtn.addEventListener('click', async () => {
        await this.handleBackupSyncUcanGenerate();
      });
    }

    const backupSyncBasicSaveBtn = document.getElementById('backupSyncBasicSaveBtn');
    if (backupSyncBasicSaveBtn) {
      backupSyncBasicSaveBtn.addEventListener('click', async () => {
        await this.handleBackupSyncBasicSave();
      });
    }

    const backupSyncNowBtn = document.getElementById('backupSyncNowBtn');
    if (backupSyncNowBtn) {
      backupSyncNowBtn.addEventListener('click', async () => {
        await this.handleBackupSyncNow();
      });
    }

    const backupSyncClearRemoteBtn = document.getElementById('backupSyncClearRemoteBtn');
    if (backupSyncClearRemoteBtn) {
      backupSyncClearRemoteBtn.addEventListener('click', async () => {
        await this.handleBackupSyncClearRemote();
      });
    }

    const backupSyncClearLogsBtn = document.getElementById('backupSyncClearLogsBtn');
    if (backupSyncClearLogsBtn) {
      backupSyncClearLogsBtn.addEventListener('click', async () => {
        await this.handleBackupSyncClearLogs();
      });
    }

    const backupSyncLogRetentionSaveBtn = document.getElementById('backupSyncLogRetentionSaveBtn');
    if (backupSyncLogRetentionSaveBtn) {
      backupSyncLogRetentionSaveBtn.addEventListener('click', async () => {
        await this.handleBackupSyncLogRetentionSave();
      });
    }

    const backupSyncAuditBtn = document.getElementById('backupSyncAuditBtn');
    if (backupSyncAuditBtn) {
      backupSyncAuditBtn.addEventListener('click', async () => {
        await this.openBackupSyncLogsPage();
      });
    }

    const backupSyncLogsSearchInput = document.getElementById('backupSyncLogsSearchInput');
    if (backupSyncLogsSearchInput) {
      backupSyncLogsSearchInput.addEventListener('input', () => {
        this.applyBackupSyncLogsFilter(backupSyncLogsSearchInput.value);
      });
    }

    const backupSyncLogsList = document.getElementById('backupSyncLogsList');
    if (backupSyncLogsList) {
      backupSyncLogsList.addEventListener('scroll', () => {
        this.handleBackupSyncLogsScroll();
      });
    }

    const backupSyncSimulateBtn = document.getElementById('backupSyncSimulateConflictBtn');
    if (backupSyncSimulateBtn) {
      backupSyncSimulateBtn.addEventListener('click', async () => {
        await this.handleBackupSyncSimulateConflict();
      });
    }

    const conflictsList = document.getElementById('backupSyncConflictsList');
    if (conflictsList) {
      conflictsList.addEventListener('click', async (event) => {
        const actionBtn = event.target.closest('[data-conflict-action]');
        if (!actionBtn) return;
        const conflictId = actionBtn.dataset.conflictId;
        const action = actionBtn.dataset.conflictAction;
        if (!conflictId || !action) return;
        await this.handleResolveBackupSyncConflict(conflictId, action);
      });
    }

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

  async loadBackupSyncSettings() {
    try {
      const settings = await this.wallet.getBackupSyncSettings();
      this.syncSettings = settings || {};
      this.renderBackupSyncSettings(settings);
    } catch (error) {
      console.error('[SettingsController] 获取 Backup & Sync 设置失败:', error);
    }
  }

  renderBackupSyncSettings(settings = {}) {
    const enabledToggle = document.getElementById('backupSyncEnabledToggle');
    const endpointInput = document.getElementById('backupSyncEndpointInput');
    const authModeSelect = document.getElementById('backupSyncAuthModeSelect');
    const ucanResourceInput = document.getElementById('backupSyncUcanResourceInput');
    const ucanActionInput = document.getElementById('backupSyncUcanActionInput');
    const ucanAudienceInput = document.getElementById('backupSyncUcanAudienceInput');
    const ucanTtlInput = document.getElementById('backupSyncUcanTtlInput');
    const basicInput = document.getElementById('backupSyncBasicInput');
    const tokenStatus = document.getElementById('backupSyncTokenStatus');
    const lastStatus = document.getElementById('backupSyncLastStatus');

    if (enabledToggle) enabledToggle.checked = Boolean(settings.enabled);
    if (endpointInput) endpointInput.value = settings.endpoint || 'https://webdav.yeying.pub';
    if (authModeSelect) authModeSelect.value = settings.authMode || 'ucan';
    if (ucanResourceInput) {
      const normalizedResource = this.normalizeUcanResource(settings.ucanResource || '');
      ucanResourceInput.value = normalizedResource;
      ucanResourceInput.readOnly = true;
    }
    if (ucanActionInput) {
      const normalizedResource = this.normalizeUcanResource(settings.ucanResource || '');
      ucanActionInput.value = this.normalizeUcanAction(settings.ucanAction || '', normalizedResource);
      ucanActionInput.readOnly = true;
    }
    if (ucanAudienceInput) {
      ucanAudienceInput.value = settings.ucanAudience || this.deriveUcanAudience(settings.endpoint || '');
      ucanAudienceInput.readOnly = true;
    }
    if (ucanTtlInput && !ucanTtlInput.value) {
      ucanTtlInput.value = '24';
    }
    if (basicInput) basicInput.value = settings.basicAuth || '';

    this.updateBackupSyncAuthPanel(settings.authMode || 'ucan');
    this.updateBackupSyncTokenStatus(settings, tokenStatus);
    this.updateBackupSyncLastStatus(settings, lastStatus);
    this.updateBackupSyncEnabledState(Boolean(settings.enabled));

    this.renderBackupSyncAccountAddress();
    this.renderBackupSyncConflicts(settings.conflicts || []);
    this.renderBackupSyncLogRetention(settings);
    this.updateBackupSyncLogs(settings.logs || []);
    this.toggleBackupSyncDebug();
  }

  updateBackupSyncAuthPanel(mode) {
    const siwePanel = document.getElementById('backupSyncSiwePanel');
    const ucanPanel = document.getElementById('backupSyncUcanPanel');
    const basicPanel = document.getElementById('backupSyncBasicPanel');

    if (siwePanel) siwePanel.classList.toggle('hidden', mode !== 'siwe');
    if (ucanPanel) ucanPanel.classList.toggle('hidden', mode !== 'ucan');
    if (basicPanel) basicPanel.classList.toggle('hidden', mode !== 'basic');
  }

  updateBackupSyncEnabledState(enabled) {
    const endpointInput = document.getElementById('backupSyncEndpointInput');
    const authModeSelect = document.getElementById('backupSyncAuthModeSelect');
    const nowBtn = document.getElementById('backupSyncNowBtn');

    if (endpointInput) endpointInput.disabled = !enabled;
    if (authModeSelect) authModeSelect.disabled = !enabled;
    if (nowBtn) nowBtn.disabled = !enabled;

    const panelControls = document.querySelectorAll(
      '#backupSyncSiwePanel button, #backupSyncUcanPanel button, #backupSyncUcanPanel input, #backupSyncUcanPanel textarea, #backupSyncBasicPanel button, #backupSyncBasicPanel input'
    );
    panelControls.forEach(el => {
      el.disabled = !enabled;
    });
  }

  updateBackupSyncTokenStatus(settings, element) {
    if (!element) return;
    const token = settings?.authToken || '';
    const expiresAt = settings?.authTokenExpiresAt;
    if (!token) {
      element.textContent = '未登录';
      return;
    }
    const expiresText = expiresAt ? formatLocaleDateTime(expiresAt) : '未知';
    element.textContent = `已登录 · 过期时间 ${expiresText}`;
  }

  updateBackupSyncLastStatus(settings, element) {
    if (!element) return;
    const pullText = settings?.lastPullAt ? formatLocaleDateTime(settings.lastPullAt) : '-';
    const pushText = settings?.lastPushAt ? formatLocaleDateTime(settings.lastPushAt) : '-';
    element.textContent = `最近拉取: ${pullText} · 最近推送: ${pushText}`;
  }

  renderBackupSyncConflicts(conflicts = []) {
    const container = document.getElementById('backupSyncConflictsList');
    if (!container) return;
    const list = Array.isArray(conflicts) ? conflicts : [];

    if (list.length === 0) {
      container.innerHTML = '<div class="empty-message">暂无冲突</div>';
      return;
    }

    container.innerHTML = list.map(conflict => {
      const title = conflict.type === 'contact'
        ? `联系人 ${conflict.address ? shortenAddress(conflict.address) : ''}`
        : `账户 #${conflict.index ?? '-'}`;
      const localName = escapeHtml(conflict.localName || '');
      const remoteName = escapeHtml(conflict.remoteName || '');
      const timeText = conflict.timestamp ? formatLocaleDateTime(conflict.timestamp) : '-';

      return `
        <div class="sync-conflict-item">
          <div class="sync-conflict-info">
            <div class="sync-conflict-title">${escapeHtml(title)}</div>
            <div class="sync-conflict-meta">时间: ${escapeHtml(timeText)}</div>
            <div class="sync-conflict-names">
              <span class="sync-conflict-local">本地: ${localName || '-'}</span>
              <span class="sync-conflict-remote">远端: ${remoteName || '-'}</span>
            </div>
          </div>
          <div class="sync-conflict-actions">
            <button class="btn btn-secondary btn-small" data-conflict-action="local" data-conflict-id="${escapeHtml(conflict.id)}">用本地</button>
            <button class="btn btn-primary btn-small" data-conflict-action="remote" data-conflict-id="${escapeHtml(conflict.id)}">用远端</button>
          </div>
        </div>
      `;
    }).join('');
  }

  async openBackupSyncLogsPage() {
    showPage('backupSyncLogsPage');
    await this.loadBackupSyncLogs();
  }

  async loadBackupSyncLogs() {
    try {
      const settings = await this.wallet.getBackupSyncSettings();
      this.syncSettings = settings || this.syncSettings || {};
      this.renderBackupSyncLogRetention(settings);
      this.updateBackupSyncLogs(settings?.logs || []);
    } catch (error) {
      console.error('[SettingsController] 加载同步日志失败:', error);
      this.updateBackupSyncLogs([]);
    }
  }

  renderBackupSyncLogRetention(settings = {}) {
    const maxInput = document.getElementById('backupSyncLogMaxInput');
    const daysInput = document.getElementById('backupSyncLogRetentionInput');
    const maxCount = this.normalizeLogMaxCount(settings.logMaxCount ?? DEFAULT_LOG_MAX_COUNT);
    const days = this.normalizeLogRetentionDays(settings.logRetentionDays ?? DEFAULT_LOG_RETENTION_DAYS);

    if (maxInput) {
      maxInput.value = String(maxCount);
    }
    if (daysInput) {
      daysInput.value = String(days);
    }
  }

  updateBackupSyncLogs(logs = []) {
    this.syncLogs = Array.isArray(logs) ? logs : [];
    this.updateBackupSyncLogsSummary();
    this.applyBackupSyncLogsFilter();
  }

  applyBackupSyncLogsFilter(keyword) {
    const inputValue = arguments.length > 0
      ? keyword
      : (document.getElementById('backupSyncLogsSearchInput')?.value || '');
    const normalized = String(inputValue || '').trim().toLowerCase();
    this.syncLogQuery = normalized;
    const source = Array.isArray(this.syncLogs) ? this.syncLogs : [];
    this.syncLogFiltered = normalized
      ? source.filter(entry => this.matchBackupSyncLog(entry, normalized))
      : [...source];
    this.syncLogVisibleCount = Math.min(this.syncLogPageSize, this.syncLogFiltered.length);
    this.updateBackupSyncLogsSummary();
    this.renderBackupSyncLogsList(false);

    const container = document.getElementById('backupSyncLogsList');
    if (container) {
      container.scrollTop = 0;
    }
  }

  matchBackupSyncLog(entry, keyword) {
    if (!keyword) return true;
    const timeText = entry?.time ? formatLocaleDateTime(entry.time) : '';
    const fields = [
      entry?.message,
      entry?.action,
      entry?.reason,
      entry?.level,
      entry?.id,
      timeText
    ].filter(Boolean);
    const haystack = fields.join(' ').toLowerCase();
    return haystack.includes(keyword);
  }

  handleBackupSyncLogsScroll() {
    const container = document.getElementById('backupSyncLogsList');
    if (!container) return;
    if (this.syncLogVisibleCount >= this.syncLogFiltered.length) return;
    const threshold = 24;
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - threshold) {
      this.syncLogVisibleCount = Math.min(
        this.syncLogFiltered.length,
        this.syncLogVisibleCount + this.syncLogPageSize
      );
      this.renderBackupSyncLogsList(true);
    }
  }

  renderBackupSyncLogsList(preserveScroll = false) {
    const container = document.getElementById('backupSyncLogsList');
    if (!container) return;
    const list = Array.isArray(this.syncLogFiltered) ? this.syncLogFiltered : [];
    const total = list.length;
    const baseCount = this.syncLogVisibleCount || this.syncLogPageSize;
    const visibleCount = Math.min(baseCount, total);
    this.syncLogVisibleCount = visibleCount;
    const entries = list.slice(0, visibleCount);
    const scrollTop = preserveScroll ? container.scrollTop : 0;

    if (entries.length === 0) {
      const emptyText = this.syncLogQuery ? '没有匹配的日志' : '暂无日志';
      container.innerHTML = `<div class="empty-message">${emptyText}</div>`;
      this.updateBackupSyncLogsFooter(total, visibleCount);
      return;
    }

    container.innerHTML = entries.map(entry => {
      const timeText = entry?.time ? formatLocaleDateTime(entry.time) : '-';
      const message = escapeHtml(entry?.message || '-');
      const level = String(entry?.level || 'info').toLowerCase();
      const levelClass = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
      const levelLabel = levelClass === 'error' ? '错误' : levelClass === 'warn' ? '警告' : '信息';
      const reasonLabel = this.formatBackupSyncReason(entry?.reason || '');
      const durationText = Number.isFinite(entry?.durationMs)
        ? `${Math.max(0, Math.round(entry.durationMs / 1000))}s`
        : '';
      const actionLabel = entry?.action ? `动作 ${entry.action}` : '';

      return `
        <div class="sync-activity-item">
          <div class="sync-activity-time">${escapeHtml(timeText)}</div>
          <div class="sync-activity-main">
            <div class="sync-activity-message">${message}</div>
            <div class="sync-activity-meta">
              <span class="sync-activity-tag level-${levelClass}">${escapeHtml(levelLabel)}</span>
              ${actionLabel ? `<span class="sync-activity-tag">${escapeHtml(actionLabel)}</span>` : ''}
              ${reasonLabel ? `<span class="sync-activity-tag">${escapeHtml(reasonLabel)}</span>` : ''}
              ${durationText ? `<span class="sync-activity-tag">耗时 ${escapeHtml(durationText)}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (preserveScroll) {
      container.scrollTop = scrollTop;
    }

    this.updateBackupSyncLogsFooter(total, visibleCount);
  }

  updateBackupSyncLogsFooter(total, visibleCount) {
    const footer = document.getElementById('backupSyncLogsFooter');
    if (!footer) return;
    if (!total) {
      footer.classList.add('hidden');
      footer.textContent = '';
      return;
    }
    footer.classList.remove('hidden');
    if (visibleCount < total) {
      footer.textContent = `已加载 ${visibleCount} / ${total}，向下滚动加载更多`;
    } else {
      footer.textContent = `已加载全部 ${total} 条日志`;
    }
  }

  updateBackupSyncLogsSummary() {
    const lastPullEl = document.getElementById('backupSyncLogsLastPull');
    const lastPushEl = document.getElementById('backupSyncLogsLastPush');
    const totalEl = document.getElementById('backupSyncLogsTotal');
    const matchEl = document.getElementById('backupSyncLogsMatch');

    if (lastPullEl) {
      const pullText = this.syncSettings?.lastPullAt
        ? formatLocaleDateTime(this.syncSettings.lastPullAt)
        : '-';
      lastPullEl.textContent = pullText;
    }

    if (lastPushEl) {
      const pushText = this.syncSettings?.lastPushAt
        ? formatLocaleDateTime(this.syncSettings.lastPushAt)
        : '-';
      lastPushEl.textContent = pushText;
    }

    if (totalEl) {
      totalEl.textContent = String(Array.isArray(this.syncLogs) ? this.syncLogs.length : 0);
    }

    if (matchEl) {
      matchEl.textContent = String(Array.isArray(this.syncLogFiltered) ? this.syncLogFiltered.length : 0);
    }
  }

  formatBackupSyncReason(reason = '') {
    if (!reason) return '';
    if (reason.startsWith('debounced:')) {
      const detail = reason.slice('debounced:'.length);
      return detail ? `本地变更(${detail})` : '本地变更';
    }
    switch (reason) {
      case 'manual':
        return '手动';
      case 'auto':
        return '自动';
      case 'unlock':
        return '解锁';
      case 'lock':
        return '锁定';
      default:
        return reason;
    }
  }

  toggleBackupSyncDebug() {
    const debugRow = document.getElementById('backupSyncDebugRow');
    if (!debugRow) return;
    const enabled = isDeveloperFeatureEnabled('ENABLE_DEBUG_MODE');
    debugRow.classList.toggle('hidden', !enabled);
  }

  async handleResolveBackupSyncConflict(conflictId, action) {
    try {
      const result = await this.wallet.resolveBackupSyncConflict({ id: conflictId, action });
      if (!result?.success) {
        throw new Error(result?.error || '处理失败');
      }
      await this.loadBackupSyncSettings();
      showSuccess('已处理冲突');
    } catch (error) {
      console.error('[SettingsController] 处理同步冲突失败:', error);
      await this.logBackupSyncError('conflict-resolve-error', error?.message || '处理冲突失败');
      showError('处理失败: ' + error.message);
    }
  }

  async handleBackupSyncSimulateConflict() {
    try {
      if (!isDeveloperFeatureEnabled('ENABLE_DEBUG_MODE')) {
        showError('调试模式未开启');
        return;
      }

      const current = await this.wallet.getCurrentAccount();
      if (!current?.id) {
        showError('未找到当前账户');
        return;
      }

      const contacts = await this.wallet.getContacts();
      const timestamp = Date.now();
      const conflicts = Array.isArray(this.syncSettings?.conflicts)
        ? [...this.syncSettings.conflicts]
        : [];

      conflicts.push({
        id: `account:${current.id}:${timestamp}`,
        type: 'account',
        accountId: current.id,
        walletId: current.walletId || '',
        index: Number.isFinite(current.index) ? current.index : 0,
        localName: current.name || '',
        remoteName: `${current.name || 'Account'} (Remote)`,
        timestamp
      });

      if (Array.isArray(contacts) && contacts.length > 0) {
        const contact = contacts[0];
        conflicts.push({
          id: `contact:${contact.id}:${timestamp}`,
          type: 'contact',
          contactId: contact.id,
          address: contact.address,
          localName: contact.name || '',
          localNote: contact.note || '',
          remoteName: `${contact.name || 'Contact'} (Remote)`,
          remoteNote: `${contact.note || ''}`.trim(),
          timestamp
        });
      }

      const result = await this.wallet.updateBackupSyncSettings({ conflicts });
      if (result?.settings) {
        this.syncSettings = result.settings;
        this.renderBackupSyncSettings(result.settings);
      }
      showSuccess('已生成测试冲突');
    } catch (error) {
      console.error('[SettingsController] 生成测试冲突失败:', error);
      showError('生成失败: ' + error.message);
    }
  }

  deriveUcanAudience(endpoint) {
    try {
      const url = new URL(endpoint);
      const host = url.hostname;
      const port = url.port ? `:${url.port}` : '';
      return host ? `did:web:${host}${port}` : '';
    } catch {
      return '';
    }
  }

  async renderBackupSyncAccountAddress() {
    const addressEl = document.getElementById('backupSyncAccountAddress');
    if (!addressEl) return;
    try {
      const account = await this.wallet.getCurrentAccount();
      addressEl.textContent = account?.address ? shortenAddress(account.address) : '-';
      addressEl.title = account?.address || '';
    } catch (error) {
      addressEl.textContent = '-';
    }
  }

  async handleBackupSyncToggle(enabled) {
    try {
      const result = await this.wallet.updateBackupSyncSettings({ enabled });
      if (result?.settings) {
        this.syncSettings = result.settings;
        this.renderBackupSyncSettings(result.settings);
      }
      showSuccess(enabled ? '已启用备份与同步' : '已关闭备份与同步');
    } catch (error) {
      console.error('[SettingsController] 更新 Backup & Sync 开关失败:', error);
      showError('更新失败: ' + error.message);
    }
  }

  async handleBackupSyncEndpointUpdate(endpoint) {
    const trimmed = String(endpoint || '').trim();
    if (!trimmed) {
      showError('请输入 WebDAV 地址');
      return;
    }
    try {
      new URL(trimmed);
    } catch {
      showError('WebDAV 地址格式不正确');
      return;
    }
    try {
      const resolved = await this.detectBackupSyncEndpoint(trimmed);
      const result = await this.wallet.updateBackupSyncSettings({ endpoint: resolved });
      if (result?.settings) {
        this.syncSettings = result.settings;
        this.renderBackupSyncSettings(result.settings);
      }
      if (resolved !== trimmed) {
        showSuccess(`WebDAV 地址已保存（自动识别为 ${resolved}）`);
      } else {
        showSuccess('WebDAV 地址已保存');
      }
    } catch (error) {
      console.error('[SettingsController] 更新 WebDAV 地址失败:', error);
      await this.logBackupSyncError('endpoint-update-error', error?.message || 'WebDAV 地址保存失败');
      showError('保存失败: ' + error.message);
    }
  }

  async handleBackupSyncAuthModeChange(mode) {
    try {
      const result = await this.wallet.updateBackupSyncSettings({ authMode: mode });
      if (result?.settings) {
        this.syncSettings = result.settings;
        this.renderBackupSyncSettings(result.settings);
      }
    } catch (error) {
      console.error('[SettingsController] 更新认证方式失败:', error);
      showError('更新失败: ' + error.message);
    }
  }

  async handleBackupSyncSiweLogin() {
    try {
      const endpoint = (document.getElementById('backupSyncEndpointInput')?.value || '').trim();
      if (!endpoint) {
        showError('请输入 WebDAV 地址');
        return;
      }
      try {
        new URL(endpoint);
      } catch {
        showError('WebDAV 地址格式不正确');
        return;
      }

      const account = await this.wallet.getCurrentAccount();
      if (!account?.address) {
        showError('未找到当前账户');
        return;
      }

      if (!this.transaction) {
        showError('签名模块未初始化');
        return;
      }

      showWaiting();
      const challenge = await this.fetchSiweChallenge(endpoint, account.address);
      if (!challenge) {
        showError('无法获取挑战信息');
        await this.logBackupSyncError('siwe-login-error', '无法获取挑战信息');
        return;
      }
      hideWaiting();

      const password = await this.requestPassword?.();
      if (!password) {
        return;
      }

      showWaiting();
      const signature = await this.transaction.signMessage(challenge, password);
      const verifyResult = await this.fetchSiweVerify(endpoint, account.address, signature);
      const token = verifyResult?.token;
      const expiresAt = verifyResult?.expiresAt || null;

      if (!token) {
        showError('登录失败：未返回 Token');
        await this.logBackupSyncError('siwe-login-error', '未返回 Token');
        return;
      }

      const result = await this.wallet.updateBackupSyncSettings({
        authMode: 'siwe',
        authToken: token,
        authTokenExpiresAt: expiresAt
      });

      if (result?.settings) {
        this.syncSettings = result.settings;
        this.renderBackupSyncSettings(result.settings);
      }

      showSuccess('SIWE 登录成功');
    } catch (error) {
      console.error('[SettingsController] SIWE 登录失败:', error);
      await this.logBackupSyncError('siwe-login-error', error?.message || 'SIWE 登录失败');
      showError('登录失败: ' + error.message);
    }
  }

  async handleBackupSyncSiweRefresh() {
    try {
      const endpoint = (document.getElementById('backupSyncEndpointInput')?.value || '').trim();
      if (!endpoint) {
        showError('请输入 WebDAV 地址');
        return;
      }
      try {
        new URL(endpoint);
      } catch {
        showError('WebDAV 地址格式不正确');
        return;
      }

      showWaiting();
      const refreshResult = await this.fetchSiweRefresh(endpoint);
      const token = refreshResult?.token;
      const expiresAt = refreshResult?.expiresAt || null;

      if (!token) {
        showError('刷新失败：未返回 Token');
        await this.logBackupSyncError('siwe-refresh-error', '未返回 Token');
        return;
      }

      const result = await this.wallet.updateBackupSyncSettings({
        authMode: 'siwe',
        authToken: token,
        authTokenExpiresAt: expiresAt
      });

      if (result?.settings) {
        this.syncSettings = result.settings;
        this.renderBackupSyncSettings(result.settings);
      }

      showSuccess('Token 已刷新');
    } catch (error) {
      console.error('[SettingsController] 刷新 Token 失败:', error);
      await this.logBackupSyncError('siwe-refresh-error', error?.message || 'SIWE 刷新失败');
      showError('刷新失败: ' + error.message);
    }
  }

  async handleBackupSyncUcanGenerate() {
    try {
      const endpoint = (document.getElementById('backupSyncEndpointInput')?.value || '').trim();
      if (!endpoint) {
        showError('请输入 WebDAV 地址');
        return;
      }
      try {
        new URL(endpoint);
      } catch {
        showError('WebDAV 地址格式不正确');
        return;
      }

      const account = await this.wallet.getCurrentAccount();
      if (!account?.address) {
        showError('未找到当前账户');
        return;
      }

      if (!this.transaction) {
        showError('签名模块未初始化');
        return;
      }

      const resourceInput = document.getElementById('backupSyncUcanResourceInput');
      const actionInput = document.getElementById('backupSyncUcanActionInput');
      const audienceInput = document.getElementById('backupSyncUcanAudienceInput');
      const ttlInput = document.getElementById('backupSyncUcanTtlInput');

      const resource = this.normalizeUcanResource(resourceInput?.value || '');
      const action = this.normalizeUcanAction(actionInput?.value || '', resource);
      const audience = String(audienceInput?.value || '').trim() || this.deriveUcanAudience(endpoint);
      const ttlHours = Number(ttlInput?.value || '24');
      const ttlMs = Number.isFinite(ttlHours) ? ttlHours * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

      if (!audience) {
        showError('请填写 Audience');
        return;
      }

      const now = Date.now();
      const expiresAt = now + ttlMs;
      const { did, keys } = await createUcanInvocationKey();
      const statement = {
        aud: did,
        cap: [{ resource, action }],
        exp: expiresAt,
        nbf: now
      };
      const message = buildSiweMessage(endpoint, account.address, statement);

      const password = await this.requestPassword?.();
      if (!password) {
        return;
      }

      showWaiting();
      const signature = await this.transaction.signMessage(message, password);
      const rootProof = {
        type: 'siwe',
        iss: `did:pkh:eth:${account.address.toLowerCase()}`,
        aud: did,
        cap: [{ resource, action }],
        exp: expiresAt,
        nbf: now,
        siwe: {
          message,
          signature
        }
      };

      const { token } = await createUcanInvocationToken({
        audience,
        capability: { resource, action },
        proof: rootProof,
        expiresAt,
        notBefore: now,
        keys,
        did
      });

      const normalizedToken = this.normalizeUcanToken(token);
      if (audienceInput) audienceInput.value = audience;
      if (resourceInput) resourceInput.value = resource;
      if (actionInput) actionInput.value = action;

      const result = await this.wallet.updateBackupSyncSettings({
        authMode: 'ucan',
        ucanToken: normalizedToken,
        ucanResource: resource,
        ucanAction: action,
        ucanAudience: audience
      });
      if (result?.settings) {
        this.syncSettings = result.settings;
        this.renderBackupSyncSettings(result.settings);
      }

      await this.tryBackupSyncAfterUcanAuth(result?.settings);
      showSuccess('UCAN 已生成');
    } catch (error) {
      console.error('[SettingsController] 生成 UCAN 失败:', error);
      await this.logBackupSyncError('ucan-generate-error', error?.message || 'UCAN 生成失败');
      showError('生成失败: ' + error.message);
    }
  }

  async handleBackupSyncBasicSave() {
    const basicInput = document.getElementById('backupSyncBasicInput');
    const raw = String(basicInput?.value || '').trim();
    if (!raw) {
      showError('请输入 Basic 凭证');
      return;
    }

    try {
      const header = this.normalizeBasicAuth(raw);
      const result = await this.wallet.updateBackupSyncSettings({
        authMode: 'basic',
        basicAuth: header
      });
      if (result?.settings) {
        this.syncSettings = result.settings;
        this.renderBackupSyncSettings(result.settings);
      }
      showSuccess('Basic 凭证已保存');
    } catch (error) {
      console.error('[SettingsController] 保存 Basic 凭证失败:', error);
      showError('保存失败: ' + error.message);
    }
  }

  async handleBackupSyncNow() {
    try {
      await this.ensureBackupSyncEndpoint();
      showWaiting();
      const result = await this.wallet.backupSyncNow();
      if (!result?.success) {
        throw new Error(result?.error || '同步失败');
      }
      await this.loadBackupSyncSettings();
      showSuccess('同步完成');
    } catch (error) {
      console.error('[SettingsController] 立即同步失败:', error);
      showError(this.formatBackupSyncError(error, '同步失败'));
    }
  }

  async handleBackupSyncClearRemote() {
    if (!confirm('确定要清除远端备份吗？此操作会删除 WebDAV 上的备份文件。')) {
      return;
    }

    try {
      showWaiting();
      const result = await this.wallet.backupSyncClearRemote();
      if (!result?.success) {
        throw new Error(result?.error || '清理失败');
      }
      await this.loadBackupSyncSettings();
      showSuccess('远端备份已清除');
    } catch (error) {
      console.error('[SettingsController] 清除远端备份失败:', error);
      showError(this.formatBackupSyncError(error, '清理失败'));
    }
  }

  async handleBackupSyncClearLogs() {
    if (!confirm('确定要清空同步日志吗？')) {
      return;
    }

    try {
      const result = await this.wallet.backupSyncClearLogs();
      if (!result?.success) {
        throw new Error(result?.error || '清理失败');
      }
      await this.loadBackupSyncSettings();
      showSuccess('同步日志已清空');
    } catch (error) {
      console.error('[SettingsController] 清空同步日志失败:', error);
      showError('清理失败: ' + error.message);
    }
  }

  async handleBackupSyncLogRetentionSave() {
    const maxInput = document.getElementById('backupSyncLogMaxInput');
    const daysInput = document.getElementById('backupSyncLogRetentionInput');
    const rawMax = Number(maxInput?.value || '');
    const rawDays = Number(daysInput?.value || '');

    const maxCount = this.normalizeLogMaxCount(rawMax);
    const days = this.normalizeLogRetentionDays(rawDays);

    if (!Number.isFinite(maxCount) || maxCount <= 0) {
      showError('最大保留条数无效');
      return;
    }
    if (!Number.isFinite(days) || days < LOG_RETENTION_MIN_DAYS) {
      showError('保留天数无效');
      return;
    }

    try {
      const result = await this.wallet.updateBackupSyncSettings({
        logMaxCount: maxCount,
        logRetentionDays: days
      });
      if (result?.settings) {
        this.syncSettings = result.settings;
        this.renderBackupSyncLogRetention(result.settings);
        this.updateBackupSyncLogs(result.settings.logs || []);
      }
      showSuccess('留存策略已保存');
    } catch (error) {
      console.error('[SettingsController] 保存日志留存策略失败:', error);
      showError('保存失败: ' + error.message);
    }
  }

  async logBackupSyncError(action, message) {
    try {
      if (!this.wallet?.logBackupSyncEvent) return;
      await this.wallet.logBackupSyncEvent({
        level: 'error',
        action,
        message
      });
    } catch (error) {
      console.warn('[SettingsController] 写入同步错误日志失败:', error?.message || error);
    }
  }

  normalizeBasicAuth(value) {
    if (!value) return '';
    if (value.startsWith('Basic ')) return value;
    if (value.includes(':')) {
      return `Basic ${btoa(value)}`;
    }
    return `Basic ${value}`;
  }

  normalizeUcanToken(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    return trimmed
      .replace(/^Bearer\s+/i, '')
      .replace(/^UCAN\s+/i, '')
      .trim();
  }

  normalizeUcanResource(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed || this.isLegacyUcanResource(trimmed)) {
      return this.getDefaultUcanResource();
    }
    return trimmed;
  }

  normalizeLogMaxCount(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return DEFAULT_LOG_MAX_COUNT;
    const rounded = Math.floor(numberValue);
    if (rounded < LOG_MAX_COUNT_MIN) return LOG_MAX_COUNT_MIN;
    if (rounded > LOG_MAX_COUNT_MAX) return LOG_MAX_COUNT_MAX;
    return rounded;
  }

  normalizeLogRetentionDays(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return DEFAULT_LOG_RETENTION_DAYS;
    const rounded = Math.floor(numberValue);
    if (rounded < LOG_RETENTION_MIN_DAYS) return LOG_RETENTION_MIN_DAYS;
    if (rounded > LOG_RETENTION_MAX_DAYS) return LOG_RETENTION_MAX_DAYS;
    return rounded;
  }

  normalizeUcanAction(value, resource) {
    const trimmed = String(value || '').trim();
    const resourceTrimmed = String(resource || '').trim();
    const isLegacyResource = !resourceTrimmed || this.isLegacyUcanResource(resourceTrimmed);
    if (isLegacyResource || !trimmed || trimmed === '*') {
      return DEFAULT_UCAN_ACTION;
    }
    return trimmed;
  }

  getDefaultUcanAppId() {
    try {
      const id = typeof chrome !== 'undefined' ? chrome?.runtime?.id : '';
      if (id) return String(id).toLowerCase();
    } catch {
      // ignore
    }
    return LEGACY_DEFAULT_APP_ID;
  }

  getDefaultUcanResource() {
    return `app:${this.getDefaultUcanAppId()}`;
  }

  isLegacyUcanResource(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return true;
    const normalized = trimmed.toLowerCase();
    if (LEGACY_UCAN_RESOURCES.has(normalized)) return true;
    const legacyResource = `app:${LEGACY_DEFAULT_APP_ID}`;
    if (normalized === legacyResource) {
      return normalized !== this.getDefaultUcanResource().toLowerCase();
    }
    return false;
  }

  async tryBackupSyncAfterUcanAuth(settings) {
    const enabled = Boolean(settings?.enabled);
    const endpoint = String(settings?.endpoint || '').trim();
    if (!enabled || !endpoint) return;
    try {
      await this.handleBackupSyncNow();
    } catch (error) {
      console.warn('[SettingsController] UCAN 保存后同步失败:', error?.message || error);
    }
  }

  async ensureBackupSyncEndpoint() {
    const input = document.getElementById('backupSyncEndpointInput');
    const current = String(input?.value || '').trim();
    if (!current) return '';
    try {
      new URL(current);
    } catch {
      return current;
    }

    const resolved = await this.detectBackupSyncEndpoint(current);
    if (resolved && resolved !== current) {
      const result = await this.wallet.updateBackupSyncSettings({ endpoint: resolved });
      if (result?.settings) {
        this.syncSettings = result.settings;
        this.renderBackupSyncSettings(result.settings);
      }
      if (input) {
        input.value = resolved;
      }
    }
    return resolved || current;
  }

  async detectBackupSyncEndpoint(endpoint) {
    let url;
    try {
      url = new URL(endpoint);
    } catch {
      return endpoint;
    }

    const path = url.pathname || '';
    if (path && path !== '/' && path !== '') {
      return endpoint;
    }

    const origin = url.origin;
    const candidates = ['/', '/dav', '/webdav', '/api'];
    for (const prefix of candidates) {
      const ok = await this.probeWebdavPrefix(origin, prefix);
      if (ok) {
        return prefix === '/' ? origin : `${origin}${prefix}`;
      }
    }

    return endpoint;
  }

  async probeWebdavPrefix(origin, prefix) {
    const normalized = prefix === '/' ? '/' : `${prefix.replace(/\/+$/, '')}/`;
    const url = new URL(normalized, origin);
    try {
      const response = await fetch(url.toString(), {
        method: 'OPTIONS',
        credentials: 'omit'
      });
      if (!response) return false;
      if (response.status === 404) return false;
      return true;
    } catch (error) {
      return false;
    }
  }

  formatBackupSyncError(error, prefix = '同步失败') {
    const raw = error?.message || '';
    if (/MKCOL failed:\s*404/i.test(raw)) {
      return `${prefix}: WebDAV 路径不存在，请检查 WebDAV 地址是否包含正确前缀（如 /dav 或 /api）`;
    }
    if (!raw) {
      return prefix;
    }
    return `${prefix}: ${raw}`;
  }

  async fetchSiweChallenge(endpoint, address) {
    const url = new URL('/api/v1/public/auth/challenge', endpoint);
    url.searchParams.set('address', address);
    const response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'include'
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.code !== 0) {
      throw new Error(json.message || 'Challenge failed');
    }
    return json.data?.challenge;
  }

  async fetchSiweVerify(endpoint, address, signature) {
    const url = new URL('/api/v1/public/auth/verify', endpoint);
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ address, signature })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.code !== 0) {
      throw new Error(json.message || 'Verify failed');
    }
    return json.data || {};
  }

  async fetchSiweRefresh(endpoint) {
    const url = new URL('/api/v1/public/auth/refresh', endpoint);
    const response = await fetch(url.toString(), {
      method: 'POST',
      credentials: 'include'
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.code !== 0) {
      throw new Error(json.message || 'Refresh failed');
    }
    return json.data || {};
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

function buildSiweMessage(endpoint, address, statement) {
  const url = new URL(endpoint);
  const domain = url.host || url.hostname;
  const nonce = Math.random().toString(36).slice(2, 10);
  const issuedAt = new Date().toISOString();
  const statementLine = `UCAN-AUTH: ${JSON.stringify(statement)}`;

  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    `URI: ${url.origin}`,
    'Version: 1',
    'Chain ID: 1',
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    '',
    statementLine
  ].join('\n');
}

async function createUcanInvocationKey() {
  if (!crypto?.subtle) {
    throw new Error('WebCrypto not available');
  }
  const keys = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  );
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const did = toDidKey(publicRaw);
  return { keys, did };
}

async function createUcanInvocationToken({ audience, capability, proof, expiresAt, notBefore, keys, did }) {
  if (!crypto?.subtle) {
    throw new Error('WebCrypto not available');
  }
  if (!keys?.privateKey || !did) {
    throw new Error('Missing UCAN key');
  }
  const payload = {
    iss: did,
    aud: audience,
    cap: [capability],
    exp: expiresAt,
    nbf: notBefore,
    prf: [proof]
  };
  const header = { alg: 'EdDSA', typ: 'UCAN' };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(
    'Ed25519',
    keys.privateKey,
    new TextEncoder().encode(signingInput)
  );
  const token = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
  return { token, did };
}

function base64UrlEncode(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base58Encode(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  const encoded = [];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < encoded.length; j += 1) {
      carry += encoded[j] << 8;
      encoded[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      encoded.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let output = '';
  for (let i = 0; i < zeros; i += 1) output += '1';
  for (let i = encoded.length - 1; i >= 0; i -= 1) {
    output += alphabet[encoded[i]];
  }
  return output;
}

function toDidKey(publicKeyRaw) {
  const prefix = new Uint8Array([0xed, 0x01]);
  const combined = new Uint8Array(prefix.length + publicKeyRaw.length);
  combined.set(prefix, 0);
  combined.set(publicKeyRaw, prefix.length);
  return `did:key:z${base58Encode(combined)}`;
}
