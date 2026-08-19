import { showPage, showError, showSuccess, showWaiting, hideWaiting } from '../../common/ui/index.js';

const DEFAULT_NODE_ENDPOINT = 'https://node.yeying.pub';
const ENDPOINT_STORAGE_KEY = 'passportNodeEndpoint';
const BINDING_STORAGE_PREFIX = 'passportIdentityBinding:';
const EMAIL_VERIFICATION_STORAGE_PREFIX = 'passportEmailVerification:';
const BINDING_STATE_PENDING_EMAIL = 'pending-email';
const BINDING_STATE_COMPLETE = 'complete';
const USERNAME_NAMESPACE_SUFFIX = '@node.yeying.pub';

export class PassportSettingsController {
  constructor({ wallet, transaction, requestPassword }) {
    this.wallet = wallet;
    this.transaction = transaction;
    this.requestPassword = requestPassword;
  }

  bindEvents() {
    document.getElementById('passportIdentityBtn')?.addEventListener('click', () => this.handleIdentityAction());
    document.getElementById('passportEndpointInput')?.addEventListener('change', () => this.renderBindingAction());
    document.getElementById('viewWalletIdentityBtn')?.addEventListener('click', () => this.openIdentityDetails());
    document.getElementById('closeWalletIdentityDetailModal')?.addEventListener('click', () => this.closeIdentityDetails());
    document.getElementById('walletIdentityDetailBackBtn')?.addEventListener('click', () => showPage('settingsPage'));
    document.getElementById('changeWalletIdentityPageBtn')?.addEventListener('click', () => this.changePassportIdentity());
    document.getElementById('unlinkWalletIdentityBtn')?.addEventListener('click', () => this.openUnlinkConfirm());
    document.getElementById('closeWalletIdentityUnlinkModal')?.addEventListener('click', () => this.closeUnlinkConfirm());
    document.getElementById('cancelWalletIdentityUnlinkBtn')?.addEventListener('click', () => this.closeUnlinkConfirm());
    document.querySelector('#walletIdentityUnlinkModal .modal-overlay')?.addEventListener('click', () => this.closeUnlinkConfirm());
    document.getElementById('confirmWalletIdentityUnlinkBtn')?.addEventListener('click', async () => { this.closeUnlinkConfirm(); await this.loginAndUnlink(); });
    document.getElementById('closeWalletIdentityEditModal')?.addEventListener('click', () => this.closeIdentityEdit());
    document.getElementById('cancelWalletIdentityEditBtn')?.addEventListener('click', () => this.closeIdentityEdit());
    document.querySelector('#walletIdentityEditModal .modal-overlay')?.addEventListener('click', () => this.closeIdentityEdit());
    document.getElementById('confirmWalletIdentityEditBtn')?.addEventListener('click', () => this.submitIdentityEdit());
    document.getElementById('changeWalletIdentityBtn')?.addEventListener('click', () => {
      this.selectedIdentityAddress = document.getElementById('walletIdentityAddressSelect')?.value || '';
      this.closeIdentityDetails();
      this.changePassportIdentity();
    });
    document.querySelector('#walletIdentityDetailModal .modal-overlay')?.addEventListener('click', () => this.closeIdentityDetails());
  }

  endpoint() { return String(document.getElementById('passportEndpointInput')?.value || '').trim(); }

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
    const serviceConfig = document.getElementById('identityServiceConfig');
    const detailsButton = document.getElementById('viewWalletIdentityBtn');
    button.dataset.state = state || 'none';
    button.textContent = pending ? '继续验证' : '验证';
    button.classList.toggle('hidden', complete);
    button.classList.toggle('btn-primary', true);
    button.classList.toggle('btn-danger', false);
    serviceConfig?.classList.toggle('hidden', complete);
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

  closeIdentityEdit() { document.getElementById('walletIdentityEditModal')?.classList.add('hidden'); }
  openUnlinkConfirm() { document.getElementById('walletIdentityUnlinkModal')?.classList.remove('hidden'); }
  closeUnlinkConfirm() { document.getElementById('walletIdentityUnlinkModal')?.classList.add('hidden'); }

