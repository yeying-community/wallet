/**
 * 弹窗页面入口
 */

import { PopupController } from '../controller/popup-controller.js';
import { WalletDomain } from '../domain/wallet-domain.js';
import { TransactionDomain } from '../domain/transaction-domain.js';
import { NetworkDomain } from '../domain/network-domain.js';
import { TokenDomain } from '../domain/token-domain.js';
import { showToast } from '../common/ui/index.js';
import { WalletMessageType } from '../protocol/extension-protocol.js';

class PopupApp {
  constructor() {
    this.wallet = new WalletDomain();
    this.transaction = new TransactionDomain();
    this.network = new NetworkDomain();
    this.token = new TokenDomain({ network: this.network });
    this.controller = null;
  }

  async init() {
    try {
      this.controller = new PopupController({
        wallet: this.wallet,
        transaction: this.transaction,
        network: this.network,
        token: this.token
      });

      await this.controller.init();

      this.reportPopupBounds();
    } catch (error) {
      console.error('初始化失败:', error);
      showToast('初始化失败: ' + error.message, 'error');
    }
  }

  reportPopupBounds(attempt = 0) {
    try {
      if (!chrome?.runtime?.sendMessage) return;
      const left = window.screenX;
      const top = window.screenY;

      if ((!Number.isFinite(left) || !Number.isFinite(top)) && attempt < 3) {
        setTimeout(() => this.reportPopupBounds(attempt + 1), 200);
        return;
      }
      const bounds = {
        left,
        top,
        screen: {
          availLeft: window.screen?.availLeft ?? 0,
          availTop: window.screen?.availTop ?? 0,
          availWidth: window.screen?.availWidth ?? window.screen?.width ?? window.innerWidth ?? 0,
          availHeight: window.screen?.availHeight ?? window.screen?.height ?? window.innerHeight ?? 0
        }
      };
      chrome.runtime.sendMessage({
        type: WalletMessageType.UPDATE_POPUP_BOUNDS,
        data: bounds
      });
    } catch (error) {
      console.warn('[PopupApp] 上报弹窗位置失败:', error);
    }
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  const app = new PopupApp();
  app.init();
});
