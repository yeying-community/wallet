/**
 * 网络配置
 */

// ==================== 默认网络 ====================
export const DEFAULT_NETWORK = 'yeying';

// ==================== 网络配置 ====================
export const NETWORKS = {
  yeying: {
    id: 'yeying',
    name: 'YeYing Mainnet',
    rpc: 'https://blockchain.yeying.pub',
    rpcUrl: 'https://blockchain.yeying.pub',
    chainId: 5432,
    chainIdHex: '0x1538',
    symbol: 'YYT',
    decimals: 18,
    explorer: 'https://blockscout.yeying.pub',
    type: 'mainnet',
    isTestnet: false,
    nativeCurrency: {
      name: 'YeYing',
      symbol: 'YYT',
      decimals: 18
    }
  }
};

// ==================== 网络类型 ====================
export const NETWORK_TYPES = {
  MAINNET: 'mainnet',
  TESTNET: 'testnet',
  CUSTOM: 'custom'
};

// ==================== RPC 配置 ====================
export const RPC_CONFIG = {
  TIMEOUT: 30000,              // RPC 请求超时（毫秒）
  MAX_RETRIES: 3,              // 最大重试次数
  RETRY_DELAY: 1000,           // 重试延迟（毫秒）
  BATCH_SIZE: 10,              // 批量请求大小
  CACHE_TTL: 60000            // 缓存生存时间（毫秒）
};

// ==================== 工具函数 ====================

/**
 * 获取网络配置
 * @param {string} networkName - 网络名称
 * @returns {Object|null} 网络配置
 */
export function getNetworkConfig(networkName) {
  return NETWORKS[networkName] || null;
}

/**
 * 获取默认网络配置
 * @returns {Object}
 */
export function getDefaultNetworkConfig() {
  return NETWORKS[DEFAULT_NETWORK];
}

/**
 * 根据 chainId 获取网络
 * @param {string|number} chainId - 链 ID（十进制或十六进制）
 * @returns {Object|null} 网络配置
 */
export function getNetworkByChainId(chainId) {
  const chainIdNum = typeof chainId === 'string' && chainId.startsWith('0x')
    ? parseInt(chainId, 16)
    : parseInt(chainId, 10);

  const networks = Object.values(NETWORKS);
  return networks.find(n => n.chainId === chainIdNum) || null;
}

/**
 * 根据 chainId 获取网络名称
 * @param {string|number} chainId - 链 ID
 * @returns {string|null} 网络名称
 */
export function getNetworkNameByChainId(chainId) {
  const chainIdNum = typeof chainId === 'string' && chainId.startsWith('0x')
    ? parseInt(chainId, 16)
    : parseInt(chainId, 10);

  const entries = Object.entries(NETWORKS);
  const found = entries.find(([_, config]) => config.chainId === chainIdNum);
  return found ? found[0] : null;
}

/**
 * 验证网络是否支持
 * @param {string} networkName - 网络名称
 * @returns {boolean}
 */
export function isNetworkSupported(networkName) {
  return !!NETWORKS[networkName];
}

/**
 * 获取所有支持的网络列表
 * @returns {Array<string>} 网络名称列表
 */
export function getSupportedNetworks() {
  return Object.keys(NETWORKS);
}

/**
 * 获取所有网络配置
 * @returns {Array<Object>} 网络配置列表
 */
export function getAllNetworks() {
  return Object.values(NETWORKS);
}

/**
 * 获取主网列表
 * @returns {Array<Object>}
 */
export function getMainnets() {
  return Object.values(NETWORKS).filter(n => !n.isTestnet);
}

/**
 * 获取测试网列表
 * @returns {Array<Object>}
 */
export function getTestnets() {
  return Object.values(NETWORKS).filter(n => n.isTestnet);
}

/**
 * 格式化网络配置
 * @param {Object} config - 原始配置
 * @returns {Object} 格式化后的配置
 */
export function formatNetworkConfig(config) {
  const chainId = typeof config.chainId === 'string' && config.chainId.startsWith('0x')
    ? parseInt(config.chainId, 16)
    : parseInt(config.chainId, 10);
  
  return {
    id: config.id || config.name.toLowerCase().replace(/\s+/g, '-'),
    name: config.name,
    rpc: config.rpc || config.rpcUrl,
    rpcUrl: config.rpcUrl || config.rpc,
    chainId: chainId,
    chainIdHex: '0x' + chainId.toString(16),
    symbol: config.symbol,
    decimals: config.decimals || 18,
    explorer: config.explorer || '',
    type: config.type || NETWORK_TYPES.CUSTOM,
    isTestnet: config.isTestnet || false,
    nativeCurrency: config.nativeCurrency || {
      name: config.symbol,
      symbol: config.symbol,
      decimals: config.decimals || 18
    }
  };
}

/**
 * 比较两个网络是否相同
 * @param {Object} network1 - 网络1
 * @param {Object} network2 - 网络2
 * @returns {boolean}
 */
export function isSameNetwork(network1, network2) {
  if (!network1 || !network2) return false;
  return network1.chainId === network2.chainId;
}

/**
 * 获取区块浏览器地址 URL
 * @param {string} networkName - 网络名称
 * @param {string} address - 地址
 * @returns {string}
 */
export function getExplorerAddressUrl(networkName, address) {
  const network = getNetworkConfig(networkName);
  if (!network || !network.explorer) return '';
  return `${network.explorer}/address/${address}`;
}

/**
 * 获取区块浏览器交易 URL
 * @param {string} networkName - 网络名称
 * @param {string} txHash - 交易哈希
 * @returns {string}
 */
export function getExplorerTxUrl(networkName, txHash) {
  const network = getNetworkConfig(networkName);
  if (!network || !network.explorer) return '';
  return `${network.explorer}/tx/${txHash}`;
}

/**
 * 获取区块浏览器区块 URL
 * @param {string} networkName - 网络名称
 * @param {string|number} blockNumber - 区块号
 * @returns {string}
 */
export function getExplorerBlockUrl(networkName, blockNumber) {
  const network = getNetworkConfig(networkName);
  if (!network || !network.explorer) return '';
  return `${network.explorer}/block/${blockNumber}`;
}
