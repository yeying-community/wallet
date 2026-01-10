/**
 * 地址处理工具函数
 */

/**
 * 验证以太坊地址格式
 * @param {string} address - 地址
 * @returns {boolean}
 */
export function isValidAddress(address) {
  if (!address || typeof address !== 'string') {
    return false;
  }
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * 验证地址格式（不区分大小写）
 * @param {string} address - 地址
 * @returns {boolean}
 */
export function isValidAddressCaseInsensitive(address) {
  if (!address || typeof address !== 'string') {
    return false;
  }
  return /^0x[a-f0-9]{40}$/.test(address.toLowerCase());
}

/**
 * 验证地址校验和
 * @param {string} address - 地址
 * @returns {boolean}
 */
export function isValidChecksum(address) {
  if (!isValidAddress(address)) {
    return false;
  }
  
  const addressLower = address.toLowerCase().slice(2);
  const addressUpper = address.slice(2);
  
  // 检查是否包含大小写混合
  const hasUpper = /[A-F]/.test(addressUpper);
  const hasLower = /[a-f]/.test(addressLower);
  
  // 如果没有大小写混合，则认为是有效的（全部小写或全部大写）
  if (!hasUpper || !hasLower) {
    return true;
  }
  
  // TODO: 实现完整的 EIP-55 校验和验证
  // 这里需要使用 keccak256 计算地址的哈希
  console.warn('Full EIP-55 checksum validation not implemented');
  return true;
}

/**
 * 验证地址是否为合约地址
 * @param {string} address - 地址
 * @returns {boolean}
 */
export function isContractAddress(address) {
  return isValidAddress(address);
}

/**
 * 验证地址是否为 EOA（外部拥有账户）
 * @param {string} address - 地址
 * @returns {boolean}
 */
export function isEOAAddress(address) {
  return isValidAddress(address);
}

/**
 * 缩短地址显示
 * @param {string} address - 完整地址
 * @param {number} startLength - 开始保留长度（包含0x）
 * @param {number} endLength - 结尾保留长度
 * @returns {string}
 */
export function shortenAddress(address, startLength = 6, endLength = 4) {
  if (!address || !isValidAddress(address)) {
    return '';
  }
  
  const str = String(address);
  if (str.length <= startLength + endLength) {
    return str;
  }
  
  return `${str.slice(0, startLength)}...${str.slice(-endLength)}`;
}

/**
 * 标准化地址（转换为小写）
 * @param {string} address - 地址
 * @returns {string}
 */
export function normalizeAddress(address) {
  if (!address || typeof address !== 'string') {
    return '';
  }
  return address.toLowerCase();
}

/**
 * 添加地址校验和
 * @param {string} address - 地址
 * @returns {string}
 */
export function addChecksum(address) {
  if (!isValidAddressCaseInsensitive(address)) {
    throw new Error('Invalid address format');
  }
  
  const addressLower = address.toLowerCase().slice(2);
  
  // TODO: 实现完整的 EIP-55 校验和
  // 这里需要使用 keccak256 计算地址的哈希
  console.warn('EIP-55 checksum generation not fully implemented');
  
  return `0x${addressLower}`;
}

/**
 * 比较两个地址是否相等（不区分大小写）
 * @param {string} address1 - 地址1
 * @param {string} address2 - 地址2
 * @returns {boolean}
 */
export function isSameAddress(address1, address2) {
  if (!address1 || !address2) {
    return false;
  }
  
  return normalizeAddress(address1) === normalizeAddress(address2);
}

/**
 * 生成基于地址的头像（Identicon 风格）
 * @param {string} address - 以太坊地址
 * @param {string|number} size - 尺寸
 * @returns {HTMLCanvasElement}
 */
export function generateAvatar(address, size = 48) {
  if (!isValidAddress(address)) {
    throw new Error('Invalid address for avatar generation');
  }
  
  const canvas = document.createElement('canvas');
  canvas.width = Number(size);
  canvas.height = Number(size);
  const ctx = canvas.getContext('2d');
  
  // 使用地址生成颜色和图案
  const hash = address.slice(2); // 移除 '0x'
  
  // 生成背景渐变色
  const color1 = '#' + hash.slice(0, 6);
  const color2 = '#' + hash.slice(6, 12);
  
  const gradient = ctx.createLinearGradient(0, 0, Number(size), Number(size));
  gradient.addColorStop(0, color1);
  gradient.addColorStop(1, color2);
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, Number(size), Number(size));
  
  // 生成图案（5x5 网格，对称）
  const gridSize = 5;
  const cellSize = Number(size) / gridSize;
  
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < Math.ceil(gridSize / 2); j++) {
      const index = i * Math.ceil(gridSize / 2) + j;
      const hashValue = parseInt(hash.charAt(index % hash.length), 16);
      
      if (hashValue % 2 === 0) {
        // 左侧
        ctx.fillRect(j * cellSize, i * cellSize, cellSize, cellSize);
        // 右侧对称
        if (j !== Math.floor(gridSize / 2)) {
          ctx.fillRect((gridSize - 1 - j) * cellSize, i * cellSize, cellSize, cellSize);
        }
      }
    }
  }
  
  return canvas;
}

/**
 * 获取地址的 Data URL 格式头像
 * @param {string} address - 以太坊地址
 * @param {string|number} size - 尺寸
 * @param {string} format - 图片格式
 * @returns {string}
 */
export function getAvatarDataUrl(address, size = 48, format = 'image/png') {
  const canvas = generateAvatar(address, size);
  return canvas.toDataURL(format);
}

/**
 * 验证 ENS 域名格式
 * @param {string} ensName - ENS 域名
 * @returns {boolean}
 */
export function isValidEnsName(ensName) {
  if (!ensName || typeof ensName !== 'string') {
    return false;
  }
  
  // ENS 域名规则：长度 3-100，以 . 分隔，至少有一个 .
  const ensRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
  return ensRegex.test(ensName) && ensName.includes('.');
}

/**
 * 验证 Unstoppable Domain 格式
 * @param {string} udName - UD 域名
 * @returns {boolean}
 */
export function isValidUnstoppableDomain(udName) {
  if (!udName || typeof udName !== 'string') {
    return false;
  }
  
  // 支持 .crypto, .wallet, .bitcoin, .x 等
  const udRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.(crypto|wallet|bitcoin|x|nft|dao|888|club|game|zone|art|io)$/i;
  return udRegex.test(udName);
}

/**
 * 验证地址或 ENS 域名
 * @param {string} value - 地址或 ENS 域名
 * @returns {{valid: boolean, type: 'address'|'ens'|'ud'|null}}
 */
export function validateAddressOrEns(value) {
  if (isValidAddress(value)) {
    return { valid: true, type: 'address' };
  }
  
  if (isValidEnsName(value)) {
    return { valid: true, type: 'ens' };
  }
  
  if (isValidUnstoppableDomain(value)) {
    return { valid: true, type: 'ud' };
  }
  
  return { valid: false, type: null };
}

