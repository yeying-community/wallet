/**
 * ChainId 和十六进制处理工具函数
 */

/**
 * 标准化 chainId 为十六进制格式
 * @param {string|number} chainId - 链 ID
 * @returns {string} 十六进制格式的 chainId
 */
export function normalizeChainId(chainId) {
  if (chainId === null || chainId === undefined) {
    throw new Error('chainId is required');
  }

  if (typeof chainId === 'number') {
    if (!Number.isInteger(chainId) || chainId < 0) {
      throw new Error('Invalid chainId: must be a non-negative integer');
    }
    return `0x${chainId.toString(16)}`;
  }
  
  if (typeof chainId === 'string') {
    if (chainId.startsWith('0x') || chainId.startsWith('0X')) {
      return chainId.toLowerCase();
    }
    const num = parseInt(chainId, 10);
    if (isNaN(num)) {
      throw new Error('Invalid chainId format');
    }
    return `0x${num.toString(16)}`;
  }

  throw new Error('Invalid chainId format');
}

/**
 * 将 chainId 转换为十进制
 * @param {string|number} chainId - 链 ID
 * @returns {number}
 */
export function chainIdToNumber(chainId) {
  if (typeof chainId === 'number') {
    return chainId;
  }
  
  if (typeof chainId === 'string') {
    if (chainId.startsWith('0x')) {
      return parseInt(chainId, 16);
    }
    return parseInt(chainId, 10);
  }
  
  throw new Error('Invalid chainId format');
}

/**
 * 验证链ID格式
 * @param {string|number} chainId - 链 ID
 * @returns {boolean}
 */
export function isValidChainId(chainId) {
  try {
    const normalized = normalizeChainId(chainId);
    const num = parseInt(normalized, 16);
    return num > 0 && Number.isInteger(num);
  } catch {
    return false;
  }
}

/**
 * 验证十六进制字符串
 * @param {string} hex - 十六进制字符串
 * @returns {boolean}
 */
export function isValidHex(hex) {
  if (!hex || typeof hex !== 'string') {
    return false;
  }
  return /^0x[a-fA-F0-9]*$/.test(hex);
}

/**
 * 验证十六进制字符串（不带 0x 前缀）
 * @param {string} hex - 十六进制字符串
 * @returns {boolean}
 */
export function isValidHexWithoutPrefix(hex) {
  if (!hex || typeof hex !== 'string') {
    return false;
  }
  return /^[a-fA-F0-9]*$/.test(hex);
}

/**
 * 验证私钥格式
 * @param {string} privateKey - 私钥
 * @returns {boolean}
 */
export function isValidPrivateKey(privateKey) {
  if (!privateKey || typeof privateKey !== 'string') {
    return false;
  }
  const key = privateKey.startsWith('0x') || privateKey.startsWith('0X') 
    ? privateKey.slice(2) 
    : privateKey;
  return /^[a-fA-F0-9]{64}$/.test(key);
}

/**
 * 验证助记词格式（BIP-39）
 * @param {string} mnemonic - 助记词
 * @returns {boolean}
 */
export function isValidMnemonic(mnemonic) {
  if (!mnemonic || typeof mnemonic !== 'string') {
    return false;
  }
  
  const words = mnemonic.trim().split(/\s+/);
  
  // 助记词长度必须是 12、15、18、21 或 24
  const allowedLengths = [12, 15, 18, 21, 24];
  if (!allowedLengths.includes(words.length)) {
    return false;
  }

  // 检查每个单词是否只包含字母
  return words.every(word => /^[a-z]+$/i.test(word));
}

/**
 * 验证交易哈希格式
 * @param {string} txHash - 交易哈希
 * @returns {boolean}
 */
export function isValidTxHash(txHash) {
  if (!txHash || typeof txHash !== 'string') {
    return false;
  }
  return /^0x[a-fA-F0-9]{64}$/.test(txHash);
}

/**
 * 验证区块哈希格式
 * @param {string} blockHash - 区块哈希
 * @returns {boolean}
 */
export function isValidBlockHash(blockHash) {
  if (!blockHash || typeof blockHash !== 'string') {
    return false;
  }
  return /^0x[a-fA-F0-9]{64}$/.test(blockHash);
}

/**
 * 验证日志主题格式
 * @param {string} topic - 主题
 * @returns {boolean}
 */
export function isValidTopic(topic) {
  if (!topic || typeof topic !== 'string') {
    return false;
  }
  return /^0x[a-fA-F0-9]{64}$/.test(topic);
}

/**
 * 验证数据字段格式
 * @param {string} data - 数据字段
 * @returns {boolean}
 */
export function isValidData(data) {
  if (!data || typeof data !== 'string') {
    return false;
  }
  // 允许 0x 或空字符串
  if (data === '0x' || data === '') {
    return true;
  }
  return /^0x[a-fA-F0-9]*$/.test(data);
}

/**
 * 将十六进制转换为十进制字符串
 * @param {string} hex - 十六进制字符串
 * @returns {string}
 */
export function hexToDecimal(hex) {
  if (!isValidHex(hex)) {
    throw new Error('Invalid hex format');
  }
  return parseInt(hex, 16).toString();
}

/**
 * 将十进制转换为十六进制
 * @param {string|number} decimal - 十进制数字
 * @param {boolean} prefix - 是否添加 0x 前缀
 * @returns {string}
 */
export function decimalToHex(decimal, prefix = true) {
  const num = typeof decimal === 'string' ? parseInt(decimal, 10) : decimal;
  const hex = num.toString(16);
  return prefix ? `0x${hex}` : hex;
}

/**
 * 将十六进制转换为字节数组
 * @param {string} hex - 十六进制字符串
 * @returns {number[]}
 */
