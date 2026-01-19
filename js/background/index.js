/**
 * YeYing Wallet - Background Script (主入口)
 * 负责：初始化所有模块
 */

import { initMessageListeners } from './message-handler.js';
import { cleanupConnections } from './connection.js';
import { state } from './state.js';
import { updateKeepAlive } from './offscreen.js';
import { NETWORKS, DEFAULT_NETWORK } from '../config/index.js';
import { getSelectedNetworkName, getUserSetting, ensureDefaultNetworks, getNetworkConfigByKey } from '../storage/index.js';
import { normalizeChainId } from '../common/chain/index.js';
import { normalizePopupBounds } from './window-utils.js';

/**
 * 初始化 Background Script
 */
// 先注册消息监听，避免启动阶段丢消息
initMessageListeners();

async function init() {
  console.log('🚀 YeYing Wallet Background Script Starting...');

  try {
    await updateKeepAlive();
    const seededNetworks = await ensureDefaultNetworks(NETWORKS);

    // 加载保存的网络选择
    const savedNetwork = await getSelectedNetworkName();
    const savedConfig = savedNetwork ? await getNetworkConfigByKey(savedNetwork) : null;
    const defaultConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);

    if (savedConfig) {
      const chainIdHex = savedConfig.chainIdHex || normalizeChainId(savedConfig.chainId);
      state.currentChainId = chainIdHex;
      state.currentRpcUrl = savedConfig.rpcUrl || savedConfig.rpc;
      console.log('✅ Loaded saved network:', savedNetwork);
    } else if (defaultConfig) {
      const chainIdHex = defaultConfig.chainIdHex || normalizeChainId(defaultConfig.chainId);
      state.currentChainId = chainIdHex;
      state.currentRpcUrl = defaultConfig.rpcUrl || defaultConfig.rpc;
      console.log('✅ Using default network:', DEFAULT_NETWORK);
    } else if (seededNetworks?.length) {
      const fallback = seededNetworks.find(item => item?.key === DEFAULT_NETWORK || item?.id === DEFAULT_NETWORK) || seededNetworks[0];
      if (fallback) {
        const chainIdHex = fallback.chainIdHex || normalizeChainId(fallback.chainId);
        state.currentChainId = chainIdHex;
        state.currentRpcUrl = fallback.rpcUrl || fallback.rpc;
      }
      console.log('✅ Using fallback stored network:', DEFAULT_NETWORK);
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
