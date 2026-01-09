/**
 * 错误码定义
 * 按照标准和领域分组
 */

// ==================== JSON-RPC 标准错误码 ====================
export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
};

// ==================== EIP-1193 标准错误码 ====================
export const Eip1193ErrorCode = {
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED_METHOD: 4200,
  DISCONNECTED: 4900,
  CHAIN_DISCONNECTED: 4901,
  UNRECOGNIZED_CHAIN: 4902
};

// ==================== 钱包错误码 (5000-5099) ====================
export const WalletErrorCode = {
  WALLET_LOCKED: 5001,
  WALLET_NOT_INITIALIZED: 5002,
  ACCOUNT_NOT_FOUND: 5003,
  INVALID_PASSWORD: 5004,
  MNEMONIC_INVALID: 5005,
  PRIVATE_KEY_INVALID: 5006,
  WALLET_ALREADY_EXISTS: 5007,
  ACCOUNT_ALREADY_EXISTS: 5008
};

// ==================== 网络错误码 (5100-5199) ====================
export const NetworkErrorCode = {
  NETWORK_ERROR: 5100,
  NETWORK_TIMEOUT: 5101,
  NETWORK_UNAVAILABLE: 5102,
  RPC_ERROR: 5103,
  INVALID_CHAIN_ID: 5104,
  CHAIN_NOT_SUPPORTED: 5105
};

// ==================== 交易错误码 (5200-5299) ====================
export const TransactionErrorCode = {
  TRANSACTION_FAILED: 5200,
  TRANSACTION_REJECTED: 5201,
  INSUFFICIENT_FUNDS: 5202,
  GAS_ESTIMATION_FAILED: 5203,
  NONCE_TOO_LOW: 5204,
  REPLACEMENT_UNDERPRICED: 5205,
  TRANSACTION_TIMEOUT: 5206
};

// ==================== 签名错误码 (5300-5399) ====================
export const SigningErrorCode = {
  SIGNATURE_FAILED: 5300,
  INVALID_SIGNATURE: 5301,
  MESSAGE_INVALID: 5302,
  SIGNING_REJECTED: 5303
};

// ==================== 验证错误码 (5400-5499) ====================
export const ValidationErrorCode = {
  INVALID_ADDRESS: 5400,
  INVALID_AMOUNT: 5401,
  INVALID_DATA: 5402,
  INVALID_MESSAGE_FORMAT: 5403,
  INVALID_PARAMETER: 5404
};

// ==================== 系统错误码 (5500-5599) ====================
export const SystemErrorCode = {
  TIMEOUT: 5500,
  STORAGE_ERROR: 5501,
  ENCRYPTION_ERROR: 5502,
  DECRYPTION_ERROR: 5503,
  CRYPTO_ERROR: 5504,
  UNKNOWN_ERROR: 5599
};

// ==================== 统一错误码导出 ====================
export const ErrorCode = {
  ...JsonRpcErrorCode,
  ...Eip1193ErrorCode,
  ...WalletErrorCode,
  ...NetworkErrorCode,
  ...TransactionErrorCode,
  ...SigningErrorCode,
  ...ValidationErrorCode,
  ...SystemErrorCode
};

// ==================== 错误码范围检查 ====================
export const ErrorCodeRange = {
  isJsonRpc(code) {
    return code >= -32768 && code <= -32000;
  },
  
  isEip1193(code) {
    return code >= 4000 && code < 5000;
  },
  
  isWallet(code) {
    return code >= 5000 && code < 5100;
  },
  
  isNetwork(code) {
    return code >= 5100 && code < 5200;
  },
  
  isTransaction(code) {
    return code >= 5200 && code < 5300;
  },

  isSigning(code) {
    return code >= 5300 && code < 5400;
  },
  
  isValidation(code) {
    return code >= 5400 && code < 5500;
  },
  
  isSystem(code) {
    return code >= 5500 && code < 5600;
  }
};
