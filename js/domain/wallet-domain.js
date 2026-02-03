/**
 * 钱包域 - 封装钱包相关操作
 * 
 * 职责：
 * 1. 钱包创建、导入、导出
 * 2. 账户管理（创建子账户、切换、删除）
 * 3. 密钥导出（私钥、助记词）
 * 4. 授权网站管理
 * 
 * 通信协议：{ type, data }
 */

import { WalletMessageType } from '../protocol/extension-protocol.js';
import { validateAccountName } from '../config/validation-rules.js';
import { BaseDomain } from './base-domain.js';
import { getTimestamp } from '../common/utils/time-utils.js';
export { WalletMessageType };

export class WalletDomain extends BaseDomain {
  constructor() {
    super();
    this._currentAccount = null;
    this._accounts = [];
  }

  // ==================== 状态管理 ====================

  /**
   * 检查钱包是否已初始化
   * @returns {boolean} 是否已初始化
   */
  async isInitialized() {
    try {
      const result = await this._sendMessage(WalletMessageType.IS_WALLET_INITIALIZED);
      return result.initialized;
    } catch (error) {
      console.error('[WalletDomain] 检查初始化状态失败:', error);
      return false;
    }
  }

  /**
   * 获取钱包状态
   * @returns {Promise<Object>} 钱包状态
   */
  async getWalletState() {
    const result = await this._sendMessage(WalletMessageType.GET_WALLET_STATE);
    return {
      unlocked: result.unlocked,
      chainId: result.chainId,
      lastUnlockRequest: result.lastUnlockRequest || null
    };
  }

  /**
   * 获取账户余额（ETH）
   * @param {string} address - 地址
   * @returns {Promise<string>} 余额字符串
   */
  async getBalance(address) {
    if (!address) {
      throw new Error('地址不能为空');
    }

    const result = await this._sendMessage(WalletMessageType.GET_BALANCE, {
      address
    });

    return result.balance;
  }

  // ==================== 钱包创建 ====================

  /**
   * 创建 HD 钱包
   * @param {string} accountName - 账户名称
   * @param {string} password - 密码
   * @returns {Promise<Object>} 创建结果
   */
  async createHDWallet(accountName, password) {
    if (!password || password.length < 8) {
      throw new Error('密码至少需要8位字符');
    }

    const result = await this._sendMessage(WalletMessageType.CREATE_HD_WALLET, {
      accountName: accountName || '主钱包',
      password
    });

    this._currentAccount = result.account;
    return result;
  }

  /**
   * 从助记词导入钱包
   * @param {string} accountName - 账户名称
   * @param {string} mnemonic - 助记词
   * @param {string} password - 密码
   * @returns {Promise<Object>} 导入结果
   */
  async importFromMnemonic(accountName, mnemonic, password) {
    if (!mnemonic || mnemonic.trim().split(' ').length < 12) {
      throw new Error('助记词无效，至少需要12个单词');
    }

    if (!password || password.length < 8) {
      throw new Error('密码至少需要8位字符');
    }

    const result = await this._sendMessage(WalletMessageType.IMPORT_HD_WALLET, {
      accountName: accountName || '导入钱包',
      mnemonic: mnemonic.trim(),
      password
    });

    this._currentAccount = result.account;
    return result;
  }

  /**
   * 从私钥导入钱包
   * @param {string} accountName - 账户名称
   * @param {string} privateKey - 私钥
   * @param {string} password - 密码
   * @returns {Promise<Object>} 导入结果
   */
  async importFromPrivateKey(accountName, privateKey, password) {
    if (!privateKey || !privateKey.startsWith('0x')) {
      throw new Error('私钥格式无效，需要以 0x 开头');
    }

    if (!password || password.length < 8) {
      throw new Error('密码至少需要8位字符');
    }

    const result = await this._sendMessage(WalletMessageType.IMPORT_PRIVATE_KEY_WALLET, {
      accountName: accountName || '导入钱包',
      privateKey: privateKey.trim(),
      password
    });

    this._currentAccount = result.account;
    return result;
  }

  // ==================== 账户管理 ====================

  /**
   * 创建子账户
   * @param {string} walletId - 钱包 ID
   * @param {string} accountName - 账户名称
   * @param {string} password - 密码
   * @returns {Promise<Object>} 创建结果
   */
  async createSubAccount(walletId, accountName, password) {
    const result = await this._sendMessage(WalletMessageType.CREATE_SUB_ACCOUNT, {
      walletId,
      accountName: accountName || `账户 ${getTimestamp()}`,
      password
    });

    return result;
  }

  /**
   * 切换账户
   * @param {string} accountId - 账户 ID
   * @param {string} password - 密码（如果需要解锁）
   * @returns {Promise<Object>} 切换结果
   */
  async switchAccount(accountId, password) {
    const result = await this._sendMessage(WalletMessageType.SWITCH_ACCOUNT, {
      accountId,
      password
    });

    this._currentAccount = result.account;
    return result;
  }

