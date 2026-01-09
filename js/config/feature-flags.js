/**
 * 功能开关配置
 */

// ==================== 功能开关 ====================
export const FEATURES = {
  // 兼容性
  ENABLE_LEGACY_SUPPORT: true,           // 支持旧消息格式
  ENABLE_BACKWARD_COMPATIBILITY: true,   // 向后兼容
  
  // 日志和监控
  ENABLE_MESSAGE_LOGGING: true,          // 消息日志
  ENABLE_PERFORMANCE_MONITORING: false,  // 性能监控
  ENABLE_ERROR_REPORTING: true,          // 错误报告
  ENABLE_ANALYTICS: false,               // 分析统计
  
  // 验证
  STRICT_VALIDATION: false,              // 严格验证模式
  ENABLE_ADDRESS_VALIDATION: true,       // 地址验证
  ENABLE_TRANSACTION_VALIDATION: true,   // 交易验证
  
  // 安全
  ENABLE_AUTO_LOCK: true,                // 自动锁定
  ENABLE_BIOMETRIC_AUTH: false,          // 生物识别认证
  ENABLE_HARDWARE_WALLET: false,         // 硬件钱包支持
  REQUIRE_PASSWORD_ON_SEND: true,        // 发送时需要密码
  
  // 网络
  ENABLE_CUSTOM_NETWORKS: true,          // 自定义网络
  ENABLE_NETWORK_SWITCHING: true,        // 网络切换
  ENABLE_MULTI_CHAIN: true,              // 多链支持
  
  // 代币
  ENABLE_TOKEN_DETECTION: true,          // 代币检测
  ENABLE_NFT_SUPPORT: false,             // NFT 支持
  ENABLE_TOKEN_SWAP: false,              // 代币交换
  
  // UI
  ENABLE_DARK_MODE: true,                // 深色模式
  ENABLE_ANIMATIONS: true,               // 动画效果
  ENABLE_NOTIFICATIONS: true,            // 通知
  ENABLE_TOOLTIPS: true,                 // 工具提示
  
  // 高级功能
  ENABLE_ADVANCED_MODE: false,           // 高级模式
  ENABLE_DEVELOPER_MODE: false,          // 开发者模式
  ENABLE_EXPERIMENTAL_FEATURES: false    // 实验性功能
};

// ==================== 实验性功能 ====================
export const EXPERIMENTAL_FEATURES = {
  ENABLE_ACCOUNT_ABSTRACTION: false,     // 账户抽象
  ENABLE_SOCIAL_RECOVERY: false,         // 社交恢复
  ENABLE_GASLESS_TRANSACTIONS: false,    // 无 Gas 交易
  ENABLE_BATCH_TRANSACTIONS: false,      // 批量交易
  ENABLE_SCHEDULED_TRANSACTIONS: false   // 定时交易
};

// ==================== 开发者功能 ====================
export const DEVELOPER_FEATURES = {
  ENABLE_DEBUG_MODE: false,              // 调试模式
  ENABLE_CONSOLE_LOGS: false,            // 控制台日志
  ENABLE_NETWORK_INSPECTOR: false,       // 网络检查器
  ENABLE_STATE_INSPECTOR: false,         // 状态检查器
  ENABLE_MOCK_DATA: false               // 模拟数据
};

// ==================== 工具函数 ====================

/**
 * 检查功能是否启用
 * @param {string} featureName - 功能名称
 * @returns {boolean}
 */
export function isFeatureEnabled(featureName) {
  return FEATURES[featureName] === true;
}

/**
 * 检查实验性功能是否启用
 * @param {string} featureName - 功能名称
 * @returns {boolean}
 */
export function isExperimentalFeatureEnabled(featureName) {
  return FEATURES.ENABLE_EXPERIMENTAL_FEATURES && 
         EXPERIMENTAL_FEATURES[featureName] === true;
}

/**
 * 检查开发者功能是否启用
 * @param {string} featureName - 功能名称
 * @returns {boolean}
 */
export function isDeveloperFeatureEnabled(featureName) {
  return FEATURES.ENABLE_DEVELOPER_MODE && 
         DEVELOPER_FEATURES[featureName] === true;
}

/**
 * 启用功能
 * @param {string} featureName - 功能名称
 */
export function enableFeature(featureName) {
  if (featureName in FEATURES) {
    FEATURES[featureName] = true;
  }
}

/**
 * 禁用功能
 * @param {string} featureName - 功能名称
 */
export function disableFeature(featureName) {
  if (featureName in FEATURES) {
    FEATURES[featureName] = false;
  }
}

/**
 * 切换功能状态
 * @param {string} featureName - 功能名称
 * @returns {boolean} 新的状态
 */
export function toggleFeature(featureName) {
  if (featureName in FEATURES) {
    FEATURES[featureName] = !FEATURES[featureName];
    return FEATURES[featureName];
  }
  return false;
}

/**
 * 获取所有启用的功能
 * @returns {string[]}
 */
export function getEnabledFeatures() {
  return Object.entries(FEATURES)
    .filter(([_, enabled]) => enabled)
    .map(([name]) => name);
}

/**
 * 获取所有禁用的功能
 * @returns {string[]}
 */
export function getDisabledFeatures() {
  return Object.entries(FEATURES)
    .filter(([_, enabled]) => !enabled)
    .map(([name]) => name);
}

/**
 * 批量设置功能
 * @param {Object} features - 功能配置对象
 */
export function setFeatures(features) {
  Object.entries(features).forEach(([name, enabled]) => {
    if (name in FEATURES) {
      FEATURES[name] = enabled;
    }
  });
}

/**
 * 重置所有功能到默认状态
 */
export function resetFeatures() {
  // 这里需要保存默认配置的副本
  // 实际使用时可以从配置文件重新加载
  console.warn('resetFeatures: Not implemented');
}

/**
 * 检查功能依赖
 * @param {string} featureName - 功能名称
 * @returns {{satisfied: boolean, missing: string[]}}
 */
export function checkFeatureDependencies(featureName) {
  const dependencies = {
    ENABLE_NFT_SUPPORT: ['ENABLE_TOKEN_DETECTION'],
    ENABLE_TOKEN_SWAP: ['ENABLE_CUSTOM_NETWORKS'],
    ENABLE_BIOMETRIC_AUTH: ['ENABLE_AUTO_LOCK'],
    ENABLE_HARDWARE_WALLET: ['ENABLE_ADVANCED_MODE']
  };
  
  const required = dependencies[featureName] || [];
  const missing = required.filter(dep => !FEATURES[dep]);
  
  return {
    satisfied: missing.length === 0,
    missing
  };
}

