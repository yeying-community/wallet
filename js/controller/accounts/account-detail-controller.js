import { showPage, showSuccess, showError, copyAddressToClipboard, generateQRCode, createCopyToastHandler } from '../../common/ui/index.js';
import { shortenAddress, generateAvatar } from '../../common/utils/index.js';

export class AccountDetailController {
  constructor({ wallet, onWalletListRefresh }) {
    this.wallet = wallet;
    this.onWalletListRefresh = onWalletListRefresh;
    this.currentDetailAccountId = null;
    this.currentDetailAddress = '';
  }

  bindEvents() {
    const nameRow = document.getElementById('accountDetailNameRow');
    const editBtn = document.getElementById('editAccountNameBtn');
    const saveBtn = document.getElementById('saveAccountNameBtn');
    const cancelBtn = document.getElementById('cancelAccountNameBtn');
    const nameInput = document.getElementById('accountDetailNameInput');

    nameRow?.addEventListener('click', () => {
      if (this.currentDetailAccountId) {
        this.enterAccountNameEdit();
      }
    });
    editBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.currentDetailAccountId) {
        this.enterAccountNameEdit();
      }
    });
    saveBtn?.addEventListener('click', async () => {
      await this.saveAccountNameEdit();
    });
    cancelBtn?.addEventListener('click', () => {
      this.exitAccountNameEdit();
    });
    nameInput?.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await this.saveAccountNameEdit();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.exitAccountNameEdit();
      }
    });

    const addressEl = document.getElementById('accountDetailAddress');
    if (addressEl) {
      addressEl.addEventListener('click', (event) => {
        event.preventDefault();
      });
    }

    const copyBtn = document.getElementById('copyAccountAddressBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        await this.handleAccountAddressCopy();
      });
    }

    const sizeSelect = document.getElementById('accountDetailQrSize');
    if (sizeSelect) {
      sizeSelect.addEventListener('change', () => {
        if (!this.currentDetailAddress) return;
        const size = parseInt(sizeSelect.value, 10) || 160;
        generateQRCode(this.currentDetailAddress, 'accountDetailQr', { width: size, height: size });
      });
    }

    const exportBtn = document.getElementById('exportAccountQrBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        this.handleExportAccountQr();
      });
    }
  }

  async openAccountDetails(accountId) {
    try {
      const account = await this.wallet.getAccountById(accountId);
      if (!account) {
        showError('账户不存在');
        return;
      }

      this.currentDetailAccountId = account.id;
      this.currentDetailAddress = account.address || '';

      const nameEl = document.getElementById('accountDetailNameText');
      const nameInput = document.getElementById('accountDetailNameInput');
      const typeEl = document.getElementById('accountDetailType');
      const addressEl = document.getElementById('accountDetailAddress');
      const avatarEl = document.getElementById('accountDetailAvatar');
      const sizeSelect = document.getElementById('accountDetailQrSize');

      if (nameEl) {
        nameEl.textContent = account.name || '账户';
      }
      if (nameInput) {
        nameInput.value = account.name || '';
      }
      if (typeEl) {
        typeEl.textContent = this.formatAccountType(account.type);
      }
      if (addressEl) {
        addressEl.textContent = account.address ? shortenAddress(account.address) : '';
      }
      if (avatarEl) {
        avatarEl.innerHTML = '';
        try {
          const size = avatarEl.clientWidth || 64;
          const canvas = generateAvatar(account.address, size);
          avatarEl.appendChild(canvas);
        } catch (error) {
          // ignore invalid address
        }
      }

      const qrContainer = document.getElementById('accountDetailQr');
      if (qrContainer) {
        qrContainer.innerHTML = '';
        if (!account.address) {
          qrContainer.innerHTML = '<span style="color: #999">无地址</span>';
        } else {
          const qrSize = parseInt(sizeSelect?.value, 10) || 160;
          generateQRCode(account.address, 'accountDetailQr', { width: qrSize, height: qrSize });
        }
      }

      this.exitAccountNameEdit(true);
      showPage('accountDetailPage');
    } catch (error) {
      console.error('[AccountDetailController] 打开账户详情失败:', error);
      showError('操作失败');
    }
  }

  async handleAccountAddressCopy() {
    if (!this.currentDetailAddress) return;
    await copyAddressToClipboard(this.currentDetailAddress, this.getCopyToastHandler());
  }

  getCopyToastHandler() {
    return createCopyToastHandler({
      onSuccess: (message) => showSuccess(message),
      onError: (message) => showError(message)
    });
  }

  enterAccountNameEdit() {
    const nameRow = document.getElementById('accountDetailNameRow');
    const editWrap = document.getElementById('accountDetailNameEdit');
    const nameInput = document.getElementById('accountDetailNameInput');
    const nameText = document.getElementById('accountDetailNameText');

    if (nameInput && nameText) {
      nameInput.value = nameText.textContent?.trim() || '';
      nameInput.focus();
      nameInput.select();
    }

    nameRow?.classList.add('hidden');
    editWrap?.classList.remove('hidden');
  }

  exitAccountNameEdit(reset = false) {
    const nameRow = document.getElementById('accountDetailNameRow');
    const editWrap = document.getElementById('accountDetailNameEdit');
    const nameInput = document.getElementById('accountDetailNameInput');
    const nameText = document.getElementById('accountDetailNameText');

    if (reset && nameInput && nameText) {
      nameInput.value = nameText.textContent?.trim() || '';
    }

    editWrap?.classList.add('hidden');
    nameRow?.classList.remove('hidden');
  }

  async saveAccountNameEdit() {
    if (!this.currentDetailAccountId) return;
    const nameInput = document.getElementById('accountDetailNameInput');
    const newName = nameInput?.value.trim() || '';
    if (!newName) {
      showError('请输入账户名称');
      return;
    }
    if (newName.length > 20) {
      showError('账户名称不能超过20个字符');
      return;
    }

    try {
      await this.wallet.updateAccountName(this.currentDetailAccountId, newName);
      const nameText = document.getElementById('accountDetailNameText');
      if (nameText) {
        nameText.textContent = newName;
      }
      await this.onWalletListRefresh?.();
      this.exitAccountNameEdit(true);
      showSuccess('账户名称已更新');
    } catch (error) {
      console.error('[AccountDetailController] 更新账户名称失败:', error);
      showError('更新失败: ' + error.message);
    }
  }

  handleExportAccountQr() {
    const container = document.getElementById('accountDetailQr');
    if (!container) return;

    let dataUrl = null;
    const canvas = container.querySelector('canvas');
    if (canvas) {
      dataUrl = canvas.toDataURL('image/png');
    } else {
      const img = container.querySelector('img');
      if (img?.src && img.src.startsWith('data:image')) {
        dataUrl = img.src;
      }
    }

    if (!dataUrl) {
      showError('二维码不可导出');
      return;
    }

    const filename = this.currentDetailAddress
      ? `qrcode_${this.currentDetailAddress.slice(2, 8)}.png`
      : 'qrcode.png';
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showSuccess('二维码已导出');
  }

  formatAccountType(type) {
    if (!type) return 'HD';
    if (type === 'hd') return 'HD';
    if (type === 'imported') return '导入';
    return type.toString().toUpperCase();
  }
}
