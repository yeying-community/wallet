/**
 * YeYing Wallet - 连接管理
 * 负责：管理与 DApp 的连接
 */
import { EventType, MessageBuilder } from '../protocol/dapp-protocol.js';
import { state } from './state.js';
import { getSelectedAccount, isAuthorized } from '../storage/index.js';

/**
 * 注册新连接
 * @param {Object} port - Chrome runtime port
 * @param {number} tabId - 标签页 ID
 * @param {string} origin - 来源
 */
export function registerConnection(port, tabId, origin) {
  console.log('🔗 New connection:', { tabId, origin });
  state.connections.set(tabId, { port, origin });
}

/**
 * 注销连接
 * @param {number} tabId - 标签页 ID
 */
export function unregisterConnection(tabId) {
  console.log('🔌 Connection disconnected:', tabId);
  state.connections.delete(tabId);
}

/**
 * 获取连接
 * @param {number} tabId - 标签页 ID
 * @returns {Object|undefined}
 */
export function getConnection(tabId) {
  return state.connections.get(tabId);
}

/**
 * 检查会话并通知
 * @param {Object} port - Chrome runtime port
 * @param {string} origin - 来源
 */
export async function checkSessionAndNotify(port, origin) {
  try {
    const connected = state.connectedSites.has(origin) || await isAuthorized(origin);
    if (!connected) {
      return;
    }

    // 获取当前账户
    const account = await getSelectedAccount();
    if (!account || !state.keyring?.has(account.id)) {
      return;
    }

    // 发送连接事件
    sendEvent(port, EventType.CONNECT, {
      chainId: state.currentChainId,
      accounts: [account.address]
    });

  } catch (error) {
    console.error('❌ Check session and notify failed:', error);
  }
}

/**
 * 发送响应
 * @param {Object} port - Chrome runtime port
 * @param {string} requestId - 请求 ID
 * @param {any} result - 结果
 */
export function sendResponse(port, requestId, result) {
  const message = MessageBuilder.createResponse(result, requestId);
  port.postMessage(message);
}

/**
 * 发送错误
 * @param {Object} error - 错误对象
 * @param {Object} port - Chrome runtime port
 * @param {string} requestId - 请求 ID
 */
export function sendError(error, port, requestId) {
  const errorMessage = MessageBuilder.createErrorResponse(error, requestId);
  port.postMessage(errorMessage);
}

/**
 * 发送事件
 * @param {Object} port - Chrome runtime port
 * @param {string} event - 事件名称
 * @param {any} data - 事件数据
 */
export function sendEvent(port, event, data) {
  const message = MessageBuilder.createEvent(event, data);
  port.postMessage(message);
}

/**
 * 广播事件到所有连接
 * @param {string} event - 事件名称
 * @param {any} data - 事件数据
 */
export function broadcastEvent(event, data) {
  const message = MessageBuilder.createEvent(event, data);

  state.connections.forEach(({ port }) => {
    try {
      port.postMessage(message);
    } catch (error) {
      console.error(`Failed to broadcast ${event}:`, error);
    }
  });
}

/**
 * 定期清理无效连接
 */
export function cleanupConnections() {
  state.connections.forEach((conn, tabId) => {
    chrome.tabs.get(tabId).catch(() => state.connections.delete(tabId));
  });
}
