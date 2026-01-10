import { showSuccess, showError, showWarning, copyMnemonicToClipboard, copyPrivateKeyToClipboard, createCopyToastHandler } from '../../common/ui/index.js';
import { getTimestamp } from '../../common/utils/time-utils.js';

export class AccountModalsController {
  constructor({ wallet, onWalletListRefresh, onWalletUpdated, onAccountSelected }) {
    this.wallet = wallet;
    this.onWalletListRefresh = onWalletListRefresh;
    this.onWalletUpdated = onWalletUpdated;
    this.onAccountSelected = onAccountSelected;
  }

  bindEvents() {
    this.bindModalButtonEvents(
      'createAccountModal',
      'closeCreateAccountModal',
      'cancelCreateAccount',
      'confirmCreateAccount',
      () => this.handleCreateAccount()
    );

    this.bindModalButtonEvents(
      'deleteAccountModal',
      'closeDeleteAccountModal',
      'cancelDeleteAccount',
      'confirmDeleteAccount',
      () => this.handleDeleteAccount()
    );

    this.bindSecretDisplayEvents();

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', () => {
        closeAllModals();
      });
    });
  }

  bindModalButtonEvents(modalId, closeId, cancelId, confirmId, confirmHandler) {
    const closeBtn = document.getElementById(closeId);
    const cancelBtn = document.getElementById(cancelId);
    const confirmBtn = document.getElementById(confirmId);

    if (closeBtn) {
      closeBtn.addEventListener('click', () => closeModal(modalId));
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => closeModal(modalId));
    }
    if (confirmBtn) {
      confirmBtn.addEventListener('click', confirmHandler);
    }
  }

  openCreateAccount(walletId) {
    const modal = document.getElementById('createAccountModal');
    if (modal) {
      modal.dataset.walletId = walletId;
    }

    const nameInput = document.getElementById('newAccountName');
    if (nameInput) {
      nameInput.value = `账户 ${getTimestamp()}`;
    }

    openModal('createAccountModal');
  }

  async openDeleteAccount(accountId) {
    try {
      const account = await this.wallet.getAccountById(accountId);
      if (!account) {
        showError('账户不存在');
        return;
      }

      document.getElementById('deleteAccountId').value = account.id;
      document.getElementById('deleteAccountName').textContent = account.name;
      document.getElementById('deleteAccountAddress').textContent = account.address;

      openModal('deleteAccountModal');
    } catch (error) {
      console.error('[AccountModalsController] 打开删除确认模态框失败:', error);
      showError('操作失败');
    }
  }

  async handleCreateAccount() {
    const modal = document.getElementById('createAccountModal');
    const walletId = modal?.dataset?.walletId;
    if (!walletId) {
      showError('未找到钱包');
      return;
    }

    const nameInput = document.getElementById('newAccountName');
    const name = nameInput?.value.trim() || `账户 ${getTimestamp()}`;

    try {
      const result = await this.wallet.createSubAccount(walletId, name);
      const newAccount = result?.account || result;

      closeModal('createAccountModal');
      await this.onWalletListRefresh?.();
      showSuccess(`账户 "${name}" 创建成功`);

      if (newAccount?.id && this.onAccountSelected) {
        await this.onAccountSelected(newAccount.id);
      }
    } catch (error) {
      console.error('[AccountModalsController] 创建账户失败:', error);
      showError('创建失败: ' + error.message);
    }
  }

  async handleDeleteAccount() {
    const accountId = document.getElementById('deleteAccountId').value;

    try {
      closeModal('deleteAccountModal');

      const password = await this.promptPassword({
        title: '删除账户',
        confirmText: '确认删除',
        placeholder: '输入密码',
        onConfirm: async (input) => {
          if (!input || input.length < 8) {
            throw new Error('密码至少需要8位字符');
          }
          await this.wallet.deleteAccount(accountId, input);
        }
      });
      if (!password) return;

      await this.onWalletListRefresh?.();
      showSuccess('账户已删除');

      await this.onWalletUpdated?.();
    } catch (error) {
      console.error('[AccountModalsController] 删除账户失败:', error);
      showError('删除失败: ' + error.message);
    }
  }

  async openPrivateKey(accountId) {
    try {
      const account = await this.wallet.getAccountById(accountId);
      if (!account) {
        showError('账户不存在');
        return;
      }

      let privateKey = null;
      const password = await this.promptPassword({
        title: '查看私钥',
        confirmText: '显示',
        placeholder: '输入密码',
        onConfirm: async (input) => {
          if (!input || input.length < 8) {
            throw new Error('密码至少需要8位字符');
          }
          privateKey = await this.wallet.exportPrivateKey(accountId, input);
        }
      });
      if (!password || !privateKey) return;

      this.openSecretDisplay({
        type: 'privateKey',
        title: `私钥 - ${account.name || '账户'}`,
        label: '私钥',
        warning: '⚠️ 请勿泄露私钥！任何人获得私钥都可以控制您的资产。',
        value: privateKey
      });
    } catch (error) {
      console.error('[AccountModalsController] 获取私钥失败:', error);
      showError('获取私钥失败: ' + error.message);
    }
  }

  async openMnemonic(walletId) {
    try {
      let mnemonic = null;
      const password = await this.promptPassword({
        title: '查看助记词',
        confirmText: '显示',
        placeholder: '输入密码',
        onConfirm: async (input) => {
          if (!input || input.length < 8) {
            throw new Error('密码至少需要8位字符');
          }
          mnemonic = await this.wallet.exportMnemonic(walletId, input);
        }
      });
      if (!password || !mnemonic) return;

      this.openSecretDisplay({
        type: 'mnemonic',
        title: '助记词',
        label: '助记词',
        warning: '⚠️ 请勿泄露助记词！任何人获得助记词都可以恢复你的钱包。',
        value: mnemonic
      });
    } catch (error) {
      console.error('[AccountModalsController] 获取助记词失败:', error);
      showError('获取助记词失败: ' + error.message);
    }
  }

  bindSecretDisplayEvents() {
    const modal = document.getElementById('secretDisplayModal');
    if (!modal) return;

    const overlay = modal.querySelector('.modal-overlay');
    const closeBtn = document.getElementById('closeSecretDisplayModal');
    const confirmBtn = document.getElementById('confirmSecretDisplayBtn');
    const copyBtn = document.getElementById('copySecretDisplayBtn');

    const handleClose = () => closeModal('secretDisplayModal');

    closeBtn?.addEventListener('click', handleClose);
    confirmBtn?.addEventListener('click', handleClose);
    overlay?.addEventListener('click', handleClose);

    copyBtn?.addEventListener('click', async () => {
      const valueEl = document.getElementById('secretDisplayValue');
      const value = valueEl?.value || '';
      if (!value) {
        showError('暂无可复制内容');
        return;
      }
      const type = modal.dataset.secretType;
      const handleToast = this.getCopyToastHandler();
      if (type === 'mnemonic') {
        await copyMnemonicToClipboard(value, showWarning, handleToast);
        return;
      }
      await copyPrivateKeyToClipboard(value, showWarning, handleToast);
    });
  }

  openSecretDisplay({ type, title, label, warning, value }) {
    const modal = document.getElementById('secretDisplayModal');
    if (!modal) return;

    const titleEl = document.getElementById('secretDisplayTitle');
    const warningEl = document.getElementById('secretDisplayWarning');
    const labelEl = document.getElementById('secretDisplayLabel');
    const valueEl = document.getElementById('secretDisplayValue');
    const copyBtn = document.getElementById('copySecretDisplayBtn');

    modal.dataset.secretType = type || '';
    if (titleEl) titleEl.textContent = title || '查看密钥';
    if (warningEl) warningEl.textContent = warning || '';
    if (labelEl) labelEl.textContent = label || '内容';
    if (valueEl) {
      valueEl.value = value || '';
      valueEl.scrollTop = 0;
    }
    if (copyBtn) {
      copyBtn.textContent = type === 'mnemonic' ? '复制助记词' : '复制私钥';
    }

    openModal('secretDisplayModal');
  }

  getCopyToastHandler() {
    return createCopyToastHandler({
      onSuccess: (message) => showSuccess(message),
      onError: (message) => showError(message)
    });
  }

  promptPassword(options = {}) {
    return promptPassword(options);
  }
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
    console.log(`[UI] 打开模态框: ${modalId}`);
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('hidden');
    console.log(`[UI] 关闭模态框: ${modalId}`);
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal').forEach(modal => {
    modal.classList.add('hidden');
  });
}

