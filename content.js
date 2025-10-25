(function () {
  'use strict';

  console.log('🌉 Content script bridge loading...');

  // 1. 注入 inpage.js 到页面
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = function () {
    console.log('✅ inpage.js loaded');
    this.remove();
  };
  script.onerror = function () {
    console.error('❌ Failed to load inject.js');
  };

  (document.head || document.documentElement).appendChild(script);

  // 2. 建立与 background 的连接
  let port = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 3;

  function initConnection() {
    if (!chrome.runtime || !chrome.runtime.id) {
      console.error('❌ Extension context invalidated');
      return;
    }

    try {
      port = chrome.runtime.connect({ name: 'yeying-wallet' });
      reconnectAttempts = 0;

      port.onMessage.addListener((message) => {
        // 转发响应到页面
        window.postMessage({
          type: 'YEYING_RESPONSE',
          requestId: message.requestId,
          result: message.result,
          error: message.error
        }, '*');
      });

      port.onDisconnect.addListener(() => {
        console.warn('⚠️ Port disconnected');
        port = null;

        if (chrome.runtime.lastError) {
          console.error('Runtime error:', chrome.runtime.lastError.message);
        }

        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          console.log(`🔄 Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`);
          setTimeout(initConnection, 1000 * reconnectAttempts);
        }
      });

      console.log('✅ Bridge connected to background');
    } catch (error) {
      console.error('❌ Connection failed:', error);
      port = null;

      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        setTimeout(initConnection, 2000 * reconnectAttempts);
      }
    }
  }

  initConnection();

  // 3. 监听来自页面的请求
  window.addEventListener('message', (event) => {
    // 只处理来自当前页面的消息
    if (event.source !== window) return;
    if (event.data.type !== 'YEYING_REQUEST') return;

    const { requestId, method, params } = event.data;

    console.log('📨 Bridge received request:', method);

    // 检查连接
    if (!port) {
      console.error('❌ Port not connected');
      window.postMessage({
        type: 'YEYING_RESPONSE',
        requestId,
        error: 'Wallet not connected. Please refresh the page.'
      }, '*');
      return;
    }

    // 转发到 background
    try {
      port.postMessage({ method, params, requestId });
    } catch (error) {
      console.error('❌ Failed to send message:', error);
      window.postMessage({
        type: 'YEYING_RESPONSE',
        requestId,
        error: error.message
      }, '*');
    }
  });

  // 监听来自 background 的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('📬 Content script received:', message.type);

    // 🔥 转发账户变更到页面
    if (message.type === 'ACCOUNTS_CHANGED') {
      window.postMessage({
        type: 'ACCOUNTS_CHANGED',
        accounts: message.accounts
      }, '*');
      sendResponse({ success: true });
      return;
    }

    // 🔥 转发链变更到页面
    if (message.type === 'CHAIN_CHANGED') {
      window.postMessage({
        type: 'CHAIN_CHANGED',
        chainId: message.chainId
      }, '*');
      sendResponse({ success: true });
      return;
    }
  });

  console.log('✅ Content script bridge ready');
})();
