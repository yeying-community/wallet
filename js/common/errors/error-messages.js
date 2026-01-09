/**
 * 错误消息映射
 * 提供默认的错误消息文本
 */

import { ErrorCode } from './error-codes.js';

// ==================== 英文错误消息 ====================
export const ErrorMessageEN = {
  // JSON-RPC
  [ErrorCode.PARSE_ERROR]: 'Parse error',
  [ErrorCode.INVALID_REQUEST]: 'Invalid request',
  [ErrorCode.METHOD_NOT_FOUND]: 'Method not found',
  [ErrorCode.INVALID_PARAMS]: 'Invalid params',
  [ErrorCode.INTERNAL_ERROR]: 'Internal error',

  // EIP-1193
  [ErrorCode.USER_REJECTED]: 'User rejected the request',
  [ErrorCode.UNAUTHORIZED]: 'Unauthorized',
  [ErrorCode.UNSUPPORTED_METHOD]: 'Unsupported method',
  [ErrorCode.DISCONNECTED]: 'Disconnected',
  [ErrorCode.CHAIN_DISCONNECTED]: 'Chain disconnected',
  [ErrorCode.UNRECOGNIZED_CHAIN]: 'Unrecognized chain ID',

  // Wallet
  [ErrorCode.WALLET_LOCKED]: 'Wallet is locked',
  [ErrorCode.WALLET_NOT_INITIALIZED]: 'Wallet is not initialized',
  [ErrorCode.ACCOUNT_NOT_FOUND]: 'Account not found',
  [ErrorCode.INVALID_PASSWORD]: 'Invalid password',
  [ErrorCode.MNEMONIC_INVALID]: 'Invalid mnemonic phrase',
  [ErrorCode.PRIVATE_KEY_INVALID]: 'Invalid private key',
  [ErrorCode.WALLET_ALREADY_EXISTS]: 'Wallet already exists',
  [ErrorCode.ACCOUNT_ALREADY_EXISTS]: 'Account already exists',

  // Network
  [ErrorCode.NETWORK_ERROR]: 'Network error',
  [ErrorCode.NETWORK_TIMEOUT]: 'Network request timeout',
  [ErrorCode.NETWORK_UNAVAILABLE]: 'Network unavailable',
  [ErrorCode.RPC_ERROR]: 'RPC request failed',
  [ErrorCode.INVALID_CHAIN_ID]: 'Invalid chain ID',
  [ErrorCode.CHAIN_NOT_SUPPORTED]: 'Chain not supported',

  // Transaction
  [ErrorCode.TRANSACTION_FAILED]: 'Transaction failed',
  [ErrorCode.TRANSACTION_REJECTED]: 'Transaction rejected',
  [ErrorCode.INSUFFICIENT_FUNDS]: 'Insufficient funds',
  [ErrorCode.GAS_ESTIMATION_FAILED]: 'Gas estimation failed',
  [ErrorCode.NONCE_TOO_LOW]: 'Nonce too low',
  [ErrorCode.REPLACEMENT_UNDERPRICED]: 'Replacement transaction underpriced',
  [ErrorCode.TRANSACTION_TIMEOUT]: 'Transaction timeout',

  // Signing
  [ErrorCode.SIGNATURE_FAILED]: 'Signature failed',
  [ErrorCode.INVALID_SIGNATURE]: 'Invalid signature',
  [ErrorCode.MESSAGE_INVALID]: 'Invalid message',
  [ErrorCode.SIGNING_REJECTED]: 'Signing rejected',

  // Validation
  [ErrorCode.INVALID_ADDRESS]: 'Invalid address',
  [ErrorCode.INVALID_AMOUNT]: 'Invalid amount',
  [ErrorCode.INVALID_DATA]: 'Invalid data',
  [ErrorCode.INVALID_MESSAGE_FORMAT]: 'Invalid message format',
  [ErrorCode.INVALID_PARAMETER]: 'Invalid parameter',

  // System
  [ErrorCode.TIMEOUT]: 'Request timeout',
  [ErrorCode.STORAGE_ERROR]: 'Storage error',
  [ErrorCode.ENCRYPTION_ERROR]: 'Encryption error',
  [ErrorCode.DECRYPTION_ERROR]: 'Decryption error',
  [ErrorCode.UNKNOWN_ERROR]: 'Unknown error'
};

