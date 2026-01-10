import { showPage, showError, showSuccess, showWaiting } from '../../common/ui/index.js';

export class AddTokenController {
  constructor({ token, network, networkController, onTokenAdded } = {}) {
    this.token = token;
    this.network = network;
    this.networkController = networkController || null;
    this.onTokenAdded = onTokenAdded;
  }

  setNetworkController(controller) {
    this.networkController = controller;
  }

  bindEvents() {
    const tokenAddBtn = document.getElementById('tokenAddBtn');
    if (tokenAddBtn) {
      tokenAddBtn.addEventListener('click', async () => {
        await this.openTokenAddPage();
      });
    }

    const saveTokenBtn = document.getElementById('saveTokenBtn');
    if (saveTokenBtn) {
      saveTokenBtn.addEventListener('click', async () => {
        await this.handleSaveToken();
      });
    }

    const cancelTokenBtn = document.getElementById('cancelTokenBtn');
    if (cancelTokenBtn) {
      cancelTokenBtn.addEventListener('click', () => {
        this.resetTokenForm();
        showPage('walletPage');
      });
    }
  }

  async openTokenAddPage() {
    this.resetTokenForm();
    showPage('tokenAddPage');
    await this.networkController?.refreshNetworkOptions?.();
  }

  resetTokenForm() {
    const addressInput = document.getElementById('tokenAddressInput');
    const symbolInput = document.getElementById('tokenSymbolInput');
    const decimalsInput = document.getElementById('tokenDecimalsInput');
    const nameInput = document.getElementById('tokenNameInput');
    if (addressInput) addressInput.value = '';
    if (symbolInput) symbolInput.value = '';
    if (decimalsInput) decimalsInput.value = '';
    if (nameInput) nameInput.value = '';
  }

  async handleSaveToken() {
    if (!this.token) {
      showError('通证模块未初始化');
      return;
    }

    const addressInput = document.getElementById('tokenAddressInput');
    const symbolInput = document.getElementById('tokenSymbolInput');
    const decimalsInput = document.getElementById('tokenDecimalsInput');
    const nameInput = document.getElementById('tokenNameInput');

    const address = addressInput?.value.trim() || '';
    const symbol = symbolInput?.value.trim() || '';
    const decimalsRaw = decimalsInput?.value.trim() || '';
    const name = nameInput?.value.trim() || '';

    if (!address) {
      showError('请输入合约地址');
      return;
    }
    if (!symbol) {
      showError('请输入通证符号');
      return;
    }

    let decimals = 18;
    if (decimalsRaw !== '') {
      const parsed = parseInt(decimalsRaw, 10);
      if (Number.isNaN(parsed)) {
        showError('小数位格式不正确');
        return;
      }
      decimals = parsed;
    }

    try {
      showWaiting();

      let chainId = null;
      if (this.network) {
        try {
          chainId = await this.network.getChainId();
        } catch {
          chainId = null;
        }
      }

      const tokenPayload = {
        address,
        symbol,
        decimals,
        name: name || symbol,
      };
      if (chainId) {
        tokenPayload.chainId = chainId;
      }

      await this.token.addToken(tokenPayload);

      if (this.onTokenAdded) {
        await this.onTokenAdded();
      }

      this.resetTokenForm();
      showPage('walletPage');
      showSuccess('通证已添加');
    } catch (error) {
      console.error('[AddTokenController] 添加通证失败:', error);
      showError('添加失败: ' + error.message);
    }
  }
}