export function hexToBytes(hex) {
  if (!isValidHex(hex)) {
    throw new Error('Invalid hex format');
  }
  
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = [];
  
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes.push(parseInt(cleanHex.slice(i, i + 2), 16));
  }

  return bytes;
}

/**
 * 将字节数组转换为十六进制
 * @param {number[]} bytes - 字节数组
 * @param {boolean} prefix - 是否添加 0x 前缀
 * @returns {string}
 */
export function bytesToHex(bytes, prefix = true) {
  const hex = bytes
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  return prefix ? `0x${hex}` : hex;
}

/**
 * 将十六进制转换为 UTF-8 字符串
 * @param {string} hex - 十六进制字符串
 * @returns {string}
 */
export function hexToUtf8(hex) {
  if (!isValidHex(hex)) {
    throw new Error('Invalid hex format');
  }
  
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  let str = '';
  
  for (let i = 0; i < cleanHex.length; i += 2) {
    const charCode = parseInt(cleanHex.slice(i, i + 2), 16);
    str += String.fromCharCode(charCode);
  }

  return decodeURIComponent(escape(str));
}

/**
 * 将 UTF-8 字符串转换为十六进制
 * @param {string} str - UTF-8 字符串
 * @param {boolean} prefix - 是否添加 0x 前缀
 * @returns {string}
 */
export function utf8ToHex(str, prefix = true) {
  let hex = '';
  
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    hex += charCode.toString(16).padStart(2, '0');
  }

  return prefix ? `0x${hex}` : hex;
}

/**
 * 移除十六进制字符串的 0x 前缀
 * @param {string} hex - 十六进制字符串
 * @returns {string}
 */
export function removeHexPrefix(hex) {
  if (!hex || typeof hex !== 'string') {
    return '';
  }
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}

/**
 * 为十六进制字符串添加 0x 前缀
 * @param {string} hex - 十六进制字符串
 * @returns {string}
 */
export function addHexPrefix(hex) {
  if (!hex || typeof hex !== 'string') {
    return '0x';
  }
  return hex.startsWith('0x') ? hex : `0x${hex}`;
}

/**
 * 填充十六进制字符串到指定长度
 * @param {string} hex - 十六进制字符串
 * @param {number} length - 目标长度（字节）
 * @param {boolean} prepend - 是否在前面填充
 * @returns {string}
 */
export function padHex(hex, length = 32, prepend = true) {
  const cleanHex = removeHexPrefix(hex);
  const padded = cleanHex.padStart(length * 2, '0');
  return addHexPrefix(padded);
}

/**
 * 截断十六进制字符串
 * @param {string} hex - 十六进制字符串
 * @param {number} maxLength - 最大长度（字符数，不含 0x）
 * @returns {string}
 */
export function truncateHex(hex, maxLength = 10) {
  const cleanHex = removeHexPrefix(hex);
  if (cleanHex.length <= maxLength) {
    return addHexPrefix(cleanHex);
  }
  return addHexPrefix(cleanHex.slice(0, maxLength) + '...');
}

/**
 * 比较两个十六进制字符串（不区分大小写）
 * @param {string} hex1 - 十六进制字符串1
 * @param {string} hex2 - 十六进制字符串2
 * @returns {boolean}
 */
export function isSameHex(hex1, hex2) {
  return removeHexPrefix(hex1).toLowerCase() === removeHexPrefix(hex2).toLowerCase();
}

/**
 * 常见链 ID 列表
 */
export const KNOWN_CHAIN_IDS = {
  ETHEREUM_MAINNET: 1,
  ETHEREUM_ROPSTEN: 3,
  ETHEREUM_RINKEBY: 4,
  ETHEREUM_GOERLI: 5,
  ETHEREUM_SEPOLIA: 11155111,
  POLYGON_MAINNET: 137,
  POLYGON_MUMBAI: 80001,
  BSC_MAINNET: 56,
  BSC_TESTNET: 97,
  AVALANCHE_MAINNET: 43114,
  AVALANCHE_FUJI: 43113,
  ARBITRUM_MAINNET: 42161,
  ARBITRUM_GOERLI: 421613,
  OPTIMISM_MAINNET: 10,
  OPTIMISM_GOERLI: 420,
  BASE_MAINNET: 8453,
  BASE_GOERLI: 84531,
  GNOSIS_MAINNET: 100,
  FANTOM_MAINNET: 250,
  CELO_MAINNET: 42220,
  MOONBEAM_MAINNET: 1284,
  MOONRIVER_MAINNET: 1285,
  HECO_MAINNET: 128,
  OKC_MAINNET: 66
};

/**
 * 获取链名称
 * @param {string|number} chainId - 链 ID
 * @returns {string}
 */
export function getChainName(chainId) {
  const id = typeof chainId === 'string' ? parseInt(chainId, 16) : chainId;
  
  const names = {
    1: 'Ethereum',
    3: 'Ropsten',
    4: 'Rinkeby',
    5: 'Goerli',
    42: 'Kovan',
    56: 'BSC',
    97: 'BSC Testnet',
    137: 'Polygon',
    80001: 'Polygon Mumbai',
    250: 'Fantom',
    43114: 'Avalanche',
    43113: 'Avalanche Fuji',
    42161: 'Arbitrum',
    421613: 'Arbitrum Goerli',
    10: 'Optimism',
    420: 'Optimism Goerli',
    8453: 'Base',
    84531: 'Base Goerli',
    100: 'Gnosis',
    42220: 'Celo',
    1284: 'Moonbeam',
    1285: 'Moonriver',
    128: 'HECO',
    66: 'OKC'
  };
  
  return names[id] || `Unknown Chain (${id})`;
}
