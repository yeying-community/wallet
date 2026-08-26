import { showPage, showError, showSuccess, showWaiting, hideWaiting, generateQRCode, copyToClipboard } from '../../common/ui/index.js';

const DEFAULT_NODE_ENDPOINT = 'https://node.yeying.pub';
const ENDPOINT_STORAGE_KEY = 'walletIdentityNodeEndpoint';
const VERIFICATION_STORAGE_PREFIX = 'walletIdentityVerification:';
const EMAIL_VERIFICATION_STORAGE_PREFIX = 'walletIdentityEmailVerification:';
const VERIFICATION_STATE_PENDING_EMAIL = 'pending-email';
const VERIFICATION_STATE_COMPLETE = 'complete';
const USERNAME_NAMESPACE_SUFFIX = '@node.yeying.pub';

function defaultAvatarUri(seed) {
  const value = String(seed || 'wallet-identity').trim() || 'wallet-identity';
  return `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(value)}`;
}

function base64UrlToArrayBuffer(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${normalized}${'='.repeat((4 - normalized.length % 4) % 4)}`;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function arrayBufferToBase64Url(value) {
  if (!value) return '';
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export class WalletIdentitySettingsController {
  constructor({ wallet, transaction, requestPassword }) {
    this.wallet = wallet;
    this.transaction = transaction;
    this.requestPassword = requestPassword;
  }

  bindEvents() {
    document.getElementById('walletIdentityVerifyBtn')?.addEventListener('click', () => this.handleIdentityAction());
    document.getElementById('viewWalletIdentityBtn')?.addEventListener('click', () => this.openIdentityDetails());
    document.getElementById('closeWalletIdentityDetailModal')?.addEventListener('click', () => this.closeIdentityDetails());
    document.getElementById('walletIdentityDetailBackBtn')?.addEventListener('click', () => showPage('settingsPage'));
    document.getElementById('walletIdentityPasskeyBackBtn')?.addEventListener('click', () => showPage('walletIdentityDetailPage'));
    document.getElementById('walletIdentityAuthenticatorBackBtn')?.addEventListener('click', () => showPage('walletIdentityDetailPage'));
    document.getElementById('changeWalletIdentityPageBtn')?.addEventListener('click', () => this.changeWalletIdentity());
    document.getElementById('manageWalletIdentityPasskeysBtn')?.addEventListener('click', () => this.openIdentityPasskeys());
    document.getElementById('manageWalletIdentityAuthenticatorsBtn')?.addEventListener('click', () => this.openIdentityAuthenticators());
    this.bindCopyableDetailValue('walletIdentityDetailAddressPage', '钱包地址');
    this.bindCopyableDetailValue('walletIdentityDetailDidPage', '身份 DID');
    this.bindCopyableDetailValue('walletIdentityDetailAvatarPage', '头像 URI');
    document.getElementById('registerWalletIdentityPasskeyBtn')?.addEventListener('click', () => this.registerIdentityPasskey());
    document.getElementById('refreshWalletIdentityPasskeysBtn')?.addEventListener('click', () => this.refreshIdentityPasskeys());
    document.getElementById('refreshWalletIdentityTotpBtn')?.addEventListener('click', () => this.refreshIdentityTotp());
    document.getElementById('setupWalletIdentityTotpBtn')?.addEventListener('click', () => this.setupIdentityTotp());
    document.getElementById('confirmWalletIdentityTotpBtn')?.addEventListener('click', () => this.confirmIdentityTotp());
    document.getElementById('revokeWalletIdentityTotpBtn')?.addEventListener('click', () => this.revokeIdentityTotp());
    document.getElementById('walletIdentityPasskeyListPage')?.addEventListener('click', (event) => {
      const button = event.target?.closest?.('[data-passkey-revoke]');
      if (button) this.revokeIdentityPasskey(button.dataset.passkeyRevoke);
    });
    document.getElementById('clearWalletIdentityVerificationBtn')?.addEventListener('click', () => this.openClearVerificationConfirm());
    document.getElementById('closeWalletIdentityClearVerificationModal')?.addEventListener('click', () => this.closeClearVerificationConfirm());
    document.getElementById('cancelWalletIdentityClearVerificationBtn')?.addEventListener('click', () => this.closeClearVerificationConfirm());
    document.querySelector('#walletIdentityClearVerificationModal .modal-overlay')?.addEventListener('click', () => this.closeClearVerificationConfirm());
    document.getElementById('confirmWalletIdentityClearVerificationBtn')?.addEventListener('click', async () => { this.closeClearVerificationConfirm(); await this.clearIdentityVerification(); });
    document.getElementById('cancelWalletIdentityEditBtn')?.addEventListener('click', () => this.closeIdentityEdit());
    document.getElementById('confirmWalletIdentityEditBtn')?.addEventListener('click', async () => {
      try {
        await this.submitIdentityEdit();
      } catch (error) {
        showError(error?.message || '验证资料提交失败');
      } finally {
        hideWaiting();
      }
    });
    document.getElementById('changeWalletIdentityBtn')?.addEventListener('click', () => {
      this.selectedIdentityAddress = document.getElementById('walletIdentityAddressSelect')?.value || '';
      this.closeIdentityDetails();
      this.changeWalletIdentity();
    });
    document.querySelector('#walletIdentityDetailModal .modal-overlay')?.addEventListener('click', () => this.closeIdentityDetails());
  }

  endpoint() {
    return String(
      document.getElementById('walletIdentityEndpointInput')?.value || this.loadStoredEndpoint() || DEFAULT_NODE_ENDPOINT
    ).trim();
  }

  loadStoredEndpoint() {
    try { return String(globalThis.localStorage?.getItem(ENDPOINT_STORAGE_KEY) || '').trim(); } catch { return ''; }
  }

  persistEndpoint(endpoint) {
    try { globalThis.localStorage?.setItem(ENDPOINT_STORAGE_KEY, endpoint); } catch { /* storage may be unavailable */ }
  }

  verificationStorageKey(endpoint, address) {
    return `${VERIFICATION_STORAGE_PREFIX}${endpoint}:${String(address || '').toLowerCase()}`;
  }

  loadVerificationState(endpoint, address) {
    try {
      const raw = String(globalThis.localStorage?.getItem(this.verificationStorageKey(endpoint, address)) || '').trim();
      if (raw === '1' || raw === VERIFICATION_STATE_COMPLETE) return VERIFICATION_STATE_COMPLETE;
      if (raw === VERIFICATION_STATE_PENDING_EMAIL) return VERIFICATION_STATE_PENDING_EMAIL;
      return '';
    } catch { return ''; }
  }

  persistVerificationState(endpoint, address, state) {
    try {
      const key = this.verificationStorageKey(endpoint, address);
      if (state) globalThis.localStorage?.setItem(key, state === true ? VERIFICATION_STATE_COMPLETE : String(state));
      else globalThis.localStorage?.removeItem(key);
    } catch { /* storage may be unavailable */ }
  }

  emailVerificationStorageKey(endpoint, address) {
    return `${EMAIL_VERIFICATION_STORAGE_PREFIX}${endpoint}:${String(address || '').toLowerCase()}`;
  }

  persistEmailVerificationState(endpoint, address, state) {
    try {
      const key = this.emailVerificationStorageKey(endpoint, address);
      if (state) globalThis.localStorage?.setItem(key, JSON.stringify(state));
      else globalThis.localStorage?.removeItem(key);
    } catch { /* storage may be unavailable */ }
  }

  loadEmailVerificationState(endpoint, address) {
    try {
      const raw = globalThis.localStorage?.getItem(this.emailVerificationStorageKey(endpoint, address));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async renderIdentityVerificationAction() {
    const button = document.getElementById('walletIdentityVerifyBtn');
    if (!button) return;
    let state = '';
    let account = null;
    try {
      account = await this.wallet.getCurrentAccount();
      await this.renderAddressPicker(account);
      state = this.loadVerificationState(this.endpoint(), account?.address);
      const identities = await this.wallet.listIdentities();
      const identityId = identities?.selectedIdentityId || identities?.identities?.[0]?.document?.walletIdentityId;
      if (!identityId) {
        state = '';
        this.persistVerificationState(this.endpoint(), account?.address, null);
      } else if (state === VERIFICATION_STATE_COMPLETE) {
        const credentials = await this.wallet.listIdentityCredentials(identityId);
        if (!Array.isArray(credentials?.credentials) || credentials.credentials.length === 0) {
          state = '';
          this.persistVerificationState(this.endpoint(), account?.address, null);
        }
      }
    } catch { state = ''; }
    const pending = state === VERIFICATION_STATE_PENDING_EMAIL;
    const complete = state === VERIFICATION_STATE_COMPLETE;
    const statusIcon = document.getElementById('walletIdentityStatusIcon');
    const detailsButton = document.getElementById('viewWalletIdentityBtn');
    button.dataset.state = state || 'none';
    button.textContent = pending ? '继续验证' : '验证';
    button.classList.toggle('hidden', complete);
    button.classList.toggle('btn-primary', true);
    button.classList.toggle('btn-danger', false);
    detailsButton?.classList.toggle('hidden', !complete);
    if (complete) {
      this.setIdentityStatusIcon(statusIcon, 'verified', '已验证');
      this.setStatus('');
    } else if (pending) {
      this.setIdentityStatusIcon(statusIcon, 'pending', '验证进行中');
      this.setStatus(`钱包控制权已确认，但邮箱尚未验证。请继续验证，钱包：${this.formatWalletAddress(account?.address)}`);
    } else {
      this.setIdentityStatusIcon(statusIcon, 'pending', '待验证');
      this.setStatus('');
    }
  }

  async renderAddressPicker(currentAccount) {
    const selector = document.getElementById('walletIdentityAddressSelect');
    if (!selector) return;
    const wallets = await this.wallet.getWalletList();
    const accounts = wallets.flatMap(wallet => Array.isArray(wallet.accounts) ? wallet.accounts : []).filter(item => item?.address);
    const options = accounts.length ? accounts : (currentAccount ? [currentAccount] : []);
    selector.replaceChildren();
    options.forEach(item => {
      const option = document.createElement('option');
      option.value = item.address;
      option.textContent = `${item.name || '钱包账户'} · ${this.formatWalletAddress(item.address)}`;
      option.selected = String(item.address).toLowerCase() === String(currentAccount?.address || '').toLowerCase();
      selector.appendChild(option);
    });
  }

  setIdentityStatusIcon(element, state, label) {
    if (!element) return;
    element.className = `wallet-identity-status ${state}`;
    element.setAttribute('aria-label', label);
    element.setAttribute('title', label);
  }

  async openIdentityDetails() {
    try {
      const [account, identities] = await Promise.all([this.wallet.getCurrentAccount(), this.wallet.listIdentities()]);
      const identityId = identities?.selectedIdentityId || identities?.identities?.[0]?.document?.walletIdentityId;
      if (!identityId) throw new Error('请先创建钱包身份');
      if (!identities?.selectedIdentityId) await this.wallet.selectIdentity(identityId);
      const identity = await this.wallet.getIdentity(identityId);
      const credentials = await this.wallet.listIdentityCredentials(identityId);
      const values = { username: '-', email: '-', avatarUri: '' };
      for (const item of credentials?.credentials || []) {
        const token = item?.credential || item?.jwt || item;
        const payload = this.decodeCredentialPayload(token);
        const subject = payload?.vc?.credentialSubject || {};
        if (subject.usernameQualified || subject.username) values.username = this.displayUsername(subject.username || subject.usernameQualified);
        if (subject.email) values.email = subject.email;
        if (subject.avatar || subject.avatarUri) values.avatarUri = subject.avatar || subject.avatarUri;
      }
      this.setDetailValue('walletIdentityDetailStatusPage', '已验证');
      this.setDetailValue('walletIdentityDetailUsernamePage', values.username);
      this.setDetailValue('walletIdentityDetailEmailPage', values.email);
      this.setDetailAvatar(values.avatarUri || defaultAvatarUri(identityId || account?.address));
      this.setCopyableDetailValue('walletIdentityDetailAddressPage', account?.address || '-', this.formatCompactIdentityValue(account?.address, 12, 8));
      this.setCopyableDetailValue('walletIdentityDetailDidPage', identity?.document?.id || '-', this.formatCompactIdentityValue(identity?.document?.id, 18, 10));
      this.setDetailValue('walletIdentityDetailEndpointPage', this.endpoint() || DEFAULT_NODE_ENDPOINT);
      showPage('walletIdentityDetailPage');
      await Promise.all([
        this.refreshIdentityPasskeySummary({ quiet: true }),
        this.refreshIdentityTotpSummary({ quiet: true })
      ]);
    } catch (error) {
      showError(error?.message || '无法读取钱包身份详情');
    }
  }

  closeIdentityDetails() {
    document.getElementById('walletIdentityDetailModal')?.classList.add('hidden');
  }

  closeIdentityEdit() { showPage('walletIdentityDetailPage'); }
  openClearVerificationConfirm() { document.getElementById('walletIdentityClearVerificationModal')?.classList.remove('hidden'); }
  closeClearVerificationConfirm() { document.getElementById('walletIdentityClearVerificationModal')?.classList.add('hidden'); }

  async openIdentityEdit() {
    const current = await this.wallet.getCurrentAccount();
    const selector = document.getElementById('walletIdentityEditAddress');
    const options = [];
    const seen = new Set();
    const addOption = (item) => {
      const address = String(item?.address || '').trim();
      const key = address.toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      options.push({ ...item, address });
    };
    // Populate the current account before any optional wallet-list RPC. This
    // keeps the editor usable when an imported wallet is still being restored.
    addOption(current);
    if (selector) {
      this.renderIdentityAddressOptions(selector, options, current);
    }
    try {
      const walletResult = typeof this.wallet.getWalletList === 'function'
        ? await this.wallet.getWalletList()
        : [];
      const wallets = Array.isArray(walletResult) ? walletResult : walletResult?.wallets;
      const accounts = (Array.isArray(wallets) ? wallets : [])
        .flatMap(wallet => Array.isArray(wallet?.accounts) ? wallet.accounts : [])
        .filter(item => item?.address);
      accounts.forEach(addOption);
    } catch (error) {
      console.warn('[WalletIdentitySettings] 加载钱包地址列表失败，将继续使用当前地址:', error?.message || error);
    }
    if (selector) {
      this.renderIdentityAddressOptions(selector, options, current);
    }
    let username = '', email = '', avatarUri = '';
    const identities = typeof this.wallet.listIdentities === 'function'
      ? await this.wallet.listIdentities()
      : null;
    const identityId = identities?.selectedIdentityId || identities?.identities?.[0]?.document?.walletIdentityId;
    const credentialResult = identityId && typeof this.wallet.listIdentityCredentials === 'function'
      ? await this.wallet.listIdentityCredentials(identityId)
      : null;
    for (const item of credentialResult?.credentials || []) {
      const subject = this.decodeCredentialPayload(item?.credential || item)?.vc?.credentialSubject || {};
      username = this.displayUsername(subject.username || subject.usernameQualified) || username;
      email = subject.email || email;
      avatarUri = subject.avatar || subject.avatarUri || avatarUri;
    }
    if (!avatarUri) avatarUri = defaultAvatarUri(identityId || current?.address);
    const endpointInput = document.getElementById('walletIdentityEditEndpoint');
    const usernameInput = document.getElementById('walletIdentityEditUsername');
    const emailInput = document.getElementById('walletIdentityEditEmail');
    if (!document.getElementById('walletIdentityEditPage')) {
      const profile = await this.promptIdentityProfile({ username, email, avatarUri, endpoint: this.endpoint() });
      if (!profile) return;
      ({ username, email, avatarUri } = profile);
      await this.requestAndConfirmIdentity({ username, email, avatarUri });
      return;
    }
    if (endpointInput) endpointInput.value = this.endpoint();
    if (usernameInput) usernameInput.value = username;
    if (emailInput) emailInput.value = email;
    const avatarInput = document.getElementById('walletIdentityEditAvatar');
    if (avatarInput) avatarInput.value = avatarUri;
    showPage('walletIdentityEditPage');
  }

  renderIdentityAddressOptions(selector, options, current) {
    selector.replaceChildren(...options.map(item => {
      const option = document.createElement('option');
      option.value = item.address;
      option.textContent = `${item.name || '钱包账户'} · ${this.formatWalletAddress(item.address)}`;
      option.selected = item.address.toLowerCase() === String(current?.address || '').toLowerCase();
      return option;
    }));
    if (!selector.options.length) selector.innerHTML = '<option value="">暂无可用钱包地址</option>';
    // PopupController mirrors native selects into a custom trigger/menu.
    // Refresh that mirror after replacing options dynamically.
    selector._customSelectSync?.();
  }

  async submitIdentityEdit() {
    const endpoint = String(document.getElementById('walletIdentityEditEndpoint')?.value || '').trim();
    const username = String(document.getElementById('walletIdentityEditUsername')?.value || '').trim().toLowerCase();
    const email = String(document.getElementById('walletIdentityEditEmail')?.value || '').trim().toLowerCase();
    const avatarUri = String(document.getElementById('walletIdentityEditAvatar')?.value || '').trim();
    if (!endpoint) throw new Error('请输入身份服务地址');
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new Error('用户名须为 3-32 位小写字母、数字、点、下划线或连字符');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('请输入有效邮箱');
    if (!avatarUri) throw new Error('请输入头像 URI');
    const avatarUrl = new URL(avatarUri);
    if (!['https:', 'http:', 'ipfs:'].includes(avatarUrl.protocol)) throw new Error('头像 URI 仅支持 HTTP、HTTPS 或 IPFS');
    this.selectedIdentityAddress = document.getElementById('walletIdentityEditAddress')?.value || '';
    this.closeIdentityEdit();
    this.persistEndpoint(endpoint);
    const completed = await this.requestAndConfirmIdentity({ username, email, avatarUri });
    await this.renderIdentityVerificationAction();
    if (completed) await this.openIdentityDetails();
  }

  setDetailValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value || '-';
  }

  setCopyableDetailValue(id, value, displayValue = '') {
    const element = document.getElementById(id);
    if (!element) return;
    const fullValue = String(value || '').trim();
    const hasValue = !!fullValue && fullValue !== '-';
    element.textContent = hasValue ? (displayValue || fullValue) : '-';
    element.title = hasValue ? fullValue : '';
    element.dataset.copyValue = hasValue ? fullValue : '';
    element.classList.toggle('copyable-detail-value', hasValue);
    if (hasValue) {
      element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
      element.setAttribute('aria-label', `复制${element.dataset.copyLabel || '内容'}`);
    } else {
      element.setAttribute('tabindex', '-1');
      element.setAttribute('aria-label', '');
    }
  }

  bindCopyableDetailValue(id, label) {
    const element = document.getElementById(id);
    if (!element) return;
    element.dataset.copyLabel = label;
    element.addEventListener('click', () => this.copyDetailValue(id, label));
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.copyDetailValue(id, label);
    });
  }

  async copyDetailValue(id, label = '内容') {
    const element = document.getElementById(id);
    const value = String(element?.dataset?.copyValue || '').trim();
    if (!value) return false;
    const copied = await copyToClipboard(value);
    if (copied) showSuccess(`已复制${label}`);
    else showError('复制失败');
    return copied;
  }

  setDetailAvatar(value) {
    const uri = String(value || '').trim();
    const image = document.getElementById('walletIdentityDetailAvatarImagePage');
    const container = document.getElementById('walletIdentityDetailAvatarPage');
    if (!image || !container) return;
    if (!uri) {
      image.removeAttribute('src');
      image.classList.add('hidden');
      container.title = '';
      container.dataset.copyValue = '';
      container.classList.remove('copyable-detail-value');
      return;
    }
    image.src = uri;
    image.title = uri;
    container.title = uri;
    container.dataset.copyValue = uri;
    container.classList.add('copyable-detail-value');
    container.setAttribute('role', 'button');
    container.setAttribute('tabindex', '0');
    container.setAttribute('aria-label', '复制头像 URI');
    image.classList.remove('hidden');
  }

  decodeCredentialPayload(token) {
    try {
      const encoded = String(token || '').split('.')[1];
      if (!encoded) return null;
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(`${base64}${'='.repeat((4 - base64.length % 4) % 4)}`));
    } catch { return null; }
  }

  async handleIdentityAction() {
    this.selectedIdentityAddress = document.getElementById('walletIdentityAddressSelect')?.value || '';
    const state = document.getElementById('walletIdentityVerifyBtn')?.dataset.state || 'none';
    if (state === VERIFICATION_STATE_COMPLETE) return this.changeWalletIdentity();
    if (state === VERIFICATION_STATE_PENDING_EMAIL) return this.continueEmailVerification();
    return this.startIdentityVerification();
  }

  setStatus(text) {
    const element = document.getElementById('walletIdentityStatusText');
    if (element) element.textContent = text;
  }

  setEmailStatus(text) {
    const element = document.getElementById('walletIdentityEmailStatusText');
    if (element) element.textContent = text;
  }

  async load() {
    const input = document.getElementById('walletIdentityEndpointInput');
    if (input && !input.value) input.value = this.loadStoredEndpoint() || DEFAULT_NODE_ENDPOINT;
    await this.renderIdentityVerificationAction();
  }

  async checkStatus(quiet = false) {
    try {
      const endpoint = this.endpoint();
      if (!endpoint) throw new Error('请输入 Node 服务地址');
      this.persistEndpoint(endpoint);
      this.setStatus('身份服务地址已保存');
      if (!quiet) showSuccess('身份服务地址已保存');
    } catch (error) {
      this.setStatus(`服务不可用：${error.message || '未知错误'}`);
      if (!quiet) showError(error.message || '身份验证服务不可用');
    }
  }

  async startIdentityVerification() {
    try {
      await this.openIdentityEdit();
    } catch (error) {
      this.setStatus(`验证未完成：${error.message || '未知错误'}`);
      showError(error.message || '钱包验证未完成');
    } finally { hideWaiting(); }
  }

  async promptEmail(defaultValue = '') {
    const value = await this.promptIdentityInput({ title: '验证邮箱', hint: '请输入用于钱包身份验证的邮箱。', label: '邮箱', placeholder: 'name@example.com', defaultValue, inputMode: 'email' });
    if (value === null) return '';
    const email = String(value || '').trim().toLowerCase();
    if (!email) throw new Error('请输入验证邮箱');
    return email;
  }

  async promptUsername(defaultValue = '') {
    const value = await this.promptIdentityInput({ title: '验证用户名', hint: '用户名为 3-32 位小写字母、数字、点、下划线或连字符。', label: '用户名', placeholder: 'username', defaultValue });
    if (value === null) return '';
    const username = String(value || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new Error('用户名须为 3-32 位小写字母、数字、点、下划线或连字符');
    return username;
  }

  async promptIdentityProfile({ username: defaultUsername = '', email: defaultEmail = '', avatarUri: defaultAvatarUri = '', endpoint: defaultEndpoint = '' } = {}) {
    const modal = document.getElementById('identityInputModal');
    const overlay = modal?.querySelector('.modal-overlay');
    const titleEl = document.getElementById('identityInputTitle');
    const hintEl = document.getElementById('identityInputHint');
    const body = modal?.querySelector('.modal-body');
    const confirm = document.getElementById('confirmIdentityInputBtn');
    const cancel = document.getElementById('cancelIdentityInputBtn');
    const close = document.getElementById('closeIdentityInputModal');
    if (!modal || !body || !confirm || !cancel || !close) {
      const username = await this.promptUsername(defaultUsername);
      if (!username) return null;
      const email = await this.promptEmail(defaultEmail);
      if (!email) return null;
      return { username, email, avatarUri: defaultAvatarUri, endpoint: defaultEndpoint };
    }

    const originalBody = body.innerHTML;
    if (titleEl) titleEl.textContent = '验证资料';
    if (hintEl) hintEl.textContent = '填写用户名、邮箱和头像，确认后将向邮箱发送验证码。';
    body.innerHTML = `
      <p id="identityInputHint" class="settings-hint">填写用户名、邮箱和头像，确认后将向邮箱发送验证码。</p>
      <div class="form-group"><label for="identityProfileEndpoint">身份服务地址</label><input id="identityProfileEndpoint" class="input" type="url" autocomplete="url" /></div>
      <div class="form-group"><label for="identityProfileUsername">用户名</label><input id="identityProfileUsername" class="input" autocomplete="username" /></div>
      <div class="form-group"><label for="identityProfileEmail">邮箱</label><input id="identityProfileEmail" class="input" type="email" autocomplete="email" /></div>
      <div class="form-group"><label for="identityProfileAvatar">头像 URI</label><input id="identityProfileAvatar" class="input" type="url" autocomplete="url" /></div>
    `;
    const endpointInput = document.getElementById('identityProfileEndpoint') || body.querySelector('#identityProfileEndpoint');
    const usernameInput = document.getElementById('identityProfileUsername') || body.querySelector('#identityProfileUsername');
    const emailInput = document.getElementById('identityProfileEmail') || body.querySelector('#identityProfileEmail');
    const avatarInput = document.getElementById('identityProfileAvatar') || body.querySelector('#identityProfileAvatar');
    if (endpointInput) endpointInput.value = defaultEndpoint || this.endpoint();
    if (usernameInput) usernameInput.value = defaultUsername;
    if (emailInput) emailInput.value = defaultEmail;
    if (avatarInput) avatarInput.value = defaultAvatarUri;
    modal.classList.remove('hidden');

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        confirm.removeEventListener('click', handleConfirm);
        cancel.removeEventListener('click', handleCancel);
        close.removeEventListener('click', handleCancel);
        overlay?.removeEventListener('click', handleCancel);
        usernameInput?.removeEventListener('keydown', handleKeydown);
        emailInput?.removeEventListener('keydown', handleKeydown);
        avatarInput?.removeEventListener('keydown', handleKeydown);
        modal.classList.add('hidden');
        body.innerHTML = originalBody;
      };
      const handleCancel = () => { cleanup(); resolve(null); };
      const handleConfirm = () => {
        try {
          const endpoint = String(endpointInput?.value || '').trim();
          const username = String(usernameInput?.value || '').trim().toLowerCase();
          const email = String(emailInput?.value || '').trim().toLowerCase();
          const avatarUri = String(avatarInput?.value || '').trim();
          if (!endpoint) throw new Error('请输入身份服务地址');
          if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new Error('用户名须为 3-32 位小写字母、数字、点、下划线或连字符');
          if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('请输入有效邮箱');
          if (!avatarUri) throw new Error('请输入头像 URI');
          const url = new URL(avatarUri);
          if (!['https:', 'http:', 'ipfs:'].includes(url.protocol)) throw new Error('头像 URI 仅支持 HTTP、HTTPS 或 IPFS');
          cleanup();
          this.persistEndpoint(endpoint);
          resolve({ username, email, avatarUri, endpoint });
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      const handleKeydown = (event) => {
        if (event.key === 'Enter') handleConfirm();
        if (event.key === 'Escape') handleCancel();
      };
      confirm.addEventListener('click', handleConfirm);
      cancel.addEventListener('click', handleCancel);
      close.addEventListener('click', handleCancel);
      overlay?.addEventListener('click', handleCancel);
      usernameInput?.addEventListener('keydown', handleKeydown);
      emailInput?.addEventListener('keydown', handleKeydown);
      avatarInput?.addEventListener('keydown', handleKeydown);
      setTimeout(() => usernameInput?.focus(), 0);
    });
  }

  async promptVerificationCode() {
    const value = await this.promptIdentityInput({ title: '输入验证码', hint: '验证码已发送到验证邮箱。', label: '6 位验证码', placeholder: '123456', inputMode: 'numeric', pattern: '\\d{6}' });
    if (value === null) return '';
    const code = String(value || '').trim();
    if (!/^\d{6}$/.test(code)) throw new Error('请输入 6 位验证码');
    return code;
  }

  promptIdentityInput({ title, hint, label, placeholder = '', defaultValue = '', inputMode = 'text', pattern = '' }) {
    const modal = document.getElementById('identityInputModal');
    const overlay = modal?.querySelector('.modal-overlay');
    const titleEl = document.getElementById('identityInputTitle');
    const hintEl = document.getElementById('identityInputHint');
    const labelEl = document.getElementById('identityInputLabel');
    const input = document.getElementById('identityInputValue');
    const confirm = document.getElementById('confirmIdentityInputBtn');
    const cancel = document.getElementById('cancelIdentityInputBtn');
    const close = document.getElementById('closeIdentityInputModal');
    if (!modal || !input || !confirm || !cancel || !close) return Promise.resolve(null);
    titleEl.textContent = title;
    hintEl.textContent = hint;
    labelEl.textContent = label;
    input.placeholder = placeholder;
    input.value = defaultValue;
    input.inputMode = inputMode;
    input.pattern = pattern;
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
      const handleCancel = () => { cleanup(); resolve(null); };
      const handleConfirm = () => { cleanup(); resolve(input.value); };
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

  async requestAndConfirmIdentity({ username, email, avatarUri = '' }) {
    const endpoint = this.endpoint();
    if (!endpoint) throw new Error('请输入 Node 服务地址');
    this.persistEndpoint(endpoint);
    const currentAccount = await this.wallet.getCurrentAccount();
    const requestedAddress = String(this.selectedIdentityAddress || currentAccount?.address || '').trim();
    const account = requestedAddress && requestedAddress.toLowerCase() !== String(currentAccount?.address || '').toLowerCase()
      ? (await this.wallet.getWalletList()).flatMap(wallet => Array.isArray(wallet.accounts) ? wallet.accounts : []).find(item => String(item.address || '').toLowerCase() === requestedAddress.toLowerCase())
      : currentAccount;
    if (!account?.address) throw new Error('未找到当前账户');
    const password = await this.requestPassword?.();
    if (!password) return false;
    if (account.id && account.id !== currentAccount?.id) {
      await this.wallet.switchAccount(account.id, password);
    }
    const identities = await this.wallet.listIdentities();
    let identityId = identities?.selectedIdentityId || identities?.identities?.[0]?.document?.walletIdentityId;
    if (!identityId) {
      const created = await this.wallet.createIdentity(password);
      identityId = created?.document?.walletIdentityId;
    }
    if (!identityId) throw new Error('无法创建钱包身份');
    await this.wallet.selectIdentity(identityId);
    const identityDocument = await this.wallet.exportIdentityDocument(identityId);
    if (!identityDocument?.document?.id && !identityDocument?.id) throw new Error('未选择钱包身份');
    const identity = await this.wallet.signIdentityDocument(identityDocument.document || identityDocument, password, identityId);
    const identityDid = identity.id;
    showWaiting();
    const chainKey = account.chainKey || `eip155:${account.chainId || 1}`;
    const linkChallenge = await this.fetchIdentityLinkChallenge(endpoint, identityDid, { chainKey, address: account.address });
    const accountSignature = await this.transaction.signMessage(linkChallenge.message, password);
    let linkResult;
    try {
      linkResult = await this.verifyIdentityLink(endpoint, {
        identityDocument: identity,
        identity: identityDid,
        account: { chainKey, address: account.address },
        nonce: linkChallenge.nonce,
        issuedAt: linkChallenge.issuedAt,
        expiresAt: linkChallenge.expiresAt,
        accountSignature
      });
    } catch (error) {
      if (!this.isDuplicateAccountLinkError(error)) throw error;
      linkResult = { verifiedAt: new Date().toISOString(), duplicate: true };
    }
    if (!linkResult?.verifiedAt) throw new Error('钱包账户关联失败');
    const verificationTypes = ['email', 'username', ...(avatarUri ? ['avatar'] : [])];
    const requested = await this.wallet.requestIdentityVerification(endpoint, {
      types: verificationTypes,
      identity: identityDid,
      account: { chainKey, address: account.address },
      email,
      username,
      ...(avatarUri ? { avatarUri } : {})
    });
    if (!requested?.verificationId) throw new Error('Node 未返回验证事务 ID');
    this.persistVerificationState(endpoint, account.address, VERIFICATION_STATE_PENDING_EMAIL);
    this.persistEmailVerificationState(endpoint, account.address, { verificationId: requested.verificationId, email, username, avatarUri, types: verificationTypes, expiresAt: requested.expiresAt || '' });
    this.setEmailStatus(`验证码已发送至 ${requested.email || email}，请查收邮件后输入 6 位验证码。`);
    hideWaiting();
    const code = await this.promptVerificationCode();
    if (!code) {
      this.setStatus('验证码已发送，请稍后继续验证。');
      return false;
    }
    showWaiting();
    const result = await this.wallet.confirmIdentityVerification(endpoint, requested.verificationId, code, verificationTypes);
    if (!Array.isArray(result?.credentials) || result.credentials.length < verificationTypes.length) throw new Error('Node 未返回完整身份凭证');
    this.persistVerificationState(endpoint, account.address, VERIFICATION_STATE_COMPLETE);
    this.persistEmailVerificationState(endpoint, account.address, null);
    this.setEmailStatus(`已验证邮箱：${email}`);
    hideWaiting();
    return true;
  }

  async fetchIdentityLinkChallenge(endpoint, identity, account) {
    const response = await fetch(new URL('/api/v1/public/identity/account-links/challenge', endpoint), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity, account })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.code !== 0 || !json.data?.message) throw new Error(json.message || '获取钱包身份关联 challenge 失败');
    return json.data;
  }

  async verifyIdentityLink(endpoint, body) {
    const response = await fetch(new URL('/api/v1/public/identity/account-links/verify', endpoint), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.code !== 0) throw new Error(json.message || '钱包身份关联失败');
    return json.data;
  }

  isDuplicateAccountLinkError(error) {
    const message = String(error?.message || error || '');
    return message.includes('uidx_identity_account_link')
      || (message.includes('duplicate key value') && message.includes('identity_account_link'));
  }

  async continueEmailVerification() {
    try {
      const endpoint = this.endpoint();
      const account = await this.wallet.getCurrentAccount();
      const state = this.loadEmailVerificationState(endpoint, account?.address);
      let completed = false;
      if (state?.verificationId) {
        const code = await this.promptVerificationCode();
        if (!code) return;
        showWaiting();
        const verificationTypes = Array.isArray(state.types) && state.types.length > 0 ? state.types : ['email', 'username'];
        const result = await this.wallet.confirmIdentityVerification(endpoint, state.verificationId, code, verificationTypes);
        if (!Array.isArray(result?.credentials) || result.credentials.length < verificationTypes.length) throw new Error('Node 未返回完整身份凭证');
        this.persistVerificationState(endpoint, account.address, VERIFICATION_STATE_COMPLETE);
        this.persistEmailVerificationState(endpoint, account.address, null);
        this.setEmailStatus(`已验证邮箱：${state.email || result.email || ''}`);
        completed = true;
      } else {
        await this.openIdentityEdit();
      }
      await this.renderIdentityVerificationAction();
      if (completed) showSuccess('钱包验证已完成');
    } catch (error) {
      this.setEmailStatus(`验证未完成：${error.message || '未知错误'}`);
      showError(error.message || '钱包验证未完成');
    } finally { hideWaiting(); }
  }

  async changeWalletIdentity() {
    try {
      await this.openIdentityEdit();
      return;
    } catch (error) {
      this.setEmailStatus(`验证资料变更失败：${error.message || '未知错误'}`);
      showError(error.message || '验证资料变更失败');
    } finally { hideWaiting(); }
  }

  async clearIdentityVerification() {
    try {
      const endpoint = this.endpoint();
      const account = await this.wallet.getCurrentAccount();
      if (!account?.address) throw new Error('未找到当前账户');
      this.persistVerificationState(endpoint, account.address, false);
      this.persistEmailVerificationState(endpoint, account.address, null);
      await this.renderIdentityVerificationAction();
      showSuccess('已移除本地钱包身份验证状态');
    } catch (error) {
      showError(error.message || '移除本地钱包身份验证状态失败');
    } finally { hideWaiting(); }
  }

  formatWalletAddress(address) {
    const value = String(address || '').trim();
    if (value.length <= 12) return value || '-';
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }

  formatCompactIdentityValue(value, head = 18, tail = 12) {
    const text = String(value || '').trim();
    if (!text) return '-';
    const minLength = head + tail + 3;
    if (text.length <= minLength) return text;
    return `${text.slice(0, head)}...${text.slice(-tail)}`;
  }

  displayUsername(value) {
    const username = String(value || '').trim();
    return username.toLowerCase().endsWith(USERNAME_NAMESPACE_SUFFIX)
      ? username.slice(0, -USERNAME_NAMESPACE_SUFFIX.length)
      : username;
  }

  async ensureIdentityPasskey(endpoint, identityDid, identityDocument, _password) {
    if (!globalThis.PublicKeyCredential || !navigator.credentials) {
      this.setStatus('钱包身份已验证；当前浏览器不支持 Passkey，暂不能用于无钱包登录');
      return null;
    }
    const requested = await this.requestIdentityPasskeyRegistration(endpoint, {
      identity: identityDid,
      identityDocument,
      deviceName: '夜莺钱包身份'
    });
    const passkeyRequest = requested?.passkeyRequest;
    if (!passkeyRequest?.challenge || !passkeyRequest?.requestId) throw new Error('Node 未返回 Passkey 注册请求');
    hideWaiting();
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: base64UrlToArrayBuffer(passkeyRequest.challenge),
        rp: passkeyRequest.rp,
        user: {
          id: base64UrlToArrayBuffer(passkeyRequest.user?.id),
          name: passkeyRequest.user?.name || identityDid,
          displayName: passkeyRequest.user?.displayName || 'YeYing Identity'
        },
        pubKeyCredParams: passkeyRequest.pubKeyCredParams || [],
        timeout: passkeyRequest.timeout,
        attestation: passkeyRequest.attestation,
        excludeCredentials: (passkeyRequest.excludeCredentials || []).map(item => ({
          id: base64UrlToArrayBuffer(item.id),
          type: 'public-key',
          transports: item.transports
        })),
        authenticatorSelection: passkeyRequest.authenticatorSelection
      }
    });
    if (!credential) throw new Error('Passkey 注册已取消');
    const response = credential.response;
    showWaiting();
    return await this.confirmIdentityPasskeyRegistration(endpoint, {
      identity: identityDid,
      requestId: passkeyRequest.requestId,
      deviceName: '夜莺钱包身份',
      credential: {
        id: credential.id,
        rawId: arrayBufferToBase64Url(credential.rawId),
        type: credential.type,
        response: {
          attestationObject: arrayBufferToBase64Url(response.attestationObject),
          clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
          transports: typeof response.getTransports === 'function' ? response.getTransports() : []
        },
        clientExtensionResults: credential.getClientExtensionResults()
      }
    });
  }

  async tryEnsureIdentityPasskey(endpoint, identityDid, identityDocument, password) {
    try {
      return await this.ensureIdentityPasskey(endpoint, identityDid, identityDocument, password);
    } catch (error) {
      const message = error?.message || 'Passkey 注册未完成';
      this.setStatus(`钱包身份已验证；${message}，无钱包登录可能暂不可用`);
      hideWaiting();
      return null;
    }
  }

  async selectedIdentityContext({ requireSigned = false } = {}) {
    const identities = await this.wallet.listIdentities();
    const identityId = identities?.selectedIdentityId || identities?.identities?.[0]?.document?.walletIdentityId;
    if (!identityId) throw new Error('请先完成钱包身份验证');
    if (!identities?.selectedIdentityId) await this.wallet.selectIdentity(identityId);
    const exported = await this.wallet.exportIdentityDocument(identityId);
    const document = exported?.document || exported;
    const identityDid = document?.id;
    if (!identityDid) throw new Error('未选择钱包身份');
    if (!requireSigned) return { identityId, identityDid, identityDocument: document };
    const password = await this.requestPassword?.();
    if (!password) throw new Error('需要钱包密码才能管理身份认证器');
    const signed = await this.wallet.signIdentityDocument(document, password, identityId);
    return { identityId, identityDid: signed?.id || identityDid, identityDocument: signed, password };
  }

  async openIdentityPasskeys() {
    showPage('walletIdentityPasskeyPage');
    await this.refreshIdentityPasskeys({ quiet: true });
  }

  async openIdentityAuthenticators() {
    showPage('walletIdentityAuthenticatorPage');
    await this.refreshIdentityTotp({ quiet: true });
  }

  async registerIdentityPasskey() {
    try {
      const endpoint = this.endpoint();
      if (!endpoint) throw new Error('请输入身份服务地址');
      const { identityDid, identityDocument, password } = await this.selectedIdentityContext({ requireSigned: true });
      showWaiting();
      await this.ensureIdentityPasskey(endpoint, identityDid, identityDocument, password);
      hideWaiting();
      showSuccess('通行证已注册');
      await this.refreshIdentityPasskeys({ quiet: true });
      await this.refreshIdentityPasskeySummary({ quiet: true });
    } catch (error) {
      hideWaiting();
      showError(error?.message || '注册通行证失败');
      this.setPasskeyStatus(error?.message || '注册通行证失败');
    }
  }

  async refreshIdentityPasskeys({ quiet = false } = {}) {
    const list = document.getElementById('walletIdentityPasskeyListPage');
    if (list) list.textContent = '正在加载通行证...';
    try {
      const endpoint = this.endpoint();
      const { identityDid } = await this.selectedIdentityContext();
      const result = await this.listIdentityPasskeys(endpoint, { identity: identityDid });
      const credentials = Array.isArray(result?.credentials) ? result.credentials : [];
      this.renderIdentityPasskeys(credentials);
      const activeCount = credentials.filter(item => !item?.revokedAt).length;
      this.setPasskeyStatus(activeCount ? `已启用 ${activeCount} 个通行证` : '未启用通行证；可点击“注册通行证”启用无钱包插件登录。');
      this.setPasskeySummary(activeCount ? `已启用 ${activeCount} 个通行证` : '未启用通行证');
    } catch (error) {
      const message = error?.message || '加载通行证失败';
      this.renderIdentityPasskeys([]);
      this.setPasskeyStatus(message);
      if (!quiet) showError(message);
    }
  }

  async refreshIdentityPasskeySummary({ quiet = false } = {}) {
    try {
      const endpoint = this.endpoint();
      const { identityDid } = await this.selectedIdentityContext();
      const result = await this.listIdentityPasskeys(endpoint, { identity: identityDid });
      const credentials = Array.isArray(result?.credentials) ? result.credentials : [];
      const activeCount = credentials.filter(item => !item?.revokedAt).length;
      this.setPasskeySummary(activeCount ? `已启用 ${activeCount} 个通行证` : '未启用通行证');
    } catch (error) {
      const message = error?.message || '加载通行证状态失败';
      this.setPasskeySummary(message);
      if (!quiet) showError(message);
    }
  }

  renderIdentityPasskeys(credentials) {
    const list = document.getElementById('walletIdentityPasskeyListPage');
    if (!list) return;
    list.replaceChildren();
    if (!credentials.length) {
      const empty = document.createElement('p');
      empty.className = 'settings-hint';
      empty.textContent = '当前没有已注册通行证。';
      list.appendChild(empty);
      return;
    }
    for (const credential of credentials) {
      const item = document.createElement('div');
      item.className = 'identity-passkey-item';
      const content = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'identity-passkey-name';
      name.textContent = credential.deviceName || credential.name || '未命名通行证';
      const meta = document.createElement('div');
      meta.className = 'identity-passkey-meta';
      const created = credential.createdAt ? `创建：${credential.createdAt}` : '';
      const used = credential.lastUsedAt ? `最近使用：${credential.lastUsedAt}` : '';
      const id = credential.credentialId ? `ID：${this.formatCredentialId(credential.credentialId)}` : '';
      meta.textContent = [created, used, id].filter(Boolean).join(' · ') || '未返回设备详情';
      content.append(name, meta);
      item.appendChild(content);
      if (!credential.revokedAt && credential.credentialId) {
        const revoke = document.createElement('button');
        revoke.className = 'btn btn-danger btn-small';
        revoke.type = 'button';
        revoke.dataset.passkeyRevoke = credential.credentialId;
        revoke.textContent = '撤销';
        item.appendChild(revoke);
      }
      list.appendChild(item);
    }
  }

  setPasskeyStatus(text) {
    const element = document.getElementById('walletIdentityPasskeyStatusPage');
    if (element) element.textContent = text || '';
  }

  setPasskeySummary(text) {
    const element = document.getElementById('walletIdentityPasskeySummaryPage');
    if (element) element.textContent = text || '';
  }

  setTotpStatus(text) {
    const element = document.getElementById('walletIdentityTotpStatusPage');
    if (element) element.textContent = text || '';
  }

  setTotpSummary(text) {
    const element = document.getElementById('walletIdentityTotpSummaryPage');
    if (element) element.textContent = text || '';
  }

  setTotpSetupVisible(visible) {
    document.getElementById('walletIdentityTotpSetupPage')?.classList.toggle('hidden', !visible);
  }

  formatCredentialId(value) {
    const text = String(value || '');
    if (text.length <= 18) return text || '-';
    return `${text.slice(0, 8)}...${text.slice(-6)}`;
  }

  async revokeIdentityPasskey(credentialId) {
    try {
      const id = String(credentialId || '').trim();
      if (!id) throw new Error('缺少通行证凭证标识');
      if (typeof globalThis.confirm === 'function' && !globalThis.confirm('确认撤销这个通行证？撤销后该设备不能再用于无钱包插件登录。')) return;
      const endpoint = this.endpoint();
      const { identityDid, identityDocument } = await this.selectedIdentityContext({ requireSigned: true });
      showWaiting();
      await this.revokeIdentityPasskeyCredential(endpoint, { identity: identityDid, identityDocument, credentialId: id });
      hideWaiting();
      showSuccess('通行证已撤销');
      await this.refreshIdentityPasskeys({ quiet: true });
      await this.refreshIdentityPasskeySummary({ quiet: true });
    } catch (error) {
      hideWaiting();
      showError(error?.message || '撤销通行证失败');
    }
  }

  async refreshIdentityTotp({ quiet = false } = {}) {
    try {
      const endpoint = this.endpoint();
      const { identityDid } = await this.selectedIdentityContext();
      const result = await this.getIdentityTotp(endpoint, { identity: identityDid });
      const totp = result?.totp || {};
      const enabled = Boolean(totp.enabled);
      this.setTotpStatus(enabled ? `已启用${totp.deviceName ? `：${totp.deviceName}` : ''}` : '未启用 TOTP 验证器。');
      this.setTotpSummary(enabled ? `TOTP 已启用${totp.deviceName ? `：${totp.deviceName}` : ''}` : 'TOTP 未启用');
      document.getElementById('setupWalletIdentityTotpBtn')?.classList.toggle('hidden', enabled);
      document.getElementById('revokeWalletIdentityTotpBtn')?.classList.toggle('hidden', !enabled);
      this.setTotpSetupVisible(totp.status === 'pending');
    } catch (error) {
      const message = error?.message || '加载 TOTP 状态失败';
      this.setTotpStatus(message);
      if (!quiet) showError(message);
    }
  }

  async refreshIdentityTotpSummary({ quiet = false } = {}) {
    try {
      const endpoint = this.endpoint();
      const { identityDid } = await this.selectedIdentityContext();
      const result = await this.getIdentityTotp(endpoint, { identity: identityDid });
      const totp = result?.totp || {};
      const enabled = Boolean(totp.enabled);
      this.setTotpSummary(enabled ? `TOTP 已启用${totp.deviceName ? `：${totp.deviceName}` : ''}` : 'TOTP 未启用');
    } catch (error) {
      const message = error?.message || '加载验证器状态失败';
      this.setTotpSummary(message);
      if (!quiet) showError(message);
    }
  }

  async setupIdentityTotp() {
    try {
      const endpoint = this.endpoint();
      const { identityDid, identityDocument } = await this.selectedIdentityContext({ requireSigned: true });
      showWaiting();
      const result = await this.setupIdentityTotpAuthenticator(endpoint, { identity: identityDid, identityDocument, deviceName: 'TOTP 验证器' });
      hideWaiting();
      const totp = result?.totp || {};
      const qrContainer = document.getElementById('walletIdentityTotpQrPage');
      if (qrContainer) qrContainer.innerHTML = '';
      if (totp.otpauthUri) generateQRCode(totp.otpauthUri, 'walletIdentityTotpQrPage', { width: 160, height: 160 });
      document.getElementById('walletIdentityTotpSecretPage').textContent = totp.secret ? `Secret：${totp.secret}` : '';
      document.getElementById('walletIdentityTotpUriPage').textContent = totp.otpauthUri || '';
      document.getElementById('walletIdentityTotpCodeInput').value = '';
      this.setTotpSetupVisible(true);
      this.setTotpStatus('请在认证器应用中添加 Secret 或 otpauth URI，然后输入验证码确认。');
      showSuccess('TOTP 配置已创建');
    } catch (error) {
      hideWaiting();
      const message = error?.message || '启用 TOTP 失败';
      this.setTotpStatus(message);
      showError(message);
    }
  }

  async confirmIdentityTotp() {
    try {
      const endpoint = this.endpoint();
      const { identityDid } = await this.selectedIdentityContext();
      const code = String(document.getElementById('walletIdentityTotpCodeInput')?.value || '').trim();
      if (!code) throw new Error('请输入 TOTP 验证码');
      showWaiting();
      await this.confirmIdentityTotpAuthenticator(endpoint, { identity: identityDid, code });
      hideWaiting();
      this.setTotpSetupVisible(false);
      showSuccess('TOTP 已启用');
      await this.refreshIdentityTotp({ quiet: true });
      await this.refreshIdentityTotpSummary({ quiet: true });
    } catch (error) {
      hideWaiting();
      const message = error?.message || '确认 TOTP 失败';
      this.setTotpStatus(message);
      showError(message);
    }
  }

  async revokeIdentityTotp() {
    try {
      if (typeof globalThis.confirm === 'function' && !globalThis.confirm('确认撤销 TOTP 验证器？撤销后验证码不能再用于钱包身份确认。')) return;
      const endpoint = this.endpoint();
      const { identityDid, identityDocument } = await this.selectedIdentityContext({ requireSigned: true });
      showWaiting();
      await this.revokeIdentityTotpAuthenticator(endpoint, { identity: identityDid, identityDocument });
      hideWaiting();
      this.setTotpSetupVisible(false);
      showSuccess('TOTP 已撤销');
      await this.refreshIdentityTotp({ quiet: true });
      await this.refreshIdentityTotpSummary({ quiet: true });
    } catch (error) {
      hideWaiting();
      const message = error?.message || '撤销 TOTP 失败';
      this.setTotpStatus(message);
      showError(message);
    }
  }

  async listIdentityPasskeys(endpoint, body) {
    const response = await fetch(new URL('/api/v1/public/identity/passkeys/list', endpoint), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const json = await response.json().catch(() => ({}));
    if (response.status === 404) throw new Error('当前身份服务尚未提供通行证列表接口');
    if (!response.ok || json.code !== 0) throw new Error(json.message || '加载通行证列表失败');
    return json.data;
  }

  async revokeIdentityPasskeyCredential(endpoint, body) {
    const response = await fetch(new URL('/api/v1/public/identity/passkeys/revoke', endpoint), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const json = await response.json().catch(() => ({}));
    if (response.status === 404) throw new Error('当前身份服务尚未提供通行证撤销接口');
    if (!response.ok || json.code !== 0) throw new Error(json.message || '撤销通行证失败');
    return json.data;
  }

  async requestIdentityPasskeyRegistration(endpoint, body) {
    const response = await fetch(new URL('/api/v1/public/identity/passkeys/register/request', endpoint), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.code !== 0) throw new Error(json.message || '创建 Passkey 注册请求失败');
    return json.data;
  }

  async confirmIdentityPasskeyRegistration(endpoint, body) {
    const response = await fetch(new URL('/api/v1/public/identity/passkeys/register/confirm', endpoint), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.code !== 0) throw new Error(json.message || '确认 Passkey 注册失败');
    return json.data;
  }

  async getIdentityTotp(endpoint, body) {
    const response = await fetch(new URL('/api/v1/public/identity/totp/get', endpoint), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const json = await response.json().catch(() => ({}));
    if (response.status === 404) throw new Error('当前身份服务尚未提供 TOTP 接口');
    if (!response.ok || json.code !== 0) throw new Error(json.message || '加载 TOTP 状态失败');
    return json.data;
  }

  async setupIdentityTotpAuthenticator(endpoint, body) {
    const response = await fetch(new URL('/api/v1/public/identity/totp/setup', endpoint), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.code !== 0) throw new Error(json.message || '创建 TOTP 配置失败');
    return json.data;
  }

  async confirmIdentityTotpAuthenticator(endpoint, body) {
    const response = await fetch(new URL('/api/v1/public/identity/totp/confirm', endpoint), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.code !== 0) throw new Error(json.message || '确认 TOTP 失败');
    return json.data;
  }

  async revokeIdentityTotpAuthenticator(endpoint, body) {
    const response = await fetch(new URL('/api/v1/public/identity/totp/revoke', endpoint), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.code !== 0) throw new Error(json.message || '撤销 TOTP 失败');
    return json.data;
  }
}
