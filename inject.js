/**
 * YeYing Wallet - Inject Script (Page Context)
 * 实现 EIP-1193 标准的 Ethereum Provider
 * 职责：纯粹的消息转发层，不处理业务逻辑
 */

import {
  PROTOCOL_VERSION,
  MESSAGE_TYPE,
  MessageCategory,
  EventType,
  MessageBuilder
} from './js/protocol/protocol.js';

(function () {
  'use strict';

  console.log('🔌 YeYing Wallet Provider initializing...');

  // ==================== 防止重复注入 ====================
  if (window.ethereum && window.ethereum.isYeYing) {
    console.warn('⚠️ YeYing Provider already injected');
    return;
  }

  // ==================== 协议常量 ====================

  const REQUEST_TIMEOUT = 60000; // 60秒

  const PROVIDER_INFO = {
    name: 'YeYing Wallet',
    version: PROTOCOL_VERSION,
    isYeYing: true,
    isMetaMask: false // 明确标识不是 MetaMask
  };

  // ==================== 错误类 ====================

  class ProviderRpcError extends Error {
    constructor(code, message, data) {
      super(message);
      this.code = code;
      this.data = data;
      this.name = 'ProviderRpcError';
    }
  }

  // ==================== 事件发射器 ====================

  class EventEmitter {
    constructor() {
      this._events = {};
    }

    on(event, listener) {
      if (!this._events[event]) {
        this._events[event] = [];
      }
      this._events[event].push(listener);
      return this;
    }

    once(event, listener) {
      const onceWrapper = (...args) => {
        listener(...args);
        this.off(event, onceWrapper);
      };
      return this.on(event, onceWrapper);
    }

    off(event, listener) {
      if (!this._events[event]) return this;

      if (!listener) {
        delete this._events[event];
        return this;
      }

      const index = this._events[event].indexOf(listener);
      if (index > -1) {
        this._events[event].splice(index, 1);
      }
      return this;
    }

    emit(event, ...args) {
      if (!this._events[event]) return false;

      this._events[event].forEach(listener => {
        try {
          listener(...args);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
      return true;
    }

    removeAllListeners(event) {
      if (event) {
        delete this._events[event];
      } else {
        this._events = {};
      }
      return this;
    }

    listenerCount(event) {
      return this._events[event] ? this._events[event].length : 0;
    }
  }

  // ==================== Provider 实现 ====================

  class YeYingProvider extends EventEmitter {
    constructor() {
      super();

      // Provider 标识
      Object.assign(this, PROVIDER_INFO);

      // 状态（仅用于 getter，实际状态由 background 管理）
      this._state = {
        accounts: [],
        chainId: null,
        isConnected: false
      };

      // 待处理的请求
      this._pendingRequests = new Map();

      // 初始化
      this._initialize();
    }

    // ==================== 初始化 ====================

    _initialize() {
      console.log('🔧 Initializing YeYing Provider...');

      // 监听来自 content script 的消息
      window.addEventListener('message', this._handleMessage.bind(this));

      // 请求初始状态
      this._requestInitialState();

      console.log('✅ YeYing Provider initialized');
    }

    _handleMessage(event) {
      // 只处理来自当前窗口的消息
      if (event.source !== window) return;

      const message = event.data;

      // 只处理 YEYING_MESSAGE
      if (message?.type !== MESSAGE_TYPE) return;

      console.log('📥 Provider received:', message);

      const { category } = message;

      if (category === MessageCategory.RESPONSE) {
        this._handleResponse(message);
      } else if (category === MessageCategory.EVENT) {
        this._handleEvent(message);
      }
    }

    _handleResponse(message) {
      const requestId = message.metadata?.requestId || message.metadata?.id;
      const pending = this._pendingRequests.get(requestId);

      if (!pending) {
        console.warn('⚠️ Received response for unknown request:', requestId);
        return;
      }

      clearTimeout(pending.timeoutId);
      this._pendingRequests.delete(requestId);

      // 检查是否有错误
      if (message.payload?.error) {
        const error = message.payload.error;
        pending.reject(
          new ProviderRpcError(error.code, error.message, error.data)
        );
      } else {
        const result = message.payload?.result;
        if (pending.method === 'eth_requestAccounts' || pending.method === 'eth_accounts') {
          if (Array.isArray(result)) {
            this._handleAccountsChanged(result);
          }
        }
        pending.resolve(result);
      }
    }

    _handleEvent(message) {
      const { event, data } = message.payload || {};

      if (!event) {
        console.warn('⚠️ Event message missing event name');
        return;
      }

      console.log('📢 Event received:', event, data);

      // ✅ 使用 EventType 常量
      switch (event) {
        case EventType.ACCOUNTS_CHANGED:
          this._handleAccountsChanged(data);
          break;

        case EventType.CHAIN_CHANGED:
          this._handleChainChanged(data);
          break;

        case EventType.CONNECT:
          this._handleConnect(data);
          break;

        case EventType.DISCONNECT:
          this._handleDisconnect(data);
          break;

        default:
          console.warn('⚠️ Unknown event:', event);
      }
    }

    async _requestInitialState() {
      try {
        // 请求当前账户
        const accounts = await this.request({ method: 'eth_accounts' });
        if (accounts && accounts.length > 0) {
          this._state.accounts = accounts;
          this._state.isConnected = true;
        }

        // 请求当前链ID
        const chainId = await this.request({ method: 'eth_chainId' });
        if (chainId) {
          this._state.chainId = chainId;
        }

        console.log('📊 Initial state:', this._state);
      } catch (error) {
        console.error('❌ Failed to get initial state:', error);
      }
    }

    // ==================== EIP-1193 核心方法 ====================

    async request(args) {
      if (!args || typeof args !== 'object' || !args.method) {
        throw new ProviderRpcError(
          -32600,
          'Invalid request arguments'
        );
      }

      const { method, params = [] } = args;

      console.log('📤 Request:', method, params);

      return this._sendRequest(method, params);
    }

    async _sendRequest(method, params) {
      return new Promise((resolve, reject) => {
        const message = MessageBuilder.createRequest(method, params, window.location.origin);
        const requestId = message.metadata.id;

        // 设置超时
        const timeoutId = setTimeout(() => {
          this._pendingRequests.delete(requestId);
          reject(
            new ProviderRpcError(
              -32603,
              'Request timeout',
              { method, timeout: REQUEST_TIMEOUT }
            )
          );
        }, REQUEST_TIMEOUT);

        // 保存待处理请求
        this._pendingRequests.set(requestId, {
          resolve,
          reject,
          timeoutId,
          method,
          timestamp: Date.now()
        });

        // 发送消息到 content script
        window.postMessage(message, '*');
      });
    }

    // ==================== 事件处理 ====================

    _handleAccountsChanged(accounts) {
      // ✅ 支持两种数据格式
      const accountsArray = Array.isArray(accounts) ? accounts : accounts?.accounts || [];

      const accountsChanged =
        accountsArray.length !== this._state.accounts.length ||
        accountsArray.some((acc, i) => acc !== this._state.accounts[i]);

      if (!accountsChanged) return;

      console.log('👤 Accounts changed:', accountsArray);

      const wasConnected = this._state.isConnected;
      this._state.accounts = accountsArray;
      this._state.isConnected = accountsArray.length > 0;

      this.emit(EventType.ACCOUNTS_CHANGED, accountsArray);

      // 如果从已连接变为未连接，触发 disconnect
      if (wasConnected && !this._state.isConnected) {
        this._handleDisconnect({ reason: 'accounts_empty' });
      }
    }

    _handleChainChanged(chainId) {
      // ✅ 支持两种数据格式
      const newChainId = typeof chainId === 'string' ? chainId : chainId?.chainId;

      if (!newChainId) {
        console.error('❌ Invalid chainId:', chainId);
        return;
      }

      if (newChainId === this._state.chainId) return;

      console.log('⛓️ Chain changed:', newChainId);

      this._state.chainId = newChainId;
      this.emit(EventType.CHAIN_CHANGED, newChainId);
    }

    _handleConnect(data) {
      console.log('🔗 Connected:', data);

      this._state.isConnected = true;

      if (data?.chainId) {
        this._state.chainId = data.chainId;
      }

      if (data?.accounts) {
        this._state.accounts = data.accounts;
      }

      this.emit(EventType.CONNECT, { chainId: this._state.chainId });
    }

    _handleDisconnect(data) {
      console.log('🔌 Disconnected:', data);

      const wasConnected = this._state.isConnected;
      this._state.isConnected = false;
      this._state.accounts = [];

      if (wasConnected) {
        this.emit(
          EventType.DISCONNECT,
          new ProviderRpcError(
            4900,
            'Provider disconnected',
            data
          )
        );
      }
    }

    // ==================== 状态查询（从缓存读取）====================

    isConnected() {
      return this._state.isConnected;
    }

    get selectedAddress() {
      return this._state.accounts[0] || null;
    }

    get chainId() {
      return this._state.chainId;
    }

    get networkVersion() {
      return this._state.chainId
        ? parseInt(this._state.chainId, 16).toString()
        : null;
    }

    // ==================== 调试方法 ====================

    _getState() {
      return {
        ...this._state,
        pendingRequests: this._pendingRequests.size,
        listeners: Object.keys(this._events).reduce((acc, event) => {
          acc[event] = this.listenerCount(event);
          return acc;
        }, {})
      };
    }
  }

  // ==================== 注入到 window ====================

  const provider = new YeYingProvider();

  // 注入 window.ethereum
  Object.defineProperty(window, 'ethereum', {
    value: provider,
    writable: false,
    configurable: false
  });

  // 兼容旧版 web3.js
  if (!window.web3) {
    window.web3 = {};
  }
  window.web3.currentProvider = provider;

  // EIP-6963: 多钱包发现标准
  window.dispatchEvent(
    new CustomEvent('eip6963:announceProvider', {
      detail: {
        info: {
          uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          name: 'YeYing Wallet',
          icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iIzYzNjZGMSIvPjwvc3ZnPg==',
          rdns: 'io.github.yeying'
        },
        provider
      }
    })
  );

  // 调试接口
  window.__YEYING_PROVIDER__ = provider;

  console.log('✅ YeYing Provider injected successfully');
  console.log('📍 Access via window.ethereum');

  // 触发初始化完成事件
  window.dispatchEvent(new Event('ethereum#initialized'));
})();
