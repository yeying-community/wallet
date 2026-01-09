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
import { NetworkMessageType } from '../protocol/protocol.js';
import { BaseDomain } from './base-domain.js';
export { NetworkMessageType };

export class NetworkDomain extends BaseDomain {
  constructor() {
    super();
    this._currentChainId = null;
    this._currentRpcUrl = null;
    this._networks = [];
  }

  // ==================== 网络切换 ====================

  /**
   * 切换网络
   * @param {string} networkKey - 网络键名（如 'mainnet'）或 RPC URL
   * @returns {Promise<Object>} 切换结果
   */
  async switchNetwork(networkKey) {
    if (typeof networkKey === 'string' && (networkKey.startsWith('http') || networkKey.startsWith('https'))) {
      const result = await this._sendMessage(NetworkMessageType.SWITCH_NETWORK, {
        rpcUrl: networkKey
      });

      this._currentRpcUrl = result.rpcUrl || networkKey;
      if (result.chainId) {
        this._currentChainId = result.chainId;
      }

      return result;
    }

    if (networkKey) {
      const result = await this._sendMessage(NetworkMessageType.SWITCH_NETWORK, {
        networkKey
      });

      this._currentChainId = result.chainId || this._currentChainId;
      this._currentRpcUrl = result.rpcUrl || this._currentRpcUrl;
      return result;
    }

    throw new Error('未知网络');
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
   * 添加网络
   * @param {Object} networkInfo - 网络信息
   * @returns {Promise<Object>} 添加结果
   */
  async addNetwork(networkInfo) {
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
    const entry = {
      chainId,
      chainName,
      rpcUrl: rpcUrls[0],
      explorer: blockExplorerUrls?.[0],
      symbol: nativeCurrency?.symbol || 'ETH',
      decimals: nativeCurrency?.decimals || 18
    };
    this._networks.push(entry);

    return result;
  }

  /**
   * 移除网络
   * @param {string} chainId - 链 ID
   * @returns {Promise<Object>} 移除结果
   */
  async removeNetwork(chainId) {
    const result = await this._sendMessage(NetworkMessageType.REMOVE_CUSTOM_NETWORK, {
      chainId
    });

    // 从本地缓存移除
    this._networks = this._networks.filter(n => n.chainId !== chainId);

    return result;
  }

  /**
   * 更新网络
   * @param {string} chainId - 链 ID
   * @param {Object} updates - 更新字段
   * @returns {Promise<Object>} 更新结果
   */
  async updateNetwork(chainId, updates) {
    const result = await this._sendMessage(NetworkMessageType.UPDATE_CUSTOM_NETWORK, {
      chainId,
      ...updates
    });

    this._networks = this._networks.map(n => {
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
      try {
        const info = await this.getNetworkInfo();
        return info?.rpcUrl || info?.rpc || '';
      } catch {
        return '';
      }
    }
  }

  /**
   * 获取当前网络信息
   * @returns {Promise<Object>} 网络信息
   */
  async getNetworkInfo() {
    try {
      const result = await this._sendMessage(NetworkMessageType.GET_NETWORK_INFO);
      if (result?.network) {
        return result.network;
      }
    } catch (error) {
      console.error('[NetworkDomain] 获取网络信息失败:', error);
    }

    const chainId = await this.getChainId();
    const rpcUrl = await this.getRpcUrl();
    return { chainId, rpcUrl, isCustom: true };
  }

  /**
   * 获取所有支持的网络
   * @returns {Array} 网络列表
   */
  async getNetworks() {
    try {
      const result = await this._sendMessage(NetworkMessageType.GET_SUPPORTED_NETWORKS);
      this._networks = result.networks || [];
      return this._networks;
    } catch (error) {
      console.error('[NetworkDomain] 获取支持网络失败:', error);
      return this._networks;
    }
  }

  /**
   * 获取网络列表（兼容旧接口）
   * @returns {Promise<Array>}
   */
  async getCustomNetworks() {
    return await this.getNetworks();
  }

  /**
   * 获取网络列表（兼容旧接口）
   * @returns {Promise<Array>}
   */
  async getSupportedNetworks() {
    return await this.getNetworks();
  }

  // ==================== 工具方法 ====================

  /**
   * 获取网络显示名称
   * @param {string} chainId - 链 ID
   * @returns {string} 显示名称
   */
  getNetworkDisplayName(chainId) {
    const network = this._networks.find(n => n.chainId === chainId || n.chainIdHex === chainId);
    if (network) {
      return network.name || network.chainName || '网络';
    }
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