  async openIdentityEdit() {
    const current = await this.wallet.getCurrentAccount();
    const selector = document.getElementById('walletIdentityEditAddress');
    const walletResult = typeof this.wallet.getWalletList === 'function'
      ? await this.wallet.getWalletList()
      : [];
    const wallets = Array.isArray(walletResult) ? walletResult : walletResult?.wallets;
    const accounts = (Array.isArray(wallets) ? wallets : [])
      .flatMap(wallet => Array.isArray(wallet?.accounts) ? wallet.accounts : [])
      .filter(item => item?.address);
    const options = [];
    const seen = new Set();
    const addOption = (item) => {
      const address = String(item?.address || '').trim();
      const key = address.toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      options.push({ ...item, address });
    };
    // Always keep the currently selected account available, even while the
    // wallet list is still loading or an imported wallet has no expanded list.
    addOption(current);
    accounts.forEach(addOption);
    if (selector) {
      selector.replaceChildren(...options.map(item => { const o = document.createElement('option'); o.value = item.address; o.textContent = `${item.name || '钱包账户'} · ${this.formatWalletAddress(item.address)}`; o.selected = item.address.toLowerCase() === String(current?.address || '').toLowerCase(); return o; }));
      if (!selector.options.length) selector.innerHTML = '<option value="">暂无可用钱包地址</option>';
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
    const usernameInput = document.getElementById('walletIdentityEditUsername');
    const emailInput = document.getElementById('walletIdentityEditEmail');
    if (!document.getElementById('walletIdentityEditModal')) {
      const username = await this.promptUsername();
      if (!username) return;
      const email = await this.promptEmail();
      if (!email) return;
      await this.requestAndConfirmIdentity({ username, email });
      return;
    }
    if (usernameInput) usernameInput.value = username;
    if (emailInput) emailInput.value = email;
    document.getElementById('walletIdentityEditModal')?.classList.remove('hidden');
  }

  async submitIdentityEdit() {
    const username = String(document.getElementById('walletIdentityEditUsername')?.value || '').trim().toLowerCase();
    const email = String(document.getElementById('walletIdentityEditEmail')?.value || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new Error('用户名须为 3-32 位小写字母、数字、点、下划线或连字符');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('请输入有效邮箱');
    this.selectedIdentityAddress = document.getElementById('walletIdentityEditAddress')?.value || '';
    this.closeIdentityEdit();
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
      const result = await this.wallet.getPassportStatus(endpoint);
      if (!result?.success || !result.status?.enabled) throw new Error(result?.error || '身份验证服务不可用');
      this.setStatus('服务可用，等待验证');
      if (!quiet) showSuccess('身份验证服务可用');
    } catch (error) {
      this.setStatus(`服务不可用：${error.message || '未知错误'}`);
      if (!quiet) showError(error.message || '身份验证服务不可用');
    }
  }

  async loginAndBind() {
    try {
      const username = await this.promptUsername();
      if (!username) return;
      const email = await this.promptEmail();
      if (!email) return;
      const completed = await this.requestAndConfirmIdentity({ username, email });
      await this.renderBindingAction();
      if (completed) showSuccess('钱包验证已完成');
    } catch (error) {
      this.setStatus(`验证未完成：${error.message || '未知错误'}`);
      showError(error.message || '钱包验证未完成');
    } finally { hideWaiting(); }
  }

  async fetchChallenge(endpoint, address) {
    const url = new URL('/api/v1/public/auth/challenge', endpoint);
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.code !== 0) throw new Error(json.message || '获取 SIWE challenge 失败');
    return json.data?.challenge;
  }

