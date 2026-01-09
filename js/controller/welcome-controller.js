import { showPage, setPageOrigin } from './ui.js';

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
        this.resetCreateWalletForm();
      });
    }

    const importBtn = document.getElementById('welcomeImportWalletBtn');
    if (importBtn) {
      importBtn.addEventListener('click', () => {
        setPageOrigin('importPage', 'welcome');
        showPage('importPage');
      });
    }
  }

  resetCreateWalletForm() {
    const nameInput = document.getElementById('setWalletName');
    const passwordInput = document.getElementById('newPassword');
    const confirmInput = document.getElementById('confirmPassword');
    const statusEl = document.getElementById('passwordStatus');

    if (nameInput) nameInput.value = '主钱包';
    if (passwordInput) passwordInput.value = '';
    if (confirmInput) confirmInput.value = '';
    if (statusEl) {
      statusEl.style.display = 'none';
      statusEl.className = 'status';
    }
  }
}