  /**
   * 删除账户
   * @param {string} accountId - 账户 ID
   * @param {string} password - 密码
   * @returns {Promise<Object>} 删除结果
   */
  async deleteAccount(accountId, password) {
    const result = await this._sendMessage(WalletMessageType.DELETE_ACCOUNT, {
      accountId,
      password
    });

    // 如果删除的是当前账户，清除缓存
    if (this._currentAccount?.id === accountId) {
      this._currentAccount = null;
    }

    return result;
  }

  /**
   * 更新账户名称
   * @param {string} accountId - 账户 ID
   * @param {string} newName - 新名称
   * @returns {Promise<Object>} 更新结果
   */
  async updateAccountName(accountId, newName) {
    if (!accountId) {
      throw new Error('缺少账户 ID');
    }
    const trimmedName = (newName || '').trim();
    const nameValidation = validateAccountName(trimmedName);
    if (!nameValidation.valid) {
      throw new Error(nameValidation.error || '账户名称不合法');
    }

    const result = await this._sendMessage(WalletMessageType.UPDATE_ACCOUNT_NAME, {
      accountId,
      newName: trimmedName
    });

    if (this._currentAccount?.id === accountId) {
      this._currentAccount = {
        ...this._currentAccount,
        name: trimmedName
      };
    }

    return result;
  }

  // ==================== 获取账户信息 ====================

  /**
   * 获取当前账户
   * @returns {Promise<Object|null>} 当前账户
   */
  async getCurrentAccount() {
    // 优先返回缓存
    if (this._currentAccount) {
      return this._currentAccount;
    }

    try {
      const result = await this._sendMessage(WalletMessageType.GET_CURRENT_ACCOUNT);
      this._currentAccount = result.account;
      return this._currentAccount;
    } catch (error) {
      console.error('[WalletDomain] 获取当前账户失败:', error);
      return null;
    }
  }

  /**
   * 获取所有钱包
   * @returns {Promise<Array>} 钱包列表
   */
  async getWalletList() {
    try {
      const result = await this._sendMessage(WalletMessageType.GET_ALL_WALLETS);
      return result.wallets || [];
    } catch (error) {
      console.error('[WalletDomain] 获取账户列表失败:', error);
      return [];
    }
  }

  /**
   * 根据 ID 获取账户
   * @param {string} accountId - 账户 ID
   * @returns {Promise<Object|null>} 账户信息
   */
  async getAccountById(accountId) {
    try {
      const result = await this._sendMessage(WalletMessageType.GET_ACCOUNT_BY_ID, {
        accountId
      });
      return result.account;
    } catch (error) {
      console.error('[WalletDomain] 获取账户失败:', error);
      return null;
    }
  }

  // ==================== 解锁/锁定 ====================

  /**
   * 解锁钱包
   * @param {string} password - 密码
   * @param {string} accountId - 可选的账户 ID
   * @returns {Promise<Object>} 解锁结果
   */
  async unlock(password, accountId) {
    if (!password || password.length < 8) {
      throw new Error('密码至少需要8位字符');
    }

    const result = await this._sendMessage(WalletMessageType.UNLOCK_WALLET, {
      password,
      accountId
    });

    this._currentAccount = result.account;
    return result;
  }

  /**
   * 锁定钱包
   * @returns {Promise<Object>} 锁定结果
   */
  async lock() {
    const result = await this._sendMessage(WalletMessageType.LOCK_WALLET);
    this._currentAccount = null;
    return result;
  }

  // ==================== 密钥导出 ====================

  /**
   * 导出私钥
   * @param {string} accountId - 账户 ID
   * @param {string} password - 密码
   * @returns {Promise<string>} 私钥
   */
  async exportPrivateKey(accountId, password) {
    if (!password || password.length < 8) {
      throw new Error('密码至少需要8位字符');
    }

    const result = await this._sendMessage(WalletMessageType.EXPORT_PRIVATE_KEY, {
      accountId,
      password
    });

    return result.privateKey;
  }

  /**
   * 导出助记词
   * @param {string} walletId - 钱包 ID
   * @param {string} password - 密码
   * @returns {Promise<string>} 助记词
   */
  async exportMnemonic(walletId, password) {
    if (!password || password.length < 8) {
      throw new Error('密码至少需要8位字符');
    }

    const result = await this._sendMessage(WalletMessageType.EXPORT_MNEMONIC, {
      walletId,
      password
    });

    return result.mnemonic;
  }

  // ==================== 密码管理 ====================

