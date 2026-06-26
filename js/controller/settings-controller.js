import { showPage, showSuccess, showError, showWaiting, hideWaiting } from '../common/ui/index.js';
import { formatDate, formatLocaleDateTime, formatIsoTimestamp } from '../common/utils/time-utils.js';
import { shortenAddress } from '../common/chain/index.js';
import { escapeHtml } from '../common/ui/html-ui.js';
import {
  normalizeBearerToken,
  getUcanExpiresAt,
  deriveUcanAudience,
  buildSiweMessage,
  createUcanInvocationKey,
  createUcanInvocationToken
} from '../common/ucan-utils.js';
import { isDeveloperFeatureEnabled } from '../config/index.js';
import { BackupSyncSettingsController } from './settings/backup-sync-settings-controller.js';

const LEGACY_DEFAULT_APP_ID = 'yeying-wallet';
const DEFAULT_UCAN_ACTION = 'write';
const DEFAULT_LOG_MAX_COUNT = 100000;
const DEFAULT_LOG_RETENTION_DAYS = 30;
const LOG_MAX_COUNT_MIN = 50;
const LOG_MAX_COUNT_MAX = 100000;
const LOG_RETENTION_MIN_DAYS = 1;
const LOG_RETENTION_MAX_DAYS = 365;
const DEFAULT_MPC_AUTH_SCHEME = 'ucan';
const DEFAULT_MPC_E2E_SUITE = 'x25519-aes-gcm';
const DEFAULT_MPC_REFRESH_POLICY = 'manual';
const DEFAULT_MPC_COORDINATOR_ENDPOINT = 'https://node.yeying.pub';
const DEFAULT_MPC_UCAN_RESOURCE = 'mpc';
const DEFAULT_MPC_UCAN_ACTION = 'coordinate';
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
    this.mpcSettings = null;
    this.backupController = new BackupSyncSettingsController({ wallet, transaction, requestPassword });
    this.mpcLogs = [];
    this.mpcLogQuery = '';
    this.mpcLogFiltered = [];
    this.mpcLogPageSize = 30;
    this.mpcLogVisibleCount = 0;
    this.mpcSessions = [];
    this.mpcMessages = [];
    this.mpcMessageCursor = null;
    this.mpcMessagePollTimer = null;
    this.mpcMessagePollSessionId = '';
    this.mpcMessagePollIntervalMs = 5000;
    this.activeMpcSessionId = '';
    this.activeMpcMessageId = '';
  }

  bindEvents() {
    this.backupController.bindEvents();

    const mpcAuditBtn = document.getElementById('mpcAuditBtn');
    if (mpcAuditBtn) {
      mpcAuditBtn.addEventListener('click', async () => {
        await this.openMpcLogsPage();
      });
    }

    const mpcLogsSearchInput = document.getElementById('mpcLogsSearchInput');
    if (mpcLogsSearchInput) {
      mpcLogsSearchInput.addEventListener('input', () => {
        this.applyMpcLogsFilter(mpcLogsSearchInput.value);
      });
    }

    const mpcLogsList = document.getElementById('mpcLogsList');
    if (mpcLogsList) {
      mpcLogsList.addEventListener('scroll', () => {
        this.handleMpcLogsScroll();
      });
    }

    const mpcClearLogsBtn = document.getElementById('mpcClearLogsBtn');
    if (mpcClearLogsBtn) {
      mpcClearLogsBtn.addEventListener('click', async () => {
        await this.handleMpcClearLogs();
      });
    }

    const mpcAuditExportSaveBtn = document.getElementById('mpcAuditExportSaveBtn');
    if (mpcAuditExportSaveBtn) {
      mpcAuditExportSaveBtn.addEventListener('click', async () => {
        await this.handleMpcAuditExportSave();
      });
    }

    const mpcAuditExportFlushBtn = document.getElementById('mpcAuditExportFlushBtn');
    if (mpcAuditExportFlushBtn) {
      mpcAuditExportFlushBtn.addEventListener('click', async () => {
        await this.handleMpcAuditExportFlush();
      });
    }

    const mpcAuditExportAllBtn = document.getElementById('mpcAuditExportAllBtn');
    if (mpcAuditExportAllBtn) {
      mpcAuditExportAllBtn.addEventListener('click', async () => {
        await this.handleMpcAuditExportAll();
      });
    }

    const mpcAuditExportJsonBtn = document.getElementById('mpcAuditExportJsonBtn');
    if (mpcAuditExportJsonBtn) {
      mpcAuditExportJsonBtn.addEventListener('click', async () => {
        await this.handleMpcAuditExportJson();
      });
    }

    const mpcAuditExportCsvBtn = document.getElementById('mpcAuditExportCsvBtn');
    if (mpcAuditExportCsvBtn) {
      mpcAuditExportCsvBtn.addEventListener('click', async () => {
        await this.handleMpcAuditExportCsv();
      });
    }

    const mpcAuthSchemeSelect = document.getElementById('mpcAuthSchemeSelect');
    if (mpcAuthSchemeSelect) {
      mpcAuthSchemeSelect.addEventListener('change', async () => {
        await this.handleMpcSettingsUpdate({ authScheme: mpcAuthSchemeSelect.value });
      });
    }

    const mpcE2eSuiteSelect = document.getElementById('mpcE2eSuiteSelect');
    if (mpcE2eSuiteSelect) {
      mpcE2eSuiteSelect.addEventListener('change', async () => {
        await this.handleMpcSettingsUpdate({ e2eSuite: mpcE2eSuiteSelect.value });
      });
    }

    const mpcRefreshPolicySelect = document.getElementById('mpcRefreshPolicySelect');
    if (mpcRefreshPolicySelect) {
      mpcRefreshPolicySelect.addEventListener('change', async () => {
        await this.handleMpcSettingsUpdate({ refreshPolicy: mpcRefreshPolicySelect.value });
      });
    }

    const mpcCoordinatorSaveBtn = document.getElementById('mpcCoordinatorSaveBtn');
    if (mpcCoordinatorSaveBtn) {
      mpcCoordinatorSaveBtn.addEventListener('click', async () => {
        await this.handleMpcCoordinatorSave();
      });
    }

    const mpcCoordinatorUcanGenerateBtn = document.getElementById('mpcCoordinatorUcanGenerateBtn');
    if (mpcCoordinatorUcanGenerateBtn) {
      mpcCoordinatorUcanGenerateBtn.addEventListener('click', async () => {
        await this.handleMpcCoordinatorUcanGenerate();
      });
    }

    const mpcKeygenCreateBtn = document.getElementById('mpcKeygenCreateBtn');
    if (mpcKeygenCreateBtn) {
      mpcKeygenCreateBtn.addEventListener('click', async () => {
        await this.handleMpcKeygenCreate();
      });
    }

    const mpcJoinSessionBtn = document.getElementById('mpcJoinSessionBtn');
    if (mpcJoinSessionBtn) {
      mpcJoinSessionBtn.addEventListener('click', async () => {
        await this.handleMpcJoinSession();
      });
    }

    const mpcStopStreamBtn = document.getElementById('mpcStopStreamBtn');
    if (mpcStopStreamBtn) {
      mpcStopStreamBtn.addEventListener('click', async () => {
        await this.handleMpcStopStream();
      });
    }

    const mpcSendMessageBtn = document.getElementById('mpcSendMessageBtn');
    if (mpcSendMessageBtn) {
      mpcSendMessageBtn.addEventListener('click', async () => {
        await this.handleMpcSendMessage();
      });
    }

    const mpcMessagesPollStartBtn = document.getElementById('mpcMessagesPollStartBtn');
    if (mpcMessagesPollStartBtn) {
      mpcMessagesPollStartBtn.addEventListener('click', async () => {
        await this.handleMpcMessagesPollStart();
      });
    }

    const mpcMessagesPollStopBtn = document.getElementById('mpcMessagesPollStopBtn');
    if (mpcMessagesPollStopBtn) {
      mpcMessagesPollStopBtn.addEventListener('click', async () => {
        await this.handleMpcMessagesPollStop();
      });
    }

    const mpcMessagesList = document.getElementById('mpcMessagesList');
    if (mpcMessagesList) {
      mpcMessagesList.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-mpc-message-view]');
        if (!btn) return;
        const messageId = btn.dataset.messageId;
        if (messageId) {
          this.openMpcMessageDetail(messageId);
        }
      });
    }

    const mpcSessionsRefreshBtn = document.getElementById('mpcSessionsRefreshBtn');
    if (mpcSessionsRefreshBtn) {
      mpcSessionsRefreshBtn.addEventListener('click', async () => {
        await this.loadMpcSessions();
      });
    }

    const mpcSessionsList = document.getElementById('mpcSessionsList');
    if (mpcSessionsList) {
      mpcSessionsList.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-mpc-session-use]');
        if (btn) {
          const sessionId = btn.dataset.sessionId;
          if (sessionId) {
            this.fillMpcSessionFields(sessionId);
          }
          return;
        }
        const detailBtn = event.target.closest('[data-mpc-session-detail]');
        if (!detailBtn) return;
        const sessionId = detailBtn.dataset.sessionId;
        if (sessionId) {
          this.openMpcSessionDetail(sessionId);
        }
      });
    }

    const refreshMpcSessionDetailBtn = document.getElementById('refreshMpcSessionDetailBtn');
    if (refreshMpcSessionDetailBtn) {
      refreshMpcSessionDetailBtn.addEventListener('click', async () => {
        await this.refreshMpcSessionDetail();
      });
    }

    const closeMpcSessionDetailBtn = document.getElementById('closeMpcSessionDetailBtn');
    if (closeMpcSessionDetailBtn) {
      closeMpcSessionDetailBtn.addEventListener('click', () => {
        this.closeMpcSessionDetail();
      });
    }

    const closeMpcSessionDetailModal = document.getElementById('closeMpcSessionDetailModal');
    if (closeMpcSessionDetailModal) {
      closeMpcSessionDetailModal.addEventListener('click', () => {
        this.closeMpcSessionDetail();
      });
    }

    const mpcSessionDetailModal = document.getElementById('mpcSessionDetailModal');
    if (mpcSessionDetailModal) {
      const overlay = mpcSessionDetailModal.querySelector('.modal-overlay');
      if (overlay) {
        overlay.addEventListener('click', () => {
          this.closeMpcSessionDetail();
        });
      }
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
    return this.backupController.loadSettings();
  }

  async loadMpcSettings() {
    try {
      const settings = await this.wallet.getMpcSettings();
      this.mpcSettings = settings || {};
      this.renderMpcSettings(settings);
      await this.renderMpcIdentityDefault();
    } catch (error) {
      console.error('[SettingsController] 获取 MPC 设置失败:', error);
    }
  }

  renderMpcSettings(settings = {}) {
    const authSelect = document.getElementById('mpcAuthSchemeSelect');
    const suiteSelect = document.getElementById('mpcE2eSuiteSelect');
    const refreshSelect = document.getElementById('mpcRefreshPolicySelect');
    const endpointInput = document.getElementById('mpcCoordinatorEndpointInput');
    const ucanResourceInput = document.getElementById('mpcCoordinatorUcanResourceInput');
    const ucanActionInput = document.getElementById('mpcCoordinatorUcanActionInput');
    const ucanAudienceInput = document.getElementById('mpcCoordinatorUcanAudienceInput');
    const ucanTokenInput = document.getElementById('mpcCoordinatorUcanTokenInput');
    const ucanTtlInput = document.getElementById('mpcCoordinatorUcanTtlInput');

    if (authSelect) {
      authSelect.value = settings.authScheme || DEFAULT_MPC_AUTH_SCHEME;
    }
    if (suiteSelect) {
      suiteSelect.value = settings.e2eSuite || DEFAULT_MPC_E2E_SUITE;
    }
    if (refreshSelect) {
      refreshSelect.value = settings.refreshPolicy || DEFAULT_MPC_REFRESH_POLICY;
    }
    if (endpointInput) {
      endpointInput.value = settings.coordinatorEndpoint || DEFAULT_MPC_COORDINATOR_ENDPOINT;
    }
    if (ucanResourceInput) {
      ucanResourceInput.value = this.normalizeMpcUcanResource(settings.ucanResource || '');
    }
    if (ucanActionInput) {
      const resource = this.normalizeMpcUcanResource(settings.ucanResource || '');
      ucanActionInput.value = this.normalizeMpcUcanAction(settings.ucanAction || '', resource);
    }
    if (ucanAudienceInput) {
      const endpoint = settings.coordinatorEndpoint || DEFAULT_MPC_COORDINATOR_ENDPOINT;
      ucanAudienceInput.value = settings.ucanAudience || this.deriveUcanAudience(endpoint);
    }
    if (ucanTokenInput) {
      ucanTokenInput.value = settings.ucanToken || '';
    }
    if (ucanTtlInput && !ucanTtlInput.value) {
      ucanTtlInput.value = '24';
    }
    window.refreshWalletSelects?.();
  }

  async handleMpcSettingsUpdate(updates = {}) {
    try {
      const result = await this.wallet.updateMpcSettings(updates);
      if (result?.settings) {
        this.mpcSettings = result.settings;
        this.renderMpcSettings(result.settings);
      }
      showSuccess('MPC 设置已保存');
    } catch (error) {
      console.error('[SettingsController] 更新 MPC 设置失败:', error);
      showError('保存失败: ' + error.message);
    }
  }

  async handleMpcCoordinatorSave() {
    const endpointInput = document.getElementById('mpcCoordinatorEndpointInput');
    const ucanResourceInput = document.getElementById('mpcCoordinatorUcanResourceInput');
    const ucanActionInput = document.getElementById('mpcCoordinatorUcanActionInput');
    const ucanAudienceInput = document.getElementById('mpcCoordinatorUcanAudienceInput');
    const ucanTokenInput = document.getElementById('mpcCoordinatorUcanTokenInput');

    const endpoint = String(endpointInput?.value || '').trim();
    if (endpoint) {
      try {
        new URL(endpoint);
      } catch {
        showError('协调器地址格式不正确');
        return;
      }
    }

    const ucanResource = this.normalizeMpcUcanResource(ucanResourceInput?.value || '');
    const ucanAction = this.normalizeMpcUcanAction(ucanActionInput?.value || '', ucanResource);
    const ucanAudience = String(ucanAudienceInput?.value || '').trim() || this.deriveUcanAudience(endpoint);
    const ucanToken = this.normalizeUcanToken(String(ucanTokenInput?.value || '').trim());

    await this.handleMpcSettingsUpdate({
      coordinatorEndpoint: endpoint,
      ucanResource,
      ucanAction,
      ucanAudience,
      ucanToken
    });
  }

  async handleMpcCoordinatorUcanGenerate() {
    try {
      const endpoint = String(document.getElementById('mpcCoordinatorEndpointInput')?.value || '').trim();
      if (!endpoint) {
        showError('请输入协调器地址');
        return;
      }
      try {
        new URL(endpoint);
      } catch {
        showError('协调器地址格式不正确');
        return;
      }

      const resourceInput = document.getElementById('mpcCoordinatorUcanResourceInput');
      const actionInput = document.getElementById('mpcCoordinatorUcanActionInput');
      const audienceInput = document.getElementById('mpcCoordinatorUcanAudienceInput');
      const ttlInput = document.getElementById('mpcCoordinatorUcanTtlInput');

      const resource = this.normalizeMpcUcanResource(resourceInput?.value || '');
      const action = this.normalizeMpcUcanAction(actionInput?.value || '', resource);
      const audience = String(audienceInput?.value || '').trim() || this.deriveUcanAudience(endpoint);
      const ttlHours = Number(ttlInput?.value || '24');
      if (!audience) {
        showError('请填写 Audience');
        return;
      }

      const password = await this.requestPassword?.();
      if (!password) {
        return;
      }

      showWaiting();
      const result = await this.wallet.generateMpcCoordinatorUcan({
        coordinatorEndpoint: endpoint,
        ucanResource: resource,
        ucanAction: action,
        ucanAudience: audience,
        ttlHours,
        password
      });

      if (!result?.success) {
        throw new Error(result?.error || '生成失败');
      }

      if (result?.settings) {
        this.mpcSettings = result.settings;
        this.renderMpcSettings(result.settings);
      }
      if (resourceInput) resourceInput.value = result?.resource || resource;
      if (actionInput) actionInput.value = result?.action || action;
      if (audienceInput) audienceInput.value = result?.audience || audience;

      showSuccess('UCAN 已生成');
    } catch (error) {
      console.error('[SettingsController] 生成 MPC UCAN 失败:', error);
      showError('生成失败: ' + error.message);
    } finally {
      hideWaiting();
    }
  }

  async handleMpcKeygenCreate() {
    const sessionIdInput = document.getElementById('mpcKeygenSessionIdInput');
    const walletIdInput = document.getElementById('mpcKeygenWalletIdInput');
    const participantsInput = document.getElementById('mpcKeygenParticipantsInput');
    const thresholdInput = document.getElementById('mpcKeygenThresholdInput');
    const curveSelect = document.getElementById('mpcKeygenCurveSelect');
    const resultEl = document.getElementById('mpcKeygenCreateResult');

    const sessionId = String(sessionIdInput?.value || '').trim();
    const walletId = String(walletIdInput?.value || '').trim();
    const participants = this.parseMpcParticipants(participantsInput?.value || '');
    const threshold = Number(thresholdInput?.value || 0);
    const curve = String(curveSelect?.value || 'secp256k1').trim();

    if (!walletId) {
      showError('请填写 Wallet ID');
      return;
    }
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

    try {
      showWaiting();
      const response = await this.wallet.createMpcSession({
        type: 'keygen',
        sessionId,
        walletId,
        threshold,
        participants,
        curve
      });
      if (!response?.success) {
        throw new Error(response?.error || '创建失败');
      }
      const created = response.session || response.response;
      const createdId = created?.id || response?.session?.id || sessionId || '-';
      if (resultEl) {
        resultEl.textContent = `已创建会话: ${createdId}`;
      }
      const joinSessionInput = document.getElementById('mpcJoinSessionIdInput');
      if (joinSessionInput && createdId && createdId !== '-') {
        joinSessionInput.value = createdId;
      }
      const sendSessionInput = document.getElementById('mpcSendSessionIdInput');
      if (sendSessionInput && createdId && createdId !== '-') {
        sendSessionInput.value = createdId;
      }
      await this.loadMpcSessions();
      showSuccess('会话已创建');
    } catch (error) {
      console.error('[SettingsController] 创建 MPC 会话失败:', error);
      showError('创建失败: ' + error.message);
      if (resultEl) resultEl.textContent = '创建失败';
    } finally {
      hideWaiting();
    }
  }

  async handleMpcJoinSession() {
    const sessionIdInput = document.getElementById('mpcJoinSessionIdInput');
    const participantIdInput = document.getElementById('mpcJoinParticipantIdInput');
    const identityInput = document.getElementById('mpcJoinIdentityInput');
    const resultEl = document.getElementById('mpcJoinSessionResult');

    const sessionId = String(sessionIdInput?.value || '').trim();
    const participantId = String(participantIdInput?.value || '').trim();
    let identity = String(identityInput?.value || '').trim();

    if (!sessionId) {
      showError('请填写 Session ID');
      return;
    }
    if (!participantId) {
      showError('请填写 Participant ID');
      return;
    }
    if (!identity) {
      identity = await this.getDefaultMpcIdentity();
      if (identityInput && identity) {
        identityInput.value = identity;
      }
    }

    const password = await this.requestPassword?.();
    if (!password) {
      return;
    }

    try {
      showWaiting();
      const response = await this.wallet.joinMpcSession({
        sessionId,
        participantId,
        identity,
        password
      });
      if (!response?.success) {
        throw new Error(response?.error || '加入失败');
      }
      const streamResult = await this.wallet.startMpcStream(sessionId);
      if (streamResult && streamResult.success === false) {
        throw new Error(streamResult.error || '监听失败');
      }
      await this.startMpcMessagePolling(sessionId);
      if (resultEl) {
        resultEl.textContent = `已加入并监听: ${sessionId}`;
      }
      const sendSessionInput = document.getElementById('mpcSendSessionIdInput');
      if (sendSessionInput) {
        sendSessionInput.value = sessionId;
      }
      const sendFromInput = document.getElementById('mpcSendFromInput');
      if (sendFromInput && participantId) {
        sendFromInput.value = participantId;
      }
      await this.loadMpcSessions();
      showSuccess('已加入会话');
    } catch (error) {
      console.error('[SettingsController] 加入 MPC 会话失败:', error);
      showError('加入失败: ' + error.message);
      if (resultEl) resultEl.textContent = '加入失败';
    } finally {
      hideWaiting();
    }
  }

  async handleMpcStopStream() {
    const sessionIdInput = document.getElementById('mpcJoinSessionIdInput');
    const resultEl = document.getElementById('mpcJoinSessionResult');
    const sessionId = String(sessionIdInput?.value || '').trim();
    if (!sessionId) {
      showError('请填写 Session ID');
      return;
    }
    try {
      const response = await this.wallet.stopMpcStream(sessionId);
      if (!response?.success) {
        throw new Error(response?.error || '停止失败');
      }
      if (resultEl) {
        resultEl.textContent = `已停止监听: ${sessionId}`;
      }
      showSuccess('已停止监听');
    } catch (error) {
      console.error('[SettingsController] 停止 MPC 监听失败:', error);
      showError('停止失败: ' + error.message);
    }
  }

  async handleMpcSendMessage() {
    const sessionIdInput = document.getElementById('mpcSendSessionIdInput');
    const fromInput = document.getElementById('mpcSendFromInput');
    const toInput = document.getElementById('mpcSendToInput');
    const recipientKeyInput = document.getElementById('mpcSendRecipientKeyInput');
    const typeInput = document.getElementById('mpcSendTypeInput');
    const roundInput = document.getElementById('mpcSendRoundInput');
    const seqInput = document.getElementById('mpcSendSeqInput');
    const payloadInput = document.getElementById('mpcSendPayloadInput');
    const resultEl = document.getElementById('mpcSendMessageResult');

    const sessionId = String(sessionIdInput?.value || '').trim();
    const from = String(fromInput?.value || '').trim();
    const toParticipantId = String(toInput?.value || '').trim();
    const recipientE2ePublicKey = String(recipientKeyInput?.value || '').trim();
    const type = String(typeInput?.value || '').trim() || 'message';
    const round = Number(roundInput?.value || '');
    const seq = Number(seqInput?.value || '');
    const rawPayload = String(payloadInput?.value || '').trim();

    if (!sessionId) {
      showError('请填写 Session ID');
      return;
    }
    if (!from) {
      showError('请填写 From');
      return;
    }
    if (!toParticipantId && !recipientE2ePublicKey) {
      showError('请填写 To 或 Recipient 公钥');
      return;
    }

    let payload = {};
    if (rawPayload) {
      try {
        payload = JSON.parse(rawPayload);
      } catch (error) {
        showError('Payload JSON 无效');
        return;
      }
    }

    const password = await this.requestPassword?.();
    if (!password) {
      return;
    }

    try {
      showWaiting();
      const response = await this.wallet.sendMpcSessionMessage({
        sessionId,
        from,
        toParticipantId: toParticipantId || undefined,
        recipientE2ePublicKey: recipientE2ePublicKey || undefined,
        type,
        round: Number.isFinite(round) ? round : undefined,
        seq: Number.isFinite(seq) ? seq : undefined,
        payload,
        password
      });
      if (!response?.success) {
        throw new Error(response?.error || '发送失败');
      }
      if (resultEl) {
        resultEl.textContent = `已发送: ${response?.message?.id || '-'}`;
      }
      showSuccess('消息已发送');
    } catch (error) {
      console.error('[SettingsController] 发送 MPC 消息失败:', error);
      showError('发送失败: ' + error.message);
      if (resultEl) resultEl.textContent = '发送失败';
    } finally {
      hideWaiting();
    }
  }

  async handleMpcMessagesPollStart() {
    const sessionId = this.resolveMpcSessionId();
    if (!sessionId) {
      showError('请填写 Session ID');
      return;
    }
    await this.startMpcMessagePolling(sessionId);
  }

  async handleMpcMessagesPollStop() {
    this.stopMpcMessagePolling();
    const statusEl = document.getElementById('mpcMessagesPollStatus');
    if (statusEl) {
      statusEl.textContent = '已停止轮询';
    }
  }

  resolveMpcSessionId() {
    const sendInput = document.getElementById('mpcSendSessionIdInput');
    const joinInput = document.getElementById('mpcJoinSessionIdInput');
    const candidate = String(sendInput?.value || '').trim() || String(joinInput?.value || '').trim();
    return candidate;
  }

  async startMpcMessagePolling(sessionId) {
    this.stopMpcMessagePolling();
    this.mpcMessagePollSessionId = sessionId;
    await this.fetchMpcMessagesOnce();
    const statusEl = document.getElementById('mpcMessagesPollStatus');
    if (statusEl) {
      statusEl.textContent = `正在轮询: ${sessionId}`;
    }
    this.mpcMessagePollTimer = setInterval(() => {
      this.fetchMpcMessagesOnce().catch(() => {});
    }, this.mpcMessagePollIntervalMs);
  }

  stopMpcMessagePolling() {
    if (this.mpcMessagePollTimer) {
      clearInterval(this.mpcMessagePollTimer);
      this.mpcMessagePollTimer = null;
    }
    this.mpcMessagePollSessionId = '';
  }

  async fetchMpcMessagesOnce() {
    const sessionId = this.mpcMessagePollSessionId;
    if (!sessionId) return;
    const result = await this.wallet.fetchMpcSessionMessages({
      sessionId,
      cursor: this.mpcMessageCursor,
      limit: 200
    });
    if (!result?.success) {
      throw new Error(result?.error || '拉取消息失败');
    }
    const messages = Array.isArray(result.messages) ? result.messages : [];
    this.mergeMpcMessages(messages);
    if (result.cursor) {
      this.mpcMessageCursor = result.cursor;
    }
    this.renderMpcMessages();
    const statusEl = document.getElementById('mpcMessagesPollStatus');
    if (statusEl) {
      const timeText = formatLocaleDateTime(Date.now());
      statusEl.textContent = `正在轮询: ${sessionId} · 最近更新 ${timeText} · 共 ${this.mpcMessages.length} 条`;
    }
  }

  mergeMpcMessages(messages) {
    const existing = new Map();
    for (const msg of this.mpcMessages) {
      if (msg?.id) {
        existing.set(msg.id, msg);
      }
    }
    for (const msg of messages) {
      if (!msg?.id) continue;
      if (!existing.has(msg.id)) {
        existing.set(msg.id, msg);
      }
    }
    const merged = Array.from(existing.values());
    merged.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    this.mpcMessages = merged;
  }

  renderMpcMessages() {
    const container = document.getElementById('mpcMessagesList');
    if (!container) return;
    const list = Array.isArray(this.mpcMessages) ? this.mpcMessages : [];
    if (!list.length) {
      container.innerHTML = '<div class="empty-message">暂无消息</div>';
      return;
    }
    container.innerHTML = list.slice(-200).map(msg => {
      const timeText = msg?.createdAt ? formatLocaleDateTime(msg.createdAt) : '-';
      const from = msg?.from ? `来自 ${msg.from}` : '';
      const type = msg?.type ? `类型 ${msg.type}` : '';
      const round = Number.isFinite(msg?.round) ? `轮次 ${msg.round}` : '';
      const seq = Number.isFinite(msg?.seq) ? `序号 ${msg.seq}` : '';
      const tags = [from, type, round, seq].filter(Boolean).map(item => `<span class="sync-activity-tag">${escapeHtml(item)}</span>`).join('');
      const actionLabel = msg?.envelope ? '解密' : '查看';
      return `
        <div class="sync-activity-item">
          <div class="sync-activity-time">${escapeHtml(timeText)}</div>
          <div class="sync-activity-main">
            <div class="sync-activity-message">${escapeHtml(msg?.id || '-') }</div>
            <div class="sync-activity-meta">${tags}</div>
          </div>
          <div class="sync-activity-actions">
            <button class="btn btn-secondary btn-small" data-mpc-message-view="1" data-message-id="${escapeHtml(msg?.id || '')}">${escapeHtml(actionLabel)}</button>
          </div>
        </div>
      `;
    }).join('');
  }

  async openMpcMessageDetail(messageId) {
    const statusEl = document.getElementById('mpcMessageDetailStatus');
    const payloadEl = document.getElementById('mpcMessageDetailPayload');
    this.activeMpcMessageId = messageId || '';
    if (payloadEl) payloadEl.value = '';
    if (!messageId) {
      if (statusEl) statusEl.textContent = '未选择消息';
      return;
    }

    const message = Array.isArray(this.mpcMessages)
      ? this.mpcMessages.find(item => item?.id === messageId)
      : null;
    if (!message) {
      if (statusEl) statusEl.textContent = '未找到消息';
      return;
    }

    if (!message?.envelope) {
      const rawPayload = message?.payload ?? message;
      const text = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload, null, 2);
      if (payloadEl) payloadEl.value = text;
      if (statusEl) statusEl.textContent = '消息无加密载荷';
      return;
    }

    const password = await this.requestPassword?.();
    if (!password) {
      if (statusEl) statusEl.textContent = '已取消解密';
      return;
    }

    try {
      showWaiting();
      const result = await this.wallet.decryptMpcMessage({ messageId, password });
      if (!result?.success) {
        throw new Error(result?.error || '解密失败');
      }
      const payload = result?.payload ?? result?.plaintext ?? '';
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
      if (payloadEl) payloadEl.value = text;
      const verifyText = result?.verified ? '签名已验证' : '签名未验证';
      if (statusEl) statusEl.textContent = `已解密 · ${verifyText}`;
      showSuccess('消息已解密');
    } catch (error) {
      console.error('[SettingsController] 解密 MPC 消息失败:', error);
      if (statusEl) statusEl.textContent = '解密失败';
      showError('解密失败: ' + error.message);
    } finally {
      hideWaiting();
    }
  }

  async loadMpcSessions() {
    try {
      const result = await this.wallet.getMpcSessions();
      if (!result?.success) {
        throw new Error(result?.error || '加载失败');
      }
      this.mpcSessions = Array.isArray(result.sessions) ? result.sessions : [];
      this.renderMpcSessions();
    } catch (error) {
      console.error('[SettingsController] 加载 MPC 会话失败:', error);
      this.mpcSessions = [];
      this.renderMpcSessions();
    }
  }

  renderMpcSessions() {
    const container = document.getElementById('mpcSessionsList');
    if (!container) return;
    const list = Array.isArray(this.mpcSessions) ? this.mpcSessions : [];
    if (!list.length) {
      container.innerHTML = '<div class="empty-message">暂无会话</div>';
      return;
    }
    const sorted = [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    container.innerHTML = sorted.map(session => {
      const sessionId = session?.id || '-';
      const type = session?.type || '-';
      const status = session?.status || '-';
      const participants = Array.isArray(session?.participants) ? session.participants.length : 0;
      const round = Number.isFinite(session?.round) ? session.round : '-';
      return `
        <div class="sync-activity-item">
          <div class="sync-activity-main">
            <div class="sync-activity-message">${escapeHtml(sessionId)}</div>
            <div class="sync-activity-meta">
              <span class="sync-activity-tag">类型 ${escapeHtml(type)}</span>
              <span class="sync-activity-tag">状态 ${escapeHtml(status)}</span>
              <span class="sync-activity-tag">成员 ${participants}</span>
              <span class="sync-activity-tag">轮次 ${escapeHtml(String(round))}</span>
            </div>
          </div>
          <div class="sync-activity-actions">
            <button class="btn btn-secondary btn-small" data-mpc-session-detail="1" data-session-id="${escapeHtml(sessionId)}">详情</button>
            <button class="btn btn-secondary btn-small" data-mpc-session-use="1" data-session-id="${escapeHtml(sessionId)}">使用</button>
          </div>
        </div>
      `;
    }).join('');
  }

  openMpcSessionDetail(sessionId) {
    this.activeMpcSessionId = sessionId || '';
    const modal = document.getElementById('mpcSessionDetailModal');
    if (modal) {
      modal.classList.remove('hidden');
    }
    this.refreshMpcSessionDetail();
  }

  closeMpcSessionDetail() {
    this.activeMpcSessionId = '';
    const modal = document.getElementById('mpcSessionDetailModal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  async refreshMpcSessionDetail() {
    const sessionId = this.activeMpcSessionId;
    if (!sessionId) return;
    try {
      const result = await this.wallet.getMpcSession(sessionId);
      if (!result?.success) {
        throw new Error(result?.error || '加载失败');
      }
      const session = result?.session;
      if (!session) {
        throw new Error('会话不存在');
      }
      this.renderMpcSessionDetail(session);
    } catch (error) {
      console.error('[SettingsController] 加载 MPC 会话详情失败:', error);
      this.renderMpcSessionDetail(null);
      showError('加载失败: ' + error.message);
    }
  }

  renderMpcSessionDetail(session) {
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    if (!session) {
      setText('mpcSessionDetailId', '-');
      setText('mpcSessionDetailType', '-');
      setText('mpcSessionDetailStatus', '-');
      setText('mpcSessionDetailRound', '-');
      setText('mpcSessionDetailThreshold', '-');
      setText('mpcSessionDetailCurve', '-');
      setText('mpcSessionDetailParticipants', '-');
      return;
    }
    const participants = Array.isArray(session.participants) ? session.participants : [];
    const participantText = participants.length
      ? `${participants.length} · ${participants.join(', ')}`
      : '-';
    setText('mpcSessionDetailId', session.id || '-');
    setText('mpcSessionDetailType', session.type || '-');
    setText('mpcSessionDetailStatus', session.status || '-');
    setText('mpcSessionDetailRound', Number.isFinite(session.round) ? String(session.round) : '-');
    setText('mpcSessionDetailThreshold', Number.isFinite(session.threshold) ? String(session.threshold) : '-');
    setText('mpcSessionDetailCurve', session.curve || '-');
    setText('mpcSessionDetailParticipants', participantText);
  }

  fillMpcSessionFields(sessionId) {
    const joinInput = document.getElementById('mpcJoinSessionIdInput');
    const sendInput = document.getElementById('mpcSendSessionIdInput');
    if (joinInput) joinInput.value = sessionId;
    if (sendInput) sendInput.value = sessionId;
  }

  parseMpcParticipants(input) {
    const raw = String(input || '').trim();
    if (!raw) return [];
    return raw.split(',').map(item => item.trim()).filter(Boolean);
  }

  async getDefaultMpcIdentity() {
    try {
      const account = await this.wallet.getCurrentAccount();
      if (!account?.address) return '';
      return `did:pkh:eth:${account.address.toLowerCase()}`;
    } catch {
      return '';
    }
  }

  async renderMpcIdentityDefault() {
    const identityInput = document.getElementById('mpcJoinIdentityInput');
    if (!identityInput || identityInput.value) return;
    const identity = await this.getDefaultMpcIdentity();
    if (identity) {
      identityInput.value = identity;
    }
  }

  async openMpcLogsPage() {
    showPage('mpcLogsPage');
    await this.loadMpcLogs();
    await this.loadMpcAuditExportConfig();
  }

  async loadMpcLogs() {
    try {
      const result = await this.wallet.getMpcAuditLogs();
      const logs = result?.logs || [];
      this.updateMpcLogs(logs);
    } catch (error) {
      console.error('[SettingsController] 加载 MPC 日志失败:', error);
      this.updateMpcLogs([]);
    }
  }

  updateMpcLogs(logs = []) {
    this.mpcLogs = Array.isArray(logs) ? logs : [];
    this.updateMpcLogsSummary();
    this.applyMpcLogsFilter();
  }

  applyMpcLogsFilter(keyword) {
    const inputValue = arguments.length > 0
      ? keyword
      : (document.getElementById('mpcLogsSearchInput')?.value || '');
    const normalized = String(inputValue || '').trim().toLowerCase();
    this.mpcLogQuery = normalized;
    const source = Array.isArray(this.mpcLogs) ? this.mpcLogs : [];
    this.mpcLogFiltered = normalized
      ? source.filter(entry => this.matchMpcLog(entry, normalized))
      : [...source];
    this.mpcLogVisibleCount = Math.min(this.mpcLogPageSize, this.mpcLogFiltered.length);
    this.updateMpcLogsSummary();
    this.renderMpcLogsList(false);

    const container = document.getElementById('mpcLogsList');
    if (container) {
      container.scrollTop = 0;
    }
  }

  matchMpcLog(entry, keyword) {
    if (!keyword) return true;
    const timeText = entry?.time ? formatLocaleDateTime(entry.time) : '';
    const fields = [
      entry?.message,
      entry?.action,
      entry?.level,
      entry?.sessionId,
      entry?.id,
      timeText
    ].filter(Boolean);
    const haystack = fields.join(' ').toLowerCase();
    return haystack.includes(keyword);
  }

  handleMpcLogsScroll() {
    const container = document.getElementById('mpcLogsList');
    if (!container) return;
    if (this.mpcLogVisibleCount >= this.mpcLogFiltered.length) return;
    const threshold = 24;
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - threshold) {
      this.mpcLogVisibleCount = Math.min(
        this.mpcLogFiltered.length,
        this.mpcLogVisibleCount + this.mpcLogPageSize
      );
      this.renderMpcLogsList(true);
    }
  }

  renderMpcLogsList(preserveScroll = false) {
    const container = document.getElementById('mpcLogsList');
    if (!container) return;
    const list = Array.isArray(this.mpcLogFiltered) ? this.mpcLogFiltered : [];
    const total = list.length;
    const baseCount = this.mpcLogVisibleCount || this.mpcLogPageSize;
    const visibleCount = Math.min(baseCount, total);
    this.mpcLogVisibleCount = visibleCount;
    const entries = list.slice(0, visibleCount);
    const scrollTop = preserveScroll ? container.scrollTop : 0;

    if (entries.length === 0) {
      const emptyText = this.mpcLogQuery ? '没有匹配的日志' : '暂无日志';
      container.innerHTML = `<div class="empty-message">${emptyText}</div>`;
      this.updateMpcLogsFooter(total, visibleCount);
      return;
    }

    container.innerHTML = entries.map(entry => {
      const timeText = entry?.time ? formatLocaleDateTime(entry.time) : '-';
      const message = escapeHtml(entry?.message || '-');
      const level = String(entry?.level || 'info').toLowerCase();
      const levelClass = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
      const levelLabel = levelClass === 'error' ? '错误' : levelClass === 'warn' ? '警告' : '信息';
      const actionLabel = entry?.action ? `动作 ${entry.action}` : '';
      const sessionLabel = entry?.sessionId ? `会话 ${entry.sessionId}` : '';

      return `
        <div class="sync-activity-item">
          <div class="sync-activity-time">${escapeHtml(timeText)}</div>
          <div class="sync-activity-main">
            <div class="sync-activity-message">${message}</div>
            <div class="sync-activity-meta">
              <span class="sync-activity-tag level-${levelClass}">${escapeHtml(levelLabel)}</span>
              ${actionLabel ? `<span class="sync-activity-tag">${escapeHtml(actionLabel)}</span>` : ''}
              ${sessionLabel ? `<span class="sync-activity-tag">${escapeHtml(sessionLabel)}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (preserveScroll) {
      container.scrollTop = scrollTop;
    }

    this.updateMpcLogsFooter(total, visibleCount);
  }

  updateMpcLogsFooter(total, visibleCount) {
    const footer = document.getElementById('mpcLogsFooter');
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

  updateMpcLogsSummary() {
    const lastEl = document.getElementById('mpcLogsLastEvent');
    const totalEl = document.getElementById('mpcLogsTotal');
    const matchEl = document.getElementById('mpcLogsMatch');

    if (lastEl) {
      const latest = Array.isArray(this.mpcLogs) && this.mpcLogs.length
        ? this.mpcLogs[this.mpcLogs.length - 1]
        : null;
      lastEl.textContent = latest?.time ? formatLocaleDateTime(latest.time) : '-';
    }
    if (totalEl) {
      totalEl.textContent = String(Array.isArray(this.mpcLogs) ? this.mpcLogs.length : 0);
    }
    if (matchEl) {
      matchEl.textContent = String(Array.isArray(this.mpcLogFiltered) ? this.mpcLogFiltered.length : 0);
    }
  }

  async loadMpcAuditExportConfig() {
    try {
      const result = await this.wallet.getMpcAuditExportConfig();
      const config = result?.config || {};
      this.renderMpcAuditExportConfig(config);
      this.renderMpcAuditExportStatus(config);
    } catch (error) {
      console.error('[SettingsController] 加载 MPC 导出配置失败:', error);
    }
  }

  renderMpcAuditExportConfig(config = {}) {
    const endpointInput = document.getElementById('mpcAuditExportEndpointInput');
    const enabledToggle = document.getElementById('mpcAuditExportEnabledToggle');
    const headersInput = document.getElementById('mpcAuditExportHeadersInput');
    if (endpointInput) {
      endpointInput.value = config.endpoint || '';
    }
    if (enabledToggle) {
      enabledToggle.checked = Boolean(config.enabled);
    }
    if (headersInput) {
      const headers = config.headers && typeof config.headers === 'object' ? config.headers : {};
      headersInput.value = Object.keys(headers).length ? JSON.stringify(headers, null, 2) : '';
    }
  }

  renderMpcAuditExportStatus(config = {}) {
    const statusEl = document.getElementById('mpcAuditExportStatus');
    if (!statusEl) return;
    const lastStatus = config?.lastStatus || null;
    if (!lastStatus || !lastStatus.time) {
      statusEl.textContent = '最近推送: -';
      return;
    }
    const timeText = formatLocaleDateTime(lastStatus.time);
    const sentText = Number.isFinite(lastStatus.sent) ? `${lastStatus.sent} 条` : '';
    if (lastStatus.status === 'success') {
      statusEl.textContent = `最近推送: 成功 · ${sentText || '0 条'} · ${timeText}`;
      return;
    }
    if (lastStatus.status === 'error') {
      const errorText = lastStatus.error ? ` · ${lastStatus.error}` : '';
      statusEl.textContent = `最近推送: 失败 · ${timeText}${errorText}`;
      return;
    }
    statusEl.textContent = `最近推送: ${timeText}`;
  }

  async handleMpcAuditExportSave() {
    const endpointInput = document.getElementById('mpcAuditExportEndpointInput');
    const enabledToggle = document.getElementById('mpcAuditExportEnabledToggle');
    const headersInput = document.getElementById('mpcAuditExportHeadersInput');
    const endpoint = String(endpointInput?.value || '').trim();
    const enabled = Boolean(enabledToggle?.checked);
    let headers = {};
    const rawHeaders = String(headersInput?.value || '').trim();
    if (rawHeaders) {
      try {
        headers = JSON.parse(rawHeaders);
        if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
          throw new Error('invalid headers');
        }
      } catch (error) {
        showError('Headers JSON 无效');
        return;
      }
    }
    if (enabled) {
      if (!endpoint) {
        showError('Webhook 地址不能为空');
        return;
      }
      if (!/^https?:\/\//i.test(endpoint)) {
        showError('Webhook 地址必须是 http(s)');
        return;
      }
    }

    try {
      const result = await this.wallet.updateMpcAuditExportConfig({
        enabled,
        endpoint,
        headers
      });
      if (result?.success === false) {
        throw new Error(result?.error || '保存失败');
      }
      this.renderMpcAuditExportConfig(result?.config || {});
      this.renderMpcAuditExportStatus(result?.config || {});
      showSuccess('导出配置已保存');
    } catch (error) {
      console.error('[SettingsController] 保存 MPC 导出配置失败:', error);
      showError('保存失败: ' + error.message);
    }
  }

  async handleMpcAuditExportFlush() {
    try {
      const result = await this.wallet.flushMpcAuditExportQueue();
      if (result?.success === false) {
        throw new Error(result?.error || '推送失败');
      }
      showSuccess('已推送队列');
      await this.loadMpcAuditExportConfig();
    } catch (error) {
      console.error('[SettingsController] 推送队列失败:', error);
      showError('推送失败: ' + error.message);
      await this.loadMpcAuditExportConfig();
    }
  }

  async handleMpcAuditExportAll() {
    try {
      const result = await this.wallet.exportMpcAuditLogs(true);
      if (result?.success === false) {
        throw new Error(result?.error || '推送失败');
      }
      showSuccess('已推送全部日志');
      await this.loadMpcAuditExportConfig();
    } catch (error) {
      console.error('[SettingsController] 推送全部日志失败:', error);
      showError('推送失败: ' + error.message);
      await this.loadMpcAuditExportConfig();
    }
  }

  async handleMpcAuditExportJson() {
    try {
      const result = await this.wallet.getMpcAuditLogs();
      const logs = result?.logs || [];
      const content = JSON.stringify(logs, null, 2);
      this.downloadTextFile('mpc-audit-logs.json', content, 'application/json');
      showSuccess('已导出 JSON');
    } catch (error) {
      console.error('[SettingsController] 导出 JSON 失败:', error);
      showError('导出失败: ' + error.message);
    }
  }

  async handleMpcAuditExportCsv() {
    try {
      const result = await this.wallet.getMpcAuditLogs();
      const logs = result?.logs || [];
      const csv = this.buildMpcAuditCsv(logs);
      this.downloadTextFile('mpc-audit-logs.csv', csv, 'text/csv');
      showSuccess('已导出 CSV');
    } catch (error) {
      console.error('[SettingsController] 导出 CSV 失败:', error);
      showError('导出失败: ' + error.message);
    }
  }

  buildMpcAuditCsv(logs = []) {
    const header = ['time', 'level', 'action', 'sessionId', 'message', 'id'];
    const rows = [header.join(',')];
    const safe = (value) => {
      const text = String(value ?? '');
      if (text.includes('"') || text.includes(',') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    };
    for (const log of logs) {
      rows.push([
        safe(log?.time ?? ''),
        safe(log?.level ?? ''),
        safe(log?.action ?? ''),
        safe(log?.sessionId ?? ''),
        safe(log?.message ?? ''),
        safe(log?.id ?? '')
      ].join(','));
    }
    return rows.join('\n');
  }

  downloadTextFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async handleMpcClearLogs() {
    try {
      const result = await this.wallet.clearMpcAuditLogs();
      if (result?.success === false) {
        throw new Error(result?.error || '清空失败');
      }
      await this.loadMpcLogs();
      showSuccess('已清空 MPC 日志');
    } catch (error) {
      console.error('[SettingsController] 清空 MPC 日志失败:', error);
      showError('清空失败: ' + error.message);
    }
  }

  deriveUcanAudience(endpoint) {
    return deriveUcanAudience(endpoint);
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
    return normalizeBearerToken(value);
  }

  normalizeUcanResource(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed || this.isLegacyUcanResource(trimmed)) {
      return this.getDefaultUcanResource();
    }
    return trimmed;
  }

  normalizeMpcUcanResource(value) {
    const trimmed = String(value || '').trim();
    return trimmed || DEFAULT_MPC_UCAN_RESOURCE;
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

  normalizeMpcUcanAction(value, resource) {
    const trimmed = String(value || '').trim();
    if (!trimmed || trimmed === '*') {
      return DEFAULT_MPC_UCAN_ACTION;
    }
    if (resource && this.isLegacyUcanResource(resource)) {
      return DEFAULT_MPC_UCAN_ACTION;
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
