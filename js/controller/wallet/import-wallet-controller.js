import { showPage, showError, showSuccess, showWaiting, getPageOrigin } from '../../common/ui/index.js';
import { savePopupSessionState } from '../../common/ui/popup-session-state.js';
import { IDENTITY_NODE_ENDPOINT_STORAGE_KEY, normalizeIdentityNodeEndpoint } from '../../config/identity-config.js';

const IMPORT_FIELD_IDS = [
  'importAccountName',
  'importMnemonic',
  'importPrivateKey',
  'importWalletPassword',
  'importAccountsFile'
];

// 每个网络对应的 reference 选项 + 默认 reference（决定非 EVM 链走主网还是测试网）
const NETWORK_REFERENCES = {
  evm: [], // EVM 固定 eip155:1，无 reference 可选
  tron: [
    { value: 'mainnet', label: 'Mainnet' },
    { value: 'shasta', label: 'Shasta (Testnet)' },
    { value: 'nile', label: 'Nile (Testnet)' }
  ],
  solana: [
    { value: 'mainnet-beta', label: 'Mainnet' },
    { value: 'devnet', label: 'Devnet' },
    { value: 'testnet', label: 'Testnet' }
  ],
  bitcoin: [
    { value: 'mainnet', label: 'Mainnet' },
    { value: 'testnet', label: 'Testnet' }
  ]
};
const NETWORK_DEFAULT_REFERENCE = {
  tron: 'mainnet',
  solana: 'mainnet-beta',
  bitcoin: 'mainnet'
};

export function clearImportWalletForm({ resetType = true } = {}) {
  IMPORT_FIELD_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = '';
    }
  });

  const fileName = document.getElementById('importAccountsFileName');
  if (fileName) {
    fileName.textContent = '支持 JSON 格式的加密备份文件';
    fileName.title = '';
  }

  if (!resetType) {
    return;
  }

  const sourceTabs = Array.from(document.querySelectorAll('.import-source-tab'));
  const mnemonicSection = document.getElementById('mnemonicImportSection');
  const privateKeySection = document.getElementById('privateKeyImportSection');
  const fileSection = document.getElementById('fileImportSection');
  const nameGroup = document.getElementById('importWalletNameGroup');
  const walletSection = document.getElementById('walletImportSection');
  const custodySection = document.getElementById('custodyImportSection');
  const passwordGroup = document.getElementById('importWalletPasswordGroup');

  sourceTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.source === 'wallet'));
  walletSection?.classList.remove('hidden');
  custodySection?.classList.add('hidden');
  passwordGroup?.classList.remove('hidden');
  // 网络选择器重置到 evm
  const networkSelect = document.getElementById('importNetworkSelect');
  if (networkSelect) networkSelect.value = 'evm';
  const networkLabel = document.getElementById('importNetworkLabel');
  if (networkLabel) networkLabel.textContent = 'Ethereum';
  const networkMenu = document.getElementById('importNetworkMenu');
  networkMenu?.querySelectorAll('.network-option').forEach((opt) => {
    opt.classList.toggle('active', opt.dataset.networkValue === 'evm');
  });
  // 方法 switch 重置到 mnemonic
  setActiveMethod('mnemonic');
  // reference 选择器重置到 evm 默认隐藏
  setActiveNetwork('evm');
  mnemonicSection?.classList.remove('hidden');
  privateKeySection?.classList.add('hidden');
  fileSection?.classList.add('hidden');
  nameGroup?.classList.remove('hidden');
}

/**
 * 切换 import method（mnemonic ↔ privateKey）。同步高亮 + section 显隐。
 */
