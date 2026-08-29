/**
 * BackupSyncSettingsController — 备份与同步（WebDAV）设置子控制器
 * 从 SettingController 拆出：连接点 / 认证模式 / SIWE / UCAN / Basic / 立即同步 /
 * 清理远端 / 冲突解决 / 活动日志 / 留存策略。
 *
 * 依赖通过构造参数注入：{ wallet, transaction, requestPassword }
 */
import { showPage, showSuccess, showError, showWaiting, hideWaiting } from '../../common/ui/index.js';
import { formatDate, formatLocaleDateTime } from '../../common/utils/time-utils.js';
import { shortenAddress } from '../../common/chain/index.js';
import { escapeHtml } from '../../common/ui/html-ui.js';
import {
  getUcanExpiresAt,
  deriveUcanAudience,
  buildSiweMessage,
  createUcanInvocationKey,
  createUcanInvocationToken
} from '../../common/ucan-utils.js';
import { isDeveloperFeatureEnabled } from '../../config/index.js';
import {
  normalizeUcanResource,
  normalizeUcanAction,
  normalizeLogMaxCount,
  normalizeLogRetentionDays,
  normalizeBasicAuth,
  normalizeUcanToken,
  DEFAULT_LOG_MAX_COUNT,
  DEFAULT_LOG_RETENTION_DAYS,
  LOG_RETENTION_MIN_DAYS
} from './settings-utils.js';

export class BackupSyncSettingsController {
  constructor({ wallet, transaction, requestPassword }) {
    this.wallet = wallet;
    this.transaction = transaction;
    this.requestPassword = requestPassword;
    this.syncSettings = null;
    this.syncLogs = [];
    this.syncLogQuery = '';
    this.syncLogFiltered = [];
    this.syncLogPageSize = 30;
    this.syncLogVisibleCount = 0;
  }

