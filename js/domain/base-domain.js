/**
 * 基础 Domain - 统一消息发送与错误处理
 */

export class BaseDomain {
  constructor({ maxRetries = 2, retryDelay = 150 } = {}) {
    this._maxRetries = Number.isFinite(maxRetries) ? maxRetries : 2;
    this._retryDelay = Number.isFinite(retryDelay) ? retryDelay : 150;
  }

  _shouldRetryMessageError(message) {
    const normalized = String(message || '').toLowerCase();
    return normalized.includes('receiving end does not exist')
      || normalized.includes('message port closed before a response was received')
      || normalized.includes('could not establish connection');
  }

  /**
   * 发送消息到 background
   * @param {string} type - 消息类型
   * @param {Object} data - 消息数据
   * @returns {Promise<Object>} 响应结果
   */
  async _sendMessage(type, data = {}) {
    return new Promise((resolve, reject) => {
      if (typeof browser !== 'undefined') {
        browser.runtime.sendMessage({ type, data })
          .then(response => {
            if (response?.success === false) {
              const error = new Error(response.error || '操作失败');
              if (response?.requirePassword) {
                error.requirePassword = true;
              }
              reject(error);
            } else {
              resolve(response);
            }
          })
          .catch(error => {
            reject(error);
          });
      } else if (typeof chrome !== 'undefined') {
        const sendWithRetry = (attempt) => {
          chrome.runtime.sendMessage({ type, data }, (response) => {
            if (chrome.runtime.lastError) {
              const message = chrome.runtime.lastError.message || 'Unknown error';
              const shouldRetry = this._shouldRetryMessageError(message) && attempt < this._maxRetries;
              if (shouldRetry) {
                const delay = this._retryDelay * (attempt + 1);
                console.warn(`[BaseDomain] retry ${attempt + 1}/${this._maxRetries} for ${type}: ${message}`);
                setTimeout(() => sendWithRetry(attempt + 1), delay);
                return;
              }
              reject(new Error(message));
            } else if (response?.success === false) {
              const error = new Error(response.error || '操作失败');
              if (response?.requirePassword) {
                error.requirePassword = true;
              }
              reject(error);
            } else {
              resolve(response);
            }
          });
        };

        sendWithRetry(0);
      } else {
        reject(new Error('不支持的浏览器环境'));
      }
    });
  }
}