function setActiveMethod(method) {
  const opts = Array.from(document.querySelectorAll('.import-method-option'));
  opts.forEach((opt) => {
    const active = opt.dataset.method === method;
    opt.classList.toggle('active', active);
    opt.setAttribute('aria-checked', String(active));
  });
  const mnemonicSection = document.getElementById('mnemonicImportSection');
  const privateKeySection = document.getElementById('privateKeyImportSection');
  if (method === 'privateKey') {
    mnemonicSection?.classList.add('hidden');
    privateKeySection?.classList.remove('hidden');
  } else {
    mnemonicSection?.classList.remove('hidden');
    privateKeySection?.classList.add('hidden');
  }
}

/**
 * 切换当前网络（决定是否展示 reference 选择器 + 用哪个 reference 列表）。
 */
function setActiveNetwork(network) {
  const refs = NETWORK_REFERENCES[network] || [];
  const refGroup = document.getElementById('importReferenceGroup');
  const refMenu = document.getElementById('importReferenceMenu');
  const refSelect = document.getElementById('importReferenceSelect');
  if (refs.length === 0) {
    refGroup?.classList.add('hidden');
    if (refSelect) refSelect.value = '';
    return;
  }
  refGroup?.classList.remove('hidden');
  // 用所选网络的 reference 选项重写菜单 + <select>
  if (refMenu) {
    refMenu.innerHTML = '';
    for (const r of refs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'network-option';
      btn.dataset.referenceValue = r.value;
      btn.textContent = r.label;
      refMenu.appendChild(btn);
    }
  }
  if (refSelect) {
    refSelect.innerHTML = '';
    for (const r of refs) {
      const opt = document.createElement('option');
      opt.value = r.value;
      opt.textContent = r.label;
      refSelect.appendChild(opt);
    }
    const defaultRef = NETWORK_DEFAULT_REFERENCE[network] || refs[0].value;
    refSelect.value = defaultRef;
    const labelEl = document.getElementById('importReferenceLabel');
    if (labelEl) {
      const match = refs.find((r) => r.value === defaultRef);
      labelEl.textContent = match ? match.label : defaultRef;
    }
    refMenu?.querySelectorAll('.network-option').forEach((opt) => {
      opt.classList.toggle('active', opt.dataset.referenceValue === defaultRef);
    });
  }
}

export class ImportWalletController {
  constructor({ wallet, onImportSuccess, onStartCustodyRecovery, onRestoreCustodyRecovery, onRecoveryReady, onCancelCustodyRecovery }) {
    this.wallet = wallet;
    this.onImportSuccess = onImportSuccess;
    this.onStartCustodyRecovery = onStartCustodyRecovery;
    this.onRestoreCustodyRecovery = onRestoreCustodyRecovery;
    this.onRecoveryReady = onRecoveryReady;
    this.onCancelCustodyRecovery = onCancelCustodyRecovery;
  }

