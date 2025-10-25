(function () {
  'use strict';

  console.log('🚀 YeYing inpage script loading...');

  if (window.yeyingWalletInjected) {
    console.log('⚠️ Already injected');
    return;
  }

  window.yeyingWalletInjected = true;

  class YeYingWalletProvider {
    constructor() {
      this.isConnected = false;
      this.selectedAddress = null;
      this.chainId = null;
      this._eventListeners = {};
      this._pendingRequests = {};
      this.isYeYingWallet = true;
      this.isMetaMask = true;

      // 🔥 监听来自 content script 的账户变更通知
      this._setupAccountsListener();

      console.log('✅ YeYingWalletProvider created');
    }

      // 🔥 设置账户变更监听
    _setupAccountsListener() {
      window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        
        if (event.data.type === 'ACCOUNTS_CHANGED') {
          console.log('📢 Accounts changed:', event.data.accounts);
          
          // 更新当前账户
          this.selectedAddress = event.data.accounts[0] || null;
          
          // 触发 accountsChanged 事件
          this._emit('accountsChanged', event.data.accounts);
          
          // 如果账户被清空，也触发 disconnect 事件
          if (event.data.accounts.length === 0) {
            this.isConnected = false;
            this._emit('disconnect', {
              code: 4900,
              message: 'User disconnected'
            });
          }
        }
        
        if (event.data.type === 'CHAIN_CHANGED') {
          console.log('📢 Chain changed:', event.data.chainId);
          this.chainId = event.data.chainId;
          this._emit('chainChanged', event.data.chainId);
        }
      });
    }

    _sendRequest(method, params = []) {
      return new Promise((resolve, reject) => {
        const requestId = `${Date.now()}_${Math.random()}`;

        this._pendingRequests[requestId] = { resolve, reject };

        // 通过 window.postMessage 发送到 content script
        window.postMessage({
          type: 'YEYING_REQUEST',
          requestId,
          method,
          params
        }, '*');

        // 超时处理
        setTimeout(() => {
          if (this._pendingRequests[requestId]) {
            delete this._pendingRequests[requestId];
            reject(new Error('Request timeout'));
          }
        }, 60000);
      });
    }

    _handleResponse(message) {
      const { requestId, result, error } = message;

      if (this._pendingRequests[requestId]) {
        if (error) {
          this._pendingRequests[requestId].reject(new Error(error));
        } else {
          this._pendingRequests[requestId].resolve(result);
        }
        delete this._pendingRequests[requestId];
      }
    }

    on(event, callback) {
      if (!this._eventListeners[event]) {
        this._eventListeners[event] = [];
      }
      this._eventListeners[event].push(callback);
      return this;
    }

    removeListener(event, callback) {
      if (this._eventListeners[event]) {
        this._eventListeners[event] = this._eventListeners[event].filter(
          cb => cb !== callback
        );
      }
      return this;
    }

    _emit(event, data) {
      if (this._eventListeners[event]) {
        this._eventListeners[event].forEach(callback => {
          try {
            callback(data);
          } catch (error) {
            console.error('Event listener error:', error);
          }
        });
      }
    }

    async request({ method, params = [] }) {
      console.log('🔵 Request:', method, params);
      return this._sendRequest(method, params);
    }

    async enable() {
      return this.request({ method: 'eth_requestAccounts' });
    }

    send(methodOrPayload, paramsOrCallback) {
      if (typeof methodOrPayload === 'string') {
        return this.request({
          method: methodOrPayload,
          params: paramsOrCallback || []
        });
      }

      if (typeof paramsOrCallback === 'function') {
        this.request(methodOrPayload)
          .then(result => paramsOrCallback(null, { result }))
          .catch(error => paramsOrCallback(error));
        return;
      }

      return this.request(methodOrPayload);
    }

    sendAsync(payload, callback) {
      this.request(payload)
        .then(result => callback(null, { result }))
        .catch(error => callback(error));
    }
  }

  // 创建 provider
  const provider = new YeYingWalletProvider();

  // 监听来自 content script 的响应
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data.type === 'YEYING_RESPONSE') {
      provider._handleResponse(event.data);
    }
  });

  // 注入到 window.ethereum
  Object.defineProperty(window, 'ethereum', {
    get() {
      return provider;
    },
    set() {
      console.warn('⚠️ Attempted to overwrite window.ethereum');
    },
    configurable: false
  });

  // 触发事件
  window.dispatchEvent(new Event('ethereum#initialized'));

  console.log('✅ window.ethereum injected');
  console.log('✅ Type:', typeof window.ethereum);
  console.log('✅ isYeYingWallet:', window.ethereum.isYeYingWallet);
})();
