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
  },
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum Mainnet',
    rpc: 'https://ethereum-rpc.publicnode.com',
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
    chainId: 1,
    chainIdHex: '0x1',
    symbol: 'ETH',
    decimals: 18,
    explorer: 'https://etherscan.io',
    type: 'mainnet',
    isTestnet: false,
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
      icon: 'assets/token-icons/source-official/ethereum.svg'
    }
  },
  sepolia: {
    id: 'sepolia',
    name: 'Ethereum Sepolia',
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    chainId: 11155111,
    chainIdHex: '0xaa36a7',
    symbol: 'ETH',
    decimals: 18,
    explorer: 'https://sepolia.etherscan.io',
    type: 'testnet',
    isTestnet: true,
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'ETH',
      decimals: 18,
      icon: 'assets/token-icons/source-official/ethereum.svg'
    }
  },
  'polygon-amoy': {
    id: 'polygon-amoy',
    name: 'Polygon Amoy',
    rpc: 'https://polygon-amoy-bor-rpc.publicnode.com',
    rpcUrl: 'https://polygon-amoy-bor-rpc.publicnode.com',
    chainId: 80002,
    chainIdHex: '0x13882',
    symbol: 'POL',
    decimals: 18,
    explorer: 'https://amoy.polygonscan.com',
    type: 'testnet',
    isTestnet: true,
    nativeCurrency: {
      name: 'Polygon',
      symbol: 'POL',
      decimals: 18
    }
  },
  'bsc-testnet': {
    id: 'bsc-testnet',
    name: 'BNB Smart Chain Testnet',
    rpc: 'https://bsc-testnet-rpc.publicnode.com',
    rpcUrl: 'https://bsc-testnet-rpc.publicnode.com',
    chainId: 97,
    chainIdHex: '0x61',
    symbol: 'tBNB',
    decimals: 18,
    explorer: 'https://testnet.bscscan.com',
    type: 'testnet',
    isTestnet: true,
    nativeCurrency: {
      name: 'Test BNB',
      symbol: 'tBNB',
      decimals: 18
    }
  },
  // ===== Tron（v1：secp256k1 / native TRX only；TRC20 不在 v1 范围）=====
  // chainKey 用 CAIP-2 `tron:<reference>`，无 chainId/chainIdHex 字段；
  // Tron adapter 通过 namespace=tron + reference 字段识别。
  tronMainnet: {
    id: 'tronMainnet',
    name: 'Tron Mainnet',
    rpc: 'https://api.trongrid.io',
    rpcUrl: 'https://api.trongrid.io',
    tronRpcUrl: 'https://api.trongrid.io',
    symbol: 'TRX',
    decimals: 6,
    explorer: 'https://tronscan.org',
    type: 'mainnet',
    isTestnet: false,
    namespace: 'tron',
    reference: 'mainnet',
    chainKey: 'tron:mainnet',
    nativeCurrency: {
      name: 'TRX',
      symbol: 'TRX',
      decimals: 6
    }
  },
  tronShasta: {
    id: 'tronShasta',
    name: 'Tron Shasta Testnet',
    rpc: 'https://api.shasta.trongrid.io',
    rpcUrl: 'https://api.shasta.trongrid.io',
    tronRpcUrl: 'https://api.shasta.trongrid.io',
    symbol: 'TRX',
    decimals: 6,
    explorer: 'https://shasta.tronscan.org',
    type: 'testnet',
    isTestnet: true,
    namespace: 'tron',
    reference: 'shasta',
    chainKey: 'tron:shasta',
    nativeCurrency: {
      name: 'Test TRX',
      symbol: 'TRX',
      decimals: 6
    }
  },
  tronNile: {
    id: 'tronNile',
    name: 'Tron Nile Testnet',
    rpc: 'https://api.nile.trongrid.io',
    rpcUrl: 'https://api.nile.trongrid.io',
    tronRpcUrl: 'https://api.nile.trongrid.io',
    symbol: 'TRX',
    decimals: 6,
    explorer: 'https://nile.tronscan.io',
    type: 'testnet',
    isTestnet: true,
    namespace: 'tron',
    reference: 'nile',
    chainKey: 'tron:nile',
    nativeCurrency: {
      name: 'Test TRX',
      symbol: 'TRX',
      decimals: 6
    }
  }
};

// ==================== 内置通证配置 ====================
export const BUILTIN_TOKENS_BY_CHAIN_ID = {
  '0x1': [
    {
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      chainId: '0x1',
      image: 'assets/token-icons/source-official/usdc.svg',
      builtin: true
    },
    {
      address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      chainId: '0x1',
      image: 'assets/token-icons/source-official/usdt.svg',
      builtin: true
    }
  ]
};

// ==================== 网络类型 ====================
export const NETWORK_TYPES = {
  MAINNET: 'mainnet',
  TESTNET: 'testnet',
  CUSTOM: 'custom'
};

// ==================== RPC 配置 ====================
export const RPC_CONFIG = {
  TIMEOUT: 8000,               // RPC 请求超时（毫秒）
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
  return networks.find(n => typeof n.chainId === 'number' && n.chainId === chainIdNum) || null;
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
  const raw = config && typeof config === 'object' ? config : {};
  const ns = String(raw.namespace || '').toLowerCase();

  // Tron / non-EVM 网络（namespace=tron 等）没有 EVM 数字 chainId；
  // 直接 return chainKey 形式，跳过 chainId 数字转换。
  if (ns === 'tron') {
    const reference = String(raw.reference || '').toLowerCase();
    if (!reference) {
      throw new Error('Tron network config requires reference');
    }
    return {
      id: raw.id || `tron-${reference}`,
      name: raw.name || `Tron ${capitalize(reference)}`,
      rpc: raw.rpc || raw.rpcUrl || '',
      rpcUrl: raw.rpcUrl || raw.rpc || '',
      tronRpcUrl: raw.tronRpcUrl || raw.rpcUrl || raw.rpc || '',
      symbol: raw.symbol || 'TRX',
      decimals: raw.decimals || 6,
      explorer: raw.explorer || '',
      type: raw.type || NETWORK_TYPES.CUSTOM,
      isTestnet: raw.isTestnet || false,
      namespace: 'tron',
      reference,
      chainKey: raw.chainKey || `tron:${reference}`,
      nativeCurrency: raw.nativeCurrency || {
        name: raw.symbol || 'TRX',
        symbol: raw.symbol || 'TRX',
        decimals: raw.decimals || 6
      }
    };
  }

  // EVM 网络：保持原有数字 chainId 路径
  const chainId = typeof raw.chainId === 'string' && raw.chainId.startsWith('0x')
    ? parseInt(raw.chainId, 16)
    : parseInt(raw.chainId, 10);

  return {
    id: raw.id || (raw.name || '').toLowerCase().replace(/\s+/g, '-'),
    name: raw.name,
    rpc: raw.rpc || raw.rpcUrl,
    rpcUrl: raw.rpcUrl || raw.rpc,
    chainId: chainId,
    chainIdHex: '0x' + chainId.toString(16),
    symbol: raw.symbol,
    decimals: raw.decimals || 18,
    explorer: raw.explorer || '',
    type: raw.type || NETWORK_TYPES.CUSTOM,
    isTestnet: raw.isTestnet || false,
    nativeCurrency: raw.nativeCurrency || {
      name: raw.symbol,
      symbol: raw.symbol,
      decimals: raw.decimals || 18
    }
  };
}

/**
 * @param {string} s
 * @returns {string}
 */
function capitalize(s) {
  const str = String(s || '');
  return str ? str[0].toUpperCase() + str.slice(1) : '';
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
