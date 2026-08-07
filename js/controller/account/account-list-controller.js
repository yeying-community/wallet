import { showPage, showError, showSuccess, setPageOrigin, showWaiting, hideWaiting } from '../../common/ui/index.js';
import { shortenAddress, generateAvatar } from '../../common/chain/index.js';
import { escapeHtml } from '../../common/ui/html-ui.js';
import { clearImportWalletForm } from '../wallet/import-wallet-controller.js';

export class AccountListController {
  constructor({
    wallet,
    onWalletUpdated,
    onOpenAccountDetails,
    onOpenDeleteAccount,
    onOpenCreateAccount,
    onViewMnemonic,
    onViewPrivateKey,
    promptPassword
  }) {
    this.wallet = wallet;
    this.onWalletUpdated = onWalletUpdated;
    this.onOpenAccountDetails = onOpenAccountDetails;
    this.onOpenDeleteAccount = onOpenDeleteAccount;
    this.onOpenCreateAccount = onOpenCreateAccount;
    this.onViewMnemonic = onViewMnemonic;
    this.onViewPrivateKey = onViewPrivateKey;
    this.promptPassword = promptPassword;
    this.mpcWalletsById = new Map();
    this.activeMpcWalletId = '';
  }

  bindEvents() {
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
      void this.refreshMpcWalletDetail();
    });
    ['closeMpcWalletDetailModal', 'closeMpcWalletDetailBtn'].forEach((id) => {
      document.getElementById(id)?.addEventListener('click', () => this.closeMpcWalletDetail());
    });
    document.getElementById('mpcWalletDetailModal')
      ?.querySelector('.modal-overlay')
      ?.addEventListener('click', () => this.closeMpcWalletDetail());
  }

  async handleExportAccounts() {
    if (!this.promptPassword) return;
    const password = await this.promptPassword({
      title: '导出所有账户',
      confirmText: '加密导出',
      placeholder: '输入当前钱包密码',
      onConfirm: async (value) => {
        if (!value || value.length < 8) throw new Error('密码至少需要8位字符');
      }
    });
    if (!password) return;
    try {
      showWaiting();
      const result = await this.wallet.exportAccountsFile(password);
      const blob = new Blob([JSON.stringify(result.file, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `yeying-accounts-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showSuccess(`已加密导出 ${result.accountCount} 个账户`);
    } catch (error) {
      showError('导出失败: ' + (error?.message || '未知错误'));
    } finally {
      hideWaiting();
    }
  }

  preparePasswordFormForExistingWallet() {
    const hint = document.getElementById('setPasswordHint');
    const passwordLabel = document.getElementById('setPasswordLabel');
    const confirmGroup = document.getElementById('confirmPasswordGroup');
    const passwordInput = document.getElementById('newPassword');
    const confirmInput = document.getElementById('confirmPassword');
    const walletTypeGroup = document.getElementById('createWalletTypeGroup');
    const walletTypeSelect = document.getElementById('createWalletTypeSelect');
    const mpcFields = document.getElementById('mpcCreateWalletFields');
    const mpcResult = document.getElementById('mpcCreateWalletResult');
    const setPasswordBtn = document.getElementById('setPasswordBtn');

    if (hint) {
      hint.textContent = '请输入当前钱包密码';
    }
    if (passwordLabel) {
      passwordLabel.textContent = '当前密码';
    }
    if (confirmGroup) {
      confirmGroup.classList.add('hidden');
    }
    if (passwordInput) {
      passwordInput.placeholder = '输入当前密码';
    }
    if (confirmInput) {
      confirmInput.value = '';
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
      const wallets = await this.wallet.getWalletList();

      this.renderWalletList(
        wallets,
        (id) => this.onOpenAccountDetails?.(id),
        (id) => this.onOpenDeleteAccount?.(id),
        (walletId) => this.onOpenCreateAccount?.(walletId),
        (walletId) => this.onViewMnemonic?.(walletId),
        (accountId) => this.onViewPrivateKey?.(accountId)
      );
    } catch (error) {
      console.error('[AccountListController] 加载钱包列表失败:', error);
      this.renderWalletList([]);
    }
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

  renderWalletList(wallets, onAccountDetails, onAccountDelete, onAddAccount, onViewMnemonic, onViewPrivateKey) {
    const container = document.getElementById('walletList');
    if (!container) return;

    if (!wallets || wallets.length === 0) {
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

    this.mpcWalletsById = new Map(
      wallets.filter(wallet => wallet?.type === 'mpc' && wallet?.id).map(wallet => [wallet.id, wallet])
    );
    container.innerHTML = wallets.map(wallet => {
      const type = wallet.type || 'hd';
      const isHd = type === 'hd';
      const isImported = type === 'imported';
      const isMpc = type === 'mpc';
      const walletLabel = isMpc ? 'MPC Wallet' : (isHd ? 'HD Wallet' : 'Imported Wallet');
      const walletName = String(wallet.name || walletLabel).trim() || walletLabel;
      const walletIcon = isMpc ? '🧩' : (isHd ? '🔑' : '📥');
      const accounts = Array.isArray(wallet.accounts) ? wallet.accounts : [];
      const mpcPending = isMpc && !accounts.length && wallet.status !== 'active';
      const mpcThreshold = Number(wallet.threshold || 0);
      const mpcParticipantCount = Array.isArray(wallet.participants) ? wallet.participants.length : 0;
      const accountHtml = accounts.length ? accounts.map(account => `
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
              <button class="account-action-btn key-btn view-private-key-btn"
                      data-account-id="${account.id}"
                      title="查看私钥">
                🔑
              </button>
              <button class="account-action-btn danger delete-btn"
                      data-account-id="${account.id}"
                      title="删除">
                🗑️
              </button>
            </div>
          </div>
        `).join('') : (mpcPending ? `
          <div class="mpc-wallet-pending">
            <div class="mpc-wallet-pending-title">等待参与者完成密钥生成</div>
            <div class="mpc-wallet-pending-meta">门限 ${mpcThreshold || '-'} / ${mpcParticipantCount || '-'}</div>
          </div>
        ` : '<div class="empty-message">暂无账户</div>');

      return `
    <div class="wallet-card" data-wallet-id="${wallet.id}">
      <div class="wallet-header">
        <div class="wallet-icon ${isImported ? 'imported' : ''}">
          ${walletIcon}
        </div>
        <div class="wallet-info">
          <div class="wallet-name">
            ${escapeHtml(walletName)}
          </div>
          ${isMpc ? `<div class="wallet-meta"><span class="wallet-type-badge">${walletLabel}</span></div>` : ''}
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
      </div>
    </div>
  `;
    }).join('');

    this.renderAccountAvatars(container);
    this.bindWalletListEvents(onAccountDetails, onAccountDelete, onAddAccount, onViewMnemonic, onViewPrivateKey);
  }

  async openMpcWalletDetail(walletId) {
    const wallet = this.mpcWalletsById.get(walletId);
    if (!wallet) return;
    this.activeMpcWalletId = walletId;
    this.renderMpcWalletDetail(wallet, []);
    document.getElementById('mpcWalletDetailModal')?.classList.remove('hidden');
    await this.refreshMpcWalletDetail();
  }

  closeMpcWalletDetail() {
    this.activeMpcWalletId = '';
    document.getElementById('mpcWalletDetailModal')?.classList.add('hidden');
  }

  async refreshMpcWalletDetail() {
    const walletId = this.activeMpcWalletId;
    const wallet = this.mpcWalletsById.get(walletId);
    if (!wallet) return;
    const container = document.getElementById('mpcWalletDetailSessions');
    if (container) container.innerHTML = '<div class="empty-message">正在加载...</div>';
    try {
      const result = await this.wallet.getMpcSessions(walletId);
      if (!result?.success) throw new Error(result?.error || '加载失败');
      this.renderMpcWalletDetail(wallet, Array.isArray(result.sessions) ? result.sessions : []);
    } catch (error) {
      if (container) container.innerHTML = '<div class="empty-message">会话加载失败</div>';
      showError('MPC 会话加载失败: ' + (error?.message || '未知错误'));
    }
  }

  renderMpcWalletDetail(wallet, sessions = []) {
    const setText = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    };
    const participants = Array.isArray(wallet?.participants) ? wallet.participants : [];
    const statusLabels = {
      keygen_pending: '等待参与者完成密钥生成',
      active: '可用',
      failed: '密钥生成失败',
    };
    setText('mpcWalletDetailName', wallet?.name || 'MPC 钱包');
    setText('mpcWalletDetailStatus', statusLabels[wallet?.status] || wallet?.status || '等待参与者完成密钥生成');
    setText('mpcWalletDetailAddress', wallet?.address || '尚未生成');
    setText('mpcWalletDetailThreshold', `${wallet?.threshold || '-'} / ${participants.length || '-'}`);
    setText('mpcWalletDetailParticipants', participants.length ? participants.join(', ') : '-');

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

  bindWalletListEvents(onAccountDetails, onAccountDelete, onAddAccount, onViewMnemonic, onViewPrivateKey) {
    const container = document.getElementById('walletList');
    if (!container) return;

    container.querySelectorAll('.account-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.account-action-btn')) return;

        const accountId = item.dataset.accountId;
        if (onAccountDetails) {
          onAccountDetails(accountId);
        }
      });
    });

    container.querySelectorAll('.view-private-key-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const accountId = btn.dataset.accountId;
        if (onViewPrivateKey) {
          onViewPrivateKey(accountId);
        }
      });
    });

    container.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const accountId = btn.dataset.accountId;
        if (onAccountDelete) {
          onAccountDelete(accountId);
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
}
