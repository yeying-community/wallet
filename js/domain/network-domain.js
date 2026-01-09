/**
 * 网络域 - 封装网络相关操作
 * 
 * 职责：
 * 1. 网络切换
 * 2. 网络信息查询
 * 3. RPC URL 管理
 * 
 * 通信协议：{ type, data }
 */
import { NETWORKS } from "../config/index.js";
import { NetworkMessageType } from '../protocol/protocol.js';
export { NetworkMessageType };

export class NetworkDomain {
  constructor() {
    this._currentChainId = null;
    this._currentRpcUrl = null;
    this._customNetworks = [];
  }

  // ==================== 消息发送 ====================

  /**
   * 发送消息到 background
   * @param {string} type - 消息类型
   * @param {Object} data - 消息数据
   * @returns {Promise<Object>} 响应结果
   */
  async _sendMessage(type, data = {}) {
    return new Promise((resolve, reject) => {
      if (typeof browser !== 'undefined') {
        browser.runtime.sendMessage({ type, data })
          .then(response => {
            if (response?.success === false) {
              reject(new Error(response.error || '操作失败'));
            } else {
              resolve(response);
            }
          })
          .catch(error => {
            reject(error);
          });
      } else if (typeof chrome !== 'undefined') {
        chrome.runtime.sendMessage({ type, data }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response?.success === false) {
            reject(new Error(response.error || '操作失败'));
          } else {
            resolve(response);
          }
        });
      } else {
        reject(new Error('不支持的浏览器环境'));
      }
    });
  }

  // ==================== 网络切换 ====================

  /**
   * 切换网络
   * @param {string} networkKey - 网络键名（如 'mainnet'）或 RPC URL
   * @returns {Promise<Object>} 切换结果
   */
  async switchNetwork(networkKey) {
    // 检查是否是预设网络
    if (NETWORKS[networkKey]) {
      const network = NETWORKS[networkKey];
      
      const result = await this._sendMessage(NetworkMessageType.SWITCH_NETWORK, {
        chainId: network.chainId,
        rpcUrl: network.rpcUrl,
        networkKey
      });

      this._currentChainId = result.chainId || network.chainId;
      this._currentRpcUrl = result.rpcUrl || network.rpcUrl;
      
      return result;
    }

    // 可能是自定义网络或直接使用 RPC URL
    if (networkKey.startsWith('http') || networkKey.startsWith('https')) {
      const result = await this._sendMessage(NetworkMessageType.SWITCH_NETWORK, {
        rpcUrl: networkKey
      });

      this._currentRpcUrl = result.rpcUrl || networkKey;
      if (result.chainId) {
        this._currentChainId = result.chainId;
      }

      return result;
    }

    throw new Error(`未知网络: ${networkKey}`);
  }

  /**
   * 设置 RPC URL（兼容旧接口）
   * @param {string} rpcUrl - RPC URL
   * @returns {Promise<Object>} 切换结果
   */
  async setRpcUrl(rpcUrl) {
    if (!rpcUrl) {
      throw new Error('rpcUrl is required');
    }

    const result = await this._sendMessage(NetworkMessageType.SWITCH_NETWORK, {
      rpcUrl
    });

    this._currentRpcUrl = result.rpcUrl || rpcUrl;
    if (result.chainId) {
      this._currentChainId = result.chainId;
    }

    return result;
  }

  /**
   * 添加自定义网络
   * @param {Object} networkInfo - 网络信息
   * @returns {Promise<Object>} 添加结果
   */
  async addCustomNetwork(networkInfo) {
    const { chainName, chainId, rpcUrls, blockExplorerUrls, nativeCurrency } = networkInfo;

    // 验证必要参数
    if (!chainId) {
      throw new Error('缺少 chainId');
    }

    if (!rpcUrls || !rpcUrls[0]) {
      throw new Error('缺少 RPC URL');
    }

    const result = await this._sendMessage(NetworkMessageType.ADD_CUSTOM_NETWORK, {
      chainName,
      chainId,
      rpcUrl: rpcUrls[0],
      explorer: blockExplorerUrls?.[0],
      symbol: nativeCurrency?.symbol || 'ETH',
      decimals: nativeCurrency?.decimals || 18
    });

    // 添加到本地缓存
    this._customNetworks.push({
      chainId,
      chainName,
      rpcUrl: rpcUrls[0],
      explorer: blockExplorerUrls?.[0],
      symbol: nativeCurrency?.symbol || 'ETH',
      decimals: nativeCurrency?.decimals || 18
    });

    return result;
  }

  /**
   * 移除自定义网络
   * @param {string} chainId - 链 ID
   * @returns {Promise<Object>} 移除结果
   */
  async removeCustomNetwork(chainId) {
    const result = await this._sendMessage(NetworkMessageType.REMOVE_CUSTOM_NETWORK, {
      chainId
    });

    // 从本地缓存移除
    this._customNetworks = this._customNetworks.filter(n => n.chainId !== chainId);

    return result;
  }

  /**
   * 更新自定义网络
   * @param {string} chainId - 链 ID
   * @param {Object} updates - 更新字段
   * @returns {Promise<Object>} 更新结果
   */
  async updateCustomNetwork(chainId, updates) {
    const result = await this._sendMessage(NetworkMessageType.UPDATE_CUSTOM_NETWORK, {
      chainId,
      ...updates
    });

    this._customNetworks = this._customNetworks.map(n => {
      if (n.chainId !== chainId) return n;
      return { ...n, ...updates };
    });

    return result;
  }

  // ==================== 查询操作 ====================

  /**
   * 获取当前链 ID
   * @returns {Promise<string>} 链 ID（十六进制）
   */
  async getChainId() {
    // 优先返回缓存
    if (this._currentChainId) {
      return this._currentChainId;
    }

    try {
      const result = await this._sendMessage(NetworkMessageType.GET_CURRENT_CHAIN_ID);
      this._currentChainId = result.chainId;
      return this._currentChainId;
    } catch (error) {
      console.error('[NetworkDomain] 获取链 ID 失败:', error);
      return '0x1'; // 默认返回主网
    }
  }

  /**
   * 获取当前 RPC URL
   * @returns {Promise<string>} RPC URL
   */
  async getRpcUrl() {
    // 优先返回缓存
    if (this._currentRpcUrl) {
      return this._currentRpcUrl;
    }

    try {
      const result = await this._sendMessage(NetworkMessageType.GET_CURRENT_RPC_URL);
      this._currentRpcUrl = result.rpcUrl;
      return this._currentRpcUrl;
    } catch (error) {
      console.error('[NetworkDomain] 获取 RPC URL 失败:', error);
      return NETWORKS.mainnet.rpcUrl;
    }
  }

  /**
   * 获取当前网络信息
   * @returns {Promise<Object>} 网络信息
   */
  async getNetworkInfo() {
    const chainId = await this.getChainId();
    const rpcUrl = await this.getRpcUrl();

    // 检查是否是预设网络
    for (const [key, network] of Object.entries(NETWORKS)) {
      if (network.chainId === chainId) {
        return {
          key,
          ...network,
          isCustom: false
        };
      }
    }

    // 检查是否是自定义网络
    const customNetwork = this._customNetworks.find(n => n.chainId === chainId);
    if (customNetwork) {
      return {
        ...customNetwork,
        isCustom: true
      };
    }

    // 返回基本信息
    return {
      chainId,
      rpcUrl,
      isCustom: true
    };
  }

  /**
   * 获取所有支持的网络
   * @returns {Array} 网络列表
   */
  getSupportedNetworks() {
    return Object.entries(NETWORKS).map(([key, network]) => ({
      key,
      ...network,
      isCustom: false
    }));
  }

  /**
   * 获取自定义网络列表
   * @returns {Promise<Array>} 自定义网络列表
   */
  async getCustomNetworks() {
    try {
      const result = await this._sendMessage(NetworkMessageType.GET_CUSTOM_NETWORKS);
      this._customNetworks = result.networks || [];
      return this._customNetworks;
    } catch (error) {
      console.error('[NetworkDomain] 获取自定义网络失败:', error);
      return this._customNetworks;
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 获取网络显示名称
   * @param {string} chainId - 链 ID
   * @returns {string} 显示名称
   */
  getNetworkDisplayName(chainId) {
    // 检查预设网络
    for (const [key, network] of Object.entries(NETWORKS)) {
      if (network.chainId === chainId) {
        return network.name;
      }
    }

    // 检查自定义网络
    const customNetwork = this._customNetworks.find(n => n.chainId === chainId);
    if (customNetwork) {
      return customNetwork.chainName || '自定义网络';
    }

    // 返回链 ID
    return `Chain ${parseInt(chainId, 16)}`;
  }

  /**
   * 检查是否是主网
   * @param {string} chainId - 链 ID
   * @returns {boolean} 是否是主网
   */
  isMainnet(chainId) {
    return chainId === '0x1';
  }

  /**
   * 检查是否是测试网
   * @param {string} chainId - 链 ID
   * @returns {boolean} 是否是测试网
   */
  isTestnet(chainId) {
    const testnetChainIds = ['0x5', '0xaa36a7', '0x13881']; // Goerli, Sepolia, Mumbai
    return testnetChainIds.includes(chainId);
  }

  /**
   * 格式化链 ID 显示
   * @param {string} chainId - 链 ID（十六进制）
   * @returns {string} 格式化的链 ID
   */
  formatChainId(chainId) {
    const decimalId = parseInt(chainId, 16);
    return `${decimalId} (${chainId})`;
  }

  /**
   * 获取网络图标颜色
   * @param {string} chainId - 链 ID
   * @returns {string} 颜色代码
   */
  getNetworkColor(chainId) {
    const colorMap = {
      '0x1': '#627EEA',      // Ethereum - 蓝色
      '0x89': '#8247E5',     // Polygon - 紫色
      '0xa4b1': '#28A0F0',   // Arbitrum - 蓝色
      '0xa': '#FF0420',      // Optimism - 红色
      '0x38': '#F0B90B',     // BSC - 黄色
      '0xaa36a7': '#627EEA', // Sepolia - 蓝色（测试网）
      '0x5': '#627EEA'       // Goerli - 蓝色（测试网）
    };
    return colorMap[chainId] || '#808080';
  }
}
