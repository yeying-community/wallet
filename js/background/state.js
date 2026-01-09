/**
 * YeYing Wallet - 全局状态管理
 * 负责：管理所有全局状态
 */

import { NETWORKS, DEFAULT_NETWORK } from '../config/index.js';

/**
 * 全局状态对象
 */
export const state = {
  // 网络状态
  currentChainId: NETWORKS[DEFAULT_NETWORK].chainIdHex,
  currentRpcUrl: NETWORKS[DEFAULT_NETWORK].rpc,

  // 连接管理
  connectedSites: new Map(),      // origin => { accounts, chainId, connectedAt }
  connections: new Map(),          // tabId => { port, origin }

  // 请求管理
  pendingRequests: new Map(),      // requestId => { type, data, timestamp }

  // 弹窗位置
  popupBounds: null,               // { left, top, screen }

  // 🔐 密钥管理（仅在内存中）
  keyring: null,                   // Map<accountId, WalletInstance>
  lockTimer: null,                 // 自动锁定计时器

  // 🔑 密码缓存（限时 60 秒）
  passwordCache: null,             // 缓存的密码
  passwordCacheTimer: null,        // 密码缓存过期计时器
};

/**
 * 重置状态（用于测试）
 */
export function resetState() {
  state.currentChainId = NETWORKS[DEFAULT_NETWORK].chainIdHex;
  state.currentRpcUrl = NETWORKS[DEFAULT_NETWORK].rpc;
  state.connectedSites.clear();
  state.connections.clear();
  state.pendingRequests.clear();
  state.keyring = null;
  state.lockTimer = null;
  state.passwordCache = null;
  state.passwordCacheTimer = null;
}