  bindEvents() {
    const backupSyncDetailBtn = document.getElementById('backupSyncDetailBtn');
    if (backupSyncDetailBtn) {
      backupSyncDetailBtn.addEventListener('click', () => this.openBackupSyncDetailPage());
    }
    const backupSyncEnabledToggle = document.getElementById('backupSyncEnabledToggle');
    if (backupSyncEnabledToggle) {
      backupSyncEnabledToggle.addEventListener('change', async () => {
        await this.handleBackupSyncToggle(backupSyncEnabledToggle.checked);
      });
    }

    const backupSyncConfigBtn = document.getElementById('backupSyncConfigBtn');
    if (backupSyncConfigBtn) {
      backupSyncConfigBtn.addEventListener('click', () => {
        this.openBackupSyncConfigModal();
      });
    }

    const backupSyncConfigSaveBtn = document.getElementById('backupSyncConfigSaveBtn');
    if (backupSyncConfigSaveBtn) {
      backupSyncConfigSaveBtn.addEventListener('click', async () => {
        await this.handleBackupSyncConfigSave();
      });
    }
    const backupSyncAuthSaveBtn = document.getElementById('backupSyncAuthSaveBtn');
    if (backupSyncAuthSaveBtn) {
      backupSyncAuthSaveBtn.addEventListener('click', async () => {
        await this.handleBackupSyncConfigSave();
      });
    }

    const backupSyncAuthModeSelect = document.getElementById('backupSyncAuthModeSelect');
    if (backupSyncAuthModeSelect) {
      backupSyncAuthModeSelect.addEventListener('change', () => {
        const mode = backupSyncAuthModeSelect.value;
        this.updateBackupSyncAuthPanel(mode);
        this.updateBackupSyncEnabledState(Boolean(this.syncSettings?.enabled));
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
    const backupSyncAuditHiddenBtn = document.getElementById('backupSyncAuditHiddenBtn');
    if (backupSyncAuditHiddenBtn) {
      backupSyncAuditHiddenBtn.addEventListener('click', async () => {
        await this.openBackupSyncLogsPage();
      });
    }

    this.bindSimpleModal({
      modalId: 'backupSyncConfigModal',
      closeIds: ['closeBackupSyncConfigModal', 'cancelBackupSyncConfigBtn'],
      onClose: () => this.closeBackupSyncConfigModal()
    });

    const conflictBtn = document.getElementById('backupSyncConflictBtn');
    if (conflictBtn) {
      conflictBtn.addEventListener('click', () => this.openBackupSyncConflictModal());
    }
    this.bindSimpleModal({
      modalId: 'backupSyncConflictModal',
      closeIds: ['closeBackupSyncConflictModal', 'cancelBackupSyncConflictBtn'],
      onClose: () => this.closeBackupSyncConflictModal()
    });

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
  }

  bindSimpleModal({ modalId, closeIds = [], onClose }) {
    const modal = document.getElementById(modalId);
    if (!modal || typeof onClose !== 'function') return;
    closeIds.forEach((id) => {
      const button = document.getElementById(id);
      if (button) {
        button.addEventListener('click', onClose);
      }
    });
    const overlay = modal.querySelector('.modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', onClose);
    }
  }

  openBackupSyncConfigModal() {
    this.renderBackupSyncSettings(this.syncSettings || {});
    const modal = document.getElementById('backupSyncConfigModal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  }

  openBackupSyncDetailPage() {
    this.renderBackupSyncSettings(this.syncSettings || {});
    showPage('backupSyncDetailPage');
  }

  openBackupSyncConflictModal() {
    const conflicts = Array.isArray(this.syncSettings?.conflicts) ? this.syncSettings.conflicts : [];
    if (!conflicts.length) return;
    this.renderBackupSyncConflicts(conflicts);
    document.getElementById('backupSyncConflictModal')?.classList.remove('hidden');
  }

  closeBackupSyncConflictModal() {
    document.getElementById('backupSyncConflictModal')?.classList.add('hidden');
  }

  closeBackupSyncConfigModal() {
    const modal = document.getElementById('backupSyncConfigModal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  async loadSettings() {
    try {
      let settings = await this.wallet.getBackupSyncSettings();
      if (settings?.authMode !== 'ucan' && settings?.authMode !== 'basic') {
        const result = await this.wallet.updateBackupSyncSettings({ authMode: 'ucan' });
        settings = result?.settings || { ...settings, authMode: 'ucan' };
      }
      this.syncSettings = settings || {};
      this.renderBackupSyncSettings(settings);
    } catch (error) {
      console.error('[BackupSyncSettings] 获取 Backup & Sync 设置失败:', error);
    }
  }

  renderBackupSyncSettings(settings = {}) {
    const enabledToggle = document.getElementById('backupSyncEnabledToggle');
    const endpointInput = document.getElementById('backupSyncEndpointInput');
    const authModeSelect = document.getElementById('backupSyncAuthModeSelect');
    const usernameInput = document.getElementById('backupSyncUsernameInput');
    const passwordInput = document.getElementById('backupSyncPasswordInput');
    const tokenStatus = document.getElementById('backupSyncTokenStatus');
    const endpointValue = document.getElementById('backupSyncEndpointValue');
    const authModeValue = document.getElementById('backupSyncAuthModeValue');
    const connectionStatus = document.getElementById('backupSyncConnectionStatus');
    const lastPullValue = document.getElementById('backupSyncLastPullValue');
    const lastPushValue = document.getElementById('backupSyncLastPushValue');

    if (enabledToggle) enabledToggle.checked = Boolean(settings.enabled);
    if (endpointInput) endpointInput.value = settings.endpoint || 'https://warehouse.tidukongjian.com/dav';
    const authMode = settings.authMode === 'basic' ? 'basic' : 'ucan';
    if (authModeSelect) authModeSelect.value = authMode;
    if (usernameInput) usernameInput.value = this.getBackupSyncBasicUsername(settings.basicAuth || '');
    if (passwordInput) passwordInput.value = '';

    this.updateBackupSyncAuthPanel(authMode);
    this.updateBackupSyncTokenStatus(settings, tokenStatus);
    if (endpointValue) endpointValue.textContent = settings.endpoint || 'https://warehouse.tidukongjian.com/dav';
    if (authModeValue) authModeValue.textContent = this.getBackupSyncAuthModeLabel(authMode);
    if (connectionStatus) connectionStatus.textContent = settings.enabled ? '已安全连接' : '未启用';
    if (lastPullValue) lastPullValue.textContent = settings.lastPullAt ? formatLocaleDateTime(settings.lastPullAt) : '-';
    if (lastPushValue) lastPushValue.textContent = settings.lastPushAt ? formatLocaleDateTime(settings.lastPushAt) : '-';
    this.updateBackupSyncEnabledState(Boolean(settings.enabled));
    window.refreshWalletSelects?.();

    this.renderBackupSyncAccountAddress();
    this.renderBackupSyncConflicts(settings.conflicts || []);
    this.renderBackupSyncLogRetention(settings);
    this.updateBackupSyncLogs(settings.logs || []);
    this.toggleBackupSyncDebug();
  }

  updateBackupSyncAuthPanel(mode) {
    const siwePanel = document.getElementById('backupSyncSiwePanel');
    const basicPanel = document.getElementById('backupSyncBasicPanel');
    const ucanHint = document.getElementById('backupSyncUcanHint');

    if (siwePanel) siwePanel.classList.toggle('hidden', mode !== 'siwe');
    if (basicPanel) basicPanel.classList.toggle('hidden', mode !== 'basic');
    if (ucanHint) ucanHint.classList.toggle('hidden', mode !== 'ucan');
  }

  getBackupSyncAuthModeLabel(mode) {
    if (mode === 'basic') return '用户名和密码';
    if (mode === 'siwe') return '钱包签名';
    return '钱包授权';
  }

  getBackupSyncBasicUsername(value) {
    const encoded = String(value || '').replace(/^Basic\s+/i, '').trim();
    if (!encoded) return '';
    try {
      const decoded = atob(encoded);
      return decoded.split(':', 1)[0] || '';
    } catch {
      return '';
    }
  }

  updateBackupSyncEnabledState(enabled) {
    const endpointInput = document.getElementById('backupSyncEndpointInput');
    const authModeSelect = document.getElementById('backupSyncAuthModeSelect');
    const nowBtn = document.getElementById('backupSyncNowBtn');

    if (endpointInput) endpointInput.disabled = !enabled;
    if (authModeSelect) authModeSelect.disabled = !enabled;
    if (nowBtn) {
      nowBtn.disabled = !enabled;
      nowBtn.classList.toggle('hidden', !enabled);
    }

    const panelControls = document.querySelectorAll(
      '#backupSyncSiwePanel button, #backupSyncBasicPanel button, #backupSyncBasicPanel input'
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
    const list = Array.isArray(conflicts) ? conflicts : [];
    const button = document.getElementById('backupSyncConflictBtn');
    if (button) {
      button.classList.toggle('hidden', list.length === 0);
      button.textContent = list.length > 0 ? `冲突 ${list.length}` : '冲突';
    }

    if (list.length === 0) {
      if (container) container.innerHTML = '';
      this.closeBackupSyncConflictModal();
      return;
    }

    if (!container) return;

    container.innerHTML = list.map(conflict => {
      const isRollback = conflict.type === 'remote-rollback';
      const title = isRollback
        ? '远端备份版本回退'
        : conflict.type === 'contact'
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
              <span class="sync-conflict-local">${isRollback ? '已见版本' : '本地'}: ${localName || '-'}</span>
              <span class="sync-conflict-remote">${isRollback ? '远端版本' : '远端'}: ${remoteName || '-'}</span>
            </div>
          </div>
          <div class="sync-conflict-actions">
            <button class="btn btn-secondary btn-small" data-conflict-action="local" data-conflict-id="${escapeHtml(conflict.id)}">${isRollback ? '保留本地' : '用本地'}</button>
            <button class="btn btn-primary btn-small" data-conflict-action="remote" data-conflict-id="${escapeHtml(conflict.id)}">${isRollback ? '信任远端' : '用远端'}</button>
          </div>
        </div>
      `;
    }).join('');
  }

  async openBackupSyncLogsPage(returnPage = 'backupSyncDetailPage') {
    document.getElementById('backupSyncLogsPage').dataset.returnPage = returnPage;
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
      console.error('[BackupSyncSettings] 加载同步日志失败:', error);
      this.updateBackupSyncLogs([]);
    }
  }

  renderBackupSyncLogRetention(settings = {}) {
    const maxInput = document.getElementById('backupSyncLogMaxInput');
    const daysInput = document.getElementById('backupSyncLogRetentionInput');
    const maxCount = normalizeLogMaxCount(settings.logMaxCount ?? DEFAULT_LOG_MAX_COUNT);
    const days = normalizeLogRetentionDays(settings.logRetentionDays ?? DEFAULT_LOG_RETENTION_DAYS);

    if (maxInput) {
      maxInput.value = String(maxCount);
    }
    if (daysInput) {
      daysInput.value = String(days);
    }
  }

  updateBackupSyncLogs(logs = []) {
    this.syncLogs = Array.isArray(logs) ? logs : [];
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
      await this.loadSettings();
      showSuccess('已处理冲突');
    } catch (error) {
      console.error('[BackupSyncSettings] 处理同步冲突失败:', error);
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
      console.error('[BackupSyncSettings] 生成测试冲突失败:', error);
      showError('生成失败: ' + error.message);
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
    const toggle = document.getElementById('backupSyncEnabledToggle');
    try {
      if (enabled) {
        await this.enableBackupSyncWithAuth();
        return;
      }

      const result = await this.wallet.updateBackupSyncSettings({ enabled: false });
      if (result?.settings) {
        this.syncSettings = result.settings;
        this.renderBackupSyncSettings(result.settings);
      }
      showSuccess('已关闭备份与同步');
    } catch (error) {
      console.error('[BackupSyncSettings] 更新 Backup & Sync 开关失败:', error);
      if (toggle) toggle.checked = !enabled;
      showError((enabled ? '开启失败: ' : '关闭失败: ') + error.message);
    }
  }

  async enableBackupSyncWithAuth() {
    const toggle = document.getElementById('backupSyncEnabledToggle');
    try {
      const savedConfig = await this.saveBackupSyncConnectionSettings();
      let settings = savedConfig.settings;
      const authResult = await this.ensureBackupSyncAuthReady(settings);
      if (authResult?.cancelled) {
        if (toggle) toggle.checked = false;
        return;
      }
      settings = authResult?.settings || settings;

      const enableResult = await this.wallet.updateBackupSyncSettings({ enabled: true });
      if (enableResult?.settings) {
        this.syncSettings = enableResult.settings;
        this.renderBackupSyncSettings(enableResult.settings);
      }

      let syncResult;
      showWaiting();
      try {
        syncResult = await this.wallet.backupSyncNow();
      } finally {
        hideWaiting();
      }
      if (!syncResult?.success) {
        throw new Error(syncResult?.error || '同步失败');
      }

      const latest = await this.wallet.getBackupSyncSettings?.();
      if (latest) {
        this.syncSettings = latest;
        this.renderBackupSyncSettings(latest);
      }
      showSuccess('备份与同步已启用');
    } catch (error) {
      console.error('[BackupSyncSettings] 开启 Backup & Sync 失败:', error);
      const rollback = await this.wallet.updateBackupSyncSettings({ enabled: false }).catch(() => null);
      if (rollback?.settings) {
        this.syncSettings = rollback.settings;
        this.renderBackupSyncSettings(rollback.settings);
      }
      if (toggle) toggle.checked = false;
      showError('开启失败: ' + error.message);
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
      console.error('[BackupSyncSettings] 更新 WebDAV 地址失败:', error);
      await this.logBackupSyncError('endpoint-update-error', error?.message || 'WebDAV 地址保存失败');
      showError('保存失败: ' + error.message);
    }
  }

  async handleBackupSyncConfigSave() {
    try {
      const { settings, resolved, input } = await this.saveBackupSyncConnectionSettings();
      showSuccess(resolved !== input ? `配置已保存（地址自动识别为 ${resolved}）` : '配置已保存');
      if (settings) {
        this.syncSettings = settings;
        this.renderBackupSyncSettings(settings);
      }
      this.closeBackupSyncConfigModal();
    } catch (error) {
      console.error('[BackupSyncSettings] 保存 Backup & Sync 配置失败:', error);
      await this.logBackupSyncError('config-save-error', error?.message || 'Backup & Sync 配置保存失败');
      showError('保存失败: ' + error.message);
    }
  }

  async saveBackupSyncConnectionSettings() {
    const endpointInput = document.getElementById('backupSyncEndpointInput');
    const authModeSelect = document.getElementById('backupSyncAuthModeSelect');
    const usernameInput = document.getElementById('backupSyncUsernameInput');
    const passwordInput = document.getElementById('backupSyncPasswordInput');
    const trimmed = String(endpointInput?.value || this.syncSettings?.endpoint || '').trim();
    if (!trimmed) {
      throw new Error('请输入 WebDAV 地址');
    }
    try {
      new URL(trimmed);
    } catch {
      throw new Error('WebDAV 地址格式不正确');
    }

    const resolved = await this.detectBackupSyncEndpoint(trimmed);
    const username = String(usernameInput?.value || '').trim();
    const password = String(passwordInput?.value || '');
    const authMode = authModeSelect?.value === 'basic' ? 'basic' : 'ucan';
    if (authMode === 'basic' && ((username && !password) || (!username && password))) {
      throw new Error('请同时填写用户名和密码');
    }
    if (authMode === 'basic' && !username && !password) {
      throw new Error('请输入用户名和密码');
    }
    const updates = {
      endpoint: resolved,
      authMode
    };
    if (authMode === 'basic') {
      updates.basicAuth = normalizeBasicAuth(`${username}:${password}`);
    }
    const result = await this.wallet.updateBackupSyncSettings(updates);
    if (result?.settings) {
      this.syncSettings = result.settings;
      this.renderBackupSyncSettings(result.settings);
    }
    return { settings: result?.settings || this.syncSettings || null, resolved, input: trimmed };
  }

  async handleBackupSyncAuthModeChange(mode) {
    try {
      const result = await this.wallet.updateBackupSyncSettings({ authMode: mode });
      if (result?.settings) {
        this.syncSettings = result.settings;
        this.renderBackupSyncSettings(result.settings);
      }
    } catch (error) {
      console.error('[BackupSyncSettings] 更新认证方式失败:', error);
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
      console.error('[BackupSyncSettings] SIWE 登录失败:', error);
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
      console.error('[BackupSyncSettings] 刷新 Token 失败:', error);
      await this.logBackupSyncError('siwe-refresh-error', error?.message || 'SIWE 刷新失败');
      showError('刷新失败: ' + error.message);
    }
  }

  async handleBackupSyncUcanGenerate() {
    try {
      const generation = await this.generateBackupSyncUcan();
      if (generation?.cancelled) {
        return;
      }
      await this.tryBackupSyncAfterUcanAuth(generation?.settings);
      showSuccess('UCAN 已生成');
    } catch (error) {
      console.error('[BackupSyncSettings] 生成 UCAN 失败:', error);
      await this.logBackupSyncError('ucan-generate-error', error?.message || 'UCAN 生成失败');
      showError('生成失败: ' + error.message);
    }
  }

  async generateBackupSyncUcan() {
    const endpoint = (document.getElementById('backupSyncEndpointInput')?.value || '').trim();
    if (!endpoint) {
      throw new Error('请输入 WebDAV 地址');
    }
    try {
      new URL(endpoint);
    } catch {
      throw new Error('WebDAV 地址格式不正确');
    }

    const account = await this.wallet.getCurrentAccount();
    if (!account?.address) {
      throw new Error('未找到当前账户');
    }

    if (!this.transaction) {
      throw new Error('签名模块未初始化');
    }

    const resourceInput = document.getElementById('backupSyncUcanResourceInput');
    const actionInput = document.getElementById('backupSyncUcanActionInput');
    const audienceInput = document.getElementById('backupSyncUcanAudienceInput');
    const ttlInput = document.getElementById('backupSyncUcanTtlInput');

    const resource = normalizeUcanResource(resourceInput?.value || '');
    const action = normalizeUcanAction(actionInput?.value || '', resource);
    const audience = String(audienceInput?.value || '').trim() || deriveUcanAudience(endpoint);
    const ttlHours = Number(ttlInput?.value || '24');
    const ttlMs = Number.isFinite(ttlHours) ? ttlHours * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

    if (!audience) {
      throw new Error('请填写 Audience');
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
      return { cancelled: true, settings: this.syncSettings || null };
    }

    showWaiting();
    try {
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

      const normalizedToken = normalizeUcanToken(token);
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
      return { cancelled: false, settings: result?.settings || this.syncSettings || null };
    } finally {
      hideWaiting();
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
      const header = normalizeBasicAuth(raw);
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
      console.error('[BackupSyncSettings] 保存 Basic 凭证失败:', error);
      showError('保存失败: ' + error.message);
    }
  }

  async handleBackupSyncNow() {
    try {
      await this.ensureBackupSyncEndpoint();
      const currentSettings = this.syncSettings || await this.wallet.getBackupSyncSettings();
      const preflight = await this.ensureBackupSyncUcanFresh(currentSettings);
      if (preflight?.cancelled) {
        return;
      }

      let result;
      showWaiting();
      try {
        result = await this.wallet.backupSyncNow();
      } finally {
        hideWaiting();
      }

      if (!result?.success) {
        const syncError = new Error(result?.error || '同步失败');
        if (this.shouldRetryBackupSyncWithUcan(syncError, preflight?.settings || currentSettings)) {
          const refresh = await this.ensureBackupSyncUcanFresh(preflight?.settings || currentSettings, { force: true });
          if (refresh?.cancelled) {
            return;
          }
          showWaiting();
          try {
            result = await this.wallet.backupSyncNow();
          } finally {
            hideWaiting();
          }
        }
      }

      if (!result?.success) {
        throw new Error(result?.error || '同步失败');
      }
      await this.loadSettings();
      showSuccess('同步完成');
    } catch (error) {
      console.error('[BackupSyncSettings] 立即同步失败:', error);
      showError(this.formatBackupSyncError(error, '同步失败'));
    } finally {
      hideWaiting();
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
      await this.loadSettings();
      showSuccess('远端备份已清除');
    } catch (error) {
      console.error('[BackupSyncSettings] 清除远端备份失败:', error);
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
      await this.loadSettings();
      showSuccess('同步日志已清空');
    } catch (error) {
      console.error('[BackupSyncSettings] 清空同步日志失败:', error);
      showError('清理失败: ' + error.message);
    }
  }

  async handleBackupSyncLogRetentionSave() {
    const maxInput = document.getElementById('backupSyncLogMaxInput');
    const daysInput = document.getElementById('backupSyncLogRetentionInput');
    const rawMax = Number(maxInput?.value || '');
    const rawDays = Number(daysInput?.value || '');

    const maxCount = normalizeLogMaxCount(rawMax);
    const days = normalizeLogRetentionDays(rawDays);

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
      console.error('[BackupSyncSettings] 保存日志留存策略失败:', error);
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
      console.warn('[BackupSyncSettings] 写入同步错误日志失败:', error?.message || error);
    }
  }

  getBackupSyncUcanExpiresAt(settings = {}) {
    return getUcanExpiresAt(settings?.ucanToken || '');
  }

  isBackupSyncUcanExpiringSoon(settings = {}, thresholdMs = 5 * 60 * 1000) {
    const expiresAt = this.getBackupSyncUcanExpiresAt(settings);
    if (!expiresAt) return true;
    return expiresAt <= (Date.now() + thresholdMs);
  }

  shouldRetryBackupSyncWithUcan(error, settings = {}) {
    const mode = String(settings?.authMode || 'ucan').toLowerCase();
    if (mode !== 'ucan') return false;
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('401')
      || message.includes('unauthorized')
      || message.includes('authentication failed');
  }

  getBackupSyncSiweExpiresAt(settings = {}) {
    const value = settings?.authTokenExpiresAt;
    if (!value) return null;
    const timestamp = Number(value);
    if (Number.isFinite(timestamp)) return timestamp;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  isBackupSyncSiweExpiringSoon(settings = {}, thresholdMs = 5 * 60 * 1000) {
    const token = String(settings?.authToken || '').trim();
    if (!token) return true;
    const expiresAt = this.getBackupSyncSiweExpiresAt(settings);
    if (!expiresAt) return false;
    return expiresAt <= (Date.now() + thresholdMs);
  }

  async ensureBackupSyncAuthReady(settings = {}) {
    const mode = String(settings?.authMode || 'ucan').toLowerCase();
    if (mode === 'basic') {
      const basicInput = document.getElementById('backupSyncBasicInput');
      const raw = String(basicInput?.value || settings.basicAuth || '').trim();
      if (!raw) {
        throw new Error('请先在服务配置中填写 Basic 凭证');
      }
      const basicAuth = normalizeBasicAuth(raw);
      if (basicAuth !== settings.basicAuth) {
        const result = await this.wallet.updateBackupSyncSettings({ authMode: 'basic', basicAuth });
        if (result?.settings) {
          this.syncSettings = result.settings;
          this.renderBackupSyncSettings(result.settings);
          return { cancelled: false, settings: result.settings };
        }
      }
      return { cancelled: false, settings };
    }

    if (mode === 'siwe') {
      return await this.ensureBackupSyncSiweFresh(settings);
    }

    return await this.ensureBackupSyncUcanFresh(settings);
  }

  async ensureBackupSyncSiweFresh(settings = {}, options = {}) {
    const { force = false } = options;
    if (!force && !this.isBackupSyncSiweExpiringSoon(settings)) {
      return { cancelled: false, settings };
    }

    const endpoint = String(settings?.endpoint || document.getElementById('backupSyncEndpointInput')?.value || '').trim();
    if (!endpoint) {
      throw new Error('请输入 WebDAV 地址');
    }
    try {
      new URL(endpoint);
    } catch {
      throw new Error('WebDAV 地址格式不正确');
    }

    const account = await this.wallet.getCurrentAccount();
    if (!account?.address) {
      throw new Error('未找到当前账户');
    }
    if (!this.transaction) {
      throw new Error('签名模块未初始化');
    }

    let challenge;
    showWaiting();
    try {
      challenge = await this.fetchSiweChallenge(endpoint, account.address);
    } finally {
      hideWaiting();
    }
    if (!challenge) {
      throw new Error('无法获取挑战信息');
    }

    const password = await this.requestPassword?.();
    if (!password) {
      return { cancelled: true, settings };
    }

    showWaiting();
    try {
      const signature = await this.transaction.signMessage(challenge, password);
      const verifyResult = await this.fetchSiweVerify(endpoint, account.address, signature);
      const token = verifyResult?.token;
      const expiresAt = verifyResult?.expiresAt || null;
      if (!token) {
        throw new Error('登录失败：未返回 Token');
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
      return { cancelled: false, settings: result?.settings || this.syncSettings || settings };
    } finally {
      hideWaiting();
    }
  }

  async ensureBackupSyncUcanFresh(settings = {}, options = {}) {
    const { force = false } = options;
    const mode = String(settings?.authMode || 'ucan').toLowerCase();
    if (mode !== 'ucan') {
      return { cancelled: false, settings };
    }
    if (!force && !this.isBackupSyncUcanExpiringSoon(settings)) {
      return { cancelled: false, settings };
    }

    const expiresAt = this.getBackupSyncUcanExpiresAt(settings);
    if (force) {
      showSuccess('同步认证失效，正在重新授权');
    } else if (expiresAt) {
      showSuccess(`UCAN 即将过期，正在刷新 (${formatDate(expiresAt, 'relative')})`);
    } else {
      showSuccess('UCAN 不可用，正在重新授权');
    }

    return await this.generateBackupSyncUcan();
  }

  async tryBackupSyncAfterUcanAuth(settings) {
    const enabled = Boolean(settings?.enabled);
    const endpoint = String(settings?.endpoint || '').trim();
    if (!enabled || !endpoint) return;
    try {
      await this.handleBackupSyncNow();
    } catch (error) {
      console.warn('[BackupSyncSettings] UCAN 保存后同步失败:', error?.message || error);
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
}
