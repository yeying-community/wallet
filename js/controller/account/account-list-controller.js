import { showPage, showError, showSuccess, setPageOrigin, showWaiting, hideWaiting, copyAddressToClipboard, createCopyToastHandler } from '../../common/ui/index.js';
import { shortenAddress, generateAvatar } from '../../common/chain/index.js';
import { escapeHtml } from '../../common/ui/html-ui.js';
import { t } from '../../common/i18n/index.js';
import { clearImportWalletForm } from '../wallet/import-wallet-controller.js';

import {
  IDENTITY_NODE_ENDPOINT_STORAGE_KEY,
  normalizeIdentityNodeEndpoint
} from '../../config/identity-config.js';

// 早先创建的钱包默认名是英文(存在存储里);显示时换成中文类型名,英文界面再由翻译词典译回
/** 账户/钱包操作菜单的容器(挂在 document.body 上,固定定位)。 */
function ensureAccountMenu() {
  let menu = document.getElementById('accountActionMenu');
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'accountActionMenu';
  menu.className = 'network-menu account-menu-popup hidden';
  menu.setAttribute('role', 'menu');
  document.body.appendChild(menu);
  return menu;
}

const DEFAULT_WALLET_NAMES = { 'HD Wallet': 'HD 钱包', 'Imported Wallet': '导入的钱包', 'MPC Wallet': 'MPC 钱包' };

function formatMpcSigningPrepareError(message) {
  const raw = String(message || '').trim();
  if (!raw) return '签名准备失败';
  if (raw.includes('MPC_COMPLETE_KEY_SHARE_NOT_FOUND')) {
    return 'MPC 签名准备尚未完成，请保持双方钱包插件打开并解锁';
  }
  if (raw.includes('MPC_KEYGEN_NOT_COMPLETED')) {
    return 'MPC 钱包密钥生成尚未完成';
  }
  return raw;
}

export class AccountListController {
  constructor({
    wallet,
    onWalletUpdated,
    onOpenAccountDetails,
    onOpenDeleteAccount,
    onOpenCreateAccount,
    onViewMnemonic,
    onViewPrivateKey,
    onExportAccountKeyfile,
    onExportWallet,
    promptPassword
  }) {
    this.wallet = wallet;
    this.onWalletUpdated = onWalletUpdated;
    this.onOpenAccountDetails = onOpenAccountDetails;
    this.onOpenDeleteAccount = onOpenDeleteAccount;
    this.onOpenCreateAccount = onOpenCreateAccount;
    this.onViewMnemonic = onViewMnemonic;
    this.onViewPrivateKey = onViewPrivateKey;
    this.onExportAccountKeyfile = onExportAccountKeyfile;
    this.onExportWallet = onExportWallet;
    this.promptPassword = promptPassword;
    this.mpcWalletsById = new Map();
    this.walletsById = new Map();
    this.accountsById = new Map();
    this.openMenuTrigger = null;
    this.activeMpcWalletId = '';
    this.activeMpcInviteId = '';
    this.pendingMpcInvites = [];
  }

