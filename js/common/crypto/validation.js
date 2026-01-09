/**
 * 验证功能
 * 助记词、私钥等的验证
 */

import {
  VALID_MNEMONIC_LENGTHS,
  PRIVATE_KEY_FORMAT,
  CRYPTO_ERROR_MESSAGES
} from './crypto-constants.js';
import { logError } from '../errors/index.js';
import { ethers } from '../../../lib/ethers-5.7.esm.min.js';

/**
 * 验证助记词
 * @param {string} mnemonic - 助记词
 * @returns {{valid: boolean, error?: string, address?: string, wordCount?: number}}
 */
export function validateMnemonic(mnemonic) {
  try {
    // 检查是否为空
    if (!mnemonic || typeof mnemonic !== 'string') {
      return {
        valid: false,
        error: CRYPTO_ERROR_MESSAGES.MNEMONIC_REQUIRED
      };
    }
    
    // 清理并分割单词
    const words = mnemonic.trim().split(/\s+/);
    const wordCount = words.length;

    // 检查单词数量
    if (!VALID_MNEMONIC_LENGTHS.includes(wordCount)) {
      return {
        valid: false,
        error: CRYPTO_ERROR_MESSAGES.MNEMONIC_INVALID_LENGTH,
        wordCount
      };
    }
    
    // 使用 ethers.js 验证助记词
    if (!ethers.utils.isValidMnemonic(mnemonic)) {
      return {
        valid: false,
        error: CRYPTO_ERROR_MESSAGES.MNEMONIC_INVALID_FORMAT,
        wordCount
      };
    }
    
    // 获取地址用于预览
    const wallet = ethers.Wallet.fromMnemonic(mnemonic);
    
    return {
      valid: true,
      address: wallet.address,
      wordCount
    };
  } catch (error) {
    logError('crypto-validate-mnemonic', error);
    return {
      valid: false,
      error: CRYPTO_ERROR_MESSAGES.MNEMONIC_INVALID_FORMAT
    };
  }
}

/**
 * 验证私钥
 * @param {string} privateKey - 私钥
 * @returns {{valid: boolean, error?: string, address?: string}}
 */
export function validatePrivateKey(privateKey) {
  try {
    // 检查是否为空
    if (!privateKey || typeof privateKey !== 'string') {
      return {
        valid: false,
        error: CRYPTO_ERROR_MESSAGES.PRIVATE_KEY_REQUIRED
      };
    }

    // 清理格式
    privateKey = privateKey.trim();
    
    // 添加 0x 前缀（如果没有）
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }
    
    // 检查长度
    if (privateKey.length !== PRIVATE_KEY_FORMAT.WITH_PREFIX_LENGTH) {
      return {
        valid: false,
        error: CRYPTO_ERROR_MESSAGES.PRIVATE_KEY_INVALID_LENGTH
      };
    }

    // 检查是否为有效的十六进制
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
      return {
        valid: false,
        error: CRYPTO_ERROR_MESSAGES.PRIVATE_KEY_INVALID_FORMAT
      };
    }
    
    // 使用 ethers.js 验证私钥
    const wallet = new ethers.Wallet(privateKey);
    
    return {
      valid: true,
      address: wallet.address
    };
  } catch (error) {
    logError('crypto-validate-private-key', error);
    return {
      valid: false,
      error: CRYPTO_ERROR_MESSAGES.PRIVATE_KEY_INVALID_FORMAT
    };
  }
}

/**
 * 验证以太坊地址
 * @param {string} address - 地址
 * @returns {{valid: boolean, error?: string, checksumAddress?: string}}
 */
export function validateAddress(address) {
  try {
    if (!address || typeof address !== 'string') {
      return {
        valid: false,
        error: 'Address is required'
      };
    }

    // 使用 ethers.js 验证地址
    if (!ethers.utils.isAddress(address)) {
      return {
        valid: false,
        error: 'Invalid Ethereum address'
      };
    }
    
    // 获取校验和地址
    const checksumAddress = ethers.utils.getAddress(address);
    
    return {
      valid: true,
      checksumAddress
    };
    
  } catch (error) {
    logError('crypto-validate-address', error);
    return {
      valid: false,
      error: 'Invalid Ethereum address'
    };
  }
}

/**
 * 验证助记词单词
 * @param {string} word - 单词
 * @returns {boolean}
 */
export function isValidMnemonicWord(word) {
  try {
    // 获取 BIP39 单词列表
    const wordlist = ethers.wordlists.en;
    return wordlist.getWordIndex(word.toLowerCase()) !== -1;
  } catch (error) {
    return false;
  }
}

/**
 * 获取助记词建议
 * @param {string} prefix - 前缀
 * @param {number} limit - 限制数量
 * @returns {string[]}
 */
export function getMnemonicSuggestions(prefix, limit = 10) {
  try {
    if (!prefix || prefix.length < 2) {
      return [];
    }
    
    const wordlist = ethers.wordlists.en;
    const words = [];

    for (let i = 0; i < 2048; i++) {
      const word = wordlist.getWord(i);
      if (word.startsWith(prefix.toLowerCase())) {
        words.push(word);
        if (words.length >= limit) {
          break;
        }
      }
    }
    
    return words;
  } catch (error) {
    logError('crypto-get-mnemonic-suggestions', error);
    return [];
  }
}

/**
 * 验证助记词路径
 * @param {string} path - 派生路径
 * @returns {{valid: boolean, error?: string}}
 */
export function validateDerivationPath(path) {
  try {
    if (!path || typeof path !== 'string') {
      return {
        valid: false,
        error: 'Derivation path is required'
      };
    }

    // 标准以太坊路径格式: m/44'/60'/0'/0/x
    const pathRegex = /^m(\/\d+'?)+$/;
    
    if (!pathRegex.test(path)) {
      return {
        valid: false,
        error: 'Invalid derivation path format'
      };
    }
    
    return { valid: true };
    
  } catch (error) {
    logError('crypto-validate-derivation-path', error);
    return {
      valid: false,
      error: 'Invalid derivation path'
    };
  }
}

/**
 * 生成标准以太坊派生路径
 * @param {number} accountIndex - 账户索引
 * @returns {string}
 */
export function generateEthereumPath(accountIndex = 0) {
  return `m/44'/60'/0'/0/${accountIndex}`;
/**
 * 验证签名
 * @param {string} message - 消息
 * @param {string} signature - 签名
 * @param {string} address - 地址
 * @returns {{valid: boolean, error?: string}}
 */
export function validateSignature(message, signature, address) {
  try {
    if (!message || !signature || !address) {
      return {
        valid: false,
        error: 'Message, signature, and address are required'
      };
    }
    
    // 恢复签名者地址
    const recoveredAddress = ethers.utils.verifyMessage(message, signature);
    
    // 比较地址（不区分大小写）
    const isValid = recoveredAddress.toLowerCase() === address.toLowerCase();
    
    return {
      valid: isValid,
      error: isValid ? undefined : 'Signature verification failed'
    };
    
  } catch (error) {
    logError('crypto-validate-signature', error);
    return {
      valid: false,
      error: 'Invalid signature'
    };
  }
}
