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

  const tabs = Array.from(document.querySelectorAll('.import-tab'));
  const sourceTabs = Array.from(document.querySelectorAll('.import-source-tab'));
  const mnemonicTab = tabs.find((tab) => tab?.dataset?.type === 'mnemonic');
  const privateKeyTab = tabs.find((tab) => tab?.dataset?.type === 'privateKey');
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
  mnemonicTab?.classList.add('active');
  privateKeyTab?.classList.remove('active');
  mnemonicSection?.classList.remove('hidden');
  privateKeySection?.classList.add('hidden');
  fileSection?.classList.add('hidden');
  nameGroup?.classList.remove('hidden');
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
    const sourceTabs = [...document.querySelectorAll('.import-source-tab')];
    const methodTabs = [...document.querySelectorAll('.import-method-tab'), ...document.querySelectorAll('.import-tab')]
      .filter((tab, index, list) => list.indexOf(tab) === index);
    const tabs = [...sourceTabs, ...methodTabs];
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        const clicked = e.currentTarget || e.target;
        const group = clicked.classList?.contains('import-source-tab') ? sourceTabs : methodTabs;
        group.forEach(t => {
          t.classList.remove('active');
        });
        clicked.classList.add('active');

        const source = clicked.dataset.source;
        const type = clicked.dataset.type;
        const chain = String(clicked.dataset.chain || 'evm').toLowerCase();
        const mnemonicSection = document.getElementById('mnemonicImportSection');
        const privateKeySection = document.getElementById('privateKeyImportSection');
        const fileSection = document.getElementById('fileImportSection');
        const walletSection = document.getElementById('walletImportSection');
        const custodySection = document.getElementById('custodyImportSection');
        const nameGroup = document.getElementById('importWalletNameGroup');
        const passwordGroup = document.getElementById('importWalletPasswordGroup');
        const tronNetworkGroup = document.getElementById('tronImportNetworkGroup');
        const importBtn = document.getElementById('importBtn');

        if (source === 'custody') {
          walletSection?.classList.add('hidden');
          mnemonicSection?.classList.add('hidden');
          privateKeySection?.classList.add('hidden');
          fileSection?.classList.add('hidden');
          custodySection?.classList.remove('hidden');
          nameGroup?.classList.add('hidden');
          passwordGroup?.classList.add('hidden');
          if (importBtn) importBtn.textContent = '开始恢复';
        } else if (source === 'file' || type === 'file') {
          walletSection?.classList.add('hidden');
          mnemonicSection?.classList.add('hidden');
          privateKeySection?.classList.add('hidden');
          fileSection?.classList.remove('hidden');
          custodySection?.classList.add('hidden');
          nameGroup?.classList.add('hidden');
          passwordGroup?.classList.remove('hidden');
          if (importBtn) importBtn.textContent = '导入备份';
        } else if (type === 'mnemonic' || type === 'privateKey') {
          walletSection?.classList.remove('hidden');
          custodySection?.classList.add('hidden');
          fileSection?.classList.add('hidden');
          if (type === 'mnemonic') {
            mnemonicSection?.classList.remove('hidden');
            privateKeySection?.classList.add('hidden');
          } else {
            mnemonicSection?.classList.add('hidden');
            privateKeySection?.classList.remove('hidden');
          }
          nameGroup?.classList.remove('hidden');
          passwordGroup?.classList.remove('hidden');
          if (tronNetworkGroup) {
            tronNetworkGroup.classList.toggle('hidden', chain !== 'tron');
          }
          if (importBtn) importBtn.textContent = '导入钱包';
        } else {
          walletSection?.classList.remove('hidden');
          mnemonicSection?.classList.add('hidden');
          privateKeySection?.classList.add('hidden');
          fileSection?.classList.add('hidden');
          nameGroup?.classList.add('hidden');
          if (importBtn) importBtn.textContent = '导入备份';
        }
        // The popup may be recreated while the native file chooser is open.
        // Persist the selected mode without persisting secrets or file data.
        void savePopupSessionState('importPage').catch(error => {
          console.warn('[ImportWalletController] 保存导入页面状态失败:', error);
        });
      });
    });

    this.bindTronImportNetworkDropdown();

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

  async handleImportWallet() {
    const name = document.getElementById('importAccountName')?.value.trim() || '导入钱包';
    const password = document.getElementById('importWalletPassword')?.value;
    const source = document.querySelector('.import-source-tab.active')?.dataset.source || 'wallet';
    const methodType = document.querySelector('.import-method-tab.active')?.dataset.type || 'mnemonic';
    const methodChain = String(document.querySelector('.import-method-tab.active')?.dataset.chain || 'evm').toLowerCase();
    // 「备份文件」来源使用文件导入分支；「助记词/私钥」来源才由方式 tab 决定类型。
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

      if (importType === 'mnemonic') {
        const mnemonic = document.getElementById('importMnemonic')?.value.trim();
        if (methodChain === 'tron') {
          await this.wallet.importTronFromMnemonic(name, mnemonic, password, { tronReference: this.getTronImportReference() });
        } else {
          await this.wallet.importFromMnemonic(name, mnemonic, password);
        }
      } else if (importType === 'privateKey') {
        const privateKey = document.getElementById('importPrivateKey')?.value.trim();
        if (methodChain === 'tron') {
          await this.wallet.importTronFromPrivateKey(name, privateKey, password, { tronReference: this.getTronImportReference() });
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

  bindTronImportNetworkDropdown() {
    const trigger = document.getElementById('tronImportNetworkTrigger');
    const menu = document.getElementById('tronImportNetworkMenu');
    const select = document.getElementById('tronImportNetworkSelect');
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
      const nextRef = option.dataset.tronReference;
      if (!nextRef) return;
      if (select.value !== nextRef) {
        select.value = nextRef;
        const labelEl = document.getElementById('tronImportNetworkLabel');
        if (labelEl) labelEl.textContent = option.textContent.trim();
        menu.querySelectorAll('.network-option').forEach(opt => {
          opt.classList.toggle('active', opt.dataset.tronReference === nextRef);
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

  getTronImportReference() {
    const select = document.getElementById('tronImportNetworkSelect');
    const value = String(select?.value || 'mainnet').toLowerCase();
    if (value === 'shasta' || value === 'nile') return value;
    return 'mainnet';
  }
}