  bindEvents() {
    // 账户/钱包的「⋯」菜单:菜单本体在 document.body 上(固定定位),
    // 用**委托**绑定——账户列表每次渲染都会整个换掉 innerHTML,逐个元素绑定会丢。
    document.addEventListener('click', (event) => {
      const menu = document.getElementById('accountActionMenu');
      if (!menu || menu.classList.contains('hidden')) return;
      const option = event.target.closest('.network-option');
      if (option && menu.contains(option)) {
        this.handleAccountMenuAction(option.dataset.action, option.dataset.id);
        this.closeAccountMenu();
        return;
      }
      if (event.target.closest('.account-menu-btn')) return;
      this.closeAccountMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const menu = document.getElementById('accountActionMenu');
      if (menu && !menu.classList.contains('hidden')) this.closeAccountMenu();
    });

    const menuBtn = document.getElementById('accountsMenuBtn');
    const menu = document.getElementById('accountsMenu');
    if (menuBtn && menu) {
      menuBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const opening = menu.classList.contains('hidden');
        menu.classList.toggle('hidden', !opening);
        menuBtn.setAttribute('aria-expanded', String(opening));
      });
      menu.addEventListener('click', () => {
        menu.classList.add('hidden');
        menuBtn.setAttribute('aria-expanded', 'false');
      });
      document.addEventListener('click', (event) => {
        if (menu.classList.contains('hidden')) return;
        if (event.target.closest('.accounts-menu')) return;
        menu.classList.add('hidden');
        menuBtn.setAttribute('aria-expanded', 'false');
      });
    }
    document.getElementById('accountsExportBtn')?.addEventListener('click', () => this.handleExportAccounts());
    const createBtn = document.getElementById('accountsCreateWalletBtn');
    if (createBtn) {
      createBtn.addEventListener('click', () => {
        setPageOrigin('setPasswordPage', 'accounts');
        showPage('setPasswordPage');
        const setPasswordBtn = document.getElementById('setPasswordBtn');
        if (setPasswordBtn) {
          setPasswordBtn.textContent = '创建钱包';
        }
        this.preparePasswordFormForExistingWallet();
      });
    }

    const importBtn = document.getElementById('accountsImportWalletBtn');
    if (importBtn) {
      importBtn.addEventListener('click', () => {
        setPageOrigin('importPage', 'accounts');
        showPage('importPage');
        this.prepareImportFormForExistingWallet();
      });
    }

    document.getElementById('refreshMpcWalletDetailBtn')?.addEventListener('click', () => {
      void this.refreshMpcWalletDetail({ localOnly: false });
    });
    document.getElementById('mpcWalletDetailCopyAddressBtn')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.handleMpcWalletAddressCopy();
    });
    document.getElementById('cancelMpcWalletCreationBtn')?.addEventListener('click', () => {
      void this.handleCancelMpcWalletCreation();
    });
    document.getElementById('prepareMpcWalletSigningBtn')?.addEventListener('click', () => {
      void this.handlePrepareMpcWalletSigning();
    });
  }

  /**
   * 导出账户备份文件。
   * @param {string} [walletId] - 给了就只导这一个钱包(「⋯」菜单里单个钱包的「加密导出」);
   *                             不给就导全部(页面头部「导出钱包」)。
   */
  async handleExportAccounts(walletId = '') {
    if (!this.promptPassword) return;
    const onlyWallet = String(walletId || '').trim();
    const walletName = onlyWallet
      ? (this.walletsById.get(onlyWallet)?.name || t('wallet.exportOneWalletFallbackName'))
      : '';
    const password = await this.promptPassword({
      title: onlyWallet ? t('wallet.exportOneWalletTitle', { name: walletName }) : '导出所有账户',
      confirmText: '加密导出',
      placeholder: '输入当前钱包密码',
      onConfirm: async (value) => {
        if (!value || value.length < 8) throw new Error('密码至少需要8位字符');
      }
    });
    if (!password) return;
    try {
      showWaiting();
      let storedIdentityEndpoint = '';
      try { storedIdentityEndpoint = globalThis.localStorage?.getItem(IDENTITY_NODE_ENDPOINT_STORAGE_KEY) || ''; } catch { /* storage may be unavailable */ }
      const identityEndpoint = normalizeIdentityNodeEndpoint(
        document.getElementById('walletIdentityEndpointInput')?.value
          || storedIdentityEndpoint
      );
      let result;
      try {
        result = await this.wallet.exportAccountsFile(password, identityEndpoint, { walletId: onlyWallet });
      } catch (error) {
        if (!error?.requirePassword) throw error;
        hideWaiting();
        const legacyPassword = await this.promptPassword({
          title: '恢复 Wallet Identity',
          confirmText: '修复并导出',
          placeholder: '输入修改前的钱包密码',
          onConfirm: async (value) => {
            if (!value || value.length < 8) throw new Error('旧钱包密码至少需要8位字符');
            result = await this.wallet.exportAccountsFile(password, identityEndpoint, { walletId: onlyWallet, identityPassword: value });
          }
        });
        if (!legacyPassword || !result) return;
      }
      const blob = new Blob([JSON.stringify(result.file, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `yeying-accounts-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showSuccess(result.repairedIdentities > 0
        ? `已修复 ${result.repairedIdentities} 个 Wallet Identity，并加密导出 ${result.accountCount} 个账户`
        : `已加密导出 ${result.accountCount} 个账户`);
    } catch (error) {
      showError('导出失败: ' + (error?.message || '未知错误'));
    } finally {
      hideWaiting();
    }
  }

  preparePasswordFormForExistingWallet() {
    const hint = document.getElementById('setPasswordHint');
    const walletTypeGroup = document.getElementById('createWalletTypeGroup');
    const walletTypeSelect = document.getElementById('createWalletTypeSelect');
    const mpcFields = document.getElementById('mpcCreateWalletFields');
    const mpcResult = document.getElementById('mpcCreateWalletResult');
    const setPasswordBtn = document.getElementById('setPasswordBtn');

    if (hint) {
      hint.textContent = '请填写钱包名称';
    }
    if (walletTypeGroup) {
      walletTypeGroup.classList.remove('hidden');
    }
    if (walletTypeSelect) {
      walletTypeSelect.value = 'hd';
      walletTypeSelect.dispatchEvent(new Event('change'));
    }
    if (mpcFields) {
      mpcFields.classList.add('hidden');
    }
    if (mpcResult) {
      mpcResult.textContent = '-';
      mpcResult.classList.add('hidden');
    }
    if (setPasswordBtn) {
      setPasswordBtn.textContent = '创建钱包';
    }
  }

  prepareImportFormForExistingWallet() {
    const passwordLabel = document.getElementById('importPasswordLabel');
    const passwordInput = document.getElementById('importWalletPassword');

    if (passwordLabel) {
      passwordLabel.textContent = '当前密码';
    }
    if (passwordInput) {
      passwordInput.placeholder = '输入当前密码';
    }
    clearImportWalletForm();
  }

  async loadWalletList() {
    try {
      const [wallets] = await Promise.all([
        this.wallet.getWalletList(),
        this.loadPendingMpcInvites()
      ]);

      this.renderWalletList(
        wallets,
        (id) => this.onOpenAccountDetails?.(id),
        (id) => this.onOpenDeleteAccount?.(id),
        (walletId) => this.onOpenCreateAccount?.(walletId),
        (walletId) => this.onViewMnemonic?.(walletId),
        (accountId) => this.onViewPrivateKey?.(accountId),
        this.pendingMpcInvites,
        (accountId) => this.onExportAccountKeyfile?.(accountId),
        (walletId) => this.onExportWallet?.(walletId)
      );
    } catch (error) {
      console.error('[AccountListController] 加载钱包列表失败:', error);
      this.renderWalletList([]);
    }
  }

  async loadPendingMpcInvites() {
    if (typeof this.wallet.listMpcInvites !== 'function') {
      this.pendingMpcInvites = [];
      return [];
    }
    try {
      const result = await this.wallet.listMpcInvites({ unreadOnly: true, pageSize: 20 });
      if (!result?.success) throw new Error(result?.error || '加载 MPC 邀请失败');
      this.pendingMpcInvites = Array.isArray(result.items) ? result.items : [];
    } catch (error) {
      console.error('[AccountListController] 加载 MPC 邀请失败:', error);
      this.pendingMpcInvites = [];
    }
    return this.pendingMpcInvites;
  }

  async handleSelectAccount(accountId) {
    try {
      showWaiting();
      await this.wallet.switchAccount(accountId);

      showPage('walletPage');
      await this.refreshWalletData();
      hideWaiting();
    } catch (error) {
      if (error?.requirePassword && this.promptPassword) {
        hideWaiting();
        const password = await this.promptPassword({
          title: '切换账户',
          confirmText: '确认切换',
          placeholder: '输入密码',
          onConfirm: async (password) => {
            if (!password || password.length < 8) {
              throw new Error('密码至少需要8位字符');
            }
          }
        });
        if (!password) {
          return;
        }
        showWaiting();
        try {
          await this.wallet.switchAccount(accountId, password);
          showPage('walletPage');
          await this.refreshWalletData();
        } catch (err) {
          if (err?.requirePassword || /password/i.test(err?.message || '')) {
            showError('密码错误');
          } else {
            showError('切换失败: ' + (err?.message || '切换失败'));
          }
        } finally {
          hideWaiting();
        }
        return;
      }

      console.error('[AccountListController] 切换账户失败:', error);
      const message = error?.requirePassword
        ? '请输入密码以继续切换账户'
        : error?.message || '切换失败';
      showError('切换失败: ' + message);
    }
  }

  async refreshWalletData() {
    if (this.onWalletUpdated) {
      await this.onWalletUpdated();
    }
  }

  renderWalletList(wallets, onAccountDetails, onAccountDelete, onAddAccount, onViewMnemonic, onViewPrivateKey, pendingMpcInvites = this.pendingMpcInvites, onExportAccountKeyfile = this.onExportAccountKeyfile, onExportWallet = this.onExportWallet) {
    const container = document.getElementById('walletList');
    if (!container) return;

    const normalizedWallets = Array.isArray(wallets) ? wallets : [];
    const invites = Array.isArray(pendingMpcInvites) ? pendingMpcInvites : [];
    this.pendingMpcInvites = invites;
    this.mpcWalletsById = new Map(
      normalizedWallets.filter(wallet => wallet?.type === 'mpc' && wallet?.id).map(wallet => [wallet.id, wallet])
    );
    // 「⋯」菜单要按账户/钱包的类型决定给哪些项,所以渲染时把索引留着
    this.walletsById = new Map(normalizedWallets.filter(w => w?.id).map(w => [w.id, w]));
    this.accountsById = new Map();
    for (const w of normalizedWallets) {
      for (const a of (Array.isArray(w?.accounts) ? w.accounts : [])) {
        if (a?.id) this.accountsById.set(a.id, a);
      }
    }

    if (normalizedWallets.length === 0 && invites.length === 0) {
      container.innerHTML = `
      <div class="empty-wallet-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 7h-3a2 2 0 0 1-2-2V2"></path>
          <path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z"></path>
        </svg>
        <p>暂无钱包</p>
        <p style="font-size: 12px; margin-top: 8px;">点击下方按钮创建或导入钱包</p>
      </div>
    `;
      return;
    }

    const inviteCards = invites.map(invite => this.renderPendingMpcInviteCard(invite)).join('');
    const walletCards = normalizedWallets.map(wallet => {
      const type = wallet.type || 'hd';
      const isHd = type === 'hd';
      const isImported = type === 'imported';
      const isMpc = type === 'mpc';
      const walletLabel = isMpc ? 'MPC 钱包' : (isHd ? 'HD 钱包' : '导入的钱包');
      // 早先创建的钱包默认名是英文(存储里的数据,不改),显示时换成按界面语言翻译的类型名
      const storedName = String(wallet.name || '').trim();
      const walletName = DEFAULT_WALLET_NAMES[storedName] || storedName || walletLabel;
      const walletIcon = isMpc ? '🧩' : (isHd ? '🔑' : '📥');
      const accounts = Array.isArray(wallet.accounts) ? wallet.accounts : [];
      const mpcThreshold = Number(wallet.threshold || 0);
      const mpcParticipantCount = Array.isArray(wallet.participants) ? wallet.participants.length : 0;
      const mpcAddress = String(wallet.address || accounts[0]?.address || '').trim();
      const mpcStatus = this.getMpcWalletStatusText(wallet);
      const primaryAccountId = String(accounts[0]?.id || '').trim();
      const accountHtml = isMpc ? `
          <div
            class="account-item mpc-wallet-identity ${accounts[0]?.isSelected ? 'active' : ''}"
            data-wallet-id="${escapeHtml(wallet.id)}"
            ${primaryAccountId ? `data-account-id="${escapeHtml(primaryAccountId)}"` : ''}
          >
            <div class="account-avatar mpc-wallet-avatar" ${mpcAddress ? `data-address="${escapeHtml(mpcAddress)}"` : ''}>MPC</div>
            <div class="account-details">
              <div class="account-name">${escapeHtml(walletName)}</div>
              <div class="account-address">${mpcAddress ? escapeHtml(shortenAddress(mpcAddress)) : escapeHtml(mpcStatus)}</div>
            </div>
            <div class="account-actions">
              <button
                class="account-action-btn danger mpc-wallet-delete-btn"
                data-wallet-id="${escapeHtml(wallet.id)}"
                title="删除"
                aria-label="删除 MPC 钱包"
              >
                🗑️
              </button>
            </div>
          </div>
        ` : accounts.length ? accounts.map(account => `
          <div class="account-item ${account.isSelected ? 'active' : ''}"
               data-account-id="${account.id}">
            <div class="account-avatar" data-address="${account.address}"></div>
            <div class="account-details">
              <div class="account-name">
                ${account.name}
                ${account.isSelected ? '<span class="account-badge">当前</span>' : ''}
              </div>
              <div class="account-address">${shortenAddress(account.address)}</div>
            </div>
            <div class="account-actions">
              <button class="account-action-btn account-menu-btn"
                      data-account-id="${account.id}"
                      data-menu-kind="account"
                      title="${escapeHtml(t('account.menu'))}"
                      aria-label="${escapeHtml(t('account.menu'))}"
                      aria-haspopup="menu" aria-expanded="false">
                ⋯
              </button>
            </div>
          </div>
        `).join('') : '<div class="empty-message">暂无账户</div>';

      return `
    <div class="wallet-card" data-wallet-id="${escapeHtml(wallet.id)}" ${primaryAccountId ? `data-primary-account-id="${escapeHtml(primaryAccountId)}"` : ''}>
      <div class="wallet-header" ${primaryAccountId ? `data-primary-account-id="${escapeHtml(primaryAccountId)}"` : ''}>
        <div class="wallet-icon ${isImported ? 'imported' : ''}">
          ${walletIcon}
        </div>
        <div class="wallet-info">
          <div class="wallet-name">
            ${isMpc ? 'MPC 钱包' : escapeHtml(walletName)}
          </div>
          ${isMpc ? `<div class="wallet-meta">门限 ${mpcThreshold || '-'} / ${mpcParticipantCount || '-'} · ${escapeHtml(mpcStatus)}</div>` : ''}
        </div>
        ${isHd ? `
          <div class="wallet-header-actions">
            <button
              class="wallet-header-btn view-mnemonic-btn"
              data-wallet-id="${wallet.id}"
              title="查看助记词"
              aria-label="查看助记词"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="8" y1="13" x2="16" y2="13"></line>
                <line x1="8" y1="17" x2="14" y2="17"></line>
              </svg>
            </button>
          </div>
        ` : ''}
        ${isMpc ? '' : `
          <div class="wallet-header-actions">
            <button
              class="wallet-header-btn account-menu-btn"
              data-wallet-id="${escapeHtml(wallet.id)}"
              data-menu-kind="wallet"
              title="${escapeHtml(t('account.menu'))}"
              aria-label="${escapeHtml(t('account.menu'))}"
              aria-haspopup="menu" aria-expanded="false"
            >⋯</button>
          </div>
        `}
        ${isMpc ? `
          <div class="wallet-header-actions">
            <button
              class="wallet-header-btn mpc-wallet-detail-btn"
              data-wallet-id="${escapeHtml(wallet.id)}"
              title="查看 MPC 钱包详情"
              aria-label="查看 MPC 钱包详情"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 16v-4"></path>
                <path d="M12 8h.01"></path>
              </svg>
            </button>
          </div>
        ` : ''}
      </div>
      <div class="account-list">
        ${accountHtml}
        ${isHd ? `
          <div class="add-account-item" data-wallet-id="${wallet.id}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="16"></line>
              <line x1="8" y1="12" x2="16" y2="12"></line>
            </svg>
            添加账户
          </div>
        ` : ''}
        ${isMpc ? `
          <div class="mpc-wallet-actions">
            <button class="mpc-wallet-action-btn mpc-participant-change-btn" data-action="add">增加参与方</button>
            <button class="mpc-wallet-action-btn mpc-participant-change-btn" data-action="remove">移除参与方</button>
          </div>
        ` : ''}
      </div>
    </div>
  `;
    }).join('');
    container.innerHTML = `${inviteCards}${walletCards}`;

    this.renderAccountAvatars(container);
    this.bindWalletListEvents(onAccountDetails, onAccountDelete, onAddAccount, onViewMnemonic, onViewPrivateKey);
  }

  renderPendingMpcInviteCard(invite) {
    const payload = invite?.payload || {};
    const notificationUid = invite?.notificationUid || invite?.uid || '';
    const walletName = this.getMpcInviteWalletName(invite);
    const walletId = payload.walletId || '';
    const sessionId = payload.sessionId || invite?.subjectId || '';
    const threshold = payload.threshold || '-';
    const participantCount = Array.isArray(payload.participants) ? payload.participants.length : '-';
    const inviter = payload.inviter || invite?.actor || '';
    return `
    <div class="wallet-card mpc-invite-wallet-card" data-mpc-invite-card="${escapeHtml(notificationUid)}">
      <div class="wallet-header">
        <div class="wallet-icon">🧩</div>
        <div class="wallet-info">
          <div class="wallet-name">MPC 钱包</div>
          <div class="wallet-meta">门限 ${escapeHtml(threshold)} / ${escapeHtml(participantCount)} · 待接受邀请</div>
        </div>
        <div class="wallet-header-actions">
          <button
            class="wallet-header-btn mpc-invite-detail-btn"
            data-notification-uid="${escapeHtml(notificationUid)}"
            title="查看 MPC 钱包详情"
            aria-label="查看 MPC 钱包详情"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 16v-4"></path>
              <path d="M12 8h.01"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="account-list">
        <div class="account-item mpc-wallet-identity mpc-invite-wallet-identity">
          <div class="account-avatar mpc-wallet-avatar">MPC</div>
          <div class="account-details">
            <div class="account-name">${escapeHtml(walletName)}</div>
            <div class="account-address">待接受邀请${inviter ? ` · 邀请人 ${escapeHtml(this.shortenText(inviter))}` : ''}</div>
            <div class="account-address">会话 ${escapeHtml(this.shortenText(sessionId))}${walletId ? ` · 钱包 ${escapeHtml(this.shortenText(walletId))}` : ''}</div>
          </div>
        </div>
        <div class="mpc-wallet-actions">
          <button
            class="mpc-wallet-action-btn mpc-invite-dismiss-btn"
            data-mpc-invite-dismiss="${escapeHtml(notificationUid)}"
            type="button"
          >拒绝邀请</button>
          <button
            class="mpc-wallet-action-btn mpc-invite-accept-btn primary"
            data-mpc-invite-accept="${escapeHtml(notificationUid)}"
            type="button"
          >接受邀请</button>
        </div>
      </div>
    </div>
  `;
  }

  getMpcInviteWalletName(invite) {
    const payload = invite?.payload || {};
    const invalidNames = new Set(['MPC 钱包创建邀请', 'MPC 钱包邀请']);
    const name = String(payload.name || invite?.session?.name || '').trim();
    return name && !invalidNames.has(name) ? name : '名称缺失';
  }

  getMpcWalletStatusText(wallet) {
    const status = String(wallet?.status || '').trim();
    const statusLabels = {
      keygen_pending: '等待密钥生成',
      keygen_ready: '等待密钥生成',
      keygen_running: '密钥生成中',
      keygen_interrupted: '创建中断',
      keygen_completed: '签名准备中',
      active: '已完成',
      failed: '密钥生成失败',
    };
    if (wallet?.address && String(wallet?.signingStatus || '').trim() === 'available') return '已完成';
    if (wallet?.address) return statusLabels[status] || '签名准备中';
    return statusLabels[status] || '地址生成中';
  }

  getMpcWalletSigningStatusText(wallet) {
    const signingStatus = String(wallet?.signingStatus || '').trim();
    if (signingStatus === 'available') {
      return '可签名';
    }
    const reason = String(wallet?.signingUnavailableReason || '').trim();
    const reasonLabels = {
      MPC_KEYGEN_NOT_COMPLETED: '未就绪',
      MPC_KEY_SHARE_NOT_FOUND: '不可用',
      MPC_COMPLETE_KEY_SHARE_NOT_FOUND: '准备中',
      MPC_CGGMP24_COMPLETE_KEY_SHARE_NOT_FOUND: '准备中',
      MPC_CGGMP24_AUX_INFO_BROWSER_BLOCKING: '准备失败',
      MPC_WALLET_NOT_SIGNABLE: '不可用',
      MPC_SIGNING_READINESS_CHECK_FAILED: '检查失败'
    };
    if (reasonLabels[reason]) {
      return reasonLabels[reason];
    }
    if (wallet?.address) {
      return '签名能力准备中';
    }
    return '不可签名';
  }

  openMpcInviteDetail(notificationUid) {
    const invite = this.pendingMpcInvites.find((item) =>
      String(item?.notificationUid || item?.uid || '') === String(notificationUid || '')
    );
    if (!invite) return;
    const payload = invite.payload || {};
    const participants = Array.isArray(payload.participants) ? payload.participants : [];
    const wallet = {
      id: payload.walletId || invite.subjectId || notificationUid,
      name: this.getMpcInviteWalletName(invite),
      type: 'mpc',
      status: 'pending_invite',
      address: payload.address || '',
      threshold: payload.threshold || '',
      participants,
    };
    const sessionId = payload.sessionId || invite.subjectId || '';
    const sessions = sessionId ? [{
      id: sessionId,
      type: 'keygen',
      status: invite.session?.status || 'pending_invite',
      round: Number.isFinite(invite.session?.round) ? invite.session.round : 0,
      createdAt: invite.createdAt || invite.session?.createdAt || ''
    }] : [];
    this.activeMpcWalletId = '';
    this.activeMpcInviteId = notificationUid;
    this.renderMpcWalletDetail(wallet, sessions);
    showPage('mpcWalletDetailPage');
  }

  shortenText(value, head = 8, tail = 6) {
    const text = String(value || '').trim();
    if (text.length <= head + tail + 3) return text;
    return `${text.slice(0, head)}...${text.slice(-tail)}`;
  }

  async openMpcWalletDetail(walletId) {
    const wallet = this.mpcWalletsById.get(walletId);
    if (!wallet) return;
    this.activeMpcWalletId = walletId;
    this.renderMpcWalletDetail(wallet, []);
    showPage('mpcWalletDetailPage');
    await this.refreshMpcWalletDetail({ localOnly: true, silent: true });
  }

  closeMpcWalletDetail() {
    this.activeMpcWalletId = '';
    this.activeMpcInviteId = '';
    showPage('accountsPage');
  }

  isMpcWalletCreated(wallet) {
    return String(wallet?.status || '').trim() === 'active' || Boolean(String(wallet?.address || '').trim());
  }

  async refreshMpcWalletDetail(options = {}) {
    const walletId = this.activeMpcWalletId;
    const wallet = this.mpcWalletsById.get(walletId);
    if (!wallet) return;
    const container = document.getElementById('mpcWalletDetailSessions');
    if (container && !container.innerHTML.trim()) {
      container.innerHTML = '<div class="empty-message">暂无会话</div>';
    }
    const localOnly = options?.localOnly !== false;
    let timeoutId = null;
    try {
      const request = this.wallet.getMpcSessions(walletId, { localOnly });
      const result = localOnly
        ? await request
        : await Promise.race([
          request,
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('加载超时')), 8000);
          })
        ]);
      if (!result?.success) throw new Error(result?.error || '加载失败');
      const freshWallet = result.wallet && typeof result.wallet === 'object' ? result.wallet : wallet;
      if (freshWallet?.id) {
        this.mpcWalletsById.set(freshWallet.id, freshWallet);
      }
      this.renderMpcWalletDetail(freshWallet, Array.isArray(result.sessions) ? result.sessions : []);
    } catch (error) {
      if (container && !options?.preserveOnError) {
        container.innerHTML = '<div class="empty-message">会话加载失败</div>';
      }
      if (!options?.silent) {
        showError('MPC 会话加载失败: ' + (error?.message || '未知错误'));
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  renderMpcWalletDetail(wallet, sessions = []) {
    const setText = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    };
    const participants = Array.isArray(wallet?.participants) ? wallet.participants : [];
    const statusLabels = {
      pending_invite: '待接受邀请',
      keygen_pending: '等待参与者完成密钥生成',
      keygen_ready: '等待密钥生成',
      keygen_running: '密钥生成中',
      keygen_interrupted: '创建中断，可移除后重新创建',
      keygen_completed: '签名准备中',
      active: '已完成',
      failed: '密钥生成失败',
    };
    setText('mpcWalletDetailName', wallet?.name || 'MPC 钱包');
    const detailStatus = wallet?.address && String(wallet?.signingStatus || '').trim() === 'available'
      ? '已完成'
      : (statusLabels[wallet?.status] || wallet?.status || '等待参与者完成密钥生成');
    setText('mpcWalletDetailStatus', detailStatus);
    setText('mpcWalletDetailSigningStatus', this.getMpcWalletSigningStatusText(wallet));
    const walletAddress = String(wallet?.address || '').trim();
    setText('mpcWalletDetailAddress', walletAddress ? shortenAddress(walletAddress) : '尚未生成');
    const copyAddressBtn = document.getElementById('mpcWalletDetailCopyAddressBtn');
    if (copyAddressBtn) {
      copyAddressBtn.dataset.address = walletAddress;
      copyAddressBtn.classList.toggle('hidden', !walletAddress);
    }
    setText('mpcWalletDetailThreshold', `${wallet?.threshold || '-'} / ${participants.length || '-'}`);
    const participantsElement = document.getElementById('mpcWalletDetailParticipants');
    if (participantsElement) {
      participantsElement.innerHTML = participants.length
        ? `<div class="mpc-participants-list">${participants.map((participant, index) => `
          <div class="mpc-participant-item">
            <span class="mpc-participant-index">${index + 1}</span>
            <span class="mpc-participant-address">${escapeHtml(participant)}</span>
          </div>
        `).join('')}</div>`
        : '-';
    }
    const cancelBtn = document.getElementById('cancelMpcWalletCreationBtn');
    if (cancelBtn) {
      const canCancel = !this.isMpcWalletCreated(wallet);
      cancelBtn.classList.toggle('hidden', !canCancel);
    }
    const prepareSigningBtn = document.getElementById('prepareMpcWalletSigningBtn');
    if (prepareSigningBtn) {
      const canPrepareSigning = Boolean(walletAddress)
        && String(wallet?.signingStatus || '').trim() !== 'available';
      prepareSigningBtn.classList.toggle('hidden', !canPrepareSigning);
    }

    const container = document.getElementById('mpcWalletDetailSessions');
    if (!container) return;
    if (!sessions.length) {
      container.innerHTML = '<div class="empty-message">暂无会话</div>';
      return;
    }
    const typeLabels = { keygen: '密钥生成', sign: '签名', refresh: '密钥刷新' };
    container.innerHTML = [...sessions]
      .sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0))
      .map(session => `
        <div class="sync-activity-item">
          <div class="sync-activity-main">
            <div class="sync-activity-message mono">${escapeHtml(session?.id || '-')}</div>
            <div class="sync-activity-meta">
              <span class="sync-activity-tag">${escapeHtml(typeLabels[session?.type] || session?.type || '-')}</span>
              <span class="sync-activity-tag">${escapeHtml(session?.status || '-')}</span>
              <span class="sync-activity-tag">轮次 ${Number.isFinite(session?.round) ? session.round : '-'}</span>
            </div>
          </div>
        </div>
      `).join('');
  }

  async handleMpcWalletAddressCopy() {
    const wallet = this.mpcWalletsById.get(this.activeMpcWalletId);
    const address = String(wallet?.address || document.getElementById('mpcWalletDetailCopyAddressBtn')?.dataset?.address || '').trim();
    if (!address) {
      showError('暂无可复制地址');
      return;
    }
    await copyAddressToClipboard(address, createCopyToastHandler({
      onSuccess: showSuccess,
      onError: showError
    }));
  }

  async handleCancelMpcWalletCreation() {
    if (this.activeMpcInviteId) {
      await this.handleMpcInviteDismiss(this.activeMpcInviteId);
      return;
    }
    const walletId = this.activeMpcWalletId;
    const wallet = this.mpcWalletsById.get(walletId);
    if (!wallet) return;
    if (this.isMpcWalletCreated(wallet)) {
      showError('已创建成功的 MPC 钱包不能通过该入口移除');
      return;
    }
    const sessionId = String(wallet.keygenSessionId || '').trim();
    if (!sessionId) {
      showError('未找到 MPC 创建会话');
      return;
    }
    try {
      const password = await this.promptPassword?.({
        title: '取消 MPC 创建',
        confirmText: '确认取消',
        placeholder: '输入密码',
        onConfirm: async (input) => {
          if (!input || input.length < 8) {
            throw new Error('密码至少需要8位字符');
          }
        }
      });
      if (!password) return;
      showWaiting();
      const result = await this.wallet.cancelMpcSession({
        walletId,
        sessionId,
        password,
      });
      if (!result?.success) {
        throw new Error(result?.error || '取消 MPC 创建失败');
      }
      this.closeMpcWalletDetail();
      await this.loadWalletList();
      await this.onWalletUpdated?.();
      showSuccess('MPC 钱包创建已取消');
    } catch (error) {
      showError(error?.message || '取消 MPC 创建失败');
    } finally {
      hideWaiting();
    }
  }

  async handlePrepareMpcWalletSigning() {
    const walletId = this.activeMpcWalletId;
    const wallet = this.mpcWalletsById.get(walletId);
    if (!wallet?.id) return;
    if (typeof this.wallet.prepareMpcWalletSigning !== 'function') {
      showError('当前版本不支持重试签名准备');
      return;
    }
    const password = await this.promptPassword?.({
      title: '重试签名准备',
      confirmText: '重试',
      placeholder: '输入钱包密码',
      onConfirm: async (value) => {
        if (!value || value.length < 8) throw new Error('密码至少需要8位字符');
      }
    });
    if (!password) return;
    try {
      showWaiting();
      console.info('[MPC_UI] prepare-signing:start', {
        walletId,
        status: wallet.status || '',
        signingStatus: wallet.signingStatus || '',
        auxInfoStatus: wallet.auxInfoStatus || '',
        completeKeyShareStatus: wallet.completeKeyShareStatus || '',
        hasAddress: Boolean(wallet.address)
      });
      let prepareTimedOut = false;
      const result = await Promise.race([
        this.wallet.prepareMpcWalletSigning({ walletId, password }),
        new Promise((resolve) => {
          setTimeout(() => {
            prepareTimedOut = true;
            console.info('[MPC_UI] prepare-signing:timeout', { walletId });
            resolve({
              success: true,
              started: true,
              pending: true,
              diagnosis: { canSign: false, reason: 'MPC_SIGNING_PREPARE_PENDING' }
            });
          }, 8000);
        })
      ]);
      if (!result?.success) {
        throw new Error(result?.error || '签名准备失败');
      }
      console.info('[MPC_UI] prepare-signing:result', {
        walletId,
        prepareTimedOut,
        success: Boolean(result?.success),
        started: Boolean(result?.started),
        resumed: Boolean(result?.resumed),
        repaired: Boolean(result?.repaired),
        pending: Boolean(result?.pending),
        action: result?.action || '',
        canSign: Boolean(result?.diagnosis?.canSign),
        reason: result?.diagnosis?.reason || '',
        status: result?.diagnosis?.status || '',
        signingStatus: result?.diagnosis?.signingStatus || '',
        auxInfoStatus: result?.diagnosis?.auxInfoStatus || '',
        hasKeyShare: Boolean(result?.diagnosis?.hasKeyShare),
        hasAuxInfo: Boolean(result?.diagnosis?.hasAuxInfo),
        hasCompleteKeyShare: Boolean(result?.diagnosis?.hasCompleteKeyShare),
        participantId: result?.diagnosis?.participantId || ''
      });
      await this.refreshMpcWalletDetail({ localOnly: true, silent: true, preserveOnError: true });
      await this.loadWalletList();
      await this.onWalletUpdated?.();
      if (result?.diagnosis?.canSign) {
        showSuccess('MPC 钱包签名能力已就绪');
      } else if (prepareTimedOut || result?.pending) {
        showSuccess('签名准备已启动，请保持双方钱包插件打开并解锁');
      } else if (result?.started || result?.resumed) {
        showSuccess('签名准备已启动，请保持双方钱包插件打开并解锁');
      } else {
        const reasonMessages = {
          MPC_COMPLETE_KEY_SHARE_NOT_FOUND: '签名准备尚未完成，请保持双方钱包插件打开并解锁',
          MPC_CGGMP24_AUX_INFO_BROWSER_BLOCKING: '当前 MPC 引擎无法在浏览器内完成签名材料准备'
        };
        const reason = String(result?.diagnosis?.reason || result?.diagnosis?.signingUnavailableReason || '').trim();
        showError(reasonMessages[reason] || reason || 'MPC 签名能力仍未就绪');
      }
    } catch (error) {
      console.warn('[MPC_UI] prepare-signing:error', {
        walletId,
        error: error?.message || String(error || '')
      });
      showError(formatMpcSigningPrepareError(error?.message || '签名准备失败'));
    } finally {
      hideWaiting();
    }
  }

  async handleMpcInviteAccept(notificationUid) {
    const invite = this.pendingMpcInvites.find((item) =>
      String(item?.notificationUid || item?.uid || '') === String(notificationUid || '')
    );
    if (!invite) {
      showError('未找到邀请');
      return;
    }
    if (typeof this.wallet.acceptMpcInvite !== 'function') {
      showError('当前版本不支持接受 MPC 邀请');
      return;
    }
    const password = await this.promptPassword?.({
      title: '接受 MPC 邀请',
      confirmText: '接受',
      placeholder: '输入钱包密码',
      onConfirm: async (value) => {
        if (!value || value.length < 8) throw new Error('密码至少需要8位字符');
      }
    });
    if (!password) return;
    try {
      showWaiting();
      const result = await this.wallet.acceptMpcInvite({
        notificationUid: invite.notificationUid || '',
        sessionId: invite.payload?.sessionId || invite.subjectId,
        walletId: invite.payload?.walletId,
        payload: invite.payload || {},
        password
      });
      if (!result?.success) throw new Error(result?.error || '接受邀请失败');
      await this.loadWalletList();
      await this.onWalletUpdated?.();
      globalThis.window?.refreshWalletSelects?.();
      showSuccess('已接受 MPC 邀请');
    } catch (error) {
      console.error('[AccountListController] 接受 MPC 邀请失败:', error);
      showError('接受失败: ' + (error?.message || '未知错误'));
    } finally {
      hideWaiting();
    }
  }

  async handleMpcInviteDismiss(notificationUid) {
    const invite = this.pendingMpcInvites.find((item) =>
      String(item?.notificationUid || item?.uid || '') === String(notificationUid || '')
    );
    if (!invite) {
      showError('未找到邀请');
      return;
    }
    if (typeof this.wallet.dismissMpcInvite !== 'function') {
      showError('当前版本不支持拒绝 MPC 邀请');
      return;
    }
    try {
      showWaiting();
      const result = await this.wallet.dismissMpcInvite({
        notificationUid: invite.notificationUid || invite.uid || '',
        uid: invite.uid || '',
        subjectId: invite.subjectId || '',
        sessionId: invite.payload?.sessionId || invite.subjectId || '',
        walletId: invite.payload?.walletId || '',
        payload: invite.payload || {}
      });
      if (!result?.success) throw new Error(result?.error || '拒绝邀请失败');
      this.closeMpcWalletDetail();
      await this.loadWalletList();
      await this.onWalletUpdated?.();
      showSuccess('已拒绝 MPC 钱包邀请');
    } catch (error) {
      showError('拒绝失败: ' + (error?.message || '未知错误'));
    } finally {
      hideWaiting();
    }
  }

  renderAccountAvatars(container) {
    container.querySelectorAll('.account-avatar[data-address]').forEach(avatarEl => {
      const address = avatarEl.dataset.address;
      if (!address) return;
      avatarEl.innerHTML = '';
      try {
        const size = avatarEl.clientWidth || 36;
        const canvas = generateAvatar(address, size);
        avatarEl.appendChild(canvas);
      } catch (error) {
        // 如果地址不合法，保留空头像
      }
    });
  }

  /** 菜单项被点了:转给对应的回调。 */
  handleAccountMenuAction(action, id) {
    if (!action) return;
    if (action === 'view-private-key') {
      this.onViewPrivateKey?.(id);
    } else if (action === 'delete-account') {
      this.onOpenDeleteAccount?.(id);
    } else if (action === 'view-mnemonic') {
      this.onViewMnemonic?.(id);
    } else if (action === 'export-keyfile') {
      this.onExportAccountKeyfile?.(id);
    } else if (action === 'export-wallet') {
      this.onExportWallet?.(id);
    } else if (action === 'no-mnemonic') {
      // 只是说明,没有动作
    }
  }

  /**
   * 打开账户/钱包的操作菜单。
   *
   * 菜单挂在 document.body 上、用 fixed 定位——钱包卡片是 `overflow: hidden`
   * (`css/accounts.css` 的 `.wallet-card`),放在卡片里会被裁掉。
   */
  openAccountMenu(trigger, items) {
    const menu = ensureAccountMenu();
    menu.textContent = '';
    for (const item of items) {
      if (!item) continue;
      if (item.divider) {
        const hr = document.createElement('div');
        hr.className = 'network-menu-divider';
        menu.appendChild(hr);
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'network-option' + (item.danger ? ' danger' : '') + (item.noteOnly ? ' note-only' : '');
      btn.textContent = item.label;
      // 只是说明的项(比如「这个钱包没有助记词」):不是可点的动作,
      // 做成按钮会让人以为点了有反应——所以做成不可点的说明文字。
      if (item.noteOnly) {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
      } else {
        btn.dataset.action = item.action;
        if (item.id) btn.dataset.id = item.id;
      }
      if (item.note) {
        const note = document.createElement('div');
        note.className = 'network-option-note';
        note.textContent = item.note;
        btn.appendChild(note);
      }
      menu.appendChild(btn);
    }
    menu.classList.remove('hidden');
    // 贴着按钮的右下角;菜单在视口里放不下就翻到按钮上方
    const rect = trigger.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.round(rect.right - 180))}px`;
    const height = menu.getBoundingClientRect().height;
    const below = rect.bottom + 6;
    const above = rect.top - height - 6;
    menu.style.top = `${Math.round(below + height <= window.innerHeight ? below : Math.max(8, above))}px`;
    trigger.setAttribute('aria-expanded', 'true');
    this.openMenuTrigger = trigger;
  }

  closeAccountMenu() {
    const menu = document.getElementById('accountActionMenu');
    menu?.classList.add('hidden');
    this.openMenuTrigger?.setAttribute('aria-expanded', 'false');
    this.openMenuTrigger = null;
  }

  /** 账户菜单的项:按账户类型给。 */
  accountMenuItems(account) {
    const items = [
      { action: 'view-private-key', id: account.id, label: t('account.menu.viewPrivateKey') }
    ];
    // MPC 钱包的密钥分片不在单个账户里,导不出私钥文件
    if (account.namespace !== 'mpc') {
      items.push({ action: 'export-keyfile', id: account.id, label: t('account.menu.exportKeyfile') });
    }
    items.push({ action: 'delete-account', id: account.id, label: t('account.menu.deleteAccount'), danger: true });
    return items;
  }

  /** 钱包菜单的项:按钱包类型给。 */
  walletMenuItems(wallet) {
    const items = [];
    // HD 钱包才可能有助记词;而且得有那一份加密的助记词才看得见。
    // (wallet 来自 GET_ALL_WALLETS,带着 encryptedMnemonic 字段。)
    if (wallet.type === 'hd' && wallet.encryptedMnemonic) {
      items.push({ action: 'view-mnemonic', id: wallet.id, label: t('account.menu.viewMnemonic') });
    } else {
      // 导入的钱包没有助记词:说明一下,免得用户以为漏了功能
      items.push({ action: 'no-mnemonic', id: wallet.id, label: t('account.menu.noMnemonic'), noteOnly: true });
    }
    items.push({ action: 'export-wallet', id: wallet.id, label: t('account.menu.exportWallet') });
    return items;
  }

  bindWalletListEvents(onAccountDetails, onAccountDelete, onAddAccount, onViewMnemonic, onViewPrivateKey) {
    const container = document.getElementById('walletList');
    if (!container) return;

    container.querySelectorAll('.account-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.account-action-btn')) return;

        if (item.classList.contains('mpc-wallet-identity')) {
          const accountId = item.dataset.accountId;
          if (accountId && onAccountDetails) {
            onAccountDetails(accountId);
            return;
          }
          void this.openMpcWalletDetail(item.dataset.walletId);
          return;
        }

        const accountId = item.dataset.accountId;
        if (onAccountDetails) {
          onAccountDetails(accountId);
        }
      });
    });

    container.querySelectorAll('.wallet-header').forEach(header => {
      if (!header.dataset?.primaryAccountId) return;
      header.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        const accountId = header.dataset.primaryAccountId;
        if (accountId && onAccountDetails) {
          onAccountDetails(accountId);
        }
      });
    });

    // 账户/钱包的「⋯」按钮:点开操作菜单
    container.querySelectorAll('.account-menu-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (this.openMenuTrigger === btn) {
          this.closeAccountMenu();
          return;
        }
        if (btn.dataset.menuKind === 'wallet') {
          const walletId = btn.dataset.walletId;
          const wallet = (this.walletsById || new Map()).get(walletId);
          this.openAccountMenu(btn, this.walletMenuItems(wallet || { id: walletId, type: 'imported' }));
        } else {
          const accountId = btn.dataset.accountId;
          const account = (this.accountsById || new Map()).get(accountId);
          this.openAccountMenu(btn, this.accountMenuItems(account || { id: accountId }));
        }
      });
    });

    container.querySelectorAll('.view-mnemonic-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const walletId = btn.dataset.walletId;
        if (onViewMnemonic) {
          onViewMnemonic(walletId);
        }
      });
    });

    container.querySelectorAll('.mpc-wallet-detail-btn').forEach(btn => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        void this.openMpcWalletDetail(btn.dataset.walletId);
      });
    });

    container.querySelectorAll('.mpc-wallet-delete-btn').forEach(btn => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        void this.handleDeleteMpcWallet(btn.dataset.walletId);
      });
    });

    container.querySelectorAll('.mpc-invite-detail-btn').forEach(btn => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        this.openMpcInviteDetail(btn.dataset.notificationUid || '');
      });
    });

    container.querySelectorAll('.mpc-participant-change-btn').forEach(btn => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        showError('参与方变更需要完成密钥刷新协议，当前版本暂不可用');
      });
    });

    container.querySelectorAll('.mpc-invite-accept-btn').forEach(btn => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        void this.handleMpcInviteAccept(btn.dataset.mpcInviteAccept || '');
      });
    });

    container.querySelectorAll('.mpc-invite-dismiss-btn').forEach(btn => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        void this.handleMpcInviteDismiss(btn.dataset.mpcInviteDismiss || '');
      });
    });

    container.querySelectorAll('.add-account-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const walletId = item.dataset.walletId;
        if (onAddAccount) {
          onAddAccount(walletId);
        }
      });
    });
  }

  async handleDeleteMpcWallet(walletId = this.activeMpcWalletId) {
    const normalizedWalletId = String(walletId || '').trim();
    const wallet = this.mpcWalletsById.get(normalizedWalletId);
    if (!wallet?.id) {
      showError('未找到 MPC 钱包');
      return;
    }
    if (typeof this.wallet.deleteMpcWallet !== 'function') {
      showError('当前版本不支持删除 MPC 钱包');
      return;
    }
    try {
      const password = await this.promptPassword?.({
        title: '删除 MPC 钱包',
        confirmText: '确认删除',
        placeholder: '输入钱包密码',
        onConfirm: async (input) => {
          if (!input || input.length < 8) {
            throw new Error('密码至少需要8位字符');
          }
        }
      });
      if (!password) return;
      showWaiting();
      const result = await this.wallet.deleteMpcWallet({
        walletId: normalizedWalletId,
        password,
      });
      if (!result?.success) {
        throw new Error(result?.error || '删除 MPC 钱包失败');
      }
      if (this.activeMpcWalletId === normalizedWalletId) {
        this.closeMpcWalletDetail();
      }
      this.mpcWalletsById.delete(normalizedWalletId);
      await this.loadWalletList();
      await this.onWalletUpdated?.();
      showSuccess('MPC 钱包已删除');
    } catch (error) {
      showError(error?.message || '删除 MPC 钱包失败');
    } finally {
      hideWaiting();
    }
  }
}
