import { shortenAddress, generateAvatar } from '../common/utils/index.js';
import {
  showPage,
  showSuccess,
  showError,
  copyToClipboard,
  generateQRCode,
  openModal,
  closeModal,
  closeAllModals,
  setPageOrigin,
  promptPassword
} from './ui.js';

export class AccountsController {
  constructor({ wallet, onWalletUpdated }) {
    this.wallet = wallet;
    this.onWalletUpdated = onWalletUpdated;
    this.currentDetailAccountId = null;
    this.currentDetailAddress = '';
  }

  bindEvents() {
    const createBtn = document.getElementById('accountsCreateWalletBtn');
    if (createBtn) {
      createBtn.addEventListener('click', () => {
        setPageOrigin('setPasswordPage', 'accounts');
        showPage('setPasswordPage');
        const setPasswordBtn = document.getElementById('setPasswordBtn');
        if (setPasswordBtn) {
          setPasswordBtn.textContent = '创建新账户';
        }
      });
    }

    const importBtn = document.getElementById('accountsImportWalletBtn');
    if (importBtn) {
      importBtn.addEventListener('click', () => {
        setPageOrigin('importPage', 'accounts');
        showPage('importPage');
      });
    }

    this.bindModalEvents();
    this.bindAccountDetailEvents();
  }

