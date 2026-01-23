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

    const networkMenuBtn = document.getElementById('networkMenuBtn');
    const networkMenu = document.getElementById('networkMenu');
    if (networkMenuBtn && networkMenu) {
      networkMenuBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleNetworkManageMenu();
      });

      networkMenu.addEventListener('click', async (event) => {
        const target = event.target.closest('button');
        if (!target) return;
        const action = target.dataset.action;
        if (action === 'import') {
          const input = document.getElementById('networkImportInput');
          input?.click();
        }
        if (action === 'export') {
          await this.handleExportNetworks();
        }
        this.closeNetworkManageMenu();
      });
    }

    document.addEventListener('click', (event) => {
      if (!networkMenu || !networkMenuBtn) return;
      if (networkMenu.classList.contains('hidden')) return;
      const target = event.target;
      if (networkMenu.contains(target) || networkMenuBtn.contains(target)) {
        return;
      }
      this.closeNetworkManageMenu();
    });

    const networkImportInput = document.getElementById('networkImportInput');
    if (networkImportInput) {
      networkImportInput.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (file) {
          await this.handleImportNetworks(file);
        }
        event.target.value = '';
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

  async syncSelectedNetwork() {
    if (!this.network) return false;
    try {
      const savedKey = await getSelectedNetworkName();
      if (!savedKey) return false;

      const config = await getNetworkConfigByKey(savedKey);
      if (!config) return false;

      const targetRpc = config.rpcUrl || config.rpc;
      if (!targetRpc) return false;

      let currentRpc = null;
      try {
        currentRpc = await this.network.getRpcUrl();
      } catch {
        currentRpc = null;
      }

      if (currentRpc && currentRpc === targetRpc) {
        this.currentNetworkValue = currentRpc;
        return true;
      }

      await this.network.switchNetwork(savedKey);

      const chainId = await this.network.getChainId();
      updateNetworkIndicator(chainId);
      this.currentNetworkValue = targetRpc;
      await this.refreshNetworkOptions(targetRpc);
      return true;
    } catch (error) {
      console.warn('[NetworkController] 同步网络失败:', error);
      return false;
    }
  }

  async handleNetworkChange(rpcUrl) {
    try {
      if (!rpcUrl) return;

      this.closeAllMenus();
      showWaiting();
      await waitForNextFrame();

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
    this.closeNetworkManageMenu();
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

  toggleNetworkManageMenu() {
    const menu = document.getElementById('networkMenu');
    if (!menu) return;
    if (menu.classList.contains('hidden')) {
      this.openNetworkManageMenu();
    } else {
      this.closeNetworkManageMenu();
    }
  }

  openNetworkManageMenu() {
    const menu = document.getElementById('networkMenu');
    const trigger = document.getElementById('networkMenuBtn');
    if (!menu || !trigger) return;
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
  }

  closeNetworkManageMenu() {
    const menu = document.getElementById('networkMenu');
    const trigger = document.getElementById('networkMenuBtn');
    if (!menu || !trigger) return;
    menu.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
  }

  async handleExportNetworks() {
    try {
      const networks = await this.network.getNetworks();
      const payload = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        networks: networks || []
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `yeying-networks-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showSuccess('网络已导出');
    } catch (error) {
      console.error('[NetworkController] 导出网络失败:', error);
      showError('导出失败: ' + error.message);
    }
  }

  async handleImportNetworks(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const networks = this.normalizeImportedNetworks(data);
      if (!networks.length) {
        showError('未找到有效网络数据');
        return;
      }

      const existing = await this.network.getNetworks();
      const existingMap = new Map();
      (existing || []).forEach((item) => {
        const id = item?.chainIdHex || item?.chainId;
        if (!id) return;
        try {
          existingMap.set(normalizeChainId(id), item);
        } catch {
          existingMap.set(String(id), item);
        }
      });

      let added = 0;
      let updated = 0;
      let failed = 0;

      for (const raw of networks) {
        const normalized = this.normalizeImportedNetwork(raw);
        if (!normalized) {
          failed += 1;
          continue;
        }

        const { chainId, chainName, rpcUrl, explorer, symbol, decimals } = normalized;
        let key = null;
        try {
          key = normalizeChainId(chainId);
        } catch {
          key = String(chainId);
        }

        try {
          const exists = existingMap.get(key);
          if (exists) {
            await this.network.updateNetwork(chainId, {
              chainName,
              rpcUrl,
              explorer,
              symbol,
              decimals
            });
            updated += 1;
          } else {
            await this.network.addNetwork({
              chainName,
              chainId,
              rpcUrls: [rpcUrl],
              blockExplorerUrls: explorer ? [explorer] : [],
              nativeCurrency: {
                symbol: symbol || 'ETH',
                decimals: Number.isFinite(decimals) ? decimals : 18
              }
            });
            added += 1;
          }
        } catch (error) {
          failed += 1;
        }
      }

      await this.loadNetworkList();
      await this.refreshNetworkOptions();
      showSuccess(`导入完成：新增 ${added}，更新 ${updated}，失败 ${failed}`);
    } catch (error) {
      console.error('[NetworkController] 导入网络失败:', error);
      showError('导入失败: ' + error.message);
    }
  }

  normalizeImportedNetworks(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.networks)) return data.networks;
    if (data.networks && typeof data.networks === 'object') {
      return Object.values(data.networks);
    }
    if (data.data?.networks) {
      if (Array.isArray(data.data.networks)) return data.data.networks;
      if (typeof data.data.networks === 'object') {
        return Object.values(data.data.networks);
      }
    }
    return [];
  }

  normalizeImportedNetwork(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const chainId = entry.chainIdHex || entry.chainId || entry.id || entry.key;
    const chainName = entry.chainName || entry.name || entry.networkName;
    const rpcUrl = entry.rpcUrl || entry.rpc || entry.rpcUrls?.[0];
    if (!chainId || !chainName || !rpcUrl) return null;
    return {
      chainId,
      chainName,
      rpcUrl,
      explorer: entry.explorer || entry.blockExplorerUrls?.[0] || '',
      symbol: entry.symbol || entry.nativeCurrency?.symbol || 'ETH',
      decimals: Number.isFinite(entry.decimals) ? entry.decimals : entry.nativeCurrency?.decimals
    };
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

function waitForNextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function updateNetworkIndicator(chainId) {
  const indicators = document.querySelectorAll('.network-dot');
  if (!indicators || indicators.length === 0) return;
  const isMainnet = chainId === '1' || chainId === 1;
  indicators.forEach((indicator) => {
    indicator.style.backgroundColor = isMainnet ? '#10B981' : '#F59E0B';
  });
}
