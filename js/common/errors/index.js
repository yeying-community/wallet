/**
 * 错误模块统一导出
 */

// 错误码
export {
  ErrorCode,
  JsonRpcErrorCode,
  Eip1193ErrorCode,
  WalletErrorCode,
  NetworkErrorCode,
  TransactionErrorCode,
  SigningErrorCode,
  ValidationErrorCode,
  SystemErrorCode,
  ErrorCodeRange
} from './error-codes.js';

// 错误消息
export {
  ErrorMessage,
  ErrorMessageEN,
  ErrorMessageZH,
  getErrorMessage
} from './error-messages.js';

// 错误工厂
export {
  createError,
  createErrorFromException,
  // JSON-RPC
  createParseError,
  createInvalidRequest,
  createMethodNotFound,
  createInvalidParams,
  createInternalError,
  // EIP-1193
  createUserRejectedError,
  createUnauthorizedError,
  createUnsupportedMethodError,
  createDisconnectedError,
  createChainDisconnectedError,
  createUnrecognizedChainError,
  // Wallet
  createWalletLockedError,
  createWalletNotInitializedError,
  createAccountNotFoundError,
  createWalletNotFoundError,
  createInvalidPasswordError,
  createMnemonicInvalidError,
  createPrivateKeyInvalidError,
  // Network
  createNetworkError,
  createNetworkTimeoutError,
  createNetworkUnavailableError,
  createRpcError,
  createInvalidChainIdError,
  // Transaction
  createTransactionFailedError,
  createTransactionRejectedError,
  createInsufficientFundsError,
  createGasEstimationFailedError,
  createNonceTooLowError,
  createReplacementUnderpricedError,
  // Signing
  createSignatureFailedError,
  createInvalidSignatureError,
  createMessageInvalidError,
  // Validation
  createInvalidAddressError,
  createInvalidAmountError,
  createInvalidDataError,
  createInvalidMessageFormatError,
  // System
  createTimeoutError,
  createStorageError,
  createEncryptionError,
  createDecryptionError,
  createCryptoError,
  createUnknownError,
} from './error-factory.js';

// 错误处理
export {
  isUserRejectedError,
  isWalletLockedError,
  isNetworkError,
  isTransactionError,
  isInsufficientFundsError,
  isValidationError,
  getUserFriendlyMessage,
  logError,
  safeExecute,
  retryExecute
} from './error-handler.js';
