import { DEFAULT_NETWORK } from '../config/index.js';
import { normalizeChainId } from '../common/chain/index.js';
import { getSelectedNetworkName, getNetworkConfigByKey } from '../storage/index.js';
import {
  showPage,
  showWaiting,
  showError,
  showSuccess
} from '../common/ui/index.js';

export class NetworkController {
  constructor({ network, onNetworkChanged } = {}) {
    this.network = network;
    this.onNetworkChanged = onNetworkChanged;
    this.currentNetworkValue = null;
    this.boundDocumentClick = false;
    this.handleDocumentClick = this.handleDocumentClick.bind(this);
  }

  getNetworkLabel(network, fallback = '网络') {
    if (!network) return fallback;
    return network.chainName || network.name || network.nativeCurrency?.name || fallback;
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

  async prefillNetworkLabels() {
    const selectors = this.getNetworkSelectors();
    if (selectors.length === 0) return;

    try {
      const savedKey = await getSelectedNetworkName();
      if (!savedKey) return;

      const config = await getNetworkConfigByKey(savedKey);
      if (!config) return;

      const label = this.getNetworkLabel(config, null);
      if (!label) return;

      selectors.forEach((selector) => {
        const labelEl = selector.querySelector('.network-label');
        if (labelEl) {
          labelEl.textContent = label;
        }
      });
    } catch (error) {
      console.warn('[NetworkController] 预填网络名称失败:', error);
    }
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
    if (selectors.length === 0 || !this.network) return;

    let currentRpc = currentRpcOverride;
    if (!currentRpc) {
      try {
        currentRpc = await this.network.getRpcUrl();
      } catch {
        currentRpc = null;
      }
    }

    const networks = await this.network.getNetworks();
    const options = [];
    const values = new Set();
    const ordered = Array.isArray(networks) ? [...networks] : [];
    const defaultIndex = ordered.findIndex(item => item?.key === DEFAULT_NETWORK || item?.id === DEFAULT_NETWORK);
    if (defaultIndex > 0) {
      const [defaultItem] = ordered.splice(defaultIndex, 1);
      ordered.unshift(defaultItem);
    }

    ordered.forEach((network) => {
      const rpc = network?.rpcUrl || network?.rpc;
      if (!rpc) return;
      if (values.has(rpc)) return;
      const label = this.getNetworkLabel(network, `Chain ${network.chainId || ''}`.trim());
      options.push({ value: rpc, label });
      values.add(rpc);
    });

    if (!options.length && currentRpc) {
      options.push({ value: currentRpc, label: '当前网络' });
      values.add(currentRpc);
    }

    const fallbackValue = options[0]?.value || currentRpc || '';
    const selectedValue = values.has(currentRpc) ? currentRpc : fallbackValue;
    this.currentNetworkValue = selectedValue;

    const selectedLabel = options.find(option => option.value === selectedValue)?.label || '网络';

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

  resetNetworkForm() {
    const nameInput = document.getElementById('networkNameInput');
    const rpcInput = document.getElementById('networkRpcInput');
    const chainIdInput = document.getElementById('networkChainIdInput');
    const symbolInput = document.getElementById('networkSymbolInput');
    const explorerInput = document.getElementById('networkExplorerInput');
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
  }

  async loadNetworkList() {
    try {
      const networks = await this.network.getNetworks();
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

    if (!Array.isArray(networks) || networks.length === 0) {
      return;
    }

    networks.forEach((network) => {
      const isNetworkCurrent = isCurrent(network.chainIdHex || network.chainId);
      const item = document.createElement('div');
      item.className = 'network-item';
      if (isNetworkCurrent) {
        item.classList.add('is-current');
      }

      const header = document.createElement('div');
      header.className = 'network-item-header';

      const title = document.createElement('div');
      title.className = 'network-item-title';
      title.textContent = this.getNetworkLabel(network, `Chain ${network.chainId || ''}`.trim());
      if (network.key === DEFAULT_NETWORK || network.id === DEFAULT_NETWORK) {
        const defaultBadge = document.createElement('span');
        defaultBadge.className = 'network-badge';
        defaultBadge.textContent = '默认';
        title.appendChild(defaultBadge);
      }
      if (isNetworkCurrent) {
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
      meta.textContent = `Chain ID: ${network.chainIdHex || network.chainId} | 符号: ${network.symbol || network.nativeCurrency?.symbol || 'ETH'}`;

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
    const targetChainId = network?.chainIdHex || network?.chainId;
    if (!targetChainId) return;
    const allNetworks = await this.network.getNetworks();
    if (Array.isArray(allNetworks) && allNetworks.length <= 1) {
      showError('至少保留一个网络');
      return;
    }
    if (!confirm(`确定要删除 "${network.chainName || network.name || targetChainId}" 吗？`)) {
      return;
    }

    try {
      await this.network.removeNetwork(targetChainId);
      const currentChainId = await this.network.getChainId();
      if (currentChainId === normalizeChainId(targetChainId)) {
        const remaining = (await this.network.getNetworks()) || [];
        const fallback = remaining.find(item => item?.key === DEFAULT_NETWORK || item?.id === DEFAULT_NETWORK) || remaining[0];
        const fallbackRpc = fallback?.rpcUrl || fallback?.rpc || '';
        if (fallbackRpc) {
          await this.network.setRpcUrl(fallbackRpc);
          const chainId = await this.network.getChainId();
          updateNetworkIndicator(chainId);
          if (this.onNetworkChanged) {
            await this.onNetworkChanged();
          }
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
      showError('请输入网络名称');
      return;
    }
    if (!rpcUrl) {
      showError('请输入 RPC URL');
      return;
    }
    if (!chainIdRaw) {
      showError('请输入 Chain ID');
      return;
    }

    let chainId;
    try {
      chainId = normalizeChainId(chainIdRaw);
    } catch (error) {
      showError('Chain ID 格式不正确');
      return;
    }

    if (editingChainId && chainId !== normalizeChainId(editingChainId)) {
      showError('编辑时不允许修改 Chain ID');
      return;
    }

    try {
      showWaiting();

      if (editingChainId) {
        await this.network.updateNetwork(chainId, {
          chainName,
          rpcUrl,
          explorer,
          symbol,
          decimals: 18
        });
      } else {
        await this.network.addNetwork({
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
      showError('保存失败: ' + error.message);
    }
  }

}

function updateNetworkIndicator(chainId) {
  const indicators = document.querySelectorAll('.network-dot');
  if (!indicators || indicators.length === 0) return;
  const isMainnet = chainId === '1' || chainId === 1;
  indicators.forEach((indicator) => {
    indicator.style.backgroundColor = isMainnet ? '#10B981' : '#F59E0B';
  });
}
