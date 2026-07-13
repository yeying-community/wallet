import { showPage, showError, showSuccess, showWaiting, getPageOrigin } from '../../common/ui/index.js';

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

  if (!resetType) {
    return;
  }

  const tabs = Array.from(document.querySelectorAll('.import-tab'));
  const mnemonicTab = tabs.find((tab) => tab?.dataset?.type === 'mnemonic');
  const privateKeyTab = tabs.find((tab) => tab?.dataset?.type === 'privateKey');
  const mnemonicSection = document.getElementById('mnemonicImportSection');
  const privateKeySection = document.getElementById('privateKeyImportSection');
  const fileSection = document.getElementById('fileImportSection');
  const nameGroup = document.getElementById('importWalletNameGroup');

  mnemonicTab?.classList.add('active');
  privateKeyTab?.classList.remove('active');
  mnemonicSection?.classList.remove('hidden');
  privateKeySection?.classList.add('hidden');
  fileSection?.classList.add('hidden');
  nameGroup?.classList.remove('hidden');
}

export class ImportWalletController {
  constructor({ wallet, onImportSuccess }) {
    this.wallet = wallet;
    this.onImportSuccess = onImportSuccess;
  }

  bindEvents() {
    document.querySelectorAll('.import-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.import-tab').forEach(t => {
          t.classList.remove('active');
        });
        e.target.classList.add('active');

        const type = e.target.dataset.type;
        const mnemonicSection = document.getElementById('mnemonicImportSection');
        const privateKeySection = document.getElementById('privateKeyImportSection');
        const fileSection = document.getElementById('fileImportSection');
        const nameGroup = document.getElementById('importWalletNameGroup');
        const importBtn = document.getElementById('importBtn');

        if (type === 'mnemonic') {
          mnemonicSection?.classList.remove('hidden');
          privateKeySection?.classList.add('hidden');
          fileSection?.classList.add('hidden');
          nameGroup?.classList.remove('hidden');
          if (importBtn) importBtn.textContent = '导入钱包';
        } else if (type === 'privateKey') {
          mnemonicSection?.classList.add('hidden');
          privateKeySection?.classList.remove('hidden');
          fileSection?.classList.add('hidden');
          nameGroup?.classList.remove('hidden');
          if (importBtn) importBtn.textContent = '导入钱包';
        } else {
          mnemonicSection?.classList.add('hidden');
          privateKeySection?.classList.add('hidden');
          fileSection?.classList.remove('hidden');
          nameGroup?.classList.add('hidden');
          if (importBtn) importBtn.textContent = '导入备份';
        }
      });
    });

    const importBtn = document.getElementById('importBtn');
    if (importBtn) {
      importBtn.addEventListener('click', async () => {
        await this.handleImportWallet();
      });
    }

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
    const activeTab = document.querySelector('.import-tab.active');
    const importType = activeTab?.dataset.type;
    const origin = getPageOrigin('importPage', 'welcome');
    const useExistingPassword = origin === 'accounts';

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
        await this.wallet.importFromMnemonic(name, mnemonic, password);
      } else if (importType === 'privateKey') {
        const privateKey = document.getElementById('importPrivateKey')?.value.trim();
        await this.wallet.importFromPrivateKey(name, privateKey, password);
      } else {
        const file = document.getElementById('importAccountsFile')?.files?.[0];
        let parsed;
        try {
          parsed = JSON.parse(await file.text());
        } catch {
          throw new Error('备份文件不是有效的 JSON');
        }
        const result = await this.wallet.importAccountsFile(parsed, password);
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
