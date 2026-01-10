import { showPage, showSuccess, showError, setPageOrigin } from '../../common/ui/index.js';
import { shortenAddress, generateAvatar } from '../../common/chain/index.js';

export class AccountsListController {
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
  }

  preparePasswordFormForExistingWallet() {
    const hint = document.getElementById('setPasswordHint');
    const passwordLabel = document.getElementById('setPasswordLabel');
    const confirmGroup = document.getElementById('confirmPasswordGroup');
    const passwordInput = document.getElementById('newPassword');
    const confirmInput = document.getElementById('confirmPassword');

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
  }

  async loadWalletList() {
    try {
      const wallets = await this.wallet.getWalletList();

      this.renderWalletList(
        wallets,
        (id) => this.handleSelectAccount(id),
        (id) => this.onOpenAccountDetails?.(id),
        (id) => this.onOpenDeleteAccount?.(id),
        (walletId) => this.onOpenCreateAccount?.(walletId),
        (walletId) => this.onViewMnemonic?.(walletId),
        (accountId) => this.onViewPrivateKey?.(accountId)
      );
    } catch (error) {
      console.error('[AccountsListController] 加载钱包列表失败:', error);
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
      if (error?.requirePassword && this.promptPassword) {
        await this.promptPassword({
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

      console.error('[AccountsListController] 切换账户失败:', error);
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
}