  bindEvents() {
    // source tabs (助记词/私钥 · 备份文件 · 云端恢复) —— 仅这层保留旧 6-tab 设计
    const sourceTabs = Array.from(document.querySelectorAll('.import-source-tab'));
    sourceTabs.forEach((tab) => {
      tab.addEventListener('click', (e) => {
        const clicked = e.currentTarget || e.target;
        sourceTabs.forEach((t) => t.classList.remove('active'));
        clicked.classList.add('active');
        const source = clicked.dataset.source;
        const mnemonicSection = document.getElementById('mnemonicImportSection');
        const privateKeySection = document.getElementById('privateKeyImportSection');
        const fileSection = document.getElementById('fileImportSection');
        const walletSection = document.getElementById('walletImportSection');
        const custodySection = document.getElementById('custodyImportSection');
        const nameGroup = document.getElementById('importWalletNameGroup');
        const passwordGroup = document.getElementById('importWalletPasswordGroup');
        const refGroup = document.getElementById('importReferenceGroup');
        const importBtn = document.getElementById('importBtn');
        if (source === 'custody') {
          walletSection?.classList.add('hidden');
          mnemonicSection?.classList.add('hidden');
          privateKeySection?.classList.add('hidden');
          fileSection?.classList.add('hidden');
          custodySection?.classList.remove('hidden');
          nameGroup?.classList.add('hidden');
          passwordGroup?.classList.add('hidden');
          refGroup?.classList.add('hidden');
          if (importBtn) importBtn.textContent = '开始恢复';
        } else if (source === 'file') {
          walletSection?.classList.add('hidden');
          mnemonicSection?.classList.add('hidden');
          privateKeySection?.classList.add('hidden');
          fileSection?.classList.remove('hidden');
          custodySection?.classList.add('hidden');
          nameGroup?.classList.add('hidden');
          passwordGroup?.classList.remove('hidden');
          refGroup?.classList.add('hidden');
          if (importBtn) importBtn.textContent = '导入备份';
        } else {
          // 'wallet' source
          walletSection?.classList.remove('hidden');
          custodySection?.classList.add('hidden');
          fileSection?.classList.add('hidden');
          const method = document.querySelector('.import-method-option.active')?.dataset.method || 'mnemonic';
          if (method === 'mnemonic') {
            mnemonicSection?.classList.remove('hidden');
            privateKeySection?.classList.add('hidden');
          } else {
            mnemonicSection?.classList.add('hidden');
            privateKeySection?.classList.remove('hidden');
          }
          nameGroup?.classList.remove('hidden');
          passwordGroup?.classList.remove('hidden');
          // 根据当前网络决定是否显示 reference 选择器
          const network = document.getElementById('importNetworkSelect')?.value || 'evm';
          if ((NETWORK_REFERENCES[network] || []).length > 0) {
            refGroup?.classList.remove('hidden');
          } else {
            refGroup?.classList.add('hidden');
          }
          if (importBtn) importBtn.textContent = '导入钱包';
        }
        void savePopupSessionState('importPage').catch((error) => {
          console.warn('[ImportWalletController] 保存导入页面状态失败:', error);
        });
      });
    });

    // 网络选择器（Ethereum / Tron / Solana / Bitcoin）
    this.bindImportNetworkDropdown();
    // 非 EVM reference 选择器（mainnet/testnet 等）
    this.bindImportReferenceDropdown();
    // 助记词 / 私钥 switch
    this.bindImportMethodSwitch();

    const importBtn = document.getElementById('importBtn');
    if (importBtn) {
      importBtn.addEventListener('click', async () => {
        await this.handleImportWallet();
      });
    }

    const fileInput = document.getElementById('importAccountsFile');
    fileInput?.addEventListener('change', () => {
      const name = fileInput.files?.[0]?.name;
      const nameEl = document.getElementById('importAccountsFileName');
      if (nameEl) {
        nameEl.textContent = name || '支持 JSON 格式的加密备份文件';
        nameEl.title = name || '';
      }
    });

    const cancelImportBtn = document.getElementById('cancelImportBtn');
    if (cancelImportBtn) {
      cancelImportBtn.addEventListener('click', () => {
        this.handleCancel();
      });
    }
  }

