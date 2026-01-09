import { showPage, showStatus, showError, getPageOrigin } from '../../common/ui/index.js';

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

        if (type === 'mnemonic') {
          mnemonicSection?.classList.remove('hidden');
          privateKeySection?.classList.add('hidden');
        } else {
          mnemonicSection?.classList.add('hidden');
          privateKeySection?.classList.remove('hidden');
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
      showStatus('importStatus', '正在导入...', 'info');

      if (useExistingPassword) {
        await this.verifyExistingPassword(password);
      }

      if (importType === 'mnemonic') {
        const mnemonic = document.getElementById('importMnemonic')?.value.trim();
        if (!mnemonic) {
          showStatus('importStatus', '请输入助记词', 'error');
          return;
        }
        await this.wallet.importFromMnemonic(name, mnemonic, password);
      } else {
        const privateKey = document.getElementById('importPrivateKey')?.value.trim();
        if (!privateKey) {
          showStatus('importStatus', '请输入私钥', 'error');
          return;
        }
        await this.wallet.importFromPrivateKey(name, privateKey, password);
      }

      showStatus('importStatus', '导入成功！', 'success');

      setTimeout(() => {
        showPage('walletPage');
        if (this.onImportSuccess) {
          this.onImportSuccess();
        }
      }, 1000);
    } catch (error) {
      showStatus('importStatus', `导入失败: ${error.message}`, 'error');
    }
  }

  handleCancel() {
    const origin = getPageOrigin('importPage', 'welcome');
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
