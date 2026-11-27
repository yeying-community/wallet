import { shortenAddress } from '../../common/chain/index.js';
import { escapeHtml } from '../../common/ui/html-ui.js';
import { TransferTokenController } from './transfer-token-controller.js';
import { renderZhixingHome, setZhixingHomeMode } from './zhixing-home.js';

function resolveTokenImage(image) {
  const value = String(image || '').trim();
  if (!value) return '';
  if (/^(?:https?:|data:|blob:|chrome-extension:|moz-extension:)/i.test(value)) {
    return value;
  }
  try {
    return globalThis.chrome?.runtime?.getURL
      ? globalThis.chrome.runtime.getURL(value.replace(/^\/+/, ''))
      : value;
  } catch {
    return value;
  }
}

/** 账户的链族,取值与 resolveChainFamily 一致:'eip155' | 'tron' | 'solana' | 'utxo' | 'zhixing'。 */
function accountFamily(account) {
  const ns = String(account?.namespace || 'eip155').toLowerCase();
  if (ns === 'bip122') return 'utxo';
  return ns;
}

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
      // 知行图:非资产链,显示成员状态;不查余额、不列通证
      const zhixing = (await this.resolveChainFamily()) === 'zhixing';
      setZhixingHomeMode(zhixing);
      if (zhixing) {
        this.lastTokenList = [];
        await renderZhixingHome(this.wallet);
        return [];
      }
      const account = await this.wallet.getCurrentAccount();
      if (!account) {
        this.renderTokenBalances([]);
        return [];
      }

      const family = await this.resolveChainFamily();
      this.transferController.setChainFamily(family);

      // 账户不在当前网络的链上(这条链上还没有账户):不要拿别的链的地址去查余额
      if (accountFamily(account) !== family) {
        this.lastTokenList = [];
        this.transferController.updateTransferTokenOptions([]);
        this.renderNoAccountForChain(family);
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
    const family = await this.resolveChainFamily();
    this.transferController.setChainFamily(family);
    await this.transferController.prepareTransferSelectors({
      tokenList: this.lastTokenList,
      loadTokenBalances: () => this.loadTokenBalances()
    });
  }

  /**
   * 探测当前链族（优先 chainKey；缺时回退 account.namespace）。
   * @returns {Promise<string>} 'eip155' | 'tron' | 'solana' | 'utxo' | 'zhixing'
   */
  async resolveChainFamily() {
    try {
      if (this.networkController?.getChainKey) {
        const key = String(await this.networkController.getChainKey() || '');
        if (key.startsWith('tron:')) return 'tron';
        if (key.startsWith('solana:')) return 'solana';
        if (key.startsWith('bip122:')) return 'utxo';
        if (key.startsWith('zhixing:')) return 'zhixing';
        // EVM 网络就是 EVM:不能再按账户的链判断,否则「以太坊网络 + 波场账户」会被当成波场
        if (key.startsWith('eip155:')) return 'eip155';
        // 未知:沿用下面按账户判断的既有行为
      }
    } catch { /* */ }
    try {
      if (this.wallet?.getCurrentAccount) {
        const acc = await this.wallet.getCurrentAccount();
        const ns = String(acc?.namespace || acc?.chainFamily || '').toLowerCase();
        if (ns === 'tron') return 'tron';
        if (ns === 'solana') return 'solana';
        if (ns === 'bip122') return 'utxo';
      }
    } catch { /* */ }
    return 'eip155';
  }

  renderNoAccountForChain(family) {
    const container = document.getElementById('tokenList');
    if (!container) return;
    const chain = { tron: '波场', solana: '索拉纳', utxo: '比特币', eip155: '以太坊' }[family] || '这条链';
    container.innerHTML = `
      <div class="empty-state">
        <p>🪙</p>
        <p>当前账户不在${chain}网络上</p>
        <p class="settings-hint">到「账户管理」新建或导入${chain}钱包,或切换到${chain}账户</p>
      </div>
    `;
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
      const image = resolveTokenImage(token.image || token.icon || token.logoURI || token.logo);
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
