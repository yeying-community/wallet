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
import { setCurrentChainKey, chainIdToChainKey } from '../chain/current-chain.js';
import { normalizeChainId } from '../common/chain/index.js';
import { normalizePopupBounds } from './window-utils.js';
import { backupSyncService } from './sync-service.js';
import { mpcService } from './mpc-service.js';
import { ensureCggmp24RuntimeInstalled } from './mpc-cggmp24-runtime.js';
import { ensureApprovalStateHydrated } from './approval-flow.js';
import { diagnostics } from './diagnostics.js';

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
    await diagnostics.init();
    await ensureApprovalStateHydrated();
    await updateKeepAlive();
    await backupSyncService.init();
    await ensureCggmp24RuntimeInstalled().catch((error) => {
      console.warn('[MPC] cggmp24 WASM runtime not available:', error?.message || error);
    });
    await mpcService.init();
    // Watchdog: a periodic alarm + a one-shot invocation on init covers the
    // Service Worker restart window (alarm lag up to 1 minute). The alarm is
    // created idempotently so onInstalled/onStartup handlers do not race.
    await mpcService._recoverStaleAuxInfoSessions().catch(() => null);
    if (chrome?.alarms?.create) {
      try {
        await chrome.alarms.create('mpc-aux-info-watchdog', { periodInMinutes: 1 });
      } catch (error) {
        console.warn('[MPC] failed to register aux-info watchdog alarm:', error?.message || error);
      }
    }
    const seededNetworks = await ensureDefaultNetworks(NETWORKS);

    // 加载保存的网络选择
    const savedNetwork = await getSelectedNetworkName();
    const savedConfig = savedNetwork ? await getNetworkConfigByKey(savedNetwork) : null;
    const defaultConfig = await getNetworkConfigByKey(DEFAULT_NETWORK);

    if (savedConfig) {
      // Tron 等非 EVM 链没有 numeric chainId，但携带 `chainKey` 字段
      // （CAIP-2 `tron:<reference>`）；直接 setCurrentChainKey 让 EVM 派生
      // helper 在非 EVM 链上返回 null。
      if (savedConfig.chainKey) {
        setCurrentChainKey(savedConfig.chainKey);
      } else {
        const chainIdHex = savedConfig.chainIdHex || normalizeChainId(savedConfig.chainId);
        setCurrentChainKey(chainIdToChainKey(chainIdHex));
      }
      state.currentRpcUrl = savedConfig.rpcUrl || savedConfig.rpc || savedConfig.tronRpcUrl;
      console.log('✅ Loaded saved network:', savedNetwork);
    } else if (defaultConfig) {
      if (defaultConfig.chainKey) {
        setCurrentChainKey(defaultConfig.chainKey);
      } else {
        const chainIdHex = defaultConfig.chainIdHex || normalizeChainId(defaultConfig.chainId);
        setCurrentChainKey(chainIdToChainKey(chainIdHex));
      }
      state.currentRpcUrl = defaultConfig.rpcUrl || defaultConfig.rpc || defaultConfig.tronRpcUrl;
      console.log('✅ Using default network:', DEFAULT_NETWORK);
    } else if (seededNetworks?.length) {
      const fallback = seededNetworks.find(item => item?.key === DEFAULT_NETWORK || item?.id === DEFAULT_NETWORK) || seededNetworks[0];
      if (fallback) {
        if (fallback.chainKey) {
          setCurrentChainKey(fallback.chainKey);
        } else {
          const chainIdHex = fallback.chainIdHex || normalizeChainId(fallback.chainId);
          setCurrentChainKey(chainIdToChainKey(chainIdHex));
        }
        state.currentRpcUrl = fallback.rpcUrl || fallback.rpc || fallback.tronRpcUrl;
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
init().catch((error) => {
  console.error('❌ Background init failed:', error);
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
  console.log('🚀 Extension startup');
});

// Aux-info wall-clock watchdog. Each tick reconverges any aux-info `running`
// wallets whose deadline elapsed without a live pump (e.g. after a Service
// Worker restart) and triggers a generational retry via the service. The
// alarm name is hardcoded here and mirrored in `mpc-service.js`.
chrome?.alarms?.onAlarm?.addListener?.((alarm) => {
  if (!alarm || alarm.name !== 'mpc-aux-info-watchdog') return;
  mpcService._recoverStaleAuxInfoSessions().catch((error) => {
    console.warn('[MPC] aux-info watchdog recovery failed:', error?.message || error);
  });
});
