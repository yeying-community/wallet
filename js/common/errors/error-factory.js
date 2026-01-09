/**
 * 错误工厂
 * 创建标准化的错误对象
 */

import { ErrorCode } from './error-codes.js';
import { getErrorMessage } from './error-messages.js';

/**
 * 创建标准错误对象
 * @param {number} code - 错误码
 * @param {string} message - 错误消息（可选）
 * @param {any} data - 额外数据（可选）
 * @returns {Object} {code, message, data?}
 */
export function createError(code, message, data) {
  const error = {
    code,
    message: message || getErrorMessage(code)
  };

  if (data !== undefined) {
    error.data = data;
  }

  return error;
}

/**
 * 从 Error 对象创建标准错误
 * @param {Error} error - Error 对象
 * @param {number} code - 错误码（可选）
 * @returns {Object}
 */
export function createErrorFromException(error, code = ErrorCode.INTERNAL_ERROR) {
  return createError(code, error.message, {
    originalError: error.name,
    stack: error.stack
  });
}

// ==================== JSON-RPC 错误 ====================

export function createParseError(message) {
  return createError(ErrorCode.PARSE_ERROR, message);
}

export function createInvalidRequest(message) {
  return createError(ErrorCode.INVALID_REQUEST, message);
}

export function createMethodNotFound(method) {
  return createError(
    ErrorCode.METHOD_NOT_FOUND,
    `Method "${method}" not found`
  );
}

export function createInvalidParams(message) {
  return createError(ErrorCode.INVALID_PARAMS, message);
}

export function createInternalError(message) {
  return createError(ErrorCode.INTERNAL_ERROR, message);
}

// ==================== EIP-1193 错误 ====================

export function createUserRejectedError(message) {
  return createError(ErrorCode.USER_REJECTED, message);
}

export function createUnauthorizedError(message) {
  return createError(ErrorCode.UNAUTHORIZED, message);
}

export function createUnsupportedMethodError(method) {
  return createError(
    ErrorCode.UNSUPPORTED_METHOD,
    `Method "${method}" is not supported`
  );
}

export function createDisconnectedError(message) {
  return createError(ErrorCode.DISCONNECTED, message);
}

export function createChainDisconnectedError(chainId) {
  return createError(
    ErrorCode.CHAIN_DISCONNECTED,
    `Chain ${chainId} is disconnected`
  );
}

export function createUnrecognizedChainError(chainId) {
  return createError(
    ErrorCode.UNRECOGNIZED_CHAIN,
    `Unrecognized chain ID: ${chainId}`
  );
}

// ==================== 钱包错误 ====================

export function createWalletLockedError() {
  return createError(ErrorCode.WALLET_LOCKED);
}

export function createWalletNotInitializedError() {
  return createError(ErrorCode.WALLET_NOT_INITIALIZED);
}

export function createAccountNotFoundError(accountId) {
  return createError(
    ErrorCode.ACCOUNT_NOT_FOUND,
    `Account not found: ${accountId}`
  );
}

export function createWalletNotFoundError(walletId) {
  return createError(
    ErrorCode.ACCOUNT_NOT_FOUND,
    `Wallet not found: ${walletId}`
  );
}

export function createInvalidPasswordError() {
  return createError(ErrorCode.INVALID_PASSWORD);
}

export function createMnemonicInvalidError() {
  return createError(ErrorCode.MNEMONIC_INVALID);
}

export function createPrivateKeyInvalidError() {
  return createError(ErrorCode.PRIVATE_KEY_INVALID);
}

// ==================== 网络错误 ====================

export function createNetworkError(message) {
  return createError(ErrorCode.NETWORK_ERROR, message);
}

export function createNetworkTimeoutError() {
  return createError(ErrorCode.NETWORK_TIMEOUT);
}

export function createNetworkUnavailableError() {
  return createError(ErrorCode.NETWORK_UNAVAILABLE);
}

export function createRpcError(message) {
  return createError(ErrorCode.RPC_ERROR, message);
}

export function createInvalidChainIdError(chainId) {
  return createError(
    ErrorCode.INVALID_CHAIN_ID,
    `Invalid chain ID: ${chainId}`
  );
}

// ==================== 交易错误 ====================

export function createTransactionFailedError(message) {
  return createError(ErrorCode.TRANSACTION_FAILED, message);
}

export function createTransactionRejectedError() {
  return createError(ErrorCode.TRANSACTION_REJECTED);
}

export function createInsufficientFundsError(required, available) {
  return createError(
    ErrorCode.INSUFFICIENT_FUNDS,
    `Insufficient funds: required ${required}, available ${available}`
  );
}

export function createGasEstimationFailedError(message) {
  return createError(ErrorCode.GAS_ESTIMATION_FAILED, message);
}

export function createNonceTooLowError(expected, actual) {
  return createError(
    ErrorCode.NONCE_TOO_LOW,
    `Nonce too low: expected ${expected}, got ${actual}`
  );
}

export function createReplacementUnderpricedError() {
  return createError(ErrorCode.REPLACEMENT_UNDERPRICED);
}

// ==================== 签名错误 ====================

export function createSignatureFailedError(message) {
  return createError(ErrorCode.SIGNATURE_FAILED, message);
}

export function createInvalidSignatureError() {
  return createError(ErrorCode.INVALID_SIGNATURE);
}

export function createMessageInvalidError(message) {
  return createError(ErrorCode.MESSAGE_INVALID, message);
}

// ==================== 验证错误 ====================

export function createInvalidAddressError(address) {
  return createError(
    ErrorCode.INVALID_ADDRESS,
    `Invalid address: ${address}`
  );
}

export function createInvalidAmountError(amount) {
  return createError(
    ErrorCode.INVALID_AMOUNT,
    `Invalid amount: ${amount}`
  );
}

export function createInvalidDataError(message) {
  return createError(ErrorCode.INVALID_DATA, message);
}

export function createInvalidMessageFormatError(message) {
  return createError(ErrorCode.INVALID_MESSAGE_FORMAT, message);
}

// ==================== 系统错误 ====================

export function createTimeoutError(message) {
  return createError(ErrorCode.TIMEOUT, message);
}

export function createStorageError(message) {
  return createError(ErrorCode.STORAGE_ERROR, message);
}

export function createEncryptionError(message) {
  return createError(ErrorCode.ENCRYPTION_ERROR, message);
}

export function createCryptoError(message) {
  return createError(ErrorCode.CRYPTO_ERROR, message);
}


export function createDecryptionError(message) {
  return createError(ErrorCode.DECRYPTION_ERROR, message);
}

export function createUnknownError(message) {
  return createError(ErrorCode.UNKNOWN_ERROR, message);
}