  /**
   * 修改密码
   * @param {string} oldPassword - 旧密码
   * @param {string} newPassword - 新密码
   * @returns {Promise<Object>} 修改结果
   */
  async changePassword(oldPassword, newPassword) {
    if (!oldPassword || oldPassword.length < 8) {
      throw new Error('旧密码至少需要8位字符');
    }

    if (!newPassword || newPassword.length < 8) {
      throw new Error('新密码至少需要8位字符');
    }

    if (oldPassword === newPassword) {
      throw new Error('新密码不能与旧密码相同');
    }

    return await this._sendMessage(WalletMessageType.CHANGE_PASSWORD, {
      oldPassword,
      newPassword
    });
  }

  // ==================== 授权管理 ====================

  /**
   * 获取授权网站列表
   * @returns {Promise<Array>} 授权网站列表
   */
  async getAuthorizedSites() {
    try {
      const result = await this._sendMessage(WalletMessageType.GET_AUTHORIZED_SITES);
      return result.sites || [];
    } catch (error) {
      console.error('[WalletDomain] 获取授权网站失败:', error);
      return [];
    }
  }

  /**
   * 获取指定网站的 UCAN 会话信息
   * @param {string} origin - 网站 origin
   * @param {string} address - 地址
   * @returns {Promise<Object|null>} UCAN 会话
   */
  async getSiteUcanSession(origin, address) {
    try {
      const result = await this._sendMessage(WalletMessageType.GET_SITE_UCAN_SESSION, {
        origin,
        address
      });
      return result.session || null;
    } catch (error) {
      console.error('[WalletDomain] 获取 UCAN 会话失败:', error);
      return null;
    }
  }

  /**
   * 撤销网站授权
   * @param {string} origin - 网站 origin
   * @returns {Promise<Object>} 撤销结果
   */
  async revokeSite(origin) {
    return await this._sendMessage(WalletMessageType.REVOKE_SITE, { origin });
  }

  /**
   * 清除所有授权
   * @returns {Promise<Object>} 清除结果
   */
  async clearAllAuthorizations() {
    return await this._sendMessage(WalletMessageType.CLEAR_ALL_AUTHORIZATIONS);
  }

  // ==================== 联系人管理 ====================

  /**
   * 获取联系人列表
   * @returns {Promise<Array>}
   */
  async getContacts() {
    const result = await this._sendMessage(WalletMessageType.GET_CONTACTS);
    return result.contacts || [];
  }

  /**
   * 添加联系人
   * @param {Object} contact - { name, address, note }
   * @returns {Promise<Object>}
   */
  async addContact(contact) {
    return await this._sendMessage(WalletMessageType.ADD_CONTACT, contact);
  }

  /**
   * 更新联系人
   * @param {Object} contact - { id, name?, address?, note? }
   * @returns {Promise<Object>}
   */
  async updateContact(contact) {
    return await this._sendMessage(WalletMessageType.UPDATE_CONTACT, contact);
  }

  /**
   * 删除联系人
   * @param {string} id
   * @returns {Promise<Object>}
   */
  async deleteContact(id) {
    return await this._sendMessage(WalletMessageType.DELETE_CONTACT, { id });
  }

  // ==================== Backup & Sync ====================

  /**
   * 获取 Backup & Sync 配置
   * @returns {Promise<Object>}
   */
  async getBackupSyncSettings() {
    const result = await this._sendMessage(WalletMessageType.GET_BACKUP_SYNC_SETTINGS);
    return result.settings || {};
  }

  /**
   * 更新 Backup & Sync 配置
   * @param {Object} updates
   * @returns {Promise<Object>}
   */
  async updateBackupSyncSettings(updates) {
    return await this._sendMessage(WalletMessageType.UPDATE_BACKUP_SYNC_SETTINGS, { updates });
  }

  /**
   * 立即触发同步
   * @returns {Promise<Object>}
   */
  async backupSyncNow() {
    return await this._sendMessage(WalletMessageType.BACKUP_SYNC_NOW);
  }

  /**
   * 清除远端备份
   * @returns {Promise<Object>}
   */
  async backupSyncClearRemote() {
    return await this._sendMessage(WalletMessageType.BACKUP_SYNC_CLEAR_REMOTE);
  }

  /**
   * 清空同步日志
   * @returns {Promise<Object>}
   */
  async backupSyncClearLogs() {
    return await this._sendMessage(WalletMessageType.BACKUP_SYNC_CLEAR_LOGS);
  }

  /**
   * 解决同步冲突
   * @param {Object} options - { id, action }
   * @returns {Promise<Object>}
   */
  async resolveBackupSyncConflict(options = {}) {
    return await this._sendMessage(WalletMessageType.RESOLVE_BACKUP_SYNC_CONFLICT, options);
  }

  // ==================== 重置 ====================

  /**
   * 重置钱包
   * @returns {Promise<Object>} 重置结果
   */
  async resetWallet() {
    const result = await this._sendMessage(WalletMessageType.RESET_WALLET);
    this._currentAccount = null;
    this._accounts = [];
    return result;
  }
}
