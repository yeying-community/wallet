import { shortenAddress } from '../../common/chain/index.js';
import { escapeHtml } from '../../common/ui/html-ui.js';
import { TransferTokenController } from './transfer-token-controller.js';

export class TokenController {
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
      console.error('[TokenController] 加载通证余额失败:', error);
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

    container.innerHTML = tokens.map(token => {
      const symbol = String(token.symbol || '-');
      const name = token.name || (token.address ? shortenAddress(token.address) : '');
      const image = token.image || token.icon || token.logoURI || token.logo || '';
      const iconLabel = symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase() || '?';
      return `
      <div class="token-item ${token.isNative ? 'native' : ''}">
        <div class="token-main">
          <div class="token-icon" aria-hidden="true">
            ${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" onerror="this.classList.add('hidden')">` : ''}
            <span>${escapeHtml(iconLabel)}</span>
          </div>
          <div class="token-info">
            <div class="token-symbol">
              ${escapeHtml(symbol)}
              ${token.isNative ? '<span class="token-badge">原生</span>' : ''}
            </div>
            <div class="token-name">${escapeHtml(name)}</div>
          </div>
        </div>
        <div class="token-balance">
          ${escapeHtml(token.balance ?? '0')}
          <span>${escapeHtml(token.symbol || '')}</span>
        </div>
      </div>
    `;
    }).join('');
  }
}
