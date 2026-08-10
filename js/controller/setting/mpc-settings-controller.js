/**
 * MpcSettingsController — MPC 门限钱包设置子控制器
 * 从 SettingController 拆出：默认协调器 / 设备信息 /
 * 审计日志与导出。Keygen / Join / 消息发送等高级排障方法保留为隐藏能力。
 *
 * 依赖通过构造参数注入：{ wallet, requestPassword }
 */
import { showPage, showSuccess, showError, showWaiting, hideWaiting, copyToClipboard } from '../../common/ui/index.js';
import { formatLocaleDateTime } from '../../common/utils/time-utils.js';
import { escapeHtml } from '../../common/ui/html-ui.js';
import { deriveUcanAudience } from '../../common/ucan-utils.js';
import {
  normalizeUcanToken,
  normalizeMpcUcanResource,
  normalizeMpcUcanAction,
  DEFAULT_MPC_AUTH_SCHEME,
  DEFAULT_MPC_E2E_SUITE,
  DEFAULT_MPC_REFRESH_POLICY,
  DEFAULT_MPC_COORDINATOR_ENDPOINT,
  DEFAULT_CUSTODY_ENDPOINT,
  DEFAULT_CUSTODY_UCAN_RESOURCE,
  DEFAULT_CUSTODY_UCAN_ACTION
} from './settings-utils.js';

export class MpcSettingsController {
  constructor({ wallet, requestPassword }) {
    this.wallet = wallet;
    this.requestPassword = requestPassword;
    this.mpcSettings = null;
    this.custodySettings = null;
    this.mpcLogs = [];
    this.mpcLogQuery = '';
    this.mpcLogFiltered = [];
    this.mpcLogPageSize = 30;
    this.mpcLogVisibleCount = 0;
    this.mpcMessages = [];
    this.mpcMessageCursor = null;
    this.mpcMessagePollTimer = null;
    this.mpcMessagePollSessionId = '';
    this.mpcMessagePollIntervalMs = 5000;
    this.activeMpcMessageId = '';
    this.mpcDeviceInfo = null;
    this.mpcInvites = [];
  }

