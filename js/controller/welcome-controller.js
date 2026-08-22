import { showPage, setPageOrigin, showError, showSuccess } from '../common/ui/index.js';
import { clearImportWalletForm } from './wallet/import-wallet-controller.js';

const RECOVERY_APP_ID = '8860ef74-0b27-47f0-bc56-a1d1821d1e1f';
const RECOVERY_NODE_ENDPOINT = 'https://node.yeying.pub';

export class WelcomeController {
  constructor({ wallet } = {}) {
    this.wallet = wallet;
    this.recoveryWalletId = '';
  }

  bindEvents() {
    this.resumeCustodyRecovery().catch((error) => showError(`恢复授权失败：${error.message}`));
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

    document.getElementById('welcomeRecoverWalletBtn')?.addEventListener('click', async () => {
      try {
        await this.startCustodyRecovery();
      } catch (error) {
        showError(`无法发起恢复：${error.message}`);
      }
    });
    document.getElementById('custodyRecoveryBackBtn')?.addEventListener('click', () => showPage('welcomePage'));
    document.getElementById('custodyRecoveryConfirmBtn')?.addEventListener('click', () => {
      this.restoreSelectedCustodyWallet().catch((error) => showError(`恢复失败：${error.message}`));
    });
  }

  async resumeCustodyRecovery() {
    const callback = await this.wallet?.getWalletRecoveryCallback?.();
    if (!callback?.code) return;
    const { walletRecoveryPkce } = await chrome.storage.local.get('walletRecoveryPkce');
    try {
      if (!walletRecoveryPkce || callback.state !== walletRecoveryPkce.state) {
        throw new Error('恢复授权状态不匹配');
      }
      if (Date.now() - Number(walletRecoveryPkce.createdAt || 0) > 10 * 60 * 1000) {
        throw new Error('恢复授权已过期，请重新发起');
      }
      const response = await fetch(`${RECOVERY_NODE_ENDPOINT}/api/v1/public/identity/authorize/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: callback.code,
          appId: RECOVERY_APP_ID,
          redirectUri: walletRecoveryPkce.redirectUri,
          codeVerifier: walletRecoveryPkce.verifier
        })
      });
      const payload = await response.json();
      if (!response.ok || payload.code !== 0) throw new Error(payload.message || '恢复授权兑换失败');
      const recovery = payload.data?.custodyRecovery;
      if (!recovery?.token) throw new Error('Node 未返回恢复凭证');
      await chrome.storage.local.set({
        walletRecoveryAuthorization: {
          token: recovery.token,
          expiresAt: recovery.expiresAt,
          endpoint: RECOVERY_NODE_ENDPOINT,
          receivedAt: Date.now()
        }
      });
      showSuccess('身份验证完成，请继续选择要恢复的钱包');
      await this.loadCustodyRecoveryRecords();
    } finally {
      await Promise.allSettled([
        this.wallet?.clearWalletRecoveryCallback?.(),
        chrome.storage.local.remove('walletRecoveryPkce')
      ]);
    }
  }

  async loadCustodyRecoveryRecords() {
    const { walletRecoveryAuthorization } = await chrome.storage.local.get('walletRecoveryAuthorization');
    if (!walletRecoveryAuthorization?.token) throw new Error('恢复凭证不存在，请重新验证身份');
    const result = await this.wallet.listCustodySecrets({
      endpoint: walletRecoveryAuthorization.endpoint,
      recoveryToken: walletRecoveryAuthorization.token
    });
    if (!result?.success) throw new Error(result?.error || '无法读取托管钱包');
    const records = result.secrets?.records || result.secrets || [];
    const list = document.getElementById('custodyRecoveryList');
    if (!list) return;
    list.replaceChildren();
    records.forEach((record, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary btn-block';
      button.textContent = record.metadata?.walletName || record.walletId || `钱包 ${index + 1}`;
      button.addEventListener('click', () => {
        this.recoveryWalletId = record.walletId;
        list.querySelectorAll('button').forEach((item) => item.classList.remove('btn-primary'));
        button.classList.add('btn-primary');
      });
      list.appendChild(button);
      if (index === 0) button.click();
    });
    if (!records.length) list.textContent = '没有可恢复的托管钱包';
    showPage('custodyRecoveryPage');
  }

  async restoreSelectedCustodyWallet() {
    if (!this.recoveryWalletId) throw new Error('请选择要恢复的钱包');
    const passwordInput = document.getElementById('custodyRecoveryPassword');
    const password = String(passwordInput?.value || '');
    if (password.length < 8) throw new Error('请输入原钱包密码');
    const { walletRecoveryAuthorization } = await chrome.storage.local.get('walletRecoveryAuthorization');
    await this.wallet.restoreCustodySecret(this.recoveryWalletId, password, {
      endpoint: walletRecoveryAuthorization?.endpoint,
      recoveryToken: walletRecoveryAuthorization?.token
    });
    if (passwordInput) passwordInput.value = '';
    await chrome.storage.local.remove('walletRecoveryAuthorization');
    showSuccess('钱包恢复成功');
    showPage('walletPage');
  }

  async startCustodyRecovery() {
    const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
    const verifier = this.base64Url(verifierBytes);
    const challenge = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const state = this.base64Url(crypto.getRandomValues(new Uint8Array(24)));
    const redirectUri = `chrome-extension://${chrome.runtime.id}/html/recovery-callback.html`;
    await chrome.storage.local.set({ walletRecoveryPkce: { verifier, state, redirectUri, createdAt: Date.now() } });
    const response = await fetch(`${RECOVERY_NODE_ENDPOINT}/api/v1/public/identity/authorize/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: RECOVERY_APP_ID,
        redirectUri,
        state,
        codeChallenge: this.base64Url(new Uint8Array(challenge)),
        codeChallengeMethod: 'S256',
        scopes: ['identity.basic', 'custody.recovery']
      })
    });
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) throw new Error(payload.message || '无法发起恢复授权');
    const requestId = payload.data?.requestId;
    if (!requestId) throw new Error('恢复授权请求无效');
    await chrome.tabs.create({ url: `${RECOVERY_NODE_ENDPOINT}/identity/authorize?requestId=${encodeURIComponent(requestId)}` });
  }

  base64Url(bytes) {
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  preparePasswordFormForNewWallet() {
    const hint = document.getElementById('setPasswordHint');
    const passwordLabel = document.getElementById('setPasswordLabel');
    const confirmLabel = document.getElementById('confirmPasswordLabel');
    const confirmGroup = document.getElementById('confirmPasswordGroup');
    const passwordInput = document.getElementById('newPassword');
    const passwordGroup = passwordInput?.closest?.('.form-group');
    const walletTypeGroup = document.getElementById('createWalletTypeGroup');
    const walletTypeSelect = document.getElementById('createWalletTypeSelect');
    const mpcFields = document.getElementById('mpcCreateWalletFields');
    const mpcResult = document.getElementById('mpcCreateWalletResult');

    if (hint) {
      hint.textContent = '请填写钱包名称';
    }
    if (passwordLabel) {
      passwordLabel.textContent = '密码';
    }
    if (confirmLabel) {
      confirmLabel.textContent = '确认密码';
    }
    if (confirmGroup) {
      confirmGroup.classList.add('hidden');
    }
    if (passwordInput) {
      passwordInput.value = '';
      passwordInput.placeholder = '至少8位字符';
    }
    if (passwordGroup) {
      passwordGroup.classList.add('hidden');
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
    clearImportWalletForm();
  }

  resetCreateWalletForm() {
    const nameInput = document.getElementById('setWalletName');
    const passwordInput = document.getElementById('newPassword');
    const confirmInput = document.getElementById('confirmPassword');
    const walletTypeSelect = document.getElementById('createWalletTypeSelect');
    const mpcFields = document.getElementById('mpcCreateWalletFields');
    const mpcResult = document.getElementById('mpcCreateWalletResult');

    if (nameInput) nameInput.value = `hd-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
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