  bindImportNetworkDropdown() {
    const trigger = document.getElementById('importNetworkTrigger');
    const menu = document.getElementById('importNetworkMenu');
    const select = document.getElementById('importNetworkSelect');
    if (!trigger || !menu || !select) return;

    const closeMenu = () => {
      if (!menu.classList.contains('hidden')) {
        menu.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
      }
    };

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const isHidden = menu.classList.contains('hidden');
      if (isHidden) {
        menu.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
      } else {
        closeMenu();
      }
    });

    menu.addEventListener('click', (event) => {
      const option = event.target.closest('.network-option');
      if (!option) return;
      const nextNetwork = option.dataset.networkValue;
      if (!nextNetwork) return;
      const current = select.value;
      if (current !== nextNetwork) {
        select.value = nextNetwork;
        const labelEl = document.getElementById('importNetworkLabel');
        if (labelEl) labelEl.textContent = option.textContent.trim();
        menu.querySelectorAll('.network-option').forEach((opt) => {
          opt.classList.toggle('active', opt.dataset.networkValue === nextNetwork);
        });
        setActiveNetwork(nextNetwork);
      }
      closeMenu();
    });

    document.addEventListener('click', (event) => {
      if (menu.classList.contains('hidden')) return;
      if (trigger.contains(event.target) || menu.contains(event.target)) return;
      closeMenu();
    });
  }

  bindImportReferenceDropdown() {
    const trigger = document.getElementById('importReferenceTrigger');
    const menu = document.getElementById('importReferenceMenu');
    const select = document.getElementById('importReferenceSelect');
    if (!trigger || !menu || !select) return;

    const closeMenu = () => {
      if (!menu.classList.contains('hidden')) {
        menu.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
      }
    };

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const isHidden = menu.classList.contains('hidden');
      if (isHidden) {
        menu.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
      } else {
        closeMenu();
      }
    });

    menu.addEventListener('click', (event) => {
      const option = event.target.closest('.network-option');
      if (!option) return;
      const nextRef = option.dataset.referenceValue;
      if (!nextRef) return;
      if (select.value !== nextRef) {
        select.value = nextRef;
        const labelEl = document.getElementById('importReferenceLabel');
        if (labelEl) labelEl.textContent = option.textContent.trim();
        menu.querySelectorAll('.network-option').forEach((opt) => {
          opt.classList.toggle('active', opt.dataset.referenceValue === nextRef);
        });
      }
      closeMenu();
    });

    document.addEventListener('click', (event) => {
      if (menu.classList.contains('hidden')) return;
      if (trigger.contains(event.target) || menu.contains(event.target)) return;
      closeMenu();
    });
  }

  bindImportMethodSwitch() {
    const options = Array.from(document.querySelectorAll('.import-method-option'));
    options.forEach((opt) => {
      opt.addEventListener('click', () => {
        const method = opt.dataset.method;
        if (!method) return;
        setActiveMethod(method);
        void savePopupSessionState('importPage').catch((error) => {
          console.warn('[ImportWalletController] 保存导入页面状态失败:', error);
        });
      });
    });
  }

  async handleImportWallet() {
    const name = document.getElementById('importAccountName')?.value.trim() || '导入钱包';
    const password = document.getElementById('importWalletPassword')?.value;
    const source = document.querySelector('.import-source-tab.active')?.dataset.source || 'wallet';
    // 从新的 UI 读取 method + chain：method switch 的 active 项，chain = 网络选择器
    const methodType = document.querySelector('.import-method-option.active')?.dataset.method || 'mnemonic';
    const methodChain = String(document.getElementById('importNetworkSelect')?.value || 'evm').toLowerCase();
    // 「备份文件」来源使用文件导入分支；「助记词/私钥」来源才由 switch 决定类型。
    const importType = source === 'file' ? 'file' : methodType;
    const origin = getPageOrigin('importPage', 'welcome');
    const useExistingPassword = origin === 'accounts';

    if (source === 'custody') {
      try {
        if (this.onRestoreCustodyRecovery && this.onRecoveryReady?.()) {
          await this.onRestoreCustodyRecovery();
        } else {
          await this.onStartCustodyRecovery?.();
        }
      } catch (error) {
        showError(`无法发起恢复：${error?.message || '未知错误'}`);
      }
      return;
    }
    if (!password || password.length < 8) {
      showError(useExistingPassword ? '请输入当前密码（至少8位）' : '密码至少需要8位字符');
      return;
    }

    try {
      if (importType === 'mnemonic') {
        const mnemonic = document.getElementById('importMnemonic')?.value.trim();
        if (!mnemonic) {
          showError('请输入助记词');
          return;
        }
      } else if (importType === 'privateKey') {
        const privateKey = document.getElementById('importPrivateKey')?.value.trim();
        if (!privateKey) {
          showError('请输入私钥');
          return;
        }
      } else if (!document.getElementById('importAccountsFile')?.files?.[0]) {
        showError('请选择账户备份文件');
        return;
      }

      showWaiting();

      if (useExistingPassword) {
        await this.verifyExistingPassword(password);
      }

      // 按网络 × 方法分发到对应 vault 构造函数。reference 选项统一从 importReferenceSelect 读。
      const reference = String(document.getElementById('importReferenceSelect')?.value || '').toLowerCase();
      const importOptions = this.buildImportOptions(methodChain, reference);

      if (importType === 'mnemonic') {
        const mnemonic = document.getElementById('importMnemonic')?.value.trim();
        if (methodChain === 'tron') {
          await this.wallet.importTronFromMnemonic(name, mnemonic, password, importOptions);
        } else if (methodChain === 'solana') {
          await this.wallet.importSolanaFromMnemonic(name, mnemonic, password, importOptions);
        } else if (methodChain === 'bitcoin') {
          await this.wallet.importBitcoinFromMnemonic(name, mnemonic, password, importOptions);
        } else {
          await this.wallet.importFromMnemonic(name, mnemonic, password);
        }
      } else if (importType === 'privateKey') {
        const privateKey = document.getElementById('importPrivateKey')?.value.trim();
        if (methodChain === 'tron') {
          await this.wallet.importTronFromPrivateKey(name, privateKey, password, importOptions);
        } else if (methodChain === 'solana') {
          await this.wallet.importSolanaFromPrivateKey(name, privateKey, password, importOptions);
        } else if (methodChain === 'bitcoin') {
          await this.wallet.importBitcoinFromPrivateKey(name, privateKey, password, importOptions);
        } else {
          await this.wallet.importFromPrivateKey(name, privateKey, password);
        }
      } else {
        const file = document.getElementById('importAccountsFile')?.files?.[0];
        let parsed;
        try {
          parsed = JSON.parse(await file.text());
        } catch {
          throw new Error('备份文件不是有效的 JSON');
        }
        const result = await this.wallet.importAccountsFile(parsed, password);
        const identityEndpoint = normalizeIdentityNodeEndpoint(result?.identityEndpoint);
        if (identityEndpoint) {
          try { globalThis.localStorage?.setItem(IDENTITY_NODE_ENDPOINT_STORAGE_KEY, identityEndpoint); } catch { /* storage may be unavailable */ }
          const endpointInput = document.getElementById('walletIdentityEndpointInput');
          if (endpointInput) endpointInput.value = identityEndpoint;
        }
        showSuccess(`导入 ${result.imported} 个账户，跳过 ${result.skipped} 个重复账户`);
      }

      if (importType !== 'file') showSuccess('导入成功！');
      clearImportWalletForm();

      setTimeout(() => {
        showPage('walletPage');
        if (this.onImportSuccess) {
          this.onImportSuccess();
        }
      }, 1000);
    } catch (error) {
      showError(`导入失败: ${error.message}`);
    }
  }

  /**
   * 把「网络 + reference」打包成对应 vault 构造函数所需的 options 对象。
   * EVM 没有 reference 字段，返回空对象；其它链按数据键名（tronReference / solanaReference /
   * bitcoinReference）映射。
   */
  buildImportOptions(network, reference) {
    if (!reference) return {};
    const key = ({
      tron: 'tronReference',
      solana: 'solanaReference',
      bitcoin: 'bitcoinReference'
    })[network];
    if (!key) return {};
    return { [key]: reference };
  }

  handleCancel() {
    const source = document.querySelector('.import-source-tab.active')?.dataset.source;
    if (source === 'custody') {
      void this.onCancelCustodyRecovery?.();
    }
    const origin = getPageOrigin('importPage', 'welcome');
    clearImportWalletForm();
    if (origin === 'accounts') {
      showPage('accountsPage');
      return;
    }

    showPage('welcomePage');
  }

  async verifyExistingPassword(password) {
    const account = await this.wallet.getCurrentAccount();
    if (!account?.id) {
      throw new Error('未找到当前账户');
    }
    await this.wallet.exportPrivateKey(account.id, password);
  }


}
