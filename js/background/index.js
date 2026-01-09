/**
 * YeYing Wallet - Background Script (主入口)
 * 负责：初始化所有模块
 */

import { initMessageListeners } from './message-handler.js';
import { cleanupConnections } from './connection.js';
import { state } from './state.js';
import { NETWORKS, DEFAULT_NETWORK } from '../config/index.js';
import { getSelectedNetworkName, getUserSetting } from '../storage/index.js';
import { normalizePopupBounds } from './window-utils.js';

/**
 * 初始化 Background Script
 */
// 先注册消息监听，避免启动阶段丢消息
initMessageListeners();

async function init() {
  console.log('🚀 YeYing Wallet Background Script Starting...');

  try {
    // 加载保存的网络选择
    const savedNetwork = await getSelectedNetworkName();
    if (savedNetwork && NETWORKS[savedNetwork]) {
      state.currentChainId = NETWORKS[savedNetwork].chainIdHex;
      state.currentRpcUrl = NETWORKS[savedNetwork].rpcUrl || NETWORKS[savedNetwork].rpc;
      console.log('✅ Loaded saved network:', savedNetwork);
    } else {
      state.currentChainId = NETWORKS[DEFAULT_NETWORK].chainIdHex;
      state.currentRpcUrl = NETWORKS[DEFAULT_NETWORK].rpcUrl || NETWORKS[DEFAULT_NETWORK].rpc;
      console.log('✅ Using default network:', DEFAULT_NETWORK);
    }

    const savedPopupBounds = await getUserSetting('popupBounds', null);
    const normalizedPopupBounds = normalizePopupBounds(savedPopupBounds);
    if (normalizedPopupBounds) {
      state.popupBounds = normalizedPopupBounds;
    }

    // 定期清理无效连接（每分钟）
    setInterval(cleanupConnections, 60000);

    console.log('✅ YeYing Wallet Background Script Initialized');

  } catch (error) {
    console.error('❌ Failed to initialize background script:', error);
  }
}

// 启动
init();

// 监听扩展安装/更新
chrome.runtime.onInstalled.addListener((details) => {
  console.log('📦 Extension installed/updated:', details.reason);

  if (details.reason === 'install') {
    console.log('🎉 First time installation');
    // 可以在这里打开欢迎页面
  } else if (details.reason === 'update') {
    console.log('🔄 Extension updated');
  }
});
