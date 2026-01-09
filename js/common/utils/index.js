/**
 * 统一导出 - 工具函数集合
 */

// HTML 处理
export {
  escapeHtml,
  stripHtml,
  nl2br,
  br2nl,
  truncateText,
  trim,
  normalizeSpaces,
  capitalizeFirst,
  capitalizeWords,
  camelToKebab,
  kebabToCamel,
  snakeToCamel,
  camelToSnake,
  removeWhitespace,
  repeatString,
  padString,
  templateReplace,
} from './html-utils.js';

// 地址处理
export {
  isValidAddress,
  isValidAddressCaseInsensitive,
  isValidChecksum,
  isContractAddress,
  normalizeAddress,
  isEOAAddress,
  shortenAddress,
  addChecksum,
  isSameAddress,
  generateAvatar,
  getAvatarDataUrl,
  isValidEnsName,
  isValidUnstoppableDomain,
  validateAddressOrEns,
} from './address-utils.js';

// 剪贴板操作
export {
  copyToClipboard,
  readFromClipboard,
  copyHtmlToClipboard,
  copyImageToClipboard,
  copyAddressToClipboard,
  copyTxHashToClipboard,
  copyMnemonicToClipboard,
  copyPrivateKeyToClipboard,
  getClipboardPermissionStatus,
  requestClipboardPermission,
} from './clipboard-utils.js';

// 二维码生成
export {
  generateQRCode,
  generateAddressQRCode,
  generateTransactionQRCode,
  generateEthereumUri,
  parseEthereumUri,
  generateTokenTransferQRCode,
  generateTokenTransferData,
  getQRCodeDataUrl,
} from './qrcode-utils.js';

// ChainId 和十六进制处理
export {
  KNOWN_CHAIN_IDS,
  normalizeChainId,
  getChainName,
  chainIdToNumber,
  isValidChainId,
  isValidHex,
  isValidHexWithoutPrefix,
  isValidPrivateKey,
  isValidMnemonic,
  isValidTxHash,
  isValidBlockHash,
  isValidTopic,
  isValidData,
  hexToDecimal,
  decimalToHex,
  hexToBytes,
  bytesToHex,
  hexToUtf8,
  utf8ToHex,
  removeHexPrefix,
  addHexPrefix,
  padHex,
  truncateHex,
  isSameHex,
} from './chain-utils.js';

// ID 和时间戳
export {
  generateId,
  generateShortId,
  generateUUID,
  generateNanoId,
  getTimestamp,
  getTimestampSeconds,
  formatDate,
  formatDateOnly,
  formatTimeOnly,
  formatDuration,
  isTimeout,
  isValidTimestamp,
  getStartOfDay,
  getEndOfDay,
  getStartOfWeek,
  getStartOfMonth,
  getEndOfMonth,
  parseTimeString,
} from './id-utils.js';

// 对象操作
export {
  pick,
  omit,
  deepFreeze,
  deepClone,
  deepMerge,
  shallowMerge,
  getNestedValue,
  setNestedValue,
  deleteNestedValue,
  hasNestedProperty,
  objectToArray,
  arrayToObject,
  filterObject,
  mapObject,
  forEachObject,
  isEmptyObject,
  getObjectSize,
  invertObject,
  createPlainObject,
} from './object-utils.js';

// JSON 处理
export {
  safeJsonParse,
  safeJsonStringify,
  jsonClone,
  formatJson,
  minifyJson,
  isValidJson,
  extractJsonFields,
  omitJsonFields,
  mergeJson,
  getJsonSize,
  formatJsonSize,
  serializeBigInt,
  deserializeBigInt,
  stringifyWithBigInt,
  parseWithBigInt,
  serializeDate,
  deserializeDate,
  stringifyWithDate,
  parseWithDate,
  serializeSet,
  deserializeSet,
  serializeMap,
  deserializeMap
} from './json-utils.js';

// 错误处理
export {
  getErrorName,
  getErrorMessage,
  getErrorStack,
  getFullErrorMessage,
  createError,
  createValidationError,
  createApiError,
  createNetworkError,
  isErrorType,
  isValidationError,
  isNetworkError,
  isTimeoutError,
  isPermissionError,
  formatErrorForLog,
  logError,
  safeCall,
  safeAsyncCall,
  wrapWithErrorHandler,
  wrapWithAsyncErrorHandler,
  showErrorToast,
  getUserFriendlyError,
  getErrorCode,
  isKnownError
} from './error-utils.js';

// 异步工具
export {
  delay,
  cancellableDelay,
  waitUntil,
  waitUntilOrTimeout,
  retry,
  retryWithBackoff,
  parallel,
  parallelWithErrors,
  parallelLimit,
  sequence,
  withTimeout,
  withTimeoutResult,
  race,
  settle,
  promisify,
  promisifyNodeStyle,
  sleep,
  asyncMap,
  asyncFilter,
  asyncReduce,
  AsyncQueue,
  Semaphore
} from './async-utils.js';

// 数值格式化
export {
  formatNumber,
  formatNumberZh,
  formatCurrency,
  formatPercent,
  formatPercentWithColor,
  formatScientific,
  formatCompact,
  formatCompactZh,
  formatBytes,
  formatTimeLength,
  formatDistance,
  formatPercentChange,
  formatPrecision,
  randomRange,
  randomInt,
  randomBool,
  randomColor,
  randomString,
  padNumber,
  scaleNumber,
  clampNumber,
  isInRange,
  numberToChinese,
  toRoman,
  numberToLetter,
  toOrdinal,
  toChineseOrdinal
} from './number-utils.js';
