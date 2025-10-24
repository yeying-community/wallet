// 配置文件
const Config = {
  // 应用信息
  APP_NAME: 'YeYing Wallet',
  VERSION: '1.0.0',

  // 默认网络
  DEFAULT_NETWORK: 'https://blockchain.yeying.pub',

  // 网络配置
  NETWORKS: {
    'sepolia': {
      name: 'YeYing Network',
      rpc: 'https://rpc.sepolia.org',
      chainId: 11155111,
      symbol: 'ETH',
      explorer: 'https://sepolia.etherscan.io',
      faucet: 'https://sepoliafaucet.com/'
    },
    'mainnet': {
      name: 'Ethereum Mainnet',
      rpc: 'https://eth.llamarpc.com',
      chainId: 1,
      symbol: 'ETH',
      explorer: 'https://etherscan.io'
    },
    'polygon': {
      name: 'Polygon Mainet',
      rpc: 'https://polygon-rpc.com',
      chainId: 137,
      symbol: 'MATIC',
      explorer: 'https://polygonscan.com'
    }
  },

  // UI 配置
  UI: {
    STATUS_TIMEOUT: 5000, // 状态消息显示时间（毫秒）
    BALANCE_DECIMALS: 4,  // 余额显示小数位数
    ADDRESS_SHORT_LENGTH: 10 // 地址缩短显示长度
  },

  // 交易配置
  TRANSACTION: {
    DEFAULT_GAS_LIMIT: 21000,
    CONFIRMATION_BLOCKS: 1
  }
};

