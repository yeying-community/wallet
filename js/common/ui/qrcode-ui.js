/**
 * 二维码生成工具函数
 */

import {escapeHtml} from './html-ui.js'

/**
 * 生成二维码
 * @param {string} text - 要编码的文本
 * @param {string} elementId - 目标元素 ID
 * @param {Object} options - 选项
 * @returns {boolean}
 */
export function generateQRCode(text, elementId, options = {}) {
  const container = document.getElementById(elementId);
  
  if (!container) {
    console.error('QR code element not found:', elementId);
    return false;
  }
  
  // 清空之前的内容
  container.innerHTML = '';
  
  // 检查 QRCode 库是否可用
  if (typeof QRCode === 'undefined') {
    console.warn('QRCode library not loaded, using fallback');
    renderQRCodeFallback(container, text, options);
    return false;
  }
  
  try {
    const defaultOptions = {
      width: 200,
      height: 200,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    };
    
    const qrOptions = { ...defaultOptions, ...options };
    
    new QRCode(container, {
      text: text,
      width: qrOptions.width,
      height: qrOptions.height,
      colorDark: qrOptions.colorDark,
      colorLight: qrOptions.colorLight,
      correctLevel: qrOptions.correctLevel
    });
    
    return true;
  } catch (error) {
    console.error('Generate QR code failed:', error);
    renderQRCodeFallback(container, text, options);
    return false;
  }
}

/**
 * 渲染二维码的备用显示（纯文本）
 * @param {HTMLElement} container - 容器元素
 * @param {string} text - 文本
 * @param {Object} options - 选项
 */
function renderQRCodeFallback(container, text, options = {}) {
  const size = options.width || 200;
  
  container.innerHTML = `
    <div class="qrcode-fallback" style="
      width: ${size}px;
      height: ${size}px;
      background: #f5f5f5;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      font-size: 10px;
      text-align: center;
      padding: 8px;
      word-break: break-all;
      color: #666;
      box-sizing: border-box;
    ">
      <div style="margin-bottom: 8px; font-size: 14px;">📱</div>
      <div style="font-weight: 500; margin-bottom: 4px;">Scan Failed</div>
      <div style="font-size: 9px; opacity: 0.7;">${escapeHtml(text)}</div>
    </div>
  `;
}

/**
 * 生成以太坊地址二维码
 * @param {string} address - 以太坊地址
 * @param {string} elementId - 目标元素 ID
 * @param {Object} options - 选项
 * @returns {boolean}
 */
export function generateAddressQRCode(address, elementId, options = {}) {
  const qrOptions = {
    width: options.width || 200,
    height: options.height || 200,
    colorDark: options.colorDark || '#000000',
    colorLight: options.colorLight || '#ffffff'
  };
  
  return generateQRCode(address, elementId, qrOptions);
}

/**
 * 生成交易二维码（ETH 转账）
 * @param {string} address - 收款地址
 * @param {string|number} amount - 金额（ETH）
 * @param {string} elementId - 目标元素 ID
 * @param {Object} options - 选项
 * @returns {boolean}
 */
export function generateTransactionQRCode(address, amount, elementId, options = {}) {
  const uri = generateEthereumUri(address, amount, options.chainId);
  return generateQRCode(uri, elementId, options);
}

/**
 * 生成以太坊 URI（EIP-681）
 * @param {string} address - 收款地址
 * @param {string|number} amount - 金额（ETH）
 * @param {number} chainId - 链 ID
 * @param {Object} extra - 额外参数
 * @returns {string}
 */
export function generateEthereumUri(address, amount = null, chainId = 1, extra = {}) {
  let uri = `ethereum:${address}`;
  
  const params = [];
  
  // 添加链 ID
  if (chainId && chainId !== 1) {
    params.push(`chainId=${chainId}`);
  }
  
  // 添加金额
  if (amount && parseFloat(amount) > 0) {
    params.push(`value=${parseEther(amount)}`);
  }
  
  // 添加额外参数
  if (extra.gasLimit) {
    params.push(`gasLimit=${extra.gasLimit}`);
  }
  
  if (extra.data) {
    params.push(`data=${extra.data}`);
  }
  
  if (params.length > 0) {
    uri += '@' + chainId + '?' + params.join('&');
  }
  
  return uri;
}

