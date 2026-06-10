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
} from './js/protocol/dapp-protocol.js';

const INJECT_SCRIPT_URL = import.meta.url;

(function () {
  'use strict';

  console.debug('YeYing Wallet Provider initializing...');

  const INITIAL_BRIDGE_TOKEN = (() => {
    try {
      const src = INJECT_SCRIPT_URL || '';
      if (!src) return '';
      return new URL(src).searchParams.get('bridgeToken') || '';
    } catch (error) {
      return '';
    }
  })();

  if (!INITIAL_BRIDGE_TOKEN) {
    console.error('❌ YeYing bridge token missing, provider injection aborted');
    return;
  }

  const existingProvider =
    window.ethereum && window.ethereum.isYeYing ? window.ethereum : null;

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

    addListener(event, listener) {
      return this.on(event, listener);
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

    removeListener(event, listener) {
      return this.off(event, listener);
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

      this._connectEmitted = false;

      // 待处理的请求
      this._pendingRequests = new Map();
      this._bridgeToken = INITIAL_BRIDGE_TOKEN;
      this._yeyingBridgeMessageListener = this._handleMessage.bind(this);

      // 初始化
      this._initialize();
    }

    // ==================== 初始化 ====================

    _initialize() {
      console.debug('Initializing YeYing Provider...');

      // 监听来自 content script 的消息
      window.addEventListener('message', this._yeyingBridgeMessageListener);

      // 请求初始状态
      this._requestInitialState();

      console.debug('YeYing Provider initialized');
    }

    _handleMessage(event) {
      // 只处理来自当前窗口的消息
      if (event.source !== window) return;

      const message = event.data;

      // 只处理 YEYING_MESSAGE
      if (message?.type !== MESSAGE_TYPE) return;
      if (message.metadata?.bridgeToken !== this._bridgeToken) return;

      console.debug('Provider received:', message);

      const { category } = message;

      // ✅ 修正：正确判断消息类别
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
        console.debug('Ignoring response for unknown wallet request:', requestId);
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

      console.debug('Event received:', event, data);

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
          this._state.isConnected = true;
          if (!this._connectEmitted) {
            this._connectEmitted = true;
            this.emit(EventType.CONNECT, { chainId: this._state.chainId });
          }
        }

        console.debug('Initial state:', this._state);
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

      console.debug('Wallet request:', method, params);

      return this._sendRequest(method, params);
    }

    send(methodOrPayload, paramsOrCallback) {
      if (typeof methodOrPayload === 'string') {
        if (typeof paramsOrCallback === 'function') {
          return this._sendAsync({ method: methodOrPayload, params: [] }, paramsOrCallback);
        }
        const params = paramsOrCallback ?? [];
        return this.request({ method: methodOrPayload, params });
      }

      if (methodOrPayload && typeof methodOrPayload === 'object') {
        if (typeof paramsOrCallback === 'function') {
          return this._sendAsync(methodOrPayload, paramsOrCallback);
        }
        if (methodOrPayload.method) {
          return this.request(methodOrPayload);
        }
      }

      throw new ProviderRpcError(-32600, 'Invalid request arguments');
    }

    sendAsync(payload, callback) {
      return this._sendAsync(payload, callback);
    }

    _sendAsync(payload, callback) {
      if (typeof callback !== 'function') {
        throw new ProviderRpcError(-32600, 'Callback is required');
      }

      const request = {
        method: payload?.method,
        params: payload?.params
      };
      const id = payload?.id;
      const jsonrpc = payload?.jsonrpc || '2.0';

      this.request(request)
        .then((result) => {
          callback(null, { id, jsonrpc, result });
        })
        .catch((error) => {
          const code = typeof error?.code === 'number' ? error.code : -32603;
          const message = error?.message || 'Internal error';
          const data = error?.data;
          callback(error, {
            id,
            jsonrpc,
            error: data !== undefined ? { code, message, data } : { code, message }
          });
        });
    }

    async _sendRequest(method, params) {
      return new Promise((resolve, reject) => {
        const message = MessageBuilder.createRequest(method, params, window.location.origin);
        message.metadata.bridgeToken = this._bridgeToken;
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
          message,
          timestamp: Date.now()
        });

        // 发送消息到 content script
        window.postMessage(message, '*');
      });
    }

    _setBridgeToken(bridgeToken) {
      if (!bridgeToken || bridgeToken === this._bridgeToken) return;

      console.debug('Rebinding YeYing Provider bridge');
      this._bridgeToken = bridgeToken;
      this._replayPendingRequests();
      this._state.isConnected = false;
      this._connectEmitted = false;
      this._requestInitialState();
    }

    _rejectPendingRequests(code, message) {
      this._pendingRequests.forEach((pending) => {
        clearTimeout(pending.timeoutId);
        pending.reject(new ProviderRpcError(code, message));
      });
      this._pendingRequests.clear();
    }

    _replayPendingRequests() {
      this._pendingRequests.forEach((pending, requestId) => {
        if (!pending.message) {
          return;
        }
        pending.message.metadata.bridgeToken = this._bridgeToken;
        pending.timestamp = Date.now();
        console.debug('Replaying pending wallet request:', pending.method, requestId);
        window.postMessage(pending.message, '*');
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

      console.debug('Accounts changed:', accountsArray);

      this._state.accounts = accountsArray;
      if (accountsArray.length > 0) {
        this._state.isConnected = true;
      }

      this.emit(EventType.ACCOUNTS_CHANGED, accountsArray);
    }

    _handleChainChanged(chainId) {
      // ✅ 支持两种数据格式
      const newChainId = typeof chainId === 'string' ? chainId : chainId?.chainId;

      if (!newChainId) {
        console.error('❌ Invalid chainId:', chainId);
        return;
      }

      if (newChainId === this._state.chainId) return;

      console.debug('Chain changed:', newChainId);

      this._state.chainId = newChainId;
      this._state.isConnected = true;
      this.emit(EventType.CHAIN_CHANGED, newChainId);
    }

    _handleConnect(data) {
      console.debug('Connected:', data);

      const shouldEmit = !this._connectEmitted;
      this._state.isConnected = true;
      this._connectEmitted = true;

      if (data?.chainId) {
        this._state.chainId = data.chainId;
      }

      if (data?.accounts) {
        this._state.accounts = data.accounts;
      }

      if (shouldEmit) {
        this.emit(EventType.CONNECT, { chainId: this._state.chainId });
      }
    }

    _handleDisconnect(data) {
      console.debug('Disconnected:', data);

      const wasConnected = this._state.isConnected;
      this._state.isConnected = false;
      this._state.accounts = [];
      this._connectEmitted = false;

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

  function rebindExistingProvider(provider, bridgeToken) {
    console.debug('YeYing Provider already injected, rebinding bridge');

    if (provider._yeyingBridgeMessageListener) {
      window.removeEventListener('message', provider._yeyingBridgeMessageListener);
    }

    provider._yeyingBridgeMessageListener = (event) => {
      if (event.source !== window) return;

      const message = event.data;
      if (message?.type !== MESSAGE_TYPE) return;
      if (message.metadata?.bridgeToken !== provider._bridgeToken) return;

      const { category } = message;
      if (category === MessageCategory.RESPONSE) {
        provider._handleResponse(message);
      } else if (category === MessageCategory.EVENT) {
        provider._handleEvent(message);
      }
    };
    window.addEventListener('message', provider._yeyingBridgeMessageListener);

    provider._replayPendingRequests = function () {
      this._pendingRequests?.forEach((pending, requestId) => {
        if (!pending.message) return;
        pending.message.metadata.bridgeToken = this._bridgeToken;
        pending.timestamp = Date.now();
        console.debug('Replaying pending wallet request:', pending.method, requestId);
        window.postMessage(pending.message, '*');
      });
    };

    provider._setBridgeToken = function (nextBridgeToken) {
      if (!nextBridgeToken || nextBridgeToken === this._bridgeToken) return;

      console.debug('Rebinding YeYing Provider bridge');
      this._bridgeToken = nextBridgeToken;
      this._replayPendingRequests?.();
      this._state.isConnected = false;
      this._connectEmitted = false;
      this._requestInitialState?.();
    };

    provider._sendRequest = function (method, params) {
      return new Promise((resolve, reject) => {
        const message = MessageBuilder.createRequest(method, params, window.location.origin);
        message.metadata.bridgeToken = this._bridgeToken;
        const requestId = message.metadata.id;

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

        this._pendingRequests.set(requestId, {
          resolve,
          reject,
          timeoutId,
          method,
          message,
          timestamp: Date.now()
        });

        window.postMessage(message, '*');
      });
    };

    provider._setBridgeToken(bridgeToken);
    window.dispatchEvent(new Event('ethereum#initialized'));
  }

  // ==================== 注入到 window ====================

  if (existingProvider) {
    rebindExistingProvider(existingProvider, INITIAL_BRIDGE_TOKEN);
    return;
  }

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
  const EIP6963_INFO = {
    uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    name: 'YeYing Wallet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iIzYzNjZGMSIvPjwvc3ZnPg==',
    rdns: 'io.github.yeying'
  };

  function announceProvider() {
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: {
          info: EIP6963_INFO,
          provider
        }
      })
    );
  }

  window.addEventListener('eip6963:requestProvider', announceProvider);
  announceProvider();

  // 调试接口
  window.__YEYING_PROVIDER__ = provider;

  console.debug('YeYing Provider injected successfully');
  console.debug('Access via window.ethereum');

  // 触发初始化完成事件
  window.dispatchEvent(new Event('ethereum#initialized'));
})();
