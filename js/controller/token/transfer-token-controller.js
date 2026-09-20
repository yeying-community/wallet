export class TransferTokenController {
  constructor({ wallet, networkController } = {}) {
    this.wallet = wallet;
    this.networkController = networkController || null;
    this.onTokenChanged = null;
    this.transferTokenMap = new Map();
    this.currentTransferToken = null;
    this.boundTokenDocClick = false;
    this.chainFamily = 'eip155';
  }

  setNetworkController(controller) {
    this.networkController = controller;
  }

  setChainFamily(family) {
    this.chainFamily = String(family || 'eip155').toLowerCase();
  }

  setTokenChangedHandler(handler) {
    this.onTokenChanged = typeof handler === 'function' ? handler : null;
  }

  bindEvents() {
    this.bindTransferTokenSelector();
  }

  getCurrentTransferToken() {
    return this.currentTransferToken;
  }

  async prepareTransferSelectors({ tokenList, loadTokenBalances } = {}) {
    if (!this.wallet) {
      return;
    }
    if (this.networkController) {
      await this.networkController.refreshNetworkOptions();
    }

    const account = await this.wallet.getCurrentAccount();
    const senderInput = document.getElementById('senderAddress');
    if (senderInput) {
      senderInput.value = account?.address || '';
    }

    let list = Array.isArray(tokenList) ? tokenList : [];
    if (list.length === 0 && loadTokenBalances) {
      list = await loadTokenBalances();
    }

    this.updateTransferTokenOptions(list || []);
    this.updateTransferTokenSelection();
  }

  updateTransferTokenOptions(tokens) {
    const selector = document.querySelector('.token-selector');
    if (!selector) return;

    this.transferTokenMap = new Map();
    const menu = selector.querySelector('.token-menu');
    const labelEl = selector.querySelector('.token-label');
    if (!menu || !labelEl) return;
    menu.innerHTML = '';

    const list = Array.isArray(tokens) ? tokens : [];
    if (list.length === 0) {
      const native = this.nativeFallbackToken();
      this.transferTokenMap.set('native', native);
      labelEl.textContent = `${native.symbol} (原生)`;
      labelEl.dataset.value = 'native';
      return;
    }

    list.forEach((token) => {
      const id = token.isNative ? 'native' : (token.address || token.symbol || '');
      if (!id) return;
      const label = token.isNative
        ? `${token.symbol || this.nativeSymbol()} (原生)`
        : `${token.symbol || '-'}${token.name ? ` · ${token.name}` : ''}`;
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'token-option';
      option.dataset.value = id;
      option.textContent = label;
      option.addEventListener('click', (event) => {
        event.stopPropagation();
        this.setTransferTokenSelection(id);
        this.closeTokenMenu();
      });
      menu.appendChild(option);
      this.transferTokenMap.set(id, token);
    });

    if (menu.children.length === 0) {
      const native = this.nativeFallbackToken();
      this.transferTokenMap.set('native', native);
      labelEl.textContent = `${native.symbol} (原生)`;
      labelEl.dataset.value = 'native';
      return;
    }

    const preferred = menu.children[0]?.dataset?.value || 'native';
    if (this.currentTransferToken) {
      const currentId = this.currentTransferToken.isNative ? 'native' : this.currentTransferToken.address;
      const hasCurrent = Array.from(menu.children).some(option => option.dataset.value === currentId);
      this.setTransferTokenSelection(hasCurrent ? currentId : preferred);
    } else {
      this.setTransferTokenSelection(preferred);
    }
  }

  updateTransferTokenSelection() {
    const selector = document.querySelector('.token-selector');
    if (!selector) return;
    const labelEl = selector.querySelector('.token-label');
    if (!labelEl) return;
    const selectedId = labelEl.dataset.value || 'native';
    const token = this.transferTokenMap.get(selectedId) || null;
    this.currentTransferToken = token;

    const symbolEl = document.getElementById('transferTokenSymbol');
    if (symbolEl) {
      const symbol = token?.symbol || this.nativeSymbol();
      symbolEl.textContent = `(${symbol})`;
    }

    const menu = selector.querySelector('.token-menu');
    if (menu) {
      Array.from(menu.children).forEach((option) => {
        option.classList.toggle('active', option.dataset.value === selectedId);
      });
    }

    this.updateTransferMaxHint(token);
  }

  updateTransferMaxHint(token) {
    const hintEl = document.getElementById('transferMaxHint');
    if (!hintEl) return;
    if (!token) {
      hintEl.textContent = '';
      return;
    }
    const balance = token.balance ?? '';
    const symbol = token.symbol || 'ETH';
    if (balance === '' || balance === null || balance === undefined) {
      hintEl.textContent = '';
      return;
    }
    hintEl.textContent = `可转数量：${balance} ${symbol}`;
  }

  nativeSymbol() {
    switch (this.chainFamily) {
      case 'tron': return 'TRX';
      case 'solana': return 'SOL';
      case 'utxo':
      case 'bip122': return 'BTC';
      default: return 'ETH';
    }
  }

  nativeFallbackToken() {
    const symbol = this.nativeSymbol();
    return { symbol, name: '原生代币', isNative: true };
  }

  bindTransferTokenSelector() {
    const selector = document.querySelector('.token-selector');
    if (!selector) return;
    const trigger = selector.querySelector('.token-trigger');
    if (trigger && !trigger.dataset.bound) {
      trigger.dataset.bound = '1';
      trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggleTokenMenu();
      });
    }

    if (!this.boundTokenDocClick) {
      this.boundTokenDocClick = true;
      document.addEventListener('click', () => {
        this.closeTokenMenu();
      });
    }
  }

  toggleTokenMenu() {
    const selector = document.querySelector('.token-selector');
    if (!selector) return;
    const menu = selector.querySelector('.token-menu');
    const trigger = selector.querySelector('.token-trigger');
    if (!menu || !trigger) return;
    const isHidden = menu.classList.contains('hidden');
    this.closeTokenMenu();
    if (isHidden) {
      menu.classList.remove('hidden');
      trigger.setAttribute('aria-expanded', 'true');
    }
  }

  closeTokenMenu() {
    const selector = document.querySelector('.token-selector');
    if (!selector) return;
    const menu = selector.querySelector('.token-menu');
    const trigger = selector.querySelector('.token-trigger');
    if (menu) {
      menu.classList.add('hidden');
    }
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
    }
  }

  setTransferTokenSelection(selectedId) {
    const selector = document.querySelector('.token-selector');
    if (!selector) return;
    const labelEl = selector.querySelector('.token-label');
    if (!labelEl) return;

    const token = this.transferTokenMap.get(selectedId) || null;
    this.currentTransferToken = token;
    labelEl.textContent = token?.isNative
      ? `${token.symbol || 'ETH'} (原生)`
      : (token?.symbol || '原生代币');
    labelEl.dataset.value = selectedId;
    this.updateTransferTokenSelection();
    this.onTokenChanged?.(token || null);
  }
}
