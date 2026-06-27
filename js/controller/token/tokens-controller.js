import { shortenAddress } from '../../common/chain/index.js';
import { TransferTokenController } from './transfer-token-controller.js';

export class TokensController {
  constructor({ token, wallet, networkController } = {}) {
    this.token = token;
    this.wallet = wallet;
    this.networkController = networkController || null;
    this.lastTokenList = [];

    this.transferController = new TransferTokenController({
      wallet: this.wallet,
      networkController: this.networkController
    });
  }

  setNetworkController(controller) {
    this.networkController = controller;
    this.transferController.setNetworkController(controller);
  }

  bindEvents() {
    this.transferController.bindEvents();
  }

  getCurrentTransferToken() {
    return this.transferController.getCurrentTransferToken();
  }

  setTransferTokenChangedHandler(handler) {
    this.transferController.setTokenChangedHandler(handler);
  }

  async loadTokenBalances() {
    try {
      if (!this.wallet || !this.token) {
        this.renderTokenBalances([]);
        return [];
      }
      const account = await this.wallet.getCurrentAccount();
      if (!account) {
        this.renderTokenBalances([]);
        return [];
      }

      const nativeToken = await this.token.getNativeToken(account.address);
      const tokens = await this.token.getTokenBalances(account.address);
      const list = nativeToken ? [nativeToken, ...tokens] : tokens;

      this.lastTokenList = Array.isArray(list) ? list : [];
      this.transferController.updateTransferTokenOptions(this.lastTokenList);
      this.renderTokenBalances(this.lastTokenList);
      return this.lastTokenList;
    } catch (error) {
      console.error('[TokensController] 加载通证余额失败:', error);
      this.renderTokenBalances([]);
      return [];
    }
  }

  async prepareTransferSelectors() {
    await this.transferController.prepareTransferSelectors({
      tokenList: this.lastTokenList,
      loadTokenBalances: () => this.loadTokenBalances()
    });
  }

  renderTokenBalances(tokens) {
    const container = document.getElementById('tokenList');
    if (!container) return;

    if (!tokens || tokens.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>🪙</p>
          <p>暂无通证</p>
        </div>
      `;
      return;
    }

    container.innerHTML = tokens.map(token => `
      <div class="token-item ${token.isNative ? 'native' : ''}">
        <div class="token-info">
          <div class="token-symbol">
            ${token.symbol || '-'}
            ${token.isNative ? '<span class="token-badge">原生</span>' : ''}
          </div>
          <div class="token-name">${token.name || (token.address ? shortenAddress(token.address) : '')}</div>
        </div>
        <div class="token-balance">
          ${token.balance ?? '0'}
          <span>${token.symbol || ''}</span>
        </div>
      </div>
    `).join('');
  }
}
