import { showPage, setPageOrigin, showError, showSuccess } from '../common/ui/index.js';
import { clearImportWalletForm } from './wallet/import-wallet-controller.js';
import {
  DEFAULT_IDENTITY_NODE_ENDPOINT,
  IDENTITY_NODE_ENDPOINT_STORAGE_KEY,
  normalizeIdentityNodeEndpoint
} from '../config/identity-config.js';

const RECOVERY_APP_ID = '8860ef74-0b27-47f0-bc56-a1d1821d1e1f';

export class WelcomeController {
  constructor({ wallet, onRecoverySuccess } = {}) {
    this.wallet = wallet;
    this.onRecoverySuccess = typeof onRecoverySuccess === 'function' ? onRecoverySuccess : null;
    this.recoveryWalletId = '';
  }

  identityNodeEndpoint() {
    let stored = '';
    try {
      stored = globalThis.localStorage?.getItem(IDENTITY_NODE_ENDPOINT_STORAGE_KEY) || '';
    } catch {
      stored = '';
    }
    return normalizeIdentityNodeEndpoint(stored) || DEFAULT_IDENTITY_NODE_ENDPOINT;
  }

  persistIdentityNodeEndpoint(endpoint) {
    const normalized = normalizeIdentityNodeEndpoint(endpoint);
    if (!normalized) return '';
    try {
      globalThis.localStorage?.setItem(IDENTITY_NODE_ENDPOINT_STORAGE_KEY, normalized);
    } catch {
      // localStorage may be unavailable in a restricted extension context.
    }
    return normalized;
  }

  promptRecoveryEndpoint() {
    const modal = document.getElementById('custodyRecoveryEndpointModal');
    const input = document.getElementById('custodyRecoveryEndpointInput');
    const confirm = document.getElementById('confirmCustodyRecoveryEndpointBtn');
    const cancel = document.getElementById('cancelCustodyRecoveryEndpointBtn');
    const close = document.getElementById('closeCustodyRecoveryEndpointModal');
    const overlay = modal?.querySelector('.modal-overlay');
    if (!modal || !input || !confirm || !cancel || !close) {
      return Promise.resolve(this.identityNodeEndpoint());
    }

    input.value = this.identityNodeEndpoint();
    modal.classList.remove('hidden');
    return new Promise((resolve) => {
      const cleanup = () => {
        confirm.removeEventListener('click', handleConfirm);
        cancel.removeEventListener('click', handleCancel);
        close.removeEventListener('click', handleCancel);
        overlay?.removeEventListener('click', handleCancel);
        input.removeEventListener('keydown', handleKeydown);
        modal.classList.add('hidden');
      };
      const handleCancel = () => {
        cleanup();
        resolve(null);
      };
      const handleConfirm = () => {
        const endpoint = normalizeIdentityNodeEndpoint(input.value);
        if (!endpoint) {
          showError('身份服务地址必须是有效的 HTTP 或 HTTPS 地址');
          input.focus();
          return;
        }
        cleanup();
        resolve(endpoint);
      };
      const handleKeydown = (event) => {
        if (event.key === 'Enter') handleConfirm();
        if (event.key === 'Escape') handleCancel();
      };
      confirm.addEventListener('click', handleConfirm);
      cancel.addEventListener('click', handleCancel);
      close.addEventListener('click', handleCancel);
      overlay?.addEventListener('click', handleCancel);
      input.addEventListener('keydown', handleKeydown);
      setTimeout(() => input.focus(), 0);
    });
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
        const endpoint = await this.promptRecoveryEndpoint();
        if (!endpoint) return;
        await this.startCustodyRecovery(endpoint);
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
    if (!callback?.code) {
      const { walletRecoveryAuthorization } = await chrome.storage.local.get('walletRecoveryAuthorization');
      if (!walletRecoveryAuthorization?.token) return;
      const expiresAt = Number(walletRecoveryAuthorization.expiresAt || 0);
      const expiresAtMs = expiresAt > 1e12 ? expiresAt : expiresAt * 1000;
      if (expiresAtMs > 0 && expiresAtMs <= Date.now()) {
        await chrome.storage.local.remove('walletRecoveryAuthorization');
        throw new Error('恢复授权已过期，请重新发起');
      }
      // The popup can close after the callback page returns. Keep a valid
      // recovery token resumable so reopening the popup continues at the
      // wallet-selection page instead of requiring a second passkey login.
      await this.loadCustodyRecoveryRecords();
      return;
    }
    const { walletRecoveryPkce } = await chrome.storage.local.get('walletRecoveryPkce');
    try {
      if (!walletRecoveryPkce || callback.state !== walletRecoveryPkce.state) {
        throw new Error('恢复授权状态不匹配');
      }
      if (Date.now() - Number(walletRecoveryPkce.createdAt || 0) > 10 * 60 * 1000) {
        throw new Error('恢复授权已过期，请重新发起');
      }
      const endpoint = normalizeIdentityNodeEndpoint(walletRecoveryPkce.endpoint) || this.identityNodeEndpoint();
      const response = await fetch(`${endpoint}/api/v1/public/identity/authorize/exchange`, {
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
          endpoint,
          identityDid: String(payload.data?.did || '').trim(),
          receivedAt: Date.now()
        }
      });
      showSuccess('身份验证完成，请确认要恢复的钱包身份');
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
    const records = result.secrets?.records;
    if (!Array.isArray(records)) throw new Error('托管服务返回的钱包记录格式无效');
    const responseIdentityDid = String(result.secrets?.identityDid || '').trim();
    const authorizedIdentityDid = String(walletRecoveryAuthorization.identityDid || '').trim();
    if (responseIdentityDid && authorizedIdentityDid && responseIdentityDid !== authorizedIdentityDid) {
      throw new Error('恢复授权的钱包身份不匹配');
    }
    const identityDid = responseIdentityDid || authorizedIdentityDid;
    if (!/^did:yeying:wid_[A-Za-z0-9_-]+$/.test(identityDid)) {
      throw new Error('托管服务未返回有效的钱包身份 DID');
    }
    const list = document.getElementById('custodyRecoveryList');
    const count = document.getElementById('custodyRecoveryCount');
    if (!list) return;
    list.replaceChildren();
    this.recoveryWalletId = '';
    if (count) count.textContent = `共 ${records.length} 个云端托管钱包`;
    records.forEach((record, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary btn-block custody-recovery-option';
      const walletName = String(record?.metadata?.walletName || '').trim() || `钱包 ${index + 1}`;
      const accountCount = Number(record?.metadata?.accountCount || 0);
      const name = document.createElement('span');
      name.className = 'custody-recovery-wallet-name';
      name.textContent = walletName;
      const detail = document.createElement('span');
      detail.className = 'custody-recovery-wallet-detail';
      detail.textContent = accountCount > 0 ? `${accountCount} 个账户` : '账户数量未知';
      const did = document.createElement('span');
      did.className = 'custody-recovery-identity-did';
      did.textContent = identityDid;
      button.append(name, detail, did);
      button.addEventListener('click', () => {
        this.recoveryWalletId = record.walletId;
        list.querySelectorAll('button').forEach((item) => {
          item.classList.remove('btn-primary');
          item.classList.add('btn-secondary');
        });
        button.classList.remove('btn-secondary');
        button.classList.add('btn-primary');
      });
      list.appendChild(button);
      if (index === 0) button.click();
    });
    if (!records.length) list.textContent = '没有可执行云端密钥恢复的钱包身份';
    showPage('custodyRecoveryPage');
  }

