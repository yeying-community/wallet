// 账户管理模块
const AccountManager = {

  // ========== 创建账户 ==========
  async confirmCreateAccount() {
    const name = document.getElementById('newAccountName').value.trim();
    if (!name) {
      UI.showToast('请输入账户名称', 'warning');
      return;
    }

    try {
      // 先检查是否有密码
      const sessionData = await chrome.storage.session.get('wallet_password');
      const password = sessionData.wallet_password;

      if (!password) {
        console.warn('⚠️ No password in session, redirecting to unlock');
        UI.showToast('会话已过期，请重新解锁', 'warning');
        UI.showPage('unlock');
        return;
      }

      // 获取第一个主账户
      const firstMainAccount = await this.getFirstMainAccount();

      if (!firstMainAccount) {
        UI.showToast('无法创建账户：未找到主账户', 'error');
        return;
      }

      // 解密助记词
      const mnemonic = await Utils.decryptString(
        firstMainAccount.encryptedMnemonic,
        password
      );

      // 计算新账户的索引
      const accounts = await Storage.getAllAccounts();
      const accountCount = Object.keys(accounts).length;

      // 从助记词派生新账户
      const newAccount = await Storage.createAccountFromMnemonic(
        mnemonic,
        accountCount,
        name
      );
      console.log('✅ New account created:', newAccount.id);

      UI.showToast('账户创建成功', 'success');

      // 关闭模态框
      const createAccountModal = document.getElementById('createAccountModal');
      if (createAccountModal) {
        createAccountModal.classList.add('hidden');
      }

      // 刷新账户列表
      this.loadAccountManageList();

    } catch (error) {
      console.error('❌ Create account failed:', error);
      UI.showToast('创建账户失败：' + error.message, 'error');
    }
  },

  // ========== 导入账户 ==========
  async confirmImportAccount() {
    const name = document.getElementById('importAccountName').value.trim();
    const privateKey = document.getElementById('importPrivateKey').value.trim();

    if (!name) {
      UI.showToast('请输入账户名称', 'warning');
      return;
    }

    if (!privateKey) {
      UI.showToast('请输入私钥', 'warning');
      return;
    }

    try {
      await Storage.importAccountFromPrivateKey(privateKey, name);
      UI.showToast('账户导入成功', 'success');
      document.getElementById('importAccountModal').classList.add('hidden');
      this.loadAccountManageList();
    } catch (error) {
      console.error('❌ Import account failed:', error);
      UI.showToast('导入账户失败：' + error.message, 'error');
    }
  },

  // ========== 删除账户 ==========
  async confirmDeleteAccount() {
    try {
      const accountId = document.getElementById('deleteAccountId').value;
      const password = document.getElementById('deleteAccountPassword').value;

      if (!accountId) {
        UI.showToast('账户 ID 不存在', 'error');
        return;
      }

      if (!password) {
        UI.showToast('请输入密码', 'warning');
        return;
      }

      console.log('🗑️ Confirming delete account:', accountId);

      // 获取账户信息
      const account = await Storage.getAccount(accountId);
      if (!account) {
        UI.showToast('账户不存在', 'error');
        return;
      }

      // 检查是否是最后一个账户
      const accounts = await Storage.getAllAccounts();
      const accountCount = Object.keys(accounts).length;

      if (accountCount === 1) {
        UI.showToast('无法删除最后一个账户', 'warning');
        return;
      }

      // 如果是主账户，检查是否有子账户
      if (account.type === 'main' && account.subAccounts && account.subAccounts.length > 0) {
        const confirmed = confirm(`该主账户有 ${account.subAccounts.length} 个子账户，删除主账户将同时删除所有子账户。确定要继续吗？`);
        if (!confirmed) {
          return;
        }
      }

      // 删除账户
      await Storage.deleteAccount(accountId, password);

      console.log('✅ Account deleted successfully');

      UI.showToast('账户删除成功', 'success');

      // ✅ 关闭模态框
      const deleteAccountModal = document.getElementById('deleteAccountModal');
      if (deleteAccountModal) {
        deleteAccountModal.classList.add('hidden');
      }

      // ✅ 刷新账户列表
      await this.loadAccountManageList();

      // ✅ 如果删除的是当前账户，需要重新加载钱包
      const currentAccount = await Storage.getCurrentAccount();
      if (!currentAccount || currentAccount.id === accountId) {
        // 检查是否还有账户
        const remainingAccounts = await Storage.getAllAccounts();
        if (Object.keys(remainingAccounts).length === 0) {
          // 没有账户了，返回初始页面
          UI.showPage('start');
        } else {
          // 切换到第一个账户
          const firstAccount = Object.values(remainingAccounts)[0];
          await WalletManager.switchAccount(firstAccount.id);
        }
      }

    } catch (error) {
      console.error('❌ Delete account failed:', error);
      UI.showToast('删除账户失败：' + error.message, 'error');
    }
  },

  // ========== 确认编辑账户 ==========
  async confirmEditAccount() {
    try {
      const accountId = document.getElementById('editAccountId').value;
      const newName = document.getElementById('editAccountName').value.trim();

      if (!accountId) {
        UI.showToast('账户 ID 不存在', 'error');
        return;
      }

      if (!newName) {
        UI.showToast('请输入账户名称', 'warning');
        return;
      }

      console.log('✏️ Updating account name:', { accountId, newName });

      // 获取账户
      const account = await Storage.getAccount(accountId);
      if (!account) {
        UI.showToast('账户不存在', 'error');
        return;
      }

      // 更新账户名称
      account.name = newName;
      await Storage.updateAccount(account);

      console.log('✅ Account name updated successfully');

      UI.showToast('账户名称已更新', 'success');

      // 关闭模态框
      const editAccountModal = document.getElementById('editAccountModal');
      if (editAccountModal) {
        editAccountModal.classList.add('hidden');
      }

      // 刷新账户列表
      await this.loadAccountManageList();

      // 如果编辑的是当前账户，更新显示
      const currentAccount = await Storage.getCurrentAccount();
      if (currentAccount && currentAccount.id === accountId) {
        UI.updateAccountName(newName);
      }

    } catch (error) {
      console.error('❌ Edit account failed:', error);
      UI.showToast('编辑账户失败：' + error.message, 'error');
    }
  },
  // ========== 加载账户列表 ==========
  async loadAccountManageList() {
    try {
      const accounts = await Storage.getAllAccounts();
      const currentAccount = await Storage.getCurrentAccount();

      const accountList = document.getElementById('accountManageList');
      if (!accountList) {
        console.warn('⚠️ Account manage list element not found');
        return;
      }

      // ✅ 清空列表
      accountList.innerHTML = '';

      const accountArray = Object.values(accounts);
      if (accountArray.length === 0) {
        accountList.innerHTML = '<div class="empty-state">暂无账户</div>';
        return;
      }

      // 渲染账户列表
      accountArray.forEach(account => {
        const accountItem = document.createElement('div');
        accountItem.className = 'account-manage-item';
        if (currentAccount && currentAccount.id === account.id) {
          accountItem.classList.add('active');
        }

        accountItem.innerHTML = `
        <div class="account-avatar" data-address="${account.address}"></div>
        <div class="account-info">
          <div class="account-name">${Utils.escapeHtml(account.name)}</div>
          <div class="account-address">${Utils.shortenAddress(account.address)}</div>
          <div class="account-type">${account.type === 'main' ? '主账户' : account.type === 'sub' ? '子账户' : '导入账户'}</div>
        </div>
        <div class="account-actions">
          ${currentAccount && currentAccount.id === account.id ? '<span class="badge-active">当前</span>' : ''}
          <button class="btn-icon btn-edit" data-account-id="${account.id}" title="编辑">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="btn-icon btn-delete" data-account-id="${account.id}" title="删除">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;

        accountList.appendChild(accountItem);

        // 生成头像
        const avatarDiv = accountItem.querySelector('.account-avatar');
        const canvas = Utils.generateAvatar(account.address);
        avatarDiv.appendChild(canvas);
      });

      console.log('✅ Account manage list loaded');

      // ========== 绑定账户管理事件 ==========
      // 编辑账户按钮
      document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const accountId = btn.dataset.accountId;
          this.showEditAccountModal(accountId);
        });
      });

      // 删除账户按钮
      document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const accountId = btn.dataset.accountId;
          this.showDeleteAccountModal(accountId);
        });
      });

      // 切换账户按钮
      document.querySelectorAll('.account-manage-item').forEach(item => {
        item.addEventListener('click', async () => {
          const accountId = item.querySelector('.btn-edit').dataset.accountId;
          const currentAccount = await Storage.getCurrentAccount();

          if (!currentAccount || currentAccount.id !== accountId) {
            await WalletManager.switchAccount(accountId);
            UI.showPage('wallet');
          }
        });
      });
    } catch (error) {
      console.error('❌ Load account manage list failed:', error);
      UI.showToast('加载账户列表失败', 'error');
    }
  },

  // ========== 显示删除账户模态框 ==========
  async showDeleteAccountModal(accountId) {
    try {
      const account = await Storage.getAccount(accountId);
      if (!account) {
        UI.showToast('账户不存在', 'error');
        return;
      }

      const deleteAccountModal = document.getElementById('deleteAccountModal');
      if (!deleteAccountModal) {
        console.error('❌ Delete account modal not found');
        return;
      }

      // 设置账户信息
      document.getElementById('deleteAccountId').value = accountId;
      document.getElementById('deleteAccountName').textContent = account.name;
      document.getElementById('deleteAccountAddress').textContent = Utils.shortenAddress(account.address);
      document.getElementById('deleteAccountPassword').value = '';

      // 显示模态框
      deleteAccountModal.classList.remove('hidden');

    } catch (error) {
      console.error('❌ Show delete account modal failed:', error);
      UI.showToast('显示删除确认失败', 'error');
    }
  },

  // ========== 显示编辑账户模态框 ==========
  async showEditAccountModal(accountId) {
    try {
      const account = await Storage.getAccount(accountId);
      if (!account) {
        UI.showToast('账户不存在', 'error');
        return;
      }

      console.log('✏️ Editing account:', account.id);

      const editAccountModal = document.getElementById('editAccountModal');
      if (!editAccountModal) {
        console.error('❌ Edit account modal not found');
        return;
      }

      // 设置账户信息
      document.getElementById('editAccountId').value = accountId;
      document.getElementById('editAccountName').value = account.name;
      document.getElementById('editAccountAddress').textContent = Utils.shortenAddress(account.address);
      document.getElementById('editAccountType').textContent =
        account.type === 'main' ? '主账户' :
          account.type === 'sub' ? '子账户' :
            '导入账户';

      // 显示模态框
      editAccountModal.classList.remove('hidden');

      // 聚焦到输入框
      document.getElementById('editAccountName').focus();

    } catch (error) {
      console.error('❌ Show edit account modal failed:', error);
      UI.showToast('显示编辑窗口失败', 'error');
    }
  },

  // 获取账户的钱包实例（需要密码）
  async getAccountWallet(accountId, password) {
    try {
      const privateKey = await Storage.getAccountPrivateKey(accountId, password);
      return new ethers.Wallet(privateKey);
    } catch (error) {
      console.error('❌ Get account wallet failed:', error);
      throw error;
    }
  },

  // 导出账户（仅导出结构，不包含私钥）
  async exportAccountStructure() {
    try {
      const accounts = await Storage.getAllAccounts();
      const exportData = {};

      for (const [id, account] of Object.entries(accounts)) {
        exportData[id] = {
          id: account.id,
          name: account.name,
          type: account.type,
          address: account.address,
          createdAt: account.createdAt,
          ...(account.type === 'main' && { subAccounts: account.subAccounts }),
          ...(account.type === 'sub' && { parentId: account.parentId, index: account.index })
        };
      }

      return exportData;
    } catch (error) {
      console.error('❌ Export account structure failed:', error);
      throw error;
    }
  },

  // 获取第一个主账户（用于派生子账户）
  async getFirstMainAccount() {
    try {
      const accounts = await Storage.getAllAccounts();
      const mainAccounts = Object.values(accounts).filter(
        acc => acc.type === 'main' && acc.encryptedMnemonic
      );
      return mainAccounts.length > 0 ? mainAccounts[0] : null;
    } catch (error) {
      console.error('❌ Get first main account failed:', error);
      return null;
    }
  },
};