let activePasswordPrompt = null;

function ensurePasswordPromptModal() {
  let modal = document.getElementById('passwordPromptModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'passwordPromptModal';
  modal.className = 'modal hidden';
  modal.innerHTML = `
    <div class="modal-overlay"></div>
    <div class="modal-content">
      <div class="modal-header">
        <h3 id="passwordPromptTitle">请输入密码</h3>
        <button class="btn-close" id="passwordPromptClose">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="passwordPromptInput">密码</label>
          <input
            type="password"
            id="passwordPromptInput"
            placeholder="输入密码"
          />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="passwordPromptCancel">取消</button>
        <button class="btn btn-primary" id="passwordPromptConfirm">确认</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

function promptPassword(options = {}) {
  if (activePasswordPrompt) {
    return activePasswordPrompt;
  }

  const {
    title = '请输入密码',
    confirmText = '确认',
    cancelText = '取消',
    placeholder = '输入密码',
    onConfirm
  } = options;

  const modal = ensurePasswordPromptModal();
  const overlay = modal.querySelector('.modal-overlay');
  const titleEl = document.getElementById('passwordPromptTitle');
  const input = document.getElementById('passwordPromptInput');
  const confirmBtn = document.getElementById('passwordPromptConfirm');
  const cancelBtn = document.getElementById('passwordPromptCancel');
  const closeBtn = document.getElementById('passwordPromptClose');

  if (titleEl) titleEl.textContent = title;
  if (confirmBtn) confirmBtn.textContent = confirmText;
  if (cancelBtn) cancelBtn.textContent = cancelText;
  if (input) input.placeholder = placeholder;
  confirmBtn?.removeAttribute('disabled');

  modal.classList.remove('hidden');
  setTimeout(() => {
    input?.focus();
  }, 0);

  const cleanup = () => {
    confirmBtn?.removeEventListener('click', handleConfirm);
    cancelBtn?.removeEventListener('click', handleCancel);
    closeBtn?.removeEventListener('click', handleCancel);
    overlay?.removeEventListener('click', handleCancel);
    input?.removeEventListener('keypress', handleKeypress);
    modal.classList.add('hidden');
    activePasswordPrompt = null;
  };

  const handleCancel = () => {
    cleanup();
    resolvePromise(null);
  };

  const handleConfirm = async () => {
    if (!input) return;
    const password = input.value;
    if (!password) {
      showError('请输入密码');
      input.focus();
      return;
    }

    confirmBtn?.setAttribute('disabled', 'disabled');

    try {
      if (onConfirm) {
        await onConfirm(password);
      }
      cleanup();
      resolvePromise(password);
    } catch (error) {
      const message = error?.message || '密码错误';
      showError(message);
      if (input) {
        input.value = '';
        input.focus();
      }
      confirmBtn?.removeAttribute('disabled');
    }
  };

  const handleKeypress = (e) => {
    if (e.key === 'Enter') {
      handleConfirm();
    }
  };

  let resolvePromise = () => { };
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  confirmBtn?.addEventListener('click', handleConfirm);
  cancelBtn?.addEventListener('click', handleCancel);
  closeBtn?.addEventListener('click', handleCancel);
  overlay?.addEventListener('click', handleCancel);
  input?.addEventListener('keypress', handleKeypress);

  activePasswordPrompt = promise;
  return promise;
}