  async restoreSelectedCustodyWallet() {
    if (!this.recoveryWalletId) throw new Error('请选择要恢复的钱包身份');
    const passwordInput = document.getElementById('custodyRecoveryPassword');
    const password = String(passwordInput?.value || '');
    if (password.length < 8) throw new Error('请输入托管钱包密码');
    const { walletRecoveryAuthorization } = await chrome.storage.local.get('walletRecoveryAuthorization');
    const result = await this.wallet.restoreCustodySecret(this.recoveryWalletId, password, {
      endpoint: walletRecoveryAuthorization?.endpoint,
      recoveryToken: walletRecoveryAuthorization?.token
    });
    if (passwordInput) passwordInput.value = '';
    await chrome.storage.local.remove('walletRecoveryAuthorization');
    showPage('walletPage');
    await this.onRecoverySuccess?.(result);
    showSuccess('钱包恢复成功');
  }

  async startCustodyRecovery(endpoint = '') {
    const recoveryEndpoint = this.persistIdentityNodeEndpoint(endpoint) || this.identityNodeEndpoint();
    const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
    const verifier = this.base64Url(verifierBytes);
    const challenge = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const state = this.base64Url(crypto.getRandomValues(new Uint8Array(24)));
    const redirectUri = `chrome-extension://${chrome.runtime.id}/html/recovery-callback.html`;
    await chrome.storage.local.set({ walletRecoveryPkce: { verifier, state, redirectUri, endpoint: recoveryEndpoint, createdAt: Date.now() } });
    const response = await fetch(`${recoveryEndpoint}/api/v1/public/identity/authorize/request`, {
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
    if (!response.ok || payload.code !== 0) {
      const message = String(payload.message || '无法发起恢复授权');
      if (message === 'IDENTITY_REDIRECT_URI_UNAUTHORIZED') {
        throw new Error(`身份服务未登记当前插件回调地址：${redirectUri}`);
      }
      throw new Error(message);
    }
    const requestId = payload.data?.requestId;
    if (!requestId) throw new Error('恢复授权请求无效');
    await chrome.tabs.create({ url: `${recoveryEndpoint}/identity/authorize?requestId=${encodeURIComponent(requestId)}` });
  }

  base64Url(bytes) {
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  preparePasswordFormForNewWallet() {
    const hint = document.getElementById('setPasswordHint');
    const walletTypeGroup = document.getElementById('createWalletTypeGroup');
    const walletTypeSelect = document.getElementById('createWalletTypeSelect');
    const mpcFields = document.getElementById('mpcCreateWalletFields');
    const mpcResult = document.getElementById('mpcCreateWalletResult');

    if (hint) {
      hint.textContent = '请填写钱包名称';
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
    const walletTypeSelect = document.getElementById('createWalletTypeSelect');
    const mpcFields = document.getElementById('mpcCreateWalletFields');
    const mpcResult = document.getElementById('mpcCreateWalletResult');

    if (nameInput) nameInput.value = `hd-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    if (walletTypeSelect) walletTypeSelect.value = 'hd';
    if (mpcFields) mpcFields.classList.add('hidden');
    if (mpcResult) {
      mpcResult.textContent = '-';
      mpcResult.classList.add('hidden');
    }
  }
}
