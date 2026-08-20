import { showPage, showError, showSuccess, showWaiting, hideWaiting } from '../../common/ui/index.js';

const DEFAULT_NODE_ENDPOINT = 'https://node.yeying.pub';
const ENDPOINT_STORAGE_KEY = 'passportNodeEndpoint';
const BINDING_STORAGE_PREFIX = 'passportIdentityBinding:';
const EMAIL_VERIFICATION_STORAGE_PREFIX = 'passportEmailVerification:';
const BINDING_STATE_PENDING_EMAIL = 'pending-email';
const BINDING_STATE_COMPLETE = 'complete';
const USERNAME_NAMESPACE_SUFFIX = '@node.yeying.pub';

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

export class PassportSettingsController {
  constructor({ wallet, transaction, requestPassword }) {
    this.wallet = wallet;
    this.transaction = transaction;
    this.requestPassword = requestPassword;
  }

  bindEvents() {
    document.getElementById('passportIdentityBtn')?.addEventListener('click', () => this.handleIdentityAction());
    document.getElementById('viewWalletIdentityBtn')?.addEventListener('click', () => this.openIdentityDetails());
    document.getElementById('closeWalletIdentityDetailModal')?.addEventListener('click', () => this.closeIdentityDetails());
    document.getElementById('walletIdentityDetailBackBtn')?.addEventListener('click', () => showPage('settingsPage'));
    document.getElementById('changeWalletIdentityPageBtn')?.addEventListener('click', () => this.changePassportIdentity());
    document.getElementById('unlinkWalletIdentityBtn')?.addEventListener('click', () => this.openUnlinkConfirm());
    document.getElementById('closeWalletIdentityUnlinkModal')?.addEventListener('click', () => this.closeUnlinkConfirm());
    document.getElementById('cancelWalletIdentityUnlinkBtn')?.addEventListener('click', () => this.closeUnlinkConfirm());
    document.querySelector('#walletIdentityUnlinkModal .modal-overlay')?.addEventListener('click', () => this.closeUnlinkConfirm());
    document.getElementById('confirmWalletIdentityUnlinkBtn')?.addEventListener('click', async () => { this.closeUnlinkConfirm(); await this.loginAndUnlink(); });
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
      this.changePassportIdentity();
    });
    document.querySelector('#walletIdentityDetailModal .modal-overlay')?.addEventListener('click', () => this.closeIdentityDetails());
  }

  endpoint() {
    return String(
      document.getElementById('passportEndpointInput')?.value || this.loadStoredEndpoint() || DEFAULT_NODE_ENDPOINT
    ).trim();
  }

  loadStoredEndpoint() {
    try { return String(globalThis.localStorage?.getItem(ENDPOINT_STORAGE_KEY) || '').trim(); } catch { return ''; }
  }

  persistEndpoint(endpoint) {
    try { globalThis.localStorage?.setItem(ENDPOINT_STORAGE_KEY, endpoint); } catch { /* storage may be unavailable */ }
  }

  bindingStorageKey(endpoint, address) {
    return `${BINDING_STORAGE_PREFIX}${endpoint}:${String(address || '').toLowerCase()}`;
  }

  loadBindingState(endpoint, address) {
    try {
      const raw = String(globalThis.localStorage?.getItem(this.bindingStorageKey(endpoint, address)) || '').trim();
      if (raw === '1' || raw === BINDING_STATE_COMPLETE) return BINDING_STATE_COMPLETE;
      if (raw === BINDING_STATE_PENDING_EMAIL) return BINDING_STATE_PENDING_EMAIL;
      return '';
    } catch { return ''; }
  }

  persistBindingState(endpoint, address, state) {
    try {
      const key = this.bindingStorageKey(endpoint, address);
      if (state) globalThis.localStorage?.setItem(key, state === true ? BINDING_STATE_COMPLETE : String(state));
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

  async renderBindingAction() {
    const button = document.getElementById('passportIdentityBtn');
    if (!button) return;
    let state = '';
    let account = null;
    try {
      account = await this.wallet.getCurrentAccount();
      await this.renderAddressPicker(account);
      state = this.loadBindingState(this.endpoint(), account?.address);
      const identities = await this.wallet.listIdentities();
      const identityId = identities?.selectedIdentityId || identities?.identities?.[0]?.document?.walletIdentityId;
      if (!identityId) {
        state = '';
        this.persistBindingState(this.endpoint(), account?.address, null);
      } else if (state === BINDING_STATE_COMPLETE) {
        const credentials = await this.wallet.listIdentityCredentials(identityId);
        if (!Array.isArray(credentials?.credentials) || credentials.credentials.length === 0) {
          state = '';
          this.persistBindingState(this.endpoint(), account?.address, null);
        }
      }
    } catch { state = ''; }
    const pending = state === BINDING_STATE_PENDING_EMAIL;
    const complete = state === BINDING_STATE_COMPLETE;
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
      const values = { username: '-', email: '-' };
      for (const item of credentials?.credentials || []) {
        const token = item?.credential || item?.jwt || item;
        const payload = this.decodeCredentialPayload(token);
        const subject = payload?.vc?.credentialSubject || {};
        if (subject.usernameQualified || subject.username) values.username = this.displayUsername(subject.username || subject.usernameQualified);
        if (subject.email) values.email = subject.email;
      }
      this.setDetailValue('walletIdentityDetailStatusPage', '已验证');
      this.setDetailValue('walletIdentityDetailUsernamePage', values.username);
      this.setDetailValue('walletIdentityDetailEmailPage', values.email);
      this.setDetailValue('walletIdentityDetailAddressPage', account?.address || '-');
      this.setDetailValue('walletIdentityDetailDidPage', identity?.document?.id || '-');
      this.setDetailValue('walletIdentityDetailEndpointPage', this.endpoint() || DEFAULT_NODE_ENDPOINT);
      showPage('walletIdentityDetailPage');
    } catch (error) {
      showError(error?.message || '无法读取钱包身份详情');
    }
  }

  closeIdentityDetails() {
    document.getElementById('walletIdentityDetailModal')?.classList.add('hidden');
  }

  closeIdentityEdit() { showPage('walletIdentityDetailPage'); }
  openUnlinkConfirm() { document.getElementById('walletIdentityUnlinkModal')?.classList.remove('hidden'); }
  closeUnlinkConfirm() { document.getElementById('walletIdentityUnlinkModal')?.classList.add('hidden'); }

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
      console.warn('[PassportSettings] 加载钱包地址列表失败，将继续使用当前地址:', error?.message || error);
    }
    if (selector) {
      this.renderIdentityAddressOptions(selector, options, current);
    }
    let username = '', email = '';
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
    }
    const endpointInput = document.getElementById('walletIdentityEditEndpoint');
    const usernameInput = document.getElementById('walletIdentityEditUsername');
    const emailInput = document.getElementById('walletIdentityEditEmail');
    if (!document.getElementById('walletIdentityEditPage')) {
      const profile = await this.promptIdentityProfile({ username, email, endpoint: this.endpoint() });
      if (!profile) return;
      ({ username, email } = profile);
      await this.requestAndConfirmIdentity({ username, email });
      return;
    }
    if (endpointInput) endpointInput.value = this.endpoint();
    if (usernameInput) usernameInput.value = username;
    if (emailInput) emailInput.value = email;
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
    if (!endpoint) throw new Error('请输入身份服务地址');
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new Error('用户名须为 3-32 位小写字母、数字、点、下划线或连字符');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('请输入有效邮箱');
    this.selectedIdentityAddress = document.getElementById('walletIdentityEditAddress')?.value || '';
    this.closeIdentityEdit();
    this.persistEndpoint(endpoint);
    await this.requestAndConfirmIdentity({ username, email });
    await this.renderBindingAction();
  }

  setDetailValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value || '-';
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
    const state = document.getElementById('passportIdentityBtn')?.dataset.state || 'none';
    if (state === BINDING_STATE_COMPLETE) return this.changePassportIdentity();
    if (state === BINDING_STATE_PENDING_EMAIL) return this.continueEmailVerification();
    return this.loginAndBind();
  }

  setStatus(text) {
    const element = document.getElementById('passportStatusText');
    if (element) element.textContent = text;
  }

  setEmailStatus(text) {
    const element = document.getElementById('passportEmailStatusText');
    if (element) element.textContent = text;
  }

  async load() {
    const input = document.getElementById('passportEndpointInput');
    if (input && !input.value) input.value = this.loadStoredEndpoint() || DEFAULT_NODE_ENDPOINT;
    await this.renderBindingAction();
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

  async loginAndBind() {
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

  async promptIdentityProfile({ username: defaultUsername = '', email: defaultEmail = '', endpoint: defaultEndpoint = '' } = {}) {
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
      return { username, email, endpoint: defaultEndpoint };
    }

    const originalBody = body.innerHTML;
    if (titleEl) titleEl.textContent = '验证资料';
    if (hintEl) hintEl.textContent = '填写用户名和邮箱，确认后将向邮箱发送验证码。';
    body.innerHTML = `
      <p id="identityInputHint" class="settings-hint">填写用户名和邮箱，确认后将向邮箱发送验证码。</p>
      <div class="form-group"><label for="identityProfileEndpoint">身份服务地址</label><input id="identityProfileEndpoint" class="input" type="url" autocomplete="url" /></div>
      <div class="form-group"><label for="identityProfileUsername">用户名</label><input id="identityProfileUsername" class="input" autocomplete="username" /></div>
      <div class="form-group"><label for="identityProfileEmail">邮箱</label><input id="identityProfileEmail" class="input" type="email" autocomplete="email" /></div>
    `;
    const endpointInput = document.getElementById('identityProfileEndpoint') || body.querySelector('#identityProfileEndpoint');
    const usernameInput = document.getElementById('identityProfileUsername') || body.querySelector('#identityProfileUsername');
    const emailInput = document.getElementById('identityProfileEmail') || body.querySelector('#identityProfileEmail');
    if (endpointInput) endpointInput.value = defaultEndpoint || this.endpoint();
    if (usernameInput) usernameInput.value = defaultUsername;
    if (emailInput) emailInput.value = defaultEmail;
    modal.classList.remove('hidden');

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        confirm.removeEventListener('click', handleConfirm);
        cancel.removeEventListener('click', handleCancel);
        close.removeEventListener('click', handleCancel);
        overlay?.removeEventListener('click', handleCancel);
        usernameInput?.removeEventListener('keydown', handleKeydown);
        emailInput?.removeEventListener('keydown', handleKeydown);
        modal.classList.add('hidden');
        body.innerHTML = originalBody;
      };
      const handleCancel = () => { cleanup(); resolve(null); };
      const handleConfirm = () => {
        try {
          const endpoint = String(endpointInput?.value || '').trim();
          const username = String(usernameInput?.value || '').trim().toLowerCase();
          const email = String(emailInput?.value || '').trim().toLowerCase();
          if (!endpoint) throw new Error('请输入身份服务地址');
          if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new Error('用户名须为 3-32 位小写字母、数字、点、下划线或连字符');
          if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('请输入有效邮箱');
          cleanup();
          this.persistEndpoint(endpoint);
          resolve({ username, email, endpoint });
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

  async requestAndConfirmIdentity({ username, email }) {
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
    const requested = await this.wallet.requestIdentityVerification(endpoint, {
      types: ['email', 'username'],
      identity: identityDid,
      account: { chainKey, address: account.address },
      email,
      username
    });
    if (!requested?.verificationId) throw new Error('Node 未返回验证事务 ID');
    this.persistBindingState(endpoint, account.address, BINDING_STATE_PENDING_EMAIL);
    this.persistEmailVerificationState(endpoint, account.address, { verificationId: requested.verificationId, email, username, expiresAt: requested.expiresAt || '' });
    this.setEmailStatus(`验证码已发送至 ${requested.email || email}，请查收邮件后输入 6 位验证码。`);
    hideWaiting();
    const code = await this.promptVerificationCode();
    if (!code) {
      this.setStatus('验证码已发送，请稍后继续验证。');
      return false;
    }
    showWaiting();
    const result = await this.wallet.confirmIdentityVerification(endpoint, requested.verificationId, code, ['email', 'username']);
    if (!Array.isArray(result?.credentials) || result.credentials.length < 2) throw new Error('Node 未返回完整身份凭证');
    await this.tryEnsureIdentityPasskey(endpoint, identityDid, identity, password);
    this.persistBindingState(endpoint, account.address, BINDING_STATE_COMPLETE);
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
        const result = await this.wallet.confirmIdentityVerification(endpoint, state.verificationId, code, ['email', 'username']);
        if (!Array.isArray(result?.credentials) || result.credentials.length < 2) throw new Error('Node 未返回完整身份凭证');
        if (typeof this.wallet.listIdentities === 'function' && typeof this.wallet.exportIdentityDocument === 'function' && typeof this.wallet.signIdentityDocument === 'function') {
          const identities = await this.wallet.listIdentities();
          const identityId = identities?.selectedIdentityId || identities?.identities?.[0]?.document?.walletIdentityId;
          if (identityId) {
          const password = await this.requestPassword?.();
          if (password) {
            const identityDocument = await this.wallet.exportIdentityDocument(identityId);
            const signed = await this.wallet.signIdentityDocument(identityDocument.document || identityDocument, password, identityId);
            await this.tryEnsureIdentityPasskey(endpoint, signed.id, signed, password);
          }
          }
        }
        this.persistBindingState(endpoint, account.address, BINDING_STATE_COMPLETE);
        this.persistEmailVerificationState(endpoint, account.address, null);
        this.setEmailStatus(`已验证邮箱：${state.email || result.email || ''}`);
        completed = true;
      } else {
        await this.openIdentityEdit();
      }
      await this.renderBindingAction();
      if (completed) showSuccess('钱包验证已完成');
    } catch (error) {
      this.setEmailStatus(`验证未完成：${error.message || '未知错误'}`);
      showError(error.message || '钱包验证未完成');
    } finally { hideWaiting(); }
  }

  async changePassportIdentity() {
    try {
      await this.openIdentityEdit();
      return;
    } catch (error) {
      this.setEmailStatus(`邮箱变更失败：${error.message || '未知错误'}`);
      showError(error.message || '邮箱变更失败');
    } finally { hideWaiting(); }
  }

  async loginAndUnlink() {
    try {
      const endpoint = this.endpoint();
      const account = await this.wallet.getCurrentAccount();
      if (!account?.address) throw new Error('未找到当前账户');
      this.persistBindingState(endpoint, account.address, false);
      this.persistEmailVerificationState(endpoint, account.address, null);
      await this.renderBindingAction();
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
}
