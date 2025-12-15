// 本地存储模块
const Storage = {
  ACCOUNTS_KEY: 'web3_wallet_accounts',
  CURRENT_ACCOUNT_KEY: 'web3_wallet_current_account',
  EXPIRE_KEY: 'web3_wallet_expire_time',
  DEFAULT_EXPIRE_MINUTES: 30, // 默认30分钟过期

  // 生成账户ID
  generateAccountId(type, parentId = null, index = null) {
    if (type === 'main') {
      const timestamp = Date.now();
      return `main_${timestamp}`;
    } else {
      return `sub_${parentId}_${index}`;
    }
  },

  // 创建主账户
  async createMainAccount(name, mnemonic, password) {
    try {
      // 验证助记词
      if (!ethers.utils.isValidMnemonic(mnemonic)) {
        throw new Error('无效的助记词');
      }

      // 完整的派生路径（包含最后的索引 0）
      const derivationPath = "m/44'/60'/0'/0/0";

      // 从助记词派生钱包
      const wallet = ethers.Wallet.fromMnemonic(mnemonic, derivationPath);

      console.log('🔐 Creating main account:', {
        derivationPath,
        address: wallet.address
      });

      // 加密助记词
      const encryptedMnemonic = await Utils.encryptString(mnemonic, password);

      // 创建主账户对象
      const mainAccount = {
        id: this.generateAccountId('main'),
        name: name || '主账户',
        type: 'main',
        encryptedMnemonic: encryptedMnemonic,
        derivationPath: derivationPath,  // 保存完整路径
        address: wallet.address,
        createdAt: Date.now(),
        subAccounts: []
      };

      // 保存账户
      await this.saveAccount(mainAccount);

      // 设置为当前账户
      await this.setCurrentAccount(mainAccount.id);

      console.log('✅ Main account created:', mainAccount.id);
      return mainAccount;
    } catch (error) {
      console.error('❌ Create main account failed:', error);
      throw error;
    }
  },

  // 创建子账户
  async createSubAccount(parentId, name, password) {
    try {
      // 获取父账户
      const parentAccount = await this.getAccount(parentId);
      if (!parentAccount || parentAccount.type !== 'main') {
        throw new Error('父账户不存在或不是主账户');
      }

      // 解密父账户的助记词
      const mnemonic = await Utils.decryptString(
        parentAccount.encryptedMnemonic,
        password
      );

      // 计算子账户索引
      const index = parentAccount.subAccounts.length + 1;  // 从 1 开始（0 是主账户）

      // ✅ 修复：完整的派生路径
      const derivationPath = `m/44'/60'/0'/0/${index}`;
      const wallet = ethers.Wallet.fromMnemonic(mnemonic, derivationPath);

      console.log('🔐 Creating sub account:', {
        parentId,
        index,
        derivationPath,
        address: wallet.address
      });

      // 创建子账户对象
      const subAccount = {
        id: this.generateAccountId('sub', parentId, index),
        name: name || `账户 ${index + 1}`,
        type: 'sub',
        parentId: parentId,
        index: index,
        derivationPath: derivationPath,  // 保存完整路径
        address: wallet.address,
        createdAt: Date.now()
      };

      // 保存子账户
      await this.saveAccount(subAccount);

      // 更新父账户的子账户列表
      parentAccount.subAccounts.push(subAccount.id);
      await this.updateAccount(parentAccount);

      console.log('✅ Sub account created:', subAccount.id);
      return subAccount;
    } catch (error) {
      console.error('❌ Create sub account failed:', error);
      throw error;
    }
  },

  // 从助记词创建账户（用于初始化）
  async createAccountFromMnemonic(mnemonic, index = 0, name = null) {
    try {
      if (!ethers.utils.isValidMnemonic(mnemonic)) {
        throw new Error('无效的助记词');
      }

      // 完整的派生路径
      const derivationPath = `m/44'/60'/0'/0/${index}`;
      const wallet = ethers.Wallet.fromMnemonic(mnemonic, derivationPath);

      console.log('🔐 Creating account from mnemonic:', {
        index,
        derivationPath,
        address: wallet.address
      });

      // 获取当前密码（从 session 中）
      const sessionData = await chrome.storage.session.get('wallet_password');
      const password = sessionData.wallet_password;

      if (!password) {
        throw new Error('未找到密码，请先解锁钱包');
      }

      // 加密助记词
      const encryptedMnemonic = await Utils.encryptString(mnemonic, password);
      // 正确判断账户类型
      // 如果 index === 0，创建主账户
      // 如果 index > 0，创建子账户

      let account
      if (index === 0) {
        // 创建主账户
        account = {
          id: this.generateAccountId('main'),
          name: name || '主账户',
          type: 'main',
          encryptedMnemonic: encryptedMnemonic,
          derivationPath: derivationPath,
          address: wallet.address,
          createdAt: Date.now(),
          subAccounts: []
        };
      } else {
        // 创建子账户 - 需要找到父账户
        const firstMainAccount = await this.getFirstMainAccount();
        if (!firstMainAccount) {
          throw new Error('未找到主账户，无法创建子账户');
        }

        account = {
          id: this.generateAccountId('sub', firstMainAccount.id, index),
          name: name || `账户 ${index + 1}`,
          type: 'sub',
          parentId: firstMainAccount.id,  // 设置父账户 ID
          index: index,
          derivationPath: derivationPath,
          address: wallet.address,
          createdAt: Date.now()
        };

        // 更新父账户的子账户列表
        if (!firstMainAccount.subAccounts) {
          firstMainAccount.subAccounts = [];
        }
        firstMainAccount.subAccounts.push(account.id);
        await this.updateAccount(firstMainAccount);
      }

      await this.saveAccount(account);
      console.log('✅ Account created from mnemonic:', account.id);
      return account;
    } catch (error) {
      console.error('❌ Create account from mnemonic failed:', error);
      throw error;
    }
  },

  // 从私钥导入账户
  async importAccountFromPrivateKey(privateKey, name = null) {
    try {
      // 清理私钥格式
      privateKey = privateKey.trim();
      if (!privateKey.startsWith('0x')) {
        privateKey = '0x' + privateKey;
      }

      // 验证私钥
      let wallet;
      try {
        wallet = new ethers.Wallet(privateKey);
      } catch (error) {
        throw new Error('无效的私钥格式');
      }

      // 获取当前密码
      const sessionData = await chrome.storage.session.get('wallet_password');
      const password = sessionData.wallet_password;

      if (!password) {
        throw new Error('未找到密码，请先解锁钱包');
      }

      // 加密私钥
      const encryptedPrivateKey = await Utils.encryptString(privateKey, password);

      // 创建账户对象（作为独立的主账户）
      const account = {
        id: this.generateAccountId('main'),
        name: name || '导入的账户',
        type: 'imported', // 标记为导入账户
        encryptedPrivateKey: encryptedPrivateKey,
        address: wallet.address,
        createdAt: Date.now(),
        subAccounts: []
      };

      await this.saveAccount(account);
      console.log('✅ Account imported from private key:', account.id);
      return account;
    } catch (error) {
      console.error('❌ Import account from private key failed:', error);
      throw error;
    }
  },

  // 设置当前账户
  async setCurrentAccount(accountId) {
    try {
      await chrome.storage.local.set({ [this.CURRENT_ACCOUNT_KEY]: accountId });

      // 同时更新 session storage
      const account = await this.getAccount(accountId);
      if (account) {
        await chrome.storage.session.set({
          wallet_address: account.address,
          current_account_id: accountId
        });
      }

      console.log('✅ Current account set:', accountId);
      return true;
    } catch (error) {
      console.error('❌ Set current account failed:', error);
      throw error;
    }
  },

  // 检查是否有账户
  async hasAccounts() {
    try {
      const accounts = await this.getAllAccounts();
      return Object.keys(accounts).length > 0;
    } catch (error) {
      console.error('❌ Check accounts failed:', error);
      return false;
    }
  },

  // 获取单个账户
  async getAccount(accountId) {
    try {
      const accounts = await this.getAllAccounts();
      return accounts[accountId] || null;
    } catch (error) {
      console.error('❌ Get account failed:', error);
      return null;
    }
  },

  // 获取子账户列表
  async getSubAccounts(parentId) {
    try {
      const accounts = await this.getAllAccounts();
      return Object.values(accounts).filter(
        acc => acc.type === 'sub' && acc.parentId === parentId
      );
    } catch (error) {
      console.error('❌ Get sub accounts failed:', error);
      return [];
    }
  },

  // 获取主账户列表
  async getMainAccounts() {
    try {
      const accounts = await this.getAllAccounts();
      return Object.values(accounts).filter(acc => acc.type === 'main');
    } catch (error) {
      console.error('❌ Get main accounts failed:', error);
      return [];
    }
  },

  // 获取当前账户
  async getCurrentAccount() {
    try {
      const result = await chrome.storage.local.get(this.CURRENT_ACCOUNT_KEY);
      const accountId = result[this.CURRENT_ACCOUNT_KEY];

      if (!accountId) {
        return null;
      }

      return await this.getAccount(accountId);
    } catch (error) {
      console.error('❌ Get current account failed:', error);
      return null;
    }
  },

  // 获取所有账户
  async getAllAccounts() {
    try {
      const result = await chrome.storage.local.get(this.ACCOUNTS_KEY);
      return result[this.ACCOUNTS_KEY] || {};
    } catch (error) {
      console.error('❌ Get all accounts failed:', error);
      return {};
    }
  },

  // 保存账户
  async saveAccount(account) {
    try {
      const accounts = await this.getAllAccounts();
      accounts[account.id] = account;
      await chrome.storage.local.set({ [this.ACCOUNTS_KEY]: accounts });
      return true;
    } catch (error) {
      console.error('❌ Save account failed:', error);
      throw error;
    }
  },

  // 更新账户
  async updateAccount(account) {
    return await this.saveAccount(account);
  },

  // 重命名账户 TODO:
  async renameAccount(accountId, newName) {
    try {
      const account = await this.getAccount(accountId);
      if (!account) {
        throw new Error('账户不存在');
      }

      account.name = newName;
      await this.updateAccount(account);

      console.log('✅ Account renamed:', accountId, newName);
      return true;
    } catch (error) {
      console.error('❌ Rename account failed:', error);
      throw error;
    }
  },

  // 删除账户
  async deleteAccount(accountId, password) {
    try {
      const account = await this.getAccount(accountId);
      if (!account) {
        throw new Error('账户不存在');
      }

      console.log('🗑️ Deleting account:', {
        id: accountId,
        name: account.name,
        type: account.type
      });

      // 验证密码（通过尝试解密来验证）
      if (password) {
        try {
          await this.getAccountPrivateKey(accountId, password);
        } catch (error) {
          throw new Error('密码错误');
        }
      }

      // 如果是主账户，需要删除所有子账户
      if (account.type === 'main') {
        console.log('🗑️ Deleting main account with sub accounts:', account.subAccounts);

        if (account.subAccounts && account.subAccounts.length > 0) {
          for (const subId of account.subAccounts) {
            await this.deleteSubAccount(subId);
          }
        }
      }

      // 如果是子账户，从父账户的 subAccounts 中移除
      if (account.type === 'sub' && account.parentId) {
        const parentAccount = await this.getAccount(account.parentId);
        if (parentAccount && parentAccount.subAccounts) {
          parentAccount.subAccounts = parentAccount.subAccounts.filter(id => id !== accountId);
          await this.updateAccount(parentAccount);
          console.log('✅ Removed from parent account:', account.parentId);
        }
      }

      // 删除账户
      const accounts = await this.getAllAccounts();
      delete accounts[accountId];
      await chrome.storage.local.set({ [this.ACCOUNTS_KEY]: accounts });

      console.log('✅ Account deleted from storage:', accountId);

      // 如果删除的是当前账户，切换到其他账户
      const currentAccount = await this.getCurrentAccount();
      if (currentAccount && currentAccount.id === accountId) {
        const remainingAccounts = Object.values(accounts);
        if (remainingAccounts.length > 0) {
          await this.setCurrentAccount(remainingAccounts[0].id);
          console.log('✅ Switched to account:', remainingAccounts[0].id);
        } else {
          await chrome.storage.local.remove(this.CURRENT_ACCOUNT_KEY);
          await chrome.storage.session.remove(['wallet_address', 'current_account_id', 'wallet_password']);
          console.log('⚠️ No accounts remaining');
        }
      }

      console.log('✅ Account deleted successfully:', accountId);
      return true;
    } catch (error) {
      console.error('❌ Delete account failed:', error);
      throw error;
    }
  },

  // 删除子账户
  async deleteSubAccount(accountId) {
    try {
      const account = await this.getAccount(accountId);
      if (!account) {
        console.warn('⚠️ Sub account not found:', accountId);
        return;
      }

      console.log('🗑️ Deleting sub account:', accountId);

      // 从父账户的 subAccounts 中移除
      if (account.parentId) {
        const parentAccount = await this.getAccount(account.parentId);
        if (parentAccount && parentAccount.subAccounts) {
          parentAccount.subAccounts = parentAccount.subAccounts.filter(id => id !== accountId);
          await this.updateAccount(parentAccount);
        }
      }

      // 删除账户
      const accounts = await this.getAllAccounts();
      delete accounts[accountId];
      await chrome.storage.local.set({ [this.ACCOUNTS_KEY]: accounts });

      console.log('✅ Sub account deleted:', accountId);
    } catch (error) {
      console.error('❌ Delete sub account failed:', error);
      throw error;
    }
  },

  // 获取账户的私钥（需要密码）
  async getAccountPrivateKey(accountId, password) {
    try {
      const account = await this.getAccount(accountId);
      if (!account) {
        throw new Error('账户不存在');
      }

      console.log('🔐 Getting private key for account:', {
        accountId,
        type: account.type,
        derivationPath: account.derivationPath,
        address: account.address
      });

      // 如果是导入的账户，直接解密私钥
      if (account.type === 'imported') {
        return await Utils.decryptString(account.encryptedPrivateKey, password);
      }

      // 如果是主账户或子账户，从助记词派生
      let mnemonic;
      let derivationPath;

      if (account.type === 'main') {
        mnemonic = await Utils.decryptString(account.encryptedMnemonic, password);
        derivationPath = account.derivationPath;
      } else if (account.type === 'sub') {
        const parentAccount = await this.getAccount(account.parentId);
        if (!parentAccount) {
          throw new Error('父账户不存在');
        }
        mnemonic = await Utils.decryptString(parentAccount.encryptedMnemonic, password);
        derivationPath = account.derivationPath;
      } else {
        throw new Error('未知的账户类型: ' + account.type);
      }

      // 派生钱包
      const wallet = ethers.Wallet.fromMnemonic(mnemonic, derivationPath);

      console.log('🔐 Derived wallet:', {
        derivationPath,
        derivedAddress: wallet.address,
        expectedAddress: account.address
      });

      // 验证地址
      if (wallet.address.toLowerCase() !== account.address.toLowerCase()) {
        console.error('❌ Address mismatch:', {
          derived: wallet.address,
          expected: account.address,
          derivationPath
        });
        throw new Error('地址验证失败');
      }

      console.log('✅ Private key retrieved successfully');
      return wallet.privateKey;
    } catch (error) {
      console.error('❌ Get account private key failed:', error);
      throw error;
    }
  },

  // 保存网络配置
  async saveNetwork(networkUrl) {
    await chrome.storage.local.set({ network: networkUrl });
  },

  // 获取网络配置
  async getNetwork() {
    const result = await chrome.storage.local.get('network');
    return result.network;
  },

  // 保存 API 密钥
  async saveApiKey(apiKey) {
    await chrome.storage.local.set({ alchemyApiKey: apiKey });
  },

  // 获取 API 密钥
  async getApiKey() {
    const result = await chrome.storage.local.get('alchemyApiKey');
    return result.alchemyApiKey;
  },

  // 检查是否过期
  async isExpired() {
    const result = await chrome.storage.local.get(this.EXPIRE_KEY);
    if (!result[this.EXPIRE_KEY]) return true;
    return Date.now() > result[this.EXPIRE_KEY];
  },

  // 更新过期时间
  async updateExpireTime() {
    const expireTime = Date.now() + (this.DEFAULT_EXPIRE_MINUTES * 60 * 1000);
    await chrome.storage.local.set({
      [this.EXPIRE_KEY]: expireTime
    });
  },

  // 添加授权
  async addAuthorization(origin, address) {
    try {
      const authorizations = await this.getAllAuthorizations();
      authorizations[origin] = {
        address: address,
        timestamp: Date.now()
      };
      await chrome.storage.local.set({ authorizations });
      return true;
    } catch (error) {
      console.error('添加授权失败:', error);
      return false;
    }
  },

  // 检查是否已授权
  async isAuthorized(origin) {
    try {
      const authorizations = await this.getAllAuthorizations();
      return !!authorizations[origin];
    } catch (error) {
      console.error('检查授权失败:', error);
      return false;
    }
  },

  // 获取授权地址
  async getAuthorizedAddress(origin) {
    const result = await chrome.storage.local.get('authorizations');
    const authorizations = result.authorizations || {};
    return authorizations[origin]?.address || null;
  },

  // 撤销授权
  async revokeAuthorization(origin) {
    try {
      const authorizations = await this.getAllAuthorizations();
      delete authorizations[origin];
      await chrome.storage.local.set({ authorizations });
      return true;
    } catch (error) {
      console.error('撤销授权失败:', error);
      return false;
    }
  },

  // 获取所有授权
  async getAllAuthorizations() {
    try {
      const result = await chrome.storage.local.get('authorizations');
      return result.authorizations || {};
    } catch (error) {
      console.error('获取授权列表失败:', error);
      return {};
    }
  },

  // 清除所有授权
  async clearAllAuthorizations() {
    try {
      await chrome.storage.local.set({ authorizations: {} });
      return true;
    } catch (error) {
      console.error('清除授权失败:', error);
      return false;
    }
  },
};

