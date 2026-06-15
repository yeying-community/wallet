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
import { backupSyncService } from './sync-service.js';
import { mpcService } from './mpc-service.js';
import { ensureApprovalStateHydrated } from './approval-flow.js';

const INJECTABLE_TAB_URLS = [
  'http://*/*',
  'https://*/*'
];

/**
 * 初始化 Background Script
 */
// 先注册消息监听，避免启动阶段丢消息
initMessageListeners();

async function init() {
  console.log('🚀 YeYing Wallet Background Script Starting...');

  try {
    await ensureApprovalStateHydrated();
    await updateKeepAlive();
    await backupSyncService.init();
    await mpcService.init();
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
init()
  .then(() => reinjectContentScripts('background_init'))
  .catch((error) => {
    console.warn('⚠️ Background init finished with reinjection skipped:', error);
  });

async function reinjectContentScripts(reason) {
  if (!chrome.scripting?.executeScript) {
    console.warn('⚠️ chrome.scripting API unavailable, skip content reinjection');
    return;
  }

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: INJECTABLE_TAB_URLS });
  } catch (error) {
    console.warn('⚠️ Failed to query tabs for content reinjection:', error);
    return;
  }

  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id || !tab.url) return;

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: false },
          files: ['content.js']
        });
        console.log('✅ Re-injected content script:', reason, tab.id, tab.url);
      } catch (error) {
        console.warn('⚠️ Failed to re-inject content script:', tab.id, tab.url, error);
      }
    })
  );
}

// 监听扩展安装/更新
chrome.runtime.onInstalled.addListener((details) => {
  console.log('📦 Extension installed/updated:', details.reason);

  if (details.reason === 'install') {
    console.log('🎉 First time installation');
    // 可以在这里打开欢迎页面
  } else if (details.reason === 'update') {
    console.log('🔄 Extension updated');
  }

  if (details.reason === 'install' || details.reason === 'update') {
    reinjectContentScripts(details.reason);
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log('🚀 Extension startup, checking existing tabs');
  reinjectContentScripts('startup');
});
