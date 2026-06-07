/**
 * YeYing Wallet - Content Script
 * 职责：在页面和 background 之间转发消息（纯中继层）
 */

(async function () {
  'use strict';

  const {
    MESSAGE_TYPE,
    PORT_NAME,
    MessageCategory,
    EventType,
    MessageBuilder
  } = await import(chrome.runtime.getURL('js/protocol/dapp-protocol.js'));

  console.log('🌉 Content script bridge loading...');

  // ==================== 协议常量 ====================

  const MAX_RECONNECT_ATTEMPTS = 3;
  const RECONNECT_DELAY_BASE = 1000; // 基础延迟 1 秒
  const QUEUE_MAX_AGE = 15000; // 请求排队超时
  const QUEUE_MAX_SIZE = 100; // 最大排队请求数
  const bridgeToken =
    `${chrome.runtime.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  // ==================== 注入 inject.js ====================

  function injectScript() {
    const script = document.createElement('script');
    script.type = 'module';
    const url = new URL(chrome.runtime.getURL('inject.js'));
    url.searchParams.set('bridgeToken', bridgeToken);
    script.src = url.toString();
    script.onload = function () {
      console.log('✅ inject.js loaded');
      this.remove();
    };
    script.onerror = function () {
      console.error('❌ Failed to load inject.js');
    };

    (document.head || document.documentElement).appendChild(script);
  }

  injectScript();

  // ==================== 连接管理 ====================

  let port = null;
  let reconnectAttempts = 0;
  const requestQueue = new Map();

  function initConnection() {
    // 检查扩展上下文是否有效
    if (!chrome.runtime?.id) {
      console.error('❌ Extension context invalidated');
      sendEventToPage(EventType.DISCONNECT, {
        reason: 'extension_context_invalidated'
      });
      return;
    }

    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
      reconnectAttempts = 0;

      port.onMessage.addListener(handleBackgroundMessage);
      port.onDisconnect.addListener(handleDisconnect);

      console.log('✅ Bridge connected to background');

      flushQueuedRequests();
    } catch (error) {
      console.error('❌ Connection failed:', error);
      port = null;

      // 重试连接
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = RECONNECT_DELAY_BASE * reconnectAttempts;
        console.log(
          `🔄 Reconnecting in ${delay}ms... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
        );
        setTimeout(initConnection, delay);
      } else {
        console.error('❌ Max reconnection attempts reached');
        sendEventToPage(EventType.DISCONNECT, {
          reason: 'max_reconnect_attempts'
        });
      }
    }
  }

  function handleDisconnect() {
    console.warn('⚠️ Port disconnected');

    const error = chrome.runtime.lastError;
    if (error) {
      console.error('Runtime error:', error.message);
    }

    port = null;

    const reason = error?.message || 'port_disconnected';
    if (reason.includes('Extension context invalidated')) {
      sendEventToPage(EventType.DISCONNECT, {
        reason: 'extension_context_invalidated'
      });
      return;
    }

    // 重试连接
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      const delay = RECONNECT_DELAY_BASE * reconnectAttempts;
      console.log(
        `🔄 Reconnecting in ${delay}ms... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
      );
      setTimeout(initConnection, delay);
    } else {
      console.error('❌ Max reconnection attempts reached');
      sendEventToPage(EventType.DISCONNECT, {
        reason: 'max_reconnect_attempts'
      });
    }
  }

  function flushQueuedRequests() {
    if (!port || requestQueue.size === 0) return;

    const now = Date.now();
    requestQueue.forEach(({ message, queuedAt }, requestId) => {
      if (now - queuedAt > QUEUE_MAX_AGE) {
        sendErrorToPage(requestId, {
          code: 4900,
          message: 'Wallet connection timed out. Please retry.'
        });
        requestQueue.delete(requestId);
        return;
      }

      try {
        port.postMessage(message);
      } catch (error) {
        console.error('❌ Failed to flush queued message:', error);
        sendErrorToPage(requestId, {
          code: -32603,
          message: `Failed to send message: ${error.message}`
        });
      } finally {
        requestQueue.delete(requestId);
      }
    });
  }

  // ==================== 消息处理 ====================

  function handleBackgroundMessage(message) {
    if (message?.type !== MESSAGE_TYPE) return;

    console.log('📬 Bridge received from background:', message);

    // 只把本 content bridge 处理过的请求响应回传给页面。
    window.postMessage(withBridgeToken(message), '*');
  }

  function handlePageMessage(event) {
    // 只处理来自当前页面的消息
    if (event.source !== window) return;

    const message = event.data;

    // 只处理 YEYING_MESSAGE
    if (message?.type !== MESSAGE_TYPE) return;

    if (message.metadata?.bridgeToken !== bridgeToken) {
      return;
    }

    console.log('📨 Bridge received from page:', message);

    // 只转发请求到 background
    if (message.category !== MessageCategory.REQUEST) {
      console.log('⏭️ Ignoring non-request message:', message.category);
      return;
    }

    // 检查连接
    if (!port) {
      const requestId = message.metadata?.id;
      if (!requestId) {
        console.error('❌ Port not connected and requestId missing');
        sendErrorToPage(null, {
          code: 4900,
          message: 'Wallet not connected. Please refresh the page.'
        });
        return;
      }

      if (requestQueue.size >= QUEUE_MAX_SIZE) {
        sendErrorToPage(requestId, {
          code: 4900,
          message: 'Wallet is reconnecting. Please retry shortly.'
        });
        return;
      }

      if (!requestQueue.has(requestId)) {
        requestQueue.set(requestId, { message, queuedAt: Date.now() });
      }
      return;
    }

    // 转发到 background
    try {
      port.postMessage(message);
    } catch (error) {
      console.error('❌ Failed to send message:', error);
      sendErrorToPage(message.metadata?.id, {
        code: -32603,
        message: `Failed to send message: ${error.message}`
      });
    }
  }

  // ==================== 辅助函数 ====================

  function sendEventToPage(event, data) {
    const message = MessageBuilder.createEvent(event, data);
    window.postMessage(withBridgeToken(message), '*');
  }

  function sendErrorToPage(requestId, error) {
    const message = MessageBuilder.createErrorResponse(error, requestId);
    window.postMessage(withBridgeToken(message), '*');
  }

  function withBridgeToken(message) {
    return {
      ...message,
      metadata: {
        ...(message.metadata || {}),
        bridgeToken
      }
    };
  }

  // ==================== 监听广播事件 ====================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPE) return;

    console.log('📬 Content script received broadcast:', message);

    // 转发事件到页面
    if (message.category === MessageCategory.EVENT) {
      window.postMessage(withBridgeToken(message), '*');
      sendResponse({ success: true });
      return true; // 保持消息通道开启
    }
  });

  // ==================== 启动 ====================

  window.addEventListener('message', handlePageMessage);
  initConnection();

  console.log('✅ Content script bridge ready');
})();
