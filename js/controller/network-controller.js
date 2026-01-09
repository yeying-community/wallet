import { NETWORKS } from '../config/index.js';
import { normalizeChainId } from '../common/utils/index.js';
import {
  showPage,
  showStatus,
  showError,
  showSuccess,
  updateNetworkIndicator
} from './ui.js';

export class NetworkController {
  constructor({ network, wallet, onNetworkChanged, onTokenAdded } = {}) {
    this.network = network;
    this.wallet = wallet;
    this.onNetworkChanged = onNetworkChanged;
    this.onTokenAdded = onTokenAdded;
    this.currentNetworkValue = null;
    this.boundDocumentClick = false;
    this.handleDocumentClick = this.handleDocumentClick.bind(this);
  }

  bindEvents() {
    const selectors = this.getNetworkSelectors();
    selectors.forEach((selector) => {
      const trigger = selector.querySelector('.network-trigger');
      if (trigger && !trigger.dataset.bound) {
        trigger.dataset.bound = '1';
        trigger.addEventListener('click', (event) => {
          event.stopPropagation();
          this.toggleNetworkMenu(selector);
        });
      }
    });

    if (!this.boundDocumentClick) {
      document.addEventListener('click', this.handleDocumentClick);
      this.boundDocumentClick = true;
    }

    const networkManageBtn = document.getElementById('networkManageBtn');
    if (networkManageBtn) {
      networkManageBtn.addEventListener('click', async () => {
        await this.handleOpenNetworkManage();
      });
    }

    const networkAddBtn = document.getElementById('networkAddBtn');
    if (networkAddBtn) {
      networkAddBtn.addEventListener('click', async () => {
        await this.handleOpenNetworkForm();
      });
    }

    const tokenAddBtn = document.getElementById('tokenAddBtn');
    if (tokenAddBtn) {
      tokenAddBtn.addEventListener('click', async () => {
        await this.handleOpenTokenAdd();
      });
    }

    const saveNetworkBtn = document.getElementById('saveNetworkBtn');
    if (saveNetworkBtn) {
      saveNetworkBtn.addEventListener('click', async () => {
        await this.handleSaveNetwork();
      });
    }

    const cancelNetworkBtn = document.getElementById('cancelNetworkBtn');
    if (cancelNetworkBtn) {
      cancelNetworkBtn.addEventListener('click', () => {
        this.resetNetworkForm();
        showPage('networkManagePage');
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

  async refreshNetworkState() {
    if (!this.network) return;
    try {
      const chainId = await this.network.getChainId();
      updateNetworkIndicator(chainId);
    } catch (error) {
      console.warn('[NetworkController] 获取链 ID 失败:', error);
    }
    await this.refreshNetworkOptions();
  }

  async handleNetworkChange(rpcUrl) {
    try {
      if (!rpcUrl) return;

      await this.network.setRpcUrl(rpcUrl);

      const chainId = await this.network.getChainId();
      updateNetworkIndicator(chainId);

      this.currentNetworkValue = rpcUrl;

      await this.refreshNetworkOptions(rpcUrl);
      this.closeAllMenus();

      if (this.onNetworkChanged) {
        await this.onNetworkChanged();
      }

      showSuccess('网络已切换');
    } catch (error) {
      console.error('[NetworkController] 切换网络失败:', error);
      showError('切换网络失败: ' + error.message);
    }
  }

  async refreshNetworkOptions(currentRpcOverride = null) {
    const selectors = this.getNetworkSelectors();
    if (selectors.length === 0) return;

    const yeyingRpc = NETWORKS.yeying?.rpcUrl || NETWORKS.yeying?.rpc || 'https://blockchain.yeying.pub';
    let currentRpc = currentRpcOverride;
    if (!currentRpc) {
      try {
        currentRpc = await this.network.getRpcUrl();
      } catch {
        currentRpc = yeyingRpc;
      }
    }

    const customNetworks = await this.network.getCustomNetworks();

    const options = [];
    options.push({ value: yeyingRpc, label: '夜莺网络' });

    customNetworks.forEach((network) => {
      if (!network?.rpcUrl) return;
      if (network.rpcUrl === yeyingRpc) return;
      const label = network.chainName || network.name || `Chain ${network.chainId}`;
      options.push({ value: network.rpcUrl, label });
    });

    const values = options.map(option => option.value);
    const selectedValue = values.includes(currentRpc) ? currentRpc : yeyingRpc;
    this.currentNetworkValue = selectedValue;

    const selectedLabel = options.find(option => option.value === selectedValue)?.label || '夜莺网络';

    selectors.forEach((selector) => {
      const labelEl = selector.querySelector('.network-label');
      if (labelEl) {
        labelEl.textContent = selectedLabel;
      }

      const menu = selector.querySelector('.network-menu');
      if (!menu) return;

      menu.innerHTML = '';
      options.forEach((optionData) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = `network-option${optionData.value === selectedValue ? ' active' : ''}`;
        option.textContent = optionData.label;
        option.dataset.value = optionData.value;
        option.addEventListener('click', async (event) => {
          event.stopPropagation();
          await this.handleNetworkChange(optionData.value);
        });
        menu.appendChild(option);
      });
    });
  }

  getNetworkSelectors() {
    return Array.from(document.querySelectorAll('.network-selector'));
  }

  toggleNetworkMenu(selector) {
    const menu = selector.querySelector('.network-menu');
    const trigger = selector.querySelector('.network-trigger');
    if (!menu || !trigger) return;

    const isHidden = menu.classList.contains('hidden');
    this.closeAllMenus();
    if (isHidden) {
      menu.classList.remove('hidden');
      trigger.setAttribute('aria-expanded', 'true');
    }
  }

  closeAllMenus() {
    const selectors = this.getNetworkSelectors();
    selectors.forEach((selector) => {
      const menu = selector.querySelector('.network-menu');
      const trigger = selector.querySelector('.network-trigger');
      if (menu) {
        menu.classList.add('hidden');
      }
      if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  handleDocumentClick() {
    this.closeAllMenus();
  }

  async handleOpenNetworkManage() {
    this.resetNetworkForm();
    showPage('networkManagePage');
    await this.loadNetworkList();
  }

  async handleOpenNetworkForm() {
    this.resetNetworkForm();
    showPage('networkFormPage');
  }

  async handleOpenTokenAdd() {
    this.resetTokenForm();
    showPage('tokenAddPage');
    await this.refreshNetworkOptions();
  }

  resetNetworkForm() {
    const nameInput = document.getElementById('networkNameInput');
    const rpcInput = document.getElementById('networkRpcInput');
    const chainIdInput = document.getElementById('networkChainIdInput');
    const symbolInput = document.getElementById('networkSymbolInput');
    const explorerInput = document.getElementById('networkExplorerInput');
    const status = document.getElementById('networkFormStatus');
    const title = document.getElementById('networkFormPageTitle');
    const saveBtn = document.getElementById('saveNetworkBtn');
    const editChainId = document.getElementById('networkEditChainId');

    if (nameInput) nameInput.value = '';
    if (rpcInput) rpcInput.value = '';
    if (chainIdInput) {
      chainIdInput.value = '';
      chainIdInput.disabled = false;
    }
    if (symbolInput) symbolInput.value = '';
    if (explorerInput) explorerInput.value = '';
    if (editChainId) editChainId.value = '';
    if (title) title.textContent = '新增网络';
    if (saveBtn) saveBtn.textContent = '添加网络';
    if (status) status.style.display = 'none';
  }

  resetTokenForm() {
    const addressInput = document.getElementById('tokenAddressInput');
    const symbolInput = document.getElementById('tokenSymbolInput');
    const decimalsInput = document.getElementById('tokenDecimalsInput');
    const nameInput = document.getElementById('tokenNameInput');
    const status = document.getElementById('tokenAddStatus');

    if (addressInput) addressInput.value = '';
    if (symbolInput) symbolInput.value = '';
    if (decimalsInput) decimalsInput.value = '';
    if (nameInput) nameInput.value = '';
    if (status) status.style.display = 'none';
  }

  async loadNetworkList() {
    try {
      const networks = await this.network.getCustomNetworks();
      let currentChainId = null;
      try {
        currentChainId = await this.network.getChainId();
      } catch (error) {
        console.warn('[NetworkController] 获取当前链 ID 失败:', error);
      }
      this.renderNetworkList(networks || [], currentChainId);
    } catch (error) {
      console.error('[NetworkController] 加载网络列表失败:', error);
      this.renderNetworkList([], null);
    }
  }

  renderNetworkList(networks, currentChainId) {
    const list = document.getElementById('networkManageList');
    if (!list) return;

    list.innerHTML = '';

    const normalize = (value) => {
      try {
        return normalizeChainId(value);
      } catch {
        return null;
      }
    };

    const normalizedCurrent = normalize(currentChainId);
    const isCurrent = (value) => {
      if (!normalizedCurrent) return false;
      const normalizedValue = normalize(value);
      return normalizedValue && normalizedValue === normalizedCurrent;
    };

    const yeyingConfig = NETWORKS.yeying;
    if (yeyingConfig) {
      const yeyingChainId = yeyingConfig.chainIdHex || yeyingConfig.chainId;
      const isYeyingCurrent = isCurrent(yeyingChainId);
      const item = document.createElement('div');
      item.className = 'network-item';
      if (isYeyingCurrent) {
        item.classList.add('is-current');
      }

      const header = document.createElement('div');
      header.className = 'network-item-header';

      const title = document.createElement('div');
      title.className = 'network-item-title';
      title.textContent = '夜莺网络';

      const badge = document.createElement('span');
      badge.className = 'network-badge';
      badge.textContent = '默认';
      title.appendChild(badge);

      if (isYeyingCurrent) {
        const currentBadge = document.createElement('span');
        currentBadge.className = 'network-badge current';
        currentBadge.textContent = '当前';
        title.appendChild(currentBadge);
      }

      header.appendChild(title);
      item.appendChild(header);

      const meta = document.createElement('div');
      meta.className = 'network-item-meta';
      meta.textContent = `Chain ID: ${yeyingChainId} | 符号: ${yeyingConfig.symbol || 'YY'}`;
      item.appendChild(meta);
      list.appendChild(item);
    }

    if (!Array.isArray(networks) || networks.length === 0) {
      return;
    }

    networks.forEach((network) => {
      const isCustomCurrent = isCurrent(network.chainId);
      const item = document.createElement('div');
      item.className = 'network-item';
      if (isCustomCurrent) {
        item.classList.add('is-current');
      }

      const header = document.createElement('div');
      header.className = 'network-item-header';

      const title = document.createElement('div');
      title.className = 'network-item-title';
      title.textContent = network.chainName || network.name || `Chain ${network.chainId}`;
      if (isCustomCurrent) {
        const currentBadge = document.createElement('span');
        currentBadge.className = 'network-badge current';
        currentBadge.textContent = '当前';
        title.appendChild(currentBadge);
      }

      const actions = document.createElement('div');
      actions.className = 'network-item-actions';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-danger btn-small';
      deleteBtn.textContent = '删除';
      deleteBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        await this.handleDeleteNetwork(network);
      });

      actions.appendChild(deleteBtn);

      header.appendChild(title);
      header.appendChild(actions);

      const meta = document.createElement('div');
      meta.className = 'network-item-meta';
      meta.textContent = `Chain ID: ${network.chainId} | 符号: ${network.symbol || 'ETH'}`;

      item.appendChild(header);
      item.appendChild(meta);

      item.addEventListener('click', () => {
        this.handleEditNetwork(network);
      });

      list.appendChild(item);
    });
  }

  handleEditNetwork(network) {
    this.resetNetworkForm();
    const nameInput = document.getElementById('networkNameInput');
    const rpcInput = document.getElementById('networkRpcInput');
    const chainIdInput = document.getElementById('networkChainIdInput');
    const symbolInput = document.getElementById('networkSymbolInput');
    const explorerInput = document.getElementById('networkExplorerInput');
    const title = document.getElementById('networkFormPageTitle');
    const saveBtn = document.getElementById('saveNetworkBtn');
    const editChainId = document.getElementById('networkEditChainId');

    if (nameInput) nameInput.value = network.chainName || network.name || '';
    if (rpcInput) rpcInput.value = network.rpcUrl || '';
    if (chainIdInput) {
      chainIdInput.value = network.chainId || '';
      chainIdInput.disabled = true;
    }

    if (symbolInput) symbolInput.value = network.symbol || 'ETH';
    if (explorerInput) explorerInput.value = network.explorer || '';
    if (title) title.textContent = '编辑网络';
    if (saveBtn) saveBtn.textContent = '保存修改';
    if (editChainId) editChainId.value = network.chainId || '';

    showPage('networkFormPage');
  }

  async handleDeleteNetwork(network) {
    if (!network?.chainId) return;
    if (!confirm(`确定要删除 "${network.chainName || network.name || network.chainId}" 吗？`)) {
      return;
    }

    try {
      await this.network.removeCustomNetwork(network.chainId);
      const currentChainId = await this.network.getChainId();
      if (currentChainId === normalizeChainId(network.chainId)) {
        const yeyingRpc = NETWORKS.yeying?.rpcUrl || NETWORKS.yeying?.rpc || 'https://blockchain.yeying.pub';
        await this.network.setRpcUrl(yeyingRpc);
        const chainId = await this.network.getChainId();
        updateNetworkIndicator(chainId);
        if (this.onNetworkChanged) {
          await this.onNetworkChanged();
        }
      }
      await this.loadNetworkList();
      await this.refreshNetworkOptions();
      showSuccess('网络已删除');
    } catch (error) {
      console.error('[NetworkController] 删除网络失败:', error);
      showError('删除失败: ' + error.message);
    }
  }

  async handleSaveNetwork() {
    const nameInput = document.getElementById('networkNameInput');
    const rpcInput = document.getElementById('networkRpcInput');
    const chainIdInput = document.getElementById('networkChainIdInput');
    const symbolInput = document.getElementById('networkSymbolInput');
    const explorerInput = document.getElementById('networkExplorerInput');
    const editChainId = document.getElementById('networkEditChainId');

    const chainName = nameInput?.value.trim() || '';
    const rpcUrl = rpcInput?.value.trim() || '';
    const chainIdRaw = chainIdInput?.value.trim() || '';
    const symbol = symbolInput?.value.trim() || 'ETH';
    const explorer = explorerInput?.value.trim() || '';
    const editingChainId = editChainId?.value || '';

    if (!chainName) {
      showStatus('networkFormStatus', '请输入网络名称', 'error');
      return;
    }
    if (!rpcUrl) {
      showStatus('networkFormStatus', '请输入 RPC URL', 'error');
      return;
    }
    if (!chainIdRaw) {
      showStatus('networkFormStatus', '请输入 Chain ID', 'error');
      return;
    }

    let chainId;
    try {
      chainId = normalizeChainId(chainIdRaw);
    } catch (error) {
      showStatus('networkFormStatus', 'Chain ID 格式不正确', 'error');
      return;
    }

    if (editingChainId && chainId !== normalizeChainId(editingChainId)) {
      showStatus('networkFormStatus', '编辑时不允许修改 Chain ID', 'error');
      return;
    }

    try {
      showStatus('networkFormStatus', editingChainId ? '保存中...' : '添加中...', 'info');

      if (editingChainId) {
        await this.network.updateCustomNetwork(chainId, {
          chainName,
          rpcUrl,
          explorer,
          symbol,
          decimals: 18
        });
      } else {
        await this.network.addCustomNetwork({
          chainName,
          chainId,
          rpcUrls: [rpcUrl],
          blockExplorerUrls: explorer ? [explorer] : [],
          nativeCurrency: {
            symbol,
            decimals: 18
          }
        });
      }

      if (editingChainId) {
        const currentChainId = await this.network.getChainId();
        if (currentChainId === chainId) {
          await this.network.setRpcUrl(rpcUrl);
          const refreshedChainId = await this.network.getChainId();
          updateNetworkIndicator(refreshedChainId);
          if (this.onNetworkChanged) {
            await this.onNetworkChanged();
          }
        }
      }

      await this.refreshNetworkOptions();
      await this.loadNetworkList();
      this.resetNetworkForm();
      showPage('networkManagePage');
      showSuccess(editingChainId ? '网络已更新' : '网络已添加');
    } catch (error) {
      console.error('[NetworkController] 保存网络失败:', error);
      showStatus('networkFormStatus', '保存失败: ' + error.message, 'error');
    }
  }

  async handleSaveToken() {
    if (!this.wallet) {
      showStatus('tokenAddStatus', '钱包未初始化', 'error');
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
      showStatus('tokenAddStatus', '请输入合约地址', 'error');
      return;
    }

    if (!symbol) {
      showStatus('tokenAddStatus', '请输入通证符号', 'error');
      return;
    }

    let decimals = 18;
    if (decimalsRaw !== '') {
      const parsed = parseInt(decimalsRaw, 10);
      if (Number.isNaN(parsed)) {
        showStatus('tokenAddStatus', '小数位格式不正确', 'error');
        return;
      }
      decimals = parsed;
    }

    try {
      showStatus('tokenAddStatus', '添加中...', 'info');

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

      await this.wallet.addToken(tokenPayload);

      if (this.onTokenAdded) {
        await this.onTokenAdded();
      }

      this.resetTokenForm();
      showPage('walletPage');
      showSuccess('通证已添加');
    } catch (error) {
      console.error('[NetworkController] 添加通证失败:', error);
      showStatus('tokenAddStatus', '添加失败: ' + error.message, 'error');
    }
  }
}