/**
 * 解析以太坊 URI
 * @param {string} uri - 以太坊 URI
 * @returns {Object}
 */
export function parseEthereumUri(uri) {
  const result = {
    address: '',
    chainId: 1,
    amount: null,
    gasLimit: null,
    data: null
  };
  
  try {
    const url = new URL(uri);
    
    if (url.protocol !== 'ethereum:') {
      throw new Error('Invalid protocol');
    }
    
    // 解析地址（可能包含 @chainId）
    const path = url.pathname || url.hostname;
    const [address, chainId] = path.split('@');
    result.address = address;
    
    if (chainId) {
      result.chainId = parseInt(chainId, 10);
    }
    
    // 解析查询参数
    const params = new URLSearchParams(url.search);
    result.amount = params.get('value');
    result.gasLimit = params.get('gasLimit');
    result.data = params.get('data');
    
  } catch (error) {
    console.error('Parse Ethereum URI failed:', error);
  }
  
  return result;
}

/**
 * 生成代币转账二维码（ERC-20）
 * @param {string} tokenAddress - 代币合约地址
 * @param {string} toAddress - 收款地址
 * @param {string|number} amount - 金额
 * @param {string} elementId - 目标元素 ID
 * @param {Object} options - 选项
 * @returns {boolean}
 */
export function generateTokenTransferQRCode(tokenAddress, toAddress, amount, elementId, options = {}) {
  const data = generateTokenTransferData(toAddress, amount, options.decimals || 18);
  
  const uri = generateEthereumUri(tokenAddress, 0, options.chainId || 1, {
    data: data
  });
  
  return generateQRCode(uri, elementId, options);
}

/**
 * 生成代币转账数据
 * @param {string} toAddress - 收款地址
 * @param {string|number} amount - 金额
 * @param {number} decimals - 小数位数
 * @returns {string}
 */
export function generateTokenTransferData(toAddress, amount, decimals = 18) {
  const methodId = 'a9059cbb'; // transfer(address,uint256) 的方法 ID
  
  // 编码参数
  const paddedAddress = toAddress.toLowerCase().replace('0x', '').padStart(64, '0');
  const amountInWei = parseBalance(String(amount), decimals).toString(16).padStart(64, '0');
  
  return '0x' + methodId + paddedAddress + amountInWei;
}

/**
 * 获取二维码的 Data URL
 * @param {string} text - 要编码的文本
 * @param {Object} options - 选项
 * @returns {Promise<string>}
 */
export async function getQRCodeDataUrl(text, options = {}) {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    
    generateQRCode(text, container, options);
    
    const canvas = container.querySelector('canvas');
    
    if (canvas) {
      resolve(canvas.toDataURL('image/png'));
    } else {
      const img = container.querySelector('img');
      if (img) {
        resolve(img.src);
      } else {
        resolve('');
      }
    }
  });
}

/**
 * 辅助函数：解析余额
 * @param {string} balanceStr - 余额字符串
 * @param {number} decimals - 小数位数
 * @returns {bigint}
 */
function parseBalance(balanceStr, decimals = 18) {
  try {
    const [integerPart, fractionalPart = ''] = balanceStr.split('.');
    const paddedFractional = fractionalPart.padEnd(decimals, '0').slice(0, decimals);
    const combined = integerPart + paddedFractional;
    return BigInt(combined);
  } catch {
    return BigInt(0);
  }
}

/**
 * 辅助函数：解析 ETH 金额为 Wei
 * @param {string|number} amount - ETH 金额
 * @returns {string}
 */
function parseEther(amount) {
  const value = parseFloat(amount);
  const wei = BigInt(Math.round(value * 1e18));
  return wei.toString();
}