  bindModalEvents() {
    this.bindModalButtonEvents(
      'createAccountModal',
      'closeCreateAccountModal',
      'cancelCreateAccount',
      'confirmCreateAccount',
      () => this.handleCreateAccount()
    );

    this.bindModalButtonEvents(
      'deleteAccountModal',
      'closeDeleteAccountModal',
      'cancelDeleteAccount',
      'confirmDeleteAccount',
      () => this.handleDeleteAccount()
    );

    this.bindSecretDisplayEvents();

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', () => {
        closeAllModals();
      });
    });
  }

  bindModalButtonEvents(modalId, closeId, cancelId, confirmId, confirmHandler) {
    const closeBtn = document.getElementById(closeId);
    const cancelBtn = document.getElementById(cancelId);
    const confirmBtn = document.getElementById(confirmId);

    if (closeBtn) {
      closeBtn.addEventListener('click', () => closeModal(modalId));
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => closeModal(modalId));
    }
    if (confirmBtn) {
      confirmBtn.addEventListener('click', confirmHandler);
    }
  }

  async loadWalletList() {
    try {
      const wallets = await this.wallet.getWalletList();

      this.renderWalletList(
        wallets,
        (id) => this.handleSelectAccount(id),
        (id) => this.handleViewAccountDetails(id),
        (id) => this.handleDeleteAccountClick(id),
        (walletId) => this.handleOpenCreateAccount(walletId),
        (walletId) => this.handleViewMnemonic(walletId),
        (accountId) => this.handleViewPrivateKey(accountId)
      );
    } catch (error) {
      console.error('[AccountsController] 加载钱包列表失败:', error);
      this.renderWalletList([]);
    }
  }

  async handleSelectAccount(accountId) {
    try {
      await this.wallet.switchAccount(accountId);

      showPage('walletPage');

      await this.refreshWalletData();

      showSuccess('已切换账户');
    } catch (error) {
      if (error?.requirePassword) {
        await promptPassword({
          title: '切换账户',
          confirmText: '确认切换',
          placeholder: '输入密码',
          onConfirm: async (password) => {
            try {
              await this.wallet.switchAccount(accountId, password);
              showPage('walletPage');
              await this.refreshWalletData();
              showSuccess('已切换账户');
            } catch (err) {
              if (err?.requirePassword || /password/i.test(err?.message || '')) {
                throw new Error('密码错误');
              }
              throw err;
            }
          }
        });
        return;
      }
      console.error('[AccountsController] 切换账户失败:', error);
      const message = error?.requirePassword
        ? '请输入密码以继续切换账户'
        : error?.message || '切换失败';
      showError('切换失败: ' + message);
    }
  }

  async handleEditAccountClick(accountId) {
    this.currentDetailAccountId = accountId;
    this.enterAccountNameEdit();
  }

  async handleViewAccountDetails(accountId) {
    try {
      const account = await this.wallet.getAccountById(accountId);
      if (!account) {
        showError('账户不存在');
        return;
      }

      this.currentDetailAccountId = account.id;
      this.currentDetailAddress = account.address || '';

      const nameEl = document.getElementById('accountDetailNameText');
      const nameInput = document.getElementById('accountDetailNameInput');
      const typeEl = document.getElementById('accountDetailType');
      const addressEl = document.getElementById('accountDetailAddress');
      const avatarEl = document.getElementById('accountDetailAvatar');
      const sizeSelect = document.getElementById('accountDetailQrSize');

      if (nameEl) {
        nameEl.textContent = account.name || '账户';
      }
      if (nameInput) {
        nameInput.value = account.name || '';
      }
      if (typeEl) {
        typeEl.textContent = this.formatAccountType(account.type);
      }
      if (addressEl) {
        addressEl.textContent = account.address ? shortenAddress(account.address) : '';
      }
      if (avatarEl) {
        avatarEl.innerHTML = '';
        try {
          const size = avatarEl.clientWidth || 64;
          const canvas = generateAvatar(account.address, size);
          avatarEl.appendChild(canvas);
        } catch (error) {
          // ignore invalid address
        }
      }

      const qrContainer = document.getElementById('accountDetailQr');
      if (qrContainer) {
        qrContainer.innerHTML = '';
        const qrSize = parseInt(sizeSelect?.value, 10) || 160;
        generateQRCode(account.address, 'accountDetailQr', { size: qrSize });
      }

      this.exitAccountNameEdit(true);
      showPage('accountDetailPage');
    } catch (error) {
      console.error('[AccountsController] 打开账户详情失败:', error);
      showError('操作失败');
    }
  }

  async handleDeleteAccountClick(accountId) {
    try {
      const account = await this.wallet.getAccountById(accountId);
      if (!account) {
        showError('账户不存在');
        return;
      }

      document.getElementById('deleteAccountId').value = account.id;
      document.getElementById('deleteAccountName').textContent = account.name;
      document.getElementById('deleteAccountAddress').textContent = account.address;

      openModal('deleteAccountModal');
    } catch (error) {
      console.error('[AccountsController] 打开删除确认模态框失败:', error);
      showError('操作失败');
    }
  }

  async handleDeleteAccount() {
    const accountId = document.getElementById('deleteAccountId').value;

    try {
      closeModal('deleteAccountModal');

      const password = await promptPassword({
        title: '删除账户',
        confirmText: '确认删除',
        placeholder: '输入密码',
        onConfirm: async (input) => {
          if (!input || input.length < 8) {
            throw new Error('密码至少需要8位字符');
          }
          await this.wallet.deleteAccount(accountId, input);
        }
      });
      if (!password) return;

      this.loadWalletList();
      showSuccess('账户已删除');

      await this.refreshWalletData();
    } catch (error) {
      console.error('[AccountsController] 删除账户失败:', error);
      showError('删除失败: ' + error.message);
    }
  }

  async handleViewPrivateKey(accountId) {
    try {
      const account = await this.wallet.getAccountById(accountId);
      if (!account) {
        showError('账户不存在');
        return;
      }

      let privateKey = null;
      const password = await promptPassword({
        title: '查看私钥',
        confirmText: '显示',
        placeholder: '输入密码',
        onConfirm: async (input) => {
          if (!input || input.length < 8) {
            throw new Error('密码至少需要8位字符');
          }
          privateKey = await this.wallet.exportPrivateKey(accountId, input);
        }
      });
      if (!password || !privateKey) return;

      this.openSecretDisplay({
        type: 'privateKey',
        title: `私钥 - ${account.name || '账户'}`,
        label: '私钥',
        warning: '⚠️ 请勿泄露私钥！任何人获得私钥都可以控制您的资产。',
        value: privateKey
      });
    } catch (error) {
      console.error('[AccountsController] 获取私钥失败:', error);
      showError('获取私钥失败: ' + error.message);
    }
  }

  async handleViewMnemonic(walletId) {
    try {
      let mnemonic = null;
      const password = await promptPassword({
        title: '查看助记词',
        confirmText: '显示',
        placeholder: '输入密码',
        onConfirm: async (input) => {
          if (!input || input.length < 8) {
            throw new Error('密码至少需要8位字符');
          }
          mnemonic = await this.wallet.exportMnemonic(walletId, input);
        }
      });
      if (!password || !mnemonic) return;

      this.openSecretDisplay({
        type: 'mnemonic',
        title: '助记词',
        label: '助记词',
        warning: '⚠️ 请勿泄露助记词！任何人获得助记词都可以恢复你的钱包。',
        value: mnemonic
      });
    } catch (error) {
      console.error('[AccountsController] 获取助记词失败:', error);
      showError('获取助记词失败: ' + error.message);
    }
  }

  async handleCreateAccount() {
    const modal = document.getElementById('createAccountModal');
    const walletId = modal?.dataset?.walletId;
    if (!walletId) {
      showError('未找到钱包');
      return;
    }

    const nameInput = document.getElementById('newAccountName');
    const name = nameInput?.value.trim() || `账户 ${Date.now()}`;

    try {
      const result = await this.wallet.createSubAccount(walletId, name);
      const newAccount = result?.account || result;

      closeModal('createAccountModal');
      this.loadWalletList();
      showSuccess(`账户 "${name}" 创建成功`);

      await this.handleSelectAccount(newAccount.id);
    } catch (error) {
      console.error('[AccountsController] 创建账户失败:', error);
      showError('创建失败: ' + error.message);
    }
  }

  handleOpenCreateAccount(walletId) {
    const modal = document.getElementById('createAccountModal');
    if (modal) {
      modal.dataset.walletId = walletId;
    }

    const nameInput = document.getElementById('newAccountName');
    if (nameInput) {
      nameInput.value = `账户 ${Date.now()}`;
    }

    openModal('createAccountModal');
  }

  async refreshWalletData() {
    if (this.onWalletUpdated) {
      await this.onWalletUpdated();
      return;
    }
  }

  renderWalletList(wallets, onAccountClick, onAccountDetails, onAccountDelete, onAddAccount, onViewMnemonic, onViewPrivateKey) {
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

    container.innerHTML = wallets.map(wallet => `
    <div class="wallet-card" data-wallet-id="${wallet.id}">
      <div class="wallet-header">
        <div class="wallet-icon ${wallet.type === 'imported' ? 'imported' : ''}">
          ${wallet.type === 'hd' ? '🔑' : '📥'}
        </div>
        <div class="wallet-info">
          <div class="wallet-name">
            ${wallet.type === 'hd' ? 'HD Wallet' : 'Imported Wallet'}
          </div>
        </div>
        ${wallet.type === 'hd' ? `
          <div class="wallet-header-actions">
            <button
              class="wallet-header-btn view-mnemonic-btn"
              data-wallet-id="${wallet.id}"
              title="查看助记词"
            >
              查看助记词
            </button>
          </div>
        ` : ''}
      </div>
      <div class="account-list">
        ${wallet.accounts.map(account => `
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
              <button class="account-action-btn details-btn"
                      data-account-id="${account.id}"
                      title="账户详情">
                ℹ️
              </button>
              ${!account.isSelected ? `
                <button class="account-action-btn danger delete-btn"
                        data-account-id="${account.id}"
                        title="删除">
                  🗑️
                </button>
              ` : ''}
            </div>
          </div>
        `).join('')}
        ${wallet.type === 'hd' ? `
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
  `).join('');

    this.renderAccountAvatars(container);
    this.bindWalletListEvents(onAccountClick, onAccountDetails, onAccountDelete, onAddAccount, onViewMnemonic, onViewPrivateKey);
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

  bindWalletListEvents(onAccountClick, onAccountDetails, onAccountDelete, onAddAccount, onViewMnemonic, onViewPrivateKey) {
    const container = document.getElementById('walletList');
    if (!container) return;

    container.querySelectorAll('.account-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.account-action-btn')) return;

        const accountId = item.dataset.accountId;
        if (onAccountClick) {
          onAccountClick(accountId);
        }
      });
    });

    container.querySelectorAll('.details-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const accountId = btn.dataset.accountId;
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

  bindAccountDetailEvents() {
    const nameRow = document.getElementById('accountDetailNameRow');
    const editBtn = document.getElementById('editAccountNameBtn');
    const saveBtn = document.getElementById('saveAccountNameBtn');
    const cancelBtn = document.getElementById('cancelAccountNameBtn');
    const nameInput = document.getElementById('accountDetailNameInput');

    nameRow?.addEventListener('click', () => {
      if (this.currentDetailAccountId) {
        this.enterAccountNameEdit();
      }
    });
    editBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.currentDetailAccountId) {
        this.enterAccountNameEdit();
      }
    });
    saveBtn?.addEventListener('click', async () => {
      await this.saveAccountNameEdit();
    });
    cancelBtn?.addEventListener('click', () => {
      this.exitAccountNameEdit();
    });
    nameInput?.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await this.saveAccountNameEdit();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.exitAccountNameEdit();
      }
    });

    const addressEl = document.getElementById('accountDetailAddress');
    if (addressEl) {
      addressEl.addEventListener('click', (event) => {
        event.preventDefault();
      });
    }

    const copyBtn = document.getElementById('copyAccountAddressBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        await this.handleAccountAddressCopy();
      });
    }

    const sizeSelect = document.getElementById('accountDetailQrSize');
    if (sizeSelect) {
      sizeSelect.addEventListener('change', () => {
        if (!this.currentDetailAddress) return;
        const size = parseInt(sizeSelect.value, 10) || 160;
        generateQRCode(this.currentDetailAddress, 'accountDetailQr', { size });
      });
    }

    const exportBtn = document.getElementById('exportAccountQrBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        this.handleExportAccountQr();
      });
    }
  }

  async handleAccountAddressCopy() {
    if (!this.currentDetailAddress) return;
    await copyToClipboard(this.currentDetailAddress, '地址已复制');
  }

  enterAccountNameEdit() {
    const nameRow = document.getElementById('accountDetailNameRow');
    const editWrap = document.getElementById('accountDetailNameEdit');
    const nameInput = document.getElementById('accountDetailNameInput');
    const nameText = document.getElementById('accountDetailNameText');

    if (nameInput && nameText) {
      nameInput.value = nameText.textContent?.trim() || '';
      nameInput.focus();
      nameInput.select();
    }

    nameRow?.classList.add('hidden');
    editWrap?.classList.remove('hidden');
  }

  exitAccountNameEdit(reset = false) {
    const nameRow = document.getElementById('accountDetailNameRow');
    const editWrap = document.getElementById('accountDetailNameEdit');
    const nameInput = document.getElementById('accountDetailNameInput');
    const nameText = document.getElementById('accountDetailNameText');

    if (reset && nameInput && nameText) {
      nameInput.value = nameText.textContent?.trim() || '';
    }

    editWrap?.classList.add('hidden');
    nameRow?.classList.remove('hidden');
  }

  async saveAccountNameEdit() {
    if (!this.currentDetailAccountId) return;
    const nameInput = document.getElementById('accountDetailNameInput');
    const newName = nameInput?.value.trim() || '';
    if (!newName) {
      showError('请输入账户名称');
      return;
    }
    if (newName.length > 20) {
      showError('账户名称不能超过20个字符');
      return;
    }

    try {
      await this.wallet.updateAccountName(this.currentDetailAccountId, newName);
      const nameText = document.getElementById('accountDetailNameText');
      if (nameText) {
        nameText.textContent = newName;
      }
      await this.loadWalletList();
      this.exitAccountNameEdit(true);
      showSuccess('账户名称已更新');
    } catch (error) {
      console.error('[AccountsController] 更新账户名称失败:', error);
      showError('更新失败: ' + error.message);
    }
  }

  handleExportAccountQr() {
    const container = document.getElementById('accountDetailQr');
    if (!container) return;

    let dataUrl = null;
    const canvas = container.querySelector('canvas');
    if (canvas) {
      dataUrl = canvas.toDataURL('image/png');
    } else {
      const img = container.querySelector('img');
      if (img?.src && img.src.startsWith('data:image')) {
        dataUrl = img.src;
      }
    }

    if (!dataUrl) {
      showError('二维码不可导出');
      return;
    }

    const filename = this.currentDetailAddress
      ? `qrcode_${this.currentDetailAddress.slice(2, 8)}.png`
      : 'qrcode.png';
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showSuccess('二维码已导出');
  }

  formatAccountType(type) {
    if (!type) return 'HD';
    if (type === 'hd') return 'HD';
    if (type === 'imported') return '导入';
    return type.toString().toUpperCase();
  }

  bindSecretDisplayEvents() {
    const modal = document.getElementById('secretDisplayModal');
    if (!modal) return;

    const overlay = modal.querySelector('.modal-overlay');
    const closeBtn = document.getElementById('closeSecretDisplayModal');
    const confirmBtn = document.getElementById('confirmSecretDisplayBtn');
    const copyBtn = document.getElementById('copySecretDisplayBtn');
    const handleClose = () => closeModal('secretDisplayModal');

    closeBtn?.addEventListener('click', handleClose);
    confirmBtn?.addEventListener('click', handleClose);
    overlay?.addEventListener('click', handleClose);

    copyBtn?.addEventListener('click', async () => {
      const valueEl = document.getElementById('secretDisplayValue');
      const value = valueEl?.value || '';
      if (!value) {
        showError('暂无可复制内容');
        return;
      }
      const type = modal.dataset.secretType;
      const message = type === 'mnemonic' ? '助记词已复制' : '私钥已复制';
      await copyToClipboard(value, message);
    });
  }

  openSecretDisplay({ type, title, label, warning, value }) {
    const modal = document.getElementById('secretDisplayModal');
    if (!modal) return;

    const titleEl = document.getElementById('secretDisplayTitle');
    const warningEl = document.getElementById('secretDisplayWarning');
    const labelEl = document.getElementById('secretDisplayLabel');
    const valueEl = document.getElementById('secretDisplayValue');
    const copyBtn = document.getElementById('copySecretDisplayBtn');

    modal.dataset.secretType = type || '';
    if (titleEl) titleEl.textContent = title || '查看密钥';
    if (warningEl) warningEl.textContent = warning || '';
    if (labelEl) labelEl.textContent = label || '内容';
    if (valueEl) {
      valueEl.value = value || '';
      valueEl.scrollTop = 0;
    }
    if (copyBtn) {
      copyBtn.textContent = type === 'mnemonic' ? '复制助记词' : '复制私钥';
    }

    openModal('secretDisplayModal');
  }
}
