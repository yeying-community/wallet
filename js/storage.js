// 本地存储模块
const Storage = {

  WALLET_KEY: 'web3_wallet_encrypted',
  MNEMONIC_KEY: 'web3_wallet_mnemonic_encrypted',
  PASSWORD_KEY: 'web3_wallet_password_hash',
  EXPIRE_KEY: 'web3_wallet_expire_time',
  DEFAULT_EXPIRE_MINUTES: 30, // 默认30分钟过期

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

  // 使用密码加密私钥/助记词
  async encryptString(dataString, password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(dataString);
    const passwordData = encoder.encode(password);

    // 生成密钥
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordData,
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    const salt = crypto.getRandomValues(new Uint8Array(16));

    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      data
    );

    // 返回加密数据和盐值、IV
    return {
      encrypted: Array.from(new Uint8Array(encrypted)),
      salt: Array.from(salt),
      iv: Array.from(iv)
    };
  },

  // 使用密码解密字符串（私钥/助记词通用）
  async decryptString(encryptedData, password) {
    const encoder = new TextEncoder();
    const passwordData = encoder.encode(password);

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordData,
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new Uint8Array(encryptedData.salt),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(encryptedData.iv)
      },
      key,
      new Uint8Array(encryptedData.encrypted)
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  },

  // 保存加密的钱包
  async saveEncryptedWallet(privateKey, password, mnemonic) {
    const encryptedPrivateKey = await this.encryptString(privateKey, password);
    const encryptedMnemonic = await this.encryptString(mnemonic, password);
    const expireTime = Date.now() + (this.DEFAULT_EXPIRE_MINUTES * 60 * 1000);

    await chrome.storage.local.set({
      [this.WALLET_KEY]: encryptedPrivateKey,
      [this.MNEMONIC_KEY]: encryptedMnemonic,
      [this.EXPIRE_KEY]: expireTime,
    });
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

  // 获取加密的私钥数据
  async getEncryptedPrivateKey() {
    const result = await chrome.storage.local.get(this.WALLET_KEY);
    return result[this.WALLET_KEY];
  },

  // 获取加密的助记词数据
  async getEncryptedMnemonic() {
    const result = await chrome.storage.local.get(this.MNEMONIC_KEY);
    return result[this.MNEMONIC_KEY];
  },

  // 删除钱包（同时删除助记词）
  async removeWallet() {
    await chrome.storage.local.remove([
      this.WALLET_KEY,
      this.MNEMONIC_KEY,
      this.EXPIRE_KEY
    ]);
  },

  // 检查是否有钱包
  async hasWallet() {
    const result = await chrome.storage.local.get(this.WALLET_KEY);
    return !!result[this.WALLET_KEY];
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
  }
};