  bindEvents() {
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

    const mpcServiceConfigBtn = document.getElementById('mpcServiceConfigBtn');
    if (mpcServiceConfigBtn) {
      mpcServiceConfigBtn.addEventListener('click', () => {
        this.openMpcServiceConfigModal();
      });
    }

    const mpcConnectionInfoBtn = document.getElementById('mpcConnectionInfoBtn');
    if (mpcConnectionInfoBtn) {
      mpcConnectionInfoBtn.addEventListener('click', async () => {
        await this.openMpcConnectionInfoModal();
      });
    }
    const mpcInvitesRefreshBtn = document.getElementById('mpcInvitesRefreshBtn');
    if (mpcInvitesRefreshBtn) {
      mpcInvitesRefreshBtn.addEventListener('click', async () => {
        await this.loadMpcInvites(true);
      });
    }
    const mpcInvitesList = document.getElementById('mpcInvitesList');
    if (mpcInvitesList) {
      mpcInvitesList.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-mpc-invite-accept]');
        if (!button) return;
        await this.handleMpcInviteAccept(button.dataset.notificationUid || '');
      });
    }

    const mpcCoordinatorSaveBtn = document.getElementById('mpcCoordinatorSaveBtn');
    if (mpcCoordinatorSaveBtn) {
      mpcCoordinatorSaveBtn.addEventListener('click', async () => {
        await this.handleMpcCoordinatorSave();
      });
    }

    const mpcDeviceRefreshBtn = document.getElementById('mpcDeviceRefreshBtn');
    if (mpcDeviceRefreshBtn) {
      mpcDeviceRefreshBtn.addEventListener('click', async () => {
        await this.loadMpcDeviceInfo(true);
      });
    }

    const mpcConnectionInfoModal = document.getElementById('mpcConnectionInfoModal');
    if (mpcConnectionInfoModal) {
      mpcConnectionInfoModal.addEventListener('click', async (event) => {
        const copyBtn = event.target.closest('[data-mpc-device-copy]');
        if (!copyBtn) return;
        await this.handleMpcDeviceCopy(copyBtn.dataset.mpcDeviceCopy);
      });
    }

    this.bindSimpleModal({
      modalId: 'mpcServiceConfigModal',
      closeIds: ['closeMpcServiceConfigModal', 'cancelMpcServiceConfigBtn'],
      onClose: () => this.closeMpcServiceConfigModal()
    });
    this.bindSimpleModal({
      modalId: 'mpcConnectionInfoModal',
      closeIds: ['closeMpcConnectionInfoModal', 'closeMpcConnectionInfoBtn'],
      onClose: () => this.closeMpcConnectionInfoModal()
    });
    this.bindSimpleModal({
      modalId: 'custodyConfigModal',
      closeIds: ['closeCustodyConfigModal', 'cancelCustodyConfigBtn'],
      onClose: () => this.closeCustodyConfigModal()
    });

    const mpcCoordinatorUcanGenerateBtn = document.getElementById('mpcCoordinatorUcanGenerateBtn');
    if (mpcCoordinatorUcanGenerateBtn) {
      mpcCoordinatorUcanGenerateBtn.addEventListener('click', async () => {
        await this.handleMpcCoordinatorUcanGenerate();
      });
    }

    const custodyEnabledToggle = document.getElementById('custodyEnabledToggle');
    if (custodyEnabledToggle) {
      custodyEnabledToggle.addEventListener('change', async () => {
        await this.handleCustodyToggle(custodyEnabledToggle.checked);
      });
    }

    const custodyConfigBtn = document.getElementById('custodyConfigBtn');
    if (custodyConfigBtn) {
      custodyConfigBtn.addEventListener('click', () => {
        this.openCustodyConfigModal();
      });
    }

    const custodySaveBtn = document.getElementById('custodySaveBtn');
    if (custodySaveBtn) {
      custodySaveBtn.addEventListener('click', async () => {
        await this.handleCustodySave();
      });
    }

    const custodyStatusBtn = document.getElementById('custodyStatusBtn');
    if (custodyStatusBtn) {
      custodyStatusBtn.addEventListener('click', async () => {
        await this.handleCustodyStatusCheck();
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

  openMpcServiceConfigModal() {
    this.renderMpcSettings(this.mpcSettings || {});
    const modal = document.getElementById('mpcServiceConfigModal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  }

  closeMpcServiceConfigModal() {
    const modal = document.getElementById('mpcServiceConfigModal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  async openMpcConnectionInfoModal() {
    const modal = document.getElementById('mpcConnectionInfoModal');
    if (modal) {
      modal.classList.remove('hidden');
    }
    await this.loadMpcDeviceInfo();
  }

  closeMpcConnectionInfoModal() {
    const modal = document.getElementById('mpcConnectionInfoModal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  openCustodyConfigModal() {
    this.renderCustodySettings(this.custodySettings || {});
    const modal = document.getElementById('custodyConfigModal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  }

  closeCustodyConfigModal() {
    const modal = document.getElementById('custodyConfigModal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  async loadSettings() {
    try {
      const settings = await this.wallet.getMpcSettings();
      this.mpcSettings = settings || {};
      this.renderMpcSettings(settings);
      await this.renderMpcIdentityDefault();
      await this.loadMpcInvites(false);
    } catch (error) {
      console.error('[MpcSettings] 获取 MPC 设置失败:', error);
    }
  }

  async loadCustodySettings() {
    try {
      const settings = await this.wallet.getCustodySettings();
      this.custodySettings = settings || {};
      this.renderCustodySettings(this.custodySettings);
    } catch (error) {
      console.error('[MpcSettings] 获取托管设置失败:', error);
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
      ucanResourceInput.value = normalizeMpcUcanResource(settings.ucanResource || '');
    }
    if (ucanActionInput) {
      const resource = normalizeMpcUcanResource(settings.ucanResource || '');
      ucanActionInput.value = normalizeMpcUcanAction(settings.ucanAction || '', resource);
    }
    if (ucanAudienceInput) {
      const endpoint = settings.coordinatorEndpoint || DEFAULT_MPC_COORDINATOR_ENDPOINT;
      ucanAudienceInput.value = settings.ucanAudience || deriveUcanAudience(endpoint);
    }
    if (ucanTokenInput) {
      ucanTokenInput.value = settings.ucanToken || '';
    }
    if (ucanTtlInput && !ucanTtlInput.value) {
      ucanTtlInput.value = '24';
    }
    const summary = document.getElementById('mpcSettingsSummary');
    if (summary) {
      const endpoint = settings.coordinatorEndpoint || DEFAULT_MPC_COORDINATOR_ENDPOINT;
      summary.textContent = `默认协调器：${endpoint}`;
    }
    window.refreshWalletSelects?.();
  }

  async loadMpcDeviceInfo(showToast = false) {
    const statusEl = document.getElementById('mpcDeviceInfoStatus');
    try {
      const result = await this.wallet.getMpcDeviceInfo?.();
      if (!result?.success) {
        throw new Error(result?.error || '加载失败');
      }
      this.mpcDeviceInfo = result.device || null;
      this.renderMpcDeviceInfo(this.mpcDeviceInfo);
      if (showToast) showSuccess('MPC 设备信息已刷新');
    } catch (error) {
      console.error('[MpcSettings] 加载 MPC 设备信息失败:', error);
      this.mpcDeviceInfo = null;
      this.renderMpcDeviceInfo(null);
      if (statusEl) {
        statusEl.textContent = '设备信息不可用，请先解锁钱包或创建/加入 MPC 会话。';
      }
      if (showToast) showError('刷新失败: ' + error.message);
    }
  }

  renderMpcDeviceInfo(device = null) {
    const deviceIdEl = document.getElementById('mpcDeviceIdText');
    const signingKeyEl = document.getElementById('mpcDeviceSigningKeyText');
    const e2eKeyEl = document.getElementById('mpcDeviceE2eKeyText');
    const statusEl = document.getElementById('mpcDeviceInfoStatus');
    const keys = device?.keys || {};

    if (deviceIdEl) deviceIdEl.textContent = device?.deviceId || keys.deviceId || '-';
    if (signingKeyEl) signingKeyEl.textContent = keys.signingPublicKey || '-';
    if (e2eKeyEl) e2eKeyEl.textContent = keys.e2ePublicKey || '-';
    if (statusEl) {
      statusEl.textContent = keys.signingPublicKey && keys.e2ePublicKey
        ? '设备信息已就绪，可复制给其他成员用于排障或身份确认。'
        : '设备密钥尚未初始化，解锁钱包后会自动准备。';
    }
  }

  async handleMpcDeviceCopy(kind) {
    const keys = this.mpcDeviceInfo?.keys || {};
    const value = kind === 'e2e' ? keys.e2ePublicKey : keys.signingPublicKey;
    if (!value) {
      showError('暂无可复制的设备公钥');
      return;
    }
    const success = await copyToClipboard(value);
    if (success) {
      showSuccess(kind === 'e2e' ? 'E2E 公钥已复制' : '签名公钥已复制');
    } else {
      showError('复制失败');
    }
  }

  async handleMpcSettingsUpdate(updates = {}) {
    try {
      const result = await this.wallet.updateMpcSettings(updates);
      if (result?.settings) {
        this.mpcSettings = result.settings;
        this.renderMpcSettings(result.settings);
      }
      showSuccess('MPC 设置已保存');
      return true;
    } catch (error) {
      console.error('[MpcSettings] 更新 MPC 设置失败:', error);
      showError('保存失败: ' + error.message);
      return false;
    }
  }

  renderCustodySettings(settings = {}) {
    const enabledToggle = document.getElementById('custodyEnabledToggle');
    const endpointInput = document.getElementById('custodyEndpointInput');
    const resourceInput = document.getElementById('custodyUcanResourceInput');
    const actionInput = document.getElementById('custodyUcanActionInput');
    const audienceInput = document.getElementById('custodyUcanAudienceInput');
    const statusText = document.getElementById('custodyStatusText');

    const endpoint = settings.endpoint || DEFAULT_CUSTODY_ENDPOINT;
    if (enabledToggle) enabledToggle.checked = Boolean(settings.enabled);
    if (endpointInput) endpointInput.value = endpoint;
    if (resourceInput) resourceInput.value = settings.ucanResource || DEFAULT_CUSTODY_UCAN_RESOURCE;
    if (actionInput) actionInput.value = settings.ucanAction || DEFAULT_CUSTODY_UCAN_ACTION;
    if (audienceInput) audienceInput.value = settings.ucanAudience || deriveUcanAudience(endpoint);

    if (statusText) {
      const status = settings.lastStatus || {};
      const passkey = status.passkeyBound ? '已绑定通行证' : '未绑定通行证';
      const enabled = settings.enabled ? '托管已开启' : '托管未开启';
      const count = Number.isFinite(status.recordCount) ? ` · ${status.recordCount} 份托管记录` : '';
      const last = settings.lastBackupAt ? ` · 最近备份 ${formatLocaleDateTime(settings.lastBackupAt)}` : '';
      statusText.textContent = `${enabled} · ${passkey}${count}${last}`;
    }
  }

  readCustodyForm() {
    const endpoint = String(document.getElementById('custodyEndpointInput')?.value || '').trim();
    if (endpoint) {
      try {
        new URL(endpoint);
      } catch {
        throw new Error('托管服务地址格式不正确');
      }
    }
    const resource = String(document.getElementById('custodyUcanResourceInput')?.value || '').trim() || DEFAULT_CUSTODY_UCAN_RESOURCE;
    const action = String(document.getElementById('custodyUcanActionInput')?.value || '').trim() || DEFAULT_CUSTODY_UCAN_ACTION;
    const audience = String(document.getElementById('custodyUcanAudienceInput')?.value || '').trim() || deriveUcanAudience(endpoint || DEFAULT_CUSTODY_ENDPOINT);
    return {
      endpoint: endpoint || DEFAULT_CUSTODY_ENDPOINT,
      ucanResource: resource,
      ucanAction: action,
      ucanAudience: audience
    };
  }

  async saveCustodyFormSettings() {
    const updates = this.readCustodyForm();
    const result = await this.wallet.updateCustodySettings(updates);
    if (!result?.success) {
      throw new Error(result?.error || '保存失败');
    }
    this.custodySettings = result.settings || {};
    this.renderCustodySettings(this.custodySettings);
    return updates;
  }

  async handleCustodySave() {
    try {
      await this.saveCustodyFormSettings();
      showSuccess('托管配置已保存');
      this.closeCustodyConfigModal();
    } catch (error) {
      console.error('[MpcSettings] 保存托管配置失败:', error);
      showError('保存失败: ' + error.message);
    }
  }

  async handleCustodyStatusCheck() {
    try {
      const form = await this.saveCustodyFormSettings();
      const password = await this.requestPassword?.();
      if (!password) return;
      showWaiting();
      const result = await this.wallet.getCustodyStatus({
        endpoint: form.endpoint,
        password
      });
      if (!result?.success) {
        throw new Error(result?.error || '检查失败');
      }
      if (result.settings) {
        this.custodySettings = result.settings;
        this.renderCustodySettings(result.settings);
      }
      showSuccess(result.status?.passkeyBound ? '通行证已绑定' : '尚未绑定通行证');
    } catch (error) {
      console.error('[MpcSettings] 检查托管状态失败:', error);
      showError('检查失败: ' + error.message);
    } finally {
      hideWaiting();
    }
  }

  async handleCustodyToggle(enabled) {
    const toggle = document.getElementById('custodyEnabledToggle');
    try {
      const form = await this.saveCustodyFormSettings();
      const password = await this.requestPassword?.();
      if (!password) {
        if (toggle) toggle.checked = !enabled;
        return;
      }
      showWaiting();
      const result = enabled
        ? await this.wallet.enableCustody({ ...form, password })
        : await this.wallet.disableCustody({ endpoint: form.endpoint, password });
      if (!result?.success) {
        throw new Error(result?.error || (enabled ? '开启失败' : '关闭失败'));
      }
      if (result.settings) {
        this.custodySettings = result.settings;
        this.renderCustodySettings(result.settings);
      }
      showSuccess(enabled ? '密钥托管已开启' : '密钥托管已关闭');
    } catch (error) {
      console.error('[MpcSettings] 更新托管开关失败:', error);
      if (toggle) toggle.checked = !enabled;
      showError((enabled ? '开启失败: ' : '关闭失败: ') + error.message);
    } finally {
      hideWaiting();
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

    const updates = { coordinatorEndpoint: endpoint || DEFAULT_MPC_COORDINATOR_ENDPOINT };
    if (ucanResourceInput) {
      updates.ucanResource = normalizeMpcUcanResource(ucanResourceInput.value || '');
    }
    if (ucanActionInput) {
      const resource = updates.ucanResource || normalizeMpcUcanResource(this.mpcSettings?.ucanResource || '');
      updates.ucanAction = normalizeMpcUcanAction(ucanActionInput.value || '', resource);
    }
    if (ucanAudienceInput) {
      updates.ucanAudience = String(ucanAudienceInput.value || '').trim() || deriveUcanAudience(updates.coordinatorEndpoint);
    }
    if (ucanTokenInput) {
      updates.ucanToken = normalizeUcanToken(String(ucanTokenInput.value || '').trim());
    }

    const saved = await this.handleMpcSettingsUpdate(updates);
    if (saved) {
      this.closeMpcServiceConfigModal();
    }
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

      const resource = normalizeMpcUcanResource(resourceInput?.value || '');
      const action = normalizeMpcUcanAction(actionInput?.value || '', resource);
      const audience = String(audienceInput?.value || '').trim() || deriveUcanAudience(endpoint);
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
      console.error('[MpcSettings] 生成 MPC UCAN 失败:', error);
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
      await this.loadSessions();
      showSuccess('会话已创建');
    } catch (error) {
      console.error('[MpcSettings] 创建 MPC 会话失败:', error);
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
      await this.loadSessions();
      showSuccess('已加入会话');
    } catch (error) {
      console.error('[MpcSettings] 加入 MPC 会话失败:', error);
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
      console.error('[MpcSettings] 停止 MPC 监听失败:', error);
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
      console.error('[MpcSettings] 发送 MPC 消息失败:', error);
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
      console.error('[MpcSettings] 解密 MPC 消息失败:', error);
      if (statusEl) statusEl.textContent = '解密失败';
      showError('解密失败: ' + error.message);
    } finally {
      hideWaiting();
    }
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

  shortenText(value, head = 8, tail = 6) {
    const text = String(value || '').trim();
    if (text.length <= head + tail + 3) return text;
    return `${text.slice(0, head)}...${text.slice(-tail)}`;
  }

  async loadMpcInvites(showToast = false) {
    const listEl = document.getElementById('mpcInvitesList');
    if (!listEl || typeof this.wallet.listMpcInvites !== 'function') {
      return;
    }
    try {
      const result = await this.wallet.listMpcInvites({ unreadOnly: true, pageSize: 20 });
      if (!result?.success) {
        throw new Error(result?.error || '加载失败');
      }
      this.mpcInvites = Array.isArray(result.items) ? result.items : [];
      this.renderMpcInvites(this.mpcInvites);
      if (showToast) showSuccess('MPC 邀请已刷新');
    } catch (error) {
      console.error('[MpcSettings] 加载 MPC 邀请失败:', error);
      this.mpcInvites = [];
      this.renderMpcInvites([], error.message || '加载失败');
      if (showToast) showError('刷新失败: ' + error.message);
    }
  }

  renderMpcInvites(items = [], errorText = '') {
    const listEl = document.getElementById('mpcInvitesList');
    if (!listEl) return;
    if (errorText) {
      listEl.innerHTML = `<div class="mpc-invite-empty">${escapeHtml(errorText)}</div>`;
      return;
    }
    if (!items.length) {
      listEl.innerHTML = '<div class="mpc-invite-empty">暂无待处理邀请</div>';
      return;
    }
    listEl.innerHTML = items.map((item) => {
      const payload = item?.payload || {};
      const notificationUid = item?.notificationUid || item?.uid || '';
      const sessionId = payload.sessionId || item?.subjectId || '';
      const walletId = payload.walletId || '';
      const threshold = payload.threshold || '-';
      const participants = Array.isArray(payload.participants) ? payload.participants.length : '-';
      const inviter = payload.inviter || item?.actor || '';
      const createdAt = item?.createdAt ? formatLocaleDateTime(item.createdAt) : '';
      return `
        <div class="mpc-invite-item">
          <div class="mpc-invite-title">${escapeHtml(item?.title || 'MPC 钱包创建邀请')}</div>
          <div class="mpc-invite-meta">
            <span>会话：${escapeHtml(this.shortenText(sessionId))}</span>
            <span>钱包：${escapeHtml(this.shortenText(walletId))}</span>
            <span>门限：${escapeHtml(threshold)} / ${escapeHtml(participants)}</span>
            <span>邀请人：${escapeHtml(this.shortenText(inviter))}${createdAt ? ` · ${escapeHtml(createdAt)}` : ''}</span>
          </div>
          <div class="mpc-invite-actions">
            <button
              class="btn btn-primary btn-small"
              data-mpc-invite-accept="1"
              data-notification-uid="${escapeHtml(notificationUid)}"
            >接受</button>
          </div>
        </div>
      `;
    }).join('');
  }

  async handleMpcInviteAccept(notificationUid) {
    const invite = this.mpcInvites.find((item) =>
      String(item?.notificationUid || item?.uid || '') === String(notificationUid || '')
    );
    if (!invite) {
      showError('未找到邀请');
      return;
    }
    const password = await this.requestPassword?.();
    if (!password) {
      return;
    }
    try {
      showWaiting();
      const result = await this.wallet.acceptMpcInvite({
        notificationUid: invite.notificationUid || invite.uid,
        sessionId: invite.payload?.sessionId || invite.subjectId,
        walletId: invite.payload?.walletId,
        payload: invite.payload || {},
        password
      });
      if (!result?.success) {
        throw new Error(result?.error || '接受邀请失败');
      }
      await this.loadMpcInvites(false);
      await this.loadSessions();
      window.refreshWalletSelects?.();
      showSuccess('已接受 MPC 邀请');
    } catch (error) {
      console.error('[MpcSettings] 接受 MPC 邀请失败:', error);
      showError('接受失败: ' + error.message);
    } finally {
      hideWaiting();
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
      console.error('[MpcSettings] 加载 MPC 日志失败:', error);
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
      console.error('[MpcSettings] 加载 MPC 导出配置失败:', error);
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
      console.error('[MpcSettings] 保存 MPC 导出配置失败:', error);
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
      console.error('[MpcSettings] 推送队列失败:', error);
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
      console.error('[MpcSettings] 推送全部日志失败:', error);
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
      console.error('[MpcSettings] 导出 JSON 失败:', error);
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
      console.error('[MpcSettings] 导出 CSV 失败:', error);
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
      console.error('[MpcSettings] 清空 MPC 日志失败:', error);
      showError('清空失败: ' + error.message);
    }
  }
}