  async verify(endpoint, address, signature) {
    const response = await fetch(new URL('/api/v1/public/auth/verify', endpoint), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, signature })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.code !== 0) throw new Error(json.message || 'SIWE 校验失败');
    return json.data || {};
  }

  async authenticateWithCurrentWallet() {
    const endpoint = this.endpoint();
    if (!endpoint) throw new Error('请输入 Node 服务地址');
    this.persistEndpoint(endpoint);
    if (!this.transaction) throw new Error('签名模块未初始化');
    const account = await this.wallet.getCurrentAccount();
    if (!account?.address) throw new Error('未找到当前账户');
    showWaiting();
    const challenge = await this.fetchChallenge(endpoint, account.address);
    hideWaiting();
    if (!challenge) throw new Error('Node 未返回 SIWE challenge');
    const password = await this.requestPassword?.();
    if (!password) return null;
    showWaiting();
    const signature = await this.transaction.signMessage(challenge, password);
    const session = await this.verify(endpoint, account.address, signature);
    const accessToken = String(session?.token || '').trim();
    if (!accessToken) throw new Error('Node 未返回短期会话');
    return { endpoint, account, accessToken, password };
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

  async sendEmailVerification(auth, email) {
    const result = await this.wallet.requestPassportEmailVerification(auth.endpoint, auth.accessToken, email);
    if (!result?.success || !result.verification?.verificationId) throw new Error(result?.error || '验证码发送失败');
    this.persistEmailVerificationState(auth.endpoint, auth.account.address, {
      verificationId: result.verification.verificationId,
      email,
      emailHint: result.verification.emailHint || '',
      expiresAt: result.verification.expiresAt || ''
    });
    this.setEmailStatus(`验证码已发送至 ${result.verification.emailHint || email}，请查收邮件后输入 6 位验证码。`);
    return result.verification;
  }

  async sendAndConfirmEmail(auth, email) {
    await this.sendEmailVerification(auth, email);
    hideWaiting();
    const code = await this.promptVerificationCode();
    if (!code) {
      this.setStatus('验证码已发送，请稍后继续验证。');
      return false;
    }
    showWaiting();
    return await this.confirmEmailVerificationWithAuth(auth, code);
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
    const linkResult = await this.verifyIdentityLink(endpoint, {
      identityDocument: identity,
      identity: identityDid,
      account: { chainKey, address: account.address },
      nonce: linkChallenge.nonce,
      issuedAt: linkChallenge.issuedAt,
      expiresAt: linkChallenge.expiresAt,
      accountSignature
    });
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
    this.persistBindingState(endpoint, account.address, BINDING_STATE_COMPLETE);
    this.persistEmailVerificationState(endpoint, account.address, null);
    this.setEmailStatus(`已验证邮箱：${email}`);
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

  async confirmEmailVerificationWithAuth(auth, code) {
    const state = this.loadEmailVerificationState(auth.endpoint, auth.account.address);
    const verificationId = String(state?.verificationId || '').trim();
    if (!verificationId) throw new Error('请重新发送邮箱验证码');
    const result = await this.wallet.confirmPassportEmailVerification(auth.endpoint, auth.accessToken, verificationId, code);
    if (!result?.success || !result.verification?.email) throw new Error(result?.error || '邮箱确认失败');
    this.persistBindingState(auth.endpoint, auth.account.address, BINDING_STATE_COMPLETE);
    this.persistEmailVerificationState(auth.endpoint, auth.account.address, null);
    this.setEmailStatus(`验证邮箱已确认：${result.verification.email}`);
    return true;
  }

  async continueEmailVerification() {
    try {
      const email = await this.promptEmail();
      if (!email) return;
      const state = this.loadEmailVerificationState(this.endpoint(), (await this.wallet.getCurrentAccount())?.address);
      const completed = await this.requestAndConfirmIdentity({ username: state?.username || await this.promptUsername(), email });
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
      if (!endpoint) throw new Error('请输入 Node 服务地址');
      this.persistEndpoint(endpoint);
      const account = await this.wallet.getCurrentAccount();
      if (!account?.address) throw new Error('未找到当前账户');
      const challenge = await this.fetchChallenge(endpoint, account.address);
      const password = await this.requestPassword?.();
      if (!password) return;
      showWaiting();
      const loginSignature = await this.transaction.signMessage(challenge, password);
      const session = await this.verify(endpoint, account.address, loginSignature);
      const accessToken = String(session?.token || '').trim();
      if (!accessToken) throw new Error('Node 未返回短期会话');
      const requested = await this.wallet.createPassportUnlink(endpoint, accessToken);
      if (!requested?.success || !requested.unlink?.message) throw new Error(requested?.error || '无法创建解绑请求');
      const signature = await this.transaction.signMessage(requested.unlink.message, password);
      const confirmed = await this.wallet.confirmPassportUnlink(endpoint, accessToken, {
        requestId: requested.unlink.requestId,
        timestamp: requested.unlink.timestamp,
        signature
      });
      if (!confirmed?.success) throw new Error(confirmed?.error || '解绑失败');
      this.persistBindingState(endpoint, account.address, false);
      this.persistEmailVerificationState(endpoint, account.address, null);
      await this.renderBindingAction();
      showSuccess('已移除验证服务关联');
    } catch (error) {
      showError(error.message || '移除验证服务关联失败');
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
}
