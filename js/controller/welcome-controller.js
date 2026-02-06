import { showPage, setPageOrigin } from '../common/ui/index.js';

export class WelcomeController {
  constructor() {}

  bindEvents() {
    const createBtn = document.getElementById('welcomeCreateWalletBtn');
    if (createBtn) {
      createBtn.addEventListener('click', () => {
        setPageOrigin('setPasswordPage', 'welcome');
        showPage('setPasswordPage');
        const setPasswordBtn = document.getElementById('setPasswordBtn');
        if (setPasswordBtn) {
          setPasswordBtn.textContent = '创建钱包';
        }
        this.preparePasswordFormForNewWallet();
        this.resetCreateWalletForm();
      });
    }

    const importBtn = document.getElementById('welcomeImportWalletBtn');
    if (importBtn) {
      importBtn.addEventListener('click', () => {
        setPageOrigin('importPage', 'welcome');
        showPage('importPage');
        this.prepareImportFormForNewWallet();
      });
    }
  }

  preparePasswordFormForNewWallet() {
    const hint = document.getElementById('setPasswordHint');
    const passwordLabel = document.getElementById('setPasswordLabel');
    const confirmLabel = document.getElementById('confirmPasswordLabel');
    const confirmGroup = document.getElementById('confirmPasswordGroup');
    const passwordInput = document.getElementById('newPassword');
    const walletTypeGroup = document.getElementById('createWalletTypeGroup');
    const walletTypeSelect = document.getElementById('createWalletTypeSelect');
    const mpcFields = document.getElementById('mpcCreateWalletFields');
    const mpcResult = document.getElementById('mpcCreateWalletResult');

    if (hint) {
      hint.textContent = '请设置一个密码来保护您的钱包';
    }
    if (passwordLabel) {
      passwordLabel.textContent = '密码';
    }
    if (confirmLabel) {
      confirmLabel.textContent = '确认密码';
    }
    if (confirmGroup) {
      confirmGroup.classList.remove('hidden');
    }
    if (passwordInput) {
      passwordInput.placeholder = '至少8位字符';
    }
    if (walletTypeGroup) {
      walletTypeGroup.classList.add('hidden');
    }
    if (walletTypeSelect) {
      walletTypeSelect.value = 'hd';
    }
    if (mpcFields) {
      mpcFields.classList.add('hidden');
    }
    if (mpcResult) {
      mpcResult.textContent = '-';
      mpcResult.classList.add('hidden');
    }
  }

  prepareImportFormForNewWallet() {
    const passwordLabel = document.getElementById('importPasswordLabel');
    const passwordInput = document.getElementById('importWalletPassword');

    if (passwordLabel) {
      passwordLabel.textContent = '密码';
    }
    if (passwordInput) {
      passwordInput.placeholder = '至少8位字符';
    }
  }

  resetCreateWalletForm() {
    const nameInput = document.getElementById('setWalletName');
    const passwordInput = document.getElementById('newPassword');
    const confirmInput = document.getElementById('confirmPassword');
    const walletTypeSelect = document.getElementById('createWalletTypeSelect');
    const mpcFields = document.getElementById('mpcCreateWalletFields');
    const mpcResult = document.getElementById('mpcCreateWalletResult');

    if (nameInput) nameInput.value = '主钱包';
    if (passwordInput) passwordInput.value = '';
    if (confirmInput) confirmInput.value = '';
    if (walletTypeSelect) walletTypeSelect.value = 'hd';
    if (mpcFields) mpcFields.classList.add('hidden');
    if (mpcResult) {
      mpcResult.textContent = '-';
      mpcResult.classList.add('hidden');
    }
  }
}