// ==================== 中文错误消息 ====================
export const ErrorMessageZH = {
  // JSON-RPC
  [ErrorCode.PARSE_ERROR]: '解析错误',
  [ErrorCode.INVALID_REQUEST]: '无效请求',
  [ErrorCode.METHOD_NOT_FOUND]: '方法未找到',
  [ErrorCode.INVALID_PARAMS]: '无效参数',
  [ErrorCode.INTERNAL_ERROR]: '内部错误',

  // EIP-1193
  [ErrorCode.USER_REJECTED]: '用户拒绝请求',
  [ErrorCode.UNAUTHORIZED]: '未授权',
  [ErrorCode.UNSUPPORTED_METHOD]: '不支持的方法',
  [ErrorCode.DISCONNECTED]: '已断开连接',
  [ErrorCode.CHAIN_DISCONNECTED]: '链已断开',
  [ErrorCode.UNRECOGNIZED_CHAIN]: '无法识别的链 ID',

  // Wallet
  [ErrorCode.WALLET_LOCKED]: '钱包已锁定',
  [ErrorCode.WALLET_NOT_INITIALIZED]: '钱包未初始化',
  [ErrorCode.ACCOUNT_NOT_FOUND]: '账户未找到',
  [ErrorCode.INVALID_PASSWORD]: '密码错误',
  [ErrorCode.MNEMONIC_INVALID]: '无效的助记词',
  [ErrorCode.PRIVATE_KEY_INVALID]: '无效的私钥',
  [ErrorCode.WALLET_ALREADY_EXISTS]: '钱包已存在',
  [ErrorCode.ACCOUNT_ALREADY_EXISTS]: '账户已存在',

  // Network
  [ErrorCode.NETWORK_ERROR]: '网络错误',
  [ErrorCode.NETWORK_TIMEOUT]: '网络请求超时',
  [ErrorCode.NETWORK_UNAVAILABLE]: '网络不可用',
  [ErrorCode.RPC_ERROR]: 'RPC 请求失败',
  [ErrorCode.INVALID_CHAIN_ID]: '无效的链 ID',
  [ErrorCode.CHAIN_NOT_SUPPORTED]: '不支持的链',

  // Transaction
  [ErrorCode.TRANSACTION_FAILED]: '交易失败',
  [ErrorCode.TRANSACTION_REJECTED]: '交易被拒绝',
  [ErrorCode.INSUFFICIENT_FUNDS]: '余额不足',
  [ErrorCode.GAS_ESTIMATION_FAILED]: 'Gas 估算失败',
  [ErrorCode.NONCE_TOO_LOW]: 'Nonce 过低',
  [ErrorCode.REPLACEMENT_UNDERPRICED]: '替换交易价格过低',
  [ErrorCode.TRANSACTION_TIMEOUT]: '交易超时',

  // Signing
  [ErrorCode.SIGNATURE_FAILED]: '签名失败',
  [ErrorCode.INVALID_SIGNATURE]: '无效的签名',
  [ErrorCode.MESSAGE_INVALID]: '无效的消息',
  [ErrorCode.SIGNING_REJECTED]: '签名被拒绝',

  // Validation
  [ErrorCode.INVALID_ADDRESS]: '无效的地址',
  [ErrorCode.INVALID_AMOUNT]: '无效的金额',
  [ErrorCode.INVALID_DATA]: '无效的数据',
  [ErrorCode.INVALID_MESSAGE_FORMAT]: '无效的消息格式',
  [ErrorCode.INVALID_PARAMETER]: '无效的参数',

  // System
  [ErrorCode.TIMEOUT]: '请求超时',
  [ErrorCode.STORAGE_ERROR]: '存储错误',
  [ErrorCode.ENCRYPTION_ERROR]: '加密错误',
  [ErrorCode.DECRYPTION_ERROR]: '解密错误',
  [ErrorCode.UNKNOWN_ERROR]: '未知错误'
};

// ==================== 默认使用英文 ====================
export const ErrorMessage = ErrorMessageEN;

// ==================== 获取错误消息 ====================
export function getErrorMessage(code, locale = 'en') {
  const messages = locale === 'zh' ? ErrorMessageZH : ErrorMessageEN;
  return messages[code] || ErrorMessageEN[ErrorCode.UNKNOWN_ERROR];
}
