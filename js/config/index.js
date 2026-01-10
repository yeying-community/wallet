/**
 * 配置模块统一导出
 */

// 应用配置
export {
  APP_NAME,
  VERSION,
  PROTOCOL_VERSION,
  APP_METADATA,
  LOG_LEVEL,
  LOG_CONFIG,
  LIMITS,
  getVersionInfo,
  isVersionCompatible,
  getLogLevelPriority,
  shouldLog
} from './app-config.js';

// 网络配置
export {
  DEFAULT_NETWORK,
  NETWORKS,
  NETWORK_TYPES,
  RPC_CONFIG,
  getNetworkConfig,
  getDefaultNetworkConfig,
  getNetworkByChainId,
  getNetworkNameByChainId,
  isNetworkSupported,
  getSupportedNetworks,
  getAllNetworks,
  getMainnets,
  getTestnets,
  formatNetworkConfig,
  isSameNetwork,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  getExplorerBlockUrl
} from './network-config.js';


// UI 配置
export {
  UI_CONFIG,
  POPUP_DIMENSIONS,
  THEME,
  COLORS,
  FORMAT_CONFIG,
  PAGINATION,
  FORM_CONFIG,
  NOTIFICATION_CONFIG
} from './ui-config.js';

// 交易配置
export {
  TRANSACTION_CONFIG,
  GAS_CONFIG,
  TRANSACTION_TYPES,
  TRANSACTION_STATUS,
  getDefaultGasLimit,
  calculateGasPrice,
  validateGasLimit,
  validateGasPrice,
  calculateTransactionFee,
  calculateEIP1559Fee,
  validateEIP1559Fee,
  formatTransactionStatus,
  estimateConfirmationTime,
  getGasPriceLevels
} from './transaction-config.js';

// 超时配置
export {
  TIMEOUTS,
  RECONNECT_CONFIG,
  RETRY_CONFIG,
  POLLING_CONFIG,
  CACHE_CONFIG,
  getTimeout,
  calculateReconnectDelay,
  calculateRetryDelay,
  shouldRetry,
  withTimeout,
  withRetry,
  createPoller,
  debounce,
  throttle
} from './timeout-config.js';


// 存储键
export {
  LOCAL_KEYS,
  SESSION_KEYS,
  CHROME_KEYS,
  KEY_PREFIXES,
  getAccountKey,
  getNetworkKey,
  getTokenKey,
  getTransactionKey,
  getSiteKey,
  getCacheKey,
  isSensitiveKey,
  shouldClearOnSessionEnd,
  getSensitiveKeys,
  getSessionKeys,
  getLocalKeys
} from './storage-keys.js';


// 功能开关
export {
  FEATURES,
  EXPERIMENTAL_FEATURES,
  DEVELOPER_FEATURES,
  isFeatureEnabled,
  isExperimentalFeatureEnabled,
  isDeveloperFeatureEnabled,
  enableFeature,
  disableFeature,
  toggleFeature,
  getEnabledFeatures,
  getDisabledFeatures,
  setFeatures,
  resetFeatures,
  checkFeatureDependencies
} from './feature-flags.js';


// 验证规则
export {
  ADDRESS_VALIDATION,
  TRANSACTION_VALIDATION,
  NETWORK_VALIDATION,
  TOKEN_VALIDATION,
  INPUT_VALIDATION,
  validateEthereumAddress,
  validateTransaction,
  validateNetworkConfig,
  validateTokenConfig,
  validateAccountName,
  validateContactName,
  validateLabel,
  validateNote,
  sanitizeInput,
  validateUrl,
  validateNumberRange
} from './validation-rules.js';

